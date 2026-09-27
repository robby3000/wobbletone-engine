// Specular — heightfield lighting ("relief catching a directional light").
//
// height = luminance (default) or alpha, optionally softened by bumpBlur;
// normals come from central differences scaled by surfaceScale. A distant
// light (azimuth + elevation) with a top-down view gives the halfway
// vector H; the specular term is
//   pow(max(n·H,0), shininess) - pow(H.z, shininess)
// subtracting the flat-field response so featureless surfaces get zero
// highlight and only slopes facing the light sheen. The result is a
// color-tinted highlight layer composited via blend + opacity.
//
// Resolution model: bumpBlur is px-flagged (arrives scaled). The normal
// field is a per-pixel derivative — finer detail appears at higher res,
// same as blur. surfaceScale is dimensionless slope exaggeration.

import { clamp, luminance, rgb01, compositeOver } from "../color.js";
import { gaussianBlur } from "./blur.js";
import { acquireBuffer, releaseBuffer, acquireFloats, releaseFloats } from "../pool.js";

export function specular(buffer, params) {
  const { width: W, height: H } = buffer;
  const d = buffer.data;

  // Heightmap: luminance or alpha, normalised to [0,1].
  const fromAlpha = params.source === "alpha";
  let height = acquireFloats(W * H);
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    height[p] = fromAlpha ? d[i + 3] / 255 : luminance(d[i], d[i + 1], d[i + 2]) / 255;
  }

  // Optional bumpBlur: round-trip the field through a real buffer blur so
  // the smoothing matches the blur effect exactly.
  if (params.bumpBlur > 0) {
    const hb = acquireBuffer(W, H, { zero: false });
    for (let p = 0; p < W * H; p++) {
      const v = height[p] * 255;
      const i = p * 4;
      hb.data[i] = v; hb.data[i + 1] = v; hb.data[i + 2] = v; hb.data[i + 3] = 255;
    }
    gaussianBlur(hb, params.bumpBlur);
    for (let p = 0; p < W * H; p++) height[p] = hb.data[p * 4] / 255;
    releaseBuffer(hb);
  }

  // Distant light + top-down view → halfway vector.
  const az = (params.azimuth * Math.PI) / 180;
  const el = (params.elevation * Math.PI) / 180;
  const lx = Math.cos(el) * Math.cos(az);
  const ly = Math.cos(el) * Math.sin(az);
  const lz = Math.sin(el);
  // H = normalize(L + V), V = (0,0,1)
  const hx = lx, hy = ly, hz = lz + 1;
  const hLen = Math.hypot(hx, hy, hz) || 1;
  const HX = hx / hLen, HY = hy / hLen, HZ = hz / hLen;
  const flat = Math.pow(HZ, params.shininess); // flat-field response to subtract

  const strength = params.strength / 100;
  const k = params.surfaceScale;
  const [cr, cg, cb] = rgb01(params.color);

  // Highlight layer: colour = tint, alpha = specular coverage.
  const layer = acquireBuffer(W, H, { zero: false });
  const l = layer.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const xm = x > 0 ? x - 1 : 0, xp = x + 1 < W ? x + 1 : W - 1;
      const ym = y > 0 ? y - 1 : 0, yp = y + 1 < H ? y + 1 : H - 1;
      const dzdx = (height[y * W + xp] - height[y * W + xm]) * k;
      const dzdy = (height[yp * W + x] - height[ym * W + x]) * k;
      // n = normalize(-dzdx, -dzdy, 1)
      const nLen = Math.hypot(dzdx, dzdy, 1);
      const ndh = (-dzdx * HX + -dzdy * HY + HZ) / nLen;
      const s = Math.max(0, Math.pow(Math.max(ndh, 0), params.shininess) - flat) * strength;
      const o = (y * W + x) * 4;
      l[o] = cr * 255;
      l[o + 1] = cg * 255;
      l[o + 2] = cb * 255;
      l[o + 3] = clamp(s * 255, 0, 255);
    }
  }
  releaseFloats(height);
  compositeOver(buffer, layer, params.blend, params.opacity);
  releaseBuffer(layer);
  return buffer;
}
