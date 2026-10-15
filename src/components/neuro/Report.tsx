import { Download, Printer, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { observations, type RiskResult } from "@/lib/neuro/scoring";
import type { Session } from "@/lib/neuro/store";
import { Disclaimer, RiskBadge, SourceTag } from "./common";
import { MotorCharts, OcularCharts, VoiceCharts } from "./charts";
import { ContributionChart, FeatureTable, Gauge } from "./Results";

export function Report({
  session,
  risk,
  onNotes,
  onSave,
  onDownloadPdf,
  onBack,
}: {
  session: Session;
  risk: RiskResult;
  onNotes: (n: string) => void;
  onSave: () => void;
  onDownloadPdf?: () => void;
  onBack: () => void;
}) {
  const p = session.patient;
  const ocular = session.ocular ?? null;
  const obs = observations(session.motor, session.voice, risk, ocular);
  const date = new Date(session.createdAt);

  const download = () => {
    const payload = { generatedAt: new Date().toISOString(), tool: "NeuroGait AI (research prototype)", session, risk };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `neurogait-${(p.patientId || p.name || "session").replace(/[^a-z0-9-_]+/gi, "_")}-${date.toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Step 6 · Report</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Assessment report</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={onBack}>Back</Button>
          <Button variant="outline" onClick={onSave}>
            <Save className="mr-2 h-4 w-4" /> Save session
          </Button>
          <Button variant="outline" onClick={download}>
            <Download className="mr-2 h-4 w-4" /> Data (JSON)
          </Button>
          {onDownloadPdf && (
            <Button variant="outline" onClick={onDownloadPdf}>
              <Download className="mr-2 h-4 w-4" /> Download PDF
            </Button>
          )}
          <Button onClick={() => { onSave(); window.print(); }}>
            <Printer className="mr-2 h-4 w-4" /> Print / Save PDF
          </Button>
        </div>
      </div>

      <article className="mx-auto max-w-4xl space-y-6 rounded-lg border bg-card p-6 sm:p-10 print:max-w-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">NeuroGait AI</p>
            <h1 className="mt-1 text-2xl font-bold">Multimodal motor, vocal & oculomotor screening report</h1>
            <p className="text-sm text-muted-foreground">Session {session.id.slice(0, 8)} · {date.toLocaleString()}</p>
          </div>
          <div className="text-right">
            <RiskBadge level={risk.level} className="px-3 py-1 text-sm" />
            <p className="mt-2 font-mono text-3xl font-bold">{risk.score.toFixed(0)}<span className="text-sm text-muted-foreground">/100</span></p>
          </div>
        </header>

        <Disclaimer />

        <section className="grid gap-4 sm:grid-cols-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Name</dt><dd>{p.name || "—"}</dd>
            <dt className="text-muted-foreground">Patient ID</dt><dd>{p.patientId || "—"}</dd>
            <dt className="text-muted-foreground">Age / sex</dt><dd>{p.age || "—"} · {p.sex}</dd>
            <dt className="text-muted-foreground">Dominant / tested hand</dt><dd className="capitalize">{p.dominantHand} / {p.testedHand}</dd>
          </dl>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Symptoms</dt><dd>{p.symptoms.length ? p.symptoms.join(", ") : "—"}</dd>
            <dt className="text-muted-foreground">Medications</dt><dd>{p.medications || "—"}</dd>
            <dt className="text-muted-foreground">Intake notes</dt><dd>{p.notes || "—"}</dd>
            <dt className="text-muted-foreground">Data sources</dt>
            <dd className="flex flex-wrap gap-1">
              {session.motor ? <SourceTag source={session.motor.source} /> : <span>Motor skipped</span>}
              {session.voice ? <SourceTag source={session.voice.source} /> : <span>Voice skipped</span>}
              {ocular ? <SourceTag source={ocular.source} /> : <span>Oculomotor skipped</span>}
            </dd>
          </dl>
        </section>

        <section className="grid items-center gap-6 break-inside-avoid sm:grid-cols-3">
          <div className="flex flex-col items-center">
            <Gauge score={risk.score} size={200} />
            <p className="text-xs text-muted-foreground">Motor {risk.motorScore?.toFixed(0) ?? "—"} · Vocal {risk.voiceScore?.toFixed(0) ?? "—"} · Ocular {risk.ocularScore?.toFixed(0) ?? "—"} · Confidence {risk.confidence}</p>
          </div>
          <div className="sm:col-span-2">
            <h3 className="mb-1 text-sm font-semibold">Feature contribution</h3>
            <ContributionChart risk={risk} />
          </div>
        </section>

        <section className="break-inside-avoid">
          <h3 className="mb-2 text-sm font-semibold">Session metrics vs. reference ranges</h3>
          <FeatureTable risk={risk} />
        </section>

        {session.motor && (
          <section className="space-y-2 break-inside-avoid">
            <h3 className="text-sm font-semibold">Motor kinematics</h3>
            <p className="text-xs text-muted-foreground">
              {session.motor.tapCount} taps · {session.motor.tapRate.toFixed(2)} taps/s · decrement {session.motor.amplitudeDecayPct.toFixed(1)}% · rhythm CV {session.motor.rhythmCV.toFixed(1)}% · tremor peak {session.motor.tremorFreqHz ? `${session.motor.tremorFreqHz.toFixed(1)} Hz` : "—"} · tracking coverage {(session.motor.restCoverage * 100).toFixed(0)}% / {(session.motor.tapCoverage * 100).toFixed(0)}%
            </p>
            <MotorCharts m={session.motor} />
          </section>
        )}

        {session.voice && (
          <section className="space-y-2 break-inside-avoid">
            <h3 className="text-sm font-semibold">Vocal biomarkers</h3>
            <p className="text-xs text-muted-foreground">
              F0 {session.voice.f0Mean.toFixed(1)} ± {session.voice.f0Sd.toFixed(1)} Hz · jitter {session.voice.jitterPct.toFixed(2)}% · shimmer {session.voice.shimmerPct.toFixed(2)}% · HNR {session.voice.hnrDb.toFixed(1)} dB · voiced {session.voice.voicedPct.toFixed(0)}%
            </p>
            <VoiceCharts v={session.voice} />
          </section>
        )}

        {ocular && (
          <section className="space-y-2 break-inside-avoid">
            <h3 className="text-sm font-semibold">Oculomotor biomarkers</h3>
            <p className="text-xs text-muted-foreground">
              Saccadic latency {ocular.saccadeLatencyMs.toFixed(0)} ± {ocular.saccadeLatencySdMs.toFixed(0)} ms (n={ocular.saccadeCount}) · saccade gain {ocular.saccadeGain.toFixed(2)} · pursuit gain {ocular.pursuitGain.toFixed(2)} ({ocular.pursuitPeakVelDeg.toFixed(0)}°/s peak, {ocular.catchUpPerSec.toFixed(1)} catch-up/s) · fixation SD {ocular.fixationSdDeg.toFixed(2)}° · tracking coverage {(ocular.coverage * 100).toFixed(0)}%
            </p>
            <OcularCharts o={ocular} />
          </section>
        )}

        <section className="break-inside-avoid">
          <h3 className="mb-2 text-sm font-semibold">Automated observations</h3>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {obs.map((o) => <li key={o}>{o}</li>)}
            {[...(session.motor?.qualityNotes ?? []), ...(session.voice?.qualityNotes ?? []), ...(ocular?.qualityNotes ?? [])].map((n) => (
              <li key={n} className="text-risk-moderate">Quality: {n}</li>
            ))}
          </ul>
        </section>

        <section className="break-inside-avoid">
          <h3 className="mb-2 text-sm font-semibold">Clinician notes</h3>
          <Textarea
            className="print:hidden"
            rows={4}
            value={session.clinicianNotes}
            onChange={(e) => onNotes(e.target.value)}
            placeholder="Add interpretation, follow-up plan or context…"
            maxLength={2000}
          />
          <p className="hidden min-h-16 whitespace-pre-wrap rounded border p-3 text-sm print:block">{session.clinicianNotes || " "}</p>
        </section>

        <footer className="border-t pt-4 text-[11px] text-muted-foreground">
          Generated by NeuroGait AI, a research prototype. Measurements were computed locally in the browser from webcam hand and iris landmarks and microphone audio. The score uses fixed heuristic weights and has not been clinically validated. Not intended for diagnostic use.
        </footer>
      </article>
    </div>
  );
}
