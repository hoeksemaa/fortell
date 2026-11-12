// Text and sources for the pipeline page. Status of each value:
//   published:   Fortell, a regulator, or a reviewer says it about the product
//   patent:      a Fortell patent describes it; the product can differ
//   inferred:    my choice or deduction; the text says why
//   placeholder: a stand-in for a part I cannot rebuild
// Full notes: spearfish/fortell/hardware-2026-11-11.md and software-2026-11-11.md (golden-path repo).

const pat = (n, topic) => ({ name: `Patent ${n} (${topic})`, url: `https://patents.google.com/patent/${n}/en` });

export const SRC = {
  ifu: { name: "FCC exhibit: user manual, 2025", url: "https://fccid.io/pdf.php?id=9549295" },
  ht: { name: "HearingTracker review, 2026", url: "https://www.hearingtracker.com/hearing-aids/fortell-ai-hearing-aids" },
  ai2: { name: "HearingTracker: AI 2.0, 2026", url: "https://www.hearingtracker.com/news/fortell-ai-2-0-next-level-speech-in-noise-performance-update-for-hearing-aids" },
  blog: { name: "Fortell blog: how AI hearing aids work", url: "https://www.fortell.com/blog/how-ai-hearing-aids-work" },
  pChip: pat("US12423558B2", "AI chip"),
  pNN: pat("US11950056B2", "neural hearing aid"),
  pReset: pat("US20250080926A1", "frames"),
  pLat: pat("WO2026112188A1", "latency"),
  pFocus: pat("US12470880B2", "spatial focus"),
  pBeam: pat("US20250124946A1", "beam + NR"),
  pMix: pat("US20250294300A1", "mix-back"),
  pWdrc: pat("WO2026064373A1", "NR then WDRC"),
  pFb: pat("US20260143286A1", "feedback"),
  nalr: { name: "Byrne & Dillon 1986 (NAL-R)", url: "https://doi.org/10.1097/00003446-198608000-00007" },
  asv: { name: "Voice clips: ASVspoof 2019 (ODC-By)", url: "https://datashare.ed.ac.uk/handle/10283/3336" },
};

export const STATUS = { published: "Published", patent: "Patent", inferred: "Inferred", placeholder: "Placeholder" };

export const PART_NAMES = { target: "Front talker", talker2: "Rear talker", noise: "Noise", wind: "Wind", clatter: "Clatter", leak: "Leak" };

/** The test scene (levels in dB SPL at the aid, over the whole clip unless a time is given). */
export const SCENE_ROWS = [
  { part: "target", what: "Low voice, straight ahead (0°), plus its reverb from 4 sides", spl: "65" },
  { part: "talker2", what: "High voice, behind (180°), plus its reverb", spl: "62" },
  { part: "noise", what: "Pink noise from 8 sides, plus 29 dB SPL mic self-noise", spl: "55" },
  { part: "wind", what: "Gust at the mic ports, 1.2–2.0 s", spl: "72" },
  { part: "clatter", what: "Three hits from the side (90°) at 2.7 s", spl: "85" },
  { part: "leak", what: "The aid's own output, back into the mics", spl: "—" },
];

/** The signal after each step (index = step number; 0 = the sound in the air). */
export const NODES = [
  { title: "Sound at the aid", domain: "Air pressure, no aid yet", unit: "spl" },
  { title: "Mic signals", domain: "2 mics, 16 kHz · front mic shown", unit: "spl" },
  { title: "After feedback cancel", domain: "2 mics · front mic shown", unit: "spl" },
  { title: "After wind + calibration", domain: "2 mics · front mic shown", unit: "spl" },
  { title: "Beam output", domain: "1 signal, 16 kHz", unit: "spl" },
  { title: "Frames", domain: "Grid: 2 ms × 250 Hz", unit: "spl" },
  { title: "Target stream", domain: "Grid: T · X", unit: "spl" },
  { title: "Mixed stream", domain: "Grid", unit: "spl" },
  { title: "After steady-noise mask", domain: "Grid", unit: "spl" },
  { title: "After gain", domain: "Grid · level before the receiver's shape", unit: "spl" },
  { title: "Waveform", domain: "1 signal, 16 kHz · before the receiver's shape", unit: "spl" },
  { title: "After limiter", domain: "1 signal, 16 kHz · before the receiver's shape", unit: "spl" },
  { title: "Sound in the ear canal", domain: "Air pressure at the eardrum", unit: "spl" },
];

export const STEPS = [
  null,
  {
    name: "Microphones", where: "Mics", status: "published",
    job: "Each mic hears every source, a little earlier or later by its direction. Wind, mic self-noise, and the aid's own output add to each mic.",
    fn: ["mic_m[n] = Σ_s s[n − τ_m(θ_s)] + wind_m + (h_m ∗ u)[n] + noise_m", "τ = ∓ (d / 2c) · cos θ    d = 10 mm, c = 343 m/s"],
    params: [
      { t: "2 mics per aid.", st: "published", src: "ht" },
      { t: "Mics 5–12 mm apart. I use 10 mm.", st: "patent", src: "pBeam" },
      { t: "Mic self-noise 29 dB SPL.", st: "published", src: "ifu" },
      { t: "Rear mic reads 1.5 dB hot; feedback path peaks at −30 dB near 3.2 kHz; aid output u = front mic + 25 dB, 6 ms later. Test values.", st: "inferred" },
      { t: "Room: each talker also arrives as reverb from 4 sides (0.4 s decay, 3 dB below the direct sound). Test values.", st: "inferred" },
      { t: "Sample rate 16 kHz. Fortell does not publish it. 128-sample frames of 4 ms give 32 kHz; I halve it so the page runs fast.", st: "inferred", src: "pLat" },
    ],
  },
  {
    name: "Feedback cancel", where: "DSP", status: "patent", bypass: true,
    job: "Subtract a copy of the leak. The copy is the aid output u through ĥ, the canceller's model of the path from speaker to mic.",
    fn: ["y_m[n] = mic_m[n] − (ĥ_m ∗ u)[n]", "fit:  ĥ ← ĥ + μ · e[n] · u[n] / ‖u‖²,   e = mic − ĥ ∗ u"],
    params: [
      { t: "Adaptive, normalized, leaky FIR, subtracted right after the converter.", st: "patent", src: "pFb" },
      { t: "32 taps (2 ms), μ = 0.02. ĥ learns from 1 s of probe noise at fitting, then holds. The patent keeps adapting in use. On 3.5 s of speech that gives a bad ĥ, because u is a delayed copy of the input.", st: "inferred" },
    ],
  },
  {
    name: "Wind + calibration", where: "DSP", status: "patent", bypass: true,
    job: "Match the rear mic to the front mic. Sound from a talker is the same at both mics; wind is not. When the mics stop agreeing below 300 Hz, cut that band.",
    fn: ["rear ← rear · 10^(−1.5/20)", "y = HP₃₀₀(x) + g(t) · LP₃₀₀(x)", "g = −20 dB if ρ < 0.6 and level > 50 dB SPL, else 0 dB", "ρ = Σ front·rear / √(Σ front² · Σ rear²)  below 300 Hz, over 30 ms"],
    params: [
      { t: "Wind reduction and mic calibration run in the DSP, before the beamformer.", st: "patent", src: "pNN" },
      { t: "Coherence detector, 4th-order Linkwitz-Riley split at 300 Hz (low + high is flat), −20 dB cut.", st: "inferred" },
    ],
  },
  {
    name: "Beamformer", where: "DSP", status: "patent", bypass: true, mode: true,
    job: "Front Voices: subtract the rear mic, delayed by the travel time between the mics. Sound from behind cancels. An EQ makes the front response flat. All Voices: use the front mic alone.",
    fn: ["y[n] = B · (front[n] − rear[n − τ₀]) + A · y[n − 1]", "τ₀ = d / c = 29 µs    B = 1 / (2 τ₀ f_s)", "A: 2B² / (1 − A²) = 10^(9/10)  →  EQ corner 435 Hz"],
    params: [
      { t: "Cardioid to hypercardioid. Back nulled, sides about −6 dB.", st: "patent", src: "pBeam" },
      { t: "Mic noise floor 29 dB SPL omni, 38 directional: the beam adds 9 dB of mic noise. I set A to match.", st: "published", src: "ifu" },
      { t: "All Voices uses no beam. Direction helps only when other people talk.", st: "inferred", src: "ai2" },
      { t: "The beam nulls the rear talker's direct sound, but its reverb comes from all sides. Here the beam gains about 6 dB on the rear talker. Fortell's AI 2.0 test: Front Voices beat All Voices by about 5 dB with talkers around.", st: "inferred", src: "ai2" },
      { t: "The front talker drops too: the EQ does not fully lift the lows below 435 Hz, and the beam also cuts that talker's reverb.", st: "inferred" },
      { t: "Wind is different at each mic, so the beam cannot cancel it, and the EQ raises it below 435 Hz.", st: "inferred" },
    ],
  },
  {
    name: "STFT", where: "AI chip", status: "patent",
    job: "Cut the beam output into 4 ms frames, one every 2 ms. Each frame becomes 33 frequency bins, 250 Hz apart.",
    fn: ["X[m, k] = Σ_n w[n] · x[n + mH] · e^(−j2πkn / N)", "N = 64 (4 ms)   H = 32 (2 ms)   w = √Hann"],
    params: [
      { t: "4 ms window, 2 ms step. Example: 128-sample frame, 64-sample step.", st: "patent", src: "pLat" },
      { t: "64 samples at 16 kHz is the same 4 ms.", st: "inferred" },
    ],
  },
  {
    name: "Neural mask", where: "AI chip", status: "placeholder", maskSelect: true,
    job: "Fortell's network gives each bin three weights: target speech T, other speech I, and noise N. I do not have the network.",
    fn: ["T + I + N = 1    target stream = T · X", "placeholder:  T = |X_target|² / Σ_p |X_p|²"],
    params: [
      { t: "Masks for target speech, interfering speech, and noise.", st: "patent", src: "pFocus" },
      { t: "Recurrent network, up to 10M 8-bit weights, about 2 ms per run.", st: "patent", src: "pChip" },
      { t: "Placeholder: the ideal ratio mask. It reads the true parts, which a real aid never has, so it beats any network.", st: "placeholder" },
      { t: "Classic: no network. T = max(0, 1 − 1.5 · N̂ / P), N̂ from minimum statistics (as in step 8). I = 0.", st: "inferred" },
    ],
  },
  {
    name: "Mix back", where: "AI chip", status: "patent", bypass: true, mode: true,
    job: "Add back some noise, so the room still sounds real. The amount follows the noise level, not the SNR, so it does not pump.",
    fn: ["Y = T·X + b · I·X + a(L) · N·X", "b = 0 Front Voices, 1 All Voices    a = 0.1 at 60–80 dB SPL"],
    params: [
      { t: "a ≈ 0.1 at 60–80 dB SPL, higher outside (U-shaped). Uses level, not SNR, to avoid pumping.", st: "patent", src: "pMix" },
      { t: "a = 0.3 at 40 and 100 dB SPL. L = level of N·X, smoothed over 100 ms.", st: "inferred" },
    ],
  },
  {
    name: "Steady-noise mask", where: "DSP", status: "patent", bypass: true,
    job: "Remove hum and hiss that is left. The lowest power in each bin over the last 0.8 s is the noise floor.",
    fn: ["G[m, k] = max(10^(−12/20), 1 − 1.5 · N̂[m, k] / P[m, k])", "N̂ = min of P over 0.8 s    P = |Y|² smoothed, α = 0.9"],
    params: [
      { t: "A minimum-statistics mask after the mix back.", st: "patent", src: "pMix" },
      { t: "0.8 s window, ×1.5 bias, −12 dB floor.", st: "inferred" },
    ],
  },
  {
    name: "Gain + compression", where: "DSP", status: "published", bypass: true,
    job: "Fit the sound to the hearing loss, in 8 bands. The gain follows the level before denoising (step 5) and goes on the denoised sound.",
    fn: ["G_b = NAL-R(f_b) − R(f_b) + (1 − 1/CR) · (55 − max(L_b, 45))", "L_b = band level of step 5, attack 13 ms, release 470 ms", "CR = 2    0 ≤ G_b ≤ 55 dB    R = receiver response (step 12)"],
    params: [
      { t: "Attack 13 ms, release 470 ms, max gain 55 dB.", st: "published", src: "ifu" },
      { t: "Gain from the input level, applied to the enhanced sound.", st: "patent", src: "pWdrc" },
      { t: "8 channels.", st: "published", src: "ht" },
      { t: "Test loss: 35 dB HL at 250 Hz, sloping to 65 dB HL at 6 kHz. NAL-R prescription, ratio 2, knee 45 dB SPL.", st: "inferred", src: "nalr" },
    ],
  },
  {
    name: "Inverse STFT", where: "AI chip", status: "patent",
    job: "Turn the frames back into a waveform. Each frame goes through the window again and overlaps the next by half.",
    fn: ["y[n] = Σ_m w[n − mH] · IFFT(Y[m])[n − mH]", "Σ_m w²[n − mH] = 1, so iSTFT(STFT(x)) = x"],
    params: [
      { t: "Output calibration, then the inverse STFT.", st: "patent", src: "pNN" },
      { t: "A part's level can still change here. Gains that jump from frame to frame make a grid that no waveform matches exactly; the overlap-add smooths each jump.", st: "inferred" },
    ],
  },
  {
    name: "Limiter", where: "DSP", status: "published", bypass: true,
    job: "Keep the sound at the eardrum under the aid's maximum output. Look 1 ms ahead, turn down fast, come back up over 50 ms.",
    fn: ["y[n] = g[n] · x[n]", "g[n] = min(1, p_max / max |R ∗ x| over [n, n + 1 ms]), then a 50 ms release", "p_max = √2 · 20 µPa · 10^(112/20) = 11.2 Pa"],
    params: [
      { t: "Max output (OSPL90) 112–115 dB SPL.", st: "published", src: "ifu" },
      { t: "1 ms look-ahead, 50 ms release. The detector uses the receiver model, so the limit holds at the eardrum.", st: "inferred" },
    ],
  },
  {
    name: "Receiver", where: "Speaker", status: "published",
    job: "The receiver turns the signal into sound in the ear canal. Its response is not flat; step 9 already took its shape out of the gain.",
    fn: ["p_ear = R ∗ y   (Pa)", "R: high-pass 200 Hz, +8 dB at 2.7 kHz, low-pass 6.2 kHz"],
    params: [
      { t: "Sonion Steel Series XM and XP. Range up to 6.2 or 7.0 kHz.", st: "published", src: "ifu" },
      { t: "Response shape: a typical balanced-armature receiver.", st: "inferred" },
    ],
  },
];

export const INTRO = "A test scene goes through 12 steps. Each step is a function, out = f(in). Change a step and every later step changes.";
export const ORDER_NOTE = "Fortell says it puts “AI ahead of the traditional signal-processing chain”. The step order comes from their patents. A patent shows one way to build it; the product can differ.";
