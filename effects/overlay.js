// Overlay effects — generate a same-size RGBA layer procedurally, then
// compositeOver with the effect's blend + opacity. Geometry ported from
// app.js drawEffectBackground / createLinearGradient.
//
// Stops are interpolated in PREMULTIPLIED space, matching CSS gradient
// semantics: transparent→color fades alpha while holding hue.

import { clamp, parseCssColor, compositeOver } from "../color.js";
import { makeBuffer } from "../buffer.js";

/* ---------- stop sampling (premultiplied, CSS semantics) ---------- */

export function sampleStops(stops, t) {
  const sorted = [...stops].sort((a, b) => a[0] - b[0]);
  if (t <= sorted[0][0]) return parseCssColor(sorted[0][1]);
  const last = sorted[sorted.length - 1];
  if (t >= last[0]) return parseCssColor(last[1]);
  let upper = 1;
  while (sorted[upper][0] < t) upper++;
  const [o1, c1] = sorted[upper - 1];
  const [o2, c2] = sorted[upper];
  const [r1, g1, b1, a1] = parseCssColor(c1);
  const [r2, g2, b2, a2] = parseCssColor(c2);
  const f = (t - o1) / (o2 - o1);
  // premultiplied interpolation
  const pa1 = a1 / 255, pa2 = a2 / 255;
  const pr = r1 * pa1 + (r2 * pa2 - r1 * pa1) * f;
  const pg = g1 * pa1 + (g2 * pa2 - g1 * pa1) * f;
  const pb = b1 * pa1 + (b2 * pa2 - b1 * pa1) * f;
  const pa = (pa1 + (pa2 - pa1) * f) * 255;
  if (pa <= 0) return [0, 0, 0, 0];
  return [pr / (pa / 255), pg / (pa / 255), pb / (pa / 255), pa];
}

/* ---------- layer generators ---------- */

export function solidFillLayer(width, height, color) {
  const layer = makeBuffer(width, height);
  const [r, g, b, a] = parseCssColor(color);
  const d = layer.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
  }
  return layer;
}

// Linear gradient along `angle` axis spanning the image diagonal.
// Ported from app.js createLinearGradient: direction (sin a, −cos a),
// length |W·dx| + |H·dy|, centred on the image.
export function linearGradientLayer(width, height, angle, stops) {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const length = Math.abs(width * dx) + Math.abs(height * dy);
  const layer = makeBuffer(width, height);
  const d = layer.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = ((x + 0.5 - width / 2) * dx + (y + 0.5 - height / 2) * dy) / length + 0.5;
      const [r, g, b, a] = sampleStops(stops, t);
      const i = (y * width + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
    }
  }
  return layer;
}

// Radial gradient: unit circle at centre scaled to (W/2, H/2) — elliptical,
// distance 1 at edge midpoints, √2 at corners (clamps to the last stop).
// Ported from the vignette branch of drawEffectBackground.
export function radialGradientLayer(width, height, stops) {
  const layer = makeBuffer(width, height);
  const d = layer.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5 - width / 2) / (width / 2);
      const ny = (y + 0.5 - height / 2) / (height / 2);
      const t = Math.sqrt(nx * nx + ny * ny);
      const [r, g, b, a] = sampleStops(stops, t);
      const i = (y * width + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
    }
  }
  return layer;
}

// 1px lines of `color` every `size` px (y += size, fillRect(0,y,W,1) ported
// as per-row coverage so fractional sizes behave like canvas AA).
export function scanlinesLayer(width, height, size, color) {
  const layer = makeBuffer(width, height);
  const [r, g, b, a] = parseCssColor(color);
  const d = layer.data;
  const s = Math.max(size, 1e-6);
  for (let y = 0; y < height; y++) {
    // coverage of row [y, y+1) by the union of [k·s, k·s+1) line rects
    const coverage = s <= 1 ? 1 : clamp(Math.floor(y / s) * s + 1 - y, 0, 1);
    const alpha = a * coverage;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = alpha;
    }
  }
  return layer;
}

/* ---------- effects ---------- */

export function colorwash(buffer, params) {
  return compositeOver(buffer, solidFillLayer(buffer.width, buffer.height, params.color), params.blend, params.opacity);
}

export function gradient(buffer, params) {
  const layer = linearGradientLayer(buffer.width, buffer.height, params.angle, [[0, params.c1], [1, params.c2]]);
  return compositeOver(buffer, layer, params.blend, params.opacity);
}

export function overlay(buffer, params) {
  const layer = params.kind === "radial"
    ? radialGradientLayer(buffer.width, buffer.height, params.stops)
    : linearGradientLayer(buffer.width, buffer.height, params.angle, params.stops);
  return compositeOver(buffer, layer, params.blend, params.opacity);
}

export function vignette(buffer, params) {
  const stops = [[(100 - params.size) / 100, "transparent"], [1, params.color]];
  return compositeOver(buffer, radialGradientLayer(buffer.width, buffer.height, stops), "multiply", params.opacity);
}

export function scanlines(buffer, params) {
  const layer = scanlinesLayer(buffer.width, buffer.height, params.size, params.color);
  return compositeOver(buffer, layer, params.blend, params.opacity);
}

export function prism(buffer, params) {
  const w = params.width;
  const stops = [
    [0.5 - w / 200, "transparent"],
    [0.5 - w / 600, params.c1],
    [0.5, "#ffffff"],
    [0.5 + w / 600, params.c2],
    [0.5 + w / 200, "transparent"],
  ];
  return compositeOver(buffer, linearGradientLayer(buffer.width, buffer.height, params.angle, stops), "screen", params.opacity);
}
