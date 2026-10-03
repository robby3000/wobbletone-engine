// gl/support.js — the single declaration of what the GPU path covers.
//
// Every GPU-renderable effect is declared here with the registry params its
// GPU path actually implements. canRenderGPU (gl/renderer.js) derives from
// this table, and test/gpu-support.test.js enforces coherence both ways:
// a registry param missing from its effect's entry fails (this is the class
// of bug that shipped an inert glitch Blocks slider), and a GPU path added
// without a table entry fails too.
//
// { fused: true }      — covered by the STEPS fused-run shader (fusion.js);
//                        every param flows through preparePixel
// { params: [...] }    — dedicated single-effect-run GPU pass
// { when: (p) => bool} — eligibility gate, evaluated per render
// { gatedParams: [...] } — params the GPU ignores; allowed only when `when`
//                        keeps them off the GPU path (glitch blocks)

export const GPU_SUPPORT = {
  // --- fused pixel-local steps (STEPS in gl/fusion.js) ---
  brightness:         { fused: true, params: ["v"] },
  contrast:           { fused: true, params: ["v"] },
  saturate:           { fused: true, params: ["v"] },
  grayscale:          { fused: true, params: ["exposure", "contrast", "shadows", "highlights", "filter", "intensity"] },
  hue:                { fused: true, params: ["v"] },
  sepia:              { fused: true, params: ["v"] },
  invert:             { fused: true, params: ["v"] },
  opacity:            { fused: true, params: ["v"] },
  duotone:            { fused: true, params: ["shadow", "highlight", "contrast"] },
  tritone:            { fused: true, params: ["shadow", "mid", "highlight"] },
  heatmap:            { fused: true, params: ["intensity"] },
  posterize:          { fused: true, params: ["steps"] },
  solarize:           { fused: true, params: ["amount", "threshold"] },
  hueband:            { fused: true, params: ["bands", "spread"] },
  shadowshighlights:  { fused: true, params: ["shadows", "highlights"] },

  // --- dedicated passes (gl/effects/*) ---
  blur:      { params: ["v"] },
  grain:     { params: ["size", "opacity", "blend", "seed"] },
  glitch: {
    params: ["style", "amount", "bandSize", "split", "corrupt", "seed"],
    // blocks is CPU-only — the GLSL path implements bands only.
    gatedParams: ["blocks"],
    when: (params) => !(Number(params.blocks) > 0),
  },
  bloom:     { params: ["blur", "threshold", "contrast", "saturate", "opacity", "color", "tint", "blend"] },
  chromatic: { params: ["offset", "strength"] },

  // --- overlay passes (gl/effects/overlay.js) ---
  colorwash: { params: ["color", "blend", "opacity"] },
  gradient:  { params: ["c1", "c2", "angle", "blend", "opacity"] },
  overlay:   { params: ["kind", "stops", "angle", "blend", "opacity"] },
  vignette:  { params: ["color", "size", "opacity"] },
  scanlines: { params: ["size", "color", "opacity", "blend"] },
  prism:     { params: ["c1", "c2", "angle", "width", "opacity"] },
};
