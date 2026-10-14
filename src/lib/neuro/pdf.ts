// Builds a structured PDF report from data (not a DOM screenshot), so it is crisp and page breaks are clean.
import type { Session } from "./store";
import type { RiskResult } from "./scoring";
import { observations } from "./scoring";

export async function buildReportPdf(s: Session, risk: RiskResult): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 16;
  let y = 18;
  const need = (h: number) => { if (y + h > 280) { doc.addPage(); y = 18; } };
  const text = (t: string, size = 10, bold = false, color: [number, number, number] = [20, 24, 32]) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(t, W - 2 * M) as string[];
    need(lines.length * size * 0.45 + 1);
    doc.text(lines, M, y);
    y += lines.length * size * 0.45 + 1.5;
  };
  const heading = (t: string) => { y += 3; need(10); text(t, 12, true); doc.setDrawColor(200); doc.line(M, y - 1, W - M, y - 1); y += 2; };

  text("NeuroGait AI — Multimodal Screening Report", 16, true);
  text(`Generated ${new Date().toLocaleString()} · Session ${s.id.slice(0, 8)}`, 9, false, [100, 110, 120]);

  // Disclaimer box
  y += 2;
  doc.setFillColor(255, 243, 224);
  doc.rect(M, y, W - 2 * M, 16, "F");
  y += 5;
  text("RESEARCH PROTOTYPE — NOT A MEDICAL DIAGNOSIS. This preliminary screening score is heuristic and has not been clinically validated. Results must be interpreted by a qualified clinician.", 8.5, true, [140, 70, 0]);
  y += 3;

  heading("Patient");
  const p = s.patient;
  text(`Name/ID: ${p.name || "—"} ${p.patientId ? `(${p.patientId})` : ""}   Age: ${p.age || "—"}   Sex: ${p.sex}   Tested hand: ${p.testedHand}`);
  if (p.symptoms.length) text(`Reported symptoms: ${p.symptoms.join(", ")}`);

  heading("Combined screening score");
  const col: Record<string, [number, number, number]> = { Low: [22, 140, 90], Moderate: [200, 130, 0], Elevated: [200, 40, 40] };
  text(`${risk.score.toFixed(0)} / 100 — ${risk.level} risk`, 18, true, col[risk.level]);
  const ms = (x: number | null) => (x == null ? "not measured" : x.toFixed(0));
  text(`Motor ${ms(risk.motorScore)} · Voice ${ms(risk.voiceScore)} · Oculomotor ${ms(risk.ocularScore)} · Confidence ${risk.confidence} (${(risk.coverage * 100).toFixed(0)}% of features measured)`, 9);
  text(`Data sources: motor ${s.motor?.source ?? "—"}, voice ${s.voice?.source ?? "—"}, oculomotor ${s.ocular?.source ?? "—"}`, 9, false, [100, 110, 120]);

  heading("Feature contributions & reference ranges");
  const cols = [M, M + 64, M + 96, M + 136, M + 160];
  const row = (cells: string[], bold = false) => {
    need(6);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(20, 24, 32);
    cells.forEach((c, i) => doc.text(c, cols[i] ?? M, y));
    y += 5.2;
  };
  row(["Feature", "Measured", "Reference", "Contribution", "Status"], true);
  for (const f of risk.features) {
    row([f.label, f.display, f.normText, f.value == null ? "—" : `${f.contribution.toFixed(1)} pts`, f.status]);
    // contribution bar
    if (f.value != null) { doc.setFillColor(13, 148, 136); doc.rect(cols[3]! + 16, y - 7.6, Math.max(0.5, f.contribution * 0.6), 2, "F"); }
  }

  heading("Observations");
  for (const o of observations(s.motor, s.voice, risk, s.ocular ?? null)) text(`• ${o}`, 9.5);
  if (risk.confidenceNotes.length) for (const n of risk.confidenceNotes) text(`• ${n}`, 9, false, [140, 70, 0]);

  if (s.clinicianNotes) { heading("Clinician notes"); text(s.clinicianNotes, 9.5); }

  heading("Method & privacy");
  text("All hand, face and voice processing ran locally in the browser (MediaPipe landmarks, Web Audio). Only the numeric feature vector above was stored; no video or audio was recorded or uploaded.", 9);

  return doc.output("blob");
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
