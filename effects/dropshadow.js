// Drop shadow — CSS drop-shadow(x y blur color) without ctx.filter:
//   extract source alpha → gaussian-blur the silhouette → fill with `color`
//   → offset by (x, y) → composite the SOURCE over the shadow layer.
// Same dimensions, shadow clipped at the buffer edges (matches the CSS
// version, which also clips at the element box). Blur before offset —
// translation commutes with convolution.
// params.x/y/blur are px-flagged → arrive already scaled to render px.

import { parseCssColor, compositeOver } from "../color.js";
import { acquireBuffer, releaseBuffer } from "../pool.js";
import { gaussianBlur } from "./blur.js";

export function dropshadow(buffer, params) {
  const { width, height } = buffer;
  const [r, g, b, ca] = parseCssColor(params.color);

  const silhouette = acquireBuffer(width, height); // zeroed — only alpha is written below
  for (let i = 0; i < silhouette.data.length; i += 4) {
    silhouette.data[i + 3] = buffer.data[i + 3];
  }
  gaussianBlur(silhouette, params.blur);

  const dx = Math.round(params.x);
  const dy = Math.round(params.y);
  const under = acquireBuffer(width, height); // zeroed — sparse writes below
  const ud = under.data;
  const ad = silhouette.data;
  const alphaScale = ca / 255;
  for (let y = 0; y < height; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= height) continue;
    for (let x = 0; x < width; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= width) continue;
      const a = ad[(sy * width + sx) * 4 + 3] * alphaScale;
      if (a <= 0) continue;
      const i = (y * width + x) * 4;
      ud[i] = r;
      ud[i + 1] = g;
      ud[i + 2] = b;
      ud[i + 3] = a;
    }
  }

  compositeOver(under, buffer, "normal", 100);
  buffer.data.set(under.data);
  releaseBuffer(silhouette);
  releaseBuffer(under);
  return buffer;
}
