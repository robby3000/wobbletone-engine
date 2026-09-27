import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBuffer } from "../buffer.js";
import { glitch, buildGlitchBands, buildGlitchBlocks, glitchSettings, GLITCH_PROFILES } from "../effects/glitch.js";
import { seededRandom } from "../rng.js";
import { EFFECTS } from "../registry.js";

const filled = (rgba, w, h) => {
  const b = makeBuffer(w, h);
  for (let i = 0; i < b.data.length; i += 4) {
    b.data[i] = rgba[0]; b.data[i + 1] = rgba[1]; b.data[i + 2] = rgba[2]; b.data[i + 3] = rgba[3];
  }
  return b;
};

const PARAMS = { style: "CCD Failure", amount: 60, bandSize: 30, split: 8, seed: 42 };

/* ---------- glitchSettings ---------- */

test("glitchSettings maps style names to profiles with ccd-failure fallback", () => {
  assert.equal(glitchSettings({ ...PARAMS, style: "VHS Tear" }).profile, GLITCH_PROFILES["vhs-tear"]);
  assert.equal(glitchSettings({ ...PARAMS, style: "nonsense" }).profile, GLITCH_PROFILES["ccd-failure"]);
  assert.equal(glitchSettings({ ...PARAMS, style: "Signal  Loss" }).profile, GLITCH_PROFILES["signal-loss"]);
});

test("glitchSettings derives split and displacement from amount", () => {
  const s = glitchSettings({ ...PARAMS, amount: 50, split: 10 });
  assert.equal(s.split, 10 * GLITCH_PROFILES["ccd-failure"].split * 0.5);
  assert.equal(s.displacement, 0.5 * 100 * GLITCH_PROFILES["ccd-failure"].displacement);
  assert.equal(glitchSettings({ ...PARAMS, amount: 0 }).split, 0);
});

test("glitchSettings scales derived displacement by renderScale", () => {
  const a = glitchSettings(PARAMS, 1);
  const b = glitchSettings(PARAMS, 2);
  assert.equal(b.displacement, a.displacement * 2);
  assert.equal(b.split, a.split); // split arrives pre-scaled via the px flag
});

/* ---------- buildGlitchBands ---------- */

test("bands tile the full height contiguously", () => {
  const { bands } = buildGlitchBands(PARAMS, 64, 48);
  assert.equal(bands[0].y, 0);
  assert.equal(bands[bands.length - 1].y + bands[bands.length - 1].height, 48);
  for (let i = 1; i < bands.length; i++) {
    assert.equal(bands[i].y, bands[i - 1].y + bands[i - 1].height);
  }
});

test("bands are deterministic for a seed and differ across seeds", () => {
  const a = buildGlitchBands(PARAMS, 64, 48).bands;
  const b = buildGlitchBands(PARAMS, 64, 48).bands;
  const c = buildGlitchBands({ ...PARAMS, seed: 43 }, 64, 48).bands;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test("amount 0 yields only inactive bands (dx=dy=0, exposure=1)", () => {
  const { bands, split } = buildGlitchBands({ ...PARAMS, amount: 0 }, 64, 48);
  assert.equal(split, 0);
  for (const band of bands) {
    assert.equal(band.dx, 0);
    assert.equal(band.dy, 0);
    assert.equal(band.exposure, 1);
  }
});

test("corrupt 0 leaves bands uncorrupted; corrupt > 0 produces corrupt bands", () => {
  const clean = buildGlitchBands({ ...PARAMS, corrupt: 0 }, 64, 48).bands;
  assert.ok(clean.every((b) => b.corrupt === null));
  const dirty = buildGlitchBands({ ...PARAMS, corrupt: 100, amount: 100 }, 64, 48).bands;
  assert.ok(dirty.some((b) => b.corrupt !== null), "expected at least one corrupted band");
});

test("active bands can carry jitter, repeat, and per-band split", () => {
  const { bands } = buildGlitchBands({ ...PARAMS, amount: 100, corrupt: 0 }, 64, 48);
  const active = bands.filter((b) => b.dx !== 0 || b.jitter > 0 || b.repeat);
  assert.ok(active.length > 0, "expected active bands");
  for (const b of active) {
    assert.ok(b.jitter >= 0);
    if (b.split !== null) assert.notEqual(b.split, 0);
    if (b.corrupt) assert.ok(b.corrupt.severity > 0 && b.corrupt.severity <= 1);
  }
});

/* ---------- glitch ---------- */

test("glitch is deterministic for a seed", () => {
  const a = filled([100, 150, 200, 255], 32, 32);
  const b = filled([100, 150, 200, 255], 32, 32);
  glitch(a, PARAMS);
  glitch(b, PARAMS);
  assert.deepEqual([...a.data], [...b.data]);
});

test("amount 0 is identity", () => {
  const b = filled([100, 150, 200, 255], 16, 16);
  const before = [...b.data];
  glitch(b, { ...PARAMS, amount: 0 });
  assert.deepEqual([...b.data], before);
});

test("glitch displaces a marker stripe horizontally within a band", () => {
  // White column on black; output x reads sourceX = x − rowDx, so a stripe at
  // column m appears at output column m + rowDx. rowDx = band.dx + per-row
  // jitter (horizontal-clock noise, seeded by rowSeed and y).
  const params = { ...PARAMS, seed: 42 };
  const b = filled([0, 0, 0, 255], 32, 32);
  for (let y = 0; y < 32; y++) {
    const i = (y * 32 + 16) * 4;
    b.data[i] = b.data[i + 1] = b.data[i + 2] = 255;
  }
  const { bands, rowSeed } = buildGlitchBands(params, 32, 32);
  const rowDx = (band, y) => band.dx + (band.jitter
    ? Math.round((seededRandom((rowSeed + Math.imul(y, 2654435761)) | 0)() * 2 - 1) * band.jitter)
    : 0);
  const band = bands.find((bd) => {
    const dx = rowDx(bd, bd.y);
    return dx !== 0 && 16 + dx >= 0 && 16 + dx < 32;
  });
  assert.ok(band, "expected an active band whose rowDx keeps the stripe in frame");
  glitch(b, params);
  const nx = 16 + rowDx(band, band.y);
  const moved = (band.y * 32 + nx) * 4;
  assert.ok(b.data[moved + 1] > 0, `stripe not found at output x=${nx} (rowDx=${rowDx(band, band.y)})`);
});

test("channel split ghosts red right and blue left around a stripe", () => {
  // White column at x=32. For an inactive band (dx=dy=0, exposure=1) with
  // split s: output x=32+s has red=255 (reads source x), x=32−s has blue=255,
  // x=32 keeps green.
  const params = { ...PARAMS, amount: 50, split: 10, seed: 7 };
  const { bands, split } = buildGlitchBands(params, 64, 32);
  assert.ok(split >= 1, `split should round to ≥1, got ${split}`);
  const band = bands.find((bd) => bd.dx === 0 && bd.dy === 0 && bd.exposure === 1);
  assert.ok(band, "expected an inactive band");
  const b = filled([0, 0, 0, 255], 64, 32);
  for (let y = 0; y < 32; y++) {
    const i = (y * 64 + 32) * 4;
    b.data[i] = b.data[i + 1] = b.data[i + 2] = 255;
  }
  glitch(b, params);
  const y = band.y;
  const redGhost = (y * 64 + 32 + split) * 4;
  const blueGhost = (y * 64 + 32 - split) * 4;
  const centre = (y * 64 + 32) * 4;
  assert.equal(b.data[redGhost], 255, "red ghost missing");
  assert.equal(b.data[blueGhost + 2], 255, "blue ghost missing");
  assert.equal(b.data[centre + 1], 255, "green centre missing");
});

test("exposure darkens active bands", () => {
  const b = filled([200, 200, 200, 255], 32, 32);
  const { bands } = buildGlitchBands({ ...PARAMS, style: "Signal Loss", amount: 100 }, 32, 32);
  glitch(b, { ...PARAMS, style: "Signal Loss", amount: 100 });
  const darkBand = bands.find((bd) => bd.exposure < 1 && bd.dx === 0);
  if (darkBand) {
    const i = (darkBand.y * 32 + 5) * 4;
    assert.ok(b.data[i] < 200);
  }
});

test("alpha is preserved", () => {
  const b = filled([100, 150, 200, 128], 16, 16);
  glitch(b, PARAMS);
  for (let i = 3; i < b.data.length; i += 4) {
    assert.equal(b.data[i], 128);
  }
});

test("registry wires apply for glitch", () => {
  const b = filled([100, 150, 200, 255], 24, 24);
  const before = [...b.data];
  EFFECTS.glitch.apply(b, PARAMS);
  assert.notDeepEqual([...b.data], before);
});

test("blocks=0 leaves output identical to pre-block path", () => {
  const a = filled([90, 120, 180, 255], 24, 24);
  glitch(a, PARAMS);
  const b = filled([90, 120, 180, 255], 24, 24);
  glitch(b, { ...PARAMS, blocks: 0 });
  assert.deepEqual([...b.data], [...a.data]);
});

test("blocks produce rectangular displaced regions", () => {
  const settings = glitchSettings({ ...PARAMS, blocks: 100 }, 1);
  const blocks = buildGlitchBlocks(settings, 64, 64);
  assert.ok(blocks.length > 0, "expected blocks at blocks=100");
  for (const bl of blocks) {
    assert.ok(bl.w >= 2 && bl.h >= 1);
    assert.ok(bl.x >= 0 && bl.x + bl.w <= 64);
    assert.ok(bl.y >= 0 && bl.y + bl.h <= 64);
  }
  const b = filled([90, 120, 180, 255], 64, 64);
  const before = [...b.data];
  glitch(b, { ...PARAMS, blocks: 100 });
  assert.notDeepEqual([...b.data], before);
});

test("block displacement shifts source pixels", () => {
  // Horizontal gradient: a displaced sample inside a block lands on a
  // different value than the band-only pass would produce.
  const grad = () => {
    const b = makeBuffer(64, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      b.data[i] = Math.round((x / 63) * 255);
      b.data[i + 1] = b.data[i + 2] = b.data[i];
      b.data[i + 3] = 255;
    }
    return b;
  };
  const noBlocks = grad();
  glitch(noBlocks, { ...PARAMS, blocks: 0, corrupt: 0, split: 0 });
  const withBlocks = grad();
  glitch(withBlocks, { ...PARAMS, blocks: 100, corrupt: 0, split: 0, amount: 100 });
  assert.notDeepEqual([...withBlocks.data], [...noBlocks.data]);
});

test("blocks are deterministic per seed", () => {
  const s1 = glitchSettings({ ...PARAMS, blocks: 80, seed: 42 }, 1);
  const s2 = glitchSettings({ ...PARAMS, blocks: 80, seed: 42 }, 1);
  const s3 = glitchSettings({ ...PARAMS, blocks: 80, seed: 43 }, 1);
  assert.deepEqual(buildGlitchBlocks(s1, 64, 64), buildGlitchBlocks(s2, 64, 64));
  assert.notDeepEqual(buildGlitchBlocks(s1, 64, 64), buildGlitchBlocks(s3, 64, 64));
});
