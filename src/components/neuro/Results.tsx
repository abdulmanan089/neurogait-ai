import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { Button } from "@/components/ui/button";
import type { RiskResult, FeatureResult } from "@/lib/neuro/scoring";
import { cn } from "@/lib/utils";
import { Disclaimer, RiskBadge, SectionTitle } from "./common";

export function Gauge({ score, size = 220 }: { score: number; size?: number }) {
  const r = 80;
  const cx = 100;
  const cy = 95;
  const arc = (a0: number, a1: number) => {
    const p = (a: number) => [cx + r * Math.cos(Math.PI * (1 - a)), cy - r * Math.sin(Math.PI * (1 - a))];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
  };
  const a = Math.min(1, Math.max(0, score / 100));
  const nx = cx + (r - 18) * Math.cos(Math.PI * (1 - a));
  const ny = cy - (r - 18) * Math.sin(Math.PI * (1 - a));
  return (
    <svg viewBox="0 0 200 110" width={size} height={size * 0.55} role="img" aria-label={`Screening score ${score.toFixed(0)} of 100`}>
      <path d={arc(0, 0.3)} stroke="var(--color-risk-low)" strokeWidth={14} fill="none" />
      <path d={arc(0.3, 0.55)} stroke="var(--color-risk-moderate)" strokeWidth={14} fill="none" />
      <path d={arc(0.55, 1)} stroke="var(--color-risk-elevated)" strokeWidth={14} fill="none" />
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--color-foreground)" strokeWidth={3} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={5} fill="var(--color-foreground)" />
    </svg>
  );
}

const statusStyle: Record<FeatureResult["status"], string> = {
  within: "text-risk-low",
  borderline: "text-risk-moderate",
  outside: "text-risk-elevated",
  unavailable: "text-muted-foreground",
};
const statusText: Record<FeatureResult["status"], string> = {
  within: "Within range",
  borderline: "Borderline",
  outside: "Outside range",
  unavailable: "Not measured",
};

export function FeatureTable({ risk }: { risk: RiskResult }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[620px] text-sm">
        <thead className="bg-muted text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Feature</th>
            <th className="px-3 py-2 font-medium">Measured</th>
            <th className="px-3 py-2 font-medium">Reference range</th>
            <th className="px-3 py-2 font-medium">Deviation</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {risk.features.map((f) => (
            <tr key={f.key} className="border-t">
              <td className="px-3 py-2">
                <span className="mr-2 font-mono text-[10px] uppercase text-muted-foreground">{f.modality}</span>
                {f.label}
              </td>
              <td className="px-3 py-2 font-mono tabular">{f.display}</td>
              <td className="px-3 py-2 text-muted-foreground">{f.normText}</td>
              <td className="px-3 py-2">
                <div className="h-1.5 w-24 overflow-hidden rounded bg-muted">
                  <div
                    className={cn("h-full", f.status === "outside" ? "bg-risk-elevated" : f.status === "borderline" ? "bg-risk-moderate" : "bg-risk-low")}
                    style={{ width: `${Math.max(4, f.concern * 100)}%`, opacity: f.status === "unavailable" ? 0 : 1 }}
                  />
                </div>
              </td>
              <td className={cn("px-3 py-2 text-xs font-semibold", statusStyle[f.status])}>{statusText[f.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ContributionChart({ risk }: { risk: RiskResult }) {
  const data = risk.features
    .filter((f) => f.value != null)
    .map((f) => ({ name: f.label, value: Math.round(f.contribution * 10) / 10, status: f.status }))
    .sort((a, b) => b.value - a.value);
  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
          <XAxis type="number" domain={[0, (max: number) => Math.max(10, Math.ceil(max))]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}`} />
          <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 11, fill: "var(--color-foreground)" }} />
          <Tooltip formatter={(v: number) => [`${v} pts`, "Contribution"]} />
          <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.status === "outside" ? "var(--color-risk-elevated)" : d.status === "borderline" ? "var(--color-risk-moderate)" : "var(--color-risk-low)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Results({ risk, onBack, onReport, onRetest, onDownloadPdf }: { risk: RiskResult; onBack: () => void; onReport: () => void; onRetest: (m: "motor" | "voice" | "ocular") => void; onDownloadPdf?: () => void }) {
  const fmt = (v: number | null) => (v == null ? "—" : v.toFixed(0));
  return (
    <div>
      <SectionTitle eyebrow="Step 5 · Decision support" title="Multimodal screening summary" desc="Kinematic, acoustic and oculomotor features are compared with reference ranges and combined using fixed, transparent weights." />
      <Disclaimer className="mb-6" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col items-center rounded-lg border bg-card p-6 text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Combined screening score</p>
          <span className="mt-2 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Mode: {risk.engine === "ml" ? `XGBoost ML Model${risk.mlClass ? ` · ${risk.mlClass}` : ""}` : "Edge Rule Heuristic"}
          </span>
          <Gauge score={risk.score} />
          <p className="font-mono text-5xl font-bold tabular">{risk.score.toFixed(0)}<span className="text-lg text-muted-foreground">/100</span></p>
          <RiskBadge level={risk.level} className="mt-3 px-3 py-1 text-sm" />
          <div className="mt-5 grid w-full grid-cols-3 gap-2 text-left">
            <div className="rounded-md bg-muted p-3">
              <p className="text-xs text-muted-foreground">Motor</p>
              <p className="font-mono text-xl font-semibold">{fmt(risk.motorScore)}</p>
            </div>
            <div className="rounded-md bg-muted p-3">
              <p className="text-xs text-muted-foreground">Vocal</p>
              <p className="font-mono text-xl font-semibold">{fmt(risk.voiceScore)}</p>
            </div>
            <div className="rounded-md bg-muted p-3">
              <p className="text-xs text-muted-foreground">Ocular</p>
              <p className="font-mono text-xl font-semibold">{fmt(risk.ocularScore)}</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Bands: Low &lt; 30 · Moderate 30–54 · Elevated ≥ 55</p>
          <p className={cn("mt-2 text-xs font-medium", risk.confidence === "Reduced" ? "text-risk-moderate" : "text-risk-low")}>Confidence: {risk.confidence}</p>
          {risk.confidenceNotes.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-left text-[11px] text-muted-foreground">
              {risk.confidenceNotes.map((n) => <li key={n}>• {n}</li>)}
            </ul>
          )}
        </div>
        <div className="rounded-lg border bg-card p-5 lg:col-span-2">
          <h3 className="font-semibold">Feature contribution</h3>
          <p className="text-xs text-muted-foreground">Points each feature adds to the 0–100 score (weight × deviation beyond the reference limit).</p>
          <div className="mt-4"><ContributionChart risk={risk} /></div>
        </div>
      </div>
      <div className="mt-6">
        <h3 className="mb-3 font-semibold">Comparison with normative reference ranges</h3>
        <FeatureTable risk={risk} />
        <p className="mt-2 text-xs text-muted-foreground">
          Reference limits draw on commonly cited values (e.g. MDVP/Praat thresholds for jitter 1.04 %, shimmer 3.81 %, HNR 20 dB) and published finger-tapping norms, and typical oculomotor values (saccadic latency ≈ 180–250 ms, pursuit gain ≥ 0.85). They have not been calibrated for this device setup.
        </p>
      </div>
      <div className="mt-8 flex flex-wrap justify-between gap-2 border-t pt-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={onBack}>Back</Button>
          <Button variant="outline" onClick={() => onRetest("motor")}>Redo motor test</Button>
          <Button variant="outline" onClick={() => onRetest("voice")}>Redo voice test</Button>
          <Button variant="outline" onClick={() => onRetest("ocular")}>Redo eye test</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {onDownloadPdf && <Button variant="outline" onClick={onDownloadPdf}>Download report as PDF</Button>}
          <Button onClick={onReport}>Generate patient report</Button>
        </div>
      </div>
    </div>
  );
}
