// Glitch — seeded band tearing + RGB channel split.
// Ported verbatim from wobbletonefx buildGlitchBands / applyGlitchPixelData.
//
// Resolution model: band heights are fractions of the render height, so they
// scale automatically. params.split is px-flagged (arrives already scaled to
// render px). The *derived* displacement (amount × 100 × profile.displacement)
// has no param of its own, so it is scaled by ctx.renderScale at apply time —
// the one case px-flags cannot cover.

import { seededRandom } from "../rng.js";
import { clamp } from "../color.js";

export const GLITCH_PROFILES = {
  "ccd-failure": { displacement: 0.58, active: 0.46, exposure: 0.22, split: 0.8, frequencyX: 0.006, octaves: 1, noise: "turbulence" },
  "vhs-tear": { displacement: 0.38, active: 0.72, exposure: 0.08, split: 0.55, frequencyX: 0.003, octaves: 2, noise: "fractalNoise" },
  "rgb-fracture": { displacement: 0.14, active: 0.3, exposure: 0, split: 1.7, frequencyX: 0.012, octaves: 1, noise: "turbulence" },
  "signal-loss": { displacement: 0.68, active: 0.56, exposure: 0.42, split: 0.45, frequencyX: 0.004, octaves: 1, noise: "turbulence" },
};

export function glitchSettings(params, renderScale = 1) {
  const style = String(params.style || "CCD Failure").toLowerCase().replace(/\s+/g, "-");
  const profile = GLITCH_PROFILES[style] || GLITCH_PROFILES["ccd-failure"];
  const amount = clamp(Number(params.amount) || 0, 0, 100) / 100;
  const bandSize = clamp(Number(params.bandSize) || 0, 1, 100) / 100;
  const split = Math.max(0, Number(params.split) || 0) * profile.split * amount;
  const displacement = amount * 100 * profile.displacement * renderScale;
  const frequencyY = 0.015 + (1 - bandSize) * 0.1;
  return { style, profile, amount, bandSize, split, displacement, frequencyY, seed: Math.round(clamp(Number(params.seed) || 1, 1, 9999)) };
}

export function buildGlitchBands(params, width, height, renderScale = 1) {
  const settings = glitchSettings(params, renderScale);
  const styleSeed = [...settings.style].reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619), settings.seed);
  const random = seededRandom(styleSeed);
  const targetBands = 4 + (1 - settings.bandSize) * 36;
  const averageHeight = Math.max(1, Math.round(height / targetBands));
  const bands = [];
  for (let y = 0; y < height;) {
    const bandHeight = Math.min(height - y, Math.max(1, Math.round(averageHeight * (0.55 + random() * 1.1))));
    const active = settings.amount > 0 && random() < settings.profile.active * (0.35 + settings.amount * 0.65);
    const dx = active ? Math.round((random() * 2 - 1) * settings.displacement) : 0;
    const dy = active ? Math.round((random() * 2 - 1) * settings.displacement * 0.06) : 0;
    const exposure = active ? 1 - random() * settings.profile.exposure * settings.amount : 1;
    bands.push({ y, height: bandHeight, dx, dy, exposure });
    y += bandHeight;
  }
  return { bands, split: Math.round(settings.split) };
}

export function glitch(buffer, params, ctx = {}) {
  const renderScale = ctx.renderScale || 1;
  const { width, height, data } = buffer;
  const source = new Uint8ClampedArray(data);
  const { bands, split } = buildGlitchBands(params, width, height, renderScale);
  for (const band of bands) {
    const endY = band.y + band.height;
    for (let y = band.y; y < endY; y++) {
      const sourceY = clamp(y - band.dy, 0, height - 1);
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        const sourceX = clamp(x - band.dx, 0, width - 1);
        const redIndex = (sourceY * width + clamp(sourceX - split, 0, width - 1)) * 4;
        const greenIndex = (sourceY * width + sourceX) * 4;
        const blueIndex = (sourceY * width + clamp(sourceX + split, 0, width - 1)) * 4;
        data[index] = clamp(Math.round(source[redIndex] * band.exposure), 0, 255);
        data[index + 1] = clamp(Math.round(source[greenIndex + 1] * band.exposure), 0, 255);
        data[index + 2] = clamp(Math.round(source[blueIndex + 2] * band.exposure), 0, 255);
        data[index + 3] = source[index + 3];
      }
    }
  }
  return buffer;
}
