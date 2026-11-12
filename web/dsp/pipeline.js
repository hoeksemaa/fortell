// The rebuilt pipeline: a test scene and 12 steps. Each step is a pure function
//   out = step(in, settings)
// and step k+1 reads the output of step k. Change a step and every later step changes.
//
// Every signal carries its parts (one per sound source) beside the mix. Each step is linear
// once its decisions are made (filter taps, gains, masks), so it applies the same operation to
// every part. The parts always sum to the mix, and each step can report each source's level.
import {
  FS, toSpl, rmsForSpl, dbToLin, linToDb, meanSquare, scaleToSpl, rng, white, pink, fft,
  biquadCoefs, biquad, cascade, cascadeMagDb, convolve, fracDelayKernel, delayInt, add, scale, fftConvolveMany,
} from "./core.js";

export const PARTS = ["target", "talker2", "noise", "wind", "clatter", "leak"];

// ---------- parameters (sources and status are in data.js) ----------
export const P = {
  dur: 3.5,
  rt60: 0.4, drrDb: 3, revAngles: [45, 135, 225, 315], // room: each talker also arrives as reverb from 4 sides
  micSpacing: 0.010, c: 343, baseDelay: 16, // m, m/s, samples (1 ms alignment delay)
  mismatchDb: 1.5, // rear mic reads 1.5 dB hot
  einSpl: 29, // mic self-noise, IFU omni EIN
  aidGainDb: 25, leakDelayMs: 6, leakPeakDb: -30, leakF0: 3200, // feedback stand-in
  nlmsTaps: 32, fitS: 1, fitMu: 0.02, probeSpl: 85, fitRoomSpl: 30, // fitting-time path measurement
  windFc: 300, windRho: 0.6, windMinSpl: 50, windCutDb: -20,
  dirNoiseDb: 9, // IFU: EIN 29 dB SPL omni, 38 directional

  nfft: 64, hop: 32, // 4 ms frame, 2 ms step at 16 kHz
  aCurve: [[40, 0.3], [60, 0.1], [80, 0.1], [100, 0.3]], // mix-back noise weight vs noise level
  floorDb: -12, msWindowS: 0.8, msBias: 1.5,
  attackMs: 13, releaseMs: 470, cr: 2, kneeSpl: 45, refSpl: 55, maxGainDb: 55,
  audiogram: [[250, 35], [500, 35], [750, 35], [1000, 40], [1500, 45], [2000, 50], [3000, 55], [4000, 60], [6000, 65]],
  mpoSpl: 112, limRelMs: 50, limLookMs: 1,
};
export const SCENE = [
  { key: "target", name: "Talker in front", where: "0°", spl: 65 },
  { key: "talker2", name: "Talker behind", where: "180°", spl: 62 },
  { key: "noise", name: "Room noise", where: "8 directions", spl: 55 },
  { key: "wind", name: "Wind gust", where: "1.2–2.0 s", spl: 72 },
  { key: "clatter", name: "Dish clatter", where: "90°, at 2.7 s", spl: 85 },
  { key: "leak", name: "Feedback leak", where: "speaker → mics", spl: null },
];

// ---------- STFT grid ----------
const N = P.nfft, H = P.hop, K = N / 2 + 1;
const WIN = Float32Array.from({ length: N }, (_, n) => Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N)));
const WIN_SQ_SUM = WIN.reduce((s, v) => s + v * v, 0);
export const BIN_HZ = FS / N;
const binWeight = (k) => (k === 0 || k === K - 1 ? 1 : 2);
export const frameTime = (m) => (m * H) / FS;

// ---------- the scene ----------
export function buildScene(low, high) {
  const n = Math.round(P.dur * FS), r = rng(7);
  const fit = (x) => { const y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = x[i % x.length]; return y; };
  // Room reverb: one decaying-noise impulse response per side (independent, so the tails differ by side).
  const nr = Math.round(P.rt60 * FS), decay = Math.log(1000) / nr, rirs = P.revAngles.map(() => {
    const h = white(nr, r); for (let i = 0; i < nr; i++) h[i] *= Math.exp(-decay * i) * (i < 32 ? i / 32 : 1); return h;
  });
  const talker = (x, spl) => {
    // direct sound at (spl − share of reverb), reverb at drrDb below it, so direct + reverb = spl
    const direct = scaleToSpl(fit(x), spl - 10 * Math.log10(1 + 10 ** (-P.drrDb / 10)));
    const tails = fftConvolveMany(direct, rirs), want = meanSquare(direct) * 10 ** (-P.drrDb / 10) / tails.length;
    return { direct, rev: tails.map((t) => scale(t, Math.sqrt(want / Math.max(meanSquare(t), 1e-30)))) };
  };
  const target = talker(low, 65), talker2 = talker(high, 62);
  const noiseSubs = Array.from({ length: 8 }, (_, i) => ({ sig: scaleToSpl(pink(n, r), 55 - 10 * Math.log10(8)), angle: 22.5 + 45 * i }));
  const gust = (i) => { const t = i / FS, a = 1.2, b = 2.0, f = 0.1; return t < a || t > b ? 0 : Math.min(1, (t - a) / f, (b - t) / f); };
  const lp = [biquadCoefs("lowpass", 150, 0.54), biquadCoefs("lowpass", 150, 1.31)];
  const wind = [0, 1].map(() => {
    const x = cascade(white(n, r), lp);
    for (let i = 0; i < n; i++) x[i] *= gust(i);
    return scaleToSpl(x, 72, Math.round(1.25 * FS), Math.round(1.95 * FS));
  });
  const micNoise = [0, 1].map(() => scaleToSpl(white(n, r), P.einSpl));
  const cl = new Float32Array(n), w = white(n, r);
  [2.7, 2.76, 2.86].forEach((t0, j) => {
    const i0 = Math.round(t0 * FS);
    for (let i = i0; i < Math.min(n, i0 + 0.12 * FS); i++) cl[i] += w[i] * Math.exp(-(i - i0) / (0.012 * FS)) * (1 - 0.3 * j);
  });
  const clatter = scaleToSpl(biquad(cl, biquadCoefs("highpass", 1500, 0.7)), 85, Math.round(2.68 * FS), Math.round(2.95 * FS));
  return { n, target, talker2, noiseSubs, wind, micNoise, clatter };
}

/** The sound in the air at the aid's position, before any aid: the input of step 1. Wind and leak are 0 here:
 *  wind is turbulence at the mic ports, and the leak comes from the aid itself. */
export function airSignal(scene) {
  const z = new Float32Array(scene.n), noise = new Float32Array(scene.n);
  for (const s of scene.noiseSubs) for (let i = 0; i < scene.n; i++) noise[i] += s.sig[i];
  const sum = (t) => t.rev.reduce((acc, x) => add(acc, x), t.direct);
  return timeSig({ target: [sum(scene.target)], talker2: [sum(scene.talker2)], noise: [noise], wind: [z], clatter: [scene.clatter], leak: [z] });
}

// ---------- signal helpers ----------
const timeSig = (parts) => {
  const ch = parts[PARTS[0]].length, mix = [];
  for (let c = 0; c < ch; c++) { const m = new Float32Array(parts.target[c].length); for (const p of PARTS) { const x = parts[p][c]; for (let i = 0; i < m.length; i++) m[i] += x[i]; } mix.push(m); }
  return { type: "time", parts, mix };
};
const mapTime = (sig, fn) => { const parts = {}; for (const p of PARTS) parts[p] = sig.parts[p].map((x, c) => fn(x, c, p)); return timeSig(parts); };
const tfSig = (parts, M) => {
  const mix = { re: new Float32Array(M * K), im: new Float32Array(M * K) };
  for (const p of PARTS) for (let i = 0; i < M * K; i++) { mix.re[i] += parts[p].re[i]; mix.im[i] += parts[p].im[i]; }
  return { type: "tf", M, K, parts, mix };
};
const gainTf = (sig, G) => { // G: Float32Array(M*K) real gains
  const parts = {};
  for (const p of PARTS) { const a = sig.parts[p], re = new Float32Array(a.re.length), im = new Float32Array(a.im.length); for (let i = 0; i < re.length; i++) { re[i] = a.re[i] * G[i]; im[i] = a.im[i] * G[i]; } parts[p] = { re, im }; }
  return tfSig(parts, sig.M);
};

export function stft(x) {
  const M = Math.ceil(x.length / H) + 1, re = new Float32Array(M * K), im = new Float32Array(M * K), fr = new Float32Array(N), fi = new Float32Array(N);
  for (let m = 0; m < M; m++) {
    const s = m * H - H;
    for (let i = 0; i < N; i++) { const j = s + i; fr[i] = j >= 0 && j < x.length ? x[j] * WIN[i] : 0; fi[i] = 0; }
    fft(fr, fi);
    for (let k = 0; k < K; k++) { re[m * K + k] = fr[k]; im[m * K + k] = fi[k]; }
  }
  return { re, im, M };
}
export function istft(X, M, len) {
  const y = new Float32Array(len), fr = new Float32Array(N), fi = new Float32Array(N);
  for (let m = 0; m < M; m++) {
    for (let k = 0; k < K; k++) { fr[k] = X.re[m * K + k]; fi[k] = X.im[m * K + k]; }
    for (let k = 1; k < K - 1; k++) { fr[N - k] = fr[k]; fi[N - k] = -fi[k]; }
    fi[0] = 0; fi[K - 1] = 0;
    fft(fr, fi, true);
    const s = m * H - H;
    for (let i = 0; i < N; i++) { const j = s + i; if (j >= 0 && j < len) y[j] += fr[i] * WIN[i]; }
  }
  return y;
}
/** Mean square of one bin's contribution (digital units^2), so toSpl gives dB SPL in a 250 Hz bin. */
export const binMs = (re, im, k) => (binWeight(k) * (re * re + im * im)) / (N * WIN_SQ_SUM);
function tfMeanSquare(X, M) { let s = 0; for (let m = 0; m < M; m++) for (let k = 0; k < K; k++) s += binMs(X.re[m * K + k], X.im[m * K + k], k); return s / M; }

/** Sliding minimum over the last D frames, per bin (monotonic deque). */
function slidingMin(Pm, M, D) {
  const out = new Float32Array(M * K);
  for (let k = 0; k < K; k++) {
    const q = []; let h = 0;
    for (let m = 0; m < M; m++) {
      const v = Pm[m * K + k];
      while (q.length > h && Pm[q[q.length - 1] * K + k] >= v) q.pop();
      q.push(m);
      if (q[h] <= m - D) h++;
      out[m * K + k] = Pm[q[h] * K + k];
    }
  }
  return out;
}
function smoothPower(X, M, alpha) {
  const Pm = new Float32Array(M * K);
  for (let k = 0; k < K; k++) { let s = 0; for (let m = 0; m < M; m++) { const i = m * K + k, p = X.re[i] * X.re[i] + X.im[i] * X.im[i]; s = m ? alpha * s + (1 - alpha) * p : p; Pm[i] = s; } }
  return Pm;
}
const interp = (pts, x) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  return pts[pts.length - 1][1];
};
const interpLog = (pts, f) => interp(pts.map(([a, b]) => [Math.log(a), b]), Math.log(Math.max(f, 1)));

// ---------- fixed designs ----------
const TAU_S = (P.micSpacing / P.c) * FS; // 0.466 samples
/** Beam EQ: y[n] = B·(front − rear)[n] + A·y[n−1]. B sets 0 dB on-axis above the corner. A is set so that
 *  uncorrelated mic noise rises by P.dirNoiseDb: noise power gain = 2B²/(1 − A²). */
export const EQ_B = 1 / (2 * TAU_S);
export const EQ_A = Math.sqrt(1 - (2 * EQ_B * EQ_B) / 10 ** (P.dirNoiseDb / 10));
export const EQ_CORNER_HZ = (-Math.log(EQ_A) * FS) / (2 * Math.PI);
function propagate(sig, angleDeg) {
  const c = Math.cos((angleDeg * Math.PI) / 180);
  return [convolve(sig, fracDelayKernel(P.baseDelay - (TAU_S / 2) * c)), convolve(sig, fracDelayKernel(P.baseDelay + (TAU_S / 2) * c))];
}
function feedbackPath(gainScale, shift) {
  const L = P.nlmsTaps, h = new Float32Array(L), n0 = 6 + shift;
  for (let n = n0; n < L; n++) { const t = n - n0; h[n] = Math.exp(-t / 4) * Math.sin((2 * Math.PI * P.leakF0 * (t + 0.5)) / FS); }
  let peak = 0;
  for (let f = 100; f < FS / 2; f += 25) { let re = 0, im = 0; for (let n = 0; n < L; n++) { re += h[n] * Math.cos((-2 * Math.PI * f * n) / FS); im += h[n] * Math.sin((-2 * Math.PI * f * n) / FS); } peak = Math.max(peak, Math.hypot(re, im)); }
  const g = (dbToLin(P.leakPeakDb) * gainScale) / peak;
  for (let n = 0; n < L; n++) h[n] *= g;
  return h;
}
export const H_TRUE = [feedbackPath(1, 0), feedbackPath(0.85, 1)];
export const RECEIVER = [biquadCoefs("highpass", 200, 0.707), biquadCoefs("peaking", 2700, 1.4, 8), biquadCoefs("lowpass", 6200, 0.54), biquadCoefs("lowpass", 6200, 1.31)];
export const receiverDb = (f) => cascadeMagDb(RECEIVER, f);
export const BANDS = [[0, 1], [2, 2], [3, 4], [5, 6], [7, 9], [10, 13], [14, 19], [20, 32]].map(([a, b]) => {
  const lo = Math.max(125, a * BIN_HZ), hi = Math.max(lo, b * BIN_HZ);
  return { a, b, fc: Math.sqrt(lo * hi) };
});
/** NAL-R insertion gain (dB) for the audiogram at frequency f. Public formula (Byrne & Dillon 1986). */
const NALR_K = [[250, -17], [500, -8], [750, -3], [1000, 1], [1500, 1], [2000, -1], [3000, -2], [4000, -2], [6000, -2]];
export function nalr(f) {
  const hl = (x) => interpLog(P.audiogram, x);
  const X = 0.05 * (hl(500) + hl(1000) + hl(2000));
  return X + 0.31 * hl(f) + interpLog(NALR_K, f);
}
/** Gain (dB) the compressor applies at a band level L (dB SPL). */
export const wdrcOffset = (L) => (1 - 1 / P.cr) * (P.refSpl - Math.max(L, P.kneeSpl));
export const aOfLevel = (L) => interp(P.aCurve, L);
/** Directional response (dB re one omni mic) at angle and frequency; g = remaining rear mic mismatch. */
export function beamDb(thetaDeg, f, g = 1, eq = true) {
  const w = 2 * Math.PI * f, tau = P.micSpacing / P.c, c = Math.cos((thetaDeg * Math.PI) / 180);
  const re = Math.cos((w * tau * c) / 2) - g * Math.cos((-w * tau * c) / 2 - w * tau);
  const im = Math.sin((w * tau * c) / 2) - g * Math.sin((-w * tau * c) / 2 - w * tau);
  let mag = Math.hypot(re, im);
  if (eq) { const wd = (2 * Math.PI * f) / FS; mag *= EQ_B / Math.hypot(1 - EQ_A * Math.cos(wd), EQ_A * Math.sin(wd)); }
  return linToDb(mag);
}

// ---------- the 12 steps ----------
const on = (s, k) => !s.bypass[k];

function s1_mics(scene) {
  const talkerAtMics = (t, angle) => {
    const out = propagate(t.direct, angle);
    t.rev.forEach((x, j) => { const [f, r] = propagate(x, P.revAngles[j]); out[0] = add(out[0], f); out[1] = add(out[1], r); });
    return out;
  };
  const parts = {
    target: talkerAtMics(scene.target, 0),
    talker2: talkerAtMics(scene.talker2, 180),
    clatter: propagate(scene.clatter, 90),
    noise: null, wind: scene.wind.map((x) => x.slice()), leak: null,
  };
  const ac = [new Float32Array(scene.n), new Float32Array(scene.n)];
  for (const s of scene.noiseSubs) { const [f, r] = propagate(s.sig, s.angle); for (let i = 0; i < scene.n; i++) { ac[0][i] += f[i]; ac[1][i] += r[i]; } }
  // aid output stand-in (open loop): the sound at the front mic, +25 dB, 6 ms later
  const acousticFront = new Float32Array(scene.n);
  for (let i = 0; i < scene.n; i++) acousticFront[i] = parts.target[0][i] + parts.talker2[0][i] + parts.clatter[0][i] + ac[0][i];
  const u = scale(delayInt(acousticFront, Math.round((P.leakDelayMs / 1000) * FS)), dbToLin(P.aidGainDb));
  parts.leak = H_TRUE.map((h) => convolve(u, h));
  parts.noise = [add(ac[0], scene.micNoise[0]), add(ac[1], scene.micNoise[1])];
  const hot = dbToLin(P.mismatchDb);
  for (const p of PARTS) parts[p][1] = scale(parts[p][1], hot);
  return { out: timeSig(parts), aux: { u } };
}

/**
 * Fitting-time measurement of the feedback path: the aid plays a probe noise in a quiet room
 * and an NLMS filter learns the path. Unbiased, because the probe does not depend on the room sound.
 * Done once per mic; the result is fixed for the scene.
 */
let FIT = null;
export function feedbackFit() {
  if (FIT) return FIT;
  const L = P.nlmsTaps, n = Math.round(P.fitS * FS), r = rng(11);
  const probe = scaleToSpl(white(n, r), P.probeSpl);
  // the path each mic sees includes that mic's sensitivity (the rear mic reads hot)
  FIT = H_TRUE.map((h0, c) => {
    const h = c === 1 ? scale(h0, dbToLin(P.mismatchDb)) : h0;
    const d = add(convolve(probe, h), scaleToSpl(white(n, r), P.fitRoomSpl));
    const w = new Float64Array(L), hh = h.reduce((a, v) => a + v * v, 0), mis = [], snaps = [];
    let pow = 0;
    for (let i = 0; i < n; i++) {
      pow += probe[i] * probe[i] - (i >= L ? probe[i - L] * probe[i - L] : 0);
      let est = 0;
      for (let k = 0; k < L && k <= i; k++) est += w[k] * probe[i - k];
      const g = (P.fitMu * (d[i] - est)) / (pow + 1e-9);
      for (let k = 0; k < L && k <= i; k++) w[k] += g * probe[i - k];
      if (c === 0 && i % 80 === 0) {
        let err = 0; for (let k = 0; k < L; k++) err += (w[k] - h[k]) ** 2;
        mis.push(10 * Math.log10(Math.max(err / hh, 1e-9)));
        snaps.push(Float32Array.from(w));
      }
    }
    return { w: Float32Array.from(w), mis, snaps, dt: 80 / FS };
  });
  return FIT;
}

function s2_feedback(inp, s) {
  if (!on(s, 2)) return { out: inp, aux: null };
  const fit = feedbackFit(), u = s._u;
  const yhat = fit.map((f) => convolve(u, f.w)); // the canceller's copy of the leak, one per mic
  const out = mapTime(inp, (x, c, p) => (p === "leak" ? add(x, yhat[c], -1) : x));
  return { out, aux: { fit } };
}

/** 4th-order Linkwitz-Riley split: low + high has a flat magnitude, so the split alone changes no level. */
const LR_LOW = [biquadCoefs("lowpass", P.windFc, Math.SQRT1_2), biquadCoefs("lowpass", P.windFc, Math.SQRT1_2)];
const LR_HIGH = [biquadCoefs("highpass", P.windFc, Math.SQRT1_2), biquadCoefs("highpass", P.windFc, Math.SQRT1_2)];

function s3_windcal(inp, s) {
  if (!on(s, 3)) return { out: inp, aux: { g: dbToLin(P.mismatchDb) } };
  const cal = dbToLin(-P.mismatchDb);
  const calSig = mapTime(inp, (x, c) => (c === 1 ? scale(x, cal) : x));
  const lp = LR_LOW;
  const [lf, lr] = calSig.mix.map((x) => cascade(x, lp));
  const n = lf.length, gain = new Float32Array(n), dec = 32, rho = [], lev = [], gdb = [];
  const a = Math.exp(-1 / (0.03 * FS)), att = Math.exp(-1 / (0.01 * FS)), rel = Math.exp(-1 / (0.15 * FS));
  let sxx = 1e-12, syy = 1e-12, sxy = 0, g = 0;
  for (let i = 0; i < n; i++) {
    sxx = a * sxx + (1 - a) * lf[i] * lf[i]; syy = a * syy + (1 - a) * lr[i] * lr[i]; sxy = a * sxy + (1 - a) * lf[i] * lr[i];
    const r = sxy / Math.sqrt(sxx * syy), L = toSpl(sxx), windy = r < P.windRho && L > P.windMinSpl, tgt = windy ? P.windCutDb : 0;
    g = tgt < g ? att * g + (1 - att) * tgt : rel * g + (1 - rel) * tgt;
    gain[i] = dbToLin(g);
    if (i % dec === 0) { rho.push(r); lev.push(L); gdb.push(g); }
  }
  const out = mapTime(calSig, (x) => { const low = cascade(x, LR_LOW), high = cascade(x, LR_HIGH), y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = high[i] + gain[i] * low[i]; return y; });
  return { out, aux: { rho, lev, gdb, dt: dec / FS, g: 1 } };
}

function s4_beam(inp, s, res) {
  const g = res[3].aux ? res[3].aux.g : 1; // rear mismatch left after step 3
  if (!on(s, 4) || s.mode === "all") {
    const parts = {}; for (const p of PARTS) parts[p] = [delayInt(inp.parts[p][0], P.baseDelay)];
    return { out: timeSig(parts), aux: { omni: true, g } };
  }
  const kr = fracDelayKernel(P.baseDelay + TAU_S), a = EQ_A, b = EQ_B;
  const parts = {};
  for (const p of PARTS) {
    const f = delayInt(inp.parts[p][0], P.baseDelay), r = convolve(inp.parts[p][1], kr), y = new Float32Array(f.length);
    let prev = 0;
    for (let i = 0; i < f.length; i++) { prev = b * (f[i] - r[i]) + a * prev; y[i] = prev; }
    parts[p] = [y];
  }
  return { out: timeSig(parts), aux: { omni: false, g } };
}

function s5_stft(inp) {
  const parts = {}; let M = 0;
  for (const p of PARTS) { const X = stft(inp.parts[p][0]); M = X.M; parts[p] = { re: X.re, im: X.im }; }
  return { out: tfSig(parts, M), aux: { len: inp.mix[0].length } };
}

function s6_mask(inp, s) {
  const { M } = inp, n = M * K, T = new Float32Array(n), I = new Float32Array(n), Nm = new Float32Array(n);
  const kind = s.bypass[6] ? "off" : s.mask;
  if (kind === "oracle") {
    for (let i = 0; i < n; i++) {
      const pw = (p) => inp.parts[p].re[i] ** 2 + inp.parts[p].im[i] ** 2;
      const pt = pw("target"), pi = pw("talker2"), pn = pw("noise") + pw("wind") + pw("clatter") + pw("leak"), tot = pt + pi + pn + 1e-20;
      T[i] = pt / tot; I[i] = pi / tot; Nm[i] = pn / tot;
    }
  } else if (kind === "classic") {
    const Ps = smoothPower(inp.mix, M, 0.9), Nh = slidingMin(Ps, M, Math.round((P.msWindowS * FS) / H));
    for (let i = 0; i < n; i++) { const t = Math.min(1, Math.max(0, 1 - (P.msBias * Nh[i]) / (Ps[i] + 1e-20))); T[i] = t; Nm[i] = 1 - t; }
  } else T.fill(1);
  return { out: { type: "streams", X: inp, masks: { T, I, N: Nm }, kind }, aux: { kind } };
}

function s7_mix(inp, s) {
  const { X, masks } = inp, M = X.M, G = new Float32Array(M * K), aT = [], lT = [];
  if (!on(s, 7)) { for (let i = 0; i < G.length; i++) G[i] = masks.T[i] + masks.I[i] + masks.N[i]; return { out: gainTf(X, G), aux: null }; }
  const b = s.mode === "front" ? 0 : 1, sm = Math.exp(-H / (0.1 * FS));
  let Ls = 0;
  for (let m = 0; m < M; m++) {
    let ms = 0;
    for (let k = 0; k < K; k++) { const i = m * K + k; ms += binMs(X.mix.re[i] * masks.N[i], X.mix.im[i] * masks.N[i], k); }
    const L = toSpl(ms); Ls = m ? sm * Ls + (1 - sm) * L : L;
    const a = aOfLevel(Ls);
    for (let k = 0; k < K; k++) { const i = m * K + k; G[i] = masks.T[i] + b * masks.I[i] + a * masks.N[i]; }
    aT.push(a); lT.push(Ls);
  }
  return { out: gainTf(X, G), aux: { a: aT, L: lT, b } };
}

function s8_steady(inp, s) {
  if (!on(s, 8)) return { out: inp, aux: null };
  const M = inp.M, Ps = smoothPower(inp.mix, M, 0.9), Nh = slidingMin(Ps, M, Math.round((P.msWindowS * FS) / H)), G = new Float32Array(M * K), fl = dbToLin(P.floorDb);
  for (let i = 0; i < G.length; i++) { Nh[i] *= P.msBias; G[i] = Math.max(fl, 1 - Nh[i] / (Ps[i] + 1e-20)); }
  return { out: gainTf(inp, G), aux: { Nh, Ps, G } };
}

function s9_gain(inp, s, res) {
  if (!on(s, 9)) return { out: inp, aux: null };
  const X5 = res[5].out, M = inp.M, nb = BANDS.length, G = new Float32Array(M * K), Gb = new Float32Array(nb * M), Lb = new Float32Array(nb * M);
  const aa = Math.exp(-H / (FS * P.attackMs / 1000)), ar = Math.exp(-H / (FS * P.releaseMs / 1000));
  const base = BANDS.map((bd) => nalr(bd.fc) - receiverDb(bd.fc));
  BANDS.forEach((bd, j) => {
    let Ls = 0;
    for (let m = 0; m < M; m++) {
      let ms = 0;
      for (let k = bd.a; k <= bd.b; k++) { const i = m * K + k; ms += binMs(X5.mix.re[i], X5.mix.im[i], k); }
      const L = toSpl(ms);
      Ls = m === 0 ? L : L > Ls ? aa * Ls + (1 - aa) * L : ar * Ls + (1 - ar) * L;
      const gdb = Math.min(P.maxGainDb, Math.max(0, base[j] + wdrcOffset(Ls))), lin = dbToLin(gdb);
      for (let k = bd.a; k <= bd.b; k++) G[m * K + k] = lin;
      Gb[j * M + m] = gdb; Lb[j * M + m] = Ls;
    }
  });
  return { out: gainTf(inp, G), aux: { Gb, Lb, base } };
}

function s10_istft(inp, s, res) {
  const len = res[5].aux.len, parts = {};
  for (const p of PARTS) parts[p] = [istft(inp.parts[p], inp.M, len)];
  // check: inverse(STFT(x)) = x for the step-4 output
  const x = res[4].out.mix[0], X = stft(x), y = istft(X, X.M, len);
  let e = 0, t = 0; for (let i = 0; i < len; i++) { e += (y[i] - x[i]) ** 2; t += x[i] * x[i]; }
  return { out: timeSig(parts), aux: { prErrDb: 10 * Math.log10(Math.max(e / t, 1e-30)) } };
}

function s11_limit(inp, s) {
  if (!on(s, 11)) return { out: inp, aux: null };
  // The detector looks at the predicted ear-canal sound (this signal through the receiver model),
  // so the limit holds at the eardrum, where the IFU max output is defined.
  const x = inp.mix[0], n = x.length, xd = cascade(x, RECEIVER), thrPk = rmsForSpl(P.mpoSpl) * Math.SQRT2;
  const look = Math.round((P.limLookMs / 1000) * FS), rel = 1 - Math.exp(-1 / ((P.limRelMs / 1000) * FS));
  const g = new Float32Array(n), dec = 32, before = [], after = [], gr = [];
  const q = []; let h = 0, cur = 1; // sliding max of |xd| over [i, i + look]
  const push = (j) => { while (q.length > h && Math.abs(xd[q[q.length - 1]]) <= Math.abs(xd[j])) q.pop(); q.push(j); };
  for (let j = 0; j < Math.min(n, look); j++) push(j);
  for (let i = 0; i < n; i++) {
    if (i + look < n) push(i + look);
    while (q[h] < i) h++;
    const pk = Math.abs(xd[q[h]]), need = pk > thrPk ? thrPk / pk : 1;
    cur = need < cur ? need : cur + (1 - cur) * rel;
    g[i] = cur;
  }
  const out = mapTime(inp, (v) => { const y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = v[i] * g[i]; return y; });
  const yd = cascade(out.mix[0], RECEIVER);
  let maxPk = 0; for (let i = 0; i < n; i++) maxPk = Math.max(maxPk, Math.abs(yd[i]));
  for (let i = 0; i + dec <= n; i += dec) { before.push(toSpl(meanSquare(xd, i, i + dec))); after.push(toSpl(meanSquare(yd, i, i + dec))); gr.push(linToDb(g[i])); }
  return { out, aux: { before, after, gr, dt: dec / FS, maxPkSpl: toSpl((maxPk * maxPk) / 2) } };
}

function s12_receiver(inp) {
  return { out: mapTime(inp, (x) => cascade(x, RECEIVER)), aux: null };
}

const STEPS = [null, s1_mics, s2_feedback, s3_windcal, s4_beam, s5_stft, s6_mask, s7_mix, s8_steady, s9_gain, s10_istft, s11_limit, s12_receiver];

/** Run steps `from`..12. `res` keeps earlier results (cache). Settings: {mode, mask, bypass}. */
export function run(scene, settings, res = [], from = 1) {
  for (let k = Math.max(1, from); k <= 12; k++) {
    const inp = k === 1 ? scene : res[k - 1].out;
    const s = { ...settings, _u: k > 1 ? res[1].aux.u : null }; // _u: the aid output that leaks back
    res[k] = STEPS[k](inp, s, res);
    res[k].ledger = ledger(res[k].out);
  }
  return res;
}

// ---------- levels of each part (dB SPL) ----------
export function ledger(sig) {
  const L = {};
  if (sig.type === "time") { for (const p of PARTS) L[p] = toSpl(meanSquare(sig.parts[p][0])); L.mix = toSpl(meanSquare(sig.mix[0])); }
  else if (sig.type === "tf") { for (const p of PARTS) L[p] = toSpl(tfMeanSquare(sig.parts[p], sig.M)); L.mix = toSpl(tfMeanSquare(sig.mix, sig.M)); }
  else { // streams: what the target stream holds
    const { X, masks } = sig, M = X.M;
    for (const p of [...PARTS, "mix"]) {
      const a = p === "mix" ? X.mix : X.parts[p], re = new Float32Array(M * K), im = new Float32Array(M * K);
      for (let i = 0; i < re.length; i++) { re[i] = a.re[i] * masks.T[i]; im[i] = a.im[i] * masks.T[i]; }
      L[p] = toSpl(tfMeanSquare({ re, im }, M));
    }
  }
  const pw = (db) => 10 ** (db / 10), rest = PARTS.filter((p) => p !== "target").reduce((s, p) => s + pw(L[p]), 0);
  L.snr = 10 * Math.log10(pw(L.target) / Math.max(rest, 1e-30));
  return L;
}

/** Mono time signal of any step output, for listening and plots. */
export function toTime(sig, len) {
  if (sig.type === "time") return sig.mix[0];
  if (sig.type === "tf") return istft(sig.mix, sig.M, len);
  const { X, masks } = sig, re = new Float32Array(X.mix.re.length), im = new Float32Array(re.length);
  for (let i = 0; i < re.length; i++) { re[i] = X.mix.re[i] * masks.T[i]; im[i] = X.mix.im[i] * masks.T[i]; }
  return istft({ re, im }, X.M, len);
}

/** Spectrogram for display: dB SPL per 250 Hz. Time signals: 256-point Hann, 4 ms step. TF: the processing grid. */
export function spectrogram(sig) {
  if (sig.type === "time") {
    const x = sig.mix[0], NN = 256, HH = 64, KK = NN / 2 + 1, MM = Math.floor((x.length - NN) / HH) + 1, out = new Float32Array(MM * KK);
    const w = Float32Array.from({ length: NN }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / NN)), ws = w.reduce((s, v) => s + v * v, 0);
    const fr = new Float32Array(NN), fi = new Float32Array(NN), per250 = 250 / (FS / NN);
    for (let m = 0; m < MM; m++) {
      for (let i = 0; i < NN; i++) { fr[i] = x[m * HH + i] * w[i]; fi[i] = 0; }
      fft(fr, fi);
      for (let k = 0; k < KK; k++) out[m * KK + k] = toSpl((per250 * (k === 0 || k === KK - 1 ? 1 : 2) * (fr[k] ** 2 + fi[k] ** 2)) / (NN * ws));
    }
    return { M: MM, K: KK, data: out, t0: NN / 2 / FS, dt: HH / FS, fine: true };
  }
  const X = sig.type === "tf" ? sig.mix : (() => { const { X: x, masks } = sig, re = new Float32Array(x.mix.re.length), im = new Float32Array(re.length); for (let i = 0; i < re.length; i++) { re[i] = x.mix.re[i] * masks.T[i]; im[i] = x.mix.im[i] * masks.T[i]; } return { re, im }; })();
  const M = sig.type === "tf" ? sig.M : sig.X.M, out = new Float32Array(M * K);
  for (let i = 0; i < M * K; i++) out[i] = toSpl(binMs(X.re[i], X.im[i], i % K));
  return { M, K, data: out, t0: 0, dt: H / FS, fine: false };
}
export const GRID = { N, H, K, WIN };
