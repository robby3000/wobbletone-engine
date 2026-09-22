import { test } from "node:test";
import assert from "node:assert/strict";
import { EFFECTS } from "../registry.js";
import * as pointwise from "../effects/pointwise.js";
import { makeBuffer } from "../buffer.js";

const SRC = [80, 120, 200, 201];

function px(rgba = SRC) {
  return { data: new Uint8ClampedArray(rgba), width: 1, height: 1 };
}

function run(name, params, rgba = SRC) {
  const b = px(rgba);
  pointwise[name](b, params);
  return [...b.data];
}

const POINTWISE = ["brightness", "contrast", "saturate", "hue", "sepia", "grayscale", "invert", "opacity"];

test("known pixel values for all 8 pointwise effects", () => {
  assert.deepEqual(run("brightness", { v: 110 }), [88, 132, 220, 201]);
  assert.deepEqual(run("contrast", { v: 110 }), [75, 119, 207, 201]);
  assert.deepEqual(run("saturate", { v: 120 }), [73, 121, 217, 201]);
  assert.deepEqual(run("hue", { v: 180 }), [154, 114, 34, 201]);
  assert.deepEqual(run("sepia", { v: 100 }), [162, 144, 112, 201]);
  assert.deepEqual(run("grayscale", { v: 100 }), [117, 117, 117, 201]);
  assert.deepEqual(run("invert", { v: 100 }), [175, 135, 55, 201]);
  assert.deepEqual(run("opacity", { v: 80 }), [80, 120, 200, 161]);
});

test("clamping: brightness 200 and 0 hit the rails", () => {
  assert.deepEqual(run("brightness", { v: 200 }), [160, 240, 255, 201]);
  assert.deepEqual(run("brightness", { v: 0 }), [0, 0, 0, 201]);
});

test("identity cases leave pixels unchanged", () => {
  for (const [name, params] of [
    ["brightness", { v: 100 }],
    ["contrast", { v: 100 }],
    ["saturate", { v: 100 }],
    ["hue", { v: 0 }],
    ["sepia", { v: 0 }],
    ["grayscale", { v: 0 }],
    ["invert", { v: 0 }],
    ["opacity", { v: 100 }],
  ]) {
    assert.deepEqual(run(name, params), SRC, `${name}@${JSON.stringify(params)} should be identity`);
  }
});

test("saturate 0 equals grayscale 100", () => {
  assert.deepEqual(run("saturate", { v: 0 }), run("grayscale", { v: 100 }));
});

test("alpha preserved by every pointwise effect except opacity", () => {
  const b = px([10, 20, 30, 77]);
  for (const name of ["brightness", "contrast", "saturate", "hue", "sepia", "grayscale", "invert"]) {
    const c = px([10, 20, 30, 77]);
    pointwise[name](c, { v: 90 });
    assert.equal(c.data[3], 77, `${name} must not touch alpha`);
  }
  pointwise.opacity(b, { v: 50 });
  assert.notEqual(b.data[3], 77);
});

test("functions mutate in place and return the same buffer", () => {
  const b = px();
  const out = pointwise.invert(b, { v: 100 });
  assert.equal(out, b);
  assert.notDeepEqual([...b.data], SRC);
});

test("works across a multi-pixel buffer", () => {
  const b = { data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]), width: 2, height: 1 };
  pointwise.invert(b, { v: 100 });
  assert.deepEqual([...b.data], [255, 255, 255, 255, 0, 0, 0, 255]);
});

test("effect order matters", () => {
  const a = px();
  pointwise.brightness(a, { v: 110 });
  pointwise.invert(a, { v: 100 });
  const b = px();
  pointwise.invert(b, { v: 100 });
  pointwise.brightness(b, { v: 110 });
  assert.notDeepEqual([...a.data], [...b.data]);
});

test("registry wires apply for all 8 pointwise effects", () => {
  for (const type of POINTWISE) {
    assert.equal(typeof EFFECTS[type].apply, "function", `${type} missing apply`);
    assert.equal(EFFECTS[type].apply, pointwise[type], `${type} apply mismatch`);
  }
});

test("registry apply dispatches through the same code path", () => {
  const b = px();
  EFFECTS.sepia.apply(b, { v: 60 });
  assert.deepEqual([...b.data], [129, 134, 147, 201]);
});

test("transparent pixels stay transparent under colour ops", () => {
  const b = px([100, 150, 200, 0]);
  pointwise.sepia(b, { v: 100 });
  assert.equal(b.data[3], 0);
});
