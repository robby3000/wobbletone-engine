// gl/readback.js — CPU buffer <-> GPU texture transfers.
//
// Straight alpha end to end: premultiply upload is disabled, and RGBA8
// framebuffer storage is unmultiplied, so readPixels returns the stored
// bytes verbatim. Row order: texImage2D row 0 = v 0 = framebuffer row 0
// = readPixels row 0 — a passthrough roundtrip is byte-identical.

export function uploadBuffer(gl, hnd, buffer) {
  gl.bindTexture(gl.TEXTURE_2D, hnd.tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA, buffer.width, buffer.height, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, buffer.data
  );
}

export function readBuffer(gl, hnd, out = null) {
  const data = out || new Uint8ClampedArray(hnd.w * hnd.h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, hnd.fbo);
  gl.readPixels(0, 0, hnd.w, hnd.h, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return { data, width: hnd.w, height: hnd.h };
}
