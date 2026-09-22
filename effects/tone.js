// Tone effects — duotone/tritone/posterize/heatmap/drama/chromatic.
// Ported verbatim from wobbletonefx app.js transformPixelData +
// pixelEffectColors/mapPixelColor/posterizeByte/dramaSettings/
// applyDramaPixelData/sampleDramaTable, adapted to buffer shape.
// (The SVG builder functions are not ported — SVG is a removed render path,
// not part of the semantic model.)

import { clamp, lerpByte, hexToRgb } from "../color.js";

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

/* ---------- drama ---------- */

const DRAMA_LOOKS = {
  cinematic: { curve: [0, 0.18, 0.52, 0.82, 1], saturation: 0.9, shadow: [-0.015, 0.002, 0.025], highlight: [0.028, 0.012, -0.01] },
  noir: { curve: [0, 0.11, 0.5, 0.9, 1], saturation: 0, shadow: [0, 0, 0], highlight: [0, 0, 0] },
  bleach: { curve: [0.035, 0.19, 0.53, 0.86, 0.99], saturation: 0.38, shadow: [-0.01, 0, 0.012], highlight: [0.024, 0.018, 0] },
  storm: { curve: [0, 0.14, 0.46, 0.76, 0.94], saturation: 0.72, shadow: [-0.015, 0.004, 0.04], highlight: [-0.006, 0.004, 0.022] },
  portrait: { curve: [0.018, 0.23, 0.51, 0.79, 0.985], saturation: 0.95, shadow: [0, 0, 0.006], highlight: [0.032, 0.014, -0.006] },
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
  return { saturation, tables };
}

function sampleDramaTable(value, table) {
  const position = clamp(value, 0, 255) / 255 * (table.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(table.length - 1, lower + 1);
  return Math.round((table[lower] + (table[upper] - table[lower]) * (position - lower)) * 255);
}

export function drama(buffer, params) {
  const { saturation, tables } = dramaSettings(params);
  const data = buffer.data;
  for (let i = 0; i < data.length; i += 4) {
    const luminance = 0.213 * data[i] + 0.715 * data[i + 1] + 0.072 * data[i + 2];
    const red = clamp(luminance + (data[i] - luminance) * saturation, 0, 255);
    const green = clamp(luminance + (data[i + 1] - luminance) * saturation, 0, 255);
    const blue = clamp(luminance + (data[i + 2] - luminance) * saturation, 0, 255);
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
