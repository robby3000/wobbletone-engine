import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBuffer } from "../buffer.js";
import { outline } from "../effects/outline.js";
import { EFFECTS } from "../registry.js";

const PARAMS = {
  threshold: 15, width: 0, color: "#ff0000", detail: 0,
  softness: 0, surface: "original", opacity: 100,
};

// Half-black / half-white vertical step — a clean single edge.
const step = (w = 16, h = 16, split = 8) => {
  const b = makeBuffer(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const v = x >= split ? 255 : 0;
    b.data[i] = b.data[i + 1] = b.data[i + 2] = v;
    b.data[i + 3] = 255;
  }
  return b;
};

const redCount = (b) => {
  let n = 0;
  for (let i = 0; i < b.data.length; i += 4) if (b.data[i] > 200) n++;
  return n;
};

// Pixels whose RGB differs from `orig` — robust regardless of the
// source's own brightness (white pixels already have R=255).
const diffCount = (b, orig) => {
  let n = 0;
  for (let i = 0; i < b.data.length; i += 4) {
    if (b.data[i] !== orig.data[i] || b.data[i + 1] !== orig.data[i + 1] || b.data[i + 2] !== orig.data[i + 2]) n++;
  }
  return n;
};

test("step edge traced with the line color", () => {
  const b = step();
  const orig = structuredClone(b);
  outline(b, PARAMS);
  assert.ok(diffCount(b, orig) >= 14, `expected ~a column changed, got ${diffCount(b, orig)}`);
});

test("flat image produces no edges", () => {
  const b = makeBuffer(16, 16);
  for (let p = 0; p < 256; p++) {
    const i = p * 4;
    b.data[i] = b.data[i + 1] = b.data[i + 2] = 128;
    b.data[i + 3] = 255;
  }
  const before = [...b.data];
  outline(b, PARAMS);
  assert.deepEqual([...b.data], before);
});

test("threshold=100 suppresses a weak edge", () => {
  // Subtle step (0 vs 40) below a high threshold.
  const b = makeBuffer(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const i = (y * 16 + x) * 4;
    const v = x >= 8 ? 40 : 0;
    b.data[i] = b.data[i + 1] = b.data[i + 2] = v;
    b.data[i + 3] = 255;
  }
  outline(b, { ...PARAMS, threshold: 80 });
  assert.equal(redCount(b), 0);
});

test("width dilates the traced line", () => {
  const thin = step();
  const thinOrig = structuredClone(thin);
  outline(thin, { ...PARAMS, width: 0, softness: 0 });
  const thick = step();
  const thickOrig = structuredClone(thick);
  outline(thick, { ...PARAMS, width: 3, softness: 0 });
  const thinN = diffCount(thin, thinOrig);
  const thickN = diffCount(thick, thickOrig);
  assert.ok(thickN > thinN * 3, `thin=${thinN} thick=${thickN}`);
});

test("light surface replaces non-edge pixels with white", () => {
  const b = step();
  outline(b, { ...PARAMS, surface: "light", color: "#000000" });
  // Corners far from the edge should be paper-white.
  const i = (0 * 16 + 0) * 4;
  assert.equal(b.data[i], 255);
  const j = (15 * 16 + 15) * 4;
  assert.equal(b.data[j], 255);
});

test("dark surface replaces non-edge pixels with black", () => {
  const b = step();
  outline(b, { ...PARAMS, surface: "dark", color: "#ffffff" });
  const i = (0 * 16 + 0) * 4;
  assert.equal(b.data[i], 0);
  const j = (15 * 16 + 15) * 4;
  assert.equal(b.data[j], 0);
});

test("opacity=0 on original surface is identity", () => {
  const b = step();
  const before = [...b.data];
  outline(b, { ...PARAMS, opacity: 0 });
  assert.deepEqual([...b.data], before);
});

test("alpha is preserved", () => {
  const b = step();
  b.data[(4 * 16 + 8) * 4 + 3] = 200;
  outline(b, PARAMS);
  assert.equal(b.data[(4 * 16 + 8) * 4 + 3], 200);
});

test("detail blurs away fine noise before tracing", () => {
  // 2×2 blocks are all fine edges (a 1px checkerboard is invisible to
  // Sobel — symmetric neighborhood cancels); heavy detail blur erases them.
  const b = makeBuffer(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const i = (y * 16 + x) * 4;
    const v = ((x >> 1) + (y >> 1)) % 2 ? 200 : 60;
    b.data[i] = b.data[i + 1] = b.data[i + 2] = v;
    b.data[i + 3] = 255;
  }
  const orig = structuredClone(b);
  const sharp = structuredClone(b);
  outline(sharp, { ...PARAMS, detail: 0 });
  const smooth = structuredClone(b);
  outline(smooth, { ...PARAMS, detail: 4 });
  const sharpN = diffCount(sharp, orig);
  const smoothN = diffCount(smooth, orig);
  assert.ok(sharpN > smoothN, `sharp=${sharpN} smooth=${smoothN}`);
});

test("registry wires apply for outline", () => {
  const b = step();
  const orig = structuredClone(b);
  EFFECTS.outline.apply(b, PARAMS, { renderScale: 1 });
  assert.ok(diffCount(b, orig) > 0);
});
