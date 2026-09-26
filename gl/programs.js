// gl/programs.js — shader compile/link cache + fullscreen quad.
//
// Programs are keyed by shader source text; identical sources link once.
// The quad is a single fullscreen triangle strip in clip space with uv in
// [0,1] — uv 0 is clip -1 (GL bottom), matching texImage2D row order, so
// buffer→texture→framebuffer→readPixels roundtrips with no flip step.

export const VERT_SRC = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export class ProgramCache {
  constructor(gl) {
    this.gl = gl;
    this.programs = new Map(); // fragSrc -> WebGLProgram
    this._quad = null;
  }

  get(fragSrc, label = "") {
    let prog = this.programs.get(fragSrc);
    if (prog === undefined) {
      prog = this._link(fragSrc, label);
      this.programs.set(fragSrc, prog); // null cached too — failed compiles stay failed
    }
    return prog;
  }

  _compile(type, src, label) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(`shader compile failed (${label}): ${log}`);
    }
    return sh;
  }

  _link(fragSrc, label) {
    const gl = this.gl;
    try {
      const vs = this._compile(gl.VERTEX_SHADER, VERT_SRC, `${label}:vert`);
      const fs = this._compile(gl.FRAGMENT_SHADER, fragSrc, `${label}:frag`);
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(prog);
        gl.deleteProgram(prog);
        throw new Error(`program link failed (${label}): ${log}`);
      }
      return prog;
    } catch (e) {
      console.warn("[wobbletone-engine] GL", e.message);
      return null;
    }
  }

  // Shared fullscreen quad VBO, created lazily.
  quad() {
    if (this._quad) return this._quad;
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this._quad = { vao, vbo };
    return this._quad;
  }

  // Draw the fullscreen quad with prog bound.
  draw(prog) {
    const gl = this.gl;
    gl.useProgram(prog);
    gl.bindVertexArray(this.quad().vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  dispose() {
    const gl = this.gl;
    for (const prog of this.programs.values()) if (prog) gl.deleteProgram(prog);
    this.programs.clear();
    if (this._quad) {
      gl.deleteBuffer(this._quad.vbo);
      gl.deleteVertexArray(this._quad.vao);
      this._quad = null;
    }
  }
}
