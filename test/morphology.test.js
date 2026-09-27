import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBuffer } from "../buffer.js";
import { morphology } from "../effects/morphology.js";
import { EFFECTS } from "../registry.js";

const PARAMS = { op: "dilate", radiusX: 1, radiusY: 1, input: "graphic" };

// Single bright pixel on black.
const dot = (w, h, px, py, v = 255) => {
  const b = makeBuffer(w, h);
  const i = (py * w + px) * 4;
  b.data[i] = b.data[i + 1] = b.data[i + 2] = v;
  b.data[i + 3] = 255;
  for (let p = 0; p < w * h; p++) b.data[p * 4 + 3] = 255; // opaque field
  return b;
};

const brightCount = (b, thresh = 128) => {
  let n = 0;
  for (let i = 0; i < b.data.length; i += 4) if (b.data[i] > thresh) n++;
  return n;
};

test("single pixel + dilate r=1 → 3×3 block", () => {
  const b = dot(9, 9, 4, 4);
  morphology(b, PARAMS);
  assert.equal(brightCount(b), 9);
});

test("erode removes a lone bright pixel", () => {
  const b = dot(9, 9, 4, 4);
  morphology(b, { ...PARAMS, op: "erode" });
  assert.equal(brightCount(b), 0);
});

test("dilate r=0 both axes is identity", () => {
  const b = dot(9, 9, 4, 4);
  const before = [...b.data];
  morphology(b, { ...PARAMS, radiusX: 0, radiusY: 0 });
  assert.deepEqual([...b.data], before);
});

test("independent X/Y radii produce rectangles", () => {
  const b = dot(11, 11, 5, 5);
  morphology(b, { ...PARAMS, radiusX: 3, radiusY: 0 });
  // 7-wide horizontal streak, single row.
  assert.equal(brightCount(b), 7);
});

test("alpha-only input leaves RGB untouched", () => {
  const b = dot(9, 9, 4, 4);
  const rgbBefore = [];
  for (let i = 0; i < b.data.length; i += 4) rgbBefore.push(b.data[i], b.data[i + 1], b.data[i + 2]);
  morphology(b, { ...PARAMS, input: "alpha", op: "erode", radiusX: 1, radiusY: 1 });
  const rgbAfter = [];
  for (let i = 0; i < b.data.length; i += 4) rgbAfter.push(b.data[i], b.data[i + 1], b.data[i + 2]);
  assert.deepEqual(rgbAfter, rgbBefore);
});

test("alpha erode shrinks an opaque region", () => {
  const b = makeBuffer(11, 11);
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
    const i = (y * 11 + x) * 4;
    b.data[i + 3] = (x >= 3 && x <= 7 && y >= 3 && y <= 7) ? 255 : 0;
  }
  morphology(b, { ...PARAMS, input: "alpha", op: "erode", radiusX: 1, radiusY: 1 });
  // Opaque 5×5 shrinks to 3×3 (corners eroded).
  let opaque = 0;
  for (let p = 0; p < 11 * 11; p++) if (b.data[p * 4 + 3] === 255) opaque++;
  assert.equal(opaque, 9);
});

test("edge clamping extends edge values (dilate a border pixel)", () => {
  const b = dot(9, 9, 0, 0); // bright pixel at corner
  morphology(b, PARAMS);
  // Corner pixel's window clamps: bright covers 2×2 corner block.
  assert.equal(brightCount(b), 4);
});

test("registry wires apply for morphology", () => {
  const b = dot(9, 9, 4, 4);
  EFFECTS.morphology.apply(b, PARAMS, { renderScale: 1 });
  assert.equal(brightCount(b), 9);
});
