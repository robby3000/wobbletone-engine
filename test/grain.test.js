import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBuffer } from "../buffer.js";
import { grain, grainCell, grainValue, GRAIN_CELL_SCALE } from "../effects/grain.js";
import { EFFECTS } from "../registry.js";

const filled = (rgba, w, h) => {
  const b = makeBuffer(w, h);
  for (let i = 0; i < b.data.length; i += 4) {
    b.data[i] = rgba[0]; b.data[i + 1] = rgba[1]; b.data[i + 2] = rgba[2]; b.data[i + 3] = rgba[3];
  }
  return b;
};

test("grainCell is deterministic for a given (seed, i, j)", () => {
  assert.equal(grainCell(42, 3, 7), grainCell(42, 3, 7));
  assert.notEqual(grainCell(42, 3, 7), grainCell(42, 4, 7));
  assert.notEqual(grainCell(42, 3, 7), grainCell(42, 3, 8));
  assert.notEqual(grainCell(42, 3, 7), grainCell(43, 3, 7));
});

test("grainCell stays in [0, 1)", () => {
  for (let i = 0; i < 20; i++) {
    const v = grainCell(7, i, i * 3);
    assert.ok(v >= 0 && v < 1, `cell ${i} out of range: ${v}`);
  }
});

test("grainValue interpolates between lattice corners", () => {
  // cellPx=4, pixel (6,0): gx=1.5, gy=0 → cells (1,0) and (2,0) at fx=0.5, fy=0
  const v = grainValue(5, 6, 0, 4);
  const expected = (grainCell(5, 1, 0) + grainCell(5, 2, 0)) * 0.5;
  assert.ok(Math.abs(v - expected) < 1e-12, `${v} !== ${expected}`);
});

test("grainValue at a lattice corner equals the corner cell", () => {
  // x=8, y=4 with cellPx=4 → exact corner (2,1)
  const v = grainValue(9, 8, 4, 4);
  assert.ok(Math.abs(v - grainCell(9, 2, 1)) < 1e-12);
});

test("grainValue stays in [0, 1] for arbitrary positions", () => {
  for (let x = 0; x < 37; x += 1.3) {
    for (let y = 0; y < 29; y += 1.7) {
      const v = grainValue(3, x, y, 5.5);
      assert.ok(v >= 0 && v <= 1, `(${x},${y}) → ${v}`);
    }
  }
});

test("same seed produces identical output; different seed differs", () => {
  const a = filled([128, 128, 128, 255], 32, 24);
  const b = filled([128, 128, 128, 255], 32, 24);
  grain(a, { size: 4, seed: 7, blend: "overlay", opacity: 100 });
  grain(b, { size: 4, seed: 7, blend: "overlay", opacity: 100 });
  assert.deepEqual([...a.data], [...b.data]);
  grain(b, { size: 4, seed: 8, blend: "overlay", opacity: 100 });
  assert.notDeepEqual([...a.data], [...b.data]);
});

test("cell edge is size × 200/180 — doubling size doubles cellPx", () => {
  // grainValue with cellPx 2C at pixel (2x) must equal cellPx C at pixel (x)
  // shifted lattice phase aside, the shared contract: same (seed, i, j) lattice.
  const seed = 11;
  const C = 6;
  // pixel x=12 with cellPx 12 → grid 1.0; x=6 with cellPx 6 → grid 1.0. Both at
  // lattice corner (1, 0) — equal values.
  assert.ok(Math.abs(grainValue(seed, 12, 0, 2 * C) - grainValue(seed, 6, 0, C)) < 1e-12);
  assert.equal(GRAIN_CELL_SCALE, 200 / 180);
});

test("grain composites through blend+opacity: opacity 0 is identity", () => {
  const b = filled([200, 100, 50, 255], 16, 16);
  const before = [...b.data];
  grain(b, { size: 4, seed: 1, blend: "overlay", opacity: 0 });
  assert.deepEqual([...b.data], before);
});

test("grain normal blend at 100% replaces pixels with gray noise", () => {
  const b = filled([10, 20, 30, 255], 8, 8);
  grain(b, { size: 3, seed: 4, blend: "normal", opacity: 100 });
  for (let i = 0; i < b.data.length; i += 4) {
    assert.equal(b.data[i], b.data[i + 1]);
    assert.equal(b.data[i + 1], b.data[i + 2]);
    assert.equal(b.data[i + 3], 255);
  }
});

test("grain modifies the image under a non-normal blend", () => {
  const b = filled([128, 128, 128, 255], 24, 24);
  const before = [...b.data];
  grain(b, { size: 4, seed: 2, blend: "overlay", opacity: 100 });
  assert.notDeepEqual([...b.data], before);
});

test("registry wires apply for grain", () => {
  const b = filled([128, 128, 128, 255], 8, 8);
  const before = [...b.data];
  EFFECTS.grain.apply(b, { size: 4, seed: 1, blend: "overlay", opacity: 80 });
  assert.notDeepEqual([...b.data], before);
});
