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

// Runs per-pixel step functions over the buffer in a single pass — the
// fused form of what sequential apply() calls get for free from typed-
// array writeback. Each step receives a mutable [r,g,b,a] slot array and
// must write quantized byte values into it (see color.js q8).
export function mapPixels(buffer, steps) {
  const data = buffer.data;
  const px = [0, 0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    px[0] = data[i]; px[1] = data[i + 1]; px[2] = data[i + 2]; px[3] = data[i + 3];
    for (let s = 0; s < steps.length; s++) steps[s](px);
    data[i] = px[0]; data[i + 1] = px[1]; data[i + 2] = px[2]; data[i + 3] = px[3];
  }
  return buffer;
}
