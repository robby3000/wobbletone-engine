import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLEND_MODES, blendChannel, blendColor, compositeOver,
  clipColor, setLum, setSat,
} from "../color.js";

const r4 = (v) => Math.round(v * 10000) / 10000;

/* ---------- separable modes, hand-computed from the W3C formulas ---------- */

test("normal returns the source", () => {
  assert.equal(blendChannel("normal", 0.8, 0.3), 0.3);
});

test("multiply / screen / overlay / difference match worked examples", () => {
  assert.equal(blendChannel("multiply", 0.5, 0.5), 0.25);
  assert.equal(blendChannel("screen", 0.5, 0.5), 0.75);
  assert.equal(blendChannel("overlay", 0.5, 0.5), 0.5);
  assert.equal(blendChannel("difference", 0.8, 0.3), 0.5);
});

test("overlay branches on the backdrop", () => {
  assert.equal(r4(blendChannel("overlay", 0.4, 0.5)), r4(2 * 0.4 * 0.5));
  assert.equal(r4(blendChannel("overlay", 0.8, 0.4)), r4(1 - 2 * 0.2 * 0.6));
});

test("darken / lighten / exclusion", () => {
  assert.equal(blendChannel("darken", 0.3, 0.7), 0.3);
  assert.equal(blendChannel("lighten", 0.3, 0.7), 0.7);
  assert.equal(r4(blendChannel("exclusion", 0.8, 0.3)), r4(0.8 + 0.3 - 2 * 0.8 * 0.3));
});

test("color-dodge and color-burn hit their edge cases", () => {
  assert.equal(blendChannel("color-dodge", 0.5, 1), 1);
  assert.equal(r4(blendChannel("color-dodge", 0.5, 0.25)), r4(Math.min(1, 0.5 / 0.75)));
  assert.equal(blendChannel("color-burn", 0.5, 0), 0);
  assert.equal(r4(blendChannel("color-burn", 0.9, 0.5)), r4(1 - Math.min(1, 0.1 / 0.5)));
});

test("hard-light mirrors overlay with swapped roles", () => {
  assert.equal(r4(blendChannel("hard-light", 0.3, 0.4)), r4(blendChannel("overlay", 0.4, 0.3)));
  assert.equal(r4(blendChannel("hard-light", 0.3, 0.8)), r4(blendChannel("overlay", 0.8, 0.3)));
});

test("soft-light follows the spec piecewise formula", () => {
  assert.equal(blendChannel("soft-light", 0.5, 0.5), 0.5);
  assert.equal(r4(blendChannel("soft-light", 0.5, 0)), r4(0.5 - 1 * 0.5 * 0.5));
  assert.equal(r4(blendChannel("soft-light", 0.5, 1)), r4(0.5 + (Math.sqrt(0.5) - 0.5)));
});

test("blendChannel throws on non-separable modes", () => {
  for (const mode of ["hue", "saturation", "color", "luminosity"]) {
    assert.throws(() => blendChannel(mode, 0.5, 0.5), /non-separable/);
  }
  assert.throws(() => blendChannel("bogus", 0.5, 0.5), /non-separable or unknown/);
});

/* ---------- non-separable modes ---------- */

test("blendColor handles all 16 modes", () => {
  for (const mode of BLEND_MODES) {
    const out = blendColor(mode, [0.8, 0.2, 0.4], [0.1, 0.6, 0.3]);
    assert.equal(out.length, 3, mode);
    for (const v of out) assert.ok(v >= 0 && v <= 1, `${mode} produced ${v}`);
  }
});

test("non-separable modes match computed values", () => {
  const cb = [0.8, 0.2, 0.4], cs = [0.1, 0.6, 0.3];
  assert.deepEqual(blendColor("hue", cb, cs).map(r4), [0.0216, 0.6216, 0.2616]);
  assert.deepEqual(blendColor("saturation", cb, cs).map(r4), [0.7337, 0.2337, 0.4003]);
  assert.deepEqual(blendColor("color", cb, cs).map(r4), [0.085, 0.585, 0.285]);
  assert.deepEqual(blendColor("luminosity", cb, cs).map(r4), [0.815, 0.215, 0.415]);
});

test("color mode keeps backdrop luminance, takes source chroma", () => {
  const out = blendColor("color", [0.5, 0.5, 0.5], [0.2, 0.9, 0.4]);
  // backdrop is gray → result should sit at luminance 0.5 with source's hue
  const lum = 0.3 * out[0] + 0.59 * out[1] + 0.11 * out[2];
  assert.ok(Math.abs(lum - 0.5) < 1e-9);
});

test("setSat and setLum helpers", () => {
  assert.deepEqual(setSat([0.2, 0.5, 0.9], 0.6).map(r4), [0, 0.2571, 0.6]);
  assert.deepEqual(setSat([0.5, 0.5, 0.5], 0.6), [0, 0, 0]);
  const relumed = setLum([0.2, 0.4, 0.6], 0.5);
  assert.ok(Math.abs((0.3 * relumed[0] + 0.59 * relumed[1] + 0.11 * relumed[2]) - 0.5) < 1e-9);
});

test("clipColor pulls out-of-range channels back", () => {
  const clipped = clipColor([-0.2, 0.5, 1.4]);
  for (const v of clipped) assert.ok(v >= -1e-9 && v <= 1 + 1e-9, `channel ${v} out of range`);
});

/* ---------- compositeOver ---------- */

const buf = (px) => ({ data: new Uint8ClampedArray(px), width: 1, height: 1 });
const comp = (bpx, lpx, mode, op) => {
  const b = buf(bpx);
  compositeOver(b, buf(lpx), mode, op);
  return [...b.data];
};

test("opaque layer at 100% opacity replaces the backdrop", () => {
  assert.deepEqual(comp([100, 100, 100, 255], [200, 50, 10, 255], "normal", 100), [200, 50, 10, 255]);
});

test("normal blend at 50% opacity lerps halfway", () => {
  assert.deepEqual(comp([100, 100, 100, 255], [200, 200, 200, 255], "normal", 50), [150, 150, 150, 255]);
});

test("multiply and screen on mid-gray bytes", () => {
  assert.deepEqual(comp([128, 128, 128, 255], [128, 128, 128, 255], "multiply", 100), [64, 64, 64, 255]);
  assert.deepEqual(comp([128, 128, 128, 255], [128, 128, 128, 255], "screen", 100), [192, 192, 192, 255]);
});

test("blend is suppressed where the backdrop is transparent", () => {
  // αb = 0 → output is the layer colour verbatim, blend mode irrelevant
  assert.deepEqual(comp([0, 0, 0, 0], [200, 50, 10, 255], "multiply", 100), [200, 50, 10, 255]);
});

test("semi-transparent backdrop blends toward the blended source", () => {
  assert.deepEqual(comp([100, 100, 100, 128], [200, 200, 200, 255], "normal", 100), [200, 200, 200, 255]);
});

test("semi-transparent layer scales its contribution", () => {
  assert.deepEqual(comp([100, 100, 100, 255], [200, 200, 200, 128], "normal", 100), [150, 150, 150, 255]);
});

test("fully transparent composite yields zeros", () => {
  assert.deepEqual(comp([0, 0, 0, 0], [9, 9, 9, 0], "normal", 100), [0, 0, 0, 0]);
});

test("hue mode composites through blendColor", () => {
  assert.deepEqual(comp([204, 51, 102, 255], [26, 153, 77, 255], "hue", 100), [5, 158, 67, 255]);
});

test("compositeOver mutates backdrop and returns it", () => {
  const b = buf([1, 2, 3, 255]);
  const out = compositeOver(b, buf([200, 200, 200, 255]), "normal", 100);
  assert.equal(out, b);
  assert.equal(b.data[0], 200);
});

test("compositeOver rejects size mismatches", () => {
  const b = { data: new Uint8ClampedArray(8), width: 2, height: 1 };
  const l = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
  assert.throws(() => compositeOver(b, l, "normal", 100), /size mismatch/);
});
