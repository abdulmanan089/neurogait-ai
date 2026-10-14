import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { fftMagDb } from "@/lib/neuro/dsp";
import { analyzeVoice, livePitch, synthesizeVoice, type VoiceMetrics } from "@/lib/neuro/voice";
import type { SimProfile } from "@/lib/neuro/motor";
import { cn } from "@/lib/utils";
import { cssVar, Metric, SectionTitle, SourceTag } from "./common";
import { SimSelect } from "./MotorTest";
import { VoiceCharts } from "./charts";

type Status = "idle" | "loading" | "countdown" | "recording" | "analyzing" | "done";
type Mode = "microphone" | "simulation";
const COUNTDOWN = 3;
const REC = 5;
const WIN = 4096;

function micError(e: unknown) {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access was blocked. Allow microphone permission in your browser, or continue with simulation.";
  if (name === "NotFoundError") return "No microphone was found on this device.";
  if (name === "NotReadableError") return "The microphone is being used by another application.";
  if (e instanceof Error && e.message === "unsupported") return "This browser does not support microphone capture here (it may be an embedded preview).";
  return `The microphone could not start${e instanceof Error ? ` (${e.message})` : ""}.`;
}

export function VoiceTest({
  existing,
  sex,
  onComplete,
  onBack,
}: {
  existing: VoiceMetrics | null;
  sex: "female" | "male" | "other";
  onComplete: (v: VoiceMetrics | null) => void;
  onBack: () => void;
}) {
  const waveRef = useRef<HTMLCanvasElement>(null);
  const specRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const recentRef = useRef(new Float32Array(WIN));
  const srRef = useRef(44100);
  const simBufRef = useRef<Float32Array | null>(null);
  const modeRef = useRef<Mode | null>(null);
  const t0Ref = useRef(0);
  const recordingRef = useRef(false);
  const doneRef = useRef(false);
  const lastUiRef = useRef(0);
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<Status>(existing ? "done" : "idle");
  const [mode, setMode] = useState<Mode | null>(existing ? existing.source : null);
  const [error, setError] = useState<string | null>(null);
  const [simProfile, setSimProfile] = useState<SimProfile>("typical");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [pitch, setPitch] = useState<number | null>(null);
  const [result, setResult] = useState<VoiceMetrics | null>(existing);

  const teardown = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    recordingRef.current = false;
    try {
      procRef.current?.disconnect();
      srcRef.current?.disconnect();
    } catch {
      /* noop */
    }
    if (procRef.current) procRef.current.onaudioprocess = null;
    procRef.current = null;
    srcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      teardown();
    };
  }, [teardown]);

  const drawViz = useCallback(() => {
    const buf = recentRef.current;
    const w = waveRef.current;
    const s = specRef.current;
    const sig = cssVar("--signal", "#0d9488");
    const sig2 = cssVar("--signal-2", "#f97316");
    if (w) {
      const g = w.getContext("2d");
      if (g) {
        const W = w.width;
        const H = w.height;
        g.clearRect(0, 0, W, H);
        g.strokeStyle = "rgba(255,255,255,0.08)";
        g.beginPath();
        g.moveTo(0, H / 2);
        g.lineTo(W, H / 2);
        g.stroke();
        g.strokeStyle = sig;
        g.lineWidth = 2;
        g.beginPath();
        const n = 2048;
        const off = WIN - n;
        for (let i = 0; i < n; i++) {
          const x = (i / n) * W;
          const y = H / 2 - (buf[off + i] ?? 0) * H * 0.9;
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.stroke();
      }
    }
    if (s) {
      const g = s.getContext("2d");
      if (g) {
        const W = s.width;
        const H = s.height;
        g.clearRect(0, 0, W, H);
        const mags = fftMagDb(buf.subarray(WIN - 2048));
        const sr = srRef.current;
        const maxBin = Math.min(mags.length, Math.floor((4000 / sr) * 2048));
        const bw = W / maxBin;
        for (let k = 1; k < maxBin; k++) {
          const v = Math.max(0, Math.min(1, ((mags[k] ?? -100) + 100) / 80));
          g.fillStyle = k * (sr / 2048) < 500 ? sig2 : sig;
          g.fillRect(k * bw, H - v * H, Math.max(1, bw - 0.5), v * H);
        }
        g.fillStyle = "rgba(255,255,255,0.5)";
        g.font = "10px JetBrains Mono, monospace";
        [0, 1000, 2000, 3000].forEach((f) => g.fillText(`${f / 1000}k`, (f / 4000) * W + 2, 12));
      }
    }
  }, []);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    const m = modeRef.current ?? "simulation";
    const sr = srRef.current;
    let full: Float32Array;
    if (m === "simulation" && simBufRef.current) full = simBufRef.current;
    else {
      const total = chunksRef.current.reduce((s, c) => s + c.length, 0);
      full = new Float32Array(total);
      let o = 0;
      for (const c of chunksRef.current) {
        full.set(c, o);
        o += c.length;
      }
    }
    teardown();
    setStatus("analyzing");
    setTimeout(() => {
      if (!mountedRef.current) return;
      try {
        const r = full.length > sr ? analyzeVoice(full, sr, m) : null;
        if (!r) throw new Error("Recording too short");
        setResult(r);
        setStatus("done");
      } catch (e) {
        setError(`Analysis failed: ${e instanceof Error ? e.message : "unknown error"}. Please try again.`);
        setStatus("idle");
      }
    }, 30);
  }, [teardown]);

  const loop = useCallback(() => {
    const now = performance.now();
    const el = (now - t0Ref.current) / 1000;
    const recEl = el - COUNTDOWN;
    if (recEl >= 0 && !recordingRef.current) {
      recordingRef.current = true;
      setStatus("recording");
    }
    if (modeRef.current === "simulation" && simBufRef.current) {
      const sim = simBufRef.current;
      const r = recentRef.current;
      if (recEl >= 0) {
        const idx = Math.min(sim.length, Math.floor(recEl * srRef.current));
        const startI = Math.max(0, idx - WIN);
        r.fill(0);
        r.set(sim.subarray(startI, idx), WIN - (idx - startI));
      } else for (let i = 0; i < WIN; i++) r[i] = (Math.random() - 0.5) * 0.004;
    }
    drawViz();
    if (now - lastUiRef.current > 100) {
      lastUiRef.current = now;
      const r = recentRef.current;
      let e = 0;
      for (let i = WIN - 2048; i < WIN; i++) e += (r[i] ?? 0) ** 2;
      setLevel(Math.min(1, Math.sqrt(e / 2048) * 6));
      setPitch(livePitch(r.subarray(WIN - 2048), srRef.current));
      setElapsed(el);
    }
    if (recEl >= REC) {
      finish();
      return;
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [drawViz, finish]);

  const begin = (m: Mode) => {
    modeRef.current = m;
    setMode(m);
    chunksRef.current = [];
    recentRef.current.fill(0);
    doneRef.current = false;
    recordingRef.current = false;
    setResult(null);
    setElapsed(0);
    t0Ref.current = performance.now();
    setStatus("countdown");
    rafRef.current = requestAnimationFrame(loop);
  };

  const startMic = async () => {
    setError(null);
    setStatus("loading");
    try {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") throw new Error("unsupported");
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      streamRef.current = stream;
      if (ctx.state === "suspended") await ctx.resume();
      srRef.current = ctx.sampleRate;
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(2048, 1, 1);
      proc.onaudioprocess = (ev) => {
        const d = new Float32Array(ev.inputBuffer.getChannelData(0));
        const r = recentRef.current;
        r.copyWithin(0, d.length);
        r.set(d, WIN - d.length);
        if (recordingRef.current && !doneRef.current) chunksRef.current.push(d);
      };
      src.connect(proc);
      proc.connect(ctx.destination);
      srcRef.current = src;
      procRef.current = proc;
      if (!mountedRef.current) return teardown();
      begin("microphone");
    } catch (e) {
      teardown();
      if (!mountedRef.current) return;
      setError(micError(e));
      setStatus("idle");
    }
  };

  const startSim = () => {
    teardown();
    setError(null);
    srRef.current = 44100;
    simBufRef.current = synthesizeVoice(simProfile, sex, 44100, REC);
    begin("simulation");
  };

  const reset = () => {
    teardown();
    doneRef.current = false;
    setResult(null);
    setMode(null);
    setStatus("idle");
  };

  const active = status === "countdown" || status === "recording";
  const countdownLeft = Math.max(1, Math.ceil(COUNTDOWN - elapsed));
  const recProgress = Math.min(100, Math.max(0, ((elapsed - COUNTDOWN) / REC) * 100));

  return (
    <div>
      <SectionTitle
        eyebrow="Step 3 · Voice"
        title="Sustained phonation test"
        desc="Take a breath and say a steady “ahh” at a comfortable pitch and loudness for 5 seconds. We estimate F0, jitter, shimmer and harmonics-to-noise ratio."
        right={mode && <SourceTag source={mode} />}
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-3">
          <div className="relative overflow-hidden rounded-lg border bg-ink p-4 text-ink-foreground">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono uppercase tracking-widest opacity-70">Waveform</span>
              <span className="font-mono tabular">
                F0 {pitch ? `${pitch.toFixed(0)} Hz` : "—"}
              </span>
            </div>
            <canvas ref={waveRef} width={800} height={160} className="mt-2 h-32 w-full" />
            <div className="mt-3 flex items-center justify-between text-xs">
              <span className="font-mono uppercase tracking-widest opacity-70">Spectrum 0–4 kHz</span>
              <span className="opacity-60">orange: F0 region</span>
            </div>
            <canvas ref={specRef} width={800} height={140} className="mt-2 h-28 w-full" />
            {!active && status !== "loading" && status !== "analyzing" && (
              <div className="absolute inset-0 flex items-center justify-center bg-ink/80 p-6 text-center">
                <p className="max-w-sm text-sm opacity-80">
                  {status === "done" ? "Recording complete. Results are shown alongside." : "Sit upright in a quiet room, about 20–30 cm from the microphone."}
                </p>
              </div>
            )}
            {(status === "loading" || status === "analyzing") && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-ink/80 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> {status === "loading" ? "Waiting for microphone…" : "Analysing glottal cycles…"}
              </div>
            )}
            {status === "countdown" && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-ink/60">
                <p className="text-sm opacity-80">Breathe in… start “ahh” when the count ends</p>
                <p className="font-mono text-6xl font-bold">{countdownLeft}</p>
              </div>
            )}
          </div>
          {active && (
            <div className="rounded-md border bg-card p-3">
              <div className="flex items-center justify-between text-xs">
                <span className={cn("font-semibold", status === "recording" ? "text-risk-elevated" : "text-muted-foreground")}>
                  {status === "recording" ? "● Recording — keep saying “ahh”" : "Get ready"}
                </span>
                <span className="font-mono tabular">{status === "recording" ? `${Math.max(0, elapsed - COUNTDOWN).toFixed(1)} / ${REC}.0 s` : ""}</span>
              </div>
              <Progress value={recProgress} className="mt-2 h-1.5" />
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                Input level
                <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                  <div className={cn("h-full transition-[width]", level > 0.95 ? "bg-risk-elevated" : "bg-risk-low")} style={{ width: `${level * 100}%` }} />
                </div>
                {status === "recording" && level < 0.05 && <span className="text-risk-moderate">Too quiet</span>}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {status === "idle" && (
              <>
                <Button onClick={startMic}>
                  <Mic className="mr-2 h-4 w-4" /> Enable microphone & record
                </Button>
                <Button variant="outline" onClick={startSim}>
                  <Sparkles className="mr-2 h-4 w-4" /> Use simulation
                </Button>
                <SimSelect value={simProfile} onChange={setSimProfile} />
              </>
            )}
            {active && (
              <Button variant="outline" onClick={reset}>
                Cancel
              </Button>
            )}
            {status === "done" && (
              <Button variant="outline" onClick={reset}>
                <RotateCcw className="mr-2 h-4 w-4" /> Record again
              </Button>
            )}
          </div>
          {error && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p>{error}</p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={startSim}>
                Continue with simulation
              </Button>
            </div>
          )}
        </div>
        <div className="space-y-3 lg:col-span-2">
          {result ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Mean F0" value={result.f0Mean.toFixed(1)} unit="Hz" hint={`SD ${result.f0Sd.toFixed(1)} Hz`} />
                <Metric label="Jitter (local)" value={result.jitterPct.toFixed(2)} unit="%" hint="Ref ≤ 1.04 %" tone={result.jitterPct > 1.04 ? "warn" : "good"} />
                <Metric label="Shimmer (local)" value={result.shimmerPct.toFixed(2)} unit="%" hint="Ref ≤ 3.81 %" tone={result.shimmerPct > 3.81 ? "warn" : "good"} />
                <Metric label="HNR" value={result.hnrDb.toFixed(1)} unit="dB" hint="Ref ≥ 20 dB" tone={result.hnrDb < 20 ? "warn" : "good"} />
              </div>
              <p className="text-xs text-muted-foreground">Voiced frames: {result.voicedPct.toFixed(0)}% of {result.durationS.toFixed(1)} s.</p>
              {result.qualityNotes.length > 0 && (
                <ul className="list-disc space-y-1 rounded-md border border-risk-moderate/40 bg-risk-moderate/10 p-3 pl-6 text-xs">
                  {result.qualityNotes.map((n) => <li key={n}>{n}</li>)}
                </ul>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">What is measured</p>
              <dl className="mt-2 space-y-2">
                <div><dt className="font-medium text-foreground">F0</dt><dd>Average pitch of the voice.</dd></div>
                <div><dt className="font-medium text-foreground">Jitter</dt><dd>Cycle-to-cycle instability of pitch.</dd></div>
                <div><dt className="font-medium text-foreground">Shimmer</dt><dd>Cycle-to-cycle variation in loudness.</dd></div>
                <div><dt className="font-medium text-foreground">HNR</dt><dd>How clear the voice is relative to breathiness/noise.</dd></div>
              </dl>
            </div>
          )}
        </div>
      </div>
      {result && <div className="mt-6"><VoiceCharts v={result} /></div>}
      <div className="mt-8 flex flex-wrap justify-between gap-2 border-t pt-4">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <div className="flex gap-2">
          {!result && <Button variant="outline" onClick={() => { teardown(); onComplete(null); }}>Skip this module</Button>}
          <Button disabled={!result} onClick={() => onComplete(result)}>View screening results</Button>
        </div>
      </div>
    </div>
  );
}
