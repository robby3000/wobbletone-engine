import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBuffer } from "../buffer.js";
import { liquid } from "../effects/liquid.js";
import { EFFECTS } from "../registry.js";

const filled = (rgba, w, h) => {
  const b = makeBuffer(w, h);
  for (let i = 0; i < b.data.length; i += 4) {
    b.data[i] = rgba[0]; b.data[i + 1] = rgba[1]; b.data[i + 2] = rgba[2]; b.data[i + 3] = rgba[3];
  }
  return b;
};

const PARAMS = {
  intensity: 60, waveX: 30, waveY: 30, flow: "organic", noise: "fractal",
  octaves: 2, seed: 5, softness: 0, highlight: 0, mix: 0,
};

// Vertical-gradient fixture: displacement along Y visibly shifts rows.
const ramp = (w, h) => {
  const b = makeBuffer(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      b.data[i] = Math.round((y / (h - 1)) * 255);
      b.data[i + 1] = Math.round((x / (w - 1)) * 255);
      b.data[i + 2] = 128;
      b.data[i + 3] = 255;
    }
  }
  return b;
};

test("intensity 0 is identity", () => {
  const b = ramp(16, 16);
  const before = [...b.data];
  liquid(b, { ...PARAMS, intensity: 0 });
  assert.deepEqual([...b.data], before);
});

test("same seed produces identical output; different seed differs", () => {
  const a = ramp(24, 24);
  const b = ramp(24, 24);
  liquid(a, PARAMS);
  liquid(b, PARAMS);
  assert.deepEqual([...a.data], [...b.data]);
  liquid(b, { ...PARAMS, seed: 6 });
  assert.notDeepEqual([...a.data], [...b.data]);
});

test("flat-colour image is unchanged by displacement", () => {
  // Every displaced sample of a uniform field lands on the same colour.
  const b = filled([90, 140, 60, 255], 20, 20);
  const before = [...b.data];
  liquid(b, PARAMS);
  assert.deepEqual([...b.data], before);
});

test("displacement actually moves pixels", () => {
  const b = ramp(24, 24);
  const before = [...b.data];
  liquid(b, PARAMS);
  assert.notDeepEqual([...b.data], before);
});

test("mix=100 returns the original image", () => {
  const b = ramp(20, 20);
  const before = [...b.data];
  liquid(b, { ...PARAMS, mix: 100 });
  assert.deepEqual([...b.data], before);
});

test("each flow mode produces output and stays in range", () => {
  for (const flow of ["horizontal", "vertical", "diagonal", "radial", "organic"]) {
    const b = ramp(20, 20);
    liquid(b, { ...PARAMS, flow });
    assert.ok(b.data.every((v) => v >= 0 && v <= 255), `flow ${flow}`);
  }
});

test("horizontal flow does not displace along Y", () => {
  // A horizontally-uniform image displaced only in X is unchanged.
  const b = makeBuffer(20, 20);
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 20; x++) {
      const i = (y * 20 + x) * 4;
      const v = Math.round((y / 19) * 255); // varies by row only
      b.data[i] = v; b.data[i + 1] = v; b.data[i + 2] = v; b.data[i + 3] = 255;
    }
  }
  const before = [...b.data];
  liquid(b, { ...PARAMS, flow: "horizontal" });
  assert.deepEqual([...b.data], before);
});

test("turbulence noise produces a different field than fractal", () => {
  const a = ramp(24, 24);
  const b = ramp(24, 24);
  liquid(a, { ...PARAMS, noise: "fractal" });
  liquid(b, { ...PARAMS, noise: "turbulence" });
  assert.notDeepEqual([...a.data], [...b.data]);
});

test("highlight adds energy", () => {
  const a = ramp(24, 24);
  const b = ramp(24, 24);
  liquid(a, PARAMS);
  liquid(b, { ...PARAMS, highlight: 80 });
  let sumA = 0, sumB = 0;
  for (let i = 0; i < a.data.length; i += 4) { sumA += a.data[i]; sumB += b.data[i]; }
  assert.ok(sumB > sumA, `${sumB} !> ${sumA}`);
});

test("softness blurs the displaced result", () => {
  const a = ramp(24, 24);
  const b = ramp(24, 24);
  liquid(a, PARAMS);
  liquid(b, { ...PARAMS, softness: 2 });
  assert.notDeepEqual([...a.data], [...b.data]);
});

test("registry wires apply for liquid", () => {
  const b = ramp(12, 12);
  const before = [...b.data];
  EFFECTS.liquid.apply(b, PARAMS, { renderScale: 1 });
  assert.notDeepEqual([...b.data], before);
});
