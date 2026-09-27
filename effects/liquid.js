// Liquid — "image seen through water / melted glass".
//
// A seeded multi-octave value-noise displacement field nudges every
// pixel's sample position; the source is resampled bilinearly at
// (x+dx, y+dy). The field reuses the grain lattice hash (grainValueXY)
// so no new RNG exists — same seed → identical field → identical output.
//
// Resolution model: waveX/waveY are cell COUNTS across the image, so the
// feature scale follows the buffer dims automatically. Displacement
// amplitude is expressed in source-image pixels — intensity isn't a px
// param (it's a 0-100 slider), so it's scaled by ctx.renderScale at
// apply time, matching how glitch scales its derived displacement.
// softness is px-flagged and arrives already scaled.
//
// Alpha: all four channels are resampled with the same bilinear weights
// — the straight-alpha equivalent of how blur treats alpha. mix lerps
// every channel back toward the original.

import { clamp } from "../color.js";
import { grainValueXY } from "./grain.js";
import { gaussianBlur } from "./blur.js";
import { acquireBuffer, releaseBuffer, acquireFloats, releaseFloats } from "../pool.js";

// Peak displacement in source-image px at intensity=100.
const MAX_DISPLACEMENT_PX = 40;

// flow presets → how the field maps to displacement.
//   horizontal: slide along X, varying with Y (heat-haze bands)
//   vertical:   slide along Y, varying with X
//   diagonal:   shared field drives both axes equally
//   radial:     displacement radiates from image centre
//   organic:    independent X/Y fields — free-form melt (default)
export function liquid(buffer, params, ctx = {}) {
  const { width: W, height: H } = buffer;
  const renderScale = ctx.renderScale || 1;
  const amp = (params.intensity / 100) * MAX_DISPLACEMENT_PX * renderScale;
  if (amp <= 0) return buffer; // intensity 0 → identity

  // Base cell size in render px: waveX/waveY are 0-100, mapped to
  // 2..32 cells across the respective dimension.
  const cx0 = W / (2 + (params.waveX / 100) * 30);
  const cy0 = H / (2 + (params.waveY / 100) * 30);
  const octaves = Math.round(params.octaves);
  const turbulence = params.noise === "turbulence";

  const noiseAt = (seedOff, x, y) => {
    let v = 0, a = 1, tot = 0, cx = cx0, cy = cy0;
    for (let o = 0; o < octaves; o++) {
      v += grainValueXY(params.seed + seedOff + o * 101, x, y, cx, cy) * a;
      tot += a;
      a *= 0.5;
      cx *= 0.5;
      cy *= 0.5;
    }
    v /= tot;
    return turbulence ? Math.abs(v * 2 - 1) : v; // ~[0,1]
  };

  const src = acquireBuffer(W, H, { zero: false });
  src.data.set(buffer.data);
  const s = src.data;
  const d = buffer.data;
  // Primary field is retained for the highlight pass (sheen reads the
  // field's gradient — the noise acts as a heightmap).
  const field = acquireFloats(W * H);
  const midX = W / 2, midY = H / 2;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n1 = noiseAt(0, x + 0.5, y + 0.5);
      field[y * W + x] = n1;
      const m = (n1 - 0.5) * 2 * amp;
      let dx, dy;
      switch (params.flow) {
        case "horizontal": dx = m; dy = 0; break;
        case "vertical":   dx = 0; dy = m; break;
        case "diagonal":   dx = m * 0.7071; dy = m * 0.7071; break;
        case "radial": {
          const vx = x - midX, vy = y - midY;
          const len = Math.hypot(vx, vy) || 1;
          dx = (vx / len) * m; dy = (vy / len) * m;
          break;
        }
        default: // organic — second field for Y
          dx = m;
          dy = (noiseAt(37, x + 0.5, y + 0.5) - 0.5) * 2 * amp;
      }

      // Bilinear resample of the source at the displaced position.
      const sx = clamp(x + dx, 0, W - 1.001);
      const sy = clamp(y + dy, 0, H - 1.001);
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * W + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + W * 4;
      const i11 = i01 + 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy, w11 = fx * fy;
      const o = (y * W + x) * 4;
      for (let c = 0; c < 4; c++) {
        d[o + c] = s[i00 + c] * w00 + s[i10 + c] * w10 + s[i01 + c] * w01 + s[i11 + c] * w11;
      }
    }
  }

  // Wet highlight: directional slope of the field brightens like light
  // catching the surface of the displacement (light from upper-left).
  if (params.highlight > 0) {
    const k = (params.highlight / 100) * 128;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        const gx = x + 1 < W ? field[p] - field[p + 1] : 0;
        const gy = y + 1 < H ? field[p] - field[p + W] : 0;
        const sheen = Math.max(0, (gx + gy) * 2) * k;
        if (sheen > 0) {
          const o = p * 4;
          d[o] += sheen;
          d[o + 1] += sheen;
          d[o + 2] += sheen;
        }
      }
    }
  }
  releaseFloats(field);

  if (params.softness > 0) gaussianBlur(buffer, params.softness);

  // mix — lerp every channel back toward the undistorted source.
  if (params.mix > 0) {
    const m = params.mix / 100;
    for (let i = 0; i < d.length; i++) d[i] = d[i] * (1 - m) + s[i] * m;
  }
  releaseBuffer(src);
  return buffer;
}
