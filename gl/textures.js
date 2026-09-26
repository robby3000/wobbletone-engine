// gl/textures.js — RGBA8 texture pool + ping-pong helpers.
//
// Handles are { tex, fbo, w, h } — the fbo is pre-bound to the texture so
// "render into" and "readPixels from" need no reattachment. Pool keyed by
// dims; entries are reusable scratch only, never handed out permanently
// (same ownership rule as the CPU pool).

export function createTarget(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fbo, w, h };
}

export class TexturePool {
  constructor(gl) {
    this.gl = gl;
    this.free = new Map(); // "wxh" -> handle[]
    this.checkedOut = new Set();
  }

  acquire(w, h) {
    const key = `${w}x${h}`;
    const bucket = this.free.get(key);
    const hnd = bucket && bucket.length ? bucket.pop() : createTarget(this.gl, w, h);
    this.checkedOut.add(hnd);
    return hnd;
  }

  // Ping-pong pair for multi-pass work (blur H then V, bloom chain).
  acquirePair(w, h) {
    return [this.acquire(w, h), this.acquire(w, h)];
  }

  release(hnd) {
    if (!this.checkedOut.delete(hnd)) return; // double-release is a no-op
    const key = `${hnd.w}x${hnd.h}`;
    let bucket = this.free.get(key);
    if (!bucket) this.free.set(key, (bucket = []));
    bucket.push(hnd);
  }

  releaseAll(...hnds) { for (const h of hnds) this.release(h); }

  dispose() {
    const gl = this.gl;
    for (const bucket of this.free.values())
      for (const h of bucket) { gl.deleteTexture(h.tex); gl.deleteFramebuffer(h.fbo); }
    this.free.clear();
    this.checkedOut.clear();
  }

  get freeCount() { let n = 0; for (const b of this.free.values()) n += b.length; return n; }
}
