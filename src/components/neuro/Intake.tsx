import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useAssessment, type Patient } from "@/lib/neuro/store";
import { SectionTitle } from "./common";
import { cn } from "@/lib/utils";

const SYMPTOMS = [
  "Tremor at rest",
  "Slowness of movement",
  "Stiffness",
  "Balance problems",
  "Softer or monotone voice",
  "Smaller handwriting",
  "Reduced sense of smell",
  "None reported",
];

function Seg<T extends string>({ value, options, onChange, id }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; id: string }) {
  return (
    <div role="radiogroup" aria-labelledby={id} className="inline-flex rounded-md border bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            "rounded px-3 py-1.5 text-sm transition-colors",
            value === o.v ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

export function Intake({ onNext }: { onNext: () => void }) {
  const { session, update } = useAssessment();
  const [touched, setTouched] = useState(false);
  if (!session) return null;
  const p = session.patient;
  const set = (patch: Partial<Patient>) => update({ patient: { ...p, ...patch } });
  const ageNum = Number(p.age);
  const errors = {
    name: !p.name.trim() && !p.patientId.trim() ? "Enter a name or a patient ID." : "",
    age: !p.age || !Number.isFinite(ageNum) || ageNum < 18 || ageNum > 110 ? "Enter an age between 18 and 110." : "",
    consent: !p.consent ? "Consent is required to continue." : "",
  };
  const valid = !errors.name && !errors.age && !errors.consent;

  const toggleSymptom = (s: string) => {
    if (s === "None reported") return set({ symptoms: p.symptoms.includes(s) ? [] : [s] });
    const next = p.symptoms.filter((x) => x !== "None reported");
    set({ symptoms: next.includes(s) ? next.filter((x) => x !== s) : [...next, s] });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (valid) onNext();
      }}
      noValidate
    >
      <SectionTitle eyebrow="Step 1 · Intake" title="Patient profile" desc="Basic details give context to the measurements. Data stays on this device." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-5 rounded-lg border bg-card p-5 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Ayesha Khan" maxLength={80} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pid">Patient / study ID</Label>
              <Input id="pid" value={p.patientId} onChange={(e) => set({ patientId: e.target.value })} placeholder="e.g. NG-0042" maxLength={40} />
            </div>
            {touched && errors.name && <p className="text-xs text-destructive sm:col-span-2">{errors.name}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="age">Age (years)</Label>
              <Input id="age" inputMode="numeric" value={p.age} onChange={(e) => set({ age: e.target.value.replace(/[^0-9]/g, "").slice(0, 3) })} placeholder="e.g. 64" aria-invalid={touched && !!errors.age} />
              {touched && errors.age && <p className="text-xs text-destructive">{errors.age}</p>}
            </div>
            <div className="space-y-1.5">
              <Label id="sex-l">Sex at birth</Label>
              <div>
                <Seg id="sex-l" value={p.sex} onChange={(v) => set({ sex: v })} options={[{ v: "female", l: "Female" }, { v: "male", l: "Male" }, { v: "other", l: "Other" }]} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label id="dom-l">Dominant hand</Label>
              <div>
                <Seg id="dom-l" value={p.dominantHand} onChange={(v) => set({ dominantHand: v })} options={[{ v: "right", l: "Right" }, { v: "left", l: "Left" }]} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label id="test-l">Hand to be tested</Label>
              <div>
                <Seg id="test-l" value={p.testedHand} onChange={(v) => set({ testedHand: v })} options={[{ v: "right", l: "Right" }, { v: "left", l: "Left" }]} />
              </div>
            </div>
          </div>
          <div>
            <Label>Reported symptoms</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {SYMPTOMS.map((s) => {
                const on = p.symptoms.includes(s);
                return (
                  <button
                    type="button"
                    key={s}
                    aria-pressed={on}
                    onClick={() => toggleSymptom(s)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-sm transition-colors",
                      on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:border-primary/60",
                    )}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="meds">Current medications</Label>
              <Textarea id="meds" rows={3} value={p.medications} onChange={(e) => set({ medications: e.target.value })} placeholder="e.g. Levodopa 100 mg, taken 08:00" maxLength={500} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Intake notes</Label>
              <Textarea id="notes" rows={3} value={p.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Relevant history, caffeine intake, fatigue…" maxLength={800} />
            </div>
          </div>
        </div>
        <aside className="space-y-4">
          <div className="rounded-lg border bg-ink p-5 text-ink-foreground">
            <h3 className="font-semibold">What this session involves</h3>
            <ol className="mt-3 space-y-3 text-sm opacity-90">
              <li><span className="font-mono text-primary-foreground/70">01</span> Hand at rest for 8 s, then 10 s of thumb–index finger tapping in front of the camera.</li>
              <li><span className="font-mono text-primary-foreground/70">02</span> A sustained “ahh” for 5 s into the microphone.</li>
              <li><span className="font-mono text-primary-foreground/70">03</span> An automated screening summary and printable report.</li>
            </ol>
            <p className="mt-4 text-xs opacity-70">If a camera or microphone is unavailable, each step offers a clearly labelled simulation so the workflow can still be demonstrated.</p>
          </div>
          <label className="flex items-start gap-3 rounded-lg border bg-card p-4 text-sm">
            <Checkbox checked={p.consent} onCheckedChange={(c) => set({ consent: c === true })} className="mt-0.5" />
            <span>
              The participant understands this is an experimental research screening, not a diagnosis, and consents to camera and microphone capture processed locally in this browser.
            </span>
          </label>
          {touched && errors.consent && <p className="text-xs text-destructive">{errors.consent}</p>}
          <Button type="submit" size="lg" className="w-full">
            Continue to motor test
          </Button>
        </aside>
      </div>
    </form>
  );
}
