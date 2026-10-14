// Quality control: live capture checks (lighting, framing) and post-capture submission gates.
// Live inputs must pass these gates before results can be submitted; simulated inputs always pass.
import type { MotorMetrics } from "./motor";
import type { VoiceMetrics } from "./voice";
import type { OcularMetrics } from "./ocular";

export type Check = { id: string; label: string; ok: boolean; hint: string };
export type Gate = { pass: boolean; issues: string[] };

/** Mean luma (0-255) of a video frame, sampled on a tiny canvas so it costs < 0.1 ms. */
export function frameBrightness(video: HTMLVideoElement, scratch: HTMLCanvasElement): number | null {
  if (video.readyState < 2 || !video.videoWidth) return null;
  scratch.width = 32;
  scratch.height = 24;
  const g = scratch.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(video, 0, 0, 32, 24);
  const d = g.getImageData(0, 0, 32, 24).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0);
  return s / (d.length / 4);
}

export const LIGHT_MIN = 60;
export const LIGHT_MAX = 225;

export function lightingCheck(luma: number | null): Check {
  if (luma == null) return { id: "light", label: "Lighting", ok: false, hint: "Waiting for camera image…" };
  if (luma < LIGHT_MIN) return { id: "light", label: "Lighting", ok: false, hint: "Too dark — face a window or turn on a light." };
  if (luma > LIGHT_MAX) return { id: "light", label: "Lighting", ok: false, hint: "Overexposed — avoid bright light behind or directly into the camera." };
  return { id: "light", label: "Lighting", ok: true, hint: "Even lighting detected." };
}

/** True when every landmark sits inside the frame with a small margin (i.e. not cut off / occluded by the edge). */
export function insideFrame(lm: { x: number; y: number }[] | null, margin = 0.03): boolean {
  if (!lm || !lm.length) return false;
  return lm.every((p) => p.x > margin && p.x < 1 - margin && p.y > margin && p.y < 1 - margin);
}

// --- Post-capture submission gates (live data only) ---

export function motorGate(m: MotorMetrics | null): Gate {
  if (!m || m.source === "simulation") return { pass: !!m, issues: [] };
  const issues: string[] = [];
  if (m.restCoverage < 0.7) issues.push(`Hand was tracked in only ${(m.restCoverage * 100).toFixed(0)}% of the rest phase (needs 70%).`);
  if (m.tapCoverage < 0.7) issues.push(`Hand was tracked in only ${(m.tapCoverage * 100).toFixed(0)}% of the tapping phase (needs 70%).`);
  if (m.tapCount < 4) issues.push(`Only ${m.tapCount} taps were detected (needs at least 4).`);
  return { pass: issues.length === 0, issues };
}

export function voiceGate(v: VoiceMetrics | null): Gate {
  if (!v || v.source === "simulation") return { pass: !!v, issues: [] };
  const issues: string[] = [];
  if (v.voicedPct < 60) issues.push(`Voice was steady in only ${v.voicedPct.toFixed(0)}% of the recording (needs 60%). Hold one continuous "ah".`);
  if (v.peakLevel >= 0.99) issues.push("The recording clipped (too loud). Move slightly further from the microphone.");
  if (v.peakLevel < 0.02) issues.push("The recording was almost silent. Move closer to the microphone.");
  return { pass: issues.length === 0, issues };
}

export function ocularGate(o: OcularMetrics | null): Gate {
  if (!o || o.source === "simulation") return { pass: !!o, issues: [] };
  const issues: string[] = [];
  if (o.coverage < 0.7) issues.push(`Eyes were tracked in only ${(o.coverage * 100).toFixed(0)}% of frames (needs 70%).`);
  if (o.saccadeCount < 3) issues.push(`Only ${o.saccadeCount} target jumps could be timed (needs 3).`);
  if (o.calibrationR2 < 0.3) issues.push("Gaze did not follow the target closely enough to calibrate. Keep your head still and move only your eyes.");
  return { pass: issues.length === 0, issues };
}
