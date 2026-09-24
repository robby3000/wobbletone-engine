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
