// One animated view per step. Each view draws the step's own transform at playhead time t (s).
// S = { scene, res, settings, len }: the scene and every step result (see dsp/pipeline.js).
import { FS, toSpl, meanSquare, PA_PER_UNIT, linToDb } from "./dsp/core.js";
import { P, GRID, BANDS, BIN_HZ, beamDb, aOfLevel, receiverDb, wdrcOffset, H_TRUE, feedbackFit, binMs, EQ_CORNER_HZ } from "./dsp/pipeline.js";
import { C, axes, boxIn, line, playhead, label, dot, maskImage } from "./plots.js";

const { N, H: HOP, K, WIN } = GRID;
const DUR = () => P.dur;
const secTicks = [0, 1, 2, 3];
const sFmt = (v) => `${v} s`;
const kfmt = (v) => (v ? `${v / 1000}k` : "0");
const timeAxes = (g, box, y, yticks, yfmt, title) => axes(g, box, { x: [0, DUR()], y, xticks: secTicks, xfmt: sFmt, yticks, yfmt, title });
const frameAt = (t) => Math.max(0, Math.round((t * FS) / HOP) + 1);

function bypassed(g, W, H, text = "Bypassed: out = in") {
  label(g, text, W / 2, H / 2, { align: "center", base: "middle", color: C.ink2 });
}

// ---------- 1. Microphones: top view, sound arriving, wind, leak ----------
function levelAt(x, t, win = 0.02) {
  const a = Math.max(0, Math.round((t - win / 2) * FS)), b = Math.min(x.length, a + Math.round(win * FS));
  return toSpl(meanSquare(x, a, b));
}
function v1(g, W, Hh, t, S) {
  const cx = W / 2, cy = 158, R = Math.min(W / 2 - 34, 118), sc = S.scene, ap = S.air.parts;
  const src = [
    { ang: 0, x: ap.target[0], name: "Front talker", c: C.out },
    { ang: 180, x: ap.talker2[0], name: "Rear talker", c: C.in },
    { ang: 90, x: ap.clatter[0], name: "Clatter", c: C.ref },
  ];
  const pos = (ang, r) => [cx + r * Math.sin((ang * Math.PI) / 180), cy - r * Math.cos((ang * Math.PI) / 180)];
  // room noise: 8 faint sources
  for (const s of sc.noiseSubs) { const [x, y] = pos(s.angle, R); dot(g, x, y, 3, C.muted); }
  // wavefronts: rings move from each source to the aid; brightness follows the source level now
  for (const s of src) {
    const L = levelAt(s.x, t), a = Math.max(0, Math.min(1, (L - 35) / 45));
    const [sx, sy] = pos(s.ang, R);
    for (let j = 0; j < 3; j++) {
      const f = ((t * 1.6 + j / 3) % 1), r = f * R;
      g.save(); g.globalAlpha = a * (1 - f) * 0.9; g.strokeStyle = s.c; g.lineWidth = 2;
      g.beginPath(); g.arc(sx, sy, r, 0, 2 * Math.PI); g.stroke(); g.restore();
    }
    dot(g, sx, sy, 7, s.c);
    const txt = s.name;
    if (s.ang === 0) label(g, txt, sx, sy - 14, { align: "center" });
    else if (s.ang === 180) label(g, txt, sx, sy + 26, { align: "center" });
    else label(g, txt, W - 6, sy - 14, { align: "right" });
  }
  // the aid: two mics 10 mm apart (drawn larger), speaker below
  g.save(); g.fillStyle = "#1b2440"; g.strokeStyle = C.axis; g.lineWidth = 1.5;
  g.beginPath(); g.roundRect(cx - 13, cy - 30, 26, 60, 10); g.fill(); g.stroke(); g.restore();
  dot(g, cx, cy - 16, 5, C.hi); dot(g, cx, cy + 16, 5, C.hi);
  label(g, "front", cx - 20, cy - 11, { align: "right", color: C.ink2 });
  label(g, "rear", cx - 20, cy + 21, { align: "right", color: C.ink2 });
  // leak: speaker sound back to the mics
  g.save(); g.strokeStyle = C.out; g.setLineDash([4, 4]); g.lineWidth = 1.5; g.lineDashOffset = -t * 30;
  g.beginPath(); g.moveTo(cx + 13, cy + 26); g.bezierCurveTo(cx + 48, cy + 34, cx + 48, cy - 26, cx + 13, cy - 16); g.stroke(); g.restore();
  label(g, "leak", cx + 22, cy + 56, { color: C.ink2 });
  // wind at the mic ports during the gust
  const wl = levelAt(S.res[1].out.parts.wind[0], t);
  if (wl > 40) {
    g.save(); g.strokeStyle = C.ink2; g.lineWidth = 1.5; g.globalAlpha = Math.min(1, (wl - 40) / 30);
    for (let j = 0; j < 4; j++) { const y = cy - 30 + j * 18, ph = t * 9 + j; g.beginPath(); for (let x = cx - 70; x <= cx - 18; x += 3) { const yy = y + 4 * Math.sin(x / 7 + ph); x === cx - 70 ? g.moveTo(x, yy) : g.lineTo(x, yy); } g.stroke(); }
    g.restore();
    label(g, "wind", cx - 74, cy + 44, { align: "right", color: C.ink2 });
  }
  label(g, "Rings: sound moving toward the aid.", 4, Hh - 30, { color: C.ink2 });
  label(g, "Brighter rings: louder sound right now.", 4, Hh - 8, { color: C.ink2 });
}

// ---------- 2. Feedback cancel: the canceller learns the leak path ----------
function v2(g, W, Hh, t, S) {
  const fit = feedbackFit()[0], h = H_TRUE[0];
  const idx = Math.min(fit.snaps.length - 1, Math.floor((t / DUR()) * fit.snaps.length));
  const w = fit.snaps[idx], tFit = idx * fit.dt;
  const amp = Math.max(...h.map(Math.abs)) * 1.3;
  const lag = (k) => (k / FS) * 1000;
  const A = axes(g, boxIn(W, 26, 96), { x: [0, 2], y: [-amp, amp], xticks: [0, 0.5, 1, 1.5, 2], xfmt: (v) => `${v} ms`, yticks: [0], yfmt: () => "0", title: "Leak path (amber) and the model (red)" });
  for (let k = 0; k < h.length; k++) {
    const x = A.X(lag(k));
    g.save(); g.strokeStyle = C.ref; g.lineWidth = 2; g.beginPath(); g.moveTo(x, A.Y(0)); g.lineTo(x, A.Y(h[k])); g.stroke(); g.restore();
    dot(g, x, A.Y(w[k]), 3.5, C.out);
  }
  const B = axes(g, boxIn(W, 178, 82), { x: [0, 1], y: [-45, 5], xticks: [0, 0.25, 0.5, 0.75, 1], xfmt: (v) => `${v} s`, yticks: [0, -20, -40], yfmt: (v) => `${v}`, title: "How wrong the model is, dB" });
  const xs = fit.mis.map((_, i) => i * fit.dt);
  line(g, xs.slice(0, idx + 1), fit.mis.slice(0, idx + 1), B.X, B.Y, C.out, 2);
  dot(g, B.X(tFit), B.Y(fit.mis[idx]), 5, C.out);
  label(g, "The model learns the path at fitting.", 4, Hh - 8, { color: C.ink2 });
}

// ---------- 3. Wind + calibration: coherence and the low-band gain ----------
function v3(g, W, Hh, t, S) {
  const a = S.res[3].aux;
  if (!a || !a.rho) return bypassed(g, W, Hh);
  const xs = a.rho.map((_, i) => i * a.dt), i = Math.min(a.rho.length - 1, Math.round(t / a.dt));
  const A = timeAxes(g, boxIn(W, 26, 86), [-0.4, 1], [1, 0.6, 0], (v) => v.toFixed(1), "Do the mics agree? (lows only)");
  line(g, xs, a.rho, A.X, A.Y, C.in, 1.5);
  line(g, [0, DUR()], [P.windRho, P.windRho], A.X, A.Y, C.ref, 1.5, [6, 4]);
  const B = timeAxes(g, boxIn(W, 166, 76), [-22, 2], [0, -10, -20], (v) => `${v}`, "Gain on the lows, dB");
  line(g, xs, a.gdb, B.X, B.Y, C.out, 2);
  playhead(g, A.X(t), 26, 86); playhead(g, B.X(t), 166, 76);
  dot(g, A.X(t), A.Y(a.rho[i]), 4, C.in); dot(g, B.X(t), B.Y(a.gdb[i]), 4, C.out);
  label(g, "Wind: the mics stop agreeing,", 4, Hh - 30, { color: C.ink2 });
  label(g, "so the lows go down.", 4, Hh - 8, { color: C.ink2 });
}

// ---------- 4. Beamformer: polar response, sounds shrink as they pass ----------
function v4(g, W, Hh, t, S) {
  const omni = S.res[4].aux.omni, cx = W / 2, cy = 142, r = Math.min(W / 2 - 40, 112), f = 1000;
  const rel = (th) => (omni ? 0 : beamDb(th, f, 1, false) - beamDb(0, f, 1, false));
  const rad = (db) => r * Math.max(0, 1 + db / 30);
  g.save(); g.strokeStyle = C.grid; g.lineWidth = 1;
  for (const db of [0, -10, -20]) { g.beginPath(); g.arc(cx, cy, rad(db), 0, 2 * Math.PI); g.stroke(); }
  g.restore();
  label(g, "0 dB", cx + 4, cy - rad(0) + 16, { color: C.muted });
  label(g, "−20", cx + 4, cy - rad(-20) + 16, { color: C.muted });
  g.save(); g.strokeStyle = C.out; g.lineWidth = 2; g.beginPath();
  for (let a = 0; a <= 360; a += 2) { const d = rad(rel(a)), x = cx + d * Math.sin((a * Math.PI) / 180), y = cy - d * Math.cos((a * Math.PI) / 180); a ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke(); g.restore();
  const marks = [{ a: 0, n: "front" }, { a: 90, n: "side" }, { a: 180, n: "behind" }];
  for (const m of marks) {
    const d = rel(m.a), R = r + 14, x = cx + R * Math.sin((m.a * Math.PI) / 180), y = cy - R * Math.cos((m.a * Math.PI) / 180);
    // a pulse travels in from this direction; its size at the center shows the gain
    const f2 = (t * 0.8 + m.a / 360) % 1, pr = R * (1 - f2), px = cx + pr * Math.sin((m.a * Math.PI) / 180), py = cy - pr * Math.cos((m.a * Math.PI) / 180);
    const size = 7 * (1 - f2) + 7 * f2 * Math.max(0.08, 10 ** (d / 20));
    dot(g, px, py, size, m.a === 180 ? C.in : m.a === 90 ? C.ref : C.out);
    const txt = m.n;
    if (m.a === 0) label(g, txt, x, y - 6, { align: "center" });
    else if (m.a === 180) label(g, txt, x, y + 18, { align: "center" });
    else label(g, txt, W - 4, y - 16, { align: "right" });
  }
  label(g, omni ? "All Voices: no beam." : "Red line: how well the beam hears", 4, Hh - 30, { color: C.ink2 });
  label(g, omni ? "Every side is heard the same." : "each side. The back is a hole.", 4, Hh - 8, { color: C.ink2 });
}

// ---------- 5. STFT: a 4 ms window slides; each frame becomes 33 bins ----------
function v5(g, W, Hh, t, S) {
  const x = S.res[4].out.mix[0], X = S.res[5].out.mix, M = S.res[5].out.M;
  const m = Math.min(M - 1, frameAt(t)), s0 = (m - 1) * HOP; // frame m covers [s0, s0 + N)
  const span = 0.012, c = (s0 + N / 2) / FS, ta = c - span, tb = c + span;
  let pk = 1e-9; for (let i = Math.max(0, Math.round(ta * FS)); i < Math.min(x.length, Math.round(tb * FS)); i++) pk = Math.max(pk, Math.abs(x[i]));
  const ypa = pk * PA_PER_UNIT * 1.15;
  const A = axes(g, boxIn(W, 26, 96), { x: [ta * 1000, tb * 1000], y: [-ypa, ypa], xticks: [], yticks: [0], yfmt: () => "0 Pa", title: "Sound wave, Pa (24 ms of it)" });
  const xs = [], ys = [];
  for (let i = Math.max(0, Math.round(ta * FS)); i < Math.min(x.length, Math.round(tb * FS)); i++) { xs.push((i / FS) * 1000); ys.push(x[i] * PA_PER_UNIT); }
  line(g, xs, ys, A.X, A.Y, C.in, 1.5);
  for (const dm of [-2, -1, 1, 2, 0]) { // windows of nearby frames; the current one in amber
    const s = s0 + dm * HOP, wx = [], wy = [];
    for (let n = 0; n < N; n++) { wx.push(((s + n) / FS) * 1000); wy.push(WIN[n] * ypa * 0.95); }
    line(g, wx, wy, A.X, A.Y, dm ? "rgba(255,182,39,0.3)" : C.ref, dm ? 1 : 2);
  }
  label(g, "amber: the current slice", A.box.x0, 26 + 96 + 18, { color: C.ink2 });
  const B = axes(g, boxIn(W, 176, 100), { x: [0, 8000], y: [0, 80], xticks: [0, 2000, 4000, 6000, 8000], xfmt: kfmt, yticks: [0, 40, 80], yfmt: (v) => `${v}`, title: "That slice, by frequency, dB SPL" });
  const bw = (B.box.w / K) * 0.8;
  for (let k = 0; k < K; k++) {
    const i = m * K + k, L = toSpl(binMs(X.re[i], X.im[i], k)), xx = B.X(k * BIN_HZ), yy = B.Y(Math.max(0, Math.min(80, L)));
    g.fillStyle = C.out; g.fillRect(xx - bw / 2, yy, bw, B.Y(0) - yy);
  }
  label(g, "One slice in, one column of the grid out.", 4, Hh - 8, { color: C.ink2 });
}

// ---------- 6. Masks: T, I, N over time and frequency ----------
const maskCache = new WeakMap();
function v6(g, W, Hh, t, S) {
  const st = S.res[6].out, M = st.X.M;
  let imgs = maskCache.get(st);
  if (!imgs) { imgs = { T: maskImage(st.masks.T, M, K, [255, 64, 87]), I: maskImage(st.masks.I, M, K, [42, 147, 201]), N: maskImage(st.masks.N, M, K, [255, 182, 39]) }; maskCache.set(st, imgs); }
  const rows = [["T", "T: target speech"], ["I", "I: other speech"], ["N", "N: noise"]];
  rows.forEach(([key, name], j) => {
    const y0 = 24 + j * 100, A = axes(g, boxIn(W, y0, 66), { x: [0, DUR()], y: [0, 8], xticks: secTicks, xfmt: sFmt, yticks: [0, 4, 8], yfmt: (v) => (v ? `${v}k` : "0"), title: name, noXLabels: j < 2 });
    g.imageSmoothingEnabled = false;
    g.drawImage(imgs[key], A.box.x0, A.box.y0, A.box.w, A.box.h);
    playhead(g, A.X(t), y0, 66);
  });
  label(g, "Bright: that part of the grid is this source.", 4, Hh - 4, { color: C.ink2 });
}

// ---------- 7. Mix back: a(L) and where we are on it ----------
function v7(g, W, Hh, t, S) {
  const a = S.res[7].aux;
  if (!a) return bypassed(g, W, Hh, "Bypassed: Y = (T + I + N) · X = X");
  const i = Math.min(a.a.length - 1, frameAt(t));
  const A = axes(g, boxIn(W, 26, 96), { x: [40, 100], y: [0, 0.35], xticks: [40, 60, 80, 100], xfmt: (v) => `${v}`, yticks: [0, 0.1, 0.2, 0.3], yfmt: (v) => v.toFixed(1), title: "Noise added back (a) vs. room level, dB SPL" });
  const xs = Array.from({ length: 61 }, (_, j) => 40 + j);
  line(g, xs, xs.map(aOfLevel), A.X, A.Y, C.ref, 2);
  dot(g, A.X(Math.max(40, Math.min(100, a.L[i]))), A.Y(a.a[i]), 6, C.out);
  const ts = a.a.map((_, j) => (j * HOP) / FS);
  const B = timeAxes(g, boxIn(W, 176, 76), [0, 0.35], [0, 0.3], (v) => v.toFixed(1), "Noise added back (a) over time");
  line(g, ts, a.a, B.X, B.Y, C.out, 2);
  playhead(g, B.X(t), 176, 76);
  label(g, "Least noise back at normal room levels,", 4, Hh - 30, { color: C.ink2 });
  label(g, "more when the room is very quiet or loud.", 4, Hh - 8, { color: C.ink2 });
}

// ---------- 8. Steady-noise mask: this frame vs. the noise floor ----------
function v8(g, W, Hh, t, S) {
  const a = S.res[8].aux;
  if (!a) return bypassed(g, W, Hh);
  const M = S.res[8].out.M, m = Math.min(M - 1, frameAt(t));
  const db = (p, k) => toSpl(binMs(Math.sqrt(p), 0, k));
  const A = axes(g, boxIn(W, 26, 110), { x: [0, 8000], y: [0, 80], xticks: [0, 2000, 4000, 6000, 8000], xfmt: kfmt, yticks: [0, 40, 80], yfmt: (v) => `${v}`, title: "This slice (bars), the hum (line), dB SPL" });
  const bw = (A.box.w / K) * 0.8;
  const fl = [], fx = [];
  for (let k = 0; k < K; k++) {
    const L = db(a.Ps[m * K + k], k), xx = A.X(k * BIN_HZ), yy = A.Y(Math.max(0, Math.min(80, L)));
    g.fillStyle = C.in; g.fillRect(xx - bw / 2, yy, bw, A.Y(0) - yy);
    fx.push(k * BIN_HZ); fl.push(Math.max(0, db(a.Nh[m * K + k], k)));
  }
  line(g, fx, fl, A.X, A.Y, C.ref, 2);
  const B = axes(g, boxIn(W, 186, 70), { x: [0, 8000], y: [-13, 1], xticks: [0, 2000, 4000, 6000, 8000], xfmt: kfmt, yticks: [0, -12], yfmt: (v) => `${v}`, title: "Gain, dB" });
  line(g, fx, fx.map((_, k) => linToDb(a.G[m * K + k])), B.X, B.Y, C.out, 2);
  label(g, "Bars near the line get turned down.", 4, Hh - 8, { color: C.ink2 });
}

// ---------- 9. Gain + compression: gain per band now, and one band's input/output ----------
function v9(g, W, Hh, t, S) {
  const a = S.res[9].aux;
  if (!a) return bypassed(g, W, Hh);
  const M = S.res[9].out.M, m = Math.min(M - 1, frameAt(t)), nb = BANDS.length;
  const A = axes(g, { x0: 46, y0: 26, w: W - 58, h: 100 }, { x: [-0.5, nb - 0.5], y: [0, 40], xticks: [], yticks: [0, 20, 40], yfmt: (v) => `${v}`, title: "Gain in each of 8 bands, dB" });
  const bw = (A.box.w / nb) * 0.6;
  BANDS.forEach((b, j) => {
    const now = a.Gb[j * M + m], ref = Math.max(0, Math.min(P.maxGainDb, a.base[j] + wdrcOffset(55)));
    const x = A.X(j);
    g.fillStyle = C.out; g.fillRect(x - bw / 2, A.Y(Math.min(40, now)), bw, A.Y(0) - A.Y(Math.min(40, now)));
    g.strokeStyle = C.ink2; g.lineWidth = 1.5; g.strokeRect(x - bw / 2, A.Y(Math.min(40, ref)), bw, A.Y(0) - A.Y(Math.min(40, ref)));
    if (j % 2 === 0 || W > 420) label(g, b.fc < 1000 ? `${Math.round(b.fc / 10) * 10}` : `${(b.fc / 1000).toFixed(1)}k`, x, A.Y(0) + 18, { align: "center", color: C.ink2 });
  });
  const j = 5, Lb = a.Lb[j * M + m];
  const B = axes(g, boxIn(W, 186, 90), { x: [20, 100], y: [20, 120], xticks: [20, 40, 60, 80, 100], xfmt: (v) => `${v}`, yticks: [40, 80, 120], yfmt: (v) => `${v}`, title: "One band: sound out vs. sound in, dB SPL" });
  const xs = Array.from({ length: 81 }, (_, i) => 20 + i);
  line(g, xs, xs, B.X, B.Y, C.grid, 1, [4, 4]);
  line(g, xs, xs.map((L) => L + Math.max(0, Math.min(P.maxGainDb, a.base[j] + wdrcOffset(L)))), B.X, B.Y, C.ref, 2);
  dot(g, B.X(Math.max(20, Math.min(100, Lb))), B.Y(Lb + a.Gb[j * M + m]), 6, C.out);
  label(g, "Red: gain now. Outline: gain for speech.", 4, Hh - 30, { color: C.ink2 });
  label(g, "Louder in, less gain: the curve bends.", 4, Hh - 8, { color: C.ink2 });
}

// ---------- 10. Inverse STFT: windows overlap and sum to 1 ----------
function v10(g, W, Hh, t, S) {
  const A = axes(g, boxIn(W, 26, 150), { x: [0, 16], y: [0, 1.25], xticks: [0, 4, 8, 12, 16], xfmt: (v) => `${v} ms`, yticks: [0, 0.5, 1], yfmt: (v) => `${v}`, title: "Each slice's window (amber), their sum (red)" });
  const nf = 9, shown = 1 + (Math.floor(t * 4) % nf), sum = new Float32Array(Math.round(0.016 * FS) + 1);
  for (let f = 0; f < shown; f++) {
    const s = (f - 1) * HOP, xs = [], ys = [];
    for (let n = 0; n < N; n++) { const i = s + n; if (i < 0 || i >= sum.length) continue; const w2 = WIN[n] * WIN[n]; sum[i] += w2; xs.push((i / FS) * 1000); ys.push(w2); }
    line(g, xs, ys, A.X, A.Y, f === shown - 1 ? C.ref : "rgba(255,182,39,0.35)", f === shown - 1 ? 2 : 1);
  }
  line(g, Array.from(sum, (_, i) => (i / FS) * 1000), Array.from(sum), A.X, A.Y, C.out, 2);
  label(g, "The windows add up to exactly 1,", 4, Hh - 30, { color: C.ink2 });
  label(g, "so nothing is lost or doubled.", 4, Hh - 8, { color: C.ink2 });
}

// ---------- 11. Limiter: level at the eardrum vs. the max output ----------
function v11(g, W, Hh, t, S) {
  const a = S.res[11].aux;
  if (!a) return bypassed(g, W, Hh);
  const xs = a.before.map((_, i) => i * a.dt);
  const A = timeAxes(g, boxIn(W, 26, 120), [40, 120], [40, 80, 112], (v) => `${v}`, "Level at the eardrum: in (blue), out (red)");
  line(g, xs, a.before, A.X, A.Y, C.in, 1);
  line(g, xs, a.after, A.X, A.Y, C.out, 1.5);
  line(g, [0, DUR()], [P.mpoSpl, P.mpoSpl], A.X, A.Y, C.ref, 1.5, [6, 4]);
  const B = timeAxes(g, boxIn(W, 200, 56), [-15, 1], [0, -10], (v) => `${v}`, "Gain, dB");
  line(g, xs, a.gr, B.X, B.Y, C.out, 2);
  playhead(g, A.X(t), 26, 120); playhead(g, B.X(t), 200, 56);
  const maxGr = Math.min(...a.gr);
  label(g, maxGr > -0.1 ? "Nothing reaches the limit here." : "Dashed line: the aid's max output.", 4, Hh - 30, { color: C.ink2 });
  label(g, maxGr > -0.1 ? "Set step 6 to Off to see it work." : "Red stays under it.", 4, Hh - 8, { color: C.ink2 });
}

// ---------- 12. Receiver: its response and the pressure at the eardrum ----------
function v12(g, W, Hh, t, S) {
  const fs = [], ds = [];
  for (let f = 100; f <= 8000; f *= 1.04) { fs.push(f); ds.push(receiverDb(f)); }
  const A = axes(g, boxIn(W, 26, 96), { x: [100, 8000], xlog: true, y: [-30, 12], xticks: [100, 300, 1000, 3000, 8000], xfmt: (v) => (v >= 1000 ? `${v / 1000}k` : `${v}`), yticks: [-24, -12, 0, 12], yfmt: (v) => `${v}`, title: "Speaker response, dB" });
  line(g, fs, ds.map((d) => Math.max(-30, d)), A.X, A.Y, C.ref, 2);
  const y = S.res[12].out.mix[0], span = 0.01, ta = Math.max(0, t - span), tb = Math.min(DUR(), ta + 2 * span);
  const xs = [], ys = []; let pk = 1e-9;
  for (let i = Math.round(ta * FS); i < Math.round(tb * FS); i++) { xs.push(i / FS); ys.push(y[i] * PA_PER_UNIT); pk = Math.max(pk, Math.abs(y[i] * PA_PER_UNIT)); }
  const B = axes(g, boxIn(W, 176, 90), { x: [ta, tb], y: [-pk * 1.1, pk * 1.1], xticks: [], yticks: [0], yfmt: () => "0 Pa", title: "Sound wave at the eardrum, Pa (20 ms)" });
  line(g, xs, ys, B.X, B.Y, C.out, 1.5);
}

export const VIEWS = [null,
  { draw: v1, h: 360, label: "Top view of the scene. Rings show sound moving to the aid." },
  { draw: v2, h: 310, label: "The canceller's model of the leak path converging during fitting." },
  { draw: v3, h: 310, label: "Mic agreement below 300 Hz and the wind gain over time." },
  { draw: v4, h: 340, label: "Polar response of the beam at 1 kHz." },
  { draw: v5, h: 320, label: "The STFT window sliding over the waveform, and the current frame's spectrum." },
  { draw: v6, h: 330, label: "The three masks T, I, N over time and frequency." },
  { draw: v7, h: 320, label: "The noise weight a as a function of noise level." },
  { draw: v8, h: 310, label: "Current frame power vs. the noise floor, and the gain per bin." },
  { draw: v9, h: 350, label: "Gain per band now, and one band's input-output curve." },
  { draw: v10, h: 260, label: "Overlap-add: squared windows sum to 1." },
  { draw: v11, h: 320, label: "Level at the eardrum before and after the limiter." },
  { draw: v12, h: 310, label: "Receiver response and the pressure at the eardrum." },
];
