// gl/index.js — renderer selection + public GPU API surface.
//
// pickRenderer decides CPU vs WebGL2 from capability bits + caller
// preference. "auto" requires the full bar: real WebGL2, highp fragment
// float, a hardware rasterizer, and enough texture size for the render.
// Selection is per render — maxTextureSize is compared against actual
// dims each time (wobbletonefx sources are full-res).

import { detectCapabilities } from "./context.js";

export { detectCapabilities };

// options.renderer: "cpu" | "webgl2" | "auto"  (default "cpu" until G10)
// options.width/height: render dims for the texture-size check.
// Returns { renderer, reason } — reason feeds stats.fallbackReason when
// the caller asked for/auto-resolved to GPU but cannot have it.
export function pickRenderer(options = {}, caps = detectCapabilities()) {
  const pref = options.renderer || "cpu";

  if (pref === "cpu") return { renderer: "cpu", reason: null };

  const reason = gpuUnavailableReason(caps, options);
  if (reason) return { renderer: "cpu", reason };

  if (pref === "webgl2" || pref === "auto") return { renderer: "webgl2", reason: null };
  return { renderer: "cpu", reason: `bad-renderer-option:${pref}` };
}

function gpuUnavailableReason(caps, options) {
  if (!caps.webgl2) return "no-webgl2";
  if (!caps.highpFloat) return "no-highp-float";
  if (caps.software) return "software-rasterizer";
  if (options.width && options.width > caps.maxTextureSize) return "texture-size";
  if (options.height && options.height > caps.maxTextureSize) return "texture-size";
  return null;
}
