import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBuffer } from "../buffer.js";
import { dropshadow } from "../effects/dropshadow.js";
import { EFFECTS } from "../registry.js";

const pxAt = (b, x, y) => {
  const i = (y * b.width + x) * 4;
  return [...b.data.slice(i, i + 4)];
};

// Opaque 4×4 block at (bx,by) on a transparent field.
const blockSource = (w, h, bx, by, rgba = [100, 150, 200, 255]) => {
  const b = makeBuffer(w, h);
  for (let y = by; y < by + 4; y++) {
    for (let x = bx; x < bx + 4; x++) {
      const i = (y * w + x) * 4;
      b.data[i] = rgba[0]; b.data[i + 1] = rgba[1]; b.data[i + 2] = rgba[2]; b.data[i + 3] = rgba[3];
    }
  }
  return b;
};

test("shadow is offset +x/+y and keeps the colour", () => {
  const b = blockSource(20, 20, 4, 4);
  dropshadow(b, { x: 6, y: 3, blur: 0, color: "#ff0000" });
  // source block intact
  assert.deepEqual(pxAt(b, 5, 5), [100, 150, 200, 255]);
  // shadow region: source 4..7 → shadow 10..13 x, 7..10 y (minus overlap)
  assert.deepEqual(pxAt(b, 12, 9), [255, 0, 0, 255]);
  // outside both: transparent
  assert.deepEqual(pxAt(b, 0, 0), [0, 0, 0, 0]);
});

test("shadow appears under the source where they overlap", () => {
  const b = blockSource(20, 20, 4, 4);
  dropshadow(b, { x: 2, y: 0, blur: 0, color: "#ff0000" });
  // (6,5) is inside source (4..7) AND shadow (6..9) → source wins
  assert.deepEqual(pxAt(b, 6, 5), [100, 150, 200, 255]);
});

test("shadow alpha follows the silhouette's alpha", () => {
  const b = blockSource(20, 20, 4, 4, [50, 60, 70, 128]);
  dropshadow(b, { x: 8, y: 0, blur: 0, color: "#00ff00" });
  const [r, g, bl, a] = pxAt(b, 14, 5);
  assert.equal(r, 0);
  assert.equal(g, 255);
  assert.equal(bl, 0);
  assert.equal(a, 128);
});

test("blur spreads the shadow beyond the silhouette", () => {
  const b = blockSource(30, 30, 8, 8);
  dropshadow(b, { x: 0, y: 0, blur: 3, color: "#ff0000" });
  // 2px outside the block edge: silhouette alpha is 0, blurred alpha > 0
  const [r, , , a] = pxAt(b, 6, 9);
  assert.equal(r, 255);
  assert.ok(a > 0 && a < 255, `expected partial shadow alpha, got ${a}`);
});

test("negative offsets shift the shadow up/left", () => {
  const b = blockSource(20, 20, 8, 8);
  dropshadow(b, { x: -4, y: -4, blur: 0, color: "#ff0000" });
  assert.deepEqual(pxAt(b, 5, 5), [255, 0, 0, 255]);
});

test("zero offset + zero blur leaves an opaque source unchanged", () => {
  const b = blockSource(12, 12, 4, 4);
  dropshadow(b, { x: 0, y: 0, blur: 0, color: "#ff0000" });
  // Shadow sits exactly under the opaque source → source pixels unchanged,
  // and no shadow can leak past the silhouette (alpha 0 outside).
  assert.deepEqual(pxAt(b, 5, 5), [100, 150, 200, 255]);
  assert.deepEqual(pxAt(b, 0, 0), [0, 0, 0, 0]);
});

test("fully transparent source produces no shadow", () => {
  const b = makeBuffer(12, 12);
  dropshadow(b, { x: 4, y: 4, blur: 2, color: "#ff0000" });
  assert.ok(b.data.every((v) => v === 0));
});

test("registry wires apply for dropshadow", () => {
  const b = blockSource(20, 20, 4, 4);
  const before = [...b.data];
  EFFECTS.dropshadow.apply(b, { x: 6, y: 3, blur: 0, color: "#ff0000" });
  assert.notDeepEqual([...b.data], before);
});
