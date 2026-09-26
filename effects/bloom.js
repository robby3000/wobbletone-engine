// Bloom — multi-buffer composite reproducing the old `useImage` overlay
// without DOM cloning or ctx.filter:
//   (1) copy the source; apply brightness(threshold%) → contrast(contrast%)
//       → gaussian blur(blur px) → saturate(saturate%) to the copy using the
//       engine's own primitives (same order as the old imgFilter string);
//   (2) if tint > 0, composite a solid `color` fill over the copy with the
//       `color` blend at tint% (old bgBlend);
//   (3) composite the copy over the source with blend (screen|lighten) at
//       opacity%.
// params.blur is px-flagged → arrives already scaled to render px.

import { acquireBuffer, releaseBuffer } from "../pool.js";
import { compositeOver } from "../color.js";
import { brightness, contrast, saturate } from "./pointwise.js";
import { gaussianBlur } from "./blur.js";
import { solidFillLayer } from "./overlay.js";

export function bloom(buffer, params) {
  const copy = acquireBuffer(buffer.width, buffer.height, { zero: false });
  copy.data.set(buffer.data);
  brightness(copy, { v: params.threshold });
  contrast(copy, { v: params.contrast });
  gaussianBlur(copy, params.blur);
  saturate(copy, { v: params.saturate });
  if (params.tint > 0) {
    const tint = solidFillLayer(copy.width, copy.height, params.color);
    compositeOver(copy, tint, "color", params.tint);
    releaseBuffer(tint);
  }
  compositeOver(buffer, copy, params.blend, params.opacity);
  releaseBuffer(copy);
  return buffer;
}
