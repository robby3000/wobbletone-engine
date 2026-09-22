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

/* ---------- W3C Compositing & Blending Level 1 ---------- */

const softLightD = (x) => (x <= 0.25 ? ((16 * x - 12) * x + 4) * x : Math.sqrt(x));

// Separable blend modes B(Cb, Cs) on 0–1 channel values.
// Throws on non-separable modes — use blendColor for those.
export function blendChannel(mode, cb, cs) {
  switch (mode) {
    case "normal": return cs;
    case "multiply": return cb * cs;
    case "screen": return cb + cs - cb * cs;
    case "overlay": return cb <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs);
    case "darken": return Math.min(cb, cs);
    case "lighten": return Math.max(cb, cs);
    case "color-dodge": return cs === 1 ? 1 : Math.min(1, cb / (1 - cs));
    case "color-burn": return cs === 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs);
    case "hard-light": return cs <= 0.5 ? cb * 2 * cs : 1 - 2 * (1 - cb) * (1 - cs);
    case "soft-light":
      return cs <= 0.5
        ? cb - (1 - 2 * cs) * cb * (1 - cb)
        : cb + (2 * cs - 1) * (softLightD(cb) - cb);
    case "difference": return Math.abs(cb - cs);
    case "exclusion": return cb + cs - 2 * cb * cs;
    default:
      throw new Error(`blendChannel: non-separable or unknown mode "${mode}"`);
  }
}

/* ---- non-separable helpers (spec's Lum/Sat/SetLum/SetSat/ClipColor) ---- */

const lumOf = (c) => luminance(c[0], c[1], c[2]);
const satOf = (c) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);

export function clipColor(c) {
  const l = lumOf(c);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  const out = [c[0], c[1], c[2]];
  if (n < 0) {
    for (let i = 0; i < 3; i++) out[i] = l + ((out[i] - l) * l) / (l - n);
  }
  if (x > 1) {
    for (let i = 0; i < 3; i++) out[i] = l + ((out[i] - l) * (1 - l)) / (x - l);
  }
  return out;
}

export function setLum(c, l) {
  const d = l - lumOf(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
}

export function setSat(c, s) {
  const [lo, mid, hi] = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const out = [c[0], c[1], c[2]];
  if (c[hi] > c[lo]) {
    out[mid] = ((c[mid] - c[lo]) * s) / (c[hi] - c[lo]);
    out[hi] = s;
  } else {
    out[mid] = 0;
    out[hi] = 0;
  }
  out[lo] = 0;
  return out;
}

// Full 16-mode blend on [r,g,b] 0–1 triples → [r,g,b] 0–1.
export function blendColor(mode, cb, cs) {
  switch (mode) {
    case "hue": return setLum(setSat(cs, satOf(cb)), lumOf(cb));
    case "saturation": return setLum(setSat(cb, satOf(cs)), lumOf(cb));
    case "color": return setLum(cs, lumOf(cb));
    case "luminosity": return setLum(cb, lumOf(cs));
    default:
      return [
        blendChannel(mode, cb[0], cs[0]),
        blendChannel(mode, cb[1], cs[1]),
        blendChannel(mode, cb[2], cs[2]),
      ];
  }
}

/* ---------- compositing ---------- */

// Composite `layer` over `backdrop` with blend `mode` at `opacity`%.
// Full W3C blended source-over on straight-alpha buffers, in place:
//   αs = layerAlpha × o
//   αo = αs + αb(1 − αs)
//   Cs' = (1 − αb)·Cs + αb·B(Cb, Cs)
//   co  = (αs·Cs' + αb·(1−αs)·Cb) / αo
export function compositeOver(backdrop, layer, mode = "normal", opacity = 100) {
  if (layer.width !== backdrop.width || layer.height !== backdrop.height) {
    throw new Error(`compositeOver: size mismatch ${layer.width}x${layer.height} vs ${backdrop.width}x${backdrop.height}`);
  }
  const o = clamp(opacity, 0, 100) / 100;
  const bd = backdrop.data;
  const ld = layer.data;
  for (let i = 0; i < bd.length; i += 4) {
    const ab = bd[i + 3] / 255;
    const as = (ld[i + 3] / 255) * o;
    const ao = as + ab * (1 - as);
    if (ao <= 0) {
      bd[i] = bd[i + 1] = bd[i + 2] = bd[i + 3] = 0;
      continue;
    }
    const cb = [bd[i] / 255, bd[i + 1] / 255, bd[i + 2] / 255];
    const cs = [ld[i] / 255, ld[i + 1] / 255, ld[i + 2] / 255];
    const blended = blendColor(mode, cb, cs);
    for (let c = 0; c < 3; c++) {
      const csPrime = (1 - ab) * cs[c] + ab * blended[c];
      bd[i + c] = ((as * csPrime + ab * (1 - as) * cb[c]) / ao) * 255;
    }
    bd[i + 3] = ao * 255;
  }
  return backdrop;
}
