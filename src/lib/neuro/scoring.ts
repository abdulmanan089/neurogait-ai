import type { MotorMetrics } from "./motor";
import type { VoiceMetrics } from "./voice";

export type RiskLevel = "Low" | "Moderate" | "Elevated";

type FeatureDef = {
  key: string;
  label: string;
  modality: "motor" | "voice";
  unit: string;
  weight: number;
  normal: number; // value at which concern starts
  abnormal: number; // value at which concern saturates
  higherIsWorse: boolean;
  normText: string;
  get: (m: MotorMetrics | null, v: VoiceMetrics | null) => number | null;
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
];

export type FeatureResult = {
  key: string;
  label: string;
  modality: "motor" | "voice";
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
  features: FeatureResult[];
  coverage: number; // fraction of total weight that was measurable
  confidence: "Standard" | "Reduced";
  confidenceNotes: string[];
};

function concernOf(f: FeatureDef, v: number) {
  const span = f.abnormal - f.normal;
  const raw = (v - f.normal) / span; // span sign handles direction
  return Math.min(1, Math.max(0, raw));
}

export function levelFor(score: number): RiskLevel {
  return score < 30 ? "Low" : score < 55 ? "Moderate" : "Elevated";
}

export function computeRisk(motor: MotorMetrics | null, voice: VoiceMetrics | null): RiskResult {
  const rows = FEATURES.map((f) => {
    const value = f.get(motor, voice);
    const concern = value == null || !Number.isFinite(value) ? 0 : concernOf(f, value);
    return { f, value: value != null && Number.isFinite(value) ? value : null, concern };
  });
  const avail = rows.filter((r) => r.value != null);
  const wSum = avail.reduce((s, r) => s + r.f.weight, 0);
  const score = wSum > 0 ? (avail.reduce((s, r) => s + r.f.weight * r.concern, 0) / wSum) * 100 : 0;
  const mod = (k: "motor" | "voice") => {
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
    display: value == null ? "—" : `${value.toFixed(f.digits)} ${f.unit}`,
    normText: f.normText,
    concern,
    weight: f.weight,
    contribution: value == null || wSum === 0 ? 0 : ((f.weight * concern) / wSum) * 100,
    status: value == null ? "unavailable" : concern === 0 ? "within" : concern < 0.5 ? "borderline" : "outside",
  }));
  const notes: string[] = [];
  if (!motor) notes.push("Motor assessment was not completed.");
  if (!voice) notes.push("Vocal assessment was not completed.");
  if (motor?.quality === "limited") notes.push("Motor recording quality was limited.");
  if (voice?.quality === "limited") notes.push("Voice recording quality was limited.");
  if (motor?.source === "simulation" || voice?.source === "simulation") notes.push("One or more modules used simulated data, not a real recording.");
  const coverage = wSum;
  return {
    score,
    level: levelFor(score),
    motorScore: mod("motor"),
    voiceScore: mod("voice"),
    features,
    coverage,
    confidence: notes.length ? "Reduced" : "Standard",
    confidenceNotes: notes,
  };
}

export function observations(motor: MotorMetrics | null, voice: VoiceMetrics | null, risk: RiskResult): string[] {
  const o: string[] = [];
  const f = Object.fromEntries(risk.features.map((x) => [x.key, x]));
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
    const out = ["jitter", "shimmer", "hnr"].filter((k) => f[k].status === "outside" || f[k].status === "borderline");
    o.push(
      out.length
        ? `Voice perturbation measures outside reference ranges: ${out.map((k) => f[k].label.toLowerCase()).join(", ")}.`
        : "Voice perturbation measures were within reference ranges.",
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
