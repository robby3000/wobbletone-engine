// Pointwise effects — each output pixel depends only on its input pixel.
// Byte math ported verbatim from aimless public/lib/filter-renderer.js
// applyColorFunction; spec params.v is the CSS percentage (110 → 1.10).
// Mutate-in-place; writes rely on Uint8ClampedArray rounding/clamping exactly
// as the source implementation did.

import { clamp } from "../color.js";

const pct = (params) => params.v / 100;

export function brightness(buffer, params) {
  const amount = pct(params);
  const data = buffer.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp(data[i] * amount, 0, 255);
    data[i + 1] = clamp(data[i + 1] * amount, 0, 255);
    data[i + 2] = clamp(data[i + 2] * amount, 0, 255);
  }
  return buffer;
}

export function contrast(buffer, params) {
  const amount = pct(params);
  const data = buffer.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp((data[i] - 128) * amount + 128, 0, 255);
    data[i + 1] = clamp((data[i + 1] - 128) * amount + 128, 0, 255);
    data[i + 2] = clamp((data[i + 2] - 128) * amount + 128, 0, 255);
  }
  return buffer;
}

export function saturate(buffer, params) {
  const amount = pct(params);
  const data = buffer.data;
  for (let i = 0; i < data.length; i += 4) {
    const red = data[i], green = data[i + 1], blue = data[i + 2];
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    data[i] = clamp(luminance + (red - luminance) * amount, 0, 255);
    data[i + 1] = clamp(luminance + (green - luminance) * amount, 0, 255);
    data[i + 2] = clamp(luminance + (blue - luminance) * amount, 0, 255);
  }
  return buffer;
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

export function grayscale(buffer, params = {}) {
  const w0 = BW_FILTERS.none;
  const wf = BW_FILTERS[String(params.filter || "None").toLowerCase()] || w0;
  const t = clamp(Number(params.intensity) || 0, 0, 100) / 100;
  const wr = w0[0] + (wf[0] - w0[0]) * t;
  const wg = w0[1] + (wf[1] - w0[1]) * t;
  const wb = w0[2] + (wf[2] - w0[2]) * t;
  const gain = Math.pow(2, clamp(Number(params.exposure) || 0, -100, 100) / 33.33);
  const contrastK = Math.max(0.1, 1 + (clamp(Number(params.contrast) || 0, -100, 100) / 100) * 1.3);
  const sAmt = (clamp(Number(params.shadows) || 0, -100, 100) / 100) * 180;
  const hAmt = (clamp(Number(params.highlights) || 0, -100, 100) / 100) * 180;
  const KNEE = 0.75, SOFT = 3;
  const shoulderNorm = 1 - Math.exp(-SOFT * (1 - KNEE));
  const data = buffer.data;
  for (let i = 0; i < data.length; i += 4) {
    let v = (wr * data[i] + wg * data[i + 1] + wb * data[i + 2]) * gain / 255;
    if (v > KNEE) v = KNEE + (1 - KNEE) * (1 - Math.exp(-SOFT * (v - KNEE))) / shoulderNorm;
    v = 128 + (v * 255 - 128) * contrastK;
    const l = clamp(v, 0, 255) / 255;
    const delta = sAmt * (l < 0.5 ? (1 - l / 0.5) * (1 - l / 0.5) : 0)
      + hAmt * (l > 0.5 ? ((l - 0.5) / 0.5) * ((l - 0.5) / 0.5) : 0);
    v = clamp(Math.round(v + delta), 0, 255);
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
  return buffer;
}

export function hue(buffer, params) {
  const amount = (params.v * Math.PI) / 180;
  const cos = Math.cos(amount);
  const sin = Math.sin(amount);
  const data = buffer.data;
  for (let i = 0; i < data.length; i += 4) {
    const red = data[i], green = data[i + 1], blue = data[i + 2];
    data[i] = clamp(red * (0.213 + cos * 0.787 - sin * 0.213) + green * (0.715 - cos * 0.715 - sin * 0.715) + blue * (0.072 - cos * 0.072 + sin * 0.928), 0, 255);
    data[i + 1] = clamp(red * (0.213 - cos * 0.213 + sin * 0.143) + green * (0.715 + cos * 0.285 + sin * 0.14) + blue * (0.072 - cos * 0.072 - sin * 0.283), 0, 255);
    data[i + 2] = clamp(red * (0.213 - cos * 0.213 - sin * 0.787) + green * (0.715 - cos * 0.715 + sin * 0.715) + blue * (0.072 + cos * 0.928 + sin * 0.072), 0, 255);
  }
  return buffer;
}

export function sepia(buffer, params) {
  const amount = pct(params);
  const data = buffer.data;
  for (let i = 0; i < data.length; i += 4) {
    const red = data[i], green = data[i + 1], blue = data[i + 2];
    const sr = clamp(red * 0.393 + green * 0.769 + blue * 0.189, 0, 255);
    const sg = clamp(red * 0.349 + green * 0.686 + blue * 0.168, 0, 255);
    const sb = clamp(red * 0.272 + green * 0.534 + blue * 0.131, 0, 255);
    data[i] = red + (sr - red) * amount;
    data[i + 1] = green + (sg - green) * amount;
    data[i + 2] = blue + (sb - blue) * amount;
  }
  return buffer;
}

export function invert(buffer, params) {
  const amount = pct(params);
  const data = buffer.data;
  for (let i = 0; i < data.length; i += 4) {
    const red = data[i], green = data[i + 1], blue = data[i + 2];
    data[i] = red * (1 - amount) + (255 - red) * amount;
    data[i + 1] = green * (1 - amount) + (255 - green) * amount;
    data[i + 2] = blue * (1 - amount) + (255 - blue) * amount;
  }
  return buffer;
}

export function opacity(buffer, params) {
  const amount = pct(params);
  const data = buffer.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = clamp(data[i + 3] * amount, 0, 255);
  }
  return buffer;
}
