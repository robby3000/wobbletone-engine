import { test } from "node:test";
import assert from "node:assert/strict";
import { EFFECTS } from "../registry.js";
import { parseCssColor } from "../color.js";
import {
  solidFillLayer, linearGradientLayer, radialGradientLayer, scanlinesLayer,
  sampleStops, colorwash, gradient, overlay, vignette, scanlines, prism,
} from "../effects/overlay.js";
import { makeBuffer } from "../buffer.js";

const pxAt = (layer, x, y) => {
  const i = (y * layer.width + x) * 4;
  return [...layer.data.slice(i, i + 4)];
};

const filled = (rgba, w, h) => {
  const b = makeBuffer(w, h);
  for (let i = 0; i < b.data.length; i += 4) {
    b.data[i] = rgba[0]; b.data[i + 1] = rgba[1]; b.data[i + 2] = rgba[2]; b.data[i + 3] = rgba[3];
  }
  return b;
};

/* ---------- parseCssColor ---------- */

test("parseCssColor covers the spec stop vocabulary", () => {
  assert.deepEqual(parseCssColor("transparent"), [0, 0, 0, 0]);
  assert.deepEqual(parseCssColor("#ff0080"), [255, 0, 128, 255]);
  assert.deepEqual(parseCssColor("#f08"), [255, 0, 136, 255]);
  assert.deepEqual(parseCssColor("rgb(40,20,0)"), [40, 20, 0, 255]);
  assert.deepEqual(parseCssColor("rgba(40,20,0,0.4)"), [40, 20, 0, 102]);
  assert.throws(() => parseCssColor("chartreuse"), /unsupported color/);
  assert.throws(() => parseCssColor("#zzz"), /bad hex/);
});

/* ---------- sampleStops ---------- */

test("sampleStops lerps between opaque stops", () => {
  const stops = [[0, "#000000"], [1, "#ffffff"]];
  assert.deepEqual(sampleStops(stops, 0.5), [127.5, 127.5, 127.5, 255]);
});

test("transparent-to-color keeps hue while alpha ramps (premultiplied)", () => {
  const stops = [[0, "transparent"], [1, "#ff0000"]];
  const mid = sampleStops(stops, 0.5);
  assert.deepEqual(mid, [255, 0, 0, 127.5]); // NOT [128,0,0,127.5] — CSS premul semantics
});

test("sampleStops clamps outside the stop range", () => {
  const stops = [[0.2, "#102030"], [0.8, "#405060"]];
  assert.deepEqual(sampleStops(stops, 0), [16, 32, 48, 255]);
  assert.deepEqual(sampleStops(stops, 1), [64, 80, 96, 255]);
});

/* ---------- layer generators ---------- */

test("solidFillLayer fills every pixel", () => {
  const layer = solidFillLayer(3, 2, "#102030");
  assert.equal(layer.width, 3);
  for (let i = 0; i < layer.data.length; i += 4) {
    assert.deepEqual([...layer.data.slice(i, i + 4)], [16, 32, 48, 255]);
  }
});

test("linear gradient angle 0 puts c2 at top, c1 at bottom", () => {
  const stops = [[0, "#ff0000"], [1, "#0000ff"]];
  const layer = linearGradientLayer(4, 4, 0, stops);
  assert.deepEqual(pxAt(layer, 0, 0), [32, 0, 223, 255]);
  assert.deepEqual(pxAt(layer, 3, 3), [223, 0, 32, 255]);
});

test("linear gradient angle 90 puts c1 left, c2 right", () => {
  const stops = [[0, "#ff0000"], [1, "#0000ff"]];
  const layer = linearGradientLayer(4, 4, 90, stops);
  assert.deepEqual(pxAt(layer, 0, 1), [223, 0, 32, 255]);
  assert.deepEqual(pxAt(layer, 3, 1), [32, 0, 223, 255]);
});

test("linear gradient angle 135 lands c1 top-left and c2 bottom-right", () => {
  const stops = [[0, "#ff0000"], [1, "#0000ff"]];
  const layer = linearGradientLayer(4, 4, 135, stops);
  assert.deepEqual(pxAt(layer, 0, 0), [223, 0, 32, 255]);
  assert.deepEqual(pxAt(layer, 3, 3), [32, 0, 223, 255]);
  // off-diagonal corners sit near the midpoint
  const [r] = pxAt(layer, 3, 0);
  assert.ok(Math.abs(r - 128) <= 1);
});

test("radial gradient is transparent inside the inner stop and full at corners", () => {
  const layer = radialGradientLayer(4, 4, [[0.4, "transparent"], [1, "#000000"]]);
  assert.equal(pxAt(layer, 1, 1)[3], 0);
  assert.equal(pxAt(layer, 2, 1)[3], 0);
  assert.equal(pxAt(layer, 0, 0)[3], 255);
  assert.equal(pxAt(layer, 3, 3)[3], 255);
  assert.equal(pxAt(layer, 0, 1)[3], 166); // edge midpoint, partial ramp
});

test("scanlines integer size alternates covered rows", () => {
  const layer = scanlinesLayer(2, 6, 2, "#000000");
  for (let y = 0; y < 6; y++) {
    assert.equal(pxAt(layer, 0, y)[3], y % 2 === 0 ? 255 : 0, `row ${y}`);
  }
});

test("scanlines fractional size gives canvas-AA-like partial coverage", () => {
  const layer = scanlinesLayer(2, 5, 2.5, "#000000");
  const alphas = [0, 1, 2, 3, 4].map((y) => pxAt(layer, 0, y)[3]);
  assert.deepEqual(alphas, [255, 0, 0, 128, 0]);
});

/* ---------- effects ---------- */

test("colorwash normal blend lerps the fill colour by opacity", () => {
  const b = filled([100, 100, 100, 255], 2, 2);
  colorwash(b, { color: "#ffffff", blend: "normal", opacity: 50 });
  assert.deepEqual([...b.data.slice(0, 4)], [178, 178, 178, 255]);
});

test("colorwash multiply black darkens regardless of source", () => {
  const b = filled([100, 150, 200, 255], 1, 1);
  colorwash(b, { color: "#000000", blend: "multiply", opacity: 100 });
  assert.deepEqual([...b.data], [0, 0, 0, 255]);
});

test("gradient effect composites the c1→c2 layer", () => {
  const b = filled([0, 0, 0, 255], 4, 4);
  gradient(b, { c1: "#ff0000", c2: "#0000ff", angle: 0, blend: "normal", opacity: 100 });
  // opaque layer at 100% → output IS the layer
  assert.deepEqual(pxAt(b, 0, 0), [32, 0, 223, 255]);
  assert.deepEqual(pxAt(b, 3, 3), [223, 0, 32, 255]);
});

test("generic overlay radial matches vignette-style geometry", () => {
  const b = filled([255, 255, 255, 255], 4, 4);
  overlay(b, {
    kind: "radial",
    stops: [[0.6, "transparent"], [1, "rgba(40,20,0,0.4)"]],
    angle: 135, blend: "multiply", opacity: 100,
  });
  const center = pxAt(b, 1, 1);
  const corner = pxAt(b, 0, 0);
  assert.deepEqual(center, [255, 255, 255, 255]); // inside transparent zone
  assert.ok(corner[0] < 255 && corner[3] === 255, "corner must be darkened by multiply");
});

test("vignette darkens edges and leaves the centre alone", () => {
  const b = filled([255, 255, 255, 255], 8, 8);
  vignette(b, { color: "#000000", size: 60, opacity: 100 });
  const corner = pxAt(b, 0, 0);
  const center = pxAt(b, 4, 4);
  assert.deepEqual(corner.slice(0, 3), [0, 0, 0]);       // multiply × black
  assert.deepEqual(center.slice(0, 3), [255, 255, 255]); // inside transparent zone
});

test("vignette honours opacity", () => {
  const full = filled([255, 255, 255, 255], 8, 8);
  const half = filled([255, 255, 255, 255], 8, 8);
  vignette(full, { color: "#000000", size: 60, opacity: 100 });
  vignette(half, { color: "#000000", size: 60, opacity: 50 });
  const cF = pxAt(full, 0, 0)[0];
  const cH = pxAt(half, 0, 0)[0];
  assert.ok(cH > cF && cH < 255);
});

test("scanlines effect composites line colour per blend/opacity", () => {
  const b = filled([200, 200, 200, 255], 2, 4);
  scanlines(b, { size: 2, color: "#000000", opacity: 100, blend: "multiply" });
  assert.deepEqual(pxAt(b, 0, 0), [0, 0, 0, 255]);   // line row × black
  assert.deepEqual(pxAt(b, 0, 1), [200, 200, 200, 255]); // gap row untouched
});

test("prism leaves a light streak along its angle axis", () => {
  const b = filled([40, 40, 40, 255], 9, 9);
  prism(b, { c1: "#ff2e88", c2: "#2effd5", angle: 90, width: 20, opacity: 100 });
  const centre = pxAt(b, 4, 4);
  const edge = pxAt(b, 0, 4);
  assert.ok(centre[0] > 200, "centre streak must be bright (screen + white)");
  assert.deepEqual(edge, [40, 40, 40, 255]); // outside the streak: transparent
});

test("effects mutate and return the backdrop buffer", () => {
  const b = filled([50, 50, 50, 255], 2, 2);
  assert.equal(colorwash(b, { color: "#000000", blend: "normal", opacity: 100 }), b);
});

test("registry wires apply for the six overlay effects", () => {
  for (const type of ["colorwash", "gradient", "overlay", "vignette", "scanlines", "prism"]) {
    assert.equal(typeof EFFECTS[type].apply, "function", `${type} missing apply`);
  }
});
