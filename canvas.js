// canvas.js — browser-only I/O adapter between DOM image/canvas sources and
// engine buffers. Per §11 of the architecture doc this file owns NO effect
// semantics: canvas is used strictly for pixel I/O (drawImage + getImageData
// in, putImageData out). All rendering semantics live in render.js/effects.
// Nothing here is imported by the Node test suite beyond the DOM guard and
// version check.

import { ENGINE_VERSION } from "./version.js";
import { renderBuffer } from "./render.js";

function requireDOM() {
  if (typeof document === "undefined") {
    throw new Error("wobbletone-engine/canvas.js requires a browser DOM");
  }
}

// Lets a host assert the mounted engine before rendering — accepts an exact
// version ("1.0.0") or a major ("1" / 1).
export function checkEngineVersion(expected) {
  if (String(expected) === ENGINE_VERSION) return true;
  return ENGINE_VERSION.split(".")[0] === String(expected).split(".")[0];
}

// canvas → engine buffer (straight-alpha RGBA).
export function canvasToBuffer(canvas) {
  requireDOM();
  const { width, height } = canvas;
  const imageData = canvas.getContext("2d").getImageData(0, 0, width, height);
  return { data: imageData.data, width, height };
}

// engine buffer → canvas via putImageData.
export function bufferToCanvas(buffer) {
  requireDOM();
  const canvas = document.createElement("canvas");
  canvas.width = buffer.width;
  canvas.height = buffer.height;
  canvas.getContext("2d").putImageData(new ImageData(buffer.data, buffer.width, buffer.height), 0, 0);
  return canvas;
}

// Module-level scratch canvas for drawToBuffer — resized (which clears it)
// only when dimensions change. bufferToCanvas's output is NOT pooled: the
// returned element is retained by callers (preview canvas, preset thumbs).
let _scratch = null;
function scratchCanvas(w, h) {
  if (!_scratch) _scratch = document.createElement("canvas");
  if (_scratch.width !== w || _scratch.height !== h) {
    _scratch.width = w;
    _scratch.height = h;
  }
  return _scratch;
}

// Draw an image source to a scratch canvas at (w × h) and read the pixels.
export function drawToBuffer(source, width, height) {
  requireDOM();
  const canvas = scratchCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, width, height);
  return canvasToBuffer(canvas);
}

export function loadImage(src) {
  requireDOM();
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`loadImage failed: ${src}`));
    img.src = src;
  });
}

// Render a spec against an image source → canvas at min(native, maxDim-capped)
// resolution. options.sourceWidth/sourceHeight override the source's own
// dimensions when the caller knows them better (e.g. EXIF-rotated inputs).
export function renderToCanvas(imageOrBitmap, spec, options = {}) {
  requireDOM();
  const srcW = options.sourceWidth ?? imageOrBitmap.naturalWidth ?? imageOrBitmap.width;
  const srcH = options.sourceHeight ?? imageOrBitmap.naturalHeight ?? imageOrBitmap.height;
  const scale = options.maxDim ? Math.min(1, options.maxDim / Math.max(srcW, srcH)) : 1;
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const renderOpts = { sourceWidth: srcW, collectStats: options.collectStats };
  const rendered = renderBuffer(drawToBuffer(imageOrBitmap, w, h), spec, renderOpts);
  if (options.collectStats) options.stats = renderOpts.stats;
  return bufferToCanvas(rendered);
}
