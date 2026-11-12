// Listen tab: two experiments with Fortell's published values.
// 1) Compression with the manual's attack/release (13 / 470 ms): pumping after claps.
// 2) Own voice in a closed dome (occlusion effect): air path + skull path, summed in phase.
const $ = (s) => document.querySelector(s);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const L10 = Math.log10;
const MONO = '"JetBrains Mono", ui-monospace, monospace';

// ---------- canvas helpers ----------
function prep(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.max(10, cv.clientWidth), h = Math.max(10, cv.clientHeight);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  return { g, w, h };
}
function txt(g, s, x, y, color, align = "left") { g.font = `15px ${MONO}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = "alphabetic"; g.fillText(s, x, y); }
function line(g, x1, y1, x2, y2) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
const C = () => ({ ink: css("--ink"), muted: css("--muted"), grid: css("--edge"), red: css("--red"), cyan: css("--cyan"), amber: css("--amber"), redS: css("--red-soft") });
const fmtDb = (v) => { const r = Math.round(v * 10) / 10; return Math.abs(r) < 0.05 ? "0 dB" : (r > 0 ? "+" : "−") + Math.abs(r).toFixed(1) + " dB"; };

// ---------- audio core ----------
let ac = null, master = null, cur = null;
const vol = $("#vol");
const volGain = () => { const v = +vol.value / 100; return 1.1 * v * v; };
function audio() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain(); master.gain.value = volGain();
    const lim = ac.createDynamicsCompressor();
    lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1;
    master.connect(lim); lim.connect(ac.destination);
  }
  if (ac.state === "suspended") ac.resume();
  return ac;
}
vol.addEventListener("input", () => {
  $("#volOut").textContent = vol.value + "%";
  if (master) master.gain.setTargetAtTime(volGain(), ac.currentTime, 0.02);
});
function stopAll() {
  if (cur) { try { cur.stop(); } catch (e) { /* already stopped */ } cur = null; }
  document.querySelectorAll(".btn-play").forEach((b) => { b.setAttribute("aria-pressed", "false"); b.textContent = "Play"; });
}
function bindPlay(btn, start) {
  btn.addEventListener("click", async () => {
    if (btn.getAttribute("aria-pressed") === "true") { stopAll(); return; }
    const a = audio(); if (!a) { btn.textContent = "No audio"; return; }
    stopAll();
    btn.setAttribute("aria-pressed", "true"); btn.textContent = "Loading…";
    try {
      const h = await start(a);
      if (btn.getAttribute("aria-pressed") !== "true") { h.stop(); return; }
      cur = h; btn.textContent = "Stop";
    } catch (e) {
      btn.setAttribute("aria-pressed", "false"); btn.textContent = "Play";
    }
  });
}
let pinkBuf = null;
function pink() {
  if (pinkBuf) return pinkBuf;
  const sr = ac.sampleRate, n = Math.floor(sr * 3), b = ac.createBuffer(1, n, sr), d = b.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
  }
  return (pinkBuf = b);
}

// ---------- 1) compression ----------
const THR = -30, RATIO = 3, ATK = 0.013, CLAPS = [0.5, 1.5, 2.5], DUR = 3;
const relMs = () => +document.querySelector('input[name="rel"]:checked').value;
const bedDb = (t) => -33 + 3 * Math.sin(2 * Math.PI * 4 * t);
function inLevel(t) {
  let a = Math.pow(10, bedDb(t) / 20);
  CLAPS.forEach((tc) => { if (t >= tc) a += 0.5 * Math.exp(-(t - tc) / 0.03); });
  return 20 * L10(a);
}
function simComp() {
  const rel = relMs(), on = rel > 0, dt = 1 / 2000, n = Math.round(DUR / dt);
  const inp = new Float32Array(n), out = new Float32Array(n);
  const ka = 1 - Math.exp(-dt / ATK), kr = on ? 1 - Math.exp(-dt / (rel / 1000)) : 1;
  let gr = 0;
  for (let i = 0; i < n; i++) {
    const L = inLevel(i * dt), tgt = on && L > THR ? (L - THR) * (1 - 1 / RATIO) : 0;
    gr += (tgt - gr) * (tgt > gr ? ka : kr);
    inp[i] = L; out[i] = L - gr;
  }
  return { inp, out, dt };
}
function drawComp() {
  const sim = simComp(), { g, w, h } = prep($("#c-plot")), c = C();
  const top = 0, bot = -45, x0 = 44, x1 = w - 8, y0 = 8, y1 = h - 28;
  const X = (t) => x0 + (t / DUR) * (x1 - x0), Y = (v) => y0 + ((top - Math.max(bot, Math.min(top, v))) / (top - bot)) * (y1 - y0);
  g.strokeStyle = c.grid; g.lineWidth = 1;
  for (let s = 0; s <= DUR; s += 1) { const x = Math.round(X(s)) + 0.5; line(g, x, y0, x, y1); txt(g, s + " s", x, y1 + 20, c.muted, s === 0 ? "left" : s === DUR ? "right" : "center"); }
  for (let v = 0; v >= -40; v -= 20) { const y = Math.round(Y(v)) + 0.5; line(g, x0, y, x1, y); txt(g, v === 0 ? "0" : "−" + -v, x0 - 6, y + 5, c.muted, "right"); }
  g.strokeStyle = c.amber; g.setLineDash([5, 4]); line(g, x0, Y(THR), x1, Y(THR)); g.setLineDash([]);
  txt(g, "threshold", x1 - 2, Y(THR) - 6, c.amber, "right");
  const path = (arr, col, lw) => {
    g.strokeStyle = col; g.lineWidth = lw; g.beginPath();
    for (let i = 0; i < arr.length; i += 2) { const x = X(i * sim.dt), y = Y(arr[i]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  };
  path(sim.inp, c.cyan, 1.5); path(sim.out, c.red, 2.2);
  // readout
  const rel = relMs();
  if (!rel) { $("#c-read").innerHTML = "Compression off: output equals input."; return; }
  const tc = CLAPS[1], dt = sim.dt; let base = 0, pump = 0, rec = null;
  for (let i = Math.floor((tc - 0.3) / dt); i < Math.floor((tc - 0.02) / dt); i++) base = Math.max(base, sim.inp[i] - sim.out[i]);
  for (let j = Math.floor((tc + 0.12) / dt); j < Math.floor((tc + 0.95) / dt); j++) {
    const grj = sim.inp[j] - sim.out[j] - base;
    if (grj > pump) pump = grj;
    if (rec === null && grj < 1) rec = j * dt - tc;
  }
  $("#c-read").innerHTML = pump < 1 ? "The background stays steady after each clap."
    : `After each clap, the background drops up to <b>${pump.toFixed(1)} dB</b> and takes <b>${rec === null ? "over 950" : Math.round(rec * 1000)} ms</b> to come back.`;
}
let clapBuf = null;
function clapScene() {
  if (clapBuf) return clapBuf;
  const sr = ac.sampleRate, n = Math.floor(sr * DUR), b = ac.createBuffer(1, n, sr), d = b.getChannelData(0), p = pink().getChannelData(0);
  let s = 0; for (let i = 0; i < n; i++) s += p[i % p.length] ** 2;
  const rms = Math.sqrt(s / n) || 1;
  for (let k = 0; k < n; k++) {
    const t = k / sr; let v = (Math.pow(10, bedDb(t) / 20) * p[k % p.length]) / rms;
    CLAPS.forEach((tc) => { if (t >= tc) v += 0.5 * Math.exp(-(t - tc) / 0.03) * (Math.random() * 2 - 1) * 1.7; });
    d[k] = v;
  }
  return (clapBuf = b);
}
let compLive = null;
bindPlay($("#c-play"), async (a) => {
  const src = a.createBufferSource(); src.buffer = clapScene(); src.loop = true;
  const k = a.createDynamicsCompressor(), wet = a.createGain(), dry = a.createGain(), out = a.createGain();
  k.knee.value = 0; k.threshold.value = THR; k.ratio.value = RATIO; k.attack.value = ATK; k.release.value = (relMs() || 470) / 1000;
  wet.gain.value = relMs() ? 1 : 0; dry.gain.value = relMs() ? 0 : 1; out.gain.value = 1.4;
  src.connect(k); k.connect(wet); src.connect(dry); wet.connect(out); dry.connect(out); out.connect(master); src.start();
  compLive = { k, wet, dry };
  return { stop() { try { src.stop(); } catch (e) { /* stopped */ } out.disconnect(); compLive = null; } };
});
document.querySelectorAll('input[name="rel"]').forEach((r) => r.addEventListener("change", () => {
  drawComp();
  if (compLive) {
    const t = ac.currentTime, rel = relMs();
    if (rel) compLive.k.release.setValueAtTime(rel / 1000, t);
    compLive.wet.gain.setTargetAtTime(rel ? 1 : 0, t, 0.02); compLive.dry.gain.setTargetAtTime(rel ? 0 : 1, t, 0.02);
  }
}));

// ---------- 2) own voice in a closed dome ----------
const SIG = 4.9e-4; // skull path: Gaussian low-pass, sigma in seconds
const BONE = { open: 0.45, closed: 5, anc: 1 };
const dome = () => document.querySelector('input[name="be"]:checked').value;
const boneResp = (f) => Math.exp(-2 * Math.PI * Math.PI * SIG * SIG * f * f);
const boomDb = (f) => 20 * L10(1 + BONE[dome()] * boneResp(f));
function drawBoom() {
  const { g, w, h } = prep($("#b-plot")), c = C();
  const F0 = 50, F1 = 8000, TOP = 20, BOT = -5, x0 = 44, x1 = w - 8, y0 = 8, y1 = h - 28;
  const X = (f) => x0 + (L10(f / F0) / L10(F1 / F0)) * (x1 - x0), Y = (v) => y0 + ((TOP - v) / (TOP - BOT)) * (y1 - y0);
  g.strokeStyle = c.grid; g.lineWidth = 1;
  [50, 100, 200, 500, 1000, 2000, 5000].forEach((f) => { const x = Math.round(X(f)) + 0.5; line(g, x, y0, x, y1); txt(g, f >= 1000 ? f / 1000 + "k" : String(f), x, y1 + 20, c.muted, f === 50 ? "left" : "center"); });
  [20, 10].forEach((v) => { const y = Math.round(Y(v)) + 0.5; line(g, x0, y, x1, y); txt(g, "+" + v, x0 - 6, y + 5, c.muted, "right"); });
  const pts = []; for (let i = 0; i <= 300; i++) { const f = F0 * Math.pow(F1 / F0, i / 300); pts.push([X(f), Y(boomDb(f))]); }
  g.beginPath(); g.moveTo(pts[0][0], Y(0)); pts.forEach((p) => g.lineTo(p[0], p[1])); g.lineTo(pts[300][0], Y(0)); g.closePath(); g.fillStyle = c.redS; g.fill();
  g.strokeStyle = c.ink; line(g, x0, Math.round(Y(0)) + 0.5, x1, Math.round(Y(0)) + 0.5); txt(g, "0 = open ear", x1 - 2, Y(0) - 7, c.muted, "right");
  g.strokeStyle = c.red; g.lineWidth = 2.5; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
  txt(g, "Hz", x1, y1 + 20, c.muted, "right");
  const d = dome(), v = fmtDb(boomDb(250));
  $("#b-read").innerHTML = d === "open" ? `Open dome: most of the skull sound leaks out. <b>${v}</b> at 250 Hz.`
    : d === "closed" ? `Closed dome: the seal traps it. <b>${v}</b> at 250 Hz. That is the boom.`
    : `Cancellation removes most of the skull path. <b>${v}</b> at 250 Hz is left.`;
}
const clips = {};
async function voice(key) {
  if (clips[key]) return clips[key];
  const ab = await (await fetch(`clips/${key}.wav`)).arrayBuffer();
  const buf = await new Promise((res, rej) => { const p = ac.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
  const sr = buf.sampleRate, src = buf.getChannelData(0), pad = Math.round(0.5 * sr), n = src.length + pad;
  let pk = 1e-6; for (let i = 0; i < src.length; i++) pk = Math.max(pk, Math.abs(src[i]));
  const air = ac.createBuffer(1, n, sr), d = air.getChannelData(0);
  for (let i = 0; i < src.length; i++) d[i] = (src[i] / pk) * 0.9;
  const s = SIG * sr, half = Math.ceil(4 * s), ker = new Float32Array(2 * half + 1);
  let sum = 0; for (let m = -half; m <= half; m++) { ker[m + half] = Math.exp(-(m * m) / (2 * s * s)); sum += ker[m + half]; }
  const bone = ac.createBuffer(1, n, sr), o = bone.getChannelData(0);
  for (let t = 0; t < n; t++) { // zero-phase, so both paths stay aligned
    let acc = 0; const lo = Math.max(0, t - half), hi = Math.min(n - 1, t + half);
    for (let u = lo; u <= hi; u++) acc += d[u] * ker[u - t + half];
    o[t] = acc / sum;
  }
  return (clips[key] = { air, bone });
}
let boomLive = null;
bindPlay($("#b-play"), async (a) => {
  const v = await voice(document.querySelector('input[name="bv"]:checked').value);
  const s1 = a.createBufferSource(), s2 = a.createBufferSource(), bg = a.createGain(), out = a.createGain();
  s1.buffer = v.air; s2.buffer = v.bone; s1.loop = s2.loop = true;
  bg.gain.value = BONE[dome()]; out.gain.value = 0.16;
  s1.connect(out); s2.connect(bg); bg.connect(out); out.connect(master);
  const when = a.currentTime + 0.05; s1.start(when); s2.start(when);
  boomLive = { bg };
  return { stop() { try { s1.stop(); s2.stop(); } catch (e) { /* stopped */ } out.disconnect(); boomLive = null; } };
});
document.querySelectorAll('input[name="be"]').forEach((r) => r.addEventListener("change", () => {
  drawBoom();
  if (boomLive) boomLive.bg.gain.setTargetAtTime(BONE[dome()], ac.currentTime, 0.03);
}));
document.querySelectorAll('input[name="bv"]').forEach((r) => r.addEventListener("change", () => {
  const b = $("#b-play"); if (b.getAttribute("aria-pressed") === "true") { stopAll(); b.click(); }
}));

// ---------- tab hooks ----------
let shown = false;
function drawAll() { drawComp(); drawBoom(); }
window.addEventListener("resize", () => { if (shown) drawAll(); });
export function showListen() { shown = true; drawAll(); if (document.fonts) document.fonts.ready.then(() => shown && drawAll()); }
export function leaveListen() { shown = false; stopAll(); }
