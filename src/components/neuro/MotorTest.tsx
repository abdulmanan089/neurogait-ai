import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Hand, Loader2, Play, RotateCcw, Sparkles } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, XAxis, YAxis, CartesianGrid } from "recharts";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  analyzeMotor,
  createHandSimulator,
  HAND_CONNECTIONS,
  landmarksToSample,
  type Landmark,
  type MotorMetrics,
  type MotorPhase,
  type MotorSample,
  type SimProfile,
} from "@/lib/neuro/motor";
import { cn } from "@/lib/utils";
import { cssVar, Metric, SectionTitle, SourceTag } from "./common";
import { MotorCharts } from "./charts";

const SCHEDULE: { id: "prepRest" | "rest" | "prepTap" | "tap"; dur: number; title: string; cue: string }[] = [
  { id: "prepRest", dur: 3, title: "Get ready", cue: "Rest your hand open, palm toward the camera, elbow supported." },
  { id: "rest", dur: 8, title: "Rest tremor", cue: "Keep your hand relaxed and as still as possible." },
  { id: "prepTap", dur: 3, title: "Get ready", cue: "Prepare to tap thumb and index finger together." },
  { id: "tap", dur: 10, title: "Finger tapping", cue: "Tap thumb and index finger as quickly and widely as you can." },
];
const TOTAL = SCHEDULE.reduce((s, p) => s + p.dur, 0);

type Status = "idle" | "loading" | "live" | "running" | "done";
type Mode = "camera" | "simulation";

type Landmarker = { detectForVideo: (v: HTMLVideoElement, t: number) => { landmarks?: Landmark[][] }; close: () => void };

async function loadLandmarker(): Promise<Landmarker> {
  const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm");
  const make = (delegate: "GPU" | "CPU") =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate,
      },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  try {
    return (await make("GPU")) as unknown as Landmarker;
  } catch {
    return (await make("CPU")) as unknown as Landmarker;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string) {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}

function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera access was blocked. Allow camera permission in your browser's address bar, or continue with simulation.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device.";
  if (name === "NotReadableError") return "The camera is being used by another application. Close it and try again.";
  if (e instanceof Error && e.message === "unsupported") return "This browser does not support camera capture here (it may be an embedded preview).";
  return `Hand tracking could not start${e instanceof Error ? ` (${e.message})` : ""}. You can continue with simulation.`;
}

export function MotorTest({
  existing,
  onComplete,
  onBack,
}: {
  existing: MotorMetrics | null;
  onComplete: (m: MotorMetrics | null) => void;
  onBack: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<Landmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const modeRef = useRef<Mode | null>(null);
  const simRef = useRef<ReturnType<typeof createHandSimulator> | null>(null);
  const simStartRef = useRef(0);
  const runStartRef = useRef<number | null>(null);
  const samplesRef = useRef<MotorSample[]>([]);
  const lastVideoTimeRef = useRef(-1);
  const lastUiRef = useRef(0);
  const finishedRef = useRef(false);
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<Status>(existing ? "done" : "idle");
  const [mode, setMode] = useState<Mode | null>(existing ? existing.source : null);
  const [error, setError] = useState<string | null>(null);
  const [simProfile, setSimProfile] = useState<SimProfile>("typical");
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [handSeen, setHandSeen] = useState(false);
  const [live, setLive] = useState<{ t: number; v: number }[]>([]);
  const [result, setResult] = useState<MotorMetrics | null>(existing);

  const stopAll = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    try {
      landmarkerRef.current?.close();
    } catch {
      /* already closed */
    }
    landmarkerRef.current = null;
    runStartRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopAll();
    };
  }, [stopAll]);

  const draw = useCallback((lm: Landmark[] | null) => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const W = c.width;
    const H = c.height;
    ctx.clearRect(0, 0, W, H);
    if (modeRef.current === "simulation") {
      ctx.fillStyle = cssVar("--ink", "#0f172a");
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    }
    if (!lm) return;
    const P = (i: number) => [(lm[i]?.x ?? 0) * W, (lm[i]?.y ?? 0) * H] as const;
    ctx.lineWidth = 3;
    ctx.strokeStyle = cssVar("--signal", "#14b8a6");
    for (const [a, b] of HAND_CONNECTIONS) {
      const [x1, y1] = P(a);
      const [x2, y2] = P(b);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    // Aperture line
    const [tx, ty] = P(4);
    const [ix, iy] = P(8);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = cssVar("--signal-2", "#f97316");
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(ix, iy);
    ctx.stroke();
    ctx.setLineDash([]);
    lm.forEach((_, i) => {
      const [x, y] = P(i);
      ctx.beginPath();
      ctx.arc(x, y, i === 4 || i === 8 ? 7 : 4, 0, Math.PI * 2);
      ctx.fillStyle = i === 4 || i === 8 ? cssVar("--signal-2", "#f97316") : "#ffffff";
      ctx.fill();
    });
  }, []);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const src = modeRef.current ?? "simulation";
    const metrics = analyzeMotor(samplesRef.current, src);
    stopAll();
    if (!mountedRef.current) return;
    setResult(metrics);
    setStatus("done");
  }, [stopAll]);

  const loop = useCallback(() => {
    const now = performance.now();
    let lm: Landmark[] | null = null;
    let fresh = false;
    const running = runStartRef.current != null;
    const el = running ? (now - (runStartRef.current as number)) / 1000 : 0;
    let idx = 0;
    if (running) {
      let acc = 0;
      idx = SCHEDULE.length - 1;
      for (let i = 0; i < SCHEDULE.length; i++) {
        acc += SCHEDULE[i]!.dur;
        if (el < acc) { idx = i; break; }
      }
    }
    const phaseId = running ? (SCHEDULE[idx]?.id ?? "tap") : "idle";
    const phase: MotorPhase | null = phaseId === "rest" ? "rest" : phaseId === "tap" ? "tap" : null;

    if (modeRef.current === "camera") {
      const v = videoRef.current;
      const det = landmarkerRef.current;
      if (v && det && v.readyState >= 2 && v.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = v.currentTime;
        fresh = true;
        try {
          lm = det.detectForVideo(v, now).landmarks?.[0] ?? null;
        } catch {
          lm = null;
        }
        draw(lm);
      }
    } else if (modeRef.current === "simulation" && simRef.current) {
      const t = (now - simStartRef.current) / 1000;
      lm = simRef.current(t, phase ?? "idle");
      fresh = true;
      draw(lm);
    }

    if (running && fresh && phase) {
      samplesRef.current.push(
        lm ? landmarksToSample(lm, el, phase) : { t: el, phase, detected: false, d: 0, tx: 0, ty: 0 },
      );
    }

    if (now - lastUiRef.current > 100) {
      lastUiRef.current = now;
      if (fresh) setHandSeen(!!lm);
      if (running) {
        setElapsed(el);
        setPhaseIdx(idx);
        if (phase) {
          const s = samplesRef.current.filter((x) => x.phase === phase && x.t > el - 4);
          const base = s.find((x) => x.detected);
          setLive(
            s.filter((_, i) => i % 2 === 0).map((x) => ({
              t: Math.round(x.t * 10) / 10,
              v: !x.detected ? NaN : phase === "tap" ? x.d : ((x.tx - (base?.tx ?? 0)) * 100),
            })),
          );
        } else setLive([]);
      }
    }

    if (running && el >= TOTAL) {
      finish();
      return;
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [draw, finish]);

  const startCamera = async () => {
    setError(null);
    setStatus("loading");
    try {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user", frameRate: { ideal: 30 } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) throw new Error("video element missing");
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      landmarkerRef.current = await withTimeout(loadLandmarker(), 25000, "model download timed out");
      if (!mountedRef.current) return stopAll();
      if (canvasRef.current) {
        canvasRef.current.width = v.videoWidth || 640;
        canvasRef.current.height = v.videoHeight || 480;
      }
      modeRef.current = "camera";
      setMode("camera");
      setStatus("live");
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      stopAll();
      if (!mountedRef.current) return;
      setError(cameraError(e));
      setStatus("idle");
    }
  };

  const startSimulation = () => {
    stopAll();
    setError(null);
    simRef.current = createHandSimulator(simProfile);
    simStartRef.current = performance.now();
    if (canvasRef.current) {
      canvasRef.current.width = 640;
      canvasRef.current.height = 480;
    }
    modeRef.current = "simulation";
    setMode("simulation");
    setStatus("live");
    rafRef.current = requestAnimationFrame(loop);
  };

  const beginRun = () => {
    samplesRef.current = [];
    finishedRef.current = false;
    setLive([]);
    setElapsed(0);
    setPhaseIdx(0);
    runStartRef.current = performance.now();
    setStatus("running");
  };

  const reset = () => {
    stopAll();
    finishedRef.current = false;
    setResult(null);
    setMode(null);
    modeRef.current = null;
    setStatus("idle");
  };

  const phase = SCHEDULE[phaseIdx] ?? SCHEDULE[0]!;
  const phaseStart = SCHEDULE.slice(0, phaseIdx).reduce((s, p) => s + p.dur, 0);
  const remaining = Math.max(0, Math.ceil(phaseStart + phase.dur - elapsed));
  const isTap = status === "running" && phase.id === "tap";
  const showFeed = status === "live" || status === "running" || status === "loading";

  return (
    <div>
      <SectionTitle
        eyebrow="Step 2 · Motor"
        title="Tremor & finger-tapping test"
        desc="Hand landmarks are tracked in the browser. We measure rest tremor in the 3–7 Hz band, then tapping speed, amplitude decrement and rhythm."
        right={mode && <SourceTag source={mode} />}
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="relative aspect-[4/3] overflow-hidden rounded-lg border bg-ink">
            <video
              ref={videoRef}
              playsInline
              muted
              className={cn("absolute inset-0 h-full w-full -scale-x-100 object-cover", mode !== "camera" && "invisible")}
            />
            <canvas ref={canvasRef} width={640} height={480} className={cn("absolute inset-0 h-full w-full -scale-x-100 object-cover", !showFeed && "invisible")} />
            {!showFeed && status !== "done" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-ink-foreground">
                <Hand className="h-10 w-10 opacity-60" aria-hidden />
                <p className="max-w-sm text-sm opacity-80">Position the hand about 40–60 cm from the camera in good, even lighting.</p>
              </div>
            )}
            {status === "done" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-ink-foreground">
                <p className="font-mono text-xs uppercase tracking-widest opacity-60">Capture complete</p>
                <p className="text-lg font-semibold">{result?.tapCount ?? 0} taps analysed</p>
              </div>
            )}
            {status === "loading" && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-ink/70 text-sm text-ink-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Starting camera and loading hand model…
              </div>
            )}
            {(status === "live" || status === "running") && (
              <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-3">
                <span className={cn("rounded px-2 py-1 font-mono text-[11px] uppercase", handSeen ? "bg-risk-low text-primary-foreground" : "bg-risk-elevated text-primary-foreground")}>
                  {handSeen ? "Hand tracked" : "No hand detected"}
                </span>
                {mode === "simulation" && <span className="rounded bg-risk-moderate px-2 py-1 font-mono text-[11px] uppercase text-ink">Simulated feed</span>}
              </div>
            )}
            {status === "running" && (
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink to-transparent p-4 text-ink-foreground">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-widest opacity-70">{phase.title}</p>
                    <p className="text-base font-semibold sm:text-lg">{phase.cue}</p>
                  </div>
                  <p className="font-mono text-4xl font-bold tabular">{remaining}</p>
                </div>
                <Progress value={(elapsed / TOTAL) * 100} className="mt-3 h-1.5" />
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {status === "idle" && (
              <>
                <Button onClick={startCamera}>
                  <Camera className="mr-2 h-4 w-4" /> Enable camera
                </Button>
                <Button variant="outline" onClick={startSimulation}>
                  <Sparkles className="mr-2 h-4 w-4" /> Use simulation
                </Button>
                <SimSelect value={simProfile} onChange={setSimProfile} />
              </>
            )}
            {status === "live" && (
              <>
                <Button onClick={beginRun} disabled={mode === "camera" && !handSeen}>
                  <Play className="mr-2 h-4 w-4" /> Start 24-second test
                </Button>
                {mode === "camera" && !handSeen && <span className="text-xs text-muted-foreground">Show your hand to the camera to begin.</span>}
                <Button variant="ghost" onClick={reset}>
                  <CameraOff className="mr-2 h-4 w-4" /> Stop
                </Button>
              </>
            )}
            {status === "running" && (
              <Button variant="outline" onClick={reset}>
                Cancel test
              </Button>
            )}
            {status === "done" && (
              <Button variant="outline" onClick={reset}>
                <RotateCcw className="mr-2 h-4 w-4" /> Repeat test
              </Button>
            )}
          </div>
          {error && (
            <div role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p>{error}</p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={startSimulation}>
                Continue with simulation
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {isTap ? "Thumb–index aperture" : "Index-tip displacement"}
              </h3>
              <span className="font-mono text-[11px] text-muted-foreground">{isTap ? "× hand size" : "% hand size"}</span>
            </div>
            <div className="mt-2 h-40">
              {live.length > 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={live} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                    <XAxis dataKey="t" tick={{ fontSize: 10 }} type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => `${v}s`} />
                    <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} tickFormatter={(v) => Number(v).toFixed(1)} />
                    <Line dataKey="v" stroke="var(--color-signal)" dot={false} strokeWidth={2} isAnimationActive={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Live kinematics appear here during the test.</div>
              )}
            </div>
          </div>
          {result ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Tapping speed" value={result.tapRate.toFixed(2)} unit="taps/s" />
                <Metric label="Amplitude decrement" value={result.amplitudeDecayPct.toFixed(1)} unit="%" />
                <Metric label="Rhythm variability" value={result.rhythmCV.toFixed(1)} unit="% CV" />
                <Metric label="Rest tremor (3–7 Hz)" value={result.tremorAmpPct.toFixed(2)} unit="% hand" hint={result.tremorFreqHz ? `Peak ${result.tremorFreqHz.toFixed(1)} Hz` : "No band peak"} />
              </div>
              {result.qualityNotes.length > 0 && (
                <ul className="list-disc space-y-1 rounded-md border border-risk-moderate/40 bg-risk-moderate/10 p-3 pl-6 text-xs">
                  {result.qualityNotes.map((n) => <li key={n}>{n}</li>)}
                </ul>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Protocol</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>3 s preparation, then 8 s with the hand still (rest tremor).</li>
                <li>3 s preparation, then 10 s of rapid thumb–index tapping.</li>
                <li>Keep the whole hand inside the frame throughout.</li>
              </ol>
            </div>
          )}
        </div>
      </div>

      {result && <div className="mt-6"><MotorCharts m={result} /></div>}

      <div className="mt-8 flex flex-wrap justify-between gap-2 border-t pt-4">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <div className="flex gap-2">
          {!result && <Button variant="outline" onClick={() => { stopAll(); onComplete(null); }}>Skip this module</Button>}
          <Button disabled={!result || status === "running"} onClick={() => onComplete(result)}>Continue to voice test</Button>
        </div>
      </div>
    </div>
  );
}

export function SimSelect({ value, onChange }: { value: SimProfile; onChange: (v: SimProfile) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      Simulated pattern
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SimProfile)}
        className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
      >
        <option value="typical">Typical</option>
        <option value="parkinsonian">Parkinsonian-like</option>
      </select>
    </label>
  );
}
