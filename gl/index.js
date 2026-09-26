// gl/index.js — renderer selection + public GPU API surface.
//
// pickRenderer decides CPU vs WebGL2 from capability bits + caller
// preference. "auto" requires the full bar: real WebGL2, highp fragment
// float, a hardware rasterizer, and enough texture size for the render.
// Selection is per render — maxTextureSize is compared against actual
// dims each time (wobbletonefx sources are full-res).

import { detectCapabilities, acquireGLContext } from "./context.js";
import { ProgramCache } from "./programs.js";
import { TexturePool } from "./textures.js";
import { uploadBuffer, readBuffer } from "./readback.js";

export { detectCapabilities, acquireGLContext, ProgramCache, TexturePool, uploadBuffer, readBuffer };

// Passthrough fragment — uploads a buffer, draws it, reads it back.
// Byte-identical by construction (RGBA8 unorm roundtrip); it exists to
// prove the upload/draw/readback path before any real shader ships (G1
// done criterion) and stays as a diagnostics smoke test afterwards.
const PASSTHROUGH_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
in vec2 vUv;
out vec4 fragColor;
void main() { fragColor = texture(uSrc, vUv); }`;

let infra = null; // { session, programs, pool } — rebuilt on context restore

function ensureInfra() {
  const session = acquireGLContext();
  if (!session || session.lost) return null;
  if (!infra || infra.generation !== session.generation) {
    infra?.programs?.dispose();
    infra?.pool?.dispose();
    infra = {
      generation: session.generation,
      session,
      programs: new ProgramCache(session.gl),
      pool: new TexturePool(session.gl),
    };
  }
  return infra;
}

// Returns the same pixels back through the GPU, or null if unavailable.
export function gpuPassthrough(buffer) {
  const inf = ensureInfra();
  if (!inf) return null;
  const { gl } = inf.session;
  const prog = inf.programs.get(PASSTHROUGH_FRAG, "passthrough");
  if (!prog) return null;
  const src = inf.pool.acquire(buffer.width, buffer.height);
  const dst = inf.pool.acquire(buffer.width, buffer.height);
  try {
    uploadBuffer(gl, src, buffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(gl.getUniformLocation(prog, "uSrc"), 0);
    inf.programs.draw(prog);
    const out = readBuffer(gl, dst);
    return gl.isContextLost() ? null : out;
  } finally {
    inf.pool.releaseAll(src, dst);
  }
}

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
