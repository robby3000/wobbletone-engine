// gl/effects/overlay.js — overlay effects as a single draw each.
//
// The CPU builds a procedural layer buffer then compositeOver()s it. On
// GPU the layer never materializes: the fragment shader computes the
// layer pixel procedurally at the same coordinate and composites inline.
// Layer math (premultiplied stop interpolation, diagonal-spanning linear
// gradient, elliptical radial, row-coverage scanlines) is ported
// line-for-line from effects/overlay.js; compositeOver comes from the
// G2 BLEND_GLSL chunk.
//
// Pixel-center convention: CPU iterates (x+0.5, y+0.5); the fragment's
// vUv * dims IS the pixel centre, so the same formulas apply with
// p = vUv * uDims. Scanlines uses floor(p.y) = CPU row index.

import { parseCssColor } from "../../color.js";
import { BLEND_INDEX, BLEND_GLSL } from "../blends.js";
import { setUniform } from "../uniforms.js";

export const OVERLAY_MAX_STOPS = 8;

export const OVERLAY_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSrc;
uniform vec2 uDims;        // w, h in px
uniform int uKind;         // 0 solid, 1 linear, 2 radial, 3 scanlines
uniform vec2 uDir;         // linear gradient direction (sin a, -cos a)
uniform float uLen;        // linear gradient span (|w dx| + |h dy|)
uniform vec4 uColor;       // solid / scanlines color, bytes RGBA
uniform float uScan;       // scanlines line spacing, px
uniform vec4 uStopsC[8];   // sorted stops: colors bytes RGBA
uniform float uStopsO[8];  // sorted stops: offsets 0..1
uniform int uNStops;
uniform int uMode;
uniform float uOpacity;    // 0..1
in vec2 vUv;
out vec4 fragColor;
${BLEND_GLSL}

vec4 sampleStopsG(float t) {
  if (t <= uStopsO[0]) return uStopsC[0];
  if (t >= uStopsO[uNStops - 1]) return uStopsC[uNStops - 1];
  int upper = uNStops - 1;
  for (int i = 1; i < ${OVERLAY_MAX_STOPS}; i++) {
    if (i >= uNStops) break;
    if (uStopsO[i] >= t) { upper = i; break; }
  }
  vec4 c1 = uStopsC[upper - 1], c2 = uStopsC[upper];
  float o1 = uStopsO[upper - 1], o2 = uStopsO[upper];
  float f = (t - o1) / (o2 - o1);
  // premultiplied interpolation — CSS gradient semantics
  float pa1 = c1.a / 255.0, pa2 = c2.a / 255.0;
  vec3 pr = c1.rgb * pa1 + (c2.rgb * pa2 - c1.rgb * pa1) * f;
  float pa = (pa1 + (pa2 - pa1) * f) * 255.0;
  if (pa <= 0.0) return vec4(0.0);
  return vec4(pr / (pa / 255.0), pa);
}

vec4 layerPx(vec2 p) {
  if (uKind == 0) return uColor;
  if (uKind == 1) {
    float t = ((p.x - uDims.x * 0.5) * uDir.x + (p.y - uDims.y * 0.5) * uDir.y) / uLen + 0.5;
    return sampleStopsG(t);
  }
  if (uKind == 2) {
    vec2 n = (p - uDims * 0.5) / (uDims * 0.5);
    return sampleStopsG(length(n));
  }
  // scanlines: coverage of row [y, y+1) by the [k·s, k·s+1) line rects
  float s = max(uScan, 0.000001);
  float y = floor(p.y);
  float cov = s <= 1.0 ? 1.0 : clamp(floor(y / s) * s + 1.0 - y, 0.0, 1.0);
  return vec4(uColor.rgb, uColor.a * cov);
}

void main() {
  vec4 backdrop = texture(uSrc, vUv);
  vec4 layer = layerPx(vUv * uDims) / 255.0;
  fragColor = compositeOver(backdrop, layer, uMode, uOpacity);
}`;

export const GPU_OVERLAY_TYPES = new Set([
  "colorwash", "gradient", "overlay", "vignette", "scanlines", "prism",
]);

// Build the uniform list for an overlay run entry. params already
// renderScale-scaled (scanlines.size arrives scaled). Returns null when
// the stop list exceeds the fixed uniform array (caller falls back).
export function overlayUniforms(e, w, h) {
  const p = e.params;
  const u = [];
  const push = (name, type, value) => u.push({ name, type, value });

  let kind = -1;
  let stops = null;
  let color = null;
  let mode = p.blend ?? "normal";

  switch (e.type) {
    case "colorwash":
      kind = 0; color = p.color;
      break;
    case "gradient":
      kind = 1; stops = [[0, p.c1], [1, p.c2]];
      break;
    case "overlay":
      kind = p.kind === "radial" ? 2 : 1; stops = p.stops;
      break;
    case "vignette":
      kind = 2; stops = [[(100 - p.size) / 100, "transparent"], [1, p.color]];
      mode = "multiply";
      break;
    case "scanlines":
      kind = 3; color = p.color;
      break;
    case "prism": {
      kind = 1;
      const w2 = p.width;
      stops = [
        [0.5 - w2 / 200, "transparent"],
        [0.5 - w2 / 600, p.c1],
        [0.5, "#ffffff"],
        [0.5 + w2 / 600, p.c2],
        [0.5 + w2 / 200, "transparent"],
      ];
      mode = "screen";
      break;
    }
    default:
      return null;
  }

  push("uDims", "vec2", [w, h]);
  push("uKind", "int", kind);
  push("uMode", "int", BLEND_INDEX[mode] ?? 0);
  push("uOpacity", "float", (p.opacity ?? 100) / 100);

  if (kind === 1 || kind === 2) {
    const rad = ((p.angle ?? 0) * Math.PI) / 180;
    const dx = Math.sin(rad), dy = -Math.cos(rad);
    push("uDir", "vec2", [dx, dy]);
    push("uLen", "float", Math.abs(w * dx) + Math.abs(h * dy));
    const sorted = [...stops].sort((a, b) => a[0] - b[0]);
    if (sorted.length > OVERLAY_MAX_STOPS) return null;
    const cols = new Float32Array(OVERLAY_MAX_STOPS * 4);
    const offs = new Float32Array(OVERLAY_MAX_STOPS);
    sorted.forEach(([o, c], i) => {
      offs[i] = o;
      cols.set(parseCssColor(c), i * 4);
    });
    push("uStopsC", "vec4[]", cols);
    push("uStopsO", "float[]", offs);
    push("uNStops", "int", sorted.length);
  }
  if (kind === 0 || kind === 3) {
    push("uColor", "vec4", parseCssColor(color));
    if (kind === 3) push("uScan", "float", p.size);
  }
  return u;
}

// Draw: srcH -> fresh pool handle (caller releases). null on failure.
export function applyOverlayGPU(inf, srcH, e) {
  const gl = inf.session.gl;
  const prog = inf.programs.get(OVERLAY_FRAG, "overlay");
  if (!prog) return null;
  const uniforms = overlayUniforms(e, srcH.w, srcH.h);
  if (!uniforms) return null;
  const dst = inf.pool.acquire(srcH.w, srcH.h);
  gl.useProgram(prog);
  for (const u of uniforms) setUniform(gl, prog, u);
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
