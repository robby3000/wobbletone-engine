// Echo — ghosting / frame echoes.
//
// Composites N displaced translucent copies of the source over it —
// farthest (weakest) first, nearest (strongest) last — producing a
// motion-trail / double-exposure look. `direction` aims the trail,
// `distance` spaces echoes, `decay` scales each successive echo's
// opacity, `blur` softens all echoes from a single blurred source
// copy. Blend mode applies per echo with its own opacity. Source
// alpha is preserved. CPU-only.

import { acquireBuffer, releaseBuffer } from "../pool.js";
import { gaussianBlur } from "./blur.js";
import { clamp, blendChannel } from "../color.js";

export function echo(buffer, params) {
  const { width: W, height: H } = buffer;
  const d = buffer.data;
  const count = Math.round(params.count);
  if (count < 1) return buffer;

  const ghost = acquireBuffer(W, H, { zero: false });
  ghost.data.set(d);
  if (params.blur > 0) gaussianBlur(ghost, params.blur);
  const g = ghost.data;

  const rad = (params.direction * Math.PI) / 180;
  const stepX = params.distance * Math.cos(rad);
  const stepY = params.distance * Math.sin(rad);
  const a0 = params.opacity / 100;
  const r = params.decay / 100;
  const mode = params.blend;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      let br = d[o], bg = d[o + 1], bb = d[o + 2];
      for (let k = count; k >= 1; k--) {
        const a = a0 * Math.pow(r, k - 1);
        if (a <= 0) continue;
        // Echo k lands at +k·step — sample the source where it came from.
        const sx = clamp(x - k * stepX, 0, W - 1.001);
        const sy = clamp(y - k * stepY, 0, H - 1.001);
        const x0 = Math.floor(sx), y0 = Math.floor(sy);
        const fx = sx - x0, fy = sy - y0;
        const i00 = (y0 * W + x0) * 4;
        const i10 = i00 + 4;
        const i01 = i00 + W * 4;
        const i11 = i01 + 4;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy, w11 = fx * fy;
        const lr = g[i00] * w00 + g[i10] * w10 + g[i01] * w01 + g[i11] * w11;
        const lg = g[i00 + 1] * w00 + g[i10 + 1] * w10 + g[i01 + 1] * w01 + g[i11 + 1] * w11;
        const lb = g[i00 + 2] * w00 + g[i10 + 2] * w10 + g[i01 + 2] * w01 + g[i11 + 2] * w11;
        if (mode === "normal") {
          br += (lr - br) * a;
          bg += (lg - bg) * a;
          bb += (lb - bb) * a;
        } else {
          br += (blendChannel(mode, br / 255, lr / 255) * 255 - br) * a;
          bg += (blendChannel(mode, bg / 255, lg / 255) * 255 - bg) * a;
          bb += (blendChannel(mode, bb / 255, lb / 255) * 255 - bb) * a;
        }
      }
      d[o] = br; d[o + 1] = bg; d[o + 2] = bb;
    }
  }
  releaseBuffer(ghost);
  return buffer;
}
