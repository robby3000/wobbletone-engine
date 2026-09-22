// Buffer = { data: Uint8ClampedArray, width, height }
// RGBA, straight (non-premultiplied) alpha, sRGB-encoded values.

export function makeBuffer(width, height) {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

export function cloneBuffer(buffer) {
  return {
    data: new Uint8ClampedArray(buffer.data),
    width: buffer.width,
    height: buffer.height,
  };
}
