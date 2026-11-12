// All facts on the site, with their sources. Status:
//   published: Fortell or a regulator says it about the product
//   patent:    a Fortell patent describes it; the product can differ
//   measured:  a third party measured it
//   inferred:  my deduction; the note says from what
// Full notes: spearfish/fortell/hardware-2026-11-11.md and software-2026-11-11.md (golden-path repo).

const pat = (n, topic) => ({ name: `Patent ${n} (${topic})`, url: `https://patents.google.com/patent/${n}/en` });

export const SRC = {
  ifu: { name: "FCC exhibit: user manual, 2025", url: "https://fccid.io/pdf.php?id=9549295" },
  fccTest: { name: "FCC exhibit: RF test report, 2025", url: "https://fccid.io/pdf.php?id=8725669" },
  fccPhotos: { name: "FCC exhibit: internal photos, 2025", url: "https://fccid.io/pdf.php?id=8725666" },
  ht: { name: "HearingTracker review, 2026", url: "https://www.hearingtracker.com/hearing-aids/fortell-ai-hearing-aids" },
  ai2: { name: "HearingTracker: AI 2.0, 2026", url: "https://www.hearingtracker.com/news/fortell-ai-2-0-next-level-speech-in-noise-performance-update-for-hearing-aids" },
  hhtm: { name: "This Week in Hearing, 2026", url: "https://hearinghealthmatters.org/?p=44500" },
  site: { name: "fortell.com/evidence", url: "https://www.fortell.com/evidence" },
  blog: { name: "Fortell blog: how AI hearing aids work", url: "https://www.fortell.com/blog/how-ai-hearing-aids-work" },
  ija1: { name: "Int. J. Audiology, Oct 2026", url: "https://doi.org/10.1080/14992027.2026.2741760" },
  ija2: { name: "Int. J. Audiology, May 2026", url: "https://doi.org/10.1080/14992027.2026.2663345" },
  jobs: { name: "Fortell job posts", url: "https://jobs.ashbyhq.com/fortell" },
  maude: { name: "FDA MAUDE reports", url: "https://api.fda.gov/device/event.json?search=device.manufacturer_d_name:fortell" },
  pChip: pat("US12423558B2", "AI chip"),
  pNN: pat("US11950056B2", "neural hearing aid"),
  pReset: pat("US20250080926A1", "frames"),
  pLat: pat("WO2026112188A1", "latency"),
  pLow: pat("US20250211927A1", "low latency"),
  pFocus: pat("US12470880B2", "spatial focus"),
  pBeam: pat("US20250124946A1", "beam + NR"),
  pMix: pat("US20250294300A1", "mix-back"),
  pWdrc: pat("WO2026064373A1", "NR then WDRC"),
  pFb: pat("US20260143286A1", "feedback"),
};

export const STATUS = {
  published: "Published",
  patent: "Patent",
  measured: "Measured",
  inferred: "Inferred",
};

// ---------- Hardware tab ----------
export const HARDWARE = [
  {
    title: "AI chip",
    facts: [
      { text: "16 tiles × 64 multiply-adds at 50 MHz ≈ 102 billion operations per second.", status: "patent", src: "pChip" },
      { text: "That matches the ad line “up to 100B operations per second”, so this is very likely the shipping chip.", status: "inferred", note: "same number", src: "pChip" },
      { text: "Up to 10 million 8-bit weights. 2–4 mW for the denoising network.", status: "patent", src: "pChip" },
      { text: "The network does the denoising. A separate 24-bit DSP does feedback, wind, beamforming, compression, and calibration.", status: "patent", src: "pNN" },
      { text: "Made by TSMC. A job post asks for “sub-7nm” design, likely for the next chip.", status: "published", src: "jobs" },
    ],
  },
  {
    title: "Microphones",
    facts: [
      { text: "2 microphones per aid, 4 in all.", status: "published", src: "ht" },
      { text: "Two MEMS mics about 4–6 mm apart. The patents give 5–12 mm.", status: "inferred", note: "ruler in FCC photos", src: "fccPhotos" },
      { text: "Noise floor: 29 dB SPL omni, 38 dB SPL directional.", status: "published", src: "ifu" },
      { text: "No accelerometer and no microphone inside the ear canal.", status: "published", src: "ifu" },
    ],
  },
  {
    title: "Speaker and domes",
    facts: [
      { text: "Receivers: Sonion Steel Series XM and XP.", status: "published", src: "ifu" },
      { text: "Max output 112–115 dB SPL. Max gain 55 dB. Range up to 6.2 or 7.0 kHz.", status: "published", src: "ifu" },
      { text: "Domes: open, closed, and power; 6 to 12 mm.", status: "published", src: "ifu" },
      { text: "Two FDA reports of domes left in ear canals.", status: "published", src: "maude" },
    ],
  },
  {
    title: "Radio",
    facts: [
      { text: "Bluetooth Low Energy only, 2.4 GHz, about 5.5 dBm.", status: "published", src: "fccTest" },
      { text: "No second radio, so the two aids do not share audio.", status: "inferred", note: "FCC radio list", src: "fccTest" },
      { text: "iPhone streaming and Auracast. No Android, no telecoil.", status: "published", src: "ht" },
    ],
  },
  {
    title: "Battery and body",
    facts: [
      { text: "A 10 × 5.4 mm lithium coin cell, about 50 mAh at 3.8 V.", status: "inferred", note: "label in FCC photo", src: "fccPhotos" },
      { text: "Ads say 24+ hours. The manual says 16 hours after a 3-hour charge.", status: "published", src: "ifu" },
      { text: "About 8 mW for the whole aid, so the AI chip uses a large share of it.", status: "inferred", note: "0.19 Wh over 24 h", src: "fccPhotos" },
      { text: "IP54. Volume buttons on the left aid, mode button on the right.", status: "published", src: "ifu" },
    ],
  },
];

// ---------- Pipeline tab ----------
export const PIPELINE = [
  { name: "Microphones", where: "2 per aid", job: "Pick up sound at the front and rear of each aid.", params: "sample rate not published · 32 kHz fits", status: "published", src: "ht" },
  { name: "Feedback cancel", where: "DSP", job: "Subtract the speaker sound that leaks back into the mics.", params: "adaptive leaky FIR, right after the ADC", status: "patent", src: "pFb" },
  { name: "Wind + calibration", where: "DSP", job: "Cut wind rumble. Match the two mics.", params: "24-bit", status: "patent", src: "pNN" },
  { name: "Beamformer", where: "DSP", job: "Point a beam to the front. Front Voices uses it to drop voices behind you.", params: "cardioid to hypercardioid · back nulled · sides −6 dB", status: "patent", src: "pBeam" },
  { name: "STFT", where: "AI chip", job: "Cut the sound into short frames of frequencies.", params: "128-sample frame · 64-sample step (4 ms / 2 ms)", status: "patent", src: "pLat" },
  { name: "Neural mask", where: "AI chip", job: "A recurrent network splits each frame into target speech, other speech, and noise.", params: "LSTM · ≤10M 8-bit weights · ~2 ms per run", status: "patent", src: "pFocus" },
  { name: "Mix back", where: "AI chip", job: "Add a little noise back, so the room still sounds real.", params: "speech + a·noise · a ≈ 0.1 at 60–80 dB SPL", status: "patent", src: "pMix" },
  { name: "Steady-noise mask", where: "DSP", job: "Remove hum and hiss that is left.", params: "minimum statistics", status: "patent", src: "pMix" },
  { name: "Gain + compression", where: "DSP", job: "Fit the sound to the hearing loss. Gain follows the level before denoising.", params: "attack 13 ms · release 470 ms · NAL-NL2 in tests", status: "published", src: "ifu" },
  { name: "Inverse STFT", where: "AI chip", job: "Rebuild the waveform. Calibrate the output.", params: "", status: "patent", src: "pNN" },
  { name: "Limiter", where: "DSP", job: "Keep the output below a safe maximum.", params: "112–115 dB SPL", status: "published", src: "ifu" },
  { name: "Receiver", where: "speaker", job: "Play the sound into the ear canal.", params: "Sonion Steel XM / XP", status: "published", src: "ifu" },
];
export const PIPELINE_NOTE = "Fortell says it puts “AI ahead of the traditional signal-processing chain”. Their patents give this order. A patent describes one way to build it; the product can differ.";
export const PIPELINE_NOTE_SRC = "blog";

export const LATENCY = [
  { part: "Two frame steps", ms: "4", src: "pLow" },
  { part: "One network run", ms: "~2", src: "pReset" },
  { part: "Converters, buffers", ms: "~1", src: null },
  { part: "Short path (normal)", ms: "4–10", src: "pLat", total: true },
  { part: "Long path (very noisy rooms)", ms: "10–16", src: "pLat", total: true },
];

// ---------- Numbers tab ----------
export const TILES = [
  { value: "99 / 100", label: "Trials where listeners picked Fortell", src: "ija2" },
  { value: "9.2 dB", label: "QuickSIN advantage over a control aid", src: "ija1" },
  { value: "+2.13 dB", label: "AI 2.0 over AI 1.0, average SNR", src: "ai2" },
  { value: "1.5 / 5", label: "Own-voice score: the one weak result", src: "ht" },
];
export const SERIES = { f: "Fortell", o: "Comparison" };
export const CHARTS = [
  {
    title: "SNR improvement in the lab",
    unit: " dB", max: 16,
    rows: [
      { label: "Study 1 (n=30)", bars: [{ s: "f", v: 15.5, who: "Fortell" }, { s: "o", v: 2.3, who: "Control aid" }] },
      { label: "Study 2 (n=20)", bars: [{ s: "f", v: 12.2, who: "Fortell" }, { s: "o", v: 5.9, who: "Best of 5 aids" }] },
    ],
    src: "ija1", src2: "ija2", note: "Both studies are blinded and run by the company. The control aids also use neural noise reduction.",
  },
  {
    title: "Words understood in noise",
    unit: "%", max: 100,
    rows: [
      { label: "At 0 dB SNR", bars: [{ s: "f", v: 80, who: "Fortell" }, { s: "o", v: 31, who: "Leading AI aid" }] },
      { label: "At −6 dB SNR", bars: [{ s: "f", v: 50, who: "Fortell" }, { s: "o", v: 7, who: "Leading AI aid" }] },
    ],
    src: "site", note: "0 dB SNR: the voice and the noise are equally loud.",
  },
  {
    title: "AI 2.0 SNR benefit, by mode",
    unit: " dB", max: 12, single: true,
    rows: [
      { label: "Noise · All Voices", bars: [{ s: "f", v: 10.6, who: "All Voices" }] },
      { label: "Noise · Front Voices", bars: [{ s: "f", v: 10.8, who: "Front Voices" }] },
      { label: "Talkers · All Voices", bars: [{ s: "f", v: 5.9, who: "All Voices" }] },
      { label: "Talkers · Front Voices", bars: [{ s: "f", v: 11.0, who: "Front Voices" }] },
    ],
    src: "ai2", note: "KEMAR manikin, 8 speakers in a ring. Direction adds ~5 dB only when other people talk.",
  },
  {
    title: "HearAdvisor lab scores",
    unit: "", max: 6,
    rows: [
      { label: "Speech in noise", bars: [{ s: "f", v: 6.0, who: "Fortell" }, { s: "o", v: 2.1, who: "Average aid" }] },
      { label: "Music", bars: [{ s: "f", v: 4.2, who: "Fortell" }, { s: "o", v: 2.6, who: "Average aid" }] },
      { label: "Own voice", bars: [{ s: "f", v: 1.5, who: "Fortell" }, { s: "o", v: 2.6, who: "Average aid" }] },
    ],
    src: "ht", note: "Tuned fit. The scale was 0–5 before Fortell scored above it.",
  },
];
