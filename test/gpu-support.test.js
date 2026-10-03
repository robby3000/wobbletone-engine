// GPU_SUPPORT coherence — the table in gl/support.js is the single
// declaration of GPU coverage. These tests pin it to the registry, the
// STEPS fused path, and canRenderGPU, so drift fails loudly instead of
// shipping a param the GPU silently ignores (the glitch Blocks bug).

import test from "node:test";
import assert from "node:assert/strict";
import { EFFECTS } from "../registry.js";
import { canRunGPU } from "../gl/fusion.js";
import { GPU_SUPPORT } from "../gl/support.js";
import { canRenderGPU } from "../gl/renderer.js";

const spec = (effects) => ({ format: "wobbletone-filter", version: 1, name: "t", effects });
const single = (type, params = {}) => spec([{ type, params }]);

test("every registry param of a GPU-supported effect is handled or gated", () => {
  for (const [type, support] of Object.entries(GPU_SUPPORT)) {
    const handled = new Set([...(support.params || []), ...(support.gatedParams || [])]);
    for (const key of Object.keys(EFFECTS[type].params)) {
      assert.ok(handled.has(key), `${type}.${key} missing from GPU_SUPPORT`);
    }
  }
});

test("gatedParams are only meaningful with a when gate", () => {
  for (const [type, support] of Object.entries(GPU_SUPPORT)) {
    if (support.gatedParams) {
      assert.equal(typeof support.when, "function", `${type} has gatedParams but no when`);
    }
  }
});

test("fused declarations match the STEPS table exactly", () => {
  for (const type of Object.keys(EFFECTS)) {
    assert.equal(
      Boolean(GPU_SUPPORT[type]?.fused), canRunGPU(type),
      `${type}: fused flag and STEPS disagree`,
    );
  }
});

test("every primitive effect not in GPU_SUPPORT renders CPU-only", () => {
  for (const [type, def] of Object.entries(EFFECTS)) {
    if (GPU_SUPPORT[type] || def.expand) continue;
    assert.equal(canRenderGPU(single(type)), false, `${type}: GPU path exists without a table entry`);
  }
});

test("single-effect GPU-covered specs pass canRenderGPU", () => {
  for (const type of Object.keys(GPU_SUPPORT)) {
    assert.equal(canRenderGPU(single(type)), true, `${type}: declared covered but canRenderGPU says no`);
  }
});

test("glitch blocks gate flips the whole render to CPU", () => {
  assert.equal(canRenderGPU(single("glitch", { blocks: 0 })), true);
  assert.equal(canRenderGPU(single("glitch", { blocks: 50 })), false);
  // even inside an otherwise-covered stack
  assert.equal(canRenderGPU(spec([{ type: "invert", params: {} }, { type: "glitch", params: { blocks: 50 } }])), false);
});

test("mixed fused runs and compounds remain GPU-renderable", () => {
  assert.equal(canRenderGPU(spec([{ type: "brightness", params: {} }, { type: "contrast", params: {} }])), true);
  assert.equal(canRenderGPU(single("psychedelic")), true);  // expands to fused primitives
  // fused step followed by a dedicated pass is two runs, both covered
  assert.equal(canRenderGPU(spec([{ type: "invert", params: {} }, { type: "blur", params: { v: 5 } }])), true);
});
