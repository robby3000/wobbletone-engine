// The WobbleTone Filter Specification — versioned, renderer-independent JSON.
//
//   { format: "wobbletone-filter", version: 1, name?, effects: [{ type, params }] }
//
// Two entry points with deliberately different strictness:
//   validateSpec    — strict: throws with clear messages (spec import path)
//   specFromLegacy  — lenient: migrates {defId,enabled,params} records, fixing
//                     or defaulting bad values instead of throwing (preset path)

import { EFFECTS } from "./registry.js";
import { clamp } from "./color.js";

export const SPEC_FORMAT = "wobbletone-filter";
export const SPEC_VERSION = 1;

const HEX_COLOR = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

export function createSpec(effects, name) {
  const spec = { format: SPEC_FORMAT, version: SPEC_VERSION, effects };
  if (name !== undefined) spec.name = String(name);
  return validateSpec(spec);
}

export function validateSpec(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error("spec must be an object");
  }
  if (spec.format !== SPEC_FORMAT) {
    throw new Error(`unsupported format ${JSON.stringify(spec.format)} — expected "${SPEC_FORMAT}"`);
  }
  if (spec.version !== SPEC_VERSION) {
    throw new Error(`unsupported spec version ${JSON.stringify(spec.version)} — expected ${SPEC_VERSION}`);
  }
  if (!Array.isArray(spec.effects)) {
    throw new Error("spec.effects must be an array");
  }
  const out = {
    format: SPEC_FORMAT,
    version: SPEC_VERSION,
    effects: spec.effects.map(validateEffect),
  };
  if (spec.name !== undefined) out.name = String(spec.name);
  return out;
}

function validateEffect(raw, index) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`effects[${index}] must be an object`);
  }
  const def = EFFECTS[raw.type];
  if (!def) {
    throw new Error(`unknown effect type ${JSON.stringify(raw.type)} at effects[${index}]`);
  }
  const input = raw.params && typeof raw.params === "object" && !Array.isArray(raw.params) ? raw.params : {};
  const params = {};
  for (const [key, decl] of Object.entries(def.params)) {
    params[key] = validateParam(decl, input[key], `${raw.type}.${key}`);
  }
  return { type: raw.type, params };
}

function validateParam(decl, value, label) {
  switch (decl.kind) {
    case "number": {
      if (value === undefined) return decl.default;
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${label}: expected a number, got ${JSON.stringify(value)}`);
      return clamp(n, decl.min, decl.max);
    }
    case "select": {
      if (value === undefined) return decl.default;
      if (!decl.options.includes(value)) {
        throw new Error(`${label}: ${JSON.stringify(value)} is not one of ${decl.options.join(", ")}`);
      }
      return value;
    }
    case "color": {
      if (value === undefined) return decl.default;
      if (typeof value !== "string" || !HEX_COLOR.test(value)) {
        throw new Error(`${label}: expected a hex color, got ${JSON.stringify(value)}`);
      }
      return value.toLowerCase();
    }
    case "stops": {
      if (value === undefined) return decl.default.map((s) => [...s]);
      return validateStops(value, label);
    }
    default:
      throw new Error(`${label}: unknown param kind ${JSON.stringify(decl.kind)}`);
  }
}

function validateStops(value, label) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`${label}: expected an array of [offset, color] stops`);
  }
  return value.map((stop, i) => {
    if (!Array.isArray(stop) || stop.length < 2) {
      throw new Error(`${label}: stop ${i} must be a [offset, color] pair`);
    }
    const offset = Number(stop[0]);
    if (!Number.isFinite(offset)) {
      throw new Error(`${label}: stop ${i} offset must be a number, got ${JSON.stringify(stop[0])}`);
    }
    if (typeof stop[1] !== "string" || !stop[1]) {
      throw new Error(`${label}: stop ${i} color must be a css-color string`);
    }
    return [clamp(offset, 0, 1), stop[1]];
  });
}

/* ---------- Legacy migration ---------- */

// Port of app.js migrateEffectData — glow/halation fold into bloom.
// Returns a spec-form { type, params } or null when there is nothing to migrate.
export function migrateLegacyEffect(effect) {
  if (!effect || !effect.defId) return null;
  const params = { ...(effect.params || {}) };
  if (effect.defId === "glow") {
    return {
      type: "bloom",
      params: {
        blur: params.blur ?? 8,
        threshold: params.brightness ?? 180,
        contrast: 100,
        saturate: 130,
        opacity: params.opacity ?? 60,
        color: params.color || "#ffffff",
        tint: 100,
        blend: "screen",
      },
    };
  }
  if (effect.defId === "halation") {
    return {
      type: "bloom",
      params: {
        blur: params.blur ?? 18,
        threshold: params.threshold ?? 160,
        contrast: 200,
        saturate: 100,
        opacity: params.opacity ?? 55,
        color: params.color || "#ff7a3c",
        tint: 100,
        blend: "lighten",
      },
    };
  }
  return { type: effect.defId, params };
}

// {defId, enabled, params}[] → spec. Lenient: drops disabled effects and
// effects whose type is not in the registry, clamps out-of-range numbers and
// falls back to defaults for bad values rather than throwing. Adds seed:1 to
// grain (legacy grain had no seed; the spec requires determinism).
export function specFromLegacy(legacyEffects, name) {
  const effects = [];
  for (const effect of legacyEffects || []) {
    if (!effect || effect.enabled === false) continue;
    const migrated = migrateLegacyEffect(effect);
    if (!migrated || !EFFECTS[migrated.type]) continue;
    if (migrated.type === "grain" && migrated.params.seed === undefined) {
      migrated.params.seed = 1;
    }
    effects.push({ type: migrated.type, params: sanitizeParams(migrated.type, migrated.params) });
  }
  const spec = { format: SPEC_FORMAT, version: SPEC_VERSION, effects };
  if (name !== undefined) spec.name = String(name);
  return spec;
}

function sanitizeParams(type, input = {}) {
  const params = {};
  for (const [key, decl] of Object.entries(EFFECTS[type].params)) {
    params[key] = sanitizeParam(decl, input[key]);
  }
  return params;
}

function sanitizeParam(decl, value) {
  if (value === undefined) {
    return decl.kind === "stops" ? decl.default.map((s) => [...s]) : decl.default;
  }
  switch (decl.kind) {
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? clamp(n, decl.min, decl.max) : decl.default;
    }
    case "select":
      return decl.options.includes(value) ? value : decl.default;
    case "color":
      return typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : decl.default;
    case "stops":
      try {
        return validateStops(value, "stops");
      } catch {
        return decl.default.map((s) => [...s]);
      }
    default:
      return decl.default;
  }
}
