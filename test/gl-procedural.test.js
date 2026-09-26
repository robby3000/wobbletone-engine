// G6 — grain/glitch GPU plumbing. The uint32 RNG and shader math are
// proven by the browser parity harness (G8); node tests pin the shared
// band-table contract and spec gating.

import test from "node:test";
import assert from "node:assert/strict";
import { packGlitchBands, glitchBandUniforms, glitchUniformLimit, GLITCH_MAX_BANDS } from "../gl/effects/procedural.js";
import { buildGlitchBands } from "../effects/glitch.js";
import { canRenderGPU } from "../gl/renderer.js";

const spec = (effects) => ({ format: "wobbletone-filter", version: 1, name: "t", effects });

test("grain and glitch are GPU-renderable", () => {
  assert.equal(canRenderGPU(spec([{ type: "grain", params: { size: 1, opacity: 25, blend: "overlay", seed: 1 } }])), true);
  assert.equal(canRenderGPU(spec([{ type: "glitch", params: { style: "CCD Failure", amount: 50, bandSize: 50, split: 4, corrupt: 30, seed: 1 } }])), true);
  assert.equal(canRenderGPU(spec([
    { type: "sepia", params: { v: 60 } },
    { type: "glitch", params: { style: "VHS Tear", amount: 50, bandSize: 50, split: 4, corrupt: 30, seed: 1 } },
    { type: "grain", params: { size: 1, opacity: 25, blend: "overlay", seed: 1 } },
  ])), true);
  // still gated: drama remains CPU-only for now
  assert.equal(canRenderGPU(spec([{ type: "grain", params: { size: 1, opacity: 25, blend: "overlay", seed: 1 } }, { type: "drama", params: {} }])), false);
});

test("band packing: 3 vec4s per band, fields in order", () => {
  const built = buildGlitchBands({ style: "CCD Failure", amount: 80, bandSize: 30, split: 6, corrupt: 50, seed: 7 }, 400, 300, 1);
  const flat = packGlitchBands(built);
  assert.ok(flat, "band count within cap");
  const b0 = built.bands[0];
  assert.equal(flat[0], b0.y);
  assert.equal(flat[1], b0.y + b0.height);
  assert.equal(flat[2], b0.dx);
  assert.equal(flat[3], b0.dy);
  assert.equal(flat[4], b0.exposure);
  assert.equal(flat[5], b0.jitter);
  assert.equal(flat[6], b0.split ?? built.split);
  assert.equal(flat[7], b0.repeat ? 1 : 0);
  // corrupt: mode index or -1
  const modeIdx = flat[8];
  if (b0.corrupt) {
    assert.equal(modeIdx, ["hue", "desat", "kill", "posterize"].indexOf(b0.corrupt.mode));
    assert.equal(flat[9], b0.corrupt.severity);
    assert.equal(flat[10], b0.corrupt.arg);
  } else {
    assert.equal(modeIdx, -1);
  }
});

test("packed bands are in-place deterministic — same seed, same table", () => {
  const p = { style: "Signal Loss", amount: 60, bandSize: 50, split: 4, corrupt: 40, seed: 42 };
  const a = buildGlitchBands(p, 320, 240, 1);
  const b = buildGlitchBands(p, 320, 240, 1);
  assert.deepEqual(packGlitchBands(a), packGlitchBands(b));
  assert.equal(a.rowSeed, b.rowSeed);
});

test("glitchBandUniforms carries count + rowSeed (uint32-safe)", () => {
  const built = buildGlitchBands({ style: "CCD Failure", amount: 50, bandSize: 50, split: 3, corrupt: 20, seed: 9999 }, 200, 200, 1);
  const u = glitchBandUniforms(built);
  const n = u.find((x) => x.name === "uNBands");
  const rs = u.find((x) => x.name === "uRowSeed");
  assert.equal(n.value, built.bands.length);
  assert.equal(rs.value, built.rowSeed >>> 0);
});

test("uniform budget gate: 3 vec4/band + fixed cost", () => {
  assert.equal(glitchUniformLimit(40, 224), true);   // 120+12 <= 224
  assert.equal(glitchUniformLimit(40, 64), false);   // weak GPU -> CPU
  assert.equal(glitchUniformLimit(1, 16), true);
  // over the hard cap -> packing refuses outright
  const fake = { bands: Array.from({ length: GLITCH_MAX_BANDS + 1 }, () => ({})), split: 0 };
  assert.equal(packGlitchBands(fake), null);
});
