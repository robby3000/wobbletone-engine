import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBuffer } from "../buffer.js";
import { bloom } from "../effects/bloom.js";
import { EFFECTS } from "../registry.js";

const filled = (rgba, w, h) => {
  const b = makeBuffer(w, h);
  for (let i = 0; i < b.data.length; i += 4) {
    b.data[i] = rgba[0]; b.data[i + 1] = rgba[1]; b.data[i + 2] = rgba[2]; b.data[i + 3] = rgba[3];
  }
  return b;
};

const PARAMS = {
  blur: 4, threshold: 140, contrast: 180, saturate: 100,
  opacity: 50, color: "#ffffff", tint: 0, blend: "screen",
};

test("opacity 0 is identity", () => {
  const b = filled([100, 150, 200, 255], 16, 16);
  const before = [...b.data];
  bloom(b, { ...PARAMS, opacity: 0 });
  assert.deepEqual([...b.data], before);
});

test("lighten blend with a darkened copy leaves mid-gray unchanged", () => {
  // threshold 50% → copy darkened below input; lighten picks the max → input.
  const b = filled([128, 128, 128, 255], 16, 16);
  bloom(b, { ...PARAMS, threshold: 50, blend: "lighten", opacity: 100, blur: 0 });
  for (let i = 0; i < b.data.length; i += 4) {
    assert.equal(b.data[i], 128);
  }
});

test("bright source + screen blend is strictly brighter", () => {
  const b = filled([250, 250, 250, 255], 16, 16);
  bloom(b, { ...PARAMS, opacity: 100 });
  for (let i = 0; i < b.data.length; i += 4) {
    assert.ok(b.data[i] > 250, `channel ${i % 4} = ${b.data[i]}`);
  }
});

test("black source stays black through the whole pipeline", () => {
  const b = filled([0, 0, 0, 255], 16, 16);
  bloom(b, { ...PARAMS, opacity: 100 });
  for (let i = 0; i < b.data.length; i += 4) {
    assert.equal(b.data[i], 0);
  }
});

test("tint 0 vs 100 differ", () => {
  // Copy must stay mid-luminance — a white copy is unaffected by the `color`
  // blend because white is the only colour with luminance 1.
  const a = filled([180, 180, 180, 255], 16, 16);
  const b = filled([180, 180, 180, 255], 16, 16);
  const mid = { ...PARAMS, threshold: 100, contrast: 100, blur: 0, opacity: 100 };
  bloom(a, { ...mid, tint: 0, color: "#ff0000" });
  bloom(b, { ...mid, tint: 100, color: "#ff0000" });
  assert.notDeepEqual([...a.data], [...b.data]);
});

test("tint shifts the bloom copy toward the tint hue", () => {
  const b = filled([180, 180, 180, 255], 16, 16);
  bloom(b, { ...PARAMS, tint: 100, color: "#ff0000", opacity: 100, blur: 0, threshold: 100, contrast: 100 });
  // color-blend of pure red onto a gray copy → red channel dominates
  assert.ok(b.data[0] > b.data[1] && b.data[0] > b.data[2],
    `expected red dominance, got ${b.data[0]},${b.data[1]},${b.data[2]}`);
});

test("higher threshold produces a stronger bloom", () => {
  const a = filled([120, 120, 120, 255], 16, 16);
  const b = filled([120, 120, 120, 255], 16, 16);
  bloom(a, { ...PARAMS, threshold: 50, opacity: 100 });
  bloom(b, { ...PARAMS, threshold: 400, opacity: 100 });
  assert.ok(b.data[0] > a.data[0], `${b.data[0]} should exceed ${a.data[0]}`);
});

test("blur spreads a bright point beyond its source pixel", () => {
  const b = filled([0, 0, 0, 255], 21, 21);
  const c = (10 * 21 + 10) * 4;
  b.data[c] = b.data[c + 1] = b.data[c + 2] = 255;
  bloom(b, { ...PARAMS, blur: 6, threshold: 300, contrast: 100, opacity: 100 });
  const edge = (10 * 21 + 8) * 4; // 2px from centre: 255·g(2)·g(0) ≈ 1.07 → 1
  assert.ok(b.data[edge] > 0, "bloom should reach pixels away from the source");
});

test("bloom mutates in place and returns the buffer", () => {
  const b = filled([200, 100, 50, 255], 8, 8);
  const out = bloom(b, PARAMS);
  assert.equal(out, b);
});

test("registry wires apply for bloom", () => {
  const b = filled([220, 220, 220, 255], 12, 12);
  const before = [...b.data];
  EFFECTS.bloom.apply(b, PARAMS);
  assert.notDeepEqual([...b.data], before);
});
