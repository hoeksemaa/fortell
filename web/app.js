// App shell: home screen, four tabs (hash routes), icons, hero animation, and the three read-only tabs.
// Listen (audio) lives in listen.js.
import { SRC, STATUS, HARDWARE, PIPELINE, PIPELINE_NOTE, PIPELINE_NOTE_SRC, LATENCY, TILES, SERIES, CHARTS } from "./data.js";
import { showListen, leaveListen } from "./listen.js";

const $ = (s) => document.querySelector(s);
const SCREENS = ["home", "hardware", "pipeline", "numbers", "listen"];
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---------- icons (line art, currentColor) ----------
const ICONS = {
  chip: '<svg viewBox="0 0 44 32" fill="none" stroke="currentColor" stroke-width="2"><rect x="13" y="7" width="18" height="18"/><rect x="18" y="12" width="8" height="8" fill="currentColor" opacity=".35"/><path d="M17 3v4M22 3v4M27 3v4M17 25v4M22 25v4M27 25v4M9 11h4M9 16h4M9 21h4M31 11h4M31 16h4M31 21h4"/></svg>',
  chain: '<svg viewBox="0 0 44 32" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="9" height="10"/><rect x="18" y="11" width="9" height="10"/><rect x="33" y="11" width="8" height="10"/><path d="M12 16h6M27 16h6"/></svg>',
  bars: '<svg viewBox="0 0 44 32" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 28h32"/><rect x="9" y="14" width="6" height="14"/><rect x="19" y="6" width="6" height="22" fill="currentColor" opacity=".35"/><rect x="29" y="18" width="6" height="10"/></svg>',
  wave: '<svg viewBox="0 0 44 32" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 16h6l3-8 4 16 4-12 3 8 3-4h17"/></svg>',
};
document.querySelectorAll("[data-ico]").forEach((el) => { el.innerHTML = ICONS[el.dataset.ico] || ""; });

// ---------- shared bits ----------
const chip = (st) => `<span class="st st-${st}">${STATUS[st]}</span>`;
function srcLink(key) {
  const s = SRC[key];
  if (!s) return "";
  return s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)} ↗</a>` : `<span>${esc(s.name)}</span>`;
}
function fillLegends() {
  const html = Object.keys(STATUS).map(chip).join("");
  document.querySelectorAll("[data-legend]").forEach((el) => { el.innerHTML = html; });
}

// ---------- Hardware ----------
function renderHardware() {
  $("#hw-body").innerHTML = HARDWARE.map((sec) => `
    <section class="panel">
      <h3>${esc(sec.title)}</h3>
      <ul class="facts">${sec.facts.map((f) => `
        <li><p>${esc(f.text)}</p>
          <div class="meta">${chip(f.status)}${f.note ? `<span>${esc(f.note)}</span>` : ""}${srcLink(f.src)}</div></li>`).join("")}
      </ul>
    </section>`).join("");
}

// ---------- Pipeline ----------
function renderPipeline() {
  $("#pl-body").innerHTML = PIPELINE.map((b, i) => `
    <li class="blk">
      <span class="num">${i + 1}</span>
      <div class="panel">
        <div class="top"><h3>${esc(b.name)}</h3><span class="where">${esc(b.where)}</span></div>
        <p>${esc(b.job)}</p>
        ${b.params ? `<p class="params">${esc(b.params)}</p>` : ""}
        <div class="meta">${chip(b.status)}${b.note ? `<span>${esc(b.note)}</span>` : ""}${srcLink(b.src)}</div>
      </div>
    </li>`).join("");
  $("#pl-note").innerHTML = `${esc(PIPELINE_NOTE)} <span class="meta-inline">${srcLink(PIPELINE_NOTE_SRC)}</span>`;
  $("#pl-lat").innerHTML = `<div class="lat">${LATENCY.map((r) =>
    `<span class="${r.total ? "tot" : ""}">${esc(r.part)}</span><span class="${r.total ? "tot" : ""}">${esc(r.ms)} ms</span>`).join("")}</div>
    <div class="meta">${chip("patent")}${srcLink("pLat")}</div>`;
}

// ---------- Numbers ----------
function renderNumbers() {
  $("#nb-tiles").innerHTML = TILES.map((t) => `
    <div class="tile"><b>${esc(t.value)}</b><span>${esc(t.label)}</span><div class="meta">${srcLink(t.src)}</div></div>`).join("");
  $("#nb-body").innerHTML = CHARTS.map((c) => {
    const legend = c.single ? "" : `<div class="legend">${["f", "o"].map((k) => `<span><i class="sw sw-${k}"></i>${SERIES[k]}</span>`).join("")}</div>`;
    const rows = c.rows.map((r) => {
      const other = r.bars.find((b) => b.s === "o");
      return `
      <div class="brow"><span>${esc(r.label)}${other ? ` <em class="vs">vs. ${esc(other.who)}</em>` : ""}</span>
        <div class="bars">${r.bars.map((b) => `
          <div class="bar" title="${esc(b.who)}: ${b.v}${esc(c.unit)}">
            <div class="track"><div class="fill ${b.s}" style="width:${Math.max(0.5, (b.v / c.max) * 100)}%"></div></div>
            <span class="val">${b.v}${esc(c.unit)}</span>
          </div>`).join("")}</div>
      </div>`;
    }).join("");
    return `<section class="panel"><h3>${esc(c.title)}</h3>${legend}${rows}
      <p class="note">${esc(c.note)}</p>
      <div class="meta">${chip("published")}${srcLink(c.src)}${c.src2 ? srcLink(c.src2) : ""}</div></section>`;
  }).join("");
}

// ---------- hero: light trails, noisy sound in, clean voice out ----------
const hero = (() => {
  const cv = $("#hero"), g = cv.getContext("2d");
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  let raf = 0, W = 0, H = 0;
  const trails = Array.from({ length: 7 }, (_, i) => ({ y: 0.12 + i * 0.12, v: 0.18 + ((i * 37) % 10) / 40, len: 0.18 + ((i * 53) % 10) / 35, o: (i * 0.29) % 1 }));
  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function frame(ms) {
    const t = ms / 1000, red = css("--red"), cyan = css("--glow-c"), ink = css("--ink");
    g.clearRect(0, 0, W, H);
    // light trails
    trails.forEach((tr) => {
      const x = (((tr.o + t * tr.v * 0.25) % 1.4) - 0.2) * W, y = tr.y * H, L = tr.len * W;
      const grad = g.createLinearGradient(x - L, y, x, y);
      grad.addColorStop(0, "rgba(255,64,87,0)"); grad.addColorStop(1, "rgba(255,64,87,0.55)");
      g.strokeStyle = grad; g.lineWidth = 2; g.beginPath(); g.moveTo(x - L, y); g.lineTo(x, y); g.stroke();
    });
    // waveform: noisy before the chip, clean after
    const mid = H / 2, cx0 = W * 0.42, cx1 = W * 0.58, amp = H * 0.32;
    const env = (u) => 0.25 + 0.75 * Math.pow(Math.abs(Math.sin(u * 7 + t * 0.8)), 1.5);
    g.lineWidth = 1.5; g.strokeStyle = cyan; g.globalAlpha = 0.8; g.beginPath();
    for (let x = 0; x <= cx0; x += 2) {
      const u = x / W, n = Math.sin(x * 0.9 + t * 13) * 0.5 + Math.sin(x * 2.3 - t * 21) * 0.5;
      const y = mid + (env(u) * Math.sin(x * 0.35 + t * 6) * 0.55 + n * 0.45) * amp;
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke(); g.globalAlpha = 1;
    g.strokeStyle = red; g.lineWidth = 2.5; g.shadowColor = red; g.shadowBlur = 10; g.beginPath();
    for (let x = cx1; x <= W; x += 2) {
      const u = x / W, y = mid + env(u) * Math.sin(x * 0.35 + t * 6) * amp * 0.9;
      x > cx1 ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke(); g.shadowBlur = 0;
    // the chip
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
    g.fillStyle = "rgba(17,22,42,0.95)"; g.fillRect(cx0, mid - 30, cx1 - cx0, 60);
    g.strokeStyle = red; g.lineWidth = 2; g.globalAlpha = 0.6 + 0.4 * pulse; g.strokeRect(cx0, mid - 30, cx1 - cx0, 60); g.globalAlpha = 1;
    g.fillStyle = ink; g.font = '700 18px "Saira Condensed", sans-serif'; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("DSP", (cx0 + cx1) / 2, mid);
    if (!still) raf = requestAnimationFrame(frame);
  }
  return {
    run(on) {
      cancelAnimationFrame(raf);
      if (!on) return;
      size();
      raf = requestAnimationFrame(frame);
    },
    resize() { if (document.body.dataset.screen === "home") this.run(true); },
  };
})();
window.addEventListener("resize", () => hero.resize());
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => hero.resize());

// ---------- routes ----------
let rendered = {};
function route() {
  const name = (location.hash.match(/^#\/(\w+)/) || [])[1];
  const screen = SCREENS.includes(name) ? name : "home";
  document.body.dataset.screen = screen;
  hero.run(screen === "home");
  if (!rendered[screen]) {
    if (screen === "hardware") renderHardware();
    if (screen === "pipeline") renderPipeline();
    if (screen === "numbers") renderNumbers();
    rendered[screen] = true;
  }
  if (screen === "listen") showListen(); else leaveListen();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
fillLegends();
route();

// ---------- Vercel Web Analytics (skip automated browsers) ----------
if (location.hostname.endsWith("vercel.app") && !navigator.webdriver && !/HeadlessChrome/.test(navigator.userAgent)) {
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  const s = document.createElement("script");
  s.defer = true; s.src = "/_vercel/insights/script.js";
  document.head.appendChild(s);
}
