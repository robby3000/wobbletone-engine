# wobbletone-engine

Shared, deterministic image-effects engine for WobbleTone FX and Aimless.

Renders a versioned **Filter Specification** (semantic JSON effect stack) to
pixels. No CSS filters, no SVG primitives, no `ctx.filter`. Consumed as a
**git submodule** by:

- `wobbletonefx` → mounted at `engine/`
- `aimless` → mounted at `public/lib/engine/`

Plain ES modules, zero dependencies, no build step. Tests run in Node:
`node --test test/*.test.js`.

## API

```js
import { renderBuffer } from "./render.js";
import { renderToCanvas } from "./canvas.js";

const out = renderBuffer(buffer, spec);
// buffer: { data: Uint8ClampedArray, width, height } in RGBA straight alpha, sRGB
// spec:   { format: "wobbletone-filter", version: 1, name, effects: [{ type, params }] }

renderToCanvas(imageOrBitmap, spec, { renderer: "auto" });  // DOM path
```

`renderBuffer` is the CPU reference path — it has no renderer switch.
Renderer selection happens through `renderToCanvas` / `renderBufferGPU`, which
route via `pickRenderer`: `options.renderer` is `"cpu"` (default), `"webgl2"`,
or `"auto"` (WebGL2 when it can cover the whole stack, CPU otherwise).
Pixel-valued params are flagged `px: true` in `registry.js` and scaled by
render resolution, so a preview and a full-res export of the same spec agree.

## Renderers

The CPU path is the reference implementation and the source of every semantic
decision. WebGL2 is an accelerator layered on top, selected by `"auto"` when it
can cover the whole stack.

Dispatch rule: the GPU takes a render only if **every** effect in the spec has
a GPU path. Stacks containing a CPU-only effect (`drama`, `dropshadow`,
`liquid`, `specular`, `morphology`, `outline`, `echo`, or `glitch` with
`blocks` > 0) render entirely on CPU: a stack is never split mid-render. The session also demotes
GPU if shadow probes show it is slower, and recovers cleanly from context loss
(`webglcontextlost`/`restored` rebuild the session).

## Layout

```
buffer.js  render.js  registry.js  canvas.js    buffer type, spec expansion, dispatch
color.js   blend semantics (W3C compositing, 0–1 channel space)
rng.js     seeded PRNG; engine code never calls Math.random()
pool.js    buffer/float-array pooling
effects/   CPU implementations, one module per family
gl/
  context.js   capability detection (probed once, cached)
  infra.js     live context + program cache + texture pool, rebuilt on restore
  programs.js  shader compile/link cache, fullscreen quad
  textures.js  RGBA8 pool + ping-pong, straight alpha end to end
  readback.js  CPU buffer <-> GPU texture transfers
  fusion.js    generates one fragment shader per pixel-local run
  blends.js    blend modes as GLSL, ported line-for-line from color.js
  renderer.js  GPU render entry; all-or-nothing dispatch
  index.js     pickRenderer chooses CPU vs WebGL2 from caps + caller preference
  effects/     GPU implementations by family
```

## Tests and parity

- `npm test` → `node --test test/*.test.js` (378 tests).
- `test/golden.test.js` pins a hash of every golden case's CPU output.
  Regenerate expectations after intended changes with
  `scripts/dump-golden.mjs`.
- `parity.html` is the browser harness: serves CPU vs GPU renders of every
  effect with maxAbs/meanAbs/pct diffs per case, plus a **Lose GL context**
  button for exercising context-loss recovery. Serve the repo root and open
  `/parity.html`.
- Node-side `test/gl-*.js` pins the CPU↔GLSL contract (uniform packing, blend
  indices, kernel weights); pixel-level GPU parity is parity.html's job.

## Determinism

All randomness flows through `rng.js` seeded streams. Golden hashes pin output
per effect; effect order is strict; unknown spec types are rejected,
out-of-range numbers clamped, unknown keys ignored.
