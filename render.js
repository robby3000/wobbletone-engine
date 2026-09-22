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

import { cloneBuffer } from "./buffer.js";
import { validateSpec } from "./spec.js";
import { EFFECTS } from "./registry.js";

export function renderBuffer(buffer, spec, options = {}) {
  const validated = validateSpec(spec);
  const sourceWidth = options.sourceWidth ?? buffer.width;
  const renderScale = buffer.width / sourceWidth;
  const ctx = { renderScale };
  const out = cloneBuffer(buffer);

  const collect = Boolean(options.collectStats);
  const perEffect = [];
  const t0 = performance.now();

  for (const effect of validated.effects) {
    const def = EFFECTS[effect.type];
    if (typeof def.apply !== "function") {
      throw new Error(`renderBuffer: effect "${effect.type}" has no renderer`);
    }
    const params = scaleParams(def, effect.params, renderScale);
    const e0 = collect ? performance.now() : 0;
    def.apply(out, params, ctx);
    if (collect) perEffect.push({ type: effect.type, ms: performance.now() - e0 });
  }

  if (collect) {
    options.stats = { ms: performance.now() - t0, passes: validated.effects.length, perEffect };
  }
  return out;
}

function scaleParams(def, params, renderScale) {
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
