// App shell: home (hero + one tab) and the Pipeline page.
// The pipeline page runs the 12 steps in dsp/pipeline.js, draws each signal as a spectrogram,
// animates each step (viz.js), and plays any point of the chain.
import { parseWav } from "./dsp/core.js";
import { buildScene, run, airSignal, ledger, toTime, spectrogram, PARTS, P } from "./dsp/pipeline.js";
import { SRC, STATUS, PART_NAMES, SCENE_ROWS, NODES, STEPS, INTRO, ORDER_NOTE } from "./data.js";
import { VIEWS } from "./viz.js";
import { C, fit, axes, specImage, playhead, SPEC_RANGE, inferno, fmtDb } from "./plots.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const SCREENS = ["home", "pipeline"];
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const ICONS = {
  chain: '<svg viewBox="0 0 44 32" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="9" height="10"/><rect x="18" y="11" width="9" height="10"/><rect x="33" y="11" width="8" height="10"/><path d="M12 16h6M27 16h6"/></svg>',
};
$$("[data-ico]").forEach((el) => { el.innerHTML = ICONS[el.dataset.ico] || ""; });

const chip = (st) => `<span class="st st-${st}">${STATUS[st]}</span>`;
function srcLink(key) {
  const s = SRC[key];
  return s ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)} ↗</a>` : "";
}

// ---------- home hero: noisy sound in, 12 steps, clean sound out ----------
const hero = (() => {
  const cv = $("#hero");
  let raf = 0;
  function frame(ms) {
    const { g, W, H } = fit(cv), t = ms / 1000, mid = H / 2, x0 = W * 0.38, x1 = W * 0.62, amp = H * 0.3;
    g.clearRect(0, 0, W, H);
    const env = (x) => 0.3 + 0.7 * Math.abs(Math.sin(x * 0.02 + t * 0.8)) ** 1.5;
    g.lineWidth = 1.5; g.strokeStyle = C.in; g.beginPath();
    for (let x = 0; x <= x0; x += 2) {
      const n = Math.sin(x * 0.9 + t * 13) * 0.5 + Math.sin(x * 2.3 - t * 21) * 0.5;
      const y = mid + (env(x) * Math.sin(x * 0.35 + t * 6) * 0.55 + n * 0.45) * amp;
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    g.lineWidth = 2; g.strokeStyle = C.out; g.beginPath();
    for (let x = x1; x <= W; x += 2) { const y = mid + env(x) * Math.sin(x * 0.35 + t * 6) * amp * 0.9; x > x1 ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    g.fillStyle = "#121a30"; g.strokeStyle = "rgba(160,172,205,0.5)"; g.lineWidth = 1.5;
    g.beginPath(); g.roundRect(x0, mid - 26, x1 - x0, 52, 8); g.fill(); g.stroke();
    g.fillStyle = C.ink; g.font = '600 16px "IBM Plex Sans", sans-serif'; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("12 steps", (x0 + x1) / 2, mid);
    if (!still) raf = requestAnimationFrame(frame);
  }
  return { run(on) { cancelAnimationFrame(raf); if (on) raf = requestAnimationFrame(frame); } };
})();

// ---------- pipeline state ----------
const settings = { mode: "front", mask: "oracle", bypass: {} };
let scene = null, res = null, air = null, len = 0;
const specImg = []; // cached spectrogram image per node
const audioBuf = []; // cached AudioBuffer per node
const nodeSig = (k) => (k === 0 ? air : res[k].out);

// ---------- playhead and audio ----------
const clock = { t: 0, running: !still, speed: 1, last: 0 };
const audio = { ctx: null, src: null, node: -1, start: 0, offset: 0, out: null };
const PLAY_GAIN = 10; // digital 1.0 = 120 dB SPL, so 100 dB SPL plays at full scale; the same for every point

function audioCtx() {
  if (!audio.ctx) {
    audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const lim = audio.ctx.createDynamicsCompressor(); // safety only: catches peaks above −3 dBFS
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1;
    audio.out = audio.ctx.createGain(); audio.out.gain.value = PLAY_GAIN;
    audio.out.connect(lim); lim.connect(audio.ctx.destination);
  }
  return audio.ctx;
}
function bufferFor(k) {
  if (!audioBuf[k]) {
    const x = toTime(nodeSig(k), len), b = audioCtx().createBuffer(1, x.length, 16000);
    b.copyToChannel(x, 0); audioBuf[k] = b;
  }
  return audioBuf[k];
}
function stopAudio() {
  if (audio.src) { audio.src.onended = null; try { audio.src.stop(); } catch {} audio.src.disconnect(); }
  audio.src = null; audio.node = -1;
  $$(".hear").forEach((b) => { b.setAttribute("aria-pressed", "false"); b.textContent = "Hear"; });
}
function playNode(k, from = clock.t) {
  stopAudio();
  const ctx = audioCtx();
  if (ctx.state === "suspended") ctx.resume();
  const s = ctx.createBufferSource();
  s.buffer = bufferFor(k); s.loop = true; s.connect(audio.out);
  s.start(0, from % P.dur);
  Object.assign(audio, { src: s, node: k, start: ctx.currentTime, offset: from % P.dur });
  clock.running = true; clock.speed = 1; syncTransport();
  const b = $(`.hear[data-node="${k}"]`);
  if (b) { b.setAttribute("aria-pressed", "true"); b.textContent = "Stop"; }
}

// ---------- spectrograms and views: draw only what is on screen ----------
const visible = new Set();
const io = new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target))), { rootMargin: "120px 0px" });

function drawSpec(cv, t) {
  const k = +cv.dataset.node;
  if (!specImg[k]) { const sp = spectrogram(nodeSig(k)); specImg[k] = { img: specImage(sp), sp }; }
  const { img, sp } = specImg[k], { g, W, H } = fit(cv);
  g.clearRect(0, 0, W, H);
  const A = axes(g, { x0: 46, y0: 6, w: W - 58, h: H - 34 }, { x: [0, P.dur], y: [0, 8], xticks: [0, 1, 2, 3], xfmt: (v) => `${v} s`, yticks: [0, 2, 4, 6, 8], yfmt: (v) => (v ? `${v}k` : "0 Hz") });
  const xa = A.X(sp.t0 - sp.dt / 2), xb = A.X(sp.t0 + (sp.M - 0.5) * sp.dt);
  g.save(); g.beginPath(); g.rect(A.box.x0 + 1, A.box.y0 + 1, A.box.w - 2, A.box.h - 2); g.clip();
  g.imageSmoothingEnabled = !sp.fine ? false : true;
  g.drawImage(img, xa, A.box.y0, xb - xa, A.box.h);
  g.restore();
  playhead(g, A.X(t), A.box.y0, A.box.h);
}
function drawView(cv, t) {
  const k = +cv.dataset.step, { g, W, H } = fit(cv);
  g.clearRect(0, 0, W, H);
  VIEWS[k].draw(g, W, H, t, { scene, res, settings, len, air });
}
function drawLegend() {
  const cv = $("#spec-legend");
  if (!cv) return;
  const { g, W, H } = fit(cv), [lo, hi] = SPEC_RANGE, x0 = 8, w = W - 16;
  for (let x = 0; x < w; x++) { const [r, gg, b] = inferno(x / (w - 1)); g.fillStyle = `rgb(${r},${gg},${b})`; g.fillRect(x0 + x, 4, 1, 14); }
  g.font = '15px "IBM Plex Sans", sans-serif'; g.fillStyle = C.ink2; g.textBaseline = "top";
  for (const v of [10, 30, 50, 70, 90]) { const x = x0 + ((v - lo) / (hi - lo)) * w; g.textAlign = v === lo ? "left" : v === hi ? "right" : "center"; g.fillText(`${v}`, x, 22); }
}

function tick(ms) {
  const dt = clock.last ? Math.min(0.1, (ms - clock.last) / 1000) : 0;
  clock.last = ms;
  if (audio.src) clock.t = (audio.offset + (audio.ctx.currentTime - audio.start)) % P.dur;
  else if (clock.running) clock.t = (clock.t + dt * clock.speed) % P.dur;
  if (document.body.dataset.screen === "pipeline" && res) {
    for (const cv of visible) cv.classList.contains("spec") ? drawSpec(cv, clock.t) : drawView(cv, clock.t);
    const s = $("#tp-scrub"); if (s && document.activeElement !== s) s.value = Math.round(clock.t * 1000);
    $("#tp-time").textContent = `${clock.t.toFixed(2)} s`;
  }
  requestAnimationFrame(tick);
}

// ---------- page build ----------
function ledgerRows(k) {
  const a = k === 1 ? ledger(air) : res[k - 1].ledger, b = res[k].ledger;
  const row = (name, x, y, unit = "") => {
    let d = Number.isFinite(x) && Number.isFinite(y) && x > -60 && y > -60 ? y - x : NaN;
    if (Math.abs(d) < 0.05) d = 0;
    const big = Math.abs(d) >= 3 ? ' class="big"' : "";
    return `<tr><th scope="row">${name}</th><td>${fmtDb(x)}</td><td>${fmtDb(y)}</td><td${big}>${Number.isFinite(d) ? (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(d).toFixed(1) : "—"}</td></tr>`;
  };
  return PARTS.map((p) => row(PART_NAMES[p], a[p], b[p])).join("") + row("All", a.mix, b.mix) + row("SNR", a.snr, b.snr);
}
function fillLedger(k) {
  const el = $(`#ledger-${k}`);
  if (el) el.innerHTML = ledgerRows(k);
}

function seg(name, opts, value) {
  return `<div class="seg" role="radiogroup" aria-label="${esc(name)}">` + opts.map(([v, l]) => {
    const id = `${name}-${v}`.replace(/\W+/g, "-");
    return `<input class="vh" type="radio" name="${esc(name)}" id="${id}" value="${v}"${v === value ? " checked" : ""}><label for="${id}">${esc(l)}</label>`;
  }).join("") + "</div>";
}

function nodeHtml(k) {
  const n = NODES[k];
  return `<section class="node" id="node-${k}">
    <div class="node-head"><span class="node-k">${k === 0 ? "In" : k === 12 ? "Out" : `after ${k}`}</span><h3>${esc(n.title)}</h3><button class="btn hear" type="button" data-node="${k}" aria-pressed="false">Hear</button></div>
    <p class="dom">${esc(n.domain)}</p>
    <canvas class="spec" data-node="${k}" aria-label="Spectrogram: ${esc(n.title)}, 0 to 8 kHz over 3.5 s, color = dB SPL per 250 Hz"></canvas>
  </section>`;
}
function stepHtml(k) {
  const s = STEPS[k], v = VIEWS[k];
  const ctl = [];
  if (s.bypass) ctl.push(`<label class="tog"><input type="checkbox" data-bypass="${k}"> Bypass</label>`);
  if (s.maskSelect) ctl.push(seg("mask", [["oracle", "Placeholder"], ["classic", "Classic"], ["off", "Off"]], settings.mask));
  const params = s.params.map((p) => `<li>${chip(p.st)} ${esc(p.t)}${p.src ? ` ${srcLink(p.src)}` : ""}</li>`).join("");
  return `<article class="step${s.status === "placeholder" ? " is-ph" : ""}" id="step-${k}">
    <header class="step-head"><span class="num">${k}</span><h3>${esc(s.name)}</h3><span class="where">${esc(s.where)}</span></header>
    ${s.maskSelect ? `<p class="ph-banner" id="ph-banner"><b>Placeholder.</b> This step uses the ideal mask, computed from the true parts. It is not Fortell's network.</p>` : ""}
    <p class="job">${esc(s.job)}</p>
    <pre class="fn">${s.fn.map(esc).join("\n")}</pre>
    ${ctl.length ? `<div class="ctl">${ctl.join("")}</div>` : ""}
    <canvas class="viz" data-step="${k}" style="height:${v.h}px" aria-label="${esc(v.label)}"></canvas>
    <table class="ledger"><caption>Level of each part, dB SPL${k <= 3 ? " (front mic)" : ""}. SNR: front talker vs. the rest, dB.</caption>
      <thead><tr><th scope="col">Part</th><th scope="col">In</th><th scope="col">Out</th><th scope="col">Change</th></tr></thead>
      <tbody id="ledger-${k}"></tbody></table>
    <details class="params"><summary>Values and sources</summary><ul>${params}</ul></details>
  </article>`;
}

function buildPage() {
  const sceneRows = SCENE_ROWS.map((r) => `<tr><th scope="row">${esc(PART_NAMES[r.part])}</th><td>${esc(r.what)}</td><td>${esc(r.spl)}</td></tr>`).join("");
  $("#pl-top").innerHTML = `
    <p class="intro">${esc(INTRO)}</p>
    <p class="note">${esc(ORDER_NOTE)} ${srcLink("blog")}</p>
    <div class="legend-st">${Object.keys(STATUS).map(chip).join("")}</div>
    <section class="panel">
      <h3>The test scene</h3>
      <table class="scene"><thead><tr><th scope="col">Part</th><th scope="col">What</th><th scope="col">dB SPL</th></tr></thead><tbody>${sceneRows}</tbody></table>
      <p class="small-note">${srcLink("asv")}</p>
      <h3>Mode</h3>
      ${seg("mode", [["front", "Front Voices"], ["all", "All Voices"]], settings.mode)}
      <p class="small-note">Fortell's two modes. The mode changes steps 4 and 7.</p>
      <h3>Color in the plots</h3>
      <canvas id="spec-legend" aria-label="Color scale: 10 to 90 dB SPL per 250 Hz band"></canvas>
      <p class="small-note">dB SPL in each 250 Hz band. "Hear" plays that point with the same gain everywhere, so louder means louder in the aid. Start at a low volume.</p>
    </section>`;
  let chain = nodeHtml(0);
  for (let k = 1; k <= 12; k++) chain += stepHtml(k) + nodeHtml(k);
  $("#pl-chain").innerHTML = chain;
  $$("#pipeline canvas.spec, #pipeline canvas.viz").forEach((cv) => io.observe(cv));
  for (let k = 1; k <= 12; k++) fillLedger(k);
  drawLegend();
  buildToc();

  $$("#pipeline .hear").forEach((b) => b.addEventListener("click", () => {
    const k = +b.dataset.node;
    if (audio.node === k) stopAudio(); else playNode(k);
  }));
  $$('input[name="mode"]').forEach((r) => r.addEventListener("change", () => { settings.mode = r.value; update(4); }));
  $$('input[name="mask"]').forEach((r) => r.addEventListener("change", () => {
    settings.mask = r.value;
    $("#ph-banner").hidden = r.value !== "oracle";
    $("#step-6").classList.toggle("is-ph", r.value === "oracle");
    update(6);
  }));
  $$("[data-bypass]").forEach((c) => c.addEventListener("change", () => {
    const k = +c.dataset.bypass;
    settings.bypass[k] = c.checked;
    $(`#step-${k}`).classList.toggle("off", c.checked);
    update(k);
  }));
}

// ---------- table of contents: click to jump; the current section lights up as you scroll ----------
const TOC = [
  { id: "pl-top", n: "In", t: "Test scene" },
  ...STEPS.slice(1).map((s, i) => ({ id: `step-${i + 1}`, n: String(i + 1), t: s.name })),
  { id: "node-12", n: "Out", t: "Ear canal" },
];
const toc = { active: -1, lockUntil: 0, queued: false };
function setActive(i) {
  if (i === toc.active) return;
  toc.active = i;
  $$("#toc button").forEach((b, j) => b.setAttribute("aria-current", j === i ? "true" : "false"));
}
function spy() {
  toc.queued = false;
  if (document.body.dataset.screen !== "pipeline" || !res || performance.now() < toc.lockUntil) return;
  const line = window.innerHeight * 0.4; // the section whose top passed this line is the current one
  let i = 0;
  TOC.forEach((e, j) => { const el = document.getElementById(e.id); if (el && el.getBoundingClientRect().top <= line) i = j; });
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) i = TOC.length - 1;
  setActive(i);
}
function buildToc() {
  const nav = $("#toc");
  nav.innerHTML = `<ol>${TOC.map((e, i) => `<li><button type="button" data-i="${i}" aria-label="${esc(e.t)}" aria-current="false"><span class="n" aria-hidden="true">${e.n}</span><span class="t">${esc(e.t)}</span></button></li>`).join("")}</ol>`;
  $$("button", nav).forEach((b) => b.addEventListener("click", () => {
    const i = +b.dataset.i;
    setActive(i);
    toc.lockUntil = performance.now() + 1200; // hold the highlight while the smooth scroll passes other sections
    document.getElementById(TOC[i].id).scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  }));
  spy();
}
window.addEventListener("scroll", () => { if (!toc.queued) { toc.queued = true; requestAnimationFrame(spy); } }, { passive: true });
window.addEventListener("scrollend", () => { toc.lockUntil = 0; spy(); });

/** Rerun steps from..12, then redraw what changed. A change at step k reaches every later step. */
function update(from) {
  document.body.classList.add("busy");
  setTimeout(() => {
    run(scene, settings, res, from);
    for (let k = from; k <= 12; k++) { specImg[k] = null; audioBuf[k] = null; fillLedger(k); }
    if (audio.node >= from) playNode(audio.node, clock.t);
    document.body.classList.remove("busy");
  }, 20);
}

function syncTransport() {
  const b = $("#tp-play");
  if (!b) return;
  const on = clock.running || audio.src;
  b.textContent = on ? "Pause" : "Play";
  b.setAttribute("aria-pressed", on ? "true" : "false");
  $("#tp-speed").textContent = clock.speed === 1 ? "1×" : "0.1×";
}
function wireTransport() {
  $("#tp-play").addEventListener("click", () => {
    if (clock.running || audio.src) { clock.running = false; stopAudio(); }
    else clock.running = true;
    syncTransport();
  });
  $("#tp-speed").addEventListener("click", () => {
    clock.speed = clock.speed === 1 ? 0.1 : 1;
    if (clock.speed !== 1) stopAudio();
    clock.running = true; syncTransport();
  });
  $("#tp-scrub").addEventListener("input", (e) => {
    clock.t = +e.target.value / 1000;
    if (audio.src) playNode(audio.node, clock.t);
  });
  syncTransport();
}

let loading = null;
async function loadPipeline() {
  if (loading) return loading;
  loading = (async () => {
    const [low, high] = await Promise.all(["clips/low.wav", "clips/high.wav"].map(async (u) => parseWav(await (await fetch(u)).arrayBuffer()).data));
    scene = buildScene(low, high);
    len = scene.n;
    air = airSignal(scene);
    res = run(scene, settings);
    buildPage();
    $("#pl-status").hidden = true;
  })();
  return loading;
}

// ---------- routes ----------
function route() {
  const name = (location.hash.match(/^#\/(\w+)/) || [])[1];
  const screen = SCREENS.includes(name) ? name : "home";
  document.body.dataset.screen = screen;
  hero.run(screen === "home");
  if (screen === "pipeline") loadPipeline().catch((e) => { $("#pl-status").textContent = `Could not load: ${e.message}`; });
  else stopAudio();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
window.addEventListener("resize", () => { if (res) drawLegend(); });
wireTransport();
route();
requestAnimationFrame(tick);

// ---------- Vercel Web Analytics (skip automated browsers) ----------
if (location.hostname.endsWith("vercel.app") && !navigator.webdriver && !/HeadlessChrome/.test(navigator.userAgent)) {
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  const s = document.createElement("script");
  s.defer = true; s.src = "/_vercel/insights/script.js";
  document.head.appendChild(s);
}
