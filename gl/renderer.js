// gl/renderer.js — GPU render entry.
//
// v1 dispatch rule (locked decision): the GPU takes a render only when
// the ENTIRE expanded spec is pixel-local — one fused pass, no partial
// pipelines. Any unsupported effect, compile failure, or context loss
// returns null and the caller runs the CPU path whole; the reason goes
// to options.fallbackReason for stats.

import { validateSpec } from "../spec.js";
import { EFFECTS } from "../registry.js";
import { planRuns, scaleParams } from "../render.js";
import { ensureInfra } from "./infra.js";
import { buildFusedRun, canRunGPU } from "./fusion.js";
import { uploadBuffer, readBuffer } from "./readback.js";

// Every expanded effect must have a GLSL step (v1: pixel-local only) —
// the whole spec then forms exactly one fused run.
export function canRenderGPU(spec) {
  try {
    const { effects } = validateSpec(spec);
    return planRuns(effects).every((run) => run.every((e) => canRunGPU(e.type)));
  } catch {
    return false;
  }
}

export function renderBufferGPU(buffer, spec, options = {}) {
  const validated = validateSpec(spec);
  const sourceWidth = options.sourceWidth ?? buffer.width;
  const renderScale = buffer.width / sourceWidth;

  const runs = planRuns(validated.effects);
  if (runs.length !== 1 || !runs[0].every((e) => canRunGPU(e.type))) {
    options.fallbackReason = "unsupported-effect";
    return null;
  }

  const inf = ensureInfra();
  if (!inf) {
    options.fallbackReason = "no-webgl2";
    return null;
  }

  const scaled = runs[0].map((e) => ({
    type: e.type,
    params: scaleParams(EFFECTS[e.type], e.params, renderScale),
  }));
  const { src, uniforms } = buildFusedRun(scaled, (type, params) =>
    EFFECTS[type].preparePixel ? EFFECTS[type].preparePixel(params) : params
  );

  const prog = inf.programs.get(src, "fused-run");
  if (!prog) {
    options.fallbackReason = "shader-compile";
    return null;
  }

  const { gl } = inf.session;
  const srcH = inf.pool.acquire(buffer.width, buffer.height);
  const dstH = inf.pool.acquire(buffer.width, buffer.height);
  const t0 = performance.now();
  try {
    uploadBuffer(gl, srcH, buffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstH.fbo);
    gl.viewport(0, 0, dstH.w, dstH.h);
    gl.useProgram(prog);
    for (const u of uniforms) setUniform(gl, prog, u);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcH.tex);
    gl.uniform1i(gl.getUniformLocation(prog, "uSrc"), 0);
    gl.bindVertexArray(inf.programs.quad().vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    if (gl.isContextLost()) {
      options.fallbackReason = "context-lost";
      return null;
    }
    const out = readBuffer(gl, dstH);
    if (options.collectStats) {
      options.stats = {
        ms: performance.now() - t0,
        renderer: "webgl2",
        fallbackReason: null,
        logical: validated.effects.length,
        passes: 1,
        perEffect: [{ type: runs[0].map((e) => e.type).join("+"), ms: performance.now() - t0 }],
      };
    }
    return out;
  } finally {
    inf.pool.releaseAll(srcH, dstH);
  }
}

function setUniform(gl, prog, { name, type, value }) {
  const loc = gl.getUniformLocation(prog, name);
  if (!loc) return;
  switch (type) {
    case "float": gl.uniform1f(loc, value); break;
    case "int": gl.uniform1i(loc, value); break;
    case "vec3": gl.uniform3f(loc, value[0], value[1], value[2]); break;
    case "vec3[]": gl.uniform3fv(loc, value); break;
  }
}
