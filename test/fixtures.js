// Shared procedural fixtures + golden case table.
// Used by test/golden.test.js (hash assertions) and scripts/dump-golden.mjs
// (PNG eyeballing). Deterministic — no Math.random, no Date.

import { makeBuffer } from "../buffer.js";
import { seededRandom } from "../rng.js";

export const FIXTURE_W = 48;
export const FIXTURE_H = 32;

// Smooth multi-channel ramp — exercises interpolation paths.
export function gradient(w = FIXTURE_W, h = FIXTURE_H) {
  const b = makeBuffer(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      b.data[i] = Math.round((x / (w - 1)) * 255);
      b.data[i + 1] = Math.round((y / (h - 1)) * 255);
      b.data[i + 2] = 160;
      b.data[i + 3] = 255;
    }
  }
  return b;
}

// Hard-edged 6px checkerboard — exercises neighbourhood effects.
export function checker(w = FIXTURE_W, h = FIXTURE_H) {
  const b = makeBuffer(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const on = (Math.floor(x / 6) + Math.floor(y / 6)) % 2 === 0;
      const i = (y * w + x) * 4;
      b.data[i] = on ? 230 : 30;
      b.data[i + 1] = on ? 200 : 60;
      b.data[i + 2] = on ? 160 : 90;
      b.data[i + 3] = 255;
    }
  }
  return b;
}

// Seeded gray noise — deterministic, exercises per-pixel effects.
export function noise(w = FIXTURE_W, h = FIXTURE_H, seed = 7) {
  const b = makeBuffer(w, h);
  const rand = seededRandom(seed);
  for (let i = 0; i < b.data.length; i += 4) {
    const v = Math.round(rand() * 255);
    b.data[i] = v;
    b.data[i + 1] = Math.round(v * (0.6 + rand() * 0.4));
    b.data[i + 2] = Math.round(v * (0.3 + rand() * 0.4));
    b.data[i + 3] = 255;
  }
  return b;
}

// Opaque "subject" ellipse on a transparent field with a vertical shade —
// the only fixture with alpha variation (needed by dropshadow, and gives
// composites/bloom something non-trivial to chew on).
export function portrait(w = FIXTURE_W, h = FIXTURE_H) {
  const b = makeBuffer(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const rx = w * 0.36;
  const ry = h * 0.44;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d <= 1) {
        const shade = 1 - (y / h) * 0.5;
        b.data[i] = Math.round(200 * shade);
        b.data[i + 1] = Math.round(140 * shade + 30);
        b.data[i + 2] = Math.round(110 * shade + 50);
        b.data[i + 3] = 255;
      }
    }
  }
  return b;
}

export const FIXTURES = { gradient, checker, noise, portrait };

// [name, fixture, effects] — one per registry effect + multi-effect stacks.
export const CASES = [
  ["brightness", "gradient", [{ type: "brightness", params: { v: 130 } }]],
  ["contrast", "gradient", [{ type: "contrast", params: { v: 140 } }]],
  ["saturate", "gradient", [{ type: "saturate", params: { v: 170 } }]],
  ["hue", "gradient", [{ type: "hue", params: { v: 45 } }]],
  ["sepia", "portrait", [{ type: "sepia", params: { v: 70 } }]],
  ["grayscale", "gradient", [{ type: "grayscale", params: { v: 100 } }]],
  ["invert", "gradient", [{ type: "invert", params: { v: 100 } }]],
  ["opacity", "portrait", [{ type: "opacity", params: { v: 60 } }]],
  ["blur", "checker", [{ type: "blur", params: { v: 3 } }]],
  ["duotone", "portrait", [{ type: "duotone", params: { shadow: "#1030a0", highlight: "#f0d060", contrast: 40 } }]],
  ["tritone", "portrait", [{ type: "tritone", params: { shadow: "#0b1d3a", mid: "#c44d4d", highlight: "#ffe8a3" } }]],
  ["posterize", "gradient", [{ type: "posterize", params: { steps: 6 } }]],
  ["heatmap", "noise", [{ type: "heatmap", params: { intensity: 100 } }]],
  ["drama", "portrait", [{ type: "drama", params: { style: "Noir", strength: 80, shadows: 10, highlights: -10, saturation: 110 } }]],
  ["chromatic", "checker", [{ type: "chromatic", params: { offset: 3, strength: 80 } }]],
  ["bloom", "portrait", [{ type: "bloom", params: { blur: 5, threshold: 160, contrast: 150, saturate: 120, opacity: 60, color: "#ffcc88", tint: 30, blend: "screen" } }]],
  ["dropshadow", "portrait", [{ type: "dropshadow", params: { x: 4, y: 5, blur: 3, color: "#2211aa" } }]],
  ["colorwash", "gradient", [{ type: "colorwash", params: { color: "#7c5cff", blend: "overlay", opacity: 45 } }]],
  ["gradient-overlay", "portrait", [{ type: "gradient", params: { c1: "#ff5c8a", c2: "#7c5cff", angle: 120, blend: "screen", opacity: 55 } }]],
  ["stops-overlay", "gradient", [{ type: "overlay", params: { kind: "radial", stops: [[0, "transparent"], [0.6, "#22ddff"], [1, "#000033"]], angle: 0, blend: "normal", opacity: 70 } }]],
  ["vignette", "portrait", [{ type: "vignette", params: { color: "#000000", size: 55, opacity: 60 } }]],
  ["scanlines", "checker", [{ type: "scanlines", params: { size: 3, color: "#000000", opacity: 40, blend: "multiply" } }]],
  ["prism", "gradient", [{ type: "prism", params: { c1: "#ff2e88", c2: "#2effd5", angle: 60, width: 30, opacity: 45 } }]],
  ["grain", "portrait", [{ type: "grain", params: { size: 1.2, opacity: 35, blend: "overlay", seed: 11 } }]],
  ["glitch", "checker", [{ type: "glitch", params: { style: "VHS Tear", amount: 55, bandSize: 25, split: 5, seed: 99 } }]],
  ["infrared", "portrait", [{ type: "infrared", params: { intensity: 75 } }]],
  ["vintage", "portrait", [{ type: "vintage", params: { sepia: 50, contrast: 90, saturate: 85, brightness: 108 } }]],
  ["psychedelic", "gradient", [{ type: "psychedelic", params: { saturate: 300, contrast: 140, bands: 8, solarize: 60 } }]],
  ["solarize", "portrait", [{ type: "solarize", params: { amount: 80, threshold: 45 } }]],
  ["hueband", "gradient", [{ type: "hueband", params: { bands: 5, spread: 30 } }]],

  /* ---- multi-effect stacks ---- */
  ["stack-film", "portrait", [
    { type: "vintage", params: { sepia: 45, contrast: 95, saturate: 80, brightness: 105 } },
    { type: "vignette", params: { color: "#1a0d00", size: 60, opacity: 55 } },
    { type: "grain", params: { size: 1.0, opacity: 30, blend: "overlay", seed: 3 } },
  ]],
  ["stack-neon", "gradient", [
    { type: "saturate", params: { v: 180 } },
    { type: "contrast", params: { v: 140 } },
    { type: "duotone", params: { shadow: "#0a0028", highlight: "#00ffcc", contrast: 30 } },
    { type: "bloom", params: { blur: 6, threshold: 150, contrast: 160, saturate: 140, opacity: 70, color: "#00ffcc", tint: 20, blend: "screen" } },
  ]],
  ["stack-signal", "checker", [
    { type: "glitch", params: { style: "Signal Loss", amount: 60, bandSize: 30, split: 6, seed: 5 } },
    { type: "scanlines", params: { size: 2, color: "#001100", opacity: 35, blend: "multiply" } },
    { type: "chromatic", params: { offset: 2, strength: 60 } },
  ]],
  ["stack-print", "portrait", [
    { type: "grayscale", params: { v: 100 } },
    { type: "contrast", params: { v: 150 } },
    { type: "posterize", params: { steps: 4 } },
    { type: "dropshadow", params: { x: 3, y: 4, blur: 2, color: "#000000" } },
  ]],
  ["stack-dream", "gradient", [
    { type: "blur", params: { v: 2 } },
    { type: "prism", params: { c1: "#ff2e88", c2: "#2effd5", angle: 30, width: 40, opacity: 40 } },
    { type: "colorwash", params: { color: "#3d2a70", blend: "soft-light", opacity: 50 } },
  ]],
  ["stack-drama", "portrait", [
    { type: "drama", params: { style: "Storm", strength: 85, shadows: 15, highlights: -20, saturation: 90 } },
    { type: "heatmap", params: { intensity: 40 } },
    { type: "grain", params: { size: 0.8, opacity: 25, blend: "hard-light", seed: 17 } },
  ]],
];

// FNV-1a 32-bit over the RGBA bytes — the pin hash.
export function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
