import { Activity, AudioWaveform, FileText, Hand, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { computeRisk } from "@/lib/neuro/scoring";
import { useAssessment } from "@/lib/neuro/store";
import { Disclaimer, RiskBadge } from "./common";

export function Dashboard({ onStart, onOpen }: { onStart: () => void; onOpen: (id: string) => void }) {
  const { history, remove } = useAssessment();
  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-5">
        <div className="rounded-xl bg-ink p-8 text-ink-foreground lg:col-span-3">
          <p className="font-mono text-xs uppercase tracking-widest opacity-60">Clinical assessment workspace</p>
          <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">Non-invasive motor and vocal screening in under five minutes.</h1>
          <p className="mt-4 max-w-xl text-sm opacity-80">
            Webcam hand tracking quantifies rest tremor and finger-tapping bradykinesia. A sustained vowel yields jitter, shimmer and HNR. Both are combined into one transparent screening score.
          </p>
          <Button size="lg" className="mt-6" onClick={onStart}>
            <Plus className="mr-2 h-4 w-4" /> New assessment
          </Button>
        </div>
        <div className="grid gap-3 lg:col-span-2">
          {[
            { icon: Hand, t: "Motor vision", d: "21-point hand landmarks, 3–7 Hz tremor band, tap speed, decrement, rhythm." },
            { icon: AudioWaveform, t: "Vocal biomarkers", d: "Cycle-to-cycle F0, jitter, shimmer and harmonics-to-noise ratio." },
            { icon: Activity, t: "Decision support", d: "Weighted score with feature contributions and normative comparison." },
            { icon: FileText, t: "Report & export", d: "Printable report, PDF via print dialog, and raw JSON data." },
          ].map(({ icon: I, t, d }) => (
            <div key={t} className="flex gap-3 rounded-lg border bg-card p-4">
              <I className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
              <div>
                <p className="text-sm font-semibold">{t}</p>
                <p className="text-xs text-muted-foreground">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <Disclaimer />

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent sessions</h2>
        {history.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No saved sessions yet. Completed reports are stored on this device only.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Patient</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Modules</th>
                  <th className="px-4 py-2 font-medium">Score</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {history.map((s) => {
                  const r = computeRisk(s.motor, s.voice);
                  return (
                    <tr key={s.id} className="border-t">
                      <td className="px-4 py-2">
                        <p className="font-medium">{s.patient.name || "Unnamed"}</p>
                        <p className="text-xs text-muted-foreground">{s.patient.patientId || "—"}</p>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{new Date(s.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-2 text-xs">{[s.motor && "Motor", s.voice && "Voice"].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="px-4 py-2">
                        <span className="mr-2 font-mono">{r.score.toFixed(0)}</span>
                        <RiskBadge level={r.level} />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => onOpen(s.id)}>Open report</Button>
                        <Button size="icon" variant="ghost" aria-label="Delete session" onClick={() => remove(s.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
