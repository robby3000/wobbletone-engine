import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBuffer } from "../buffer.js";
import { specular } from "../effects/specular.js";
import { EFFECTS } from "../registry.js";

const PARAMS = {
  surfaceScale: 2, strength: 40, shininess: 25, color: "#ffffff",
  azimuth: 315, elevation: 45, bumpBlur: 0, source: "luminance",
  blend: "screen", opacity: 100,
};

const filled = (rgba, w, h) => {
  const b = makeBuffer(w, h);
  for (let i = 0; i < b.data.length; i += 4) {
    b.data[i] = rgba[0]; b.data[i + 1] = rgba[1]; b.data[i + 2] = rgba[2]; b.data[i + 3] = rgba[3];
  }
  return b;
};

// Horizontal luminance ramp: dark left → bright right. The "slope" faces
// -x (downhill toward the left) so a light at azimuth 180 (from the left)
// strikes it; azimuth 0 sees the slope's back.
const rampX = (w, h) => {
  const b = makeBuffer(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = Math.round((x / (w - 1)) * 255);
      b.data[i] = v; b.data[i + 1] = v; b.data[i + 2] = v; b.data[i + 3] = 255;
    }
  }
  return b;
};

test("flat field gets zero highlight", () => {
  const b = filled([128, 128, 128, 255], 16, 16);
  const before = [...b.data];
  specular(b, PARAMS);
  assert.deepEqual([...b.data], before);
});

test("strength 0 is identity", () => {
  const b = rampX(16, 16);
  const before = [...b.data];
  specular(b, { ...PARAMS, strength: 0 });
  assert.deepEqual([...b.data], before);
});

test("a sloped field highlights more facing the light than away", () => {
  const lit = rampX(32, 16);
  const away = rampX(32, 16);
  // Light from azimuth 180 (left) hits the left-facing slope;
  // azimuth 0 (right) sees its back.
  specular(lit, { ...PARAMS, azimuth: 180, elevation: 30 });
  specular(away, { ...PARAMS, azimuth: 0, elevation: 30 });
  const sum = (b) => { let s = 0; for (let i = 0; i < b.data.length; i += 4) s += b.data[i]; return s; };
  assert.ok(sum(lit) > sum(away), `${sum(lit)} !> ${sum(away)}`);
});

test("color tints the highlight", () => {
  const warm = rampX(32, 16);
  const cool = rampX(32, 16);
  specular(warm, { ...PARAMS, color: "#ff8800", azimuth: 180, strength: 80 });
  specular(cool, { ...PARAMS, color: "#0088ff", azimuth: 180, strength: 80 });
  // Warm-lit pixels gain red; cool-lit gain blue.
  const i = (8 * 32 + 16) * 4; // row 8, col 16 — mid-slope
  assert.ok(warm.data[i] > warm.data[i + 2], `warm r ${warm.data[i]} !> b ${warm.data[i + 2]}`);
  assert.ok(cool.data[i + 2] > cool.data[i], `cool b ${cool.data[i + 2]} !> r ${cool.data[i]}`);
});

test("alpha source: transparent input yields no heightfield", () => {
  const b = makeBuffer(16, 16); // all zero → alpha 0 → flat
  specular(b, { ...PARAMS, source: "alpha" });
  assert.ok(b.data.every((v) => v === 0));
});

test("alpha source uses alpha as height", () => {
  const b = makeBuffer(32, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      b.data[i] = 200; b.data[i + 1] = 200; b.data[i + 2] = 200;
      b.data[i + 3] = Math.round((x / 31) * 255); // alpha ramp
    }
  }
  const before = [...b.data];
  specular(b, { ...PARAMS, source: "alpha", azimuth: 180, strength: 80 });
  assert.notDeepEqual([...b.data], before);
});

test("bumpBlur softens the field (different result)", () => {
  const a = rampX(32, 16);
  const b = rampX(32, 16);
  specular(a, { ...PARAMS, azimuth: 180 });
  specular(b, { ...PARAMS, azimuth: 180, bumpBlur: 3 });
  assert.notDeepEqual([...a.data], [...b.data]);
});

test("opacity 0 is identity", () => {
  const b = rampX(16, 16);
  const before = [...b.data];
  specular(b, { ...PARAMS, azimuth: 180, opacity: 0 });
  assert.deepEqual([...b.data], before);
});

test("registry wires apply for specular", () => {
  const b = rampX(16, 16);
  const before = [...b.data];
  EFFECTS.specular.apply(b, { ...PARAMS, azimuth: 180 });
  assert.notDeepEqual([...b.data], before);
});
