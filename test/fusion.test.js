// Fusion correctness: a fused pixel-local run must be byte-identical to
// the same effects applied one buffer-walk each (options.fuse === false
// keeps the unfused path reachable for exactly this check).

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBuffer, planRuns, expandEffects } from "../render.js";
import { createSpec } from "../spec.js";
import { EFFECTS, EFFECT_TYPES, isPixelLocal } from "../registry.js";
import { seededRandom } from "../rng.js";
import { cloneBuffer } from "../buffer.js";
import { CASES, FIXTURES } from "./fixtures.js";
import { infrared, vintage, psychedelic } from "../effects/compound.js";

const PIXEL_LOCAL = [
  "brightness", "contrast", "saturate", "hue", "sepia", "grayscale", "invert", "opacity",
  "duotone", "tritone", "posterize", "solarize", "hueband", "heatmap", "shadowshighlights",
];

const specOf = (effects) => createSpec(effects);

function defaultParams(type, rand = null) {
  const params = {};
  for (const [key, p] of Object.entries(EFFECTS[type].params)) {
    if (p.kind === "number" && rand) params[key] = p.min + rand() * (p.max - p.min);
    else params[key] = p.default;
  }
  return params;
}

test("the pixel-local set is exactly the expected 15 effects", () => {
  assert.deepEqual(EFFECT_TYPES.filter(isPixelLocal).sort(), [...PIXEL_LOCAL].sort());
});

test("every pixel-local entry wires applyPixel; spatial/compound types do not fuse", () => {
  for (const type of PIXEL_LOCAL) {
    assert.equal(typeof EFFECTS[type].applyPixel, "function", `${type} missing applyPixel`);
  }
  for (const type of ["blur", "chromatic", "dropshadow", "bloom", "grain", "glitch", "drama",
    "colorwash", "gradient", "overlay", "vignette", "scanlines", "prism",
    "infrared", "vintage", "psychedelic"]) {
    assert.equal(isPixelLocal(type), false, `${type} must not be pixel-local`);
  }
});

test("planRuns groups maximal pixel-local runs; non-local effects are boundaries", () => {
  const runs = planRuns([
    { type: "brightness", params: { v: 120 } },
    { type: "contrast", params: { v: 130 } },
    { type: "blur", params: { v: 2 } },
    { type: "saturate", params: { v: 150 } },
    { type: "sepia", params: { v: 40 } },
  ]);
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map((r) => r.map((e) => e.type)),
    [["brightness", "contrast"], ["blur"], ["saturate", "sepia"]]);
});

test("planRuns splices compound expansions before grouping", () => {
  const runs = planRuns([
    { type: "brightness", params: { v: 120 } },
    { type: "infrared", params: { intensity: 70 } },
    { type: "sepia", params: { v: 40 } },
  ]);
  // brightness + invert + hue + saturate + sepia — one fused run.
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].map((e) => e.type),
    ["brightness", "invert", "hue", "saturate", "sepia"]);
});

test("expandEffects produces the documented primitive recipes", () => {
  assert.deepEqual(expandEffects([{ type: "infrared", params: { intensity: 50 } }]).map((e) => e.type),
    ["invert", "hue", "saturate"]);
  assert.deepEqual(expandEffects([{ type: "vintage", params: {} }]).map((e) => e.type),
    ["sepia", "contrast", "saturate", "brightness"]);
  // Psychedelic conditionals: bands/solarize below threshold drop their stages.
  assert.deepEqual(
    expandEffects([{ type: "psychedelic", params: { saturate: 200, contrast: 120, bands: 0, solarize: 0 } }]).map((e) => e.type),
    ["saturate", "contrast"]);
  assert.deepEqual(
    expandEffects([{ type: "psychedelic", params: { saturate: 200, contrast: 120, bands: 6, solarize: 50 } }]).map((e) => e.type),
    ["saturate", "contrast", "solarize", "hueband"]);
});

test("expanded compounds render byte-identical to the imperative reference", () => {
  for (const [type, params, ref] of [
    ["infrared", { intensity: 75 }, infrared],
    ["vintage", { sepia: 50, contrast: 90, saturate: 85, brightness: 108 }, vintage],
    ["psychedelic", { saturate: 300, contrast: 140, bands: 8, solarize: 60 }, psychedelic],
  ]) {
    const spec = specOf([{ type, params }]);
    const viaExpand = renderBuffer(FIXTURES.portrait(), spec);
    const viaApply = FIXTURES.portrait();
    ref(viaApply, params);
    assert.deepEqual([...viaExpand.data], [...viaApply.data], `${type} expansion diverged`);
  }
});

test("fused vs unfused is byte-identical for every golden case", () => {
  for (const [name, fixture, effects] of CASES) {
    const spec = specOf(effects);
    const fused = renderBuffer(FIXTURES[fixture](), spec);
    const unfused = renderBuffer(FIXTURES[fixture](), spec, { fuse: false });
    assert.deepEqual([...fused.data], [...unfused.data], `case "${name}" diverged`);
  }
});

test("fused vs unfused is byte-identical for every pixel-local pair", () => {
  for (const [fixtureName, fixture] of Object.entries(FIXTURES)) {
    for (let a = 0; a < PIXEL_LOCAL.length; a++) {
      for (let b = a; b < PIXEL_LOCAL.length; b++) {
        const spec = specOf([
          { type: PIXEL_LOCAL[a], params: defaultParams(PIXEL_LOCAL[a]) },
          { type: PIXEL_LOCAL[b], params: defaultParams(PIXEL_LOCAL[b]) },
        ]);
        const fused = renderBuffer(fixture(12, 8), spec);
        const unfused = renderBuffer(fixture(12, 8), spec, { fuse: false });
        assert.deepEqual([...fused.data], [...unfused.data],
          `pair ${PIXEL_LOCAL[a]}+${PIXEL_LOCAL[b]} on ${fixtureName} diverged`);
      }
    }
  }
});

test("fused vs unfused over 25 randomized stacks", () => {
  const rand = seededRandom(1234);
  for (let trial = 0; trial < 25; trial++) {
    const n = 2 + Math.floor(rand() * 5);
    const effects = [];
    for (let k = 0; k < n; k++) {
      const type = EFFECT_TYPES[Math.floor(rand() * EFFECT_TYPES.length)];
      effects.push({ type, params: defaultParams(type, rand) });
    }
    const spec = specOf(effects);
    const fused = renderBuffer(FIXTURES.noise(16, 12), spec);
    const unfused = renderBuffer(FIXTURES.noise(16, 12), spec, { fuse: false });
    assert.deepEqual([...fused.data], [...unfused.data],
      `random stack diverged: ${JSON.stringify(effects.map((e) => e.type))}`);
  }
});

test("stats.logical counts spec effects; stats.passes counts physical runs", () => {
  const options = { collectStats: true };
  renderBuffer(FIXTURES.gradient(12, 8), specOf([
    { type: "brightness", params: { v: 110 } },
    { type: "contrast", params: { v: 120 } },
    { type: "saturate", params: { v: 130 } },
    { type: "hue", params: { v: 20 } },
    { type: "invert", params: { v: 30 } },
  ]), options);
  assert.equal(options.stats.logical, 5);
  assert.equal(options.stats.passes, 1);
  assert.equal(options.stats.perEffect[0].type, "brightness+contrast+saturate+hue+invert");
});

test("input buffer is never mutated by fused runs", () => {
  const b = FIXTURES.gradient(12, 8);
  const before = [...b.data];
  renderBuffer(b, specOf([
    { type: "brightness", params: { v: 130 } },
    { type: "sepia", params: { v: 60 } },
  ]));
  assert.deepEqual([...b.data], before);
});
