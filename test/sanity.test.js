import { test } from "node:test";
import assert from "node:assert/strict";
import { ENGINE_VERSION } from "../version.js";
import { makeBuffer, cloneBuffer } from "../buffer.js";
import { seededRandom } from "../rng.js";
import { clamp, lerpByte, hexToRgb, rgb01, luminance } from "../color.js";

test("ENGINE_VERSION is exported", () => {
  assert.equal(ENGINE_VERSION, "1.4.0");
});

test("makeBuffer allocates a zeroed RGBA buffer", () => {
  const b = makeBuffer(4, 3);
  assert.equal(b.width, 4);
  assert.equal(b.height, 3);
  assert.ok(b.data instanceof Uint8ClampedArray);
  assert.equal(b.data.length, 48);
  assert.ok(b.data.every((v) => v === 0));
});

test("cloneBuffer copies data without aliasing", () => {
  const a = makeBuffer(2, 2);
  a.data[0] = 200;
  const b = cloneBuffer(a);
  assert.deepEqual([...b.data], [...a.data]);
  b.data[0] = 0;
  assert.equal(a.data[0], 200);
});

test("seededRandom is deterministic and in [0, 1)", () => {
  const a = seededRandom(42);
  const b = seededRandom(42);
  for (let i = 0; i < 100; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});

test("seededRandom matches the pinned mulberry32 sequence", () => {
  // Same algorithm as aimless lib/rng.js — pins cross-app parity forever.
  const r = seededRandom(1);
  const expected = [
    0.62707394058816135, 0.0027357211802154779, 0.52744703995995224,
    0.98105096747167408, 0.96837789821438491,
  ];
  for (const e of expected) assert.equal(r(), e);
});

test("different seeds produce different sequences", () => {
  const a = Array.from({ length: 5 }, seededRandom(1));
  const b = Array.from({ length: 5 }, seededRandom(2));
  assert.notDeepEqual(a, b);
});

test("clamp bounds values", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test("lerpByte interpolates and clamps to bytes", () => {
  assert.equal(lerpByte(0, 255, 0.5), 128);
  assert.equal(lerpByte(100, 200, 2), 255);
  assert.equal(lerpByte(100, 0, 2), 0);
});

test("hexToRgb parses 6- and 3-digit hex", () => {
  assert.deepEqual(hexToRgb("#ff0080"), [255, 0, 128]);
  assert.deepEqual(hexToRgb("f08"), [255, 0, 136]);
});

test("rgb01 returns numeric 0–1 components", () => {
  const [r, g, b] = rgb01("#ff0080");
  assert.equal(r, 1);
  assert.equal(g, 0);
  assert.ok(Math.abs(b - 128 / 255) < 1e-9);
});

test("luminance uses W3C coefficients in the caller's units", () => {
  assert.ok(Math.abs(luminance(255, 255, 255) - 255) < 1e-9);
  assert.ok(Math.abs(luminance(1, 1, 1) - 1) < 1e-9);
  assert.ok(Math.abs(luminance(255, 0, 0) - 76.5) < 1e-9);
});
