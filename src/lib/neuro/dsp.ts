// Pure, browser-safe signal processing helpers (no module-scope side effects).

export function mean(a: ArrayLike<number>): number {
  if (!a.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
}

export function std(a: ArrayLike<number>): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - m) ** 2;
  return Math.sqrt(s / (a.length - 1));
}

export function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** Centered moving average. */
export function movingAvg(a: number[], w: number): number[] {
  const n = a.length;
  if (w <= 1 || n === 0) return [...a];
  const half = Math.floor(w / 2);
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    out[i] = (pre[hi] - pre[lo]) / (hi - lo);
  }
  return out;
}

/** Linear-interpolated uniform resampling of irregular samples. */
export function resampleUniform(t: number[], v: number[], fs: number) {
  if (t.length < 2) return { t: [] as number[], v: [] as number[] };
  const t0 = t[0];
  const t1 = t[t.length - 1];
  const n = Math.floor((t1 - t0) * fs) + 1;
  const ot: number[] = [];
  const ov: number[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const tt = t0 + i / fs;
    while (j < t.length - 2 && t[j + 1] < tt) j++;
    const dt = t[j + 1] - t[j] || 1e-9;
    const f = clamp((tt - t[j]) / dt, 0, 1);
    ot.push(tt);
    ov.push(v[j] + (v[j + 1] - v[j]) * f);
  }
  return { t: ot, v: ov };
}

/** Squared magnitude of DFT bins 0..N/2 (direct DFT; fine for N ≲ 600). */
export function dftPower(x: number[]): number[] {
  const N = x.length;
  const out: number[] = [];
  for (let k = 0; k <= N / 2; k++) {
    let re = 0;
    let im = 0;
    const w = (-2 * Math.PI * k) / N;
    for (let n = 0; n < N; n++) {
      re += x[n] * Math.cos(w * n);
      im += x[n] * Math.sin(w * n);
    }
    out.push(re * re + im * im);
  }
  return out;
}

/** In-place radix-2 FFT magnitude spectrum in dB with a Hann window. Length must be a power of 2. */
export function fftMagDb(input: Float32Array): Float32Array {
  const N = input.length;
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let i = 0; i < N; i++) re[i] = input[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  const out = new Float32Array(N / 2);
  for (let k = 0; k < N / 2; k++) {
    const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / N;
    out[k] = 20 * Math.log10(mag + 1e-9);
  }
  return out;
}

export function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function downsampleSeries<T>(a: T[], max: number): T[] {
  if (a.length <= max) return a;
  const step = a.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(a[Math.floor(i * step)]);
  return out;
}

export function round(v: number, d = 2) {
  const p = 10 ** d;
  return Math.round(v * p) / p;
}
