import test from "node:test";
import assert from "node:assert/strict";
import {
  acquireBuffer, releaseBuffer, acquireFloats, releaseFloats,
  poolStats, drainPool, setPoolMaxBytes,
} from "../pool.js";

test("acquireBuffer returns a zeroed buffer of the right size", () => {
  drainPool();
  const b = acquireBuffer(4, 3);
  assert.equal(b.width, 4);
  assert.equal(b.height, 3);
  assert.equal(b.data.length, 48);
  assert.ok(b.data.every((v) => v === 0));
});

test("released buffers are reacquired for the same dimensions", () => {
  drainPool();
  const b = acquireBuffer(4, 3);
  releaseBuffer(b);
  const again = acquireBuffer(4, 3);
  assert.equal(again.data, b.data); // same backing store — reuse, not alloc
});

test("reacquired buffers come back dirty unless zero is asked for", () => {
  drainPool();
  const b = acquireBuffer(2, 2);
  b.data.fill(199);
  releaseBuffer(b);
  const dirty = acquireBuffer(2, 2, { zero: false });
  assert.equal(dirty.data[0], 199);
  releaseBuffer(dirty);
  const clean = acquireBuffer(2, 2); // default zero
  assert.equal(clean.data[0], 0);
});

test("different dimensions do not share pool entries", () => {
  drainPool();
  const a = acquireBuffer(4, 4);
  releaseBuffer(a);
  const b = acquireBuffer(2, 2);
  assert.notEqual(b.data, a.data);
});

test("acquireFloats recycles Float64Array scratch", () => {
  drainPool();
  const f = acquireFloats(64);
  releaseFloats(f);
  assert.equal(acquireFloats(64), f);
  assert.notEqual(acquireFloats(32), f);
});

test("byte cap evicts oldest entries", () => {
  drainPool();
  const old = poolStats().maxBytes;
  setPoolMaxBytes(4 * 4 * 4 * 2); // room for exactly two 4x4 buffers
  try {
    const a = acquireBuffer(4, 4);
    const b = acquireBuffer(4, 4);
    const c = acquireBuffer(4, 4);
    releaseBuffer(a);
    releaseBuffer(b);
    releaseBuffer(c); // pushes over cap → a evicted
    assert.equal(poolStats().entries, 2);
    const r1 = acquireBuffer(4, 4);
    const r2 = acquireBuffer(4, 4);
    const r3 = acquireBuffer(4, 4); // must allocate fresh — pool empty
    const datas = [r1.data, r2.data, r3.data];
    assert.ok(datas.includes(b.data) && datas.includes(c.data));
    assert.ok(!datas.includes(a.data));
  } finally {
    setPoolMaxBytes(old);
    drainPool();
  }
});

test("drainPool empties everything; stats report usage", () => {
  drainPool();
  const b = acquireBuffer(8, 8);
  releaseBuffer(b);
  assert.equal(poolStats().entries, 1);
  assert.ok(poolStats().bytes > 0);
  drainPool();
  assert.deepEqual(poolStats(), { entries: 0, bytes: 0, maxBytes: poolStats().maxBytes });
});
