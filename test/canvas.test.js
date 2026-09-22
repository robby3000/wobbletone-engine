import { test } from "node:test";
import assert from "node:assert/strict";
import { ENGINE_VERSION } from "../version.js";
import {
  checkEngineVersion, canvasToBuffer, bufferToCanvas, drawToBuffer, loadImage, renderToCanvas,
} from "../canvas.js";

// canvas.js is a browser adapter — Node can only verify the DOM-free parts
// (version check) and that every DOM function fails cleanly here.

test("checkEngineVersion accepts exact and major forms", () => {
  assert.equal(checkEngineVersion(ENGINE_VERSION), true);
  assert.equal(checkEngineVersion(ENGINE_VERSION.split(".")[0]), true);
  assert.equal(checkEngineVersion(Number(ENGINE_VERSION.split(".")[0])), true);
  assert.equal(checkEngineVersion("99"), false);
  assert.equal(checkEngineVersion("0.9.9"), false);
});

test("DOM functions throw a clear error outside a browser", () => {
  for (const fn of [
    () => canvasToBuffer({ width: 1, height: 1 }),
    () => bufferToCanvas({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    () => drawToBuffer({}, 1, 1),
    () => loadImage("x.png"),
    () => renderToCanvas({ width: 1, height: 1 }, {}),
  ]) {
    assert.throws(fn, /requires a browser DOM/);
  }
});
