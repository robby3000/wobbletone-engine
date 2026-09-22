import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SPEC_FORMAT,
  SPEC_VERSION,
  createSpec,
  validateSpec,
  specFromLegacy,
  migrateLegacyEffect,
} from "../spec.js";

const simpleSpec = {
  format: "wobbletone-filter",
  version: 1,
  name: "test",
  effects: [
    { type: "brightness", params: { v: 120 } },
    { type: "grain", params: { size: 1.2, opacity: 30, blend: "overlay", seed: 7 } },
  ],
};

test("createSpec produces a valid spec", () => {
  const spec = createSpec([{ type: "contrast", params: { v: 110 } }], "x");
  assert.equal(spec.format, SPEC_FORMAT);
  assert.equal(spec.version, SPEC_VERSION);
  assert.equal(spec.name, "x");
  assert.equal(spec.effects.length, 1);
  assert.equal(spec.effects[0].type, "contrast");
});

test("validateSpec round-trips a valid spec", () => {
  const validated = validateSpec(simpleSpec);
  assert.deepEqual(JSON.parse(JSON.stringify(validated)), validated);
  assert.equal(validated.effects[0].params.v, 120);
  assert.equal(validated.effects[1].params.seed, 7);
});

test("validateSpec fills missing params with defaults", () => {
  const spec = validateSpec({ format: "wobbletone-filter", version: 1, effects: [{ type: "brightness", params: {} }] });
  assert.equal(spec.effects[0].params.v, 110);
});

test("validateSpec fills entirely absent params", () => {
  const spec = validateSpec({ format: "wobbletone-filter", version: 1, effects: [{ type: "invert" }] });
  assert.equal(spec.effects[0].params.v, 100);
});

test("validateSpec clamps out-of-range number params", () => {
  const spec = validateSpec({
    format: "wobbletone-filter", version: 1,
    effects: [
      { type: "brightness", params: { v: 500 } },
      { type: "saturate", params: { v: -10 } },
      { type: "blur", params: { v: 99 } },
    ],
  });
  assert.equal(spec.effects[0].params.v, 200);
  assert.equal(spec.effects[1].params.v, 0);
  assert.equal(spec.effects[2].params.v, 20);
});

test("validateSpec strips unknown extra param keys", () => {
  const spec = validateSpec({
    format: "wobbletone-filter", version: 1,
    effects: [{ type: "brightness", params: { v: 100, bogus: 5, grainUri: "x" } }],
  });
  assert.deepEqual(Object.keys(spec.effects[0].params), ["v"]);
});

test("validateSpec rejects a wrong format", () => {
  assert.throws(() => validateSpec({ format: "other", version: 1, effects: [] }), /unsupported format/);
  assert.throws(() => validateSpec({ version: 1, effects: [] }), /unsupported format/);
});

test("validateSpec rejects a wrong version", () => {
  assert.throws(
    () => validateSpec({ format: "wobbletone-filter", version: 2, effects: [] }),
    /unsupported spec version/,
  );
});

test("validateSpec rejects malformed inputs", () => {
  assert.throws(() => validateSpec(null), /spec must be an object/);
  assert.throws(() => validateSpec("x"), /spec must be an object/);
  assert.throws(() => validateSpec({ format: "wobbletone-filter", version: 1 }), /effects must be an array/);
  assert.throws(
    () => validateSpec({ format: "wobbletone-filter", version: 1, effects: ["nope"] }),
    /effects\[0\] must be an object/,
  );
});

test("validateSpec rejects unknown effect types", () => {
  assert.throws(
    () => validateSpec({ format: "wobbletone-filter", version: 1, effects: [{ type: "glow", params: {} }] }),
    /unknown effect type "glow"/,
  );
  assert.throws(
    () => validateSpec({ format: "wobbletone-filter", version: 1, effects: [{ type: "brightness", params: {} }, { type: "wat" }] }),
    /effects\[1\]/,
  );
});

test("validateSpec rejects invalid param values", () => {
  const base = { format: "wobbletone-filter", version: 1 };
  assert.throws(
    () => validateSpec({ ...base, effects: [{ type: "brightness", params: { v: "lots" } }] }),
    /expected a number/,
  );
  assert.throws(
    () => validateSpec({ ...base, effects: [{ type: "colorwash", params: { blend: "wibble" } }] }),
    /not one of/,
  );
  assert.throws(
    () => validateSpec({ ...base, effects: [{ type: "vignette", params: { color: "red" } }] }),
    /hex color/,
  );
});

test("validateSpec normalizes hex color case", () => {
  const spec = validateSpec({
    format: "wobbletone-filter", version: 1,
    effects: [{ type: "duotone", params: { shadow: "#1A0D3D" } }],
  });
  assert.equal(spec.effects[0].params.shadow, "#1a0d3d");
});

test("validateSpec validates overlay stops and clamps offsets", () => {
  const spec = validateSpec({
    format: "wobbletone-filter", version: 1,
    effects: [{
      type: "overlay",
      params: { kind: "radial", stops: [[0.6, "transparent"], [1.5, "rgba(0,0,0,0.4)"]], blend: "multiply", opacity: 100 },
    }],
  });
  const stops = spec.effects[0].params.stops;
  assert.deepEqual(stops[0], [0.6, "transparent"]);
  assert.deepEqual(stops[1], [1, "rgba(0,0,0,0.4)"]);
});

test("validateSpec rejects malformed stops", () => {
  const base = { format: "wobbletone-filter", version: 1, effects: [{ type: "overlay", params: {} }] };
  assert.throws(
    () => validateSpec({ ...base, effects: [{ type: "overlay", params: { stops: "x" } }] }),
    /array of \[offset, color\] stops/,
  );
  assert.throws(
    () => validateSpec({ ...base, effects: [{ type: "overlay", params: { stops: [["a", "#fff"], [1, "#000"]] } }] }),
    /offset must be a number/,
  );
});

test("empty effects array is a valid spec", () => {
  const spec = validateSpec({ format: "wobbletone-filter", version: 1, effects: [] });
  assert.deepEqual(spec.effects, []);
});

/* ---------- specFromLegacy ---------- */

test("specFromLegacy converts defId records and drops disabled", () => {
  const spec = specFromLegacy([
    { defId: "contrast", enabled: true, params: { v: 112 } },
    { defId: "saturate", enabled: false, params: { v: 115 } },
    { defId: "invert", enabled: true, params: { v: 50 } },
  ]);
  assert.equal(spec.format, SPEC_FORMAT);
  assert.equal(spec.version, SPEC_VERSION);
  assert.deepEqual(spec.effects.map((e) => e.type), ["contrast", "invert"]);
  assert.equal(spec.effects[0].params.v, 112);
  assert.equal(spec.effects[1].params.v, 50);
});

test("specFromLegacy adds seed:1 to grain", () => {
  const spec = specFromLegacy([{ defId: "grain", enabled: true, params: { size: 1.4, opacity: 44, blend: "overlay" } }]);
  assert.equal(spec.effects[0].type, "grain");
  assert.equal(spec.effects[0].params.seed, 1);
});

test("specFromLegacy preserves an existing grain seed", () => {
  const spec = specFromLegacy([{ defId: "grain", enabled: true, params: { size: 1, opacity: 20, blend: "screen", seed: 99 } }]);
  assert.equal(spec.effects[0].params.seed, 99);
});

test("migrateLegacyEffect folds glow into bloom", () => {
  const m = migrateLegacyEffect({ defId: "glow", params: { blur: 10, brightness: 200, opacity: 70, color: "#aabbcc" } });
  assert.equal(m.type, "bloom");
  assert.deepEqual(m.params, {
    blur: 10, threshold: 200, contrast: 100, saturate: 130,
    opacity: 70, color: "#aabbcc", tint: 100, blend: "screen",
  });
});

test("migrateLegacyEffect glow defaults when params missing", () => {
  const m = migrateLegacyEffect({ defId: "glow", params: {} });
  assert.deepEqual(m.params, {
    blur: 8, threshold: 180, contrast: 100, saturate: 130,
    opacity: 60, color: "#ffffff", tint: 100, blend: "screen",
  });
});

test("migrateLegacyEffect folds halation into bloom", () => {
  const m = migrateLegacyEffect({ defId: "halation", params: { blur: 20, threshold: 150, opacity: 40, color: "#ff7a3c" } });
  assert.equal(m.type, "bloom");
  assert.deepEqual(m.params, {
    blur: 20, threshold: 150, contrast: 200, saturate: 100,
    opacity: 40, color: "#ff7a3c", tint: 100, blend: "lighten",
  });
});

test("migrateLegacyEffect returns null without a defId", () => {
  assert.equal(migrateLegacyEffect(null), null);
  assert.equal(migrateLegacyEffect({ params: {} }), null);
});

test("specFromLegacy drops effects with unknown types", () => {
  const spec = specFromLegacy([
    { defId: "contrast", enabled: true, params: { v: 100 } },
    { defId: "vanished-effect", enabled: true, params: {} },
  ]);
  assert.deepEqual(spec.effects.map((e) => e.type), ["contrast"]);
});

test("specFromLegacy output always passes validateSpec", () => {
  const spec = specFromLegacy([
    { defId: "glow", enabled: true, params: { blur: 5 } },
    { defId: "halation", enabled: true, params: {} },
    { defId: "grain", enabled: true, params: { size: 2 } },
    { defId: "brightness", enabled: true, params: { v: 9999 } },
    { defId: "drama", enabled: true, params: { style: "NotAStyle" } },
    { defId: "vignette", enabled: true, params: { color: "notacolor" } },
  ], "legacy");
  const validated = validateSpec(spec); // must not throw
  assert.equal(validated.name, "legacy");
  assert.equal(validated.effects[3].params.v, 200); // clamped
  assert.equal(validated.effects[4].params.style, "Cinematic"); // bad select → default
  assert.equal(validated.effects[5].params.color, "#000000"); // bad color → default
});

test("specFromLegacy handles empty and missing input", () => {
  assert.deepEqual(specFromLegacy([]).effects, []);
  assert.deepEqual(specFromLegacy(undefined).effects, []);
  assert.deepEqual(specFromLegacy([null, { enabled: true }]).effects, []);
});
