import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { MotorMetrics } from "./motor";
import type { VoiceMetrics } from "./voice";

export type Patient = {
  name: string;
  patientId: string;
  age: string;
  sex: "female" | "male" | "other";
  dominantHand: "right" | "left";
  testedHand: "right" | "left";
  symptoms: string[];
  medications: string;
  notes: string;
  consent: boolean;
};

export type Session = {
  id: string;
  createdAt: string;
  patient: Patient;
  motor: MotorMetrics | null;
  voice: VoiceMetrics | null;
  clinicianNotes: string;
};

export const emptyPatient = (): Patient => ({
  name: "",
  patientId: "",
  age: "",
  sex: "female",
  dominantHand: "right",
  testedHand: "right",
  symptoms: [],
  medications: "",
  notes: "",
  consent: false,
});

const KEY = "neurogait.sessions.v1";

type Ctx = {
  session: Session | null;
  history: Session[];
  start: () => void;
  open: (id: string) => void;
  update: (patch: Partial<Session>) => void;
  save: () => void;
  remove: (id: string) => void;
  close: () => void;
};

const StoreCtx = createContext<Ctx | null>(null);

export function AssessmentProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [history, setHistory] = useState<Session[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch {
      /* ignore corrupt storage */
    }
  }, []);

  const persist = useCallback((h: Session[]) => {
    setHistory(h);
    try {
      localStorage.setItem(KEY, JSON.stringify(h.slice(0, 30)));
    } catch {
      /* storage full or unavailable */
    }
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      session,
      history,
      start: () =>
        setSession({
          id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()),
          createdAt: new Date().toISOString(),
          patient: emptyPatient(),
          motor: null,
          voice: null,
          clinicianNotes: "",
        }),
      open: (id) => {
        const s = history.find((h) => h.id === id);
        if (s) setSession(structuredClone(s));
      },
      update: (patch) => setSession((s) => (s ? { ...s, ...patch } : s)),
      save: () => {
        if (!session) return;
        persist([session, ...history.filter((h) => h.id !== session.id)]);
      },
      remove: (id) => persist(history.filter((h) => h.id !== id)),
      close: () => setSession(null),
    }),
    [session, history, persist],
  );

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useAssessment() {
  const c = useContext(StoreCtx);
  if (!c) throw new Error("useAssessment must be used within AssessmentProvider");
  return c;
}
