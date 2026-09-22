import { test } from "node:test";
import assert from "node:assert/strict";
import { EFFECTS, EFFECT_TYPES } from "../registry.js";
import { BLEND_MODES } from "../color.js";

const EXPECTED_TYPES = [
  "brightness", "contrast", "saturate", "hue", "sepia", "grayscale", "invert", "opacity",
  "blur",
  "duotone", "tritone", "posterize", "heatmap", "drama",
  "bloom", "chromatic", "dropshadow",
  "colorwash", "gradient", "overlay", "vignette", "scanlines", "prism",
  "grain", "glitch",
  "psychedelic", "infrared", "vintage",
];

const EXPECTED_PX = [
  "blur.v",
  "bloom.blur",
  "chromatic.offset",
  "dropshadow.x", "dropshadow.y", "dropshadow.blur",
  "grain.size",
  "scanlines.size",
  "glitch.split",
];

const CATEGORIES = new Set(["pointwise", "neighbourhood", "tone", "composite", "overlay", "procedural", "compound"]);

test("registry covers the full effect vocabulary", () => {
  assert.deepEqual(EFFECT_TYPES.sort(), EXPECTED_TYPES.sort());
});

test("every param has a valid kind and a default", () => {
  for (const [type, def] of Object.entries(EFFECTS)) {
    for (const [key, p] of Object.entries(def.params)) {
      assert.ok(["number", "select", "color", "stops"].includes(p.kind), `${type}.${key}: bad kind ${p.kind}`);
      assert.notEqual(p.default, undefined, `${type}.${key}: missing default`);
    }
  }
});

test("number params have min <= default <= max", () => {
  for (const [type, def] of Object.entries(EFFECTS)) {
    for (const [key, p] of Object.entries(def.params)) {
      if (p.kind !== "number") continue;
      assert.ok(p.min <= p.default && p.default <= p.max, `${type}.${key}: ${p.min} <= ${p.default} <= ${p.max}`);
    }
  }
});

test("select params have their default in options", () => {
  for (const [type, def] of Object.entries(EFFECTS)) {
    for (const [key, p] of Object.entries(def.params)) {
      if (p.kind !== "select") continue;
      assert.ok(p.options.includes(p.default), `${type}.${key}: default not in options`);
    }
  }
});

test("px flags mark exactly the resolution-dependent params", () => {
  const flagged = [];
  for (const [type, def] of Object.entries(EFFECTS)) {
    for (const [key, p] of Object.entries(def.params)) {
      if (p.px) flagged.push(`${type}.${key}`);
    }
  }
  assert.deepEqual(flagged.sort(), EXPECTED_PX.sort());
});

test("every effect has a recognised category", () => {
  for (const [type, def] of Object.entries(EFFECTS)) {
    assert.ok(CATEGORIES.has(def.category), `${type}: bad category ${def.category}`);
  }
});

test("generic overlay accepts all 15 W3C blend modes", () => {
  assert.deepEqual(EFFECTS.overlay.params.blend.options, BLEND_MODES);
  assert.equal(BLEND_MODES.length, 16); // 15 blend modes + normal
});

test("stops default is a valid [offset, color] list", () => {
  const stops = EFFECTS.overlay.params.stops.default;
  assert.ok(Array.isArray(stops) && stops.length >= 2);
  for (const [offset, color] of stops) {
    assert.ok(typeof offset === "number" && offset >= 0 && offset <= 1);
    assert.equal(typeof color, "string");
  }
});
