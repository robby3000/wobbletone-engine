import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBuffer, cloneBuffer } from "../buffer.js";
import { renderBuffer } from "../render.js";
import { createSpec } from "../spec.js";
import { gaussianBlur } from "../effects/blur.js";
import { brightness } from "../effects/pointwise.js";

const filled = (rgba, w, h) => {
  const b = makeBuffer(w, h);
  for (let i = 0; i < b.data.length; i += 4) {
    b.data[i] = rgba[0]; b.data[i + 1] = rgba[1]; b.data[i + 2] = rgba[2]; b.data[i + 3] = rgba[3];
  }
  return b;
};

const ramp = (w, h) => {
  const b = makeBuffer(w, h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      b.data[i] = (x * 7) % 256;
      b.data[i + 1] = (x * 3 + y * 5) % 256;
      b.data[i + 2] = 200;
      b.data[i + 3] = 255;
    }
  }
  return b;
};

test("input buffer is not mutated; a new buffer is returned", () => {
  const b = filled([100, 150, 200, 255], 8, 8);
  const before = [...b.data];
  const out = renderBuffer(b, createSpec([{ type: "invert", params: { v: 100 } }]));
  assert.deepEqual([...b.data], before);
  assert.notEqual(out, b);
  assert.equal(out.data[0], 155);
});

test("px params are scaled by renderScale (blur v=8 at 0.25 → σ=2)", () => {
  const b = ramp(40, 8);
  const spec = createSpec([{ type: "blur", params: { v: 8 } }]);
  const rendered = renderBuffer(b, spec, { sourceWidth: 160 }); // scale 0.25
  const expected = cloneBuffer(b);
  gaussianBlur(expected, 2);
  assert.deepEqual([...rendered.data], [...expected.data]);
});

test("renderScale 1 (default sourceWidth) leaves px params untouched", () => {
  const b = ramp(30, 6);
  const spec = createSpec([{ type: "blur", params: { v: 3 } }]);
  const rendered = renderBuffer(b, spec);
  const expected = cloneBuffer(b);
  gaussianBlur(expected, 3);
  assert.deepEqual([...rendered.data], [...expected.data]);
});

test("non-px params pass through unscaled", () => {
  const b = filled([100, 150, 200, 255], 8, 8);
  const spec = createSpec([{ type: "brightness", params: { v: 110 } }]);
  const rendered = renderBuffer(b, spec, { sourceWidth: 32 }); // scale 0.25
  const expected = filled([100, 150, 200, 255], 8, 8);
  brightness(expected, { v: 110 });
  assert.deepEqual([...rendered.data], [...expected.data]);
});

test("effects apply in spec order (nonlinear order sensitivity)", () => {
  // blur+posterize: posterize quantization is nonlinear so the pair does not
  // commute. (invert+posterize *does* — its levels 0/85/170/255 are symmetric
  // around 127.5 — so it's useless as an order probe.)
  const specA = createSpec([
    { type: "blur", params: { v: 2 } },
    { type: "posterize", params: { steps: 4 } },
  ]);
  const specB = createSpec([
    { type: "posterize", params: { steps: 4 } },
    { type: "blur", params: { v: 2 } },
  ]);
  const a = renderBuffer(ramp(32, 8), specA);
  const b = renderBuffer(ramp(32, 8), specB);
  assert.notDeepEqual([...a.data], [...b.data]);
});

test("ctx.renderScale reaches effects with derived px (glitch)", () => {
  const params = { style: "CCD Failure", amount: 80, bandSize: 30, split: 8, seed: 42 };
  const spec = createSpec([{ type: "glitch", params }]);
  const a = renderBuffer(ramp(64, 32), spec);                    // scale 1
  const b = renderBuffer(ramp(64, 32), spec, { sourceWidth: 32 }); // scale 2
  assert.notDeepEqual([...a.data], [...b.data]);
});

test("collectStats fills {ms, passes, perEffect}", () => {
  const spec = createSpec([
    { type: "invert", params: { v: 100 } },
    { type: "sepia", params: { v: 50 } },
  ]);
  const options = { collectStats: true };
  renderBuffer(filled([10, 20, 30, 255], 8, 8), spec, options);
  const s = options.stats;
  assert.ok(s.ms >= 0);
  assert.equal(s.passes, 2);
  assert.equal(s.perEffect.length, 2);
  assert.equal(s.perEffect[0].type, "invert");
  assert.equal(s.perEffect[1].type, "sepia");
  assert.ok(s.perEffect.every((e) => e.ms >= 0));
});

test("empty spec returns an unchanged clone", () => {
  const b = ramp(16, 16);
  const out = renderBuffer(b, createSpec([]));
  assert.deepEqual([...out.data], [...b.data]);
});

test("invalid spec throws before touching the buffer", () => {
  const b = filled([1, 2, 3, 255], 4, 4);
  assert.throws(() => renderBuffer(b, { format: "wrong", version: 1, effects: [] }), /format/i);
  assert.throws(
    () => renderBuffer(b, createSpec([{ type: "no-such-effect", params: {} }])),
    /unknown effect/i,
  );
});
