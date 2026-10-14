import { downsampleSeries, gauss, mean, median, std } from "./dsp";

export type VoiceMetrics = {
  source: "microphone" | "simulation";
  quality: "good" | "limited";
  qualityNotes: string[];
  durationS: number;
  voicedPct: number;
  f0Mean: number;
  f0Sd: number;
  f0SdSemitones: number;
  jitterPct: number;
  shimmerPct: number;
  hnrDb: number;
  peakLevel: number;
  f0Track: { t: number; f0: number | null }[];
};

function decimate(buf: Float32Array, sr: number) {
  const dec = Math.max(1, Math.floor(sr / 12000));
  const n = Math.floor(buf.length / dec);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < dec; j++) s += buf[i * dec + j];
    out[i] = s / dec;
  }
  return { ds: out, dsr: sr / dec, dec };
}

/** Normalized autocorrelation pitch estimate for one frame. Returns f0 and peak correlation. */
function framePitch(x: Float32Array, start: number, len: number, dsr: number) {
  const minLag = Math.floor(dsr / 500);
  const maxLag = Math.min(Math.ceil(dsr / 75), len - 2);
  const r = new Float32Array(maxLag + 2);
  let best = 0;
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let num = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = start; i < start + len - lag; i++) {
      const a = x[i];
      const b = x[i + lag];
      num += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    r[lag] = e1 > 0 && e2 > 0 ? num / Math.sqrt(e1 * e2) : 0;
    if (lag <= maxLag && r[lag] > best) best = r[lag];
  }
  if (best <= 0) return { f0: 0, r: 0 };
  // Prefer the shortest lag that is a local max close to the best (avoids octave-down errors).
  let chosen = -1;
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    if (r[lag] >= 0.9 * best && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) {
      chosen = lag;
      break;
    }
  }
  if (chosen < 0) return { f0: 0, r: 0 };
  const a = r[chosen - 1];
  const b = r[chosen];
  const c = r[chosen + 1];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  return { f0: dsr / (chosen + shift), r: b };
}

/** Quick live pitch estimate for the latest audio chunk. */
export function livePitch(chunk: Float32Array, sr: number): number | null {
  const { ds, dsr } = decimate(chunk, sr);
  let e = 0;
  for (let i = 0; i < ds.length; i++) e += ds[i] * ds[i];
  if (Math.sqrt(e / ds.length) < 0.01) return null;
  const len = Math.min(ds.length, Math.round(0.04 * dsr));
  const { f0, r } = framePitch(ds, ds.length - len, len, dsr);
  return r > 0.5 && f0 > 0 ? f0 : null;
}

export function analyzeVoice(buf: Float32Array, sr: number, source: VoiceMetrics["source"]): VoiceMetrics {
  const notes: string[] = [];
  // Remove DC
  const m0 = mean(buf);
  const x = new Float32Array(buf.length);
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    x[i] = buf[i] - m0;
    peak = Math.max(peak, Math.abs(x[i]));
  }
  const { ds, dsr, dec } = decimate(x, sr);
  const frameLen = Math.round(0.04 * dsr);
  const hop = Math.round(0.01 * dsr);
  const nFrames = Math.max(0, Math.floor((ds.length - frameLen) / hop));
  const rmsArr: number[] = [];
  for (let f = 0; f < nFrames; f++) {
    let e = 0;
    for (let i = f * hop; i < f * hop + frameLen; i++) e += ds[i] * ds[i];
    rmsArr.push(Math.sqrt(e / frameLen));
  }
  const maxRms = Math.max(0, ...rmsArr);
  const gate = Math.max(0.004, 0.12 * maxRms);
  const track: (number | null)[] = [];
  const rs: number[] = [];
  for (let f = 0; f < nFrames; f++) {
    if (rmsArr[f] < gate) {
      track.push(null);
      continue;
    }
    const { f0, r } = framePitch(ds, f * hop, frameLen, dsr);
    if (r > 0.45 && f0 >= 75 && f0 <= 500) {
      track.push(f0);
      rs.push(r);
    } else track.push(null);
  }
  // Octave-error cleanup against median
  const voicedVals = track.filter((v): v is number => v != null);
  const med = median(voicedVals);
  for (let i = 0; i < track.length; i++) {
    const v = track[i];
    if (v != null && (v < med * 0.65 || v > med * 1.55)) track[i] = null;
  }
  const f0s = track.filter((v): v is number => v != null);
  const voicedPct = nFrames ? (f0s.length / nFrames) * 100 : 0;
  const f0Mean = mean(f0s);
  const f0Sd = std(f0s);
  const f0SdSemitones = f0Mean > 0 ? std(f0s.map((f) => 12 * Math.log2(f / f0Mean))) : 0;
  const hnrDb = rs.length
    ? mean(rs.map((r) => 10 * Math.log10(Math.min(r, 0.9999) / (1 - Math.min(r, 0.9999)))))
    : 0;

  // ---- Cycle-to-cycle jitter & shimmer on full-rate signal ----
  const hopFull = hop * dec;
  const f0At = (idx: number) => {
    const fi = Math.min(track.length - 1, Math.max(0, Math.floor(idx / hopFull)));
    return track[fi];
  };
  const periods: number[][] = [];
  const amps: number[][] = [];
  let f = 0;
  while (f < track.length) {
    if (track[f] == null) {
      f++;
      continue;
    }
    let g = f;
    while (g < track.length && track[g] != null) g++;
    const segStart = f * hopFull;
    const segEnd = Math.min(x.length - 2, g * hopFull + frameLen * dec);
    f = g;
    if (segEnd - segStart < sr * 0.1) continue;
    const pTimes: number[] = [];
    const pAmps: number[] = [];
    let T = sr / (f0At(segStart) ?? med);
    let p = segStart;
    let best = -Infinity;
    for (let i = segStart; i < Math.min(segEnd, segStart + T); i++) if (x[i] > best) { best = x[i]; p = i; }
    while (true) {
      const fl = f0At(p) ?? med;
      if (!fl) break;
      T = sr / fl;
      const lo = Math.floor(p + 0.7 * T);
      const hi = Math.ceil(p + 1.3 * T);
      if (hi >= segEnd) break;
      let q = lo;
      let qv = -Infinity;
      for (let i = lo; i <= hi; i++) if (x[i] > qv) { qv = x[i]; q = i; }
      const a = x[q - 1];
      const b = x[q];
      const c = x[q + 1];
      const den = a - 2 * b + c;
      const sh = den !== 0 ? (0.5 * (a - c)) / den : 0;
      pTimes.push((q + sh) / sr);
      pAmps.push(b - 0.25 * (a - c) * sh);
      p = q;
    }
    const segP: number[] = [];
    const segA: number[] = [];
    for (let i = 1; i < pTimes.length; i++) {
      segP.push(pTimes[i] - pTimes[i - 1]);
      segA.push(pAmps[i]);
    }
    periods.push(segP);
    amps.push(segA);
  }
  let jNum = 0;
  let jCount = 0;
  let sNum = 0;
  let sCount = 0;
  const allP: number[] = [];
  const allA: number[] = [];
  periods.forEach((seg, si) => {
    const a = amps[si];
    // trim edges of each voiced segment (onset/offset transients)
    const trim = Math.floor(seg.length * 0.08);
    for (let i = trim + 1; i < seg.length - trim; i++) {
      const p1 = seg[i - 1];
      const p2 = seg[i];
      if (p1 < 1 / 500 || p1 > 1 / 75 || p2 < 1 / 500 || p2 > 1 / 75) continue;
      if (Math.max(p1, p2) / Math.min(p1, p2) > 1.3) continue;
      jNum += Math.abs(p2 - p1);
      jCount++;
      allP.push(p2);
      if (a[i - 1] > 0 && a[i] > 0) {
        sNum += Math.abs(a[i] - a[i - 1]);
        sCount++;
        allA.push(a[i]);
      }
    }
  });
  const jitterPct = jCount && mean(allP) > 0 ? (jNum / jCount / mean(allP)) * 100 : 0;
  const shimmerPct = sCount && mean(allA) > 0 ? (sNum / sCount / mean(allA)) * 100 : 0;

  if (peak < 0.02) notes.push("Recording level was very low; move closer to the microphone.");
  if (voicedPct < 45) notes.push("Less than half of the recording contained a steady voiced 'ah'.");
  if (peak > 0.99) notes.push("The signal clipped; reduce volume or move slightly away from the microphone.");
  if (jCount < 50) notes.push("Too few stable glottal cycles were found for reliable jitter/shimmer.");

  const f0Track = downsampleSeries(
    track.map((v, i) => ({ t: Math.round(((i * hop) / dsr) * 100) / 100, f0: v == null ? null : Math.round(v * 10) / 10 })),
    250,
  );

  return {
    source,
    quality: notes.length ? "limited" : "good",
    qualityNotes: notes,
    durationS: buf.length / sr,
    voicedPct,
    f0Mean,
    f0Sd,
    f0SdSemitones,
    jitterPct,
    shimmerPct,
    hnrDb,
    peakLevel: peak,
    f0Track,
  };
}

/** Synthesize a sustained vowel with controllable perturbation (for simulation mode). */
export function synthesizeVoice(
  profile: "typical" | "parkinsonian",
  sex: "female" | "male" | "other",
  sr = 44100,
  dur = 5,
): Float32Array {
  const base = sex === "female" ? 205 : sex === "male" ? 118 : 160;
  const p =
    profile === "parkinsonian"
      ? { jit: 0.0075, shim: 0.075, noise: 0.07, trem: 0.018 }
      : { jit: 0.0035, shim: 0.022, noise: 0.012, trem: 0.002 };
  const N = Math.floor(sr * dur);
  const out = new Float32Array(N);
  let pos = 0;
  const f0 = base * (0.96 + Math.random() * 0.08);
  while (pos < N) {
    const t = pos / sr;
    const fNow = f0 * (1 + p.trem * Math.sin(2 * Math.PI * 5 * t) + 0.004 * Math.sin(2 * Math.PI * 0.4 * t));
    const T = (sr / fNow) * (1 + p.jit * gauss());
    const A = 1 + p.shim * gauss();
    const start = Math.round(pos);
    const len = Math.round(T);
    for (let i = 0; i < len && start + i < N; i++) {
      const ph = i / len;
      let v = 0;
      for (let h = 1; h <= 10; h++) v += Math.sin(2 * Math.PI * h * ph) / h ** 1.3;
      out[start + i] += A * v;
    }
    pos += T;
  }
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(out[i]));
  const ramp = Math.round(0.08 * sr);
  for (let i = 0; i < N; i++) {
    const env = Math.min(1, i / ramp, (N - i) / ramp);
    out[i] = (out[i] / peak) * 0.5 * env + p.noise * 0.5 * gauss();
  }
  return out;
}
