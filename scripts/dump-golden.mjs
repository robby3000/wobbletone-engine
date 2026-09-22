// Dev tool: render every fixture + golden case to test/golden/*.png for
// human eyeballing. The folder is gitignored. Usage: node scripts/dump-golden.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderBuffer } from "../render.js";
import { createSpec } from "../spec.js";
import { encodePNG } from "./png.mjs";
import { FIXTURES, CASES, fnv1a } from "../test/fixtures.js";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "../test/golden");
mkdirSync(outDir, { recursive: true });

for (const [name, make] of Object.entries(FIXTURES)) {
  writeFileSync(join(outDir, `fixture-${name}.png`), encodePNG(make()));
}

for (const [name, fixture, effects] of CASES) {
  const out = renderBuffer(FIXTURES[fixture](), createSpec(effects));
  writeFileSync(join(outDir, `${name}.png`), encodePNG(out));
  console.log(`${name.padEnd(20)} ${fnv1a(out.data)}`);
}
