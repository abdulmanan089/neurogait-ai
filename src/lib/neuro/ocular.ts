// @ts-nocheck -- tight numeric DSP loops; array indices are bounds-checked by loop logic.
// Oculomotor analysis: iris-in-eye ratios -> per-session calibrated gaze -> saccade, pursuit and fixation metrics.
import { downsampleSeries, gauss, mean, median, movingAvg, round, std } from "./dsp";

export type OcularPhase = "fixation" | "saccade" | "pursuit";
export type OcularSample = { t: number; phase: OcularPhase; tx: number; rx: number; ry: number; detected: boolean };
export type OcularSimProfile = "typical" | "parkinsonian";
export type FaceLandmark = { x: number; y: number; z?: number };

/** Target units span -1..1 across the stimulus panel; treated as ±15° of visual angle. */
export const DEG_PER_UNIT = 15;
export const PURSUIT_FREQ = 0.35;
export const PURSUIT_AMP = 0.7;
export const SACCADE_AMP = 0.7;

export type OcularMetrics = {
  source: "camera" | "simulation";
  quality: "good" | "limited";
  qualityNotes: string[];
  coverage: number;
  calibrationR2: number;
  saccadeCount: number;
  saccadeLatencyMs: number;
  saccadeLatencySdMs: number;
  saccadeGain: number;
  pursuitGain: number;
  pursuitPeakVelDeg: number;
  catchUpPerSec: number;
  fixationSdDeg: number;
  fixationDriftDegPerS: number;
  intrusionsPerSec: number;
  saccadeSeries: { t: number; target: number; gaze: number | null }[];
  pursuitSeries: { t: number; target: number; gaze: number | null }[];
  fixationSeries: { t: number; gaze: number | null }[];
  latencies: { t: number; ms: number }[];
};

/** Subject-right eye: corners 33/133, iris 468, lids 159/145. Subject-left: 362/263, iris 473, lids 386/374. */
export function faceToEye(lm: FaceLandmark[] | null): { rx: number; ry: number } | null {
  if (!lm || lm.length < 478) return null;
  const ratio = (c1, c2, iris, top, bot) => {
    const w = lm[c2].x - lm[c1].x;
    const h = lm[bot].y - lm[top].y;
    if (Math.abs(w) < 1e-4) return null;
    return { x: (lm[iris].x - lm[c1].x) / w, y: Math.abs(h) < 1e-4 ? 0.5 : (lm[iris].y - lm[top].y) / h, open: Math.abs(h / w) };
  };
  const a = ratio(33, 133, 468, 159, 145);
  const b = ratio(362, 263, 473, 386, 374);
  if (!a || !b) return null;
  if (a.open < 0.09 && b.open < 0.09) return null; // blink
  return { rx: (a.x + b.x) / 2, ry: (a.y + b.y) / 2 };
}

export function buildSaccadePlan(duration: number): { at: number; x: number }[] {
  const seq = [SACCADE_AMP, -SACCADE_AMP, 0, SACCADE_AMP, -SACCADE_AMP, SACCADE_AMP, 0, -SACCADE_AMP, SACCADE_AMP, -SACCADE_AMP, 0, SACCADE_AMP, -SACCADE_AMP];
  const plan: { at: number; x: number }[] = [{ at: 0, x: 0 }];
  let t = 0.8;
  for (const x of seq) {
    if (t > duration - 0.9) break;
    plan.push({ at: t, x });
    t += 1.0 + Math.random() * 0.5;
  }
  return plan;
}

export function targetAt(plan: { at: number; x: number }[], t: number) {
  let x = 0;
  for (const p of plan) if (p.at <= t) x = p.x;
  return x;
}

export function pursuitTarget(t: number) {
  return PURSUIT_AMP * Math.sin(2 * Math.PI * PURSUIT_FREQ * t);
}

/** Simulated eye: emits raw iris ratios that go through the same analyzer as camera data. */
export function createEyeSimulator(profile: OcularSimProfile) {
  const pd = profile === "parkinsonian";
  const P = pd
    ? { lat: 0.29, latSd: 0.06, gainS: 0.78, gainP: 0.68, noise: 0.16, drift: 0.35, swj: 0.9 }
    : { lat: 0.205, latSd: 0.025, gainS: 0.95, gainP: 0.92, noise: 0.08, drift: 0.1, swj: 0.12 };
  let g = 0;
  let lastT = 0;
  let lastTx = 0;
  let sac: { t0: number; from: number; to: number; dur: number } | null = null;
  let pending: { at: number; gain: number; corrective: boolean } | null = null;
  let swj: { back: number; off: number } | null = null;
  let drift = 0;
  const unitNoise = () => (P.noise / DEG_PER_UNIT) * gauss();
  return (t: number, tx: number, phase: OcularPhase | "idle") => {
    const dt = Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    const vt = dt > 0 ? (tx - lastTx) / dt : 0;
    const jumped = Math.abs(tx - lastTx) > 0.2;
    lastTx = tx;
    if (jumped && phase !== "pursuit") {
      pending = { at: t + Math.max(0.12, P.lat + P.latSd * gauss()), gain: P.gainS, corrective: false };
    }
    if (sac) {
      const f = Math.min(1, (t - sac.t0) / sac.dur);
      g = sac.from + (sac.to - sac.from) * (0.5 - 0.5 * Math.cos(Math.PI * f));
      if (f >= 1) {
        sac = null;
        if (phase !== "pursuit" && Math.abs(tx - g) > 0.015) pending = { at: t + 0.13 + 0.05 * Math.random(), gain: 1, corrective: true };
      }
    } else {
      if (phase === "pursuit") {
        g += P.gainP * vt * dt;
        if (!pending && Math.abs(tx - g) > 0.09) pending = { at: t + 0.12, gain: 1.05, corrective: true };
      } else {
        drift += (P.drift / DEG_PER_UNIT) * gauss() * Math.sqrt(dt) - drift * 0.5 * dt;
        if (!swj && !pending && Math.random() < P.swj * dt && phase === "fixation") {
          const off = (pd ? 1.1 : 0.6) / DEG_PER_UNIT * (Math.random() < 0.5 ? -1 : 1);
          swj = { back: t + 0.2 + 0.1 * Math.random(), off };
          g += off;
        }
        if (swj && t >= swj.back) {
          g -= swj.off;
          swj = null;
        }
      }
      if (pending && t >= pending.at) {
        const to = phase === "pursuit" ? tx + vt * 0.05 : g + (tx - g) * pending.gain;
        const ampDeg = Math.abs(to - g) * DEG_PER_UNIT;
        sac = { t0: t, from: g, to, dur: 0.025 + 0.0024 * ampDeg };
        pending = null;
      }
    }
    const shown = g + drift + unitNoise();
    return { rx: 0.5 - 0.11 * shown, ry: 0.5 + 0.01 * gauss() };
  };
}

function linfit(x: number[], y: number[]) {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  const b = sxx > 0 ? sxy / sxx : 0;
  const r2 = sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  return { a: my - b * mx, b, r2 };
}

export function analyzeOcular(samples: OcularSample[], source: "camera" | "simulation"): OcularMetrics {
  const notes: string[] = [];
  const det = samples.filter((s) => s.detected);
  const coverage = samples.length ? det.length / samples.length : 0;

  // --- Calibration from settled saccade-phase samples (target held >= 0.45 s) ---
  const sac = samples.filter((s) => s.phase === "saccade");
  const jumps: { t: number; from: number; to: number }[] = [];
  for (let i = 1; i < sac.length; i++) if (Math.abs(sac[i].tx - sac[i - 1].tx) > 0.2) jumps.push({ t: sac[i].t, from: sac[i - 1].tx, to: sac[i].tx });
  const lastJumpBefore = (t: number) => {
    let j = sac.length ? sac[0].t - 10 : 0;
    for (const x of jumps) if (x.t <= t) j = x.t;
    return j;
  };
  const cx: number[] = [], cy: number[] = [];
  for (const s of sac) if (s.detected && s.t - lastJumpBefore(s.t) >= 0.45) { cx.push(s.tx); cy.push(s.rx); }
  const fixRaw = samples.filter((s) => s.phase === "fixation" && s.detected).map((s) => s.rx);
  let fit = cx.length >= 12 ? linfit(cx, cy) : { a: fixRaw.length ? median(fixRaw) : 0.5, b: -0.11, r2: 0 };
  if (Math.abs(fit.b) < 0.01) {
    notes.push("Eye movement range was too small to calibrate; a default eye-to-screen mapping was used.");
    fit = { a: fit.a, b: -0.11, r2: fit.r2 };
  } else if (fit.r2 < 0.4) notes.push("Gaze followed the target only loosely during calibration; metrics may be unreliable.");
  const toUnits = (rx: number) => (rx - fit.a) / fit.b;

  const calib = (arr: OcularSample[]) => {
    const g = arr.map((s) => (s.detected ? toUnits(s.rx) : NaN));
    // fill gaps (blinks) by holding last value for smoothing, keep NaN mask for display
    const filled: number[] = [];
    let last = 0;
    for (const v of g) { if (Number.isFinite(v)) last = v; filled.push(last); }
    return { raw: g, smooth: movingAvg(filled, 3) };
  };

  // --- Saccades ---
  const sc = calib(sac);
  const lat: { t: number; ms: number }[] = [];
  const gains: number[] = [];
  for (const j of jumps) {
    const d = j.to - j.from;
    const i0 = sac.findIndex((s) => s.t >= j.t);
    if (i0 < 0) continue;
    const pre = [];
    for (let i = i0 - 1; i >= 0 && sac[i].t >= j.t - 0.15; i--) if (sac[i].detected) pre.push(sc.smooth[i]);
    if (pre.length < 2) continue;
    const g0 = mean(pre);
    let hit = -1;
    for (let i = i0; i < sac.length && sac[i].t <= j.t + 0.8; i++) {
      if (!sac[i].detected) continue;
      if ((sc.smooth[i] - g0) * Math.sign(d) > 0.3 * Math.abs(d) && sac[i].t >= j.t + 0.06) { hit = i; break; }
    }
    if (hit < 1) continue;
    const a = (sc.smooth[hit - 1] - g0) * Math.sign(d);
    const b = (sc.smooth[hit] - g0) * Math.sign(d);
    const thr = 0.3 * Math.abs(d);
    const f = b - a > 1e-6 ? Math.min(1, Math.max(0, (thr - a) / (b - a))) : 1;
    const tc = sac[hit - 1].t + f * (sac[hit].t - sac[hit - 1].t);
    const l = tc - j.t - 0.012; // remove ~half the rise to 30 % of amplitude
    if (l < 0.08 || l > 0.7) continue;
    lat.push({ t: round(j.t, 2), ms: round(l * 1000, 0) });
    const post = [];
    for (let i = hit; i < sac.length && sac[i].t <= tc + 0.2; i++) if (sac[i].detected && sac[i].t >= tc + 0.06) post.push(sc.raw[i]);
    if (post.length) gains.push((mean(post) - g0) / d);
  }
  if (lat.length < 4) notes.push(`Only ${lat.length} saccades could be timed reliably.`);

  // --- Smooth pursuit (velocity gain, catch-up saccades removed) ---
  const pur = samples.filter((s) => s.phase === "pursuit");
  const pc = calib(pur);
  let num = 0, den = 0, catchUps = 0;
  const tStart = pur.length ? pur[0].t + 1 : 0;
  const vg = new Array(pur.length).fill(NaN), vt = new Array(pur.length).fill(NaN), cu = new Array(pur.length).fill(false);
  for (let i = 1; i < pur.length - 1; i++) {
    if (pur[i].t < tStart || !pur[i - 1].detected || !pur[i + 1].detected) continue;
    const dt = pur[i + 1].t - pur[i - 1].t;
    if (dt <= 0) continue;
    vg[i] = (pc.smooth[i + 1] - pc.smooth[i - 1]) / dt;
    vt[i] = (pur[i + 1].tx - pur[i - 1].tx) / dt;
    cu[i] = Math.abs(vg[i] - vt[i]) > 0.8;
  }
  for (let i = 0; i < pur.length; i++) if (cu[i] && !cu[i - 1]) catchUps++;
  for (let i = 0; i < pur.length; i++) {
    if (!Number.isFinite(vg[i])) continue;
    let near = false;
    for (let k = -2; k <= 2; k++) if (cu[i + k]) near = true;
    if (near) continue;
    num += vg[i] * vt[i];
    den += vt[i] * vt[i];
  }
  const pursuitDur = pur.length ? Math.max(0.1, pur[pur.length - 1].t - tStart) : 0;
  const pursuitGain = den > 0 ? Math.max(0, num / den) : 0;
  if (den === 0 && pur.length) notes.push("Smooth pursuit could not be measured.");

  // --- Fixation stability ---
  const fix = samples.filter((s) => s.phase === "fixation");
  const fc = calib(fix);
  const f0 = fix.length ? fix[0].t + 1 : 0;
  const ft: number[] = [], fg: number[] = [];
  fix.forEach((s, i) => { if (s.t >= f0 && Number.isFinite(fc.raw[i])) { ft.push(s.t); fg.push(fc.smooth[i] * DEG_PER_UNIT); } });
  const dfit = ft.length > 5 ? linfit(ft, fg) : { a: 0, b: 0, r2: 0 };
  const resid = fg.map((v, i) => v - (dfit.a + dfit.b * ft[i]));
  let intr = 0, out = false;
  const med = resid.length ? median(resid) : 0;
  for (const r of resid) { const o = Math.abs(r - med) > 0.8; if (o && !out) intr++; out = o; }
  const fixDur = ft.length ? Math.max(0.1, ft[ft.length - 1] - ft[0]) : 0;

  if (coverage < 0.75) notes.push(`Eyes were tracked in ${(coverage * 100).toFixed(0)}% of frames (blinks or face out of view).`);

  const series = (arr: OcularSample[], c: { raw: number[] }, t0: number) =>
    downsampleSeries(arr.map((s, i) => ({ t: round(s.t - t0, 2), target: round(s.tx * DEG_PER_UNIT, 2), gaze: Number.isFinite(c.raw[i]) ? round(c.raw[i] * DEG_PER_UNIT, 2) : null })), 420);

  return {
    source,
    quality: notes.length ? "limited" : "good",
    qualityNotes: notes,
    coverage,
    calibrationR2: round(fit.r2, 2),
    saccadeCount: lat.length,
    saccadeLatencyMs: lat.length ? median(lat.map((l) => l.ms)) : 0,
    saccadeLatencySdMs: lat.length > 1 ? std(lat.map((l) => l.ms)) : 0,
    saccadeGain: gains.length ? median(gains) : 0,
    pursuitGain,
    pursuitPeakVelDeg: pursuitGain * PURSUIT_AMP * 2 * Math.PI * PURSUIT_FREQ * DEG_PER_UNIT,
    catchUpPerSec: pursuitDur ? catchUps / pursuitDur : 0,
    fixationSdDeg: resid.length > 5 ? std(resid) : 0,
    fixationDriftDegPerS: Math.abs(dfit.b),
    intrusionsPerSec: fixDur ? intr / fixDur : 0,
    saccadeSeries: series(sac, sc, sac[0]?.t ?? 0),
    pursuitSeries: series(pur, pc, pur[0]?.t ?? 0),
    fixationSeries: downsampleSeries(fix.map((s, i) => ({ t: round(s.t - (fix[0]?.t ?? 0), 2), gaze: Number.isFinite(fc.raw[i]) ? round(fc.raw[i] * DEG_PER_UNIT, 2) : null })), 300),
    latencies: lat,
  };
}

/** Running calibration used only for the live chart (the final analysis recalibrates on all data). */
export function liveMapper(samples: OcularSample[]): (rx: number) => number {
  const cx: number[] = [], cy: number[] = [];
  let lastJ = -10, prev = null;
  for (const s of samples) {
    if (s.phase !== "saccade") continue;
    if (prev && Math.abs(s.tx - prev.tx) > 0.2) lastJ = s.t;
    prev = s;
    if (s.detected && s.t - lastJ >= 0.45) { cx.push(s.tx); cy.push(s.rx); }
  }
  let fit = cx.length >= 12 ? linfit(cx, cy) : null;
  if (!fit || Math.abs(fit.b) < 0.01) {
    const fx = samples.filter((s) => s.phase === "fixation" && s.detected).map((s) => s.rx);
    fit = { a: fx.length ? median(fx) : 0.5, b: -0.11, r2: 0 };
  }
  return (rx) => ((rx - fit.a) / fit.b) * DEG_PER_UNIT;
}
