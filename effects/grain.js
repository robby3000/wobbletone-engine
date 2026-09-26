// Film grain — deterministic seeded lattice (value) noise.
//
// Resolution model: params.size is px-flagged, so it arrives already scaled
// to render pixels. The grain cell edge is
//   cellPx_render = size × (200/180)          (legacy 180-sample tile over 200px)
// and the lattice is indexed by floor(x_render / cellPx_render), so the same
// cell lands on the same image content at any render resolution.
//
// A cell's value is hashToUnit(seed, i, j): integer mixing of (seed, i, j)
// feeding one mulberry32 step. Bilinear interpolation between cell corners
// gives the softened-grain look. The field is composited as a gray layer
// with the effect's blend + opacity.

import { seededRandom } from "../rng.js";
import { compositeOver } from "../color.js";
import { acquireBuffer, releaseBuffer } from "../pool.js";

export const GRAIN_CELL_SCALE = 200 / 180;

export function grainCell(seed, i, j) {
  let h = seed >>> 0;
  h = Math.imul(h ^ (i | 0), 0x9e3779b1);
  h = Math.imul(h ^ (j | 0), 0x85ebca77);
  h ^= h >>> 13;
  return seededRandom(h)();
}

// Bilinear value-noise sample at render pixel (x, y) — pass pixel centres.
export function grainValue(seed, x, y, cellPx) {
  const gx = x / cellPx;
  const gy = y / cellPx;
  const i = Math.floor(gx);
  const j = Math.floor(gy);
  const fx = gx - i;
  const fy = gy - j;
  const v00 = grainCell(seed, i, j);
  const v10 = grainCell(seed, i + 1, j);
  const v01 = grainCell(seed, i, j + 1);
  const v11 = grainCell(seed, i + 1, j + 1);
  return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
}

export function grain(buffer, params) {
  const cellPx = Math.max(params.size * GRAIN_CELL_SCALE, 1e-6);
  const { width, height } = buffer;
  const layer = acquireBuffer(width, height, { zero: false }); // every pixel written below
  const d = layer.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.round(grainValue(params.seed, x + 0.5, y + 0.5, cellPx) * 255);
      const i = (y * width + x) * 4;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  compositeOver(buffer, layer, params.blend, params.opacity);
  releaseBuffer(layer);
  return buffer;
}
