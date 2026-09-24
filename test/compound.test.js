import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBuffer } from "../buffer.js";
import { infrared, vintage, psychedelic } from "../effects/compound.js";
import { invert, hue, saturate, sepia, contrast, brightness } from "../effects/pointwise.js";
import { solarize, hueband } from "../effects/tone.js";
import { EFFECTS } from "../registry.js";

const filled = (rgba, w, h) => {
  const b = makeBuffer(w, h);
  for (let i = 0; i < b.data.length; i += 4) {
    b.data[i] = rgba[0]; b.data[i + 1] = rgba[1]; b.data[i + 2] = rgba[2]; b.data[i + 3] = rgba[3];
  }
  return b;
};

const manual = (steps, rgba) => {
  const b = filled(rgba, 4, 4);
  for (const [fn, v] of steps) fn(b, { v });
  return b;
};

test("infrared equals invert → hue-rotate → saturate applied manually", () => {
  const intensity = 70;
  const i = intensity / 100;
  const expected = manual(
    [[invert, i * 100], [hue, 180 * i], [saturate, 120 + 80 * i]],
    [120, 60, 200, 255],
  );
  const b = filled([120, 60, 200, 255], 4, 4);
  infrared(b, { intensity });
  assert.deepEqual([...b.data], [...expected.data]);
});

test("infrared(0) still saturates — not identity", () => {
  const b = filled([200, 100, 50, 255], 4, 4);
  const before = [...b.data];
  infrared(b, { intensity: 0 }); // invert(0)+hue(0) are identity; saturate(120) is not
  assert.notDeepEqual([...b.data], before);
  const expected = manual([[saturate, 120]], [200, 100, 50, 255]);
  assert.deepEqual([...b.data], [...expected.data]);
});

test("vintage equals sepia → contrast → saturate → brightness manually", () => {
  const params = { sepia: 45, contrast: 95, saturate: 80, brightness: 105 };
  const expected = manual(
    [[sepia, 45], [contrast, 95], [saturate, 80], [brightness, 105]],
    [60, 140, 90, 255],
  );
  const b = filled([60, 140, 90, 255], 4, 4);
  vintage(b, params);
  assert.deepEqual([...b.data], [...expected.data]);
});

test("psychedelic with bands/solarize off equals saturate → contrast manually", () => {
  const expected = manual([[saturate, 280], [contrast, 130]], [30, 200, 120, 255]);
  const b = filled([30, 200, 120, 255], 4, 4);
  psychedelic(b, { saturate: 280, contrast: 130, bands: 0, solarize: 0 });
  assert.deepEqual([...b.data], [...expected.data]);
});

test("psychedelic full recipe equals saturate → contrast → solarize → hueband", () => {
  const params = { saturate: 280, contrast: 130, bands: 6, solarize: 50 };
  const expected = filled([30, 200, 120, 255], 4, 4);
  saturate(expected, { v: 280 });
  contrast(expected, { v: 130 });
  solarize(expected, { amount: 50, threshold: 50 });
  hueband(expected, { bands: 6, spread: 0 });
  const b = filled([30, 200, 120, 255], 4, 4);
  psychedelic(b, params);
  assert.deepEqual([...b.data], [...expected.data]);
});

test("compounds preserve alpha", () => {
  const b = filled([120, 60, 200, 128], 4, 4);
  infrared(b, { intensity: 80 });
  for (let i = 3; i < b.data.length; i += 4) assert.equal(b.data[i], 128);
});

test("registry wires apply for all three compounds", () => {
  for (const [type, params] of [
    ["infrared", { intensity: 70 }],
    ["vintage", { sepia: 45, contrast: 95, saturate: 80, brightness: 105 }],
    ["psychedelic", { saturate: 280, contrast: 130, bands: 6, solarize: 50 }],
  ]) {
    const b = filled([120, 60, 200, 255], 4, 4);
    const before = [...b.data];
    EFFECTS[type].apply(b, params);
    assert.notDeepEqual([...b.data], before, `${type} did not modify buffer`);
  }
});
