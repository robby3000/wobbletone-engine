// Pointwise effects — each output pixel depends only on its input pixel.
// Byte math ported verbatim from aimless public/lib/filter-renderer.js
// applyColorFunction; spec params.v is the CSS percentage (110 → 1.10).
//
// Fusion shape: each effect exposes <name>Prepare(params) → constants and
// <name>Pixel(px, pre) → per-pixel step writing through q8 (ToUint8Clamp).
// apply(buffer, params) is a one-step mapPixels call; render.js fuses
// consecutive pixel-local effects into a single mapPixels pass with the
// same steps — byte-identical either way.

import { clamp, q8 } from "../color.js";
import { mapPixels } from "../buffer.js";

const pct = (params) => params.v / 100;
const runStep = (buffer, step) => mapPixels(buffer, [step]);

export function brightnessPrepare(params) { return pct(params); }
export function brightnessPixel(px, amount) {
  px[0] = q8(px[0] * amount);
  px[1] = q8(px[1] * amount);
  px[2] = q8(px[2] * amount);
}
export function brightness(buffer, params) {
  const amount = brightnessPrepare(params);
  return runStep(buffer, (px) => brightnessPixel(px, amount));
}

export function contrastPrepare(params) { return pct(params); }
export function contrastPixel(px, amount) {
  px[0] = q8((px[0] - 128) * amount + 128);
  px[1] = q8((px[1] - 128) * amount + 128);
  px[2] = q8((px[2] - 128) * amount + 128);
}
export function contrast(buffer, params) {
  const amount = contrastPrepare(params);
  return runStep(buffer, (px) => contrastPixel(px, amount));
}

export function saturatePrepare(params) { return pct(params); }
export function saturatePixel(px, amount) {
  const luminance = 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];
  px[0] = q8(luminance + (px[0] - luminance) * amount);
  px[1] = q8(luminance + (px[1] - luminance) * amount);
  px[2] = q8(luminance + (px[2] - luminance) * amount);
}
export function saturate(buffer, params) {
  const amount = saturatePrepare(params);
  return runStep(buffer, (px) => saturatePixel(px, amount));
}

// B&W darkroom: colour-to-luminance with a coloured-contrast-filter model.
// Each filter reweights the RGB contribution to luminance (its own colour
// passes, the complement darkens); strong filters sum to < 1 because they
// physically transmit less light — that's where the real darkening comes
// from (a red 25A costs ~3 stops). `intensity` lerps standard luminance →
// filter weights. Then on the scalar gray: EV gain with an exponential
// shoulder (soft rolloff instead of hard clip), contrast around mid-gray,
// and region-weighted shadow/highlight deltas. Always full monochrome —
// params.v (the old Amount) is ignored; partial desat lives in `saturate`.
const BW_FILTERS = {
  none: [0.2126, 0.7152, 0.0722],
  yellow: [0.34, 0.5, 0.08],
  orange: [0.5, 0.35, 0.03],
  red: [0.62, 0.12, 0.02],
  green: [0.1, 0.8, 0.08],
  blue: [0.06, 0.2, 0.6],
};

const GRAY_KNEE = 0.75, GRAY_SOFT = 3;

export function grayscalePrepare(params = {}) {
  const w0 = BW_FILTERS.none;
  const wf = BW_FILTERS[String(params.filter || "None").toLowerCase()] || w0;
  const t = clamp(Number(params.intensity) || 0, 0, 100) / 100;
  return {
    wr: w0[0] + (wf[0] - w0[0]) * t,
    wg: w0[1] + (wf[1] - w0[1]) * t,
    wb: w0[2] + (wf[2] - w0[2]) * t,
    gain: Math.pow(2, clamp(Number(params.exposure) || 0, -100, 100) / 33.33),
    contrastK: Math.max(0.1, 1 + (clamp(Number(params.contrast) || 0, -100, 100) / 100) * 1.3),
    sAmt: (clamp(Number(params.shadows) || 0, -100, 100) / 100) * 180,
    hAmt: (clamp(Number(params.highlights) || 0, -100, 100) / 100) * 180,
    shoulderNorm: 1 - Math.exp(-GRAY_SOFT * (1 - GRAY_KNEE)),
  };
}
export function grayscalePixel(px, p) {
  let v = (p.wr * px[0] + p.wg * px[1] + p.wb * px[2]) * p.gain / 255;
  if (v > GRAY_KNEE) v = GRAY_KNEE + (1 - GRAY_KNEE) * (1 - Math.exp(-GRAY_SOFT * (v - GRAY_KNEE))) / p.shoulderNorm;
  v = 128 + (v * 255 - 128) * p.contrastK;
  const l = clamp(v, 0, 255) / 255;
  const delta = p.sAmt * (l < 0.5 ? (1 - l / 0.5) * (1 - l / 0.5) : 0)
    + p.hAmt * (l > 0.5 ? ((l - 0.5) / 0.5) * ((l - 0.5) / 0.5) : 0);
  v = clamp(Math.round(v + delta), 0, 255);
  px[0] = v;
  px[1] = v;
  px[2] = v;
}
export function grayscale(buffer, params = {}) {
  const pre = grayscalePrepare(params);
  return runStep(buffer, (px) => grayscalePixel(px, pre));
}

export function huePrepare(params) {
  const amount = (params.v * Math.PI) / 180;
  return { cos: Math.cos(amount), sin: Math.sin(amount) };
}
export function huePixel(px, { cos, sin }) {
  const red = px[0], green = px[1], blue = px[2];
  px[0] = q8(red * (0.213 + cos * 0.787 - sin * 0.213) + green * (0.715 - cos * 0.715 - sin * 0.715) + blue * (0.072 - cos * 0.072 + sin * 0.928));
  px[1] = q8(red * (0.213 - cos * 0.213 + sin * 0.143) + green * (0.715 + cos * 0.285 + sin * 0.14) + blue * (0.072 - cos * 0.072 - sin * 0.283));
  px[2] = q8(red * (0.213 - cos * 0.213 - sin * 0.787) + green * (0.715 - cos * 0.715 + sin * 0.715) + blue * (0.072 + cos * 0.928 + sin * 0.072));
}
export function hue(buffer, params) {
  const pre = huePrepare(params);
  return runStep(buffer, (px) => huePixel(px, pre));
}

export function sepiaPrepare(params) { return pct(params); }
export function sepiaPixel(px, amount) {
  const red = px[0], green = px[1], blue = px[2];
  const sr = clamp(red * 0.393 + green * 0.769 + blue * 0.189, 0, 255);
  const sg = clamp(red * 0.349 + green * 0.686 + blue * 0.168, 0, 255);
  const sb = clamp(red * 0.272 + green * 0.534 + blue * 0.131, 0, 255);
  px[0] = q8(red + (sr - red) * amount);
  px[1] = q8(green + (sg - green) * amount);
  px[2] = q8(blue + (sb - blue) * amount);
}
export function sepia(buffer, params) {
  const amount = sepiaPrepare(params);
  return runStep(buffer, (px) => sepiaPixel(px, amount));
}

export function invertPrepare(params) { return pct(params); }
export function invertPixel(px, amount) {
  px[0] = q8(px[0] * (1 - amount) + (255 - px[0]) * amount);
  px[1] = q8(px[1] * (1 - amount) + (255 - px[1]) * amount);
  px[2] = q8(px[2] * (1 - amount) + (255 - px[2]) * amount);
}
export function invert(buffer, params) {
  const amount = invertPrepare(params);
  return runStep(buffer, (px) => invertPixel(px, amount));
}

export function opacityPrepare(params) { return pct(params); }
export function opacityPixel(px, amount) {
  px[3] = q8(px[3] * amount);
}
export function opacity(buffer, params) {
  const amount = opacityPrepare(params);
  return runStep(buffer, (px) => opacityPixel(px, amount));
}
