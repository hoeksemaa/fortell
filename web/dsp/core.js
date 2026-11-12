// Small DSP toolkit: levels and calibration, noise, FFT, filters, delays, WAV parsing.
// Pure functions on Float32Array; no DOM. Used by the browser and by the Node tests.

export const FS = 16000; // sample rate (Hz). Fortell does not publish theirs.
export const P0 = 20e-6; // reference pressure (Pa)
export const FULL_SCALE_SPL = 120; // calibration: digital RMS 1.0 = 120 dB SPL (my choice)
export const PA_PER_UNIT = P0 * 10 ** (FULL_SCALE_SPL / 20); // 20 Pa per digital unit

export const toSpl = (meanSq) => FULL_SCALE_SPL + 10 * Math.log10(Math.max(meanSq, 1e-30));
export const rmsForSpl = (spl) => 10 ** ((spl - FULL_SCALE_SPL) / 20);
export const dbToLin = (db) => 10 ** (db / 20);
export const linToDb = (g) => 20 * Math.log10(Math.max(g, 1e-12));

export function meanSquare(x, a = 0, b = x.length) {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return s / Math.max(1, b - a);
}
export const splOf = (x, a, b) => toSpl(meanSquare(x, a, b));

/** Scale x in place so its level (over [a, b)) is `spl` dB SPL. */
export function scaleToSpl(x, spl, a = 0, b = x.length) {
  const g = rmsForSpl(spl) / Math.sqrt(Math.max(meanSquare(x, a, b), 1e-30));
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

// ---------- deterministic noise ----------
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function white(n, r) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u = Math.max(r(), 1e-12), v = r(), m = Math.sqrt(-2 * Math.log(u));
    x[i] = m * Math.cos(2 * Math.PI * v);
    if (i + 1 < n) x[i + 1] = m * Math.sin(2 * Math.PI * v);
  }
  return x;
}
/** Pink noise (-3 dB/octave), Paul Kellet's filter. */
export function pink(n, r) {
  const w = white(n, r), x = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const v = w[i];
    b0 = 0.99886 * b0 + v * 0.0555179; b1 = 0.99332 * b1 + v * 0.0750759; b2 = 0.969 * b2 + v * 0.153852;
    b3 = 0.8665 * b3 + v * 0.3104856; b4 = 0.55 * b4 + v * 0.5329522; b5 = -0.7616 * b5 - v * 0.016898;
    x[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + v * 0.5362; b6 = v * 0.115926;
  }
  return x;
}

// ---------- FFT (radix-2, in place) ----------
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// ---------- filters ----------
/** Audio EQ Cookbook biquad. Returns normalized {b0,b1,b2,a1,a2}. */
export function biquadCoefs(type, f0, q = Math.SQRT1_2, gainDb = 0, fs = FS) {
  const w0 = (2 * Math.PI * f0) / fs, c = Math.cos(w0), s = Math.sin(w0), al = s / (2 * q), A = 10 ** (gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === "lowpass") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === "highpass") { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === "peaking") { b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; }
  else throw new Error("biquad type " + type);
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
export function biquad(x, k) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = k.b0 * x[i] + k.b1 * x1 + k.b2 * x2 - k.a1 * y1 - k.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
export const cascade = (x, list) => list.reduce((s, k) => biquad(s, k), x);
/** Complex response of a biquad at frequency f: [re, im]. */
export function biquadResp(k, f, fs = FS) {
  const w = (2 * Math.PI * f) / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = k.b0 + k.b1 * c1 + k.b2 * c2, ni = -(k.b1 * s1 + k.b2 * s2);
  const dr = 1 + k.a1 * c1 + k.a2 * c2, di = -(k.a1 * s1 + k.a2 * s2), dd = dr * dr + di * di;
  return [(nr * dr + ni * di) / dd, (ni * dr - nr * di) / dd];
}
export function cascadeMagDb(list, f) {
  let re = 1, im = 0;
  for (const k of list) { const [a, b] = biquadResp(k, f); const r = re * a - im * b; im = re * b + im * a; re = r; }
  return 10 * Math.log10(re * re + im * im);
}

/** Causal FIR: y[n] = sum_k h[k] x[n-k]. */
export function convolve(x, h) {
  const y = new Float32Array(x.length), L = h.length;
  for (let n = 0; n < x.length; n++) {
    let s = 0;
    const kmax = Math.min(L - 1, n);
    for (let k = 0; k <= kmax; k++) s += h[k] * x[n - k];
    y[n] = s;
  }
  return y;
}
/** Windowed-sinc fractional delay. Total delay = `delay` samples; needs 8 <= delay <= taps - 9. */
export function fracDelayKernel(delay, taps = 33) {
  const h = new Float32Array(taps), half = (taps - 1) / 2;
  let sum = 0;
  for (let k = 0; k < taps; k++) {
    const t = k - delay, u = (k - delay + half) / (taps - 1); // window position 0..1
    const sinc = Math.abs(t) < 1e-9 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const win = u <= 0 || u >= 1 ? 0 : 0.42 - 0.5 * Math.cos(2 * Math.PI * u) + 0.08 * Math.cos(4 * Math.PI * u);
    h[k] = sinc * win; sum += h[k];
  }
  for (let k = 0; k < taps; k++) h[k] /= sum;
  return h;
}
export function delayInt(x, d) {
  const y = new Float32Array(x.length);
  for (let i = d; i < x.length; i++) y[i] = x[i - d];
  return y;
}
export function add(a, b, g = 1) { const y = new Float32Array(a.length); for (let i = 0; i < a.length; i++) y[i] = a[i] + g * b[i]; return y; }
export function scale(a, g) { const y = new Float32Array(a.length); for (let i = 0; i < a.length; i++) y[i] = a[i] * g; return y; }

// ---------- WAV (PCM 16-bit, mono or stereo) ----------
export function parseWav(ab) {
  const v = new DataView(ab);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let o = 12, sr = 0, ch = 1, bits = 16;
  while (o + 8 <= v.byteLength) {
    const id = tag(o), size = v.getUint32(o + 4, true);
    if (id === "fmt ") { ch = v.getUint16(o + 10, true); sr = v.getUint32(o + 12, true); bits = v.getUint16(o + 22, true); }
    if (id === "data") {
      if (bits !== 16) throw new Error("need 16-bit PCM");
      const n = Math.floor(size / (2 * ch)), x = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < ch; c++) s += v.getInt16(o + 8 + (i * ch + c) * 2, true);
        x[i] = s / ch / 32768;
      }
      return { sr, data: x };
    }
    o += 8 + size + (size & 1);
  }
  throw new Error("no data chunk");
}

/** Convolve x with several long kernels by FFT (one forward FFT of x, one inverse per kernel). Output length = x.length. */
export function fftConvolveMany(x, hs) {
  let n = 1; const need = x.length + Math.max(...hs.map((h) => h.length));
  while (n < need) n <<= 1;
  const xr = new Float64Array(n), xi = new Float64Array(n);
  xr.set(x); fft(xr, xi);
  return hs.map((h) => {
    const hr = new Float64Array(n), hi = new Float64Array(n);
    hr.set(h); fft(hr, hi);
    for (let k = 0; k < n; k++) { const r = xr[k] * hr[k] - xi[k] * hi[k], i = xr[k] * hi[k] + xi[k] * hr[k]; hr[k] = r; hi[k] = i; }
    fft(hr, hi, true);
    return Float32Array.from(hr.subarray(0, x.length));
  });
}
