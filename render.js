// render.js — ordered spec dispatcher.
//
// Spec px-params are defined in SOURCE pixels (the image's native
// resolution). renderScale = buffer.width / sourceWidth maps them into
// render pixels: every px-flagged param is multiplied before dispatch.
// Non-px params (percentages, angles, colors, selects, seeds) pass through
// unchanged. ctx.renderScale is also handed to each apply for effects
// whose resolution dependence is *derived* rather than a direct param
// (glitch displacement).
//
// The input buffer is NOT mutated — a clone is rendered and returned.
//
// Dispatch pipeline:
//   1. expandEffects — compounds splice their primitive recipe in
//   2. planRuns — consecutive pixelLocal effects group into fused runs
//   3. each run = one buffer pass (mapPixels for fused, apply otherwise)
// options.fuse === false keeps one pass per expanded effect (debug/parity).

import { cloneBuffer, mapPixels } from "./buffer.js";
import { validateSpec } from "./spec.js";
import { EFFECTS } from "./registry.js";

// Splice compound expansions (registry `expand: params → effects[]`) into
// the stream. Expanded params are unscaled spec values — px scaling happens
// per-effect at dispatch like any other entry.
export function expandEffects(effects) {
  const out = [];
  for (const e of effects) {
    const def = EFFECTS[e.type];
    if (def && typeof def.expand === "function") out.push(...def.expand(e.params));
    else out.push(e);
  }
  return out;
}

// Group expanded effects into dispatch units: maximal runs of consecutive
// pixelLocal effects share one pass; anything else is a run boundary.
// Exported for hosts that render/cache per unit (wobbletonefx incremental
// preview, the GPU pass planner).
export function planRuns(effects) {
  const runs = [];
  for (const e of expandEffects(effects)) {
    const last = runs[runs.length - 1];
    if (last && EFFECTS[e.type]?.pixelLocal && EFFECTS[last[0].type]?.pixelLocal) last.push(e);
    else runs.push([e]);
  }
  return runs;
}

export function renderBuffer(buffer, spec, options = {}) {
  const validated = validateSpec(spec);
  const sourceWidth = options.sourceWidth ?? buffer.width;
  const renderScale = buffer.width / sourceWidth;
  const ctx = { renderScale };
  const out = cloneBuffer(buffer);

  const collect = Boolean(options.collectStats);
  const perEffect = [];
  const t0 = performance.now();

  const runs = options.fuse === false
    ? expandEffects(validated.effects).map((e) => [e])
    : planRuns(validated.effects);

  for (const run of runs) {
    const def = EFFECTS[run[0].type];
    const e0 = collect ? performance.now() : 0;
    if (def.pixelLocal) {
      const steps = run.map((e) => {
        const params = scaleParams(EFFECTS[e.type], e.params, renderScale);
        const pre = EFFECTS[e.type].preparePixel
          ? EFFECTS[e.type].preparePixel(params)
          : params;
        return (px) => EFFECTS[e.type].applyPixel(px, pre);
      });
      mapPixels(out, steps);
    } else {
      if (typeof def.apply !== "function") {
        throw new Error(`renderBuffer: effect "${run[0].type}" has no renderer`);
      }
      def.apply(out, scaleParams(def, run[0].params, renderScale), ctx);
    }
    if (collect) perEffect.push({ type: run.map((e) => e.type).join("+"), ms: performance.now() - e0 });
  }

  if (collect) {
    options.stats = {
      ms: performance.now() - t0,
      renderer: "cpu",
      fallbackReason: null,
      logical: validated.effects.length,
      passes: runs.length,
      perEffect,
    };
  }
  return out;
}

export function scaleParams(def, params, renderScale) {
  if (renderScale === 1) return params;
  let scaled = null;
  for (const key of Object.keys(params)) {
    if (def.params[key]?.px) {
      if (!scaled) scaled = { ...params };
      scaled[key] = params[key] * renderScale;
    }
  }
  return scaled ?? params;
}
