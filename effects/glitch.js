// Glitch — seeded band tearing + RGB channel split + per-band corruption.
// Ported from wobbletonefx buildGlitchBands / applyGlitchPixelData, then
// extended with the CCD-pin failure modes:
//   horizontal clock  → per-scanline dx jitter + row-repeat sync slips
//   transfer gate     → per-band hue shift
//   anti-bloom drain  → per-band desaturation or a dead channel
//   reset gate        → per-band posterize banding
//   output drain      → per-band channel split (was a single global offset)
//
// Resolution model: band heights are fractions of the render height, so they
// scale automatically. params.split is px-flagged (arrives already scaled to
// render px). The *derived* displacement (amount × 100 × profile.displacement)
// has no param of its own, so it is scaled by ctx.renderScale at apply time —
// the one case px-flags cannot cover. Per-band jitter derives from the same
// scaled displacement, so it inherits correct scaling.

import { seededRandom } from "../rng.js";
import { clamp, rgbToHsl, hslToRgb } from "../color.js";
import { posterizeByte } from "./tone.js";

// corruptMix = pick weights for [hueShift, desat, killChannel, posterize].
export const GLITCH_PROFILES = {
  "ccd-failure": { displacement: 0.65, active: 0.55, exposure: 0.3, split: 0.8, frequencyX: 0.006, octaves: 1, noise: "turbulence", jitter: 0.25, repeat: 0.08, corruptMix: [0.3, 0.2, 0.15, 0.35] },
  "vhs-tear": { displacement: 0.45, active: 0.75, exposure: 0.12, split: 0.55, frequencyX: 0.003, octaves: 2, noise: "fractalNoise", jitter: 0.9, repeat: 0.4, corruptMix: [0.3, 0.4, 0.05, 0.25] },
  "rgb-fracture": { displacement: 0.2, active: 0.4, exposure: 0, split: 2.2, frequencyX: 0.012, octaves: 1, noise: "turbulence", jitter: 0.15, repeat: 0.05, corruptMix: [0.5, 0.1, 0.3, 0.1] },
  "signal-loss": { displacement: 0.75, active: 0.6, exposure: 0.5, split: 0.45, frequencyX: 0.004, octaves: 1, noise: "turbulence", jitter: 0.5, repeat: 0.2, corruptMix: [0.1, 0.45, 0.4, 0.05] },
};

const CORRUPT_MODES = ["hue", "desat", "kill", "posterize"];

export function glitchSettings(params, renderScale = 1) {
  const style = String(params.style || "CCD Failure").toLowerCase().replace(/\s+/g, "-");
  const profile = GLITCH_PROFILES[style] || GLITCH_PROFILES["ccd-failure"];
  const amount = clamp(Number(params.amount) || 0, 0, 100) / 100;
  const bandSize = clamp(Number(params.bandSize) || 0, 1, 100) / 100;
  const split = Math.max(0, Number(params.split) || 0) * profile.split * amount;
  const corrupt = clamp(Number(params.corrupt) || 0, 0, 100) / 100;
  const displacement = amount * 100 * profile.displacement * renderScale;
  const frequencyY = 0.015 + (1 - bandSize) * 0.1;
  return { style, profile, amount, bandSize, split, corrupt, displacement, frequencyY, seed: Math.round(clamp(Number(params.seed) || 1, 1, 9999)) };
}

export function buildGlitchBands(params, width, height, renderScale = 1) {
  const settings = glitchSettings(params, renderScale);
  const styleSeed = [...settings.style].reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619), settings.seed);
  const random = seededRandom(styleSeed);
  const targetBands = 4 + (1 - settings.bandSize) * 36;
  const averageHeight = Math.max(1, Math.round(height / targetBands));
  const baseSplit = Math.round(settings.split);
  const bands = [];
  for (let y = 0; y < height;) {
    const bandHeight = Math.min(height - y, Math.max(1, Math.round(averageHeight * (0.55 + random() * 1.1))));
    const active = settings.amount > 0 && random() < settings.profile.active * (0.35 + settings.amount * 0.65);
    const dx = active ? Math.round((random() * 2 - 1) * settings.displacement) : 0;
    const dy = active ? Math.round((random() * 2 - 1) * settings.displacement * 0.06) : 0;
    const exposure = active ? 1 - random() * settings.profile.exposure * settings.amount : 1;
    const jitter = active ? Math.round(settings.displacement * settings.profile.jitter) : 0;
    const repeat = active && random() < settings.profile.repeat * settings.amount;
    // Per-band split replaces the global offset inside active bands; a small
    // chance of sign flip swaps the ghost direction.
    const split = active && baseSplit > 0
      ? Math.max(1, Math.round(baseSplit * (0.3 + random() * 1.4))) * (random() < 0.12 ? -1 : 1)
      : null;
    let corrupt = null;
    if (active && settings.corrupt > 0 && random() < settings.corrupt) {
      const mix = settings.profile.corruptMix;
      let pick = random();
      let mode = CORRUPT_MODES.length - 1;
      for (let m = 0; m < mix.length; m++) {
        if (pick < mix[m]) { mode = m; break; }
        pick -= mix[m];
      }
      const severity = (0.4 + random() * 0.6) * settings.corrupt;
      const arg = mode === 0 ? (random() * 2 - 1) * 180
        : mode === 2 ? Math.floor(random() * 3)
        : mode === 3 ? 2 + Math.floor(random() * 3)
        : 0;
      corrupt = { mode: CORRUPT_MODES[mode], severity, arg };
    }
    bands.push({ y, height: bandHeight, dx, dy, exposure, jitter, repeat, split, corrupt });
    y += bandHeight;
  }
  return { bands, split: baseSplit, rowSeed: styleSeed ^ 0x51f3 };
}

// Per-band colour destruction, applied after the split-sampled rgb.
function applyCorrupt(band, rgb) {
  const { mode, severity, arg } = band.corrupt;
  if (mode === "hue") {
    const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    if (s > 0) {
      const shifted = hslToRgb((h + arg + 360) % 360, s, l);
      rgb[0] = shifted[0]; rgb[1] = shifted[1]; rgb[2] = shifted[2];
    }
  } else if (mode === "desat") {
    const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    rgb[0] += (lum - rgb[0]) * severity;
    rgb[1] += (lum - rgb[1]) * severity;
    rgb[2] += (lum - rgb[2]) * severity;
  } else if (mode === "kill") {
    rgb[arg] *= 1 - severity;
  } else {
    rgb[0] += (posterizeByte(rgb[0], arg) - rgb[0]) * severity;
    rgb[1] += (posterizeByte(rgb[1], arg) - rgb[1]) * severity;
    rgb[2] += (posterizeByte(rgb[2], arg) - rgb[2]) * severity;
  }
}

export function glitch(buffer, params, ctx = {}) {
  const renderScale = ctx.renderScale || 1;
  const { width, height, data } = buffer;
  const source = new Uint8ClampedArray(data);
  const { bands, split, rowSeed } = buildGlitchBands(params, width, height, renderScale);
  const rgb = [0, 0, 0];
  for (const band of bands) {
    const endY = band.y + band.height;
    const bandSplit = band.split ?? split;
    const rowStep = band.repeat ? 2 : 1;
    for (let y = band.y; y < endY; y++) {
      const sourceY = clamp(band.y + Math.floor((y - band.y) / rowStep) - band.dy, 0, height - 1);
      const rowDx = band.dx + (band.jitter
        ? Math.round((seededRandom((rowSeed + Math.imul(y, 2654435761)) | 0)() * 2 - 1) * band.jitter)
        : 0);
      const row = sourceY * width;
      const out = y * width;
      for (let x = 0; x < width; x++) {
        const index = (out + x) * 4;
        const sourceX = clamp(x - rowDx, 0, width - 1);
        const redIndex = (row + clamp(sourceX - bandSplit, 0, width - 1)) * 4;
        const centreIndex = (row + sourceX) * 4;
        const blueIndex = (row + clamp(sourceX + bandSplit, 0, width - 1)) * 4;
        rgb[0] = source[redIndex];
        rgb[1] = source[centreIndex + 1];
        rgb[2] = source[blueIndex + 2];
        if (band.corrupt) applyCorrupt(band, rgb);
        data[index] = clamp(Math.round(rgb[0] * band.exposure), 0, 255);
        data[index + 1] = clamp(Math.round(rgb[1] * band.exposure), 0, 255);
        data[index + 2] = clamp(Math.round(rgb[2] * band.exposure), 0, 255);
        data[index + 3] = source[index + 3];
      }
    }
  }
  return buffer;
}
