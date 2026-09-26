// gl/effects/composite.js — multi-pass composite effects on GPU.
//
// bloom reproduces the CPU pipeline without materializing the copy:
//   fused(brightness,contrast) -> blur(H,V) -> fused(saturate)
//   -> optional tint composite (solid fill, "color" blend)
//   -> compositeOver(backdrop, copy, blend, opacity)
// Same pass count as the CPU's buffer walks, but no pixel traffic leaves
// the GPU between stages.
//
// chromatic: one draw — texelFetch channel-offset reads, lerpByte mix.
//
// dropshadow stays CPU-only (v1): it was dropped from the app catalog;
// specs containing it fall back whole-render.

import { parseCssColor } from "../../color.js";
import { BLEND_INDEX, BLEND_GLSL } from "../blends.js";
import { applyBlurGPU, blurFits } from "./blur.js";
import { buildFusedRun } from "../fusion.js";
import { setUniform } from "../uniforms.js";

// Two-texture compositeOver: out = compositeOver(backdrop, layer, mode, op)
const COMPOSITE_SHADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uBack;
uniform sampler2D uLayer;
uniform int uMode;
uniform float uOpacity;
in vec2 vUv;
out vec4 fragColor;
${BLEND_GLSL}
void main() {
  fragColor = compositeOver(texture(uBack, vUv), texture(uLayer, vUv), uMode, uOpacity);
}`;

const CHROMATIC_SHADER = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform int uOffset;
uniform float uStrength;
uniform int uW;
in vec2 vUv;
out vec4 fragColor;
float lb(float a, float b, float t) { return clamp(floor(a + (b - a) * t + 0.5), 0.0, 255.0); }
void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  vec4 c0 = texelFetch(uSrc, ij, 0);
  vec3 rP = texelFetch(uSrc, ivec2(clamp(ij.x - uOffset, 0, uW - 1), ij.y), 0).rgb;
  vec3 bP = texelFetch(uSrc, ivec2(clamp(ij.x + uOffset, 0, uW - 1), ij.y), 0).rgb;
  fragColor = vec4(
    lb(c0.r * 255.0, rP.r * 255.0, uStrength) / 255.0,
    c0.g,
    lb(c0.b * 255.0, bP.b * 255.0, uStrength) / 255.0,
    c0.a);
}`;

function drawProgram(inf, prog, from, to) {
  const gl = inf.session.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
  gl.viewport(0, 0, to.w, to.h);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, from.tex);
  gl.uniform1i(gl.getUniformLocation(prog, "uSrc"), 0);
  gl.bindVertexArray(inf.programs.quad().vao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
}

// One fused pixel-local stage: defs = [{type, params}] using real
// registry types (brightness/contrast/saturate…). prep = preparePixel.
function fusedStage(inf, from, defs, prep) {
  const { src, uniforms } = buildFusedRun(defs, prep);
  const prog = inf.programs.get(src, "bloom-stage");
  if (!prog) return null;
  const dst = inf.pool.acquire(from.w, from.h);
  const gl = inf.session.gl;
  gl.useProgram(prog);
  for (const u of uniforms) setUniform(gl, prog, u);
  drawProgram(inf, prog, from, dst);
  if (gl.isContextLost()) { inf.pool.release(dst); return null; }
  return dst;
}

// Composite `layer` over `base` into a fresh handle (caller releases).
function compositeTextures(inf, base, layer, mode, opacity) {
  const gl = inf.session.gl;
  const prog = inf.programs.get(COMPOSITE_SHADER, "composite");
  if (!prog) return null;
  const dst = inf.pool.acquire(base.w, base.h);
  gl.useProgram(prog);
  setUniform(gl, prog, { name: "uMode", type: "int", value: BLEND_INDEX[mode] ?? 0 });
  setUniform(gl, prog, { name: "uOpacity", type: "float", value: opacity / 100 });
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.viewport(0, 0, dst.w, dst.h);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, base.tex);
  gl.uniform1i(gl.getUniformLocation(prog, "uBack"), 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, layer.tex);
  gl.uniform1i(gl.getUniformLocation(prog, "uLayer"), 1);
  gl.bindVertexArray(inf.programs.quad().vao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
  gl.activeTexture(gl.TEXTURE0);
  if (gl.isContextLost()) { inf.pool.release(dst); return null; }
  return dst;
}

// bloom = fused(brightness,contrast) → blur → fused(saturate)
//         → [tint: compositeOver(copy, solidColor, "color", tint)]
//         → compositeOver(backdrop, copy, blend, opacity)
// Returns the finished handle (caller releases); null on any failure.
export function applyBloomGPU(inf, srcH, params, prep, maxUniforms) {
  if (!blurFits(params.blur, maxUniforms)) return null;
  const held = [];
  let passes = 0;
  const track = (h) => { held.push(h); return h; };
  try {
    // stage 1: brightness→contrast on a copy of the source
    let copy = track(fusedStage(inf, srcH, [
      { type: "brightness", params: { v: params.threshold } },
      { type: "contrast", params: { v: params.contrast } },
    ], prep));
    if (!copy) return null;
    passes++;
    // stage 2: blur (identity when <=0 — CPU skips too)
    if (params.blur > 0) {
      const blurred = track(applyBlurGPU(inf, copy, params.blur, maxUniforms));
      if (!blurred) return null;
      copy = blurred;
      passes += 2;
    }
    // stage 3: saturate
    const sat = track(fusedStage(inf, copy, [{ type: "saturate", params: { v: params.saturate } }], prep));
    if (!sat) return null;
    copy = sat;
    passes++;
    // stage 4: optional tint — solid color fill composited at "color" blend
    if (params.tint > 0) {
      const fill = track(solidFillUniformLayer(inf, srcH, params.color));
      if (!fill) return null;
      const tinted = track(compositeTextures(inf, copy, fill, "color", params.tint));
      if (!tinted) return null;
      copy = tinted;
      passes += 2; // fill clear + composite draw
    }
    // stage 5: composite the copy over the live image
    const out = compositeTextures(inf, srcH, copy, params.blend, params.opacity);
    if (!out) return null;
    return { dst: out, passes: passes + 1 }; // caller owns/releases out
  } finally {
    for (const h of held) if (h) inf.pool.release(h);
  }
}

// The CPU tints via solidFillLayer+compositeOver — same thing: a
// zero-work "layer" that is the constant color everywhere.
function solidFillUniformLayer(inf, srcH, color) {
  // reuse the overlay shader in solid mode against a 1×1 dummy? No —
  // cheaper: render the solid color through the passthrough shape.
  // Simplest correct path: a tiny dedicated constant-color target.
  const gl = inf.session.gl;
  const hnd = inf.pool.acquire(srcH.w, srcH.h);
  const [r, g, b, a] = parseCssColor(color);
  gl.bindFramebuffer(gl.FRAMEBUFFER, hnd.fbo);
  gl.viewport(0, 0, hnd.w, hnd.h);
  gl.clearColor(r / 255, g / 255, b / 255, a / 255);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return gl.isContextLost() ? (inf.pool.release(hnd), null) : hnd;
}

export function applyChromaticGPU(inf, srcH, params) {
  const gl = inf.session.gl;
  const prog = inf.programs.get(CHROMATIC_SHADER, "chromatic");
  if (!prog) return null;
  const dst = inf.pool.acquire(srcH.w, srcH.h);
  gl.useProgram(prog);
  setUniform(gl, prog, { name: "uOffset", type: "int", value: Math.round(params.offset) });
  setUniform(gl, prog, { name: "uStrength", type: "float", value: params.strength / 100 });
  setUniform(gl, prog, { name: "uW", type: "int", value: srcH.w });
  drawProgram(inf, prog, srcH, dst);
  if (gl.isContextLost()) { inf.pool.release(dst); return null; }
  return dst;
}
