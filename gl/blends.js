// gl/blends.js — W3C Compositing & Blending as GLSL.
//
// Ported line-for-line from color.js (the semantic reference — nothing
// here is re-derived). Modes are addressed by integer index matching
// BLEND_MODES order in color.js; callers pass the index as a uniform.
// All math on 0–1 straight-alpha vec4s, matching texture()/RGBA8
// sampling. Division guards mirror the CPU's ===0/===1 checks — byte
// 0/255 map to exactly 0.0/1.0 in unorm, so float equality is exact.
//
// CPU-side index lookup:
//   BLEND_INDEX[mode] -> int for the uMode uniform.

import { BLEND_MODES } from "../color.js";

export const BLEND_INDEX = Object.freeze(
  Object.fromEntries(BLEND_MODES.map((m, i) => [m, i]))
);

export const BLEND_GLSL = /* glsl */ `
float _wLum(vec3 c) { return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b; }
float _wSat(vec3 c) { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }

float _wSoftLightD(float x) {
  return x <= 0.25 ? ((16.0 * x - 12.0) * x + 4.0) * x : sqrt(x);
}

// Separable modes only — B(Cb, Cs) per channel.
float blendChannel(int mode, float cb, float cs) {
  if (mode == 0) return cs;                                   // normal
  if (mode == 1) return cb * cs;                              // multiply
  if (mode == 2) return cb + cs - cb * cs;                    // screen
  if (mode == 3) return cb <= 0.5 ? 2.0 * cb * cs : 1.0 - 2.0 * (1.0 - cb) * (1.0 - cs); // overlay
  if (mode == 4) return min(cb, cs);                          // darken
  if (mode == 5) return max(cb, cs);                          // lighten
  if (mode == 6) return cs >= 1.0 ? 1.0 : min(1.0, cb / (1.0 - cs));   // color-dodge
  if (mode == 7) return cs <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - cb) / cs); // color-burn
  if (mode == 8) return cs <= 0.5 ? cb * 2.0 * cs : 1.0 - 2.0 * (1.0 - cb) * (1.0 - cs); // hard-light
  if (mode == 9) return cs <= 0.5                             // soft-light
    ? cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb)
    : cb + (2.0 * cs - 1.0) * (_wSoftLightD(cb) - cb);
  if (mode == 10) return abs(cb - cs);                        // difference
  if (mode == 11) return cb + cs - 2.0 * cb * cs;             // exclusion
  return cs; // unreachable for separable calls
}

// Non-separable helpers (spec's Lum/Sat/SetLum/SetSat/ClipColor).
vec3 clipColorG(vec3 c) {
  float l = _wLum(c);
  float n = min(c.r, min(c.g, c.b));
  float x = max(c.r, max(c.g, c.b));
  if (n < 0.0) c = l + (c - l) * l / (l - n);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / (x - l);
  return c;
}

vec3 setLumG(vec3 c, float l) {
  return clipColorG(c + (l - _wLum(c)));
}

// Faithful port of color.js setSat: channel equal to min -> 0, equal to
// max -> s, the remaining -> scaled mid. Ties resolve identically
// because a tied channel is either "the min" or "the max" on both sides.
vec3 setSatG(vec3 c, float s) {
  float cmin = min(c.r, min(c.g, c.b));
  float cmax = max(c.r, max(c.g, c.b));
  if (cmax <= cmin) return vec3(0.0);
  float cmid = c.r + c.g + c.b - cmin - cmax;
  float newMid = (cmid - cmin) * s / (cmax - cmin);
  vec3 o;
  o.r = c.r == cmin ? 0.0 : (c.r == cmax ? s : newMid);
  o.g = c.g == cmin ? 0.0 : (c.g == cmax ? s : newMid);
  o.b = c.b == cmin ? 0.0 : (c.b == cmax ? s : newMid);
  return o;
}

vec3 blendColor(int mode, vec3 cb, vec3 cs) {
  if (mode == 12) return setLumG(setSatG(cs, _wSat(cb)), _wLum(cb));  // hue
  if (mode == 13) return setLumG(setSatG(cb, _wSat(cs)), _wLum(cb));  // saturation
  if (mode == 14) return setLumG(cs, _wLum(cb));                      // color
  if (mode == 15) return setLumG(cb, _wLum(cs));                      // luminosity
  return vec3(
    blendChannel(mode, cb.r, cs.r),
    blendChannel(mode, cb.g, cs.g),
    blendChannel(mode, cb.b, cs.b));
}

// W3C blended source-over on straight alpha — the compositeOver port.
// cb4/cs4 in 0–1 straight alpha; returns the same shape.
vec4 compositeOver(vec4 cb4, vec4 cs4, int mode, float opacity) {
  float ab = cb4.a;
  float as = cs4.a * opacity;
  float ao = as + ab * (1.0 - as);
  if (ao <= 0.0) return vec4(0.0);
  vec3 blended = blendColor(mode, cb4.rgb, cs4.rgb);
  vec3 csPrime = (1.0 - ab) * cs4.rgb + ab * blended;
  vec3 co = (as * csPrime + ab * (1.0 - as) * cb4.rgb) / ao;
  return vec4(co, ao);
}
`;
