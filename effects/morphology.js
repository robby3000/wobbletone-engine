// Morphology — rectangular dilate (max) / erode (min) filter over RGBA.
//
// op=dilate grows bright regions (blooming highlights, thickened bright
// features); op=erode grows dark regions (etched, lith-printed feel).
// Separable passes: horizontal then vertical, each a sliding-window
// extremum via monotonic deque — O(W) per row/column regardless of
// radius, so large radii stay cheap. radiusX/radiusY are px-flagged;
// edge handling clamps indices (edge values extend), matching blur.

import { acquireBuffer, releaseBuffer } from "../pool.js";

// Sliding-window extremum along one row of `n` samples spaced `stride`,
// writing dst at the same offsets. rx = window half-size, dir = +1 max,
// -1 min. Monotone deque of indices keeps the front at the extremum.
function slideExtremum(src, dst, base, n, stride, rx, dir) {
  if (rx <= 0) {
    for (let x = 0; x < n; x++) dst[base + x * stride] = src[base + x * stride];
    return;
  }
  const deque = []; // source indices; front is the current window's extremum
  let head = 0;
  let pushed = -1;
  for (let x = 0; x < n; x++) {
    // Window is [x-rx, x+rx] clamped to [0, n-1]. Push each index once.
    const hi = Math.min(n - 1, x + rx);
    while (pushed < hi) {
      pushed++;
      while (deque.length > head &&
             dir * src[base + deque[deque.length - 1] * stride] <= dir * src[base + pushed * stride]) {
        deque.pop();
      }
      deque.push(pushed);
    }
    while (deque[head] < x - rx) head++;
    dst[base + x * stride] = src[base + deque[head] * stride];
  }
}

export function morphology(buffer, params) {
  const { width: W, height: H } = buffer;
  const rx = Math.round(params.radiusX);
  const ry = Math.round(params.radiusY);
  if (rx <= 0 && ry <= 0) return buffer;
  const dir = params.op === "erode" ? -1 : 1;
  const channels = [0, 1, 2, 3];
  const d = buffer.data;

  const tmp = acquireBuffer(W, H, { zero: false });
  const t = tmp.data;

  for (const c of channels) {
    // Horizontal pass: src → tmp.
    for (let y = 0; y < H; y++) {
      slideExtremum(d, t, (y * W) * 4 + c, W, 4, rx, dir);
    }
    // Vertical pass: tmp → src.
    for (let x = 0; x < W; x++) {
      slideExtremum(t, d, x * 4 + c, H, W * 4, ry, dir);
    }
  }
  releaseBuffer(tmp);
  return buffer;
}
