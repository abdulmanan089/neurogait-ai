import type { MotorMetrics } from "./motor";
import type { VoiceMetrics } from "./voice";
import type { OcularMetrics } from "./ocular";

export type Modality = "motor" | "voice" | "ocular";

export type RiskLevel = "Low" | "Moderate" | "Elevated";

type FeatureDef = {
  key: string;
  label: string;
  modality: Modality;
  unit: string;
  weight: number;
  normal: number; // value at which concern starts
  abnormal: number; // value at which concern saturates
  higherIsWorse: boolean;
  normText: string;
  get: (m: MotorMetrics | null, v: VoiceMetrics | null, o: OcularMetrics | null) => number | null;
  digits: number;
};

export const FEATURES: FeatureDef[] = [
  { key: "tapRate", label: "Finger-tapping speed", modality: "motor", unit: "taps/s", weight: 0.17, normal: 3.0, abnormal: 1.5, higherIsWorse: false, normText: "≥ 3.0 taps/s", digits: 2, get: (m) => (m && m.tapCount >= 2 ? m.tapRate : null) },
  { key: "decay", label: "Tapping amplitude decrement", modality: "motor", unit: "%", weight: 0.15, normal: 15, abnormal: 45, higherIsWorse: true, normText: "≤ 15 %", digits: 1, get: (m) => (m && m.tapCount >= 4 ? m.amplitudeDecayPct : null) },
  { key: "rhythm", label: "Tapping rhythm variability (CV)", modality: "motor", unit: "%", weight: 0.1, normal: 15, abnormal: 40, higherIsWorse: true, normText: "≤ 15 %", digits: 1, get: (m) => (m && m.tapCount >= 4 ? m.rhythmCV : null) },
  { key: "tremor", label: "Rest tremor power (3–7 Hz)", modality: "motor", unit: "% hand", weight: 0.18, normal: 0.6, abnormal: 2.0, higherIsWorse: true, normText: "≤ 0.6 % of hand size", digits: 2, get: (m) => (m && m.restSeries.length ? m.tremorAmpPct : null) },
  { key: "jitter", label: "Jitter (local)", modality: "voice", unit: "%", weight: 0.14, normal: 1.04, abnormal: 2.5, higherIsWorse: true, normText: "≤ 1.04 %", digits: 2, get: (_m, v) => (v && v.jitterPct > 0 ? v.jitterPct : null) },
  { key: "shimmer", label: "Shimmer (local)", modality: "voice", unit: "%", weight: 0.12, normal: 3.81, abnormal: 8, higherIsWorse: true, normText: "≤ 3.81 %", digits: 2, get: (_m, v) => (v && v.shimmerPct > 0 ? v.shimmerPct : null) },
  { key: "hnr", label: "Harmonics-to-noise ratio", modality: "voice", unit: "dB", weight: 0.1, normal: 20, abnormal: 12, higherIsWorse: false, normText: "≥ 20 dB", digits: 1, get: (_m, v) => (v && v.voicedPct > 0 ? v.hnrDb : null) },
  { key: "f0sd", label: "Pitch stability (F0 SD)", modality: "voice", unit: "st", weight: 0.04, normal: 0.5, abnormal: 1.5, higherIsWorse: true, normText: "≤ 0.5 semitones", digits: 2, get: (_m, v) => (v && v.voicedPct > 0 ? v.f0SdSemitones : null) },
  { key: "latency", label: "Saccadic latency", modality: "ocular", unit: "ms", weight: 0.12, normal: 250, abnormal: 400, higherIsWorse: true, normText: "≈ 180–250 ms", digits: 0, get: (_m, _v, o) => (o && o.saccadeCount >= 3 ? o.saccadeLatencyMs : null) },
  { key: "pursuit", label: "Smooth-pursuit gain", modality: "ocular", unit: "", weight: 0.1, normal: 0.85, abnormal: 0.55, higherIsWorse: false, normText: "≥ 0.85", digits: 2, get: (_m, _v, o) => (o && o.pursuitGain > 0 ? o.pursuitGain : null) },
  { key: "fixation", label: "Fixation instability (SD)", modality: "ocular", unit: "°", weight: 0.06, normal: 0.4, abnormal: 1.2, higherIsWorse: true, normText: "≤ 0.4°", digits: 2, get: (_m, _v, o) => (o && o.fixationSdDeg > 0 ? o.fixationSdDeg : null) },
];

export type FeatureResult = {
  key: string;
  label: string;
  modality: Modality;
  unit: string;
  value: number | null;
  display: string;
  normText: string;
  concern: number; // 0..1
  weight: number;
  contribution: number; // share of total score points (0..100)
  status: "within" | "borderline" | "outside" | "unavailable";
};

export type RiskResult = {
  score: number; // 0..100
  level: RiskLevel;
  motorScore: number | null;
  voiceScore: number | null;
  ocularScore: number | null;
  features: FeatureResult[];
  coverage: number; // fraction of total weight that was measurable
  confidence: "Standard" | "Reduced";
  confidenceNotes: string[];
  engine?: "heuristic" | "ml"; // set to "ml" when the optional XGBoost backend scored the session
  mlClass?: string;
};

function concernOf(f: FeatureDef, v: number) {
  const span = f.abnormal - f.normal;
  const raw = (v - f.normal) / span; // span sign handles direction
  return Math.min(1, Math.max(0, raw));
}

export function levelFor(score: number): RiskLevel {
  return score < 30 ? "Low" : score < 55 ? "Moderate" : "Elevated";
}

export function computeRisk(motor: MotorMetrics | null, voice: VoiceMetrics | null, ocular: OcularMetrics | null = null): RiskResult {
  const rows = FEATURES.map((f) => {
    const value = f.get(motor, voice, ocular);
    const concern = value == null || !Number.isFinite(value) ? 0 : concernOf(f, value);
    return { f, value: value != null && Number.isFinite(value) ? value : null, concern };
  });
  const avail = rows.filter((r) => r.value != null);
  const wSum = avail.reduce((s, r) => s + r.f.weight, 0);
  const score = wSum > 0 ? (avail.reduce((s, r) => s + r.f.weight * r.concern, 0) / wSum) * 100 : 0;
  const mod = (k: Modality) => {
    const a = avail.filter((r) => r.f.modality === k);
    const w = a.reduce((s, r) => s + r.f.weight, 0);
    return w > 0 ? (a.reduce((s, r) => s + r.f.weight * r.concern, 0) / w) * 100 : null;
  };
  const features: FeatureResult[] = rows.map(({ f, value, concern }) => ({
    key: f.key,
    label: f.label,
    modality: f.modality,
    unit: f.unit,
    value,
    display: value == null ? "—" : `${value.toFixed(f.digits)}${f.unit ? (f.unit === "°" ? "°" : ` ${f.unit}`) : ""}`,
    normText: f.normText,
    concern,
    weight: f.weight,
    contribution: value == null || wSum === 0 ? 0 : ((f.weight * concern) / wSum) * 100,
    status: value == null ? "unavailable" : concern === 0 ? "within" : concern < 0.5 ? "borderline" : "outside",
  }));
  const notes: string[] = [];
  if (!motor) notes.push("Motor assessment was not completed.");
  if (!voice) notes.push("Vocal assessment was not completed.");
  if (!ocular) notes.push("Oculomotor assessment was not completed.");
  if (ocular?.quality === "limited") notes.push("Eye-tracking quality was limited.");
  if (motor?.quality === "limited") notes.push("Motor recording quality was limited.");
  if (voice?.quality === "limited") notes.push("Voice recording quality was limited.");
  if (motor?.source === "simulation" || voice?.source === "simulation" || ocular?.source === "simulation") notes.push("One or more modules used simulated data, not a real recording.");
  const coverage = wSum;
  return {
    score,
    level: levelFor(score),
    motorScore: mod("motor"),
    voiceScore: mod("voice"),
    ocularScore: mod("ocular"),
    features,
    coverage,
    confidence: notes.length ? "Reduced" : "Standard",
    confidenceNotes: notes,
  };
}

export function observations(motor: MotorMetrics | null, voice: VoiceMetrics | null, risk: RiskResult, ocular: OcularMetrics | null = null): string[] {
  const o: string[] = [];
  const blank: FeatureResult = { key: "", label: "", modality: "motor", unit: "", value: null, display: "—", normText: "", concern: 0, weight: 0, contribution: 0, status: "unavailable" };
  const get = (k: string) => risk.features.find((x) => x.key === k) ?? blank;
  const f = { tapRate: get("tapRate"), decay: get("decay"), tremor: get("tremor"), jitter: get("jitter"), shimmer: get("shimmer"), hnr: get("hnr") };
  if (motor) {
    if (f.tapRate.status === "unavailable") o.push("Finger-tapping speed could not be measured.");
    else
      o.push(
        `Finger tapping averaged ${motor.tapRate.toFixed(2)} taps per second over ${motor.tapCount} taps${f.tapRate.status === "within" ? ", within the reference range." : ", which is slower than the reference range."}`,
      );
    if (f.decay.value != null)
      o.push(
        f.decay.status === "within"
          ? `Tap amplitude was well sustained (${motor.amplitudeDecayPct.toFixed(1)}% change from first to last taps).`
          : `Tap amplitude decreased by ${motor.amplitudeDecayPct.toFixed(1)}% across the trial, a pattern consistent with a sequence effect (decrement).`,
      );
    if (f.tremor.value != null)
      o.push(
        f.tremor.status === "within"
          ? `No meaningful rest tremor was detected in the 3–7 Hz band (${motor.tremorAmpPct.toFixed(2)}% of hand size).`
          : `Rhythmic rest oscillation was detected, peaking at ${motor.tremorFreqHz.toFixed(1)} Hz with ${motor.tremorAmpPct.toFixed(2)}% of hand-size amplitude.`,
      );
  }
  if (voice) {
    o.push(
      `Sustained phonation: mean F0 ${voice.f0Mean.toFixed(1)} Hz, jitter ${voice.jitterPct.toFixed(2)}%, shimmer ${voice.shimmerPct.toFixed(2)}%, HNR ${voice.hnrDb.toFixed(1)} dB.`,
    );
    const out = [f.jitter, f.shimmer, f.hnr].filter((x) => x.status === "outside" || x.status === "borderline");
    o.push(
      out.length
        ? `Voice perturbation measures outside reference ranges: ${out.map((x) => x.label.toLowerCase()).join(", ")}.`
        : "Voice perturbation measures were within reference ranges.",
    );
  }
  if (ocular) {
    const lat = get("latency"), pur = get("pursuit"), fix = get("fixation");
    o.push(
      lat.value != null
        ? `Median saccadic latency was ${ocular.saccadeLatencyMs.toFixed(0)} ms over ${ocular.saccadeCount} saccades (gain ${ocular.saccadeGain.toFixed(2)})${lat.status === "within" ? ", within the typical range." : ", which is slower than the typical 180–250 ms range."}`
        : "Saccadic latency could not be measured reliably.",
    );
    if (pur.value != null)
      o.push(
        pur.status === "within"
          ? `Smooth pursuit was accurate (gain ${ocular.pursuitGain.toFixed(2)}, ${ocular.catchUpPerSec.toFixed(1)} catch-up saccades/s).`
          : `Smooth pursuit gain was reduced to ${ocular.pursuitGain.toFixed(2)} with ${ocular.catchUpPerSec.toFixed(1)} catch-up saccades per second, a "saccadic pursuit" pattern.`,
      );
    if (fix.value != null)
      o.push(
        fix.status === "within"
          ? `Central fixation was stable (SD ${ocular.fixationSdDeg.toFixed(2)}°).`
          : `Fixation was unstable (SD ${ocular.fixationSdDeg.toFixed(2)}°, ${ocular.intrusionsPerSec.toFixed(1)} intrusions/s), consistent with square-wave jerks or drift.`,
      );
  }
  o.push(
    risk.level === "Low"
      ? "Overall screening pattern does not suggest further action beyond routine care."
      : risk.level === "Moderate"
        ? "Some measures fell outside reference ranges. Consider repeating the screen and clinical review if symptoms are present."
        : "Several measures fell outside reference ranges. Referral for a specialist neurological evaluation is suggested.",
  );
  return o;
}
