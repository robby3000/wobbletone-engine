// G1 — infrastructure bookkeeping under a fake GL. Real GL calls can't
// run in Node; what can be tested is our own logic: program caching,
// texture-pool reuse/release semantics, and buffer transfer arg shapes.

import test from "node:test";
import assert from "node:assert/strict";
import { ProgramCache } from "../gl/programs.js";
import { TexturePool } from "../gl/textures.js";
import { uploadBuffer, readBuffer } from "../gl/readback.js";

function fakeGL() {
  const calls = [];
  const gl = {
    calls,
    VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30,
    COMPILE_STATUS: 0x8B81, LINK_STATUS: 0x8B82,
    ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88E4, FLOAT: 0x1406,
    TRIANGLE_STRIP: 0x0005,
    TEXTURE_2D: 0x0DE1, FRAMEBUFFER: 0x8D40, COLOR_ATTACHMENT0: 0x8CE0,
    TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
    NEAREST: 0x2600, CLAMP_TO_EDGE: 0x812F,
    RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241, UNPACK_FLIP_Y_WEBGL: 0x9240,
    createShader: () => ({}), shaderSource: () => {}, compileShader: () => {},
    getShaderParameter: () => true, getShaderInfoLog: () => "",
    deleteShader: () => {},
    createProgram: () => calls.push("createProgram") && ({}),
    attachShader: () => {}, linkProgram: () => {},
    getProgramParameter: () => true, getProgramInfoLog: () => "",
    deleteProgram: () => calls.push("deleteProgram"),
    createVertexArray: () => ({}), bindVertexArray: () => {},
    createBuffer: () => ({}), bindBuffer: () => {}, bufferData: () => {},
    enableVertexAttribArray: () => {}, vertexAttribPointer: () => {},
    useProgram: () => {}, drawArrays: () => {},
    createTexture: () => calls.push("createTexture") && ({}),
    bindTexture: () => {}, texParameteri: () => {},
    texImage2D: (...a) => calls.push(["texImage2D", ...a]),
    createFramebuffer: () => calls.push("createFramebuffer") && ({}),
    bindFramebuffer: () => {}, framebufferTexture2D: () => {},
    deleteTexture: () => calls.push("deleteTexture"),
    deleteFramebuffer: () => calls.push("deleteFramebuffer"),
    deleteBuffer: () => {}, deleteVertexArray: () => {},
    pixelStorei: () => {},
    readPixels: (...a) => calls.push(["readPixels", ...a.slice(0, 5)]),
  };
  return gl;
}

test("ProgramCache links each distinct fragment source once", () => {
  const gl = fakeGL();
  const cache = new ProgramCache(gl);
  const a = cache.get("frag-a", "a");
  const b = cache.get("frag-b", "b");
  const a2 = cache.get("frag-a", "a");
  assert.equal(a2, a);
  assert.notEqual(a, b);
  assert.equal(gl.calls.filter((c) => c === "createProgram").length, 2);
});

test("ProgramCache nulls failed compiles and does not retry", () => {
  const gl = fakeGL();
  gl.getProgramParameter = () => false;
  const cache = new ProgramCache(gl);
  assert.equal(cache.get("bad"), null);
  assert.equal(cache.get("bad"), null); // cached failure
  assert.equal(gl.calls.filter((c) => c === "createProgram").length, 1);
});

test("TexturePool reuses released handles by exact dims", () => {
  const gl = fakeGL();
  const pool = new TexturePool(gl);
  const a = pool.acquire(4, 4);
  pool.release(a);
  const b = pool.acquire(4, 4);
  assert.equal(b, a);                          // reused
  const c = pool.acquire(8, 8);
  assert.notEqual(c, a);                       // different size → new
  assert.equal(gl.calls.filter((x) => x === "createTexture").length, 2);
});

test("TexturePool double-release is a no-op; acquirePair gives two handles", () => {
  const gl = fakeGL();
  const pool = new TexturePool(gl);
  const a = pool.acquire(2, 2);
  pool.release(a);
  pool.release(a); // must not corrupt the bucket
  assert.equal(pool.freeCount, 1);
  const [p, q] = pool.acquirePair(2, 2);
  assert.equal(p, a);
  assert.notEqual(p, q);
});

test("uploadBuffer sends RGBA UNSIGNED_BYTE without premultiply or flip", () => {
  const gl = fakeGL();
  const pool = new TexturePool(gl);
  const hnd = pool.acquire(2, 1);
  uploadBuffer(gl, hnd, { data: new Uint8ClampedArray(8), width: 2, height: 1 });
  const upload = gl.calls.find((c) => Array.isArray(c) && c[0] === "texImage2D");
  assert.equal(upload[4], 2);      // width
  assert.equal(upload[5], 1);      // height
  assert.equal(upload[7], gl.RGBA);
  assert.equal(upload[8], gl.UNSIGNED_BYTE);
});

test("readBuffer allocates a same-size buffer and readPixels into it", () => {
  const gl = fakeGL();
  const out = readBuffer(gl, { fbo: {}, w: 3, h: 2 });
  assert.equal(out.data.length, 24);
  assert.equal(out.width, 3);
  assert.equal(out.height, 2);
  const read = gl.calls.find((c) => Array.isArray(c) && c[0] === "readPixels");
  assert.deepEqual(read.slice(1), [0, 0, 3, 2, gl.RGBA]);
});
