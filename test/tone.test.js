import { test } from "node:test";
import assert from "node:assert/strict";
import { EFFECTS } from "../registry.js";
import {
  duotone, tritone, posterize, posterizeByte, heatmap, drama, dramaSettings,
  chromatic, mapPixelColor, solarize, hueband, shadowshighlights,
} from "../effects/tone.js";

// These cases are ported from wobbletonefx tests/pixel-effects.test.js —
// the pinned byte values are identical; they now pin the engine's semantics.

function pixels(values, width = values.length) {
  return { data: new Uint8ClampedArray(values.flat()), width, height: values.length / width };
}

test("duotone maps black to shadow and white to adjusted highlight", () => {
  const image = pixels([[0, 0, 0, 91], [255, 255, 255, 173]]);
  duotone(image, { shadow: "#102030", highlight: "#e0d0c0", contrast: 0 });
  assert.deepEqual([...image.data], [16, 32, 48, 91, 224, 208, 192, 173]);
});

test("duotone contrast pushes the highlight outward from mid-gray", () => {
  const c50 = pixels([[255, 255, 255, 255]]);
  duotone(c50, { shadow: "#102030", highlight: "#e0d0c0", contrast: 50 });
  assert.deepEqual([...c50.data], [255, 248, 224, 255]);
  const c100 = pixels([[255, 255, 255, 255]]);
  duotone(c100, { shadow: "#102030", highlight: "#e0d0c0", contrast: 100 });
  assert.deepEqual([...c100.data], [255, 255, 255, 255]);
});

test("tritone maps midpoint luminance to the midtone", () => {
  const image = pixels([[128, 128, 128, 255]]);
  tritone(image, { shadow: "#000000", mid: "#804020", highlight: "#ffffff" });
  assert.ok(Math.abs(image.data[0] - 128) <= 1);
  assert.ok(Math.abs(image.data[1] - 64) <= 1);
  assert.ok(Math.abs(image.data[2] - 32) <= 1);
});

test("tritone maps the endpoints exactly", () => {
  const black = pixels([[0, 0, 0, 255]]);
  tritone(black, { shadow: "#000000", mid: "#804020", highlight: "#ffffff" });
  assert.deepEqual([...black.data], [0, 0, 0, 255]);
  const white = pixels([[255, 255, 255, 255]]);
  tritone(white, { shadow: "#000000", mid: "#804020", highlight: "#ffffff" });
  assert.deepEqual([...white.data], [255, 255, 255, 255]);
});

test("posterize uses discrete-table band boundaries", () => {
  assert.equal(posterizeByte(0, 4), 0);
  assert.equal(posterizeByte(63, 4), 0);
  assert.equal(posterizeByte(64, 4), 85);
  assert.equal(posterizeByte(255, 4), 255);
});

test("posterize applies per channel and preserves alpha", () => {
  const image = pixels([[63, 64, 255, 77]]);
  posterize(image, { steps: 4 });
  assert.deepEqual([...image.data], [0, 85, 255, 77]);
});

test("heatmap changes colour and preserves alpha", () => {
  const image = pixels([[120, 80, 40, 37]]);
  heatmap(image, { intensity: 100 });
  assert.equal(image.data[3], 37);
  assert.notDeepEqual([...image.data.slice(0, 3)], [120, 80, 40]);
});

test("heatmap known luminance mappings", () => {
  const mid = pixels([[128, 128, 128, 255]]);
  heatmap(mid, { intensity: 100 });
  assert.deepEqual([...mid.data], [135, 39, 82, 255]);
  const dark = pixels([[64, 64, 64, 255]]);
  heatmap(dark, { intensity: 100 });
  assert.deepEqual([...dark.data], [42, 3, 112, 255]);
});

test("heatmap intensity scales the palette", () => {
  const half = pixels([[200, 200, 200, 255]]);
  heatmap(half, { intensity: 50 });
  assert.deepEqual([...half.data], [118, 85, 7, 255]);
});

test("chromatic aberration shifts red and blue in opposing directions", () => {
  const image = pixels([[10, 1, 20, 255], [30, 2, 40, 255], [50, 3, 60, 255]], 3);
  chromatic(image, { offset: 1, strength: 100 });
  assert.deepEqual([...image.data], [10, 1, 40, 255, 10, 2, 60, 255, 30, 3, 60, 255]);
});

test("chromatic offset 0 is identity and strength 0 is identity", () => {
  const off0 = pixels([[10, 20, 30, 255]]);
  chromatic(off0, { offset: 0, strength: 100 });
  assert.deepEqual([...off0.data], [10, 20, 30, 255]);
  const s0 = pixels([[10, 1, 20, 255], [30, 2, 40, 255], [50, 3, 60, 255]], 3);
  chromatic(s0, { offset: 2, strength: 0 });
  assert.deepEqual([...s0.data], [10, 1, 20, 255, 30, 2, 40, 255, 50, 3, 60, 255]);
});

test("shadowshighlights lifts dark tones without touching highlights", () => {
  const image = pixels([[20, 20, 20, 255], [235, 235, 235, 255]], 2);
  shadowshighlights(image, { shadows: 100, highlights: 0 });
  assert.ok(image.data[0] > 20, "shadow pixel should lift");
  assert.deepEqual([...image.data.slice(4, 7)], [235, 235, 235], "highlight pixel untouched by shadows");
});

test("shadowshighlights dims bright tones without touching shadows", () => {
  const image = pixels([[20, 20, 20, 255], [235, 235, 235, 255]], 2);
  shadowshighlights(image, { shadows: 0, highlights: -100 });
  assert.deepEqual([...image.data.slice(0, 3)], [20, 20, 20], "shadow pixel untouched by highlights");
  assert.ok(image.data[4] < 235, "highlight pixel should dim");
});

test("shadowshighlights at zero is identity and preserves alpha", () => {
  const image = pixels([[40, 90, 160, 200], [128, 128, 128, 90]], 2);
  shadowshighlights(image, { shadows: 0, highlights: 0 });
  assert.deepEqual([...image.data], [40, 90, 160, 200, 128, 128, 128, 90]);
  const b = pixels([[30, 60, 90, 64]]);
  shadowshighlights(b, { shadows: 80, highlights: -50 });
  assert.equal(b.data[3], 64);
});

test("shadowshighlights masks peak at the tonal extremes", () => {
  const dark = pixels([[30, 30, 30, 255]]);
  const mid = pixels([[128, 128, 128, 255]]);
  shadowshighlights(dark, { shadows: 100, highlights: 0 });
  shadowshighlights(mid, { shadows: 100, highlights: 0 });
  // Mid-gray sits at the shadow mask's zero point; near-black lifts hard.
  assert.ok(dark.data[0] - 30 > 60);
  assert.ok(Math.abs(mid.data[0] - 128) <= 1);
});

test("drama at zero strength is neutral and preserves alpha", () => {
  const image = pixels([[90, 140, 210, 73]]);
  drama(image, { style: "Cinematic", strength: 0, shadows: 0, highlights: 0, saturation: 100 });
  assert.deepEqual([...image.data], [90, 140, 210, 73]);
});

test("drama looks produce distinct controlled tone mappings", () => {
  const source = [70, 130, 205, 111];
  const cinematic = pixels([source]);
  const noir = pixels([source]);
  drama(cinematic, { style: "Cinematic", strength: 100, shadows: 0, highlights: 0, saturation: 100 });
  drama(noir, { style: "Noir", strength: 100, shadows: 0, highlights: 0, saturation: 100 });
  assert.equal(cinematic.data[3], 111);
  assert.equal(noir.data[3], 111);
  assert.deepEqual([...cinematic.data.slice(0, 3)], [60, 132, 217]);
  assert.deepEqual([...noir.data.slice(0, 3)], [108, 108, 109]);
});

test("dramaSettings scales clarity and glow with strength", () => {
  const noir = dramaSettings({ style: "Noir", strength: 100, shadows: 0, highlights: 0, saturation: 100 });
  const portrait = dramaSettings({ style: "Portrait", strength: 100, shadows: 0, highlights: 0, saturation: 100 });
  const off = dramaSettings({ style: "Noir", strength: 0, shadows: 0, highlights: 0, saturation: 100 });
  assert.ok(noir.clarity > 0);
  assert.ok(portrait.clarity < 0 && portrait.glow > 0);
  assert.equal(off.clarity, 0);
  assert.equal(off.glow, 0);
});

test("drama clarity increases local contrast across a step edge", () => {
  // Blur radius is resolution-relative, so the image needs real extent.
  const W = 200, H = 200;
  const px = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px.push(x < W / 2 ? [100, 100, 100, 255] : [160, 160, 160, 255]);
  const noir = pixels(px, W);
  drama(noir, { style: "Noir", strength: 100, shadows: 0, highlights: 0, saturation: 100 });
  const at = (x, y) => noir.data[(y * W + x) * 4];
  // Unsharp masking pushes the dark side darker and the bright side brighter
  // near the edge, relative to flat-region pixels remapped by the LUT alone.
  assert.ok(at(99, 100) < at(10, 100));
  assert.ok(at(100, 100) > at(190, 100));
});

test("drama shadow and highlight controls move the intended tonal ranges", () => {
  const lifted = pixels([[30, 30, 30, 255], [225, 225, 225, 255]], 2);
  const crushed = pixels([[30, 30, 30, 255], [225, 225, 225, 255]], 2);
  drama(lifted, { style: "Portrait", strength: 100, shadows: 50, highlights: 50, saturation: 100 });
  drama(crushed, { style: "Portrait", strength: 100, shadows: -50, highlights: -50, saturation: 100 });
  assert.ok(lifted.data[0] > crushed.data[0]);
  assert.ok(lifted.data[4] > crushed.data[4]);
});

test("dramaSettings builds three 17-point tables and is deterministic", () => {
  const params = { style: "Storm", strength: 75, shadows: -10, highlights: -15, saturation: 90 };
  assert.deepEqual(dramaSettings(params), dramaSettings(params));
  assert.equal(dramaSettings(params).tables[0].length, 17);
});

test("dramaSettings is case-insensitive and falls back to cinematic", () => {
  const a = dramaSettings({ style: "CINEMATIC", strength: 50, shadows: 0, highlights: 0, saturation: 100 });
  const b = dramaSettings({ style: "cinematic", strength: 50, shadows: 0, highlights: 0, saturation: 100 });
  const c = dramaSettings({ style: "Nonsense", strength: 50, shadows: 0, highlights: 0, saturation: 100 });
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
});

test("mapPixelColor interpolates between stops", () => {
  const mapped = mapPixelColor(0.5, [[0, 0, 0], [255, 255, 255]]);
  assert.deepEqual(mapped, [128, 128, 128]);
});

test("custom effects are order-sensitive", () => {
  const source = [90, 140, 210, 255];
  const first = pixels([source]);
  posterize(first, { steps: 3 });
  duotone(first, { shadow: "#102030", highlight: "#e0a060", contrast: 0 });
  const second = pixels([source]);
  duotone(second, { shadow: "#102030", highlight: "#e0a060", contrast: 0 });
  posterize(second, { steps: 3 });
  assert.notDeepEqual([...first.data], [...second.data]);
});

test("drama remains order-sensitive with other tone effects", () => {
  const params = { style: "Bleach", strength: 85, shadows: -10, highlights: 15, saturation: 80 };
  const first = pixels([[90, 140, 210, 255]]);
  drama(first, params);
  posterize(first, { steps: 4 });
  const second = pixels([[90, 140, 210, 255]]);
  posterize(second, { steps: 4 });
  drama(second, params);
  assert.notDeepEqual([...first.data], [...second.data]);
});

test("registry wires apply for the tone effects", () => {
  for (const type of ["duotone", "tritone", "posterize", "solarize", "hueband", "heatmap", "drama", "chromatic"]) {
    assert.equal(typeof EFFECTS[type].apply, "function", `${type} missing apply`);
  }
});

/* ---------- solarize ---------- */

test("solarize at amount 0 is identity", () => {
  const image = pixels([[60, 140, 230, 200]]);
  solarize(image, { amount: 0, threshold: 50 });
  assert.deepEqual([...image.data], [60, 140, 230, 200]);
});

test("solarize inverts tones above the threshold at full mix", () => {
  const image = pixels([[200, 100, 255, 255]]);
  // threshold 50% = 127.5: 200 → 55, 255 → 0, 100 stays
  solarize(image, { amount: 100, threshold: 50 });
  assert.deepEqual([...image.data], [55, 100, 0, 255]);
});

test("solarize partial amount lerps toward the inverted tone", () => {
  const image = pixels([[200, 200, 200, 255]]);
  solarize(image, { amount: 50, threshold: 50 });
  // 200 → 55, half mix = 127.5 → 128
  assert.deepEqual([...image.data], [128, 128, 128, 255]);
});

test("solarize preserves alpha", () => {
  const image = pixels([[250, 250, 250, 77]]);
  solarize(image, { amount: 100, threshold: 30 });
  assert.equal(image.data[3], 77);
});

/* ---------- hueband ---------- */

test("hueband snaps hue to band centres, preserving S and L", () => {
  const image = pixels([[255, 0, 0, 255]]); // pure red, h=0 → band 0
  hueband(image, { bands: 4, spread: 0 });
  // bands=4 → 90° segments; red lands in band 0 whose centre is 45°
  // hsl(45°, 1, 0.5) = (255, 191, 0)
  assert.deepEqual([...image.data], [255, 191, 0, 255]);
});

test("hueband leaves achromatic pixels unchanged", () => {
  const image = pixels([[128, 128, 128, 255], [0, 0, 0, 255]]);
  hueband(image, { bands: 6, spread: 0 });
  assert.deepEqual([...image.data], [128, 128, 128, 255, 0, 0, 0, 255]);
});

test("hueband spread rotates successive bands apart", () => {
  // green h=120 → band 1 of 4; spread 100 adds band*seg = 90° to the 135° centre → 225°
  const image = pixels([[0, 255, 0, 255]]);
  hueband(image, { bands: 4, spread: 100 });
  // hsl(225°, 1, 0.5) = (0, 64, 255)
  assert.deepEqual([...image.data], [0, 64, 255, 255]);
});
