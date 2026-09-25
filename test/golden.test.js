import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { renderBuffer } from "../render.js";
import { createSpec } from "../spec.js";
import { encodePNG, crc32 } from "../scripts/png.mjs";
import { FIXTURES, CASES, fnv1a } from "./fixtures.js";

// Pinned FNV-1a hashes of the rendered output buffers. These ARE the spec:
// any behavioural change to an effect, blend, or compositor shows up here.
const EXPECTED = {
  "brightness": "1088fbd1",
  "contrast": "7860cff5",
  "saturate": "fb935706",
  "hue": "a79f0a5f",
  "sepia": "7a6332ba",
  "grayscale": "95699312",
  "invert": "c6b326ad",
  "opacity": "dc8e84dd",
  "blur": "1d5e2e8f",
  "duotone": "d65811ea",
  "tritone": "7ee8c19e",
  "posterize": "bb26b925",
  "heatmap": "64249c1f",
  "shadowshighlights": "d8f893aa",
  "drama": "ab4b7291",
  "chromatic": "38ec18c5",
  "bloom": "b3fb5d15",
  "dropshadow": "e6664d18",
  "colorwash": "ea0a896d",
  "gradient-overlay": "6ddbe10a",
  "stops-overlay": "f190d8c9",
  "vignette": "6de9cf4c",
  "scanlines": "d936a585",
  "prism": "26de827b",
  "grain": "e55462a6",
  "glitch": "4b98660f",
  "infrared": "be274bdf",
  "vintage": "7e9c8e37",
  "psychedelic": "ec999b06",
  "solarize": "2653d685",
  "hueband": "cdf6bf50",
  "stack-film": "0975c57d",
  "stack-neon": "3ffdf3fe",
  "stack-signal": "f5e5037a",
  "stack-print": "75a83739",
  "stack-dream": "27342a91",
  "stack-drama": "7891f42a",
};

for (const [name, fixture, effects] of CASES) {
  test(`golden ${name}`, () => {
    const out = renderBuffer(FIXTURES[fixture](), createSpec(effects));
    assert.equal(fnv1a(out.data), EXPECTED[name], `golden hash drifted — regenerate with scripts/dump-golden.mjs only if the change is intended`);
  });
}

test("every case has a pinned hash and vice versa", () => {
  const names = new Set(CASES.map(([n]) => n));
  assert.equal(names.size, CASES.length, "duplicate case names");
  assert.deepEqual(Object.keys(EXPECTED).sort(), [...names].sort());
});

test("golden hashes are stable across repeated renders", () => {
  for (const [name, fixture, effects] of CASES.slice(0, 6)) {
    const a = renderBuffer(FIXTURES[fixture](), createSpec(effects));
    const b = renderBuffer(FIXTURES[fixture](), createSpec(effects));
    assert.equal(fnv1a(a.data), fnv1a(b.data), `${name} not deterministic`);
  }
});

/* ---------- png.mjs sanity ---------- */

test("encodePNG emits a valid PNG header and IHDR", () => {
  const png = encodePNG(FIXTURES.gradient(4, 2));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(8), 13);          // IHDR length
  assert.equal(png.toString("ascii", 12, 16), "IHDR");
  assert.equal(png.readUInt32BE(16), 4);          // width
  assert.equal(png.readUInt32BE(20), 2);          // height
  assert.equal(png[24], 8);                        // bit depth
  assert.equal(png[25], 6);                        // RGBA
  assert.equal(png.toString("ascii", png.length - 8, png.length - 4), "IEND");
});

test("encodePNG IDAT inflates back to the source scanlines", () => {
  const src = FIXTURES.noise(8, 4);
  const png = encodePNG(src);
  // locate the IDAT chunk
  let o = 8;
  let idat = null;
  while (o < png.length) {
    const len = png.readUInt32BE(o);
    const type = png.toString("ascii", o + 4, o + 8);
    if (type === "IDAT") idat = png.subarray(o + 8, o + 8 + len);
    o += 12 + len;
  }
  const raw = inflateSync(idat);
  const stride = src.width * 4;
  assert.equal(raw.length, (stride + 1) * src.height);
  for (let y = 0; y < src.height; y++) {
    assert.equal(raw[y * (stride + 1)], 0, "filter byte");
    assert.deepEqual([...raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))],
      [...src.data.subarray(y * stride, (y + 1) * stride)]);
  }
});

test("crc32 matches the PNG spec's known vector", () => {
  // CRC of "IEND" is the well-known AE426082 (the IEND chunk's own CRC field
  // with empty data).
  assert.equal(crc32(Buffer.from("IEND", "ascii")).toString(16), "ae426082");
});
