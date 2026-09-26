// gl/effects/blur.js — separable Gaussian on the GPU.
//
// Weights come from the SAME gaussianKernel() the CPU path calls, packed
// into vec4 uniforms (plan §uniform-budget). Two ping-pong passes:
// H into an intermediate target, V into the output target.
//
// Precision note (accepted by plan tolerances): the CPU keeps pass-1
// output in float64 scratch; the GPU ping-pong is RGBA8, so pass-1
// output quantizes to bytes before pass 2. Worst case adds ≤0.5 LSB of
// error to the vertical input — well inside the blur budget
// (maxAbs ≤ 6, meanAbs ≤ 1).
//
// Edge handling: texture wraps are CLAMP_TO_EDGE, matching the CPU's
// coordinate clamp.

import { gaussianKernel } from "../../effects/blur.js";

export const BLUR_MAX_TAPS = 256; // vec4[64] uniform array

export const BLUR_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uStep;      // texel-scaled direction: (1/w,0) or (0,1/h)
uniform int uRadius;
uniform vec4 uW[64];
in vec2 vUv;
out vec4 fragColor;
float tap(int i) { return uW[i >> 2][i & 3]; }
void main() {
  vec4 acc = vec4(0.0);
  for (int k = -uRadius; k <= uRadius; k++) {
    acc += texture(uSrc, vUv + float(k) * uStep) * tap(k + uRadius);
  }
  fragColor = acc;
}`;

// Taps for this sigma fit the uniform array AND the device's vector
// budget? (Reserve ~8 vectors for the rest of the program.)
export function blurFits(sigma, maxFragmentUniforms) {
  const { radius } = gaussianKernel(sigma);
  const taps = radius * 2 + 1;
  if (taps > BLUR_MAX_TAPS) return false;
  const vec4s = Math.ceil(taps / 4);
  return vec4s + 8 <= maxFragmentUniforms;
}

// Blur the contents of srcH into a fresh pool handle (caller releases).
// Returns null if the kernel exceeds BLUR_MAX_TAPS (caller falls back).
export function applyBlurGPU(inf, srcH, sigma, maxUniforms) {
  const { weights, radius } = gaussianKernel(sigma);
  const taps = radius * 2 + 1;
  if (taps > BLUR_MAX_TAPS) return null;

  const gl = inf.session.gl;
  const prog = inf.programs.get(BLUR_FRAG, "blur");
  if (!prog) return null;

  const packed = new Float32Array(BLUR_MAX_TAPS);
  packed.set(weights);

  const mid = inf.pool.acquire(srcH.w, srcH.h);
  const dst = inf.pool.acquire(srcH.w, srcH.h);
  try {
    gl.useProgram(prog);
    gl.uniform1i(gl.getUniformLocation(prog, "uSrc"), 0);
    gl.uniform1i(gl.getUniformLocation(prog, "uRadius"), radius);
    gl.uniform4fv(gl.getUniformLocation(prog, "uW"), packed);
    const stepLoc = gl.getUniformLocation(prog, "uStep");
    const pass = (from, to, dx, dy) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
      gl.viewport(0, 0, to.w, to.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, from.tex);
      gl.uniform2f(stepLoc, dx, dy);
      inf.programs.draw(prog);
    };
    pass(srcH, mid, 1 / srcH.w, 0);
    pass(mid, dst, 0, 1 / srcH.h);
    return gl.isContextLost() ? (inf.pool.release(dst), null) : dst;
  } finally {
    inf.pool.release(mid);
  }
}
