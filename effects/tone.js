// Tone effects — duotone/tritone/posterize/heatmap/drama/chromatic.
// Ported verbatim from wobbletonefx app.js transformPixelData +
// pixelEffectColors/mapPixelColor/posterizeByte/dramaSettings/
// applyDramaPixelData/sampleDramaTable, adapted to buffer shape.
// (The SVG builder functions are not ported — SVG is a removed render path,
// not part of the semantic model.)

import { clamp, lerpByte, hexToRgb, rgbToHsl, hslToRgb } from "../color.js";
import { gaussianBlur } from "./blur.js";
import { cloneBuffer } from "../buffer.js";

/* ---------- shared gradient-map machinery ---------- */

export function mapPixelColor(value, colors) {
  const position = value * (colors.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(colors.length - 1, lower + 1);
  const amount = position - lower;
  return colors[lower].map((channel, index) => lerpByte(channel, colors[upper][index], amount));
}

function gradientMap(buffer, colors) {
  const data = buffer.data;
  for (let i = 0; i < data.length; i += 4) {
    const luminance = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    const mapped = mapPixelColor(luminance, colors);
    data[i] = mapped[0];
    data[i + 1] = mapped[1];
    data[i + 2] = mapped[2];
  }
  return buffer;
}

/* ---------- duotone / tritone / heatmap ---------- */

export function duotone(buffer, params) {
  const shadow = hexToRgb(params.shadow);
  const highlight = hexToRgb(params.highlight);
  const contrast = 1 + params.contrast / 100;
  const colors = [shadow, highlight.map((value) => clamp(Math.round((value - 127.5) * contrast + 127.5), 0, 255))];
  return gradientMap(buffer, colors);
}

export function tritone(buffer, params) {
  return gradientMap(buffer, [hexToRgb(params.shadow), hexToRgb(params.mid), hexToRgb(params.highlight)]);
}

export function heatmap(buffer, params) {
  const intensity = params.intensity / 100;
  const colors = [
    [0.02, 0, 0.15], [0.1, 0, 0.4], [0.35, 0.05, 0.55],
    [0.7, 0.25, 0.1], [0.95, 0.7, 0.05], [1, 1, 0.9],
  ].map((color) => color.map((value) => Math.round(value * intensity * 255)));
  return gradientMap(buffer, colors);
}

/* ---------- posterize ---------- */

export function posterizeByte(value, steps) {
  const band = Math.min(steps - 1, Math.floor(value / 256 * steps));
  return Math.round(band / (steps - 1) * 255);
}

export function posterize(buffer, params) {
  const steps = clamp(Math.round(params.steps), 2, 16);
  const data = buffer.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = posterizeByte(data[i], steps);
    data[i + 1] = posterizeByte(data[i + 1], steps);
    data[i + 2] = posterizeByte(data[i + 2], steps);
  }
  return buffer;
}

/* ---------- solarize ---------- */

// Classic darkroom solarization: tones above `threshold` invert
// (v → 255 − v), mixed back toward the original by `amount`.
export function solarize(buffer, params) {
  const threshold = (params.threshold / 100) * 255;
  const mix = params.amount / 100;
  const data = buffer.data;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = data[i + c];
      const s = v <= threshold ? v : 255 - v;
      data[i + c] = clamp(Math.round(v + (s - v) * mix), 0, 255);
    }
  }
  return buffer;
}

/* ---------- hueband ---------- */

// Hue quantization: snap each pixel's hue to the centre of one of `bands`
// equal-width buckets, preserving saturation and lightness. `spread`
// progressively rotates successive bands around the wheel — at 0 the bands
// sit at their centres, higher values push neighbouring hues apart.
export function hueband(buffer, params) {
  const bands = Math.max(2, Math.round(params.bands));
  const spread = params.spread / 100;
  const seg = 360 / bands;
  const data = buffer.data;
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (s === 0) continue;
    const band = Math.floor(h / seg);
    const h2 = ((band + 0.5) * seg + band * spread * seg) % 360;
    const [r, g, b] = hslToRgb(h2, s, l);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  return buffer;
}

/* ---------- shadows / highlights ---------- */

// Region-weighted tonal adjustment. The shadow mask (1 − l/0.5)² peaks at
// black and fades out at mid-gray; the highlight mask mirrors it. Deltas are
// additive per channel, scaled by the masks — smooth, monotonic, cheap.
export function shadowshighlights(buffer, params) {
  const sAmt = (params.shadows / 100) * 140;
  const hAmt = (params.highlights / 100) * 140;
  const data = buffer.data;
  for (let i = 0; i < data.length; i += 4) {
    const l = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    const ws = l < 0.5 ? (1 - l / 0.5) * (1 - l / 0.5) : 0;
    const wh = l > 0.5 ? ((l - 0.5) / 0.5) * ((l - 0.5) / 0.5) : 0;
    const delta = sAmt * ws + hAmt * wh;
    if (delta === 0) continue;
    data[i] = clamp(Math.round(data[i] + delta), 0, 255);
    data[i + 1] = clamp(Math.round(data[i + 1] + delta), 0, 255);
    data[i + 2] = clamp(Math.round(data[i + 2] + delta), 0, 255);
  }
  return buffer;
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
    soft = gaussianBlur(cloneBuffer(buffer), Math.min(buffer.width, buffer.height) / 320);
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
  return buffer;
}

/* ---------- chromatic aberration ---------- */

export function chromatic(buffer, params) {
  const data = buffer.data;
  const original = new Uint8ClampedArray(data);
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
  return buffer;
}
