// Compound effects — expand to primitive sequences at apply time, matching
// the original CSS filter strings exactly.

import { invert, hue, saturate, sepia, contrast, brightness } from "./pointwise.js";

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

// psychedelic = saturate → contrast. The original also animated a hue-rotate
// (params.animate/speed); a static render is the t=0 frame, where
// hue-rotate(0deg) is identity — animation is not rendered.
export function psychedelic(buffer, params) {
  saturate(buffer, { v: params.saturate });
  contrast(buffer, { v: params.contrast });
  return buffer;
}
