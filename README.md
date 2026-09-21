# wobbletone-engine

Shared, deterministic image-effects engine for WobbleTone FX and Aimless.

Renders a versioned **Filter Specification** (semantic JSON effect stack) to
pixels via a CPU reference renderer — no CSS filters, no SVG primitives, no
`ctx.filter`. Consumed as a **git submodule** by:

- `wobbletonefx` → mounted at `engine/`
- `aimless` → mounted at `public/lib/engine/`

Plain ES modules, zero dependencies, no build step. Tests run in Node:
`node --test test/*.test.js`.
