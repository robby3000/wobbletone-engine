// Tone effects — duotone/tritone/posterize/heatmap/drama/chromatic.
// Ported verbatim from wobbletonefx app.js transformPixelData +
// pixelEffectColors/mapPixelColor/posterizeByte/dramaSettings/
// applyDramaPixelData/sampleDramaTable, adapted to buffer shape.
// (The SVG builder functions are not ported — SVG is a removed render path,
// not part of the semantic model.)

import { clamp, q8, lerpByte, hexToRgb, rgbToHsl, hslToRgb } from "../color.js";
import { gaussianBlur } from "./blur.js";
import { mapPixels } from "../buffer.js";
import { acquireBuffer, releaseBuffer } from "../pool.js";

const runStep = (buffer, step) => mapPixels(buffer, [step]);

/* ---------- shared gradient-map machinery ---------- */

export function mapPixelColor(value, colors) {
  const position = value * (colors.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(colors.length - 1, lower + 1);
  const amount = position - lower;
  return colors[lower].map((channel, index) => lerpByte(channel, colors[upper][index], amount));
}

function gradientMapPixel(px, colors) {
  const luminance = (0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]) / 255;
  const mapped = mapPixelColor(luminance, colors);
  px[0] = mapped[0];
  px[1] = mapped[1];
  px[2] = mapped[2];
}

function gradientMap(buffer, colors) {
  return runStep(buffer, (px) => gradientMapPixel(px, colors));
}

/* ---------- duotone / tritone / heatmap ---------- */

export function duotonePrepare(params) {
  const shadow = hexToRgb(params.shadow);
  const highlight = hexToRgb(params.highlight);
  const contrast = 1 + params.contrast / 100;
  return [shadow, highlight.map((value) => clamp(Math.round((value - 127.5) * contrast + 127.5), 0, 255))];
}
export function duotonePixel(px, colors) { gradientMapPixel(px, colors); }
export function duotone(buffer, params) {
  return gradientMap(buffer, duotonePrepare(params));
}

export function tritonePrepare(params) {
  return [hexToRgb(params.shadow), hexToRgb(params.mid), hexToRgb(params.highlight)];
}
export function tritonePixel(px, colors) { gradientMapPixel(px, colors); }
export function tritone(buffer, params) {
  return gradientMap(buffer, tritonePrepare(params));
}

export function heatmapPrepare(params) {
  const intensity = params.intensity / 100;
  return [
    [0.02, 0, 0.15], [0.1, 0, 0.4], [0.35, 0.05, 0.55],
    [0.7, 0.25, 0.1], [0.95, 0.7, 0.05], [1, 1, 0.9],
  ].map((color) => color.map((value) => Math.round(value * intensity * 255)));
}
export function heatmapPixel(px, colors) { gradientMapPixel(px, colors); }
export function heatmap(buffer, params) {
  return gradientMap(buffer, heatmapPrepare(params));
}

/* ---------- posterize ---------- */

export function posterizeByte(value, steps) {
  const band = Math.min(steps - 1, Math.floor(value / 256 * steps));
  return Math.round(band / (steps - 1) * 255);
}

export function posterizePrepare(params) {
  return clamp(Math.round(params.steps), 2, 16);
}
export function posterizePixel(px, steps) {
  px[0] = posterizeByte(px[0], steps);
  px[1] = posterizeByte(px[1], steps);
  px[2] = posterizeByte(px[2], steps);
}
export function posterize(buffer, params) {
  const steps = posterizePrepare(params);
  return runStep(buffer, (px) => posterizePixel(px, steps));
}

/* ---------- solarize ---------- */

// Classic darkroom solarization: tones above `threshold` invert
// (v → 255 − v), mixed back toward the original by `amount`.
export function solarizePrepare(params) {
  return { threshold: (params.threshold / 100) * 255, mix: params.amount / 100 };
}
export function solarizePixel(px, p) {
  for (let c = 0; c < 3; c++) {
    const v = px[c];
    const s = v <= p.threshold ? v : 255 - v;
    px[c] = clamp(Math.round(v + (s - v) * p.mix), 0, 255);
  }
}
export function solarize(buffer, params) {
  const pre = solarizePrepare(params);
  return runStep(buffer, (px) => solarizePixel(px, pre));
}

/* ---------- hueband ---------- */

// Hue quantization: snap each pixel's hue to the centre of one of `bands`
// equal-width buckets, preserving saturation and lightness. `spread`
// progressively rotates successive bands around the wheel — at 0 the bands
// sit at their centres, higher values push neighbouring hues apart.
export function huebandPrepare(params) {
  const bands = Math.max(2, Math.round(params.bands));
  return { spread: params.spread / 100, seg: 360 / bands };
}
export function huebandPixel(px, p) {
  const [h, s, l] = rgbToHsl(px[0], px[1], px[2]);
  if (s === 0) return;
  const band = Math.floor(h / p.seg);
  const h2 = ((band + 0.5) * p.seg + band * p.spread * p.seg) % 360;
  const [r, g, b] = hslToRgb(h2, s, l);
  px[0] = r;
  px[1] = g;
  px[2] = b;
}
export function hueband(buffer, params) {
  const pre = huebandPrepare(params);
  return runStep(buffer, (px) => huebandPixel(px, pre));
}

/* ---------- shadows / highlights ---------- */

// Region-weighted tonal adjustment. The shadow mask (1 − l/0.5)² peaks at
// black and fades out at mid-gray; the highlight mask mirrors it. Deltas are
// additive per channel, scaled by the masks — smooth, monotonic, cheap.
export function shadowshighlightsPrepare(params) {
  return { sAmt: (params.shadows / 100) * 140, hAmt: (params.highlights / 100) * 140 };
}
export function shadowshighlightsPixel(px, p) {
  const l = (0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]) / 255;
  const ws = l < 0.5 ? (1 - l / 0.5) * (1 - l / 0.5) : 0;
  const wh = l > 0.5 ? ((l - 0.5) / 0.5) * ((l - 0.5) / 0.5) : 0;
  const delta = p.sAmt * ws + p.hAmt * wh;
  if (delta === 0) return;
  px[0] = clamp(Math.round(px[0] + delta), 0, 255);
  px[1] = clamp(Math.round(px[1] + delta), 0, 255);
  px[2] = clamp(Math.round(px[2] + delta), 0, 255);
}
export function shadowshighlights(buffer, params) {
  const pre = shadowshighlightsPrepare(params);
  return runStep(buffer, (px) => shadowshighlightsPixel(px, pre));
}

/* ---------- drama ---------- */

// Per-look recipe, all interpolated by `strength`:
//   curve      5-point luminance LUT anchors (toe → shoulder)
//   saturation chroma multiplier at full strength
//   clarity    unsharp-mask amount: + = microcontrast, − = softening
//   glow       screen-blend of the blurred copy (halation)
//   shadow / highlight  per-channel grade ramps across the tone range
const DRAMA_LOOKS = {
  cinematic: {
    curve: [0, 0.14, 0.5, 0.87, 0.985], saturation: 0.8, clarity: 0.2, glow: 0,
    shadow: [-0.02, 0.005, 0.05], highlight: [0.05, 0.022, -0.02],
  },
  noir: {
    curve: [0.005, 0.08, 0.45, 0.93, 1], saturation: 0, clarity: 0.6, glow: 0,
    shadow: [0, 0.002, 0.01], highlight: [0.005, 0.005, 0.005],
  },
  bleach: {
    curve: [0.015, 0.14, 0.44, 0.9, 1], saturation: 0.4, clarity: 0.5, glow: 0,
    shadow: [-0.012, 0, 0.018], highlight: [0.028, 0.022, 0],
  },
  storm: {
    curve: [0, 0.11, 0.42, 0.7, 0.88], saturation: 0.55, clarity: 0.4, glow: 0,
    shadow: [-0.02, 0.005, 0.06], highlight: [-0.008, 0.008, 0.035],
  },
  portrait: {
    curve: [0.05, 0.24, 0.52, 0.78, 0.96], saturation: 0.92, clarity: -0.35, glow: 0.22,
    shadow: [0.02, 0.006, -0.012], highlight: [0.05, 0.02, -0.022],
  },
};

export function dramaSettings(params) {
  const look = DRAMA_LOOKS[String(params.style || "cinematic").toLowerCase()] || DRAMA_LOOKS.cinematic;
  const strength = clamp(Number(params.strength) || 0, 0, 100) / 100;
  const shadows = clamp(Number(params.shadows) || 0, -50, 50) / 50 * 0.12 * strength;
  const highlights = clamp(Number(params.highlights) || 0, -50, 50) / 50 * 0.12 * strength;
  const requestedSaturation = clamp(Number(params.saturation) || 0, 0, 150) / 100;
  const saturation = 1 + (look.saturation * requestedSaturation - 1) * strength;
  const tableSize = 17;
  const tables = [0, 1, 2].map((channel) => {
    let previous = 0;
    return Array.from({ length: tableSize }, (_, index) => {
      const x = index / (tableSize - 1);
      const position = x * (look.curve.length - 1);
      const lower = Math.floor(position);
      const upper = Math.min(look.curve.length - 1, lower + 1);
      const styled = look.curve[lower] + (look.curve[upper] - look.curve[lower]) * (position - lower);
      const tone = x + (styled - x) * strength + shadows * (1 - x) * (1 - x) + highlights * x * x;
      const grade = (look.shadow[channel] * (1 - x) + look.highlight[channel] * x) * strength;
      const value = Math.max(previous, clamp(tone + grade, 0, 1));
      previous = value;
      return value;
    });
  });
  return { saturation, tables, clarity: look.clarity * strength, glow: look.glow * strength };
}

function sampleDramaTable(value, table) {
  const position = clamp(value, 0, 255) / 255 * (table.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(table.length - 1, lower + 1);
  return Math.round((table[lower] + (table[upper] - table[lower]) * (position - lower)) * 255);
}

// Spatial stage first (clarity unsharp + glow halation on a blurred copy),
// then the pointwise grade: saturation around luminance, per-channel LUT.
// Blur radius is resolution-relative so preview and export stay matched.
export function drama(buffer, params) {
  const { saturation, tables, clarity, glow } = dramaSettings(params);
  const data = buffer.data;
  let soft = null;
  if (Math.abs(clarity) > 0.001 || glow > 0.001) {
    soft = acquireBuffer(buffer.width, buffer.height, { zero: false });
    soft.data.set(buffer.data);
    gaussianBlur(soft, Math.min(buffer.width, buffer.height) / 320);
  }
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], b = data[i + 2];
    if (soft) {
      const sr = soft.data[i], sg = soft.data[i + 1], sb = soft.data[i + 2];
      if (clarity > 0) {
        r += (r - sr) * clarity;
        g += (g - sg) * clarity;
        b += (b - sb) * clarity;
      } else if (clarity < 0) {
        r += (sr - r) * -clarity;
        g += (sg - g) * -clarity;
        b += (sb - b) * -clarity;
      }
      if (glow > 0) {
        r += (255 - (255 - r) * (255 - sr) / 255 - r) * glow;
        g += (255 - (255 - g) * (255 - sg) / 255 - g) * glow;
        b += (255 - (255 - b) * (255 - sb) / 255 - b) * glow;
      }
      r = clamp(Math.round(r), 0, 255);
      g = clamp(Math.round(g), 0, 255);
      b = clamp(Math.round(b), 0, 255);
    }
    const luminance = 0.213 * r + 0.715 * g + 0.072 * b;
    const red = clamp(luminance + (r - luminance) * saturation, 0, 255);
    const green = clamp(luminance + (g - luminance) * saturation, 0, 255);
    const blue = clamp(luminance + (b - luminance) * saturation, 0, 255);
    data[i] = sampleDramaTable(red, tables[0]);
    data[i + 1] = sampleDramaTable(green, tables[1]);
    data[i + 2] = sampleDramaTable(blue, tables[2]);
  }
  if (soft) releaseBuffer(soft);
  return buffer;
}

/* ---------- chromatic aberration ---------- */

export function chromatic(buffer, params) {
  const data = buffer.data;
  const copy = acquireBuffer(buffer.width, buffer.height, { zero: false });
  const original = copy.data;
  original.set(data);
  const offset = Math.round(params.offset);
  const strength = params.strength / 100;
  const W = buffer.width, H = buffer.height;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const ri = (y * W + clamp(x - offset, 0, W - 1)) * 4;
      const bi = (y * W + clamp(x + offset, 0, W - 1)) * 4;
      data[i] = lerpByte(original[i], original[ri], strength);
      data[i + 1] = original[i + 1];
      data[i + 2] = lerpByte(original[i + 2], original[bi + 2], strength);
    }
  }
  releaseBuffer(copy);
  return buffer;
}
