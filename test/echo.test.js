import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBuffer } from "../buffer.js";
import { echo } from "../effects/echo.js";
import { EFFECTS } from "../registry.js";

const PARAMS = {
  count: 2, distance: 4, direction: 0, decay: 55, blur: 0,
  blend: "normal", opacity: 60,
};

// A single bright vertical stripe — echoes drag it sideways.
const stripe = (w = 24, h = 16, sx = 6) => {
  const b = makeBuffer(w, h);
  for (let y = 0; y < h; y++) {
    const i = (y * w + sx) * 4;
    b.data[i] = b.data[i + 1] = b.data[i + 2] = 255;
  }
  for (let p = 0; p < w * h; p++) b.data[p * 4 + 3] = 255;
  return b;
};

const lumAt = (b, x, y) => b.data[(y * b.width + x) * 4];

test("echo repeats the stripe at +distance", () => {
  const b = stripe();
  echo(b, PARAMS); // direction 0 → echoes to the right
  assert.ok(lumAt(b, 10, 8) > 100, `expected ghost at x=10, got ${lumAt(b, 10, 8)}`);
});

test("echo does not appear opposite the direction", () => {
  const b = stripe();
  echo(b, PARAMS);
  assert.equal(lumAt(b, 2, 8), 0); // x=6-4 is upstream of the trail
});

test("further echoes are weaker (decay)", () => {
  const b = stripe();
  echo(b, { ...PARAMS, decay: 50 });
  const near = lumAt(b, 10, 8);
  const far = lumAt(b, 14, 8);
  assert.ok(near > far, `near=${near} far=${far}`);
});

test("opacity=0 is identity", () => {
  const b = stripe();
  const before = [...b.data];
  echo(b, { ...PARAMS, opacity: 0 });
  assert.deepEqual([...b.data], before);
});

test("count=0 is identity", () => {
  const b = stripe();
  const before = [...b.data];
  echo(b, { ...PARAMS, count: 0 });
  assert.deepEqual([...b.data], before);
});

test("screen blend only brightens", () => {
  const b = stripe();
  const before = [...b.data];
  echo(b, { ...PARAMS, blend: "screen", opacity: 80 });
  for (let i = 0; i < b.data.length; i += 4) {
    assert.ok(b.data[i] >= before[i], "screen must not darken");
  }
});

test("blur spreads the ghost beyond the hard echo's footprint", () => {
  const b = stripe();
  echo(b, { ...PARAMS, blur: 3 });
  const hard = stripe();
  echo(hard, { ...PARAMS, blur: 0 });
  // Off-centre the blurred ghost is visible where the hard echo
  // samples pure background (zero).
  assert.ok(lumAt(b, 12, 8) > lumAt(hard, 12, 8),
    `blurred=${lumAt(b, 12, 8)} hard=${lumAt(hard, 12, 8)}`);
});

test("alpha is preserved", () => {
  const b = stripe();
  echo(b, PARAMS);
  for (let p = 0; p < 24 * 16; p++) assert.equal(b.data[p * 4 + 3], 255);
});

test("registry wires apply for echo", () => {
  const b = stripe();
  const before = [...b.data];
  EFFECTS.echo.apply(b, PARAMS, { renderScale: 1 });
  assert.notDeepEqual([...b.data], before);
});
