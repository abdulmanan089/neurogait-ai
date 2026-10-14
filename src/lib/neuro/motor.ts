// @ts-nocheck -- tight numeric DSP loops; array indices are bounds-checked by loop logic (noUncheckedIndexedAccess would add noise only).
import { clamp, dftPower, downsampleSeries, gauss, mean, movingAvg, resampleUniform, std } from "./dsp";

export type Landmark = { x: number; y: number; z?: number };
export type MotorPhase = "rest" | "tap";
export type MotorSample = {
  t: number;
  phase: MotorPhase;
  detected: boolean;
  d: number; // thumb–index aperture / hand size
  tx: number; // index tip x / hand size
  ty: number; // index tip y / hand size
};

export type MotorMetrics = {
  source: "camera" | "simulation";
  quality: "good" | "limited";
  qualityNotes: string[];
  restCoverage: number;
  tapCoverage: number;
  tapCount: number;
  tapRate: number; // taps per second
  meanAmplitude: number; // hand-size units
  amplitudeDecayPct: number;
  rhythmCV: number; // % coefficient of variation of inter-tap intervals
  tremorFreqHz: number;
  tremorAmpPct: number; // 3–7 Hz band RMS, % of hand size
  tremorBandRatio: number; // power 3–7 Hz / power 1–12 Hz
  tapSeries: { t: number; d: number }[];
  tapPeaks: { t: number; amp: number }[];
  restSeries: { t: number; x: number; y: number }[];
  spectrum: { f: number; a: number }[];
};

export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);

export function landmarksToSample(lm: Landmark[], t: number, phase: MotorPhase): MotorSample {
  const hs = dist(lm[0], lm[9]) || 1e-6;
  return { t, phase, detected: true, d: dist(lm[4], lm[8]) / hs, tx: lm[8].x / hs, ty: lm[8].y / hs };
}

const FS = 30;

export function analyzeMotor(samples: MotorSample[], source: MotorMetrics["source"]): MotorMetrics {
  const rest = samples.filter((s) => s.phase === "rest");
  const tap = samples.filter((s) => s.phase === "tap");
  const cov = (a: MotorSample[]) => (a.length ? a.filter((s) => s.detected).length / a.length : 0);
  const restCoverage = cov(rest);
  const tapCoverage = cov(tap);
  const restD = rest.filter((s) => s.detected);
  const tapD = tap.filter((s) => s.detected);
  const notes: string[] = [];

  // ---- Rest tremor (3–7 Hz band) ----
  let tremorFreqHz = 0;
  let tremorAmpPct = 0;
  let tremorBandRatio = 0;
  let spectrum: { f: number; a: number }[] = [];
  let restSeries: MotorMetrics["restSeries"] = [];
  if (restD.length >= FS * 3) {
    const tt = restD.map((s) => s.t);
    const rx = resampleUniform(tt, restD.map((s) => s.tx), FS);
    const ry = resampleUniform(tt, restD.map((s) => s.ty), FS);
    const hp = (v: number[]) => {
      const lp = movingAvg(v, Math.round(FS / 2));
      return v.map((x, i) => x - lp[i]);
    };
    const hx = hp(rx.v);
    const hy = hp(ry.v);
    const N = Math.min(hx.length, hy.length);
    const px = dftPower(hx.slice(0, N));
    const py = dftPower(hy.slice(0, N));
    let band = 0;
    let broad = 0;
    let best = 0;
    for (let k = 1; k < px.length; k++) {
      const f = (k * FS) / N;
      const p = px[k] + py[k];
      if (f >= 1 && f <= 12) broad += p;
      if (f >= 3 && f <= 7) {
        band += p;
        if (p > best) {
          best = p;
          tremorFreqHz = f;
        }
      }
      if (f >= 0.5 && f <= 12) spectrum.push({ f: Math.round(f * 100) / 100, a: (Math.sqrt(2 * p) / N) * 100 });
    }
    tremorAmpPct = (Math.sqrt(2 * band) / N) * 100;
    tremorBandRatio = broad > 0 ? band / broad : 0;
    const x0 = rx.t[0];
    restSeries = downsampleSeries(
      hx.slice(0, N).map((x, i) => ({ t: Math.round((rx.t[i] - x0) * 100) / 100, x: x * 100, y: hy[i] * 100 })),
      240,
    );
  } else {
    notes.push("Hand was not tracked long enough during the rest phase to estimate tremor.");
  }
  spectrum = spectrum.map((s) => ({ ...s, a: Math.round(s.a * 1000) / 1000 }));

  // ---- Finger tapping ----
  let tapCount = 0;
  let tapRate = 0;
  let meanAmplitude = 0;
  let amplitudeDecayPct = 0;
  let rhythmCV = 0;
  let tapSeries: MotorMetrics["tapSeries"] = [];
  const tapPeaks: MotorMetrics["tapPeaks"] = [];
  if (tapD.length >= FS * 3) {
    const r = resampleUniform(tapD.map((s) => s.t), tapD.map((s) => s.d), FS);
    const v = movingAvg(r.v, 3);
    const m = mean(v);
    const sd = std(v);
    const hi = m + 0.15 * sd;
    const lo = m - 0.15 * sd;
    let above = false;
    let segMax = -Infinity;
    let segMaxI = 0;
    let troughMin = Infinity;
    const amps: number[] = [];
    const times: number[] = [];
    for (let i = 0; i < v.length; i++) {
      const x = v[i];
      if (!above) {
        troughMin = Math.min(troughMin, x);
        if (x > hi) {
          above = true;
          segMax = x;
          segMaxI = i;
        }
      } else {
        if (x > segMax) {
          segMax = x;
          segMaxI = i;
        }
        if (x < lo) {
          above = false;
          const amp = segMax - (Number.isFinite(troughMin) ? troughMin : lo);
          amps.push(amp);
          times.push(r.t[segMaxI]);
          troughMin = x;
        }
      }
    }
    const t0 = r.t[0];
    tapCount = amps.length;
    if (tapCount >= 2) tapRate = (tapCount - 1) / Math.max(0.1, times[tapCount - 1] - times[0]);
    meanAmplitude = mean(amps);
    if (tapCount >= 4) {
      const k = tapCount >= 9 ? 3 : Math.floor(tapCount / 2);
      const first = mean(amps.slice(0, k));
      const last = mean(amps.slice(-k));
      amplitudeDecayPct = first > 0 ? clamp(((first - last) / first) * 100, -100, 100) : 0;
      const intervals = times.slice(1).map((t, i) => t - times[i]);
      rhythmCV = mean(intervals) > 0 ? (std(intervals) / mean(intervals)) * 100 : 0;
    } else {
      notes.push("Fewer than four taps were detected, so decay and rhythm could not be estimated reliably.");
    }
    times.forEach((t, i) => tapPeaks.push({ t: Math.round((t - t0) * 100) / 100, amp: Math.round(amps[i] * 1000) / 1000 }));
    tapSeries = downsampleSeries(
      v.map((d, i) => ({ t: Math.round((r.t[i] - t0) * 100) / 100, d: Math.round(d * 1000) / 1000 })),
      300,
    );
  } else {
    notes.push("Hand was not tracked long enough during the tapping phase.");
  }

  if (restCoverage < 0.7 || tapCoverage < 0.7) notes.push("Hand tracking dropped out for part of the test; consider repeating with better lighting.");

  return {
    source,
    quality: notes.length ? "limited" : "good",
    qualityNotes: notes,
    restCoverage,
    tapCoverage,
    tapCount,
    tapRate,
    meanAmplitude,
    amplitudeDecayPct,
    rhythmCV,
    tremorFreqHz,
    tremorAmpPct,
    tremorBandRatio,
    tapSeries,
    tapPeaks,
    restSeries,
    spectrum,
  };
}

// ---------------- Simulation ----------------

export type SimProfile = "typical" | "parkinsonian";

const TEMPLATE: [number, number][] = [
  [0.5, 0.85],
  [0.42, 0.78], [0.36, 0.7], [0.32, 0.62], [0.29, 0.55],
  [0.44, 0.55], [0.42, 0.44], [0.41, 0.37], [0.4, 0.3],
  [0.5, 0.53], [0.5, 0.41], [0.5, 0.33], [0.5, 0.26],
  [0.56, 0.55], [0.57, 0.44], [0.58, 0.37], [0.58, 0.31],
  [0.61, 0.59], [0.63, 0.51], [0.65, 0.45], [0.66, 0.4],
];
const CLOSED: Record<number, [number, number]> = {
  3: [0.33, 0.6],
  4: [0.355, 0.505],
  6: [0.41, 0.47],
  7: [0.385, 0.47],
  8: [0.36, 0.5],
};

/** Stateful synthetic hand generator producing MediaPipe-shaped landmarks. */
export function createHandSimulator(profile: SimProfile) {
  const p =
    profile === "parkinsonian"
      ? { f: 2.3, decay: 0.55, irr: 0.35, trA: 0.009, trF: 5.0, noise: 0.0012 }
      : { f: 4.3, decay: 0.08, irr: 0.07, trA: 0.0006, trF: 9.5, noise: 0.0012 };
  let phi = 0;
  let lastT = -1;
  let tapStart = -1;
  let trPhase = Math.random() * 6;
  return (t: number, phase: MotorPhase | "idle"): Landmark[] => {
    const dt = lastT < 0 ? 0 : Math.max(0, t - lastT);
    lastT = t;
    let open = 1;
    if (phase === "tap") {
      if (tapStart < 0) {
        tapStart = t;
        phi = 0;
      }
      const tau = t - tapStart;
      phi += p.f * dt * Math.max(0.2, 1 + p.irr * gauss() * 0.6);
      const a = Math.max(0.15, 1 - (p.decay * tau) / 10);
      open = a * (0.5 - 0.5 * Math.cos(2 * Math.PI * phi));
    } else {
      tapStart = -1;
    }
    trPhase += 2 * Math.PI * p.trF * dt;
    const drift = 1 + 0.15 * Math.sin(t * 0.7);
    const tx = p.trA * drift * Math.sin(trPhase);
    const ty = p.trA * 0.6 * drift * Math.cos(trPhase * 1.03);
    return TEMPLATE.map(([x, y], i) => {
      let px = x;
      let py = y;
      const c = CLOSED[i];
      if (c) {
        px = c[0] + (x - c[0]) * open;
        py = c[1] + (y - c[1]) * open;
      }
      return { x: px + tx + p.noise * gauss() * 0.5, y: py + ty + p.noise * gauss() * 0.5 };
    });
  };
}
