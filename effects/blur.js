// Separable Gaussian blur — σ = the spec's px param (CSS blur(Npx) uses σ = N;
// the box-shadow 2σ convention does NOT apply). Kernel truncated at ±3σ.
// Edge handling: sample coordinates clamp to image bounds.
// Horizontal pass writes float scratch; vertical pass reads it — rounding to
// bytes happens once, at the final write-back.

import { clamp } from "../color.js";

export function gaussianKernel(sigma) {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const weights = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    weights[k + radius] = w;
    sum += w;
  }
  for (let i = 0; i < weights.length; i++) weights[i] /= sum;
  return { weights, radius };
}

export function gaussianBlur(buffer, sigma) {
  if (!(sigma > 0)) return buffer;
  const { weights, radius } = gaussianKernel(sigma);
  const { data, width: W, height: H } = buffer;
  const scratch = new Float64Array(data.length);

  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = row + clamp(x + k, 0, W - 1);
        const i = sx * 4;
        const w = weights[k + radius];
        r += data[i] * w;
        g += data[i + 1] * w;
        b += data[i + 2] * w;
        a += data[i + 3] * w;
      }
      const o = (row + x) * 4;
      scratch[o] = r;
      scratch[o + 1] = g;
      scratch[o + 2] = b;
      scratch[o + 3] = a;
    }
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const i = (clamp(y + k, 0, H - 1) * W + x) * 4;
        const w = weights[k + radius];
        r += scratch[i] * w;
        g += scratch[i + 1] * w;
        b += scratch[i + 2] * w;
        a += scratch[i + 3] * w;
      }
      const o = (y * W + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = a;
    }
  }
  return buffer;
}

export function blur(buffer, params) {
  return gaussianBlur(buffer, params.v);
}
