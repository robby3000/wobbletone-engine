// Effect registry: type → { category, params }.
// Param table transcribed from wobbletonefx EFFECT_CATALOG — the agent must
// not re-derive these. apply() implementations are wired in per-task (E2+).
//
// Param kinds:
//   number: { kind, min, max, default, unit?, px? }
//   select: { kind, options, default }
//   color:  { kind, default }               — hex only (#rgb / #rrggbb)
//   stops:  { kind, default }               — [[offset, "css-color"], ...]
//
// px: true marks params expressed in source-image pixels — render.js
// multiplies them by renderScale before dispatch.

import { BLEND_MODES } from "./color.js";

const num = (min, max, def, opts = {}) => ({ kind: "number", min, max, default: def, ...opts });
const sel = (options, def) => ({ kind: "select", options, default: def });
const col = (def) => ({ kind: "color", default: def });

export const EFFECTS = {
  /* ---- pointwise ---- */
  brightness: { category: "pointwise", params: { v: num(0, 200, 110, { unit: "%" }) } },
  contrast: { category: "pointwise", params: { v: num(0, 200, 110, { unit: "%" }) } },
  saturate: { category: "pointwise", params: { v: num(0, 300, 120, { unit: "%" }) } },
  hue: { category: "pointwise", params: { v: num(0, 360, 0, { unit: "°" }) } },
  sepia: { category: "pointwise", params: { v: num(0, 100, 60, { unit: "%" }) } },
  grayscale: { category: "pointwise", params: { v: num(0, 100, 100, { unit: "%" }) } },
  invert: { category: "pointwise", params: { v: num(0, 100, 100, { unit: "%" }) } },
  opacity: { category: "pointwise", params: { v: num(0, 100, 80, { unit: "%" }) } },

  /* ---- neighbourhood ---- */
  blur: { category: "neighbourhood", params: { v: num(0, 20, 1, { unit: "px", px: true }) } },

  /* ---- tone ---- */
  duotone: {
    category: "tone",
    params: { shadow: col("#1a0d3d"), highlight: col("#ff5c8a"), contrast: num(0, 100, 20, { unit: "%" }) },
  },
  tritone: {
    category: "tone",
    params: { shadow: col("#0b1d3a"), mid: col("#c44d4d"), highlight: col("#ffe8a3") },
  },
  posterize: { category: "tone", params: { steps: num(2, 16, 5) } },
  heatmap: { category: "tone", params: { intensity: num(0, 100, 100, { unit: "%" }) } },
  drama: {
    category: "tone",
    params: {
      style: sel(["Cinematic", "Noir", "Bleach", "Storm", "Portrait"], "Cinematic"),
      strength: num(0, 100, 70, { unit: "%" }),
      shadows: num(-50, 50, 0),
      highlights: num(-50, 50, 0),
      saturation: num(0, 150, 100, { unit: "%" }),
    },
  },

  /* ---- composite ---- */
  bloom: {
    category: "composite",
    params: {
      blur: num(0, 60, 12, { unit: "px", px: true }),
      threshold: num(50, 400, 140, { unit: "%" }),
      contrast: num(100, 250, 180, { unit: "%" }),
      saturate: num(0, 200, 100, { unit: "%" }),
      opacity: num(0, 100, 50, { unit: "%" }),
      color: col("#ffffff"),
      tint: num(0, 100, 0, { unit: "%" }),
      blend: sel(["screen", "lighten"], "screen"),
    },
  },
  chromatic: {
    category: "composite",
    params: { offset: num(0, 20, 4, { unit: "px", px: true }), strength: num(0, 100, 70, { unit: "%" }) },
  },
  dropshadow: {
    category: "composite",
    params: {
      x: num(-30, 30, 0, { unit: "px", px: true }),
      y: num(-30, 30, 8, { unit: "px", px: true }),
      blur: num(0, 50, 16, { unit: "px", px: true }),
      color: col("#7c5cff"),
    },
  },

  /* ---- overlay ---- */
  colorwash: {
    category: "overlay",
    params: {
      color: col("#7c5cff"),
      blend: sel(
        ["multiply", "screen", "overlay", "soft-light", "hard-light", "color-dodge", "color-burn", "hue", "saturation", "color", "luminosity", "difference", "exclusion"],
        "overlay",
      ),
      opacity: num(0, 100, 40, { unit: "%" }),
    },
  },
  gradient: {
    category: "overlay",
    params: {
      c1: col("#ff5c8a"),
      c2: col("#7c5cff"),
      angle: num(0, 360, 135, { unit: "°" }),
      blend: sel(
        ["multiply", "screen", "overlay", "soft-light", "hard-light", "color-dodge", "hue", "color", "luminosity", "difference", "exclusion"],
        "soft-light",
      ),
      opacity: num(0, 100, 50, { unit: "%" }),
    },
  },
  overlay: {
    category: "overlay",
    params: {
      kind: sel(["linear", "radial"], "linear"),
      stops: { kind: "stops", default: [[0, "#000000"], [1, "#ffffff"]] },
      angle: num(0, 360, 135, { unit: "°" }),
      blend: sel(BLEND_MODES, "normal"),
      opacity: num(0, 100, 100, { unit: "%" }),
    },
  },
  vignette: {
    category: "overlay",
    params: { color: col("#000000"), size: num(20, 100, 60, { unit: "%" }), opacity: num(0, 100, 50, { unit: "%" }) },
  },
  scanlines: {
    category: "overlay",
    params: {
      size: num(1, 8, 3, { unit: "px", px: true }),
      color: col("#000000"),
      opacity: num(0, 100, 30, { unit: "%" }),
      blend: sel(["multiply", "overlay", "soft-light", "screen"], "multiply"),
    },
  },
  prism: {
    category: "overlay",
    params: {
      c1: col("#ff2e88"),
      c2: col("#2effd5"),
      angle: num(0, 360, 45, { unit: "°" }),
      width: num(5, 60, 20, { unit: "%" }),
      opacity: num(0, 100, 35, { unit: "%" }),
    },
  },

  /* ---- procedural ---- */
  grain: {
    category: "procedural",
    params: {
      size: num(0.3, 3, 0.9, { px: true }),
      opacity: num(0, 100, 25, { unit: "%" }),
      blend: sel(["overlay", "soft-light", "hard-light", "screen", "multiply"], "overlay"),
      seed: num(1, 9999, 1),
    },
  },
  glitch: {
    category: "procedural",
    params: {
      style: sel(["CCD Failure", "VHS Tear", "RGB Fracture", "Signal Loss"], "CCD Failure"),
      amount: num(0, 100, 42, { unit: "%" }),
      bandSize: num(1, 100, 28, { unit: "%" }),
      split: num(0, 30, 6, { unit: "px", px: true }),
      seed: num(1, 9999, 317),
    },
  },

  /* ---- compound ---- */
  psychedelic: {
    category: "compound",
    params: {
      saturate: num(100, 500, 280, { unit: "%" }),
      contrast: num(80, 200, 130, { unit: "%" }),
      speed: num(0, 20, 8, { unit: "s" }),
      animate: sel(["yes", "no"], "yes"),
    },
  },
  infrared: { category: "compound", params: { intensity: num(0, 100, 70, { unit: "%" }) } },
  vintage: {
    category: "compound",
    params: {
      sepia: num(0, 100, 45, { unit: "%" }),
      contrast: num(60, 140, 95, { unit: "%" }),
      saturate: num(20, 150, 80, { unit: "%" }),
      brightness: num(60, 140, 105, { unit: "%" }),
    },
  },
};

export const EFFECT_TYPES = Object.keys(EFFECTS);
