// Shared quality-control UI: live pre-test checklist and the post-test submission gate banner.
import { useEffect, useRef, useState, type RefObject } from "react";
import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { frameBrightness, type Check, type Gate } from "@/lib/neuro/quality";
import { cn } from "@/lib/utils";

/** Samples camera brightness twice a second while `active`. */
export function useBrightness(videoRef: RefObject<HTMLVideoElement | null>, active: boolean) {
  const [luma, setLuma] = useState<number | null>(null);
  const scratch = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!active) { setLuma(null); return; }
    if (!scratch.current) scratch.current = document.createElement("canvas");
    const id = window.setInterval(() => {
      const v = videoRef.current;
      if (v && scratch.current) setLuma(frameBrightness(v, scratch.current));
    }, 500);
    return () => window.clearInterval(id);
  }, [active, videoRef]);
  return luma;
}

export function LiveChecks({ checks, title = "Pre-test quality checks" }: { checks: Check[]; title?: string }) {
  const all = checks.every((c) => c.ok);
  return (
    <div className={cn("rounded-lg border p-3 text-sm", all ? "border-risk-low/40 bg-risk-low/5" : "border-risk-moderate/40 bg-risk-moderate/10")} aria-live="polite">
      <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" /> {title}
      </p>
      <ul className="space-y-1.5">
        {checks.map((c) => (
          <li key={c.id} className="flex items-start gap-2">
            {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-risk-low" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-risk-elevated" />}
            <span><span className="font-medium">{c.label}:</span> <span className="text-muted-foreground">{c.hint}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GateBanner({ gate }: { gate: Gate }) {
  if (gate.pass || !gate.issues.length) return null;
  return (
    <div role="alert" className="rounded-lg border border-risk-elevated/40 bg-risk-elevated/10 p-3 text-sm">
      <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> Recording quality too low to submit</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-6 text-xs">
        {gate.issues.map((i) => <li key={i}>{i}</li>)}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">Repeat the test, use simulation, or skip this module.</p>
    </div>
  );
}
