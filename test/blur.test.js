import { test } from "node:test";
import assert from "node:assert/strict";
import { EFFECTS } from "../registry.js";
import { gaussianBlur, gaussianKernel, blur } from "../effects/blur.js";

test("gaussian kernel weights sum to 1", () => {
  for (const sigma of [0.5, 1, 2.5, 8, 20]) {
    const { weights } = gaussianKernel(sigma);
    const sum = [...weights].reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-12, `σ=${sigma} sum=${sum}`);
  }
});

test("gaussian kernel is symmetric and centred", () => {
  const { weights, radius } = gaussianKernel(2);
  assert.equal(weights.length, radius * 2 + 1);
  for (let k = 0; k <= radius; k++) {
    assert.equal(weights[radius - k], weights[radius + k]);
  }
  assert.ok(weights[radius] > weights[radius + 1]);
});

test("kernel radius truncates at 3σ", () => {
  assert.equal(gaussianKernel(1).radius, 3);
  assert.equal(gaussianKernel(2).radius, 6);
  assert.equal(gaussianKernel(20).radius, 60);
});

test("uniform field is unchanged at any σ", () => {
  const b = {
    data: new Uint8ClampedArray(4 * 4 * 4).fill(0).map((_, i) => [120, 60, 200, 200][i % 4]),
    width: 4, height: 4,
  };
  gaussianBlur(b, 5);
  for (let i = 0; i < b.data.length; i += 4) {
    assert.equal(b.data[i], 120);
    assert.equal(b.data[i + 1], 60);
    assert.equal(b.data[i + 2], 200);
    assert.equal(b.data[i + 3], 200);
  }
});

test("3×1 impulse spreads symmetrically with clamped edges", () => {
  const b = {
    data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]),
    width: 3, height: 1,
  };
  gaussianBlur(b, 1);
  assert.deepEqual([...b.data], [62, 62, 62, 255, 102, 102, 102, 255, 62, 62, 62, 255]);
  assert.ok(b.data[4] < 255, "center must dim");
  assert.ok(b.data[0] > 0 && b.data[8] > 0, "edges must gain energy");
});

test("alpha channel is blurred too", () => {
  const b = {
    data: new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0]),
    width: 3, height: 1,
  };
  gaussianBlur(b, 1);
  assert.deepEqual([b.data[3], b.data[7], b.data[11]], [62, 102, 62]);
});

test("σ=0 is identity, tiny σ is effectively identity", () => {
  const a = { data: new Uint8ClampedArray([10, 20, 30, 40]), width: 1, height: 1 };
  gaussianBlur(a, 0);
  assert.deepEqual([...a.data], [10, 20, 30, 40]);
  gaussianBlur(a, 0.01);
  assert.deepEqual([...a.data], [10, 20, 30, 40]);
});

test("larger σ spreads energy further", () => {
  const impulse = () => ({
    data: new Uint8ClampedArray([
      0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
      0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
      0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
    ]),
    width: 3, height: 3,
  });
  const narrow = impulse();
  const wide = impulse();
  gaussianBlur(narrow, 0.5);
  gaussianBlur(wide, 3);
  const corner = (b) => b.data[0];
  assert.ok(corner(wide) > corner(narrow), "wider σ must push more energy to the corner");
});

test("blur is order-sensitive against nonlinear effects", () => {
  // NB: blur commutes with invert — both are linear and the kernel sums to 1.
  // posterize is nonlinear, so order must matter.
  const src = {
    data: new Uint8ClampedArray([30, 30, 30, 255, 200, 200, 200, 255, 30, 30, 30, 255]),
    width: 3, height: 1,
  };
  const a = { data: new Uint8ClampedArray(src.data), width: 3, height: 1 };
  const b = { data: new Uint8ClampedArray(src.data), width: 3, height: 1 };
  EFFECTS.blur.apply(a, { v: 1 });
  EFFECTS.posterize.apply(a, { steps: 4 });
  EFFECTS.posterize.apply(b, { steps: 4 });
  EFFECTS.blur.apply(b, { v: 1 });
  assert.notDeepEqual([...a.data], [...b.data]);
});

test("registry blur effect calls gaussianBlur with params.v", () => {
  assert.equal(EFFECTS.blur.apply, blur);
  const b = {
    data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]),
    width: 3, height: 1,
  };
  EFFECTS.blur.apply(b, { v: 1 });
  assert.equal(b.data[4], 102);
});
