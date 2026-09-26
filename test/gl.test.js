// G0 — renderer selection plumbing. GL itself cannot run under Node, so
// capabilities are injected as plain objects; only the decision logic is
// tested here (parity is the browser harness's job, G8).

import test from "node:test";
import assert from "node:assert/strict";
import { pickRenderer, detectCapabilities } from "../gl/index.js";

const GOOD = {
  webgl2: true,
  highpFloat: true,
  maxTextureSize: 16384,
  maxFragmentUniforms: 256,
  halfFloatTargets: true,
  software: false,
  rendererString: "Test GPU",
};

test("detectCapabilities in Node reports no WebGL", () => {
  const caps = detectCapabilities();
  assert.equal(caps.webgl2, false);
  assert.equal(caps.maxTextureSize, 0);
});

test("renderer defaults to cpu", () => {
  assert.deepEqual(pickRenderer({}, GOOD), { renderer: "cpu", reason: null });
  assert.equal(pickRenderer({ renderer: "cpu" }, GOOD).renderer, "cpu");
});

test("auto resolves to webgl2 only when the full capability bar is met", () => {
  assert.deepEqual(pickRenderer({ renderer: "auto" }, GOOD), { renderer: "webgl2", reason: null });
  assert.equal(pickRenderer({ renderer: "webgl2" }, GOOD).renderer, "webgl2");
});

test("auto falls back with a reason for each missing capability", () => {
  const pick = (caps) => pickRenderer({ renderer: "auto" }, caps);
  assert.equal(pick({ ...GOOD, webgl2: false }).reason, "no-webgl2");
  assert.equal(pick({ ...GOOD, highpFloat: false }).reason, "no-highp-float");
  assert.equal(pick({ ...GOOD, software: true }).reason, "software-rasterizer");
});

test("texture-size is checked per render against actual dims", () => {
  const caps = { ...GOOD, maxTextureSize: 4096 };
  assert.equal(pickRenderer({ renderer: "auto", width: 3000, height: 2000 }, caps).renderer, "webgl2");
  const too = pickRenderer({ renderer: "auto", width: 5000, height: 2000 }, caps);
  assert.equal(too.renderer, "cpu");
  assert.equal(too.reason, "texture-size");
});

test("explicit webgl2 still respects the capability floor", () => {
  const pick = pickRenderer({ renderer: "webgl2" }, { ...GOOD, webgl2: false });
  assert.equal(pick.renderer, "cpu");
  assert.equal(pick.reason, "no-webgl2");
});

test("unknown renderer values degrade to cpu with a reason", () => {
  const pick = pickRenderer({ renderer: "voodoo" }, GOOD);
  assert.equal(pick.renderer, "cpu");
  assert.match(pick.reason, /bad-renderer-option/);
});
