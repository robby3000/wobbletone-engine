// G2 — blend GLSL port. The math itself is verified by the browser
// parity harness (G8); here we pin the contract between CPU and GLSL:
// index ordering must match BLEND_MODES so a uniform int addresses the
// same mode on both sides.

import test from "node:test";
import assert from "node:assert/strict";
import { BLEND_MODES } from "../color.js";
import { BLEND_INDEX, BLEND_GLSL } from "../gl/blends.js";

test("BLEND_INDEX covers every CPU blend mode in order", () => {
  assert.equal(Object.keys(BLEND_INDEX).length, BLEND_MODES.length);
  BLEND_MODES.forEach((mode, i) => assert.equal(BLEND_INDEX[mode], i));
});

test("GLSL chunk defines the port surface", () => {
  for (const fn of ["blendChannel", "blendColor", "compositeOver", "setSatG", "setLumG", "clipColorG"]) {
    assert.match(BLEND_GLSL, new RegExp(`\\b${fn}\\b`), `${fn} missing`);
  }
});

test("mode dispatch constants line up with BLEND_INDEX values", () => {
  // Separable 0–11 in blendChannel, non-separable 12–15 in blendColor.
  assert.equal(BLEND_INDEX["normal"], 0);
  assert.equal(BLEND_INDEX["exclusion"], 11);
  assert.equal(BLEND_INDEX["hue"], 12);
  assert.equal(BLEND_INDEX["luminosity"], 15);
  // Every mode the GLSL dispatches must be a real mode index.
  const ids = [...BLEND_GLSL.matchAll(/mode == (\d+)/g)].map((m) => Number(m[1]));
  for (const id of ids) assert.ok(id >= 0 && id < BLEND_MODES.length, `bad mode id ${id}`);
});
