// Compound effects — expand to primitive sequences at apply time, matching
// the original CSS filter strings exactly.

import { invert, hue, saturate, sepia, contrast, brightness } from "./pointwise.js";
import { solarize, hueband } from "./tone.js";

// infrared(i) = invert(i·100%) + hue-rotate(180·i°) + saturate(120+80·i%)
export function infrared(buffer, params) {
  const i = (params.intensity ?? 0) / 100;
  invert(buffer, { v: i * 100 });
  hue(buffer, { v: 180 * i });
  saturate(buffer, { v: 120 + 80 * i });
  return buffer;
}

// vintage = sepia → contrast → saturate → brightness
export function vintage(buffer, params) {
  sepia(buffer, { v: params.sepia });
  contrast(buffer, { v: params.contrast });
  saturate(buffer, { v: params.saturate });
  brightness(buffer, { v: params.brightness });
  return buffer;
}

// psychedelic = saturate → contrast → solarize → hueband.
// The original animated a hue-rotate (old params.animate/speed — dropped;
// static renders and exports can never animate). The solarize + hueband
// pair now supplies the weirdness in the static frame. bands < 2 or
// solarize = 0 disables that stage.
export function psychedelic(buffer, params) {
  saturate(buffer, { v: params.saturate });
  contrast(buffer, { v: params.contrast });
  if (params.solarize > 0) solarize(buffer, { amount: params.solarize, threshold: 50 });
  if (params.bands >= 2) hueband(buffer, { bands: Math.round(params.bands), spread: 0 });
  return buffer;
}

/* ---------- spec-level expansion ----------
// The functions above stay as the readable imperative reference (and the
// compound.test.js equivalence target). render.js splices the spec-level
// expansions below into the effect list before dispatch — the expanded
// primitives then fuse into a single pixel pass with their neighbours,
// and G7's GPU planner consumes the same expansion. */

export function expandInfrared(params) {
  const i = (params.intensity ?? 0) / 100;
  return [
    { type: "invert", params: { v: i * 100 } },
    { type: "hue", params: { v: 180 * i } },
    { type: "saturate", params: { v: 120 + 80 * i } },
  ];
}

export function expandVintage(params) {
  return [
    { type: "sepia", params: { v: params.sepia } },
    { type: "contrast", params: { v: params.contrast } },
    { type: "saturate", params: { v: params.saturate } },
    { type: "brightness", params: { v: params.brightness } },
  ];
}

export function expandPsychedelic(params) {
  const fx = [
    { type: "saturate", params: { v: params.saturate } },
    { type: "contrast", params: { v: params.contrast } },
  ];
  if (params.solarize > 0) fx.push({ type: "solarize", params: { amount: params.solarize, threshold: 50 } });
  if (params.bands >= 2) fx.push({ type: "hueband", params: { bands: Math.round(params.bands), spread: 0 } });
  return fx;
}
