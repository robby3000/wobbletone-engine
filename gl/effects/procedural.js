// gl/effects/procedural.js — grain + glitch on the GPU.
//
// grain: the lattice hash is pure uint32 math — GLSL uint ops reproduce
// it BIT-EXACTLY (JS Math.imul low-32 bits == uint wraparound; >>> == >>;
// the JS + in the rng chain overflows via double but keeps the same low
// 32 bits as uint add). Float bilinear between cell corners is the only
// fp32-vs-fp64 divergence — bounded by the grain tolerance.
//
// glitch: the band table is sequential-RNG (band heights accumulate), so
// it is built ONCE on the CPU by the exact buildGlitchBands() and shipped
// as packed vec4 uniforms (3 per band). Per-row jitter is a per-row
// seeded RNG — parallelizable via the same mulberry32 port. Sampling
// uses texelFetch with integer texel coords — no uv arithmetic, so the
// displacement reads are the exact texels the CPU copies.
//
// Band table budget: uBands = vec4[MAX_BANDS*3]. Weak GPUs with tiny
// uniform budgets get gated by bandUniformLimit() -> CPU fallback.

import { buildGlitchBands } from "../../effects/glitch.js";
import { BLEND_INDEX, BLEND_GLSL } from "../blends.js";
import { HELPERS } from "../fusion.js";
import { detectCapabilities } from "../context.js";
import { setUniform } from "../uniforms.js";

export const GLITCH_MAX_BANDS = 64;

// mulberry32 in uint32 — bit-exact with rng.js seededRandom(seed)().
const RNG_GLSL = /* glsl */ `
float mulberry32(uint v) {
  v += 0x6D2B79F5u;
  uint r = v;
  r = (r ^ (r >> 15u)) * (r | 1u);
  r ^= r + ((r ^ (r >> 7u)) * (r | 61u));
  return float(r ^ (r >> 14u)) / 4294967296.0;
}
`;

/* ---------------- grain ---------------- */

export const GRAIN_SHADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSrc;
uniform vec2 uDims;
uniform uint uSeed;
uniform float uCellPx;
uniform int uMode;
uniform float uOpacity;
in vec2 vUv;
out vec4 fragColor;
${BLEND_GLSL}
${RNG_GLSL}
float gcell(int i, int j) {
  uint h = uSeed;
  h = (h ^ uint(i)) * 0x9e3779b1u;
  h = (h ^ uint(j)) * 0x85ebca77u;
  h ^= h >> 13u;
  return mulberry32(h);
}
float grainValueG(vec2 p) {
  vec2 g = p / uCellPx;
  vec2 ij = floor(g);
  vec2 f = g - ij;
  int i = int(ij.x), j = int(ij.y);
  float v00 = gcell(i, j), v10 = gcell(i + 1, j);
  float v01 = gcell(i, j + 1), v11 = gcell(i + 1, j + 1);
  return v00 * (1.0 - f.x) * (1.0 - f.y) + v10 * f.x * (1.0 - f.y)
       + v01 * (1.0 - f.x) * f.y + v11 * f.x * f.y;
}
void main() {
  // layer pixel = rnd(v*255) gray, alpha 255 — CPU grain() identical
  float v = clamp(floor(grainValueG(vUv * uDims) * 255.0 + 0.5), 0.0, 255.0);
  vec4 layer = vec4(vec3(v), 255.0) / 255.0;
  fragColor = compositeOver(texture(uSrc, vUv), layer, uMode, uOpacity);
}`;

export function applyGrainGPU(inf, srcH, params) {
  const gl = inf.session.gl;
  const prog = inf.programs.get(GRAIN_SHADER, "grain");
  if (!prog) return null;
  const cellPx = Math.max(params.size * (200 / 180), 1e-6);
  const dst = inf.pool.acquire(srcH.w, srcH.h);
  gl.useProgram(prog);
  setUniform(gl, prog, { name: "uDims", type: "vec2", value: [srcH.w, srcH.h] });
  setUniform(gl, prog, { name: "uSeed", type: "uint", value: params.seed >>> 0 });
  setUniform(gl, prog, { name: "uCellPx", type: "float", value: cellPx });
  setUniform(gl, prog, { name: "uMode", type: "int", value: BLEND_INDEX[params.blend] ?? 0 });
  setUniform(gl, prog, { name: "uOpacity", type: "float", value: params.opacity / 100 });
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.viewport(0, 0, dst.w, dst.h);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, srcH.tex);
  gl.uniform1i(gl.getUniformLocation(prog, "uSrc"), 0);
  gl.bindVertexArray(inf.programs.quad().vao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
  if (gl.isContextLost()) { inf.pool.release(dst); return null; }
  return dst;
}

/* ---------------- glitch ---------------- */

// Band record -> 3 vec4s:
//   A = [y0, y1, dx, dy]
//   B = [exposure, jitter, split, repeat(0/1)]
//   C = [corruptMode(-1 none | 0 hue | 1 desat | 2 kill | 3 posterize), severity, arg, 0]
export const GLITCH_SHADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSrc;
uniform vec2 uDims;
uniform int uNBands;
uniform vec4 uBands[192];
uniform uint uRowSeed;
in vec2 vUv;
out vec4 fragColor;
${HELPERS}
${RNG_GLSL}

void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  int row = ij.y;
  vec4 srcPx = texelFetch(uSrc, ij, 0);
  vec3 rgb = srcPx.rgb * 255.0;
  int bi = -1;
  for (int i = 0; i < ${GLITCH_MAX_BANDS}; i++) {
    if (i >= uNBands) break;
    if (float(row) >= uBands[i * 3].x && float(row) < uBands[i * 3].y) { bi = i; break; }
  }
  if (bi < 0) { fragColor = srcPx; return; }
  vec4 A = uBands[bi * 3];
  vec4 B = uBands[bi * 3 + 1];
  vec4 C = uBands[bi * 3 + 2];
  float rowStep = B.w > 0.5 ? 2.0 : 1.0;
  float sourceY = clamp(A.x + floor((float(row) - A.x) / rowStep) - A.w, 0.0, uDims.y - 1.0);
  int rowDx = int(A.z) + (B.y > 0.0
    ? int(floor((mulberry32(uRowSeed + uint(row) * 2654435761u) * 2.0 - 1.0) * B.y + 0.5))
    : 0);
  int bandSplit = int(B.z);
  int sourceX = clamp(ij.x - rowDx, 0, int(uDims.x) - 1);
  int sx0 = clamp(sourceX - bandSplit, 0, int(uDims.x) - 1);
  int sx2 = clamp(sourceX + bandSplit, 0, int(uDims.x) - 1);
  rgb = vec3(
    texelFetch(uSrc, ivec2(sx0, int(sourceY)), 0).r,
    texelFetch(uSrc, ivec2(sourceX, int(sourceY)), 0).g,
    texelFetch(uSrc, ivec2(sx2, int(sourceY)), 0).b) * 255.0;

  int mode = int(C.x);
  if (mode >= 0) {
    float sev = C.y, arg = C.z;
    if (mode == 0) {                    // hue shift
      vec3 hsl = rgbToHslG(rgb);
      if (hsl.y > 0.0) rgb = hslToRgbG(vec3(mod(hsl.x + arg + 360.0, 360.0), hsl.y, hsl.z));
    } else if (mode == 1) {             // desat
      float lum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
      rgb += (vec3(lum) - rgb) * sev;
    } else if (mode == 2) {             // kill channel
      rgb[int(arg)] *= 1.0 - sev;
    } else {                            // posterize
      rgb += (vec3(posterizeB(rgb.r, arg), posterizeB(rgb.g, arg), posterizeB(rgb.b, arg)) - rgb) * sev;
    }
  }
  fragColor = vec4(
    clamp(floor(rgb.r * B.x + 0.5), 0.0, 255.0),
    clamp(floor(rgb.g * B.x + 0.5), 0.0, 255.0),
    clamp(floor(rgb.b * B.x + 0.5), 0.0, 255.0),
    srcPx.a * 255.0) / 255.0;
}`;

// JS-side band packing. bands from the CPU buildGlitchBands — verbatim.
export function packGlitchBands(built) {
  const { bands } = built;
  if (bands.length > GLITCH_MAX_BANDS) return null;
  const flat = new Float32Array(GLITCH_MAX_BANDS * 3 * 4);
  bands.forEach((b, i) => {
    const o = i * 12;
    flat[o] = b.y;
    flat[o + 1] = b.y + b.height;
    flat[o + 2] = b.dx;
    flat[o + 3] = b.dy;
    flat[o + 4] = b.exposure;
    flat[o + 5] = b.jitter;
    flat[o + 6] = b.split ?? built.split;  // per-band split or base split
    flat[o + 7] = b.repeat ? 1 : 0;
    flat[o + 8] = b.corrupt ? ["hue", "desat", "kill", "posterize"].indexOf(b.corrupt.mode) : -1;
    flat[o + 9] = b.corrupt ? b.corrupt.severity : 0;
    flat[o + 10] = b.corrupt ? b.corrupt.arg : 0;
  });
  return flat;
}

export function glitchBandUniforms(built) {
  const flat = packGlitchBands(built);
  if (!flat) return null;
  return [
    { name: "uBands", type: "vec4[]", value: flat },
    { name: "uNBands", type: "int", value: built.bands.length },
    { name: "uRowSeed", type: "uint", value: built.rowSeed >>> 0 },
  ];
}

export function applyGlitchGPU(inf, srcH, params, renderScale) {
  const gl = inf.session.gl;
  const built = buildGlitchBands(params, srcH.w, srcH.h, renderScale); // CPU — sequential RNG
  const uniforms = glitchBandUniforms(built);
  if (!uniforms) return { reason: "bands-over-limit" };
  if (!glitchUniformLimit(built.bands.length, detectCapabilities().maxFragmentUniforms)) return { reason: "bands-over-limit" };
  const prog = inf.programs.get(GLITCH_SHADER, "glitch");
  if (!prog) return { reason: "shader-compile" };
  const dst = inf.pool.acquire(srcH.w, srcH.h);
  gl.useProgram(prog);
  setUniform(gl, prog, { name: "uDims", type: "vec2", value: [srcH.w, srcH.h] });
  for (const u of uniforms) setUniform(gl, prog, u);
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.viewport(0, 0, dst.w, dst.h);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, srcH.tex);
  gl.uniform1i(gl.getUniformLocation(prog, "uSrc"), 0);
  gl.bindVertexArray(inf.programs.quad().vao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
  if (gl.isContextLost()) { inf.pool.release(dst); return { reason: "context-lost" }; }
  return { dst };
}

// Uniform budget gate: 3 vec4 per band + ~10 fixed vectors.
export function glitchUniformLimit(nBands, maxFragmentUniforms) {
  return nBands * 3 + 12 <= maxFragmentUniforms;
}
