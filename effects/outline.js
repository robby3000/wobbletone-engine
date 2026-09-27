// Outline — luminance edge-tracing.
//
// Sobel gradient magnitude on the luminance field produces an edge
// mask; a soft threshold ramp gives anti-aliased lines. `detail`
// pre-blurs the source so only larger-scale structure edges; `width`
// dilates the mask (morphology's sliding-window max) for thicker
// strokes; `softness` blurs it for feathered/glowy lines. The tinted
// line is composited over a surface: `original` (trace over the photo),
// `light` (sketch-on-paper), `dark` (chalkboard/neon). Source alpha is
// preserved. CPU-only.

import { gaussianKernel } from "./blur.js";
import { slideExtremum } from "./morphology.js";
import { acquireBuffer, releaseBuffer, acquireFloats, releaseFloats } from "../pool.js";
import { hexToRgb, luminance, clamp } from "../color.js";
import { gaussianBlur } from "./blur.js";

// Separable gaussian over a Float32Array gray field.
function blurGray(field, W, H, sigma) {
  if (!(sigma > 0)) return;
  const { weights, radius } = gaussianKernel(sigma);
  const tmp = acquireFloats(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        s += field[row + clamp(x + k, 0, W - 1)] * weights[k + radius];
      }
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        s += tmp[clamp(y + k, 0, H - 1) * W + x] * weights[k + radius];
      }
      field[y * W + x] = s;
    }
  }
  releaseFloats(tmp);
}

export function outline(buffer, params) {
  const { width: W, height: H } = buffer;
  const src = buffer.data;

  // Luminance field, optionally pre-blurred (detail suppresses fine edges).
  const lum = acquireFloats(W * H);
  if (params.detail > 0) {
    const blurCopy = acquireBuffer(W, H, { zero: false });
    blurCopy.data.set(src);
    gaussianBlur(blurCopy, params.detail);
    const b = blurCopy.data;
    for (let p = 0; p < W * H; p++) {
      const i = p * 4;
      lum[p] = luminance(b[i], b[i + 1], b[i + 2]);
    }
    releaseBuffer(blurCopy);
  } else {
    for (let p = 0; p < W * H; p++) {
      const i = p * 4;
      lum[p] = luminance(src[i], src[i + 1], src[i + 2]);
    }
  }

  // Sobel gradient magnitude → soft-thresholded edge mask.
  // Border pixels are never written below — must start zeroed.
  const mask = acquireFloats(W * H, { zero: true });
  const cutoff = params.threshold * 2.55;
  for (let y = 1; y < H - 1; y++) {
    const row = y * W;
    for (let x = 1; x < W - 1; x++) {
      const i = row + x;
      const gx = -lum[i - W - 1] - 2 * lum[i - 1] - lum[i + W - 1]
               + lum[i - W + 1] + 2 * lum[i + 1] + lum[i + W + 1];
      const gy = -lum[i - W - 1] - 2 * lum[i - W] - lum[i - W + 1]
               + lum[i + W - 1] + 2 * lum[i + W] + lum[i + W + 1];
      const mag = Math.sqrt(gx * gx + gy * gy) * 0.25; // ~0-255
      mask[i] = clamp((mag - cutoff + 16) / 32, 0, 1);
    }
  }
  releaseFloats(lum);

  // Line width via square dilation of the mask.
  const w = Math.round(params.width);
  if (w > 0) {
    const tmp = acquireFloats(W * H);
    for (let y = 0; y < H; y++) slideExtremum(mask, tmp, y * W, W, 1, w, 1);
    for (let x = 0; x < W; x++) slideExtremum(tmp, mask, x, H, W, w, 1);
    releaseFloats(tmp);
  }

  blurGray(mask, W, H, params.softness);

  const [lr, lg, lb] = hexToRgb(params.color);
  const op = params.opacity / 100;
  const light = params.surface === "light";
  const dark = params.surface === "dark";
  for (let p = 0; p < W * H; p++) {
    const m = mask[p] * op;
    if (m <= 0) {
      if (light || dark) {
        const i = p * 4;
        const bg = light ? 255 : 0;
        src[i] = src[i + 1] = src[i + 2] = bg;
      }
      continue;
    }
    const i = p * 4;
    const br = light ? 255 : dark ? 0 : src[i];
    const bg = light ? 255 : dark ? 0 : src[i + 1];
    const bb = light ? 255 : dark ? 0 : src[i + 2];
    src[i] = br + (lr - br) * m;
    src[i + 1] = bg + (lg - bg) * m;
    src[i + 2] = bb + (lb - bb) * m;
  }
  releaseFloats(mask);
  return buffer;
}
