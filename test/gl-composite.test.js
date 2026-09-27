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

test("dropshadow + drama + liquid remain CPU-only gates", () => {
  assert.equal(canRenderGPU(spec([{ type: "dropshadow", params: { x: 4, y: 4, blur: 8, color: "#000" } }])), false);
  assert.equal(canRenderGPU(spec([{ type: "drama", params: {} }])), false);
  assert.equal(canRenderGPU(spec([{ type: "liquid", params: {} }])), false);
  assert.equal(canRenderGPU(spec([{ type: "specular", params: {} }])), false);
  assert.equal(canRenderGPU(spec([{ type: "morphology", params: {} }])), false);
  assert.equal(canRenderGPU(spec([{ type: "outline", params: {} }])), false);
  assert.equal(canRenderGPU(spec([{ type: "echo", params: {} }])), false);
});

test("glitch gates to CPU only when blocks are active", () => {
  const glitch = (blocks) => ({ type: "glitch", params: { style: "CCD Failure", amount: 42, bandSize: 28, split: 6, corrupt: 40, blocks, seed: 317 } });
  assert.equal(canRenderGPU(spec([glitch(0)])), true);
  assert.equal(canRenderGPU(spec([glitch(80)])), false);
  // blocks>0 demotes the whole stack, not just the glitch run.
  assert.equal(canRenderGPU(spec([{ type: "brightness", params: { v: 110 } }, glitch(80)])), false);
});

test("full-coverage check: drama/dropshadow/liquid/specular/morphology/outline/echo remain CPU-gated", async () => {
  // Enumerate every registry effect and see which still lack a GPU path.
  const { EFFECTS } = await import("../registry.js");
  const unsupported = Object.keys(EFFECTS).filter((t) =>
    !canRenderGPU({ format: "wobbletone-filter", version: 1, name: "t",
      effects: [{ type: t, params: defaultParams(EFFECTS[t]) }] }));
  assert.deepEqual(unsupported.sort(), ["drama", "dropshadow", "liquid", "specular", "morphology", "outline", "echo"].sort());
});

function defaultParams(def) {
  const out = {};
  for (const [k, p] of Object.entries(def.params || {})) out[k] = p.default;
  return out;
}
