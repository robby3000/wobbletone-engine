// gl/context.js — WebGL2 capability detection.
//
// Probed once and cached (context creation is not free). No UA sniffing —
// capability bits only (brief §10). DOM access stays inside functions so
// the module is importable under node --test.
//
// The probe context is created on a throwaway canvas and explicitly lost
// afterwards — it exists only to answer questions, never to render.

let cached = null;

const EMPTY_CAPS = Object.freeze({
  webgl2: false,
  highpFloat: false,
  maxTextureSize: 0,
  maxFragmentUniforms: 0,
  halfFloatTargets: false,
  software: false,
  rendererString: "",
});

export function detectCapabilities() {
  if (cached) return cached;
  cached = probe();
  return cached;
}

// Test seam — lets node tests drive pickRenderer with synthetic caps
// without faking a whole GL context.
export function _setCapabilitiesForTest(caps) { cached = caps ? Object.freeze({ ...caps }) : null; }

function probe() {
  if (typeof document === "undefined") return EMPTY_CAPS;
  const canvas = document.createElement("canvas");
  let gl = null;
  try {
    gl = canvas.getContext("webgl2", { alpha: true, antialias: false, depth: false, stencil: false });
  } catch {
    return EMPTY_CAPS;
  }
  if (!gl) return EMPTY_CAPS;

  const prec = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const rendererString = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "");
  const caps = {
    webgl2: true,
    highpFloat: Boolean(prec && prec.precision >= 23),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0,
    maxFragmentUniforms: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) || 0,
    // Detected and recorded per the locked decisions — unused in v1.
    halfFloatTargets: Boolean(gl.getExtension("EXT_color_buffer_half_float")),
    // SwiftShader/llvmpipe are slower than our CPU path — demote.
    software: /swiftshader|llvmpipe|softpipe|software/i.test(rendererString),
    rendererString,
  };

  try {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch { /* probe context teardown is best-effort */ }
  return Object.freeze(caps);
}

// ---- rendering context ----
//
// One persistent hidden-canvas context for actual rendering. Context loss
// (routine on iOS under memory pressure) is handled explicitly: the flag
// trips on webglcontextlost, in-flight renders bail to CPU, and a restore
// rebuilds GPU state lazily — programs/pool are recompiled on next use.
// preventDefault() keeps the context restorable.

let session = null;

export function acquireGLContext() {
  if (session && !session.lost && !session.gl.isContextLost()) return session;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", {
    alpha: true, antialias: false, depth: false, stencil: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) { session = null; return null; }
  const s = { gl, canvas, lost: false, generation: 0, onRestore: null };
  session = s;
  // Listeners mutate THIS session object, not the module binding — a
  // replaced session's late events must not corrupt the live one.
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    s.lost = true;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    s.lost = false;
    s.generation++;              // programs/pools check this and rebuild
    s.onRestore?.(s);
  });
  return s;
}

export function releaseGLContext() {
  if (!session) return;
  try { session.gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* ok */ }
  session = null;
}

export function _resetGLForTest() { session = null; cached = null; }
