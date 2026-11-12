// Text and sources for the pipeline page.
// Each step: one equation (TeX, drawn by KaTeX), a short plain explanation, and one source.
// Full notes: spearfish/fortell/hardware-2026-11-11.md and software-2026-11-11.md (golden-path repo).

const pat = (n) => ({ name: `Fortell patent ${n}`, url: `https://patents.google.com/patent/${n}/en` });

export const SRC = {
  ifu: { name: "Fortell user manual (FCC)", url: "https://fccid.io/pdf.php?id=9549295" },
  ht: { name: "HearingTracker review", url: "https://www.hearingtracker.com/hearing-aids/fortell-ai-hearing-aids" },
  blog: { name: "Fortell blog", url: "https://www.fortell.com/blog/how-ai-hearing-aids-work" },
  pNN: pat("US11950056B2"),
  pLat: pat("WO2026112188A1"),
  pFocus: pat("US12470880B2"),
  pBeam: pat("US20250124946A1"),
  pMix: pat("US20250294300A1"),
  pWdrc: pat("WO2026064373A1"),
  pFb: pat("US20260143286A1"),
  asv: { name: "Voice clips: ASVspoof 2019 (ODC-By)", url: "https://datashare.ed.ac.uk/handle/10283/3336" },
};

/** The signal after each step (index = step number; 0 = the sound in the air). */
export const NODES = [
  "Sound at the aid",
  "Front mic",
  "After feedback cancel",
  "After wind cut",
  "Beam output",
  "Grid (time × frequency)",
  "Front talker only",
  "With a little noise back",
  "After hum removal",
  "After gain",
  "Back to a sound wave",
  "After limiter",
  "Sound in the ear canal",
];

export const STEPS = [
  null,
  {
    name: "Microphones", src: "ht",
    tex: String.raw`x_m(t) = \sum_{s} s\big(t - \tau_{m,s}\big) + w_m(t) + \ell_m(t)`,
    text: "Each aid has a front mic and a rear mic, about 1 cm apart. Every sound reaches both mics, a tiny bit earlier at the mic that faces it. Wind (w) and the aid's own speaker sound (ℓ, the leak) also get into the mics.",
  },
  {
    name: "Feedback cancel", src: "pFb", bypass: true,
    tex: String.raw`y(t) = x(t) - \big(\hat h * u\big)(t)`,
    text: "Some of the aid's own output u leaks out of the ear and back into the mics. If nothing stops it, the aid whistles. The aid keeps a model ĥ of that leak path, predicts the leak, and subtracts it.",
  },
  {
    name: "Wind + calibration", src: "pNN", bypass: true,
    tex: String.raw`y(t) = \mathrm{high}(x) + g(t)\,\mathrm{low}(x)`,
    text: "First the step matches the two mics, so they read the same level. Then it watches the low frequencies. A voice looks the same at both mics, but wind is random at each one. When the mics stop agreeing, the gain g on the lows goes down.",
  },
  {
    name: "Beamformer", src: "pBeam", bypass: true,
    tex: String.raw`y(t) = \mathrm{EQ}\Big[\,x_{\text{front}}(t) - x_{\text{rear}}(t - \tau_0)\Big]`,
    text: "Sound from behind reaches the rear mic first and the front mic τ₀ later. Delay the rear mic by τ₀ and subtract it, and sound from behind cancels. Sound from the front does not. Echoes of the rear talker come from all sides, so they do not cancel fully.",
    note: "All Voices mode skips the beam and uses the front mic alone.",
  },
  {
    name: "STFT", src: "pLat",
    tex: String.raw`X[m,k] = \sum_{n} w[n]\; x[n + mH]\; e^{-j 2\pi k n / N}`,
    text: "The step cuts the sound into short overlapping slices, 4 ms long, and splits each slice into frequencies. The result is a grid: each cell says how much of one frequency there is at one moment. Steps 6–9 work on this grid.",
  },
  {
    name: "Neural mask", src: "pFocus", maskSelect: true,
    tex: String.raw`\hat S = T \cdot X, \qquad T + I + N = 1`,
    text: "Fortell's network looks at each grid cell and decides how much of it is the front talker (T), another talker (I), or noise (N). Keeping only T gives the front talker alone.",
    placeholder: "I do not have Fortell's network. This placeholder uses the true answer, which a real aid never has, so it is better than any real network.",
    note: "Classic: a simple noise estimate, no network. Off: keep everything.",
  },
  {
    name: "Mix back", src: "pMix", bypass: true,
    tex: String.raw`Y = T X + b\, I X + a(L)\, N X`,
    text: "Total silence around a voice sounds strange, so the step adds back a little noise (a). It adds back more when the room is very quiet or very loud. In All Voices mode it also keeps the other talker (b = 1).",
  },
  {
    name: "Steady-noise mask", src: "pMix", bypass: true,
    tex: String.raw`G = \max\!\Big(G_{\min},\; 1 - \frac{\hat N}{P}\Big)`,
    text: "Some steady hum is still left. For each frequency, the quietest level over the last second is the hum (N̂). Cells near that level get turned down; cells well above it, like speech, stay.",
  },
  {
    name: "Gain + compression", src: "pWdrc", bypass: true,
    tex: String.raw`G_b = G_{\text{fit}}(f_b) - \Big(1 - \tfrac{1}{CR}\Big)\big(L_b - L_{\text{ref}}\big)`,
    text: "This step makes the sound loud enough for the hearing loss, with more gain at high frequencies, where the loss is worse. Soft sounds get more gain and loud sounds get less, so speech is clear and nothing hurts. The gain follows the level before noise removal, but goes on the clean sound.",
  },
  {
    name: "Inverse STFT", src: "pNN",
    tex: String.raw`y[n] = \sum_{m} w[n - mH]\; \mathrm{IFFT}\{Y_m\}[n - mH]`,
    text: "The step turns the grid back into one sound wave. Each slice becomes a short piece of wave, and the pieces overlap and add. The windows add up to exactly 1, so a grid that nobody changed gives back the original sound.",
  },
  {
    name: "Limiter", src: "ifu", bypass: true,
    tex: String.raw`y(t) = g(t)\, x(t), \qquad |r * y| \le p_{\max}`,
    text: "The step stops sudden loud sounds, like the dish clatter, from going over the aid's maximum output. It turns the sound down fast, just before a peak, and lets it back up slowly.",
  },
  {
    name: "Receiver", src: "ifu",
    tex: String.raw`p_{\text{ear}}(t) = (r * y)(t)`,
    text: "The tiny speaker turns the signal into sound in the ear canal. It is not flat: it boosts the upper middle and drops the very top. Step 9 already planned for this shape.",
  },
];

export const INTRO = "A short scene goes through the 12 steps of Fortell's hearing aid. Each step is a function: it takes the signal from above and gives a new one. Change a step and every later step changes.";
export const SCENE = "The scene, 3.5 s: one person talks in front of you and another talks behind you. The room hums, wind gusts in the middle, and dishes clatter near the end.";
export const ORDER_NOTE = "The step order comes from Fortell's patents. The details inside each step are my best guess.";
