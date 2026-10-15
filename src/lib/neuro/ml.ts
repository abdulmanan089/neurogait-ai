// Optional XGBoost backend (backend/main.py). Any failure falls back silently to the in-browser heuristic.
import { useEffect, useState } from "react";
import { levelFor, type RiskResult } from "./scoring";

export type ScoringMode = "heuristic" | "ml";

type MlResponse = {
  score: number;
  predicted_class: string;
  confidence: number;
  contributions: { feature: string; shap: number }[];
};

const ML_URL: string = (import.meta.env["VITE_ML_API_URL"] as string | undefined) || "http://localhost:8000/predict";

async function callMl(risk: RiskResult, signal: AbortSignal): Promise<MlResponse | null> {
  const body = Object.fromEntries(risk.features.map((f) => [f.key, f.value]));
  try {
    const res = await fetch(ML_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    if (!res.ok) return null;
    const j = (await res.json()) as MlResponse;
    return typeof j.score === "number" && Array.isArray(j.contributions) ? j : null;
  } catch {
    return null; // offline, CORS, mixed content or timeout
  }
}

function merge(h: RiskResult, ml: MlResponse): RiskResult {
  const pos = new Map(ml.contributions.map((c) => [c.feature, Math.max(0, c.shap)]));
  const total = [...pos.values()].reduce((a, b) => a + b, 0);
  const score = Math.min(100, Math.max(0, ml.score));
  return {
    ...h,
    score,
    level: levelFor(score),
    engine: "ml",
    mlClass: ml.predicted_class,
    features: h.features.map((f) => ({
      ...f,
      contribution: f.value == null || total === 0 ? 0 : ((pos.get(f.key) ?? 0) / total) * score,
    })),
  };
}

/** Returns the ML-scored result when the backend answers, otherwise the heuristic result unchanged. */
export function useMlRisk(heuristic: RiskResult, enabled: boolean): { risk: RiskResult; mode: ScoringMode } {
  const [ml, setMl] = useState<{ key: string; res: MlResponse } | null>(null);
  const key = JSON.stringify(heuristic.features.map((f) => f.value));
  useEffect(() => {
    if (!enabled || heuristic.features.every((f) => f.value == null)) return;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    void callMl(heuristic, ctl.signal).then((r) => { if (r) setMl({ key, res: r }); });
    return () => { clearTimeout(t); ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  if (enabled && ml && ml.key === key) return { risk: merge(heuristic, ml.res), mode: "ml" };
  return { risk: heuristic, mode: "heuristic" };
}
