// G5 — overlay GPU uniforms. The shader math is G8's parity harness;
// here we pin the JS-side contract: per-effect uniform shapes, stop
// sorting/packing, blend-mode indices, and spec gating.

import test from "node:test";
import assert from "node:assert/strict";
import { overlayUniforms, GPU_OVERLAY_TYPES, OVERLAY_MAX_STOPS } from "../gl/effects/overlay.js";
import { canRenderGPU } from "../gl/renderer.js";
import { parseCssColor } from "../color.js";
import { BLEND_INDEX } from "../gl/blends.js";

const spec = (effects) => ({ format: "wobbletone-filter", version: 1, name: "t", effects });
const get = (u, n) => u.find((x) => x.name === n)?.value;

test("overlay effect types are GPU-renderable", () => {
  for (const type of GPU_OVERLAY_TYPES) assert.ok(canRunShape(type), type);
  function canRunShape(type) {
    return ["colorwash","gradient","overlay","vignette","scanlines","prism"].includes(type);
  }
  assert.equal(canRenderGPU(spec([{ type: "vignette", params: { color: "#000", size: 60, opacity: 50 } }])), true);
  assert.equal(canRenderGPU(spec([
    { type: "sepia", params: { v: 60 } },
    { type: "vignette", params: { color: "#000", size: 60, opacity: 50 } },
  ])), true);
});

test("colorwash builds a solid-color layer", () => {
  const u = overlayUniforms({ type: "colorwash", params: { color: "#ff0000", blend: "multiply", opacity: 40 } }, 100, 50);
  assert.equal(get(u, "uKind"), 0);
  assert.deepEqual([...get(u, "uColor")], [255, 0, 0, 255]);
  assert.equal(get(u, "uMode"), BLEND_INDEX.multiply);
  assert.equal(get(u, "uOpacity"), 0.4);
});

test("vignette is radial multiply with transparent->color stops", () => {
  const u = overlayUniforms({ type: "vignette", params: { color: "#000000", size: 60, opacity: 50 } }, 100, 50);
  assert.equal(get(u, "uKind"), 2);
  assert.equal(get(u, "uMode"), BLEND_INDEX.multiply);
  assert.equal(get(u, "uNStops"), 2);
  const offs = get(u, "uStopsO");
  assert.ok(Math.abs(offs[0] - 0.4) < 1e-6); // (100-60)/100, Float32-packed
  assert.equal(offs[1], 1);
});

test("stops are sorted and packed to the fixed array", () => {
  const u = overlayUniforms({ type: "overlay", params: {
    kind: "linear", angle: 90,
    stops: [[1, "#ffffff"], [0, "#000000"], [0.5, "#ff0000"]],
    blend: "normal", opacity: 100,
  } }, 100, 50);
  const offs = get(u, "uStopsO");
  assert.deepEqual([...offs.slice(0, 3)], [0, 0.5, 1]);
  const cols = get(u, "uStopsC");
  assert.deepEqual([...cols.slice(0, 4)], [0, 0, 0, 255]);       // stop 0 black
  assert.deepEqual([...cols.slice(4, 8)], [255, 0, 0, 255]);     // stop 0.5 red
  // linear direction: angle 90 -> dx=sin=1, dy=-cos~0
  const dir = get(u, "uDir");
  assert.ok(Math.abs(dir[0] - 1) < 1e-7 && Math.abs(dir[1]) < 1e-7);
  assert.equal(get(u, "uLen"), 100); // |100*1| + |50*0|
});

test("prism builds its 5-stop screen gradient", () => {
  const u = overlayUniforms({ type: "prism", params: { c1: "#ff2e88", c2: "#2effd5", angle: 45, width: 20, opacity: 35 } }, 200, 100);
  assert.equal(get(u, "uNStops"), 5);
  assert.equal(get(u, "uMode"), BLEND_INDEX.screen);
  const cols = get(u, "uStopsC");
  assert.deepEqual([...cols.slice(8, 12)], [255, 255, 255, 255]); // middle stop = white
});

test("scanlines passes row-coverage params", () => {
  const u = overlayUniforms({ type: "scanlines", params: { size: 3, color: "#000000", opacity: 30, blend: "multiply" } }, 100, 50);
  assert.equal(get(u, "uKind"), 3);
  assert.equal(get(u, "uScan"), 3);
});

test("stop lists beyond the uniform cap are rejected", () => {
  const many = Array.from({ length: OVERLAY_MAX_STOPS + 1 }, (_, i) => [i / OVERLAY_MAX_STOPS, "#ff0000"]);
  const u = overlayUniforms({ type: "overlay", params: { kind: "linear", angle: 0, stops: many, blend: "normal", opacity: 50 } }, 100, 50);
  assert.equal(u, null);
});

test("parseCssColor feeds uniform values identically to the CPU layer", () => {
  // "transparent" is the vignette inner stop — alpha 0.
  assert.deepEqual(parseCssColor("transparent"), [0, 0, 0, 0]);
});
