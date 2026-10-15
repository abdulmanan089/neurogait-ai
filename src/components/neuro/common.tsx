import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { RiskLevel } from "@/lib/neuro/scoring";

export function cssVar(name: string, fallback = "#0f766e") {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function Disclaimer({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div
      role="note"
      className={cn(
        "flex gap-3 rounded-md border border-risk-moderate/50 bg-risk-moderate/10 text-foreground",
        compact ? "px-3 py-2 text-xs" : "p-4 text-sm",
        className,
      )}
    >
      <AlertTriangle className={cn("shrink-0 text-risk-moderate", compact ? "h-4 w-4" : "h-5 w-5")} aria-hidden />
      <p>
        <strong className="font-semibold">Research screening tool — not a medical diagnosis.</strong>{" "}
        NeuroGait AI produces preliminary, experimental indicators only. Results must not be used to diagnose,
        exclude, or treat any condition and should be interpreted by a qualified clinician.
      </p>
    </div>
  );
}

export function SectionTitle({ eyebrow, title, desc, right }: { eyebrow?: string; title: string; desc?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="font-mono text-xs uppercase tracking-widest text-primary">{eyebrow}</p>}
        <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
        {desc && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{desc}</p>}
      </div>
      {right}
    </div>
  );
}

export function Metric({ label, value, unit, hint, tone }: { label: string; value: string; unit?: string; hint?: string; tone?: "default" | "warn" | "bad" | "good" }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 font-mono text-xl font-semibold tabular",
          tone === "bad" && "text-risk-elevated",
          tone === "warn" && "text-risk-moderate",
          tone === "good" && "text-risk-low",
        )}
      >
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
      </p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export const riskClass: Record<RiskLevel, string> = {
  Low: "bg-risk-low text-primary-foreground",
  Moderate: "bg-risk-moderate text-ink",
  Elevated: "bg-risk-elevated text-primary-foreground",
};

export function RiskBadge({ level, className }: { level: RiskLevel; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold", riskClass[level], className)}>
      {level} risk
    </span>
  );
}

export function SourceTag({ source }: { source: string }) {
  const sim = source === "simulation";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        sim ? "border-risk-moderate/60 text-risk-moderate" : "border-primary/40 text-primary",
      )}
    >
      {sim ? "Simulated data" : source === "camera" ? "Live camera" : "Live microphone"}
    </span>
  );
}
