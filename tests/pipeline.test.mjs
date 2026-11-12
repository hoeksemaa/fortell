// Run: node tests/pipeline.test.mjs
// Checks the pipeline math: parts sum to the mix, STFT round trip, levels, and that a step-6 change reaches step 12.
import { readFileSync } from "node:fs";
import { parseWav, toSpl, meanSquare } from "../web/dsp/core.js";
import { buildScene, run, PARTS, stft, istft, ledger, airSignal } from "../web/dsp/pipeline.js";

const wav = (f) => { const b = readFileSync(new URL(`../web/clips/${f}`, import.meta.url)); return parseWav(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).data; };
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) fails++; };

let t = performance.now();
const scene = buildScene(wav("low.wav"), wav("high.wav"));
console.log(`scene ${(performance.now() - t).toFixed(0)} ms`);
const settings = { mode: "front", mask: "oracle", bypass: {} };
t = performance.now();
const res = run(scene, settings);
console.log(`full run ${(performance.now() - t).toFixed(0)} ms`);
const times = [];
for (let k = 1; k <= 12; k++) {
  const L = res[k].ledger;
  console.log(`step ${String(k).padStart(2)}  mix ${L.mix.toFixed(1)}  ` + PARTS.map((p) => `${p} ${L[p].toFixed(1)}`).join("  ") + `  snr ${L.snr.toFixed(1)}`);
}
// 1. STFT round trip
const x = scene.target.direct, X = stft(x), y = istft(X, X.M, x.length);
let e = 0; for (let i = 0; i < x.length; i++) e += (y[i] - x[i]) ** 2;
ok(10 * Math.log10(e / x.reduce((s, v) => s + v * v, 0)) < -100, "inverse STFT rebuilds the input (error < -100 dB)");
// 2. parts sum to mix at step 12
const m = res[12].out.mix[0]; let d = 0;
for (let i = 0; i < m.length; i++) { let s = 0; for (const p of PARTS) s += res[12].out.parts[p][0][i]; d = Math.max(d, Math.abs(s - m[i])); }
ok(d < 1e-5, `parts sum to the mix at step 12 (max diff ${d.toExponential(1)})`);
// 3. scene levels
const air = ledger(airSignal(scene));
ok(Math.abs(air.target - 65) < 0.3 && Math.abs(air.talker2 - 62) < 0.3, `talkers at the aid: ${air.target.toFixed(1)} and ${air.talker2.toFixed(1)} dB SPL (want 65, 62)`);
// 4. feedback canceller lowers the leak
ok(res[2].ledger.leak < res[1].ledger.leak - 10, `feedback cancel cuts the leak by >10 dB (${(res[1].ledger.leak - res[2].ledger.leak).toFixed(1)} dB)`);
// 5. beamformer lowers the rear talker relative to the target
const rel = (k) => res[k].ledger.target - res[k].ledger.talker2;
ok(rel(4) - rel(3) > 4 && rel(4) - rel(3) < 9, `beam gains 4–9 dB on the rear talker, as reverb limits it (${(rel(4) - rel(3)).toFixed(1)} dB; Fortell AI 2.0 test: ~5 dB)`);
// 6. limiter: no 2 ms block above MPO+1
const lim = res[11].aux.after; ok(Math.max(...lim) < 113.5, `limiter keeps blocks under ~112 dB SPL (max ${Math.max(...lim).toFixed(1)})`);
// 7. change step 6 → step 12 changes; timing of rerun from 6
const before = res[12].ledger.snr;
t = performance.now();
run(scene, { ...settings, mask: "classic" }, res, 6);
const dt = performance.now() - t;
console.log(`rerun from step 6: ${dt.toFixed(0)} ms`);
ok(Math.abs(res[12].ledger.snr - before) > 1, `step-6 change reaches step 12 (snr ${before.toFixed(1)} → ${res[12].ledger.snr.toFixed(1)})`);
for (let k = 6; k <= 12; k++) console.log(`  step ${k} snr ${res[k].ledger.snr.toFixed(1)} mix ${res[k].ledger.mix.toFixed(1)}`);
t = performance.now();
run(scene, { ...settings, mask: "off" }, res, 6);
console.log(`rerun from step 6 (off): ${(performance.now() - t).toFixed(0)} ms; snr12 ${res[12].ledger.snr.toFixed(1)}`);
t = performance.now();
run(scene, { ...settings, mode: "all" }, res, 4);
console.log(`rerun from step 4 (all voices): ${(performance.now() - t).toFixed(0)} ms; snr12 ${res[12].ledger.snr.toFixed(1)}`);
process.exit(fails ? 1 : 0);
