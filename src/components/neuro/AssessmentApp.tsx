import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Brain, Check } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { AssessmentProvider, useAssessment } from "@/lib/neuro/store";
import { computeRisk } from "@/lib/neuro/scoring";
import { Dashboard } from "@/components/neuro/Dashboard";
import { Intake } from "@/components/neuro/Intake";
import { MotorTest } from "@/components/neuro/MotorTest";
import { VoiceTest } from "@/components/neuro/VoiceTest";
import { OcularTest } from "@/components/neuro/OcularTest";
import { Results } from "@/components/neuro/Results";
import { Report } from "@/components/neuro/Report";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NeuroGait Vision — Motor, Voice & Oculomotor Screening" },
      { name: "description", content: "Research tool combining webcam tremor and finger-tapping analysis, vocal biomarkers and eye-movement tracking into a transparent screening score." },
      { property: "og:title", content: "NeuroGait Vision — Motor, Voice & Oculomotor Screening" },
      { property: "og:description", content: "Webcam hand and eye tracking plus voice analysis for preliminary neurological screening research." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <AssessmentProvider>
      <App />
      <Toaster />
    </AssessmentProvider>
  );
}

type View = "dashboard" | "intake" | "motor" | "voice" | "ocular" | "results" | "report";
const STEPS: { id: View; label: string }[] = [
  { id: "intake", label: "Intake" },
  { id: "motor", label: "Motor" },
  { id: "voice", label: "Voice" },
  { id: "ocular", label: "Oculomotor" },
  { id: "results", label: "Results" },
  { id: "report", label: "Report" },
];

function App() {
  const { session, start, open, update, save, close } = useAssessment();
  const [view, setView] = useState<View>("dashboard");
  const risk = useMemo(() => computeRisk(session?.motor ?? null, session?.voice ?? null, session?.ocular ?? null), [session?.motor, session?.voice, session?.ocular]);

  useEffect(() => {
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, [view]);

  const go = (v: View) => setView(v);
  const stepIdx = STEPS.findIndex((s) => s.id === view);
  const reachable = (v: View) => {
    if (!session) return false;
    if (v === "intake") return true;
    const intakeOk = (session.patient.name || session.patient.patientId) && session.patient.consent && session.patient.age;
    if (!intakeOk) return false;
    if (v === "motor" || v === "voice" || v === "ocular") return true;
    return !!(session.motor || session.voice || session.ocular);
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <button className="flex items-center gap-2" onClick={() => { close(); go("dashboard"); }}>
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Brain className="h-4 w-4" aria-hidden />
            </span>
            <span className="text-left leading-tight">
              <span className="block text-sm font-bold">NeuroGait Vision</span>
              <span className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Research prototype</span>
            </span>
          </button>
          {session && view !== "dashboard" && (
            <span className="hidden truncate text-sm text-muted-foreground sm:block">
              {session.patient.name || session.patient.patientId || "New patient"}
            </span>
          )}
        </div>
        {session && view !== "dashboard" && (
          <nav aria-label="Assessment steps" className="mx-auto max-w-7xl overflow-x-auto px-4 pb-3 sm:px-6">
            <ol className="flex min-w-max items-center gap-1">
              {STEPS.map((s, i) => {
                const done =
                  (s.id === "intake" && stepIdx > 0) ||
                  (s.id === "motor" && !!session.motor) ||
                  (s.id === "voice" && !!session.voice) ||
                  (s.id === "ocular" && !!session.ocular) ||
                  (s.id === "results" && stepIdx > 4);
                const can = reachable(s.id);
                return (
                  <li key={s.id} className="flex items-center gap-1">
                    <button
                      disabled={!can}
                      onClick={() => go(s.id)}
                      aria-current={view === s.id ? "step" : undefined}
                      className={cn(
                        "flex items-center gap-2 rounded-full px-3 py-1 text-xs transition-colors disabled:opacity-40",
                        view === s.id ? "bg-ink text-ink-foreground" : "hover:bg-muted",
                      )}
                    >
                      <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border font-mono text-[10px]", done && "border-risk-low bg-risk-low text-primary-foreground")}>
                        {done ? <Check className="h-3 w-3" /> : i + 1}
                      </span>
                      {s.label}
                    </button>
                    {i < STEPS.length - 1 && <span className="h-px w-4 bg-border" aria-hidden />}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 print:p-0">
        {(view === "dashboard" || !session) && (
          <Dashboard
            onStart={() => { start(); go("intake"); }}
            onOpen={(id) => { open(id); go("report"); }}
          />
        )}
        {session && view === "intake" && <Intake onNext={() => go("motor")} />}
        {session && view === "motor" && (
          <MotorTest
            key={`motor-${session.id}`}
            existing={session.motor}
            onBack={() => go("intake")}
            onComplete={(m) => { update({ motor: m }); go("voice"); }}
          />
        )}
        {session && view === "voice" && (
          <VoiceTest
            key={`voice-${session.id}`}
            existing={session.voice}
            sex={session.patient.sex}
            onBack={() => go("motor")}
            onComplete={(v) => { update({ voice: v }); go("ocular"); }}
          />
        )}
        {session && view === "ocular" && (
          <OcularTest
            key={`ocular-${session.id}`}
            existing={session.ocular ?? null}
            onBack={() => go("voice")}
            onComplete={(o) => { update({ ocular: o }); go(session.motor || session.voice || o ? "results" : "motor"); }}
          />
        )}
        {session && view === "results" && (
          <Results
            risk={risk}
            onBack={() => go("ocular")}
            onReport={() => { save(); go("report"); }}
            onRetest={(m) => { update(m === "motor" ? { motor: null } : m === "voice" ? { voice: null } : { ocular: null }); go(m); }}
          />
        )}
        {session && view === "report" && (
          <Report session={session} risk={risk} onNotes={(n) => update({ clinicianNotes: n })} onSave={save} onBack={() => go("results")} />
        )}
      </main>
    </div>
  );
}
