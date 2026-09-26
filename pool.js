// pool.js — recycled scratch storage for internal effect intermediates
// (blur's float accumulation, composite layers, silhouettes, copies).
//
// CRITICAL RULE: pooled storage is for INTERNAL scratch only.
// renderBuffer output buffers and incremental-preview cache entries are
// owned by their callers — they must NEVER be acquired from the pool, and
// a buffer that escapes into a cache must never be released back. Pooled
// storage may be returned dirty; ask for a zeroed buffer unless you will
// overwrite every element before reading.

import { makeBuffer } from "./buffer.js";

let maxBytes = 64 * 1024 * 1024; // ~64MB CPU-side default
const pool = []; // { data, width?, height? } — buffers or bare Float64Array
let poolBytes = 0;

export function acquireBuffer(width, height, { zero = true } = {}) {
  for (let i = pool.length - 1; i >= 0; i--) {
    const e = pool[i];
    if (e.data instanceof Uint8ClampedArray && e.width === width && e.height === height) {
      pool.splice(i, 1);
      poolBytes -= e.data.byteLength;
      if (zero) e.data.fill(0);
      return { data: e.data, width, height };
    }
  }
  return makeBuffer(width, height); // fresh allocations come zeroed
}

export function releaseBuffer(buffer) {
  push({ data: buffer.data, width: buffer.width, height: buffer.height });
}

export function acquireFloats(length, { zero = false } = {}) {
  for (let i = pool.length - 1; i >= 0; i--) {
    const e = pool[i];
    if (e.data instanceof Float64Array && e.data.length === length && e.width === undefined) {
      pool.splice(i, 1);
      poolBytes -= e.data.byteLength;
      if (zero) e.data.fill(0);
      return e.data;
    }
  }
  return new Float64Array(length);
}

export function releaseFloats(arr) {
  push({ data: arr });
}

function push(entry) {
  pool.push(entry);
  poolBytes += entry.data.byteLength;
  // Evict oldest (FIFO) until under the byte cap.
  while (poolBytes > maxBytes && pool.length) {
    poolBytes -= pool.shift().data.byteLength;
  }
}

export function setPoolMaxBytes(n) { maxBytes = n; }
export function drainPool() { pool.length = 0; poolBytes = 0; }
export function poolStats() { return { entries: pool.length, bytes: poolBytes, maxBytes }; }
