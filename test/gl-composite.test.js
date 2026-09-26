// G7 — bloom/chromatic GPU plumbing. Node pins the gating surface;
// pixel parity is the G8 browser harness's job.

import test from "node:test";
import assert from "node:assert/strict";
import { canRenderGPU } from "../gl/renderer.js";

const spec = (effects) => ({ format: "wobbletone-filter", version: 1, name: "t", effects });

test("bloom and chromatic are GPU-renderable", () => {
  assert.equal(canRenderGPU(spec([{ type: "bloom", params: { blur: 10, threshold: 140, contrast: 180, saturate: 100, opacity: 50, color: "#fff", tint: 0, blend: "screen" } }])), true);
  assert.equal(canRenderGPU(spec([{ type: "chromatic", params: { offset: 3, strength: 60 } }])), true);
  assert.equal(canRenderGPU(spec([
    { type: "brightness", params: { v: 110 } },
    { type: "bloom", params: { blur: 10, threshold: 140, contrast: 180, saturate: 100, opacity: 50, color: "#fff", tint: 0, blend: "screen" } },
    { type: "chromatic", params: { offset: 3, strength: 60 } },
  ])), true);
});

test("dropshadow + drama remain CPU-only gates", () => {
  assert.equal(canRenderGPU(spec([{ type: "dropshadow", params: { x: 4, y: 4, blur: 8, color: "#000" } }])), false);
  assert.equal(canRenderGPU(spec([{ type: "drama", params: {} }])), false);
});

test("full-coverage check: only drama/dropshadow remain CPU-gated", async () => {
  // Enumerate every registry effect and see which still lack a GPU path.
  const { EFFECTS } = await import("../registry.js");
  const unsupported = Object.keys(EFFECTS).filter((t) =>
    !canRenderGPU({ format: "wobbletone-filter", version: 1, name: "t",
      effects: [{ type: t, params: defaultParams(EFFECTS[t]) }] }));
  assert.deepEqual(unsupported.sort(), ["drama", "dropshadow"].sort());
});

function defaultParams(def) {
  const out = {};
  for (const [k, p] of Object.entries(def.params || {})) out[k] = p.default;
  return out;
}
