// gl/renderer.js — GPU render entry.
//
// v1 dispatch rule (locked decision): the GPU takes a render only when
// EVERY expanded run has a GPU path — fused pass for pixel-local runs,
// dedicated passes for supported spatial effects (blur today, more in
// G5–G7). Any unsupported effect, compile failure, oversized kernel, or
// context loss returns null and the caller runs the CPU path whole;
// the reason goes to options.fallbackReason for stats.

import { validateSpec } from "../spec.js";
import { EFFECTS } from "../registry.js";
import { planRuns, scaleParams } from "../render.js";
import { ensureInfra } from "./infra.js";
import { detectCapabilities } from "./context.js";
import { buildFusedRun, canRunGPU } from "./fusion.js";
import { uploadBuffer, readBuffer } from "./readback.js";
import { setUniform } from "./uniforms.js";
import { applyBlurGPU } from "./effects/blur.js";
import { GPU_OVERLAY_TYPES, applyOverlayGPU } from "./effects/overlay.js";

// Can every run of this spec render on GPU? (Shape check only —
// param-dependent limits like blur kernel size are gated at render.)
export function canRenderGPU(spec) {
  try {
    const { effects } = validateSpec(spec);
    for (const run of planRuns(effects)) {
      if (run.every((e) => canRunGPU(e.type))) continue;
      if (run.length === 1 && run[0].type === "blur") continue;
      if (run.length === 1 && GPU_OVERLAY_TYPES.has(run[0].type)) continue;
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function renderBufferGPU(buffer, spec, options = {}) {
  const validated = validateSpec(spec);
  const sourceWidth = options.sourceWidth ?? buffer.width;
  const renderScale = buffer.width / sourceWidth;
  const runs = planRuns(validated.effects);

  if (!canRenderGPU(spec)) {
    options.fallbackReason = "unsupported-effect";
    return null;
  }
  const inf = ensureInfra();
  if (!inf) {
    options.fallbackReason = "no-webgl2";
    return null;
  }
  const caps = detectCapabilities();
  const { gl } = inf.session;
  const t0 = performance.now();
  const perEffect = [];
  let physicalPasses = 0;

  const srcH = inf.pool.acquire(buffer.width, buffer.height);
  uploadBuffer(gl, srcH, buffer);
  let cur = srcH;
  const held = [srcH];

  try {
    for (const run of runs) {
      const e0 = collectTimer(options);
      if (run.every((e) => canRunGPU(e.type))) {
        const scaled = run.map((e) => ({
          type: e.type,
          params: scaleParams(EFFECTS[e.type], e.params, renderScale),
        }));
        const { src, uniforms } = buildFusedRun(scaled, (type, params) =>
          EFFECTS[type].preparePixel ? EFFECTS[type].preparePixel(params) : params
        );
        const prog = inf.programs.get(src, "fused-run");
        if (!prog) return fail(options, "shader-compile");
        const dst = inf.pool.acquire(cur.w, cur.h);
        held.push(dst);
        gl.useProgram(prog);
        for (const u of uniforms) setUniform(gl, prog, u);
        drawInto(gl, inf, prog, cur, dst);
        cur = dst;
        physicalPasses++;
      } else if (run[0].type === "blur") {
        const params = scaleParams(EFFECTS.blur, run[0].params, renderScale);
        if (params.v > 0) {
          if (!blurFitsGPU(params.v, caps)) return fail(options, "kernel-too-large");
          const dst = applyBlurGPU(inf, cur, params.v, caps.maxFragmentUniforms);
          if (!dst) return fail(options, inf.session.lost ? "context-lost" : "shader-compile");
          held.push(dst);
          cur = dst;
          physicalPasses += 2;
        }
        // sigma <= 0: identity — skip the run entirely
      } else {
        // overlay run — one inline layer+composite draw
        const params = scaleParams(EFFECTS[run[0].type], run[0].params, renderScale);
        const dst = applyOverlayGPU(inf, cur, { type: run[0].type, params });
        if (!dst) return fail(options, inf.session.lost ? "context-lost" : "unsupported-effect");
        held.push(dst);
        cur = dst;
        physicalPasses++;
      }
      if (options.collectStats) perEffect.push({ type: run.map((e) => e.type).join("+"), ms: performance.now() - e0 });
      if (gl.isContextLost()) return fail(options, "context-lost");
    }

    const out = readBuffer(gl, cur);
    if (options.collectStats) {
      options.stats = {
        ms: performance.now() - t0,
        renderer: "webgl2",
        fallbackReason: null,
        logical: validated.effects.length,
        passes: physicalPasses,
        perEffect,
      };
    }
    return out;
  } finally {
    for (const h of held) inf.pool.release(h);
  }
}

function blurFitsGPU(sigma, caps) {
  // Kernel vec4s + fixed program cost must fit the fragment budget.
  const radius = Math.max(1, Math.ceil(sigma * 3));
  return Math.ceil((radius * 2 + 1) / 4) + 8 <= (caps.maxFragmentUniforms || 0);
}

function drawInto(gl, inf, prog, from, to) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
  gl.viewport(0, 0, to.w, to.h);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, from.tex);
  gl.uniform1i(gl.getUniformLocation(prog, "uSrc"), 0);
  gl.bindVertexArray(inf.programs.quad().vao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
}

function fail(options, reason) {
  options.fallbackReason = reason;
  return null;
}

function collectTimer(options) {
  return options.collectStats ? performance.now() : 0;
}

