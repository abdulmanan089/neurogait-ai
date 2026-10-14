// Privacy-first sync: only the final numeric feature vector leaves the browser.
// No video, audio, landmark streams or patient names are ever uploaded.
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "./store";
import type { RiskResult } from "./scoring";
import { motorGate, ocularGate, voiceGate } from "./quality";

export function buildFeatureVector(s: Session, risk: RiskResult) {
  const m = s.motor, v = s.voice, o = s.ocular ?? null;
  const r = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
  return {
    features: {
      motor: m && { tapRate: r(m.tapRate), tapCount: m.tapCount, amplitudeDecayPct: r(m.amplitudeDecayPct), rhythmCV: r(m.rhythmCV), tremorFreqHz: r(m.tremorFreqHz), tremorAmpPct: r(m.tremorAmpPct), tremorBandRatio: r(m.tremorBandRatio) },
      voice: v && { f0Mean: r(v.f0Mean), f0SdSemitones: r(v.f0SdSemitones), jitterPct: r(v.jitterPct), shimmerPct: r(v.shimmerPct), hnrDb: r(v.hnrDb), voicedPct: r(v.voicedPct) },
      ocular: o && { saccadeLatencyMs: r(o.saccadeLatencyMs), saccadeGain: r(o.saccadeGain), pursuitGain: r(o.pursuitGain), catchUpPerSec: r(o.catchUpPerSec), fixationSdDeg: r(o.fixationSdDeg), fixationDriftDegPerS: r(o.fixationDriftDegPerS) },
      contributions: Object.fromEntries(risk.features.map((f) => [f.key, r(f.contribution, 2)])),
    },
    sources: { motor: m?.source ?? null, voice: v?.source ?? null, ocular: o?.source ?? null },
    quality: {
      motor: m ? { gate: motorGate(m).pass, notes: m.qualityNotes } : null,
      voice: v ? { gate: voiceGate(v).pass, notes: v.qualityNotes } : null,
      ocular: o ? { gate: ocularGate(o).pass, notes: o.qualityNotes } : null,
      confidence: risk.confidence,
    },
  };
}

export async function uploadAssessment(s: Session, risk: RiskResult) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const vec = buildFeatureVector(s, risk);
  const age = parseInt(s.patient.age, 10);
  const { error } = await supabase.from("assessments").upsert({
    id: s.id,
    user_id: u.user.id,
    created_at: s.createdAt,
    patient_ref: s.patient.patientId || "",
    age: Number.isFinite(age) ? age : null,
    sex: s.patient.sex,
    sources: vec.sources,
    features: vec.features,
    quality: vec.quality,
    risk_score: Math.round(risk.score * 10) / 10,
    risk_level: risk.level,
  });
  if (error) throw error;
}
