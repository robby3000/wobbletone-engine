// Colour primitives. Blend-mode implementations land here in E5.

// All 15 W3C Compositing & Blending Level 1 modes.
export const BLEND_MODES = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten",
  "color-dodge", "color-burn", "hard-light", "soft-light",
  "difference", "exclusion", "hue", "saturation", "color", "luminosity",
];

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function lerpByte(start, end, amount) {
  return clamp(Math.round(start + (end - start) * amount), 0, 255);
}

export const hexToRgb = (hex) => {
  const m = hex.replace("#", "");
  const v = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
};

// Numeric [r,g,b] in 0–1 (app.js's string version existed only for SVG output).
export const rgb01 = (hex) => hexToRgb(hex).map((v) => v / 255);

// W3C Compositing & Blending luma coefficients. Unit-agnostic: pass bytes or
// 0–1 floats, the result is in the same units.
export const luminance = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
