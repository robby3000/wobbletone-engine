// G3 — fused shader generation. Node can't compile GLSL, so tests pin
// the generator's structure: which specs are GPU-renderable, what the
// emitted source contains, and that uniform values come from the same
// preparePixel() constants the CPU path uses.

import test from "node:test";
import assert from "node:assert/strict";
import { buildFusedRun, canRunGPU } from "../gl/fusion.js";
import { canRenderGPU } from "../gl/renderer.js";
import { EFFECTS } from "../registry.js";

const spec = (effects) => ({ format: "wobbletone-filter", version: 1, name: "t", effects });
const prep = (type, params) => EFFECTS[type].preparePixel(params);

test("every pixel-local effect has a GLSL step", () => {
  const pixelLocal = Object.keys(EFFECTS).filter((t) => EFFECTS[t].pixelLocal);
  for (const type of pixelLocal) assert.ok(canRunGPU(type), `${type} missing GLSL step`);
  assert.equal(pixelLocal.length, 15);
});

test("non-pixel-local effects are not GPU steps", () => {
  for (const type of ["drama", "blur", "bloom", "chromatic", "glitch", "grain", "dropshadow", "vignette"]) {
    assert.equal(canRunGPU(type), false, `${type} should not be fusable`);
  }
});

test("blur runs are GPU-renderable (G4); mixed stacks qualify", () => {
  assert.equal(canRenderGPU(spec([{ type: "blur", params: { v: 8 } }])), true);
  assert.equal(canRenderGPU(spec([
    { type: "brightness", params: { v: 110 } },
    { type: "blur", params: { v: 8 } },
    { type: "invert", params: { v: 20 } },
  ])), true);
  // drama's internal blur is not a "blur" run — stays CPU
  assert.equal(canRenderGPU(spec([{ type: "drama", params: {} }])), false);
});

test("blurFits gates kernel size against the uniform budget", async () => {
  const { blurFits } = await import("../gl/effects/blur.js");
  assert.equal(blurFits(1, 64), true);     // 7 taps -> 2 vec4s
  assert.equal(blurFits(20, 64), true);    // 121 taps -> 31 vec4s
  assert.equal(blurFits(20, 16), false);   // too weak a uniform budget
  assert.equal(blurFits(50, 256), false);  // 301 taps > 256-slot array
});

test("canRenderGPU gates on the whole expanded spec", () => {
  assert.equal(canRenderGPU(spec([{ type: "invert", params: { v: 100 } }])), true);
  assert.equal(canRenderGPU(spec([
    { type: "invert", params: { v: 100 } },
    { type: "drama", params: {} },               // no GPU path -> whole render stays CPU
  ])), false);
  assert.equal(canRenderGPU(spec([{ type: "bogus", params: {} }])), false);
  assert.equal(canRenderGPU({ nope: true }), false);
});

test("a compound spec is GPU-renderable when its expansion is pixel-local", () => {
  // every compound expands to primitives; if all are pixel-local the
  // whole spec fuses. Verify at least one compound qualifies and that
  // the check is on the EXPANSION not the compound name itself.
  const compounds = Object.keys(EFFECTS).filter((t) => EFFECTS[t].expand);
  assert.ok(compounds.length > 0);
  const gpuable = compounds.filter((t) =>
    canRenderGPU(spec([{ type: t, params: defaultParamsFor(t) }])));
  assert.ok(gpuable.length > 0, "expected at least one all-pixel-local compound");
});

test("buildFusedRun emits one uniform set per step and quantizing calls", () => {
  const run = [
    { type: "brightness", params: { v: 110 } },
    { type: "invert", params: { v: 50 } },
  ];
  const { src, uniforms } = buildFusedRun(run, prep);
  assert.match(src, /#version 300 es/);
  assert.match(src, /uniform float u0a;/);
  assert.match(src, /uniform float u1a;/);
  // both step calls present, in order (main() body, after the decls)
  const main = src.slice(src.indexOf("void main()"));
  const b = main.indexOf("c.rgb * u0a");
  const inv = main.indexOf("(1.0 - u1a)");
  assert.ok(b > -1 && inv > b);
  assert.deepEqual(uniforms.map((u) => u.name), ["u0a", "u1a"]);
  assert.equal(uniforms[0].value, 1.1);  // from brightnessPrepare
  assert.equal(uniforms[1].value, 0.5);  // from invertPrepare
});

test("gradient steps emit a 6-slot color array with real prepared colors", () => {
  const run = [{ type: "duotone", params: { shadow: "#001122", highlight: "#ffeecc", contrast: 0 } }];
  const { src, uniforms } = buildFusedRun(run, prep);
  assert.match(src, /uniform vec3 u0C\[6\];/);
  assert.match(src, /uniform int u0N;/);
  const colors = uniforms.find((u) => u.name === "u0C");
  const n = uniforms.find((u) => u.name === "u0N");
  assert.equal(n.value, 2);
  const expected = EFFECTS.duotone.preparePixel(run[0].params);
  assert.equal(colors.value[0], expected[0][0]); // shadow.r
  assert.equal(colors.value[3], expected[1][0]); // highlight.r
});

test("grayscale uniforms map from grayscalePrepare fields", () => {
  const run = [{ type: "grayscale", params: { filter: "Red", intensity: 80, exposure: 20, contrast: 10, shadows: -30, highlights: 40 } }];
  const { uniforms } = buildFusedRun(run, prep);
  const p = EFFECTS.grayscale.preparePixel(run[0].params);
  const get = (n) => uniforms.find((u) => u.name === `u0${n}`).value;
  assert.deepEqual([...get("w")], [p.wr, p.wg, p.wb]);
  assert.equal(get("gain"), p.gain);
  assert.equal(get("norm"), p.shoulderNorm);
});

function defaultParamsFor(type) {
  const out = {};
  for (const [k, p] of Object.entries(EFFECTS[type].params || {})) {
    out[k] = p.default;
  }
  return out;
}
