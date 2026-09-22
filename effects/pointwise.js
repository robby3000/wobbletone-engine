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

export function grayscale(buffer, params) {
  const target = 1 - pct(params);
  const data = buffer.data;
  for (let i = 0; i < data.length; i += 4) {
    const red = data[i], green = data[i + 1], blue = data[i + 2];
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    data[i] = clamp(luminance + (red - luminance) * target, 0, 255);
    data[i + 1] = clamp(luminance + (green - luminance) * target, 0, 255);
    data[i + 2] = clamp(luminance + (blue - luminance) * target, 0, 255);
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
