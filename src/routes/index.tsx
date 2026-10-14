import { createFileRoute, Link } from "@tanstack/react-router";
import { Brain, Eye, Hand, Mic, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NeuroGait AI — Privacy-First Multimodal Screening Prototype" },
      { name: "description", content: "Research prototype combining finger-tapping, sustained phonation and smooth-pursuit eye tracking, analysed entirely in the browser." },
      { property: "og:title", content: "NeuroGait AI — Privacy-First Multimodal Screening" },
      { property: "og:description", content: "Three structured tasks, on-device feature extraction and explainable research scores." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const TASKS = [
  { icon: Hand, t: "Task A · Hand", d: "Rest tremor (3–7 Hz) and finger-tapping amplitude decrement via MediaPipe hand landmarks." },
  { icon: Mic, t: "Task B · Voice", d: "Sustained 'ahh' analysed for jitter, shimmer and harmonics-to-noise ratio with Web Audio." },
  { icon: Eye, t: "Task C · Eyes", d: "Moving-dot saccades and smooth pursuit tracked with iris landmarks for latency and gain." },
];

function Landing() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground"><Brain className="h-5 w-5" /></span>
        <span className="font-bold">NeuroGait AI</span>
        <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Research prototype</span>
      </div>
      <h1 className="mt-10 max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">Three short tasks. Analysed on your device. Explained transparently.</h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">Video and audio never leave the browser. Only the final numeric features are saved to your private account.</p>
      <div className="mt-8 flex gap-3">
        <Button asChild size="lg"><Link to="/assess">Start an assessment</Link></Button>
        <Button asChild size="lg" variant="outline"><Link to="/auth">Sign in</Link></Button>
      </div>
      <div className="mt-14 grid gap-4 sm:grid-cols-3">
        {TASKS.map(({ icon: I, t, d }) => (
          <div key={t} className="rounded-lg border bg-card p-5">
            <I className="h-5 w-5 text-primary" />
            <h2 className="mt-3 font-semibold">{t}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{d}</p>
          </div>
        ))}
      </div>
      <p className="mt-10 flex items-start gap-2 rounded-lg border border-risk-moderate/40 bg-risk-moderate/10 p-4 text-sm">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        Preliminary screening research tool only — not a medical diagnosis. Scores are heuristic and not clinically validated.
      </p>
    </main>
  );
}
