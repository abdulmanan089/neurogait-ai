import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Eye, Loader2, Play, RotateCcw, Sparkles } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  analyzeOcular,
  buildSaccadePlan,
  createEyeSimulator,
  DEG_PER_UNIT,
  faceToEye,
  liveMapper,
  pursuitTarget,
  targetAt,
  type FaceLandmark,
  type OcularMetrics,
  type OcularPhase,
  type OcularSample,
  type OcularSimProfile,
} from "@/lib/neuro/ocular";
import { cn } from "@/lib/utils";
import { cssVar, Metric, SectionTitle, SourceTag } from "./common";
import { OcularCharts } from "./charts";

type StepId = "prepFix" | "fixation" | "prepSac" | "saccade" | "prepPur" | "pursuit";
const SCHEDULE: { id: StepId; dur: number; title: string; cue: string }[] = [
  { id: "prepFix", dur: 3, title: "Get ready", cue: "Keep your head still and look at the dot." },
  { id: "fixation", dur: 6, title: "Fixation", cue: "Hold your gaze steadily on the centre dot." },
  { id: "prepSac", dur: 2, title: "Get ready", cue: "The dot will now jump. Follow it with your eyes only." },
  { id: "saccade", dur: 13, title: "Saccades", cue: "Look at the dot as quickly as you can each time it jumps." },
  { id: "prepPur", dur: 2, title: "Get ready", cue: "The dot will now glide smoothly. Follow it." },
  { id: "pursuit", dur: 10, title: "Smooth pursuit", cue: "Track the moving dot smoothly, keeping your head still." },
];
const TOTAL = SCHEDULE.reduce((s, p) => s + p.dur, 0);
const SAC_DUR = SCHEDULE.find((s) => s.id === "saccade")!.dur;

type Status = "idle" | "loading" | "live" | "running" | "done";
type Mode = "camera" | "simulation";
type Landmarker = { detectForVideo: (v: HTMLVideoElement, t: number) => { faceLandmarks?: FaceLandmark[][] }; close: () => void };

const EYE_RING = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
const IRIS = [468, 469, 470, 471, 472, 473, 474, 475, 476, 477];

async function loadLandmarker(): Promise<Landmarker> {
  const { FilesetResolver, FaceLandmarker } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm");
  const make = (delegate: "GPU" | "CPU") =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate,
      },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
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
  return `Eye tracking could not start${e instanceof Error ? ` (${e.message})` : ""}. You can continue with simulation.`;
}

function locate(el: number) {
  let acc = 0;
  for (let i = 0; i < SCHEDULE.length; i++) {
    const s = SCHEDULE[i]!;
    if (el < acc + s.dur) return { idx: i, local: el - acc };
    acc += s.dur;
  }
  return { idx: SCHEDULE.length - 1, local: SCHEDULE[SCHEDULE.length - 1]!.dur };
}

export function OcularTest({
  existing,
  onComplete,
  onBack,
}: {
  existing: OcularMetrics | null;
  onComplete: (o: OcularMetrics | null) => void;
  onBack: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<Landmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const modeRef = useRef<Mode | null>(null);
  const simRef = useRef<ReturnType<typeof createEyeSimulator> | null>(null);
  const simStartRef = useRef(0);
  const runStartRef = useRef<number | null>(null);
  const planRef = useRef(buildSaccadePlan(SAC_DUR));
  const samplesRef = useRef<OcularSample[]>([]);
  const lastVideoTimeRef = useRef(-1);
  const lastUiRef = useRef(0);
  const finishedRef = useRef(false);
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<Status>(existing ? "done" : "idle");
  const [mode, setMode] = useState<Mode | null>(existing ? existing.source : null);
  const [error, setError] = useState<string | null>(null);
  const [simProfile, setSimProfile] = useState<OcularSimProfile>("typical");
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [eyesSeen, setEyesSeen] = useState(false);
  const [live, setLive] = useState<{ t: number; target: number; gaze: number | null }[]>([]);
  const [result, setResult] = useState<OcularMetrics | null>(existing);

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
    simRef.current = null;
    runStartRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopAll();
    };
  }, [stopAll]);

  const placeDot = (tx: number) => {
    if (dotRef.current) dotRef.current.style.left = `${50 + tx * 45}%`;
  };

  const drawCamera = useCallback((lm: FaceLandmark[] | null) => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!lm) return;
    ctx.fillStyle = cssVar("--signal", "#14b8a6");
    for (const i of EYE_RING) {
      const p = lm[i];
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x * c.width, p.y * c.height, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = cssVar("--signal-2", "#f97316");
    for (const i of IRIS) {
      const p = lm[i];
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x * c.width, p.y * c.height, i === 468 || i === 473 ? 3.5 : 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }, []);

  const drawSim = useCallback((rx: number, ry: number) => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const W = c.width;
    const H = c.height;
    ctx.fillStyle = cssVar("--ink", "#0f172a");
    ctx.fillRect(0, 0, W, H);
    for (const cx of [W * 0.3, W * 0.7]) {
      const cy = H * 0.5;
      const ew = W * 0.16;
      const eh = H * 0.16;
      ctx.beginPath();
      ctx.ellipse(cx, cy, ew, eh, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#f8fafc";
      ctx.fill();
      // Mirrored preview: subject looking to their right appears to the right on screen.
      const ix = cx + (0.5 - rx) * ew * 3.2;
      const iy = cy + (ry - 0.5) * eh * 2;
      ctx.beginPath();
      ctx.arc(ix, iy, eh * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = cssVar("--signal", "#14b8a6");
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ix, iy, eh * 0.28, 0, Math.PI * 2);
      ctx.fillStyle = "#020617";
      ctx.fill();
    }
  }, []);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const metrics = analyzeOcular(samplesRef.current, modeRef.current ?? "simulation");
    stopAll();
    placeDot(0);
    if (!mountedRef.current) return;
    setResult(metrics);
    setStatus("done");
  }, [stopAll]);

  const loop = useCallback(() => {
    const now = performance.now();
    const running = runStartRef.current != null;
    const el = running ? (now - (runStartRef.current as number)) / 1000 : 0;
    const { idx, local } = running ? locate(el) : { idx: 0, local: 0 };
    const step = running ? SCHEDULE[idx]!.id : "prepFix";
    const tx = step === "saccade" ? targetAt(planRef.current, local) : step === "pursuit" ? pursuitTarget(local) : 0;
    const phase: OcularPhase | null = step === "fixation" || step === "saccade" || step === "pursuit" ? step : null;
    placeDot(tx);

    let eye: { rx: number; ry: number } | null = null;
    let fresh = false;
    if (modeRef.current === "camera") {
      const v = videoRef.current;
      const det = landmarkerRef.current;
      if (v && det && v.readyState >= 2 && v.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = v.currentTime;
        fresh = true;
        let lm: FaceLandmark[] | null = null;
        try {
          lm = det.detectForVideo(v, now).faceLandmarks?.[0] ?? null;
        } catch {
          lm = null;
        }
        drawCamera(lm);
        eye = faceToEye(lm);
      }
    } else if (modeRef.current === "simulation" && simRef.current) {
      eye = simRef.current((now - simStartRef.current) / 1000, tx, phase ?? "fixation");
      fresh = true;
      drawSim(eye.rx, eye.ry);
    }

    if (running && fresh && phase) {
      samplesRef.current.push({ t: el, phase, tx, rx: eye?.rx ?? 0, ry: eye?.ry ?? 0, detected: !!eye });
    }

    if (now - lastUiRef.current > 100) {
      lastUiRef.current = now;
      if (fresh) setEyesSeen(!!eye);
      if (running) {
        setElapsed(el);
        setPhaseIdx(idx);
        const map = liveMapper(samplesRef.current);
        const recent = samplesRef.current.filter((s) => s.t > el - 5);
        setLive(
          recent
            .filter((_, i) => i % 2 === 0)
            .map((s) => ({
              t: Math.round(s.t * 10) / 10,
              target: Math.round(s.tx * DEG_PER_UNIT * 10) / 10,
              gaze: s.detected ? Math.max(-20, Math.min(20, Math.round(map(s.rx) * 10) / 10)) : null,
            })),
        );
      }
    }

    if (running && el >= TOTAL) {
      finish();
      return;
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [drawCamera, drawSim, finish]);

  const startCamera = async () => {
    setError(null);
    setStatus("loading");
    try {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user", frameRate: { ideal: 30 } },
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
    simRef.current = createEyeSimulator(simProfile);
    simStartRef.current = performance.now();
    if (canvasRef.current) {
      canvasRef.current.width = 640;
      canvasRef.current.height = 360;
    }
    modeRef.current = "simulation";
    setMode("simulation");
    setStatus("live");
    rafRef.current = requestAnimationFrame(loop);
  };

  const beginRun = () => {
    samplesRef.current = [];
    planRef.current = buildSaccadePlan(SAC_DUR);
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
    placeDot(0);
    setResult(null);
    setMode(null);
    modeRef.current = null;
    setStatus("idle");
  };

  const phase = SCHEDULE[phaseIdx] ?? SCHEDULE[0]!;
  const phaseStart = SCHEDULE.slice(0, phaseIdx).reduce((s, p) => s + p.dur, 0);
  const remaining = Math.max(0, Math.ceil(phaseStart + phase.dur - elapsed));
  const showFeed = status === "live" || status === "running" || status === "loading";
  const latTone = result ? (result.saccadeLatencyMs > 300 ? "bad" : result.saccadeLatencyMs > 250 ? "warn" : "good") : "default";

  return (
    <div>
      <SectionTitle
        eyebrow="Step 4 · Oculomotor"
        title="Saccade, pursuit & fixation test"
        desc="Iris landmarks are tracked in the browser while the patient follows a dot. We measure saccadic latency, smooth-pursuit gain and fixation stability."
        right={mode && <SourceTag source={mode} />}
      />

      <div className="relative aspect-[16/7] w-full overflow-hidden rounded-lg border bg-ink sm:aspect-[16/6]">
        <div className="absolute inset-y-0 left-1/2 w-px bg-ink-foreground/10" aria-hidden />
        <div
          ref={dotRef}
          aria-hidden
          className={cn(
            "absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal-2 ring-4 ring-signal-2/30",
            status === "idle" && "opacity-40",
          )}
          style={{ left: "50%" }}
        >
          <span className="absolute inset-[7px] rounded-full bg-ink" />
        </div>
        {status !== "running" && (
          <div className="absolute inset-x-0 top-0 p-4 text-center text-ink-foreground">
            <p className="font-mono text-xs uppercase tracking-widest opacity-70">Visual stimulus</p>
            <p className="mt-1 text-sm opacity-80">
              {status === "done" ? `Capture complete · ${result?.saccadeCount ?? 0} saccades timed` : "Sit about 50–60 cm from the screen, keep your head still and follow the dot with your eyes only."}
            </p>
          </div>
        )}
        {status === "running" && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink to-transparent p-4 text-ink-foreground">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-widest opacity-70">{phase.title}</p>
                <p className="text-sm font-semibold sm:text-base">{phase.cue}</p>
              </div>
              <p className="font-mono text-3xl font-bold tabular">{remaining}</p>
            </div>
            <Progress value={(elapsed / TOTAL) * 100} className="mt-3 h-1.5" />
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <div className="relative aspect-video overflow-hidden rounded-lg border bg-ink">
            <video ref={videoRef} playsInline muted className={cn("absolute inset-0 h-full w-full -scale-x-100 object-cover", mode !== "camera" && "invisible")} />
            <canvas ref={canvasRef} width={640} height={360} className={cn("absolute inset-0 h-full w-full object-cover", mode !== "simulation" && "-scale-x-100", !showFeed && "invisible")} />
            {!showFeed && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-ink-foreground">
                <Eye className="h-8 w-8 opacity-60" aria-hidden />
                <p className="max-w-xs text-xs opacity-80">Face the camera in even lighting. Remove glasses if they cause glare.</p>
              </div>
            )}
            {status === "loading" && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-ink/70 text-sm text-ink-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Starting camera and loading face model…
              </div>
            )}
            {(status === "live" || status === "running") && (
              <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-2">
                <span className={cn("rounded px-2 py-1 font-mono text-[10px] uppercase text-primary-foreground", eyesSeen ? "bg-risk-low" : "bg-risk-elevated")}>
                  {eyesSeen ? "Irises tracked" : "Eyes not detected"}
                </span>
                {mode === "simulation" && <span className="rounded bg-risk-moderate px-2 py-1 font-mono text-[10px] uppercase text-ink">Simulated feed</span>}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {status === "idle" && (
              <>
                <Button onClick={startCamera}><Camera className="mr-2 h-4 w-4" /> Enable camera</Button>
                <Button variant="outline" onClick={startSimulation}><Sparkles className="mr-2 h-4 w-4" /> Use simulation</Button>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Simulated pattern
                  <select value={simProfile} onChange={(e) => setSimProfile(e.target.value as OcularSimProfile)} className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground">
                    <option value="typical">Typical</option>
                    <option value="parkinsonian">Parkinsonian-like</option>
                  </select>
                </label>
              </>
            )}
            {status === "live" && (
              <>
                <Button onClick={beginRun} disabled={mode === "camera" && !eyesSeen}><Play className="mr-2 h-4 w-4" /> Start {TOTAL}s test</Button>
                {mode === "camera" && <Button variant="outline" onClick={startSimulation}><Sparkles className="mr-2 h-4 w-4" /> Use simulation instead</Button>}
                <Button variant="ghost" onClick={reset}><CameraOff className="mr-2 h-4 w-4" /> Stop</Button>
              </>
            )}
            {status === "running" && <Button variant="outline" onClick={reset}>Cancel test</Button>}
            {status === "done" && <Button variant="outline" onClick={reset}><RotateCcw className="mr-2 h-4 w-4" /> Repeat test</Button>}
          </div>
          {error && (
            <div role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p>{error}</p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={startSimulation}>Continue with simulation</Button>
            </div>
          )}
        </div>

        <div className="space-y-4 lg:col-span-3">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Live gaze vs. target (horizontal)</h3>
              <span className="font-mono text-[11px] text-muted-foreground">degrees · dashed = target</span>
            </div>
            <div className="mt-2 h-44">
              {live.length > 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={live} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                    <XAxis dataKey="t" tick={{ fontSize: 10 }} type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => `${v}s`} />
                    <YAxis tick={{ fontSize: 10 }} domain={[-16, 16]} ticks={[-15, 0, 15]} tickFormatter={(v) => `${v}°`} allowDataOverflow />
                    <Line dataKey="target" stroke="var(--color-signal-2)" dot={false} strokeWidth={1.5} strokeDasharray="4 3" isAnimationActive={false} type="stepAfter" />
                    <Line dataKey="gaze" stroke="var(--color-signal)" dot={false} strokeWidth={2} isAnimationActive={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Live gaze trace appears here during the test.</div>
              )}
            </div>
          </div>
          {result ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Saccadic latency" value={result.saccadeLatencyMs.toFixed(0)} unit="ms" hint={`± ${result.saccadeLatencySdMs.toFixed(0)} ms · n=${result.saccadeCount}`} tone={latTone} />
                <Metric label="Saccade gain" value={result.saccadeGain.toFixed(2)} hint="1.0 = on target" />
                <Metric label="Pursuit gain" value={result.pursuitGain.toFixed(2)} hint={`${result.pursuitPeakVelDeg.toFixed(0)}°/s peak · ${result.catchUpPerSec.toFixed(1)} catch-up/s`} tone={result.pursuitGain < 0.7 ? "bad" : result.pursuitGain < 0.85 ? "warn" : "good"} />
                <Metric label="Fixation SD" value={result.fixationSdDeg.toFixed(2)} unit="°" hint={`${result.intrusionsPerSec.toFixed(1)} intrusions/s`} tone={result.fixationSdDeg > 0.8 ? "bad" : result.fixationSdDeg > 0.4 ? "warn" : "good"} />
              </div>
              {result.qualityNotes.length > 0 && (
                <ul className="list-disc space-y-1 rounded-md border border-risk-moderate/40 bg-risk-moderate/10 p-3 pl-6 text-xs">
                  {result.qualityNotes.map((n) => <li key={n}>{n}</li>)}
                </ul>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Protocol ({TOTAL} s)</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>6 s steady fixation on the centre dot (stability, drift, intrusions).</li>
                <li>13 s of horizontal ±10° jumps at unpredictable intervals (latency, gain).</li>
                <li>10 s of sinusoidal smooth pursuit at 0.35 Hz (pursuit gain, catch-up saccades).</li>
              </ol>
              <p className="mt-2 text-xs">Gaze is calibrated per session from the settled saccade positions.</p>
            </div>
          )}
        </div>
      </div>

      {result && <div className="mt-6"><OcularCharts o={result} /></div>}

      <div className="mt-8 flex flex-wrap justify-between gap-2 border-t pt-4">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <div className="flex gap-2">
          {!result && <Button variant="outline" onClick={() => { stopAll(); onComplete(null); }}>Skip this module</Button>}
          <Button disabled={!result || status === "running"} onClick={() => onComplete(result)}>Continue to results</Button>
        </div>
      </div>
    </div>
  );
}
