// Canvas helpers: sizing, axes with units, colormap, spectrogram images. All text is 15px or larger.

export const C = {
  bg: "#0d1222", grid: "rgba(160,172,205,0.14)", axis: "rgba(160,172,205,0.45)",
  ink: "#e9ecf4", ink2: "#aab3cb", muted: "#8a94b0",
  in: "#2a93c9", out: "#ff4057", ref: "#ffb627", hi: "#f4f1ea",
};
export const FONT = '15px "IBM Plex Sans", system-ui, sans-serif';
export const MONO = '15px "JetBrains Mono", ui-monospace, monospace';

/** Size a canvas to its CSS box at device resolution. Returns {g, W, H}. */
export function fit(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, W, H, dpr };
}

/** Inferno colormap (polynomial fit), t in [0, 1] -> [r, g, b] 0..255. */
export function inferno(t) {
  t = Math.min(1, Math.max(0, t));
  const c = [
    [0.0002189403691192265, 0.001651004631001012, -0.01948089843709184],
    [0.1065134194856116, 0.5639564367884091, 3.932712388889277],
    [11.60249308247187, -3.972853965665698, -15.9423941062914],
    [-41.70399613139459, 17.43639888205313, 44.35414519872813],
    [77.162935699427, -33.40235894210092, -81.80730925738993],
    [-71.31942824499214, 32.62606426397723, 73.20951985803202],
    [25.13112622477341, -12.24266895238567, -23.07032500287172],
  ];
  const out = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) { let v = 0; for (let i = 6; i >= 0; i--) v = v * t + c[i][ch]; out[ch] = Math.round(255 * Math.min(1, Math.max(0, v))); }
  return out;
}
const LUT = Array.from({ length: 256 }, (_, i) => inferno(i / 255));
export const SPEC_RANGE = [10, 90]; // dB SPL in a 250 Hz band

/** A plot box with linear or log axes, gridlines, tick labels, and an axis title with units. */
export function axes(g, box, o) {
  const { x0, y0, w, h } = box;
  const lx = (v) => (o.xlog ? Math.log(v) : v), ly = (v) => v;
  const [xa, xb] = o.x.map(lx), [ya, yb] = o.y.map(ly);
  const X = (v) => x0 + ((lx(v) - xa) / (xb - xa)) * w;
  const Y = (v) => y0 + h - ((ly(v) - ya) / (yb - ya)) * h;
  g.save();
  g.font = FONT; g.lineWidth = 1;
  g.strokeStyle = C.grid; g.fillStyle = C.ink2;
  g.textAlign = "center"; g.textBaseline = "top";
  for (const v of o.xticks || []) {
    const x = X(v); g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + h); g.stroke();
    if (!o.noXLabels) g.fillText((o.xfmt || String)(v), Math.min(Math.max(x, x0 + 10), x0 + w - 10), y0 + h + 4);
  }
  g.textAlign = "right"; g.textBaseline = "middle";
  for (const v of o.yticks || []) {
    const y = Y(v); g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + w, y); g.stroke();
    g.fillText((o.yfmt || String)(v), x0 - 6, Math.min(Math.max(y, y0 + 8), y0 + h - 8));
  }
  g.strokeStyle = C.axis; g.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
  if (o.title) { g.textAlign = "left"; g.textBaseline = "bottom"; g.fillStyle = C.ink2; g.fillText(o.title, x0, y0 - 4); }
  g.restore();
  return { X, Y, box };
}

/** Standard margins for a plot inside a W x H canvas. */
export const boxIn = (W, top, height, left = 46, right = 12) => ({ x0: left, y0: top, w: W - left - right, h: height });

/** Render a spectrogram {M, K, data, t0, dt} to an offscreen canvas (one pixel per cell). */
export function specImage(spec, kMax = spec.K) {
  const { M, K, data } = spec, cv = document.createElement("canvas");
  cv.width = M; cv.height = kMax;
  const g = cv.getContext("2d"), img = g.createImageData(M, kMax), [lo, hi] = SPEC_RANGE;
  for (let m = 0; m < M; m++) for (let k = 0; k < kMax; k++) {
    const v = data[m * K + k], c = LUT[Math.max(0, Math.min(255, Math.round(((v - lo) / (hi - lo)) * 255)))], p = ((kMax - 1 - k) * M + m) * 4;
    img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return cv;
}

/** Heatmap image of a 0..1 matrix (M x K, row-major by frame), single hue ramp. */
export function maskImage(mask, M, K, rgb) {
  const cv = document.createElement("canvas");
  cv.width = M; cv.height = K;
  const g = cv.getContext("2d"), img = g.createImageData(M, K);
  for (let m = 0; m < M; m++) for (let k = 0; k < K; k++) {
    const v = Math.min(1, Math.max(0, mask[m * K + k])), p = ((K - 1 - k) * M + m) * 4;
    img.data[p] = 13 + v * (rgb[0] - 13); img.data[p + 1] = 18 + v * (rgb[1] - 18); img.data[p + 2] = 34 + v * (rgb[2] - 34); img.data[p + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return cv;
}

export function line(g, xs, ys, X, Y, color, width = 2, dash = null) {
  g.save(); g.strokeStyle = color; g.lineWidth = width; if (dash) g.setLineDash(dash);
  g.beginPath();
  let started = false;
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i]; if (!Number.isFinite(y)) { started = false; continue; }
    const px = X(xs[i]), py = Y(y);
    if (!started) { g.moveTo(px, py); started = true; } else g.lineTo(px, py);
  }
  g.stroke(); g.restore();
}
export function playhead(g, x, y0, h) {
  g.save(); g.strokeStyle = C.hi; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + h); g.stroke(); g.restore();
}
export function label(g, text, x, y, o = {}) {
  g.save(); g.font = o.mono ? MONO : FONT; g.fillStyle = o.color || C.ink; g.textAlign = o.align || "left"; g.textBaseline = o.base || "alphabetic";
  g.fillText(text, x, y); g.restore();
}
export function dot(g, x, y, r, color) { g.save(); g.fillStyle = color; g.strokeStyle = C.bg; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fill(); g.stroke(); g.restore(); }
export const fmtDb = (v) => (Number.isFinite(v) && v > -60 ? v.toFixed(1) : "—");
