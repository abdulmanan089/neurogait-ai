import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ComposedChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MotorMetrics } from "@/lib/neuro/motor";
import type { VoiceMetrics } from "@/lib/neuro/voice";
import type { OcularMetrics } from "@/lib/neuro/ocular";

const axis = { fontSize: 10, fill: "var(--color-muted-foreground)" };

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="break-inside-avoid rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        {sub && <span className="font-mono text-[10px] text-muted-foreground">{sub}</span>}
      </div>
      <div className="mt-2 h-44">{children}</div>
    </div>
  );
}

export function MotorCharts({ m }: { m: MotorMetrics }) {
  const tapData = m.tapSeries.map((p) => ({ ...p }));
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Panel title="Finger-tap aperture" sub="× hand size · dots = detected taps">
        {tapData.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={tapData} margin={{ top: 4, right: 6, bottom: 0, left: -22 }}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
              <XAxis dataKey="t" type="number" tick={axis} domain={[0, "dataMax"]} tickFormatter={(v) => `${Math.round(v)}s`} />
              <YAxis tick={axis} tickFormatter={(v) => Number(v).toFixed(1)} />
              <Tooltip formatter={(v: number) => v.toFixed(3)} labelFormatter={(l) => `${l} s`} />
              <Line dataKey="d" stroke="var(--color-signal)" dot={false} strokeWidth={1.6} isAnimationActive={false} />
              <Scatter data={m.tapPeaks.map((p) => ({ t: p.t, d: tapData.find((x) => x.t >= p.t)?.d ?? 0 }))} dataKey="d" fill="var(--color-signal-2)" isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <Empty />
        )}
      </Panel>
      <Panel title="Rest displacement (high-pass)" sub="% hand size">
        {m.restSeries.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={m.restSeries} margin={{ top: 4, right: 6, bottom: 0, left: -22 }}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
              <XAxis dataKey="t" type="number" tick={axis} domain={[0, "dataMax"]} tickFormatter={(v) => `${Math.round(v)}s`} />
              <YAxis tick={axis} tickFormatter={(v) => Number(v).toFixed(1)} />
              <Line dataKey="x" stroke="var(--color-signal)" dot={false} strokeWidth={1.4} isAnimationActive={false} />
              <Line dataKey="y" stroke="var(--color-signal-2)" dot={false} strokeWidth={1.2} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <Empty />
        )}
      </Panel>
      <Panel title="Tremor spectrum" sub="shaded: 3–7 Hz parkinsonian band">
        {m.spectrum.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={m.spectrum} margin={{ top: 4, right: 6, bottom: 0, left: -22 }}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
              <XAxis dataKey="f" type="number" tick={axis} domain={[0, 12]} ticks={[0, 3, 5, 7, 9, 12]} tickFormatter={(v) => `${v}Hz`} />
              <YAxis tick={axis} tickFormatter={(v) => Number(v).toFixed(2)} />
              <ReferenceArea x1={3} x2={7} fill="var(--color-risk-moderate)" fillOpacity={0.15} />
              <Tooltip formatter={(v: number) => v.toFixed(3)} labelFormatter={(l) => `${l} Hz`} />
              <Area dataKey="a" stroke="var(--color-signal)" fill="var(--color-signal)" fillOpacity={0.25} isAnimationActive={false} type="monotone" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <Empty />
        )}
      </Panel>
    </div>
  );
}

export function VoiceCharts({ v }: { v: VoiceMetrics }) {
  return (
    <Panel title="Fundamental frequency contour" sub={`mean ${v.f0Mean.toFixed(1)} Hz`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={v.f0Track} margin={{ top: 4, right: 6, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis dataKey="t" type="number" tick={axis} domain={[0, "dataMax"]} tickFormatter={(x) => `${Number(x).toFixed(0)}s`} />
          <YAxis tick={axis} domain={[(d: number) => Math.floor(d * 0.9), (d: number) => Math.ceil(d * 1.1)]} tickFormatter={(x) => `${x}`} />
          {v.f0Mean > 0 && <ReferenceLine y={v.f0Mean} stroke="var(--color-signal-2)" strokeDasharray="4 4" />}
          <Line dataKey="f0" stroke="var(--color-signal)" dot={false} strokeWidth={1.8} isAnimationActive={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </Panel>
  );
}

function GazeTrace({ data }: { data: { t: number; target: number; gaze: number | null }[] }) {
  if (data.length < 2) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: -22 }}>
        <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
        <XAxis dataKey="t" type="number" tick={axis} domain={[0, "dataMax"]} tickFormatter={(v) => `${Math.round(v)}s`} />
        <YAxis tick={axis} domain={[-16, 16]} ticks={[-15, -10, -5, 0, 5, 10, 15]} tickFormatter={(v) => `${v}°`} />
        <Tooltip formatter={(v: number) => `${Number(v).toFixed(1)}°`} labelFormatter={(l) => `${l} s`} />
        <Line dataKey="target" name="Target" stroke="var(--color-signal-2)" dot={false} strokeWidth={1.4} strokeDasharray="4 3" isAnimationActive={false} type="stepAfter" />
        <Line dataKey="gaze" name="Gaze" stroke="var(--color-signal)" dot={false} strokeWidth={1.6} isAnimationActive={false} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function OcularCharts({ o }: { o: OcularMetrics }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Panel title="Horizontal saccades" sub={`median ${o.saccadeLatencyMs.toFixed(0)} ms`}>
        <GazeTrace data={o.saccadeSeries} />
      </Panel>
      <Panel title="Smooth pursuit" sub={`gain ${o.pursuitGain.toFixed(2)}`}>
        <GazeTrace data={o.pursuitSeries} />
      </Panel>
      <Panel title="Central fixation" sub={`SD ${o.fixationSdDeg.toFixed(2)}°`}>
        {o.fixationSeries.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={o.fixationSeries} margin={{ top: 4, right: 6, bottom: 0, left: -22 }}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
              <XAxis dataKey="t" type="number" tick={axis} domain={[0, "dataMax"]} tickFormatter={(v) => `${Math.round(v)}s`} />
              <YAxis tick={axis} domain={[-3, 3]} ticks={[-3, -1.5, 0, 1.5, 3]} tickFormatter={(v) => `${v}°`} allowDataOverflow />
              <ReferenceArea y1={-0.4} y2={0.4} fill="var(--color-risk-low)" fillOpacity={0.12} />
              <Line dataKey="gaze" stroke="var(--color-signal)" dot={false} strokeWidth={1.4} isAnimationActive={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <Empty />
        )}
      </Panel>
    </div>
  );
}

function Empty() {
  return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Not enough tracked data</div>;
}
