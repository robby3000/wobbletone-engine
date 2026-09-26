// gl/fusion.js — generate one fragment shader per pixel-local run.
//
// Each of the 15 pixel-local effects gets a GLSL step ported from its
// applyPixel, operating in BYTE space (0–255) so constants and rounding
// sites port 1:1. Quantization mirrors the CPU exactly: q8 sites use
// rne (round-half-to-even, ToUint8Clamp), Math.round sites use rnd
// (half-up). Prepared constants come from the same preparePixel() the
// CPU path calls — one source of truth, shipped as uniforms.
//
// buildFusedRun(run) -> { src, uniforms: [{name, type, value}] }
//   run = expanded effect entries with renderScale-scaled params.
// canRunGPU(type) -> the effect has a GLSL step.

// Exported so other GPU shaders (glitch corrupt modes) reuse the same
// ported helpers instead of re-deriving them.
export const HELPERS = /* glsl */ `
// ToUint8Clamp-equivalent: clamp 0..255, round half to EVEN.
float rne(float x) {
  float f = floor(x);
  float d = x - f;
  if (d > 0.5) return f + 1.0;
  if (d < 0.5) return f;
  return mod(f, 2.0) < 0.5 ? f : f + 1.0;
}
float rnd(float x) { return floor(x + 0.5); }        // Math.round (half-up)
float q8f(float x) { return clamp(rne(x), 0.0, 255.0); }
vec3 q8v(vec3 v) { return vec3(q8f(v.r), q8f(v.g), q8f(v.b)); }
float lb(float a, float b, float t) { return clamp(rnd(a + (b - a) * t), 0.0, 255.0); }

// mapPixelColor port: gradient LUT in byte space.
vec3 gradientMapG(vec3 c, vec3 cols[6], int n) {
  float lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255.0;
  float pos = lum * float(n - 1);
  float lower = floor(pos);
  int li = int(lower);
  int ui = min(n - 1, li + 1);
  float amt = pos - lower;
  vec3 lo = cols[li], up = cols[ui];
  return vec3(lb(lo.r, up.r, amt), lb(lo.g, up.g, amt), lb(lo.b, up.b, amt));
}

// rgbToHsl / hslToRgb ports (color.js): bytes in -> [h(0-360),s,l];
// hslToRgbG -> bytes. mod() vs JS % on negatives: (g-b)/d % 6 in JS can
// go negative then +360 later; mod() lands in [0,6) directly — same
// hue modulo 360 either way.
vec3 rgbToHslG(vec3 c) {
  c /= 255.0;
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float d = mx - mn;
  float l = (mx + mn) / 2.0;
  if (d == 0.0) return vec3(0.0, 0.0, l);
  float s = d / (1.0 - abs(2.0 * l - 1.0));
  float h;
  if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
  else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  return vec3(h * 60.0, s, l);
}
vec3 hslToRgbG(vec3 hsl) {
  float h = mod(mod(hsl.x, 360.0) + 360.0, 360.0);
  float s = hsl.y, l = hsl.z;
  float cc = (1.0 - abs(2.0 * l - 1.0)) * s;
  float x = cc * (1.0 - abs(mod(h / 60.0, 2.0) - 1.0));
  float m = l - cc / 2.0;
  vec3 rgb =
    h < 60.0 ? vec3(cc, x, 0.0) :
    h < 120.0 ? vec3(x, cc, 0.0) :
    h < 180.0 ? vec3(0.0, cc, x) :
    h < 240.0 ? vec3(0.0, x, cc) :
    h < 300.0 ? vec3(x, 0.0, cc) :
    vec3(cc, 0.0, x);
  return vec3(
    clamp(rnd((rgb.r + m) * 255.0), 0.0, 255.0),
    clamp(rnd((rgb.g + m) * 255.0), 0.0, 255.0),
    clamp(rnd((rgb.b + m) * 255.0), 0.0, 255.0));
}
float posterizeB(float v, float steps) {
  float band = min(steps - 1.0, floor(v / 256.0 * steps));
  return rnd(band / (steps - 1.0) * 255.0);
}
`;

// Per-effect step descriptors. decls(i)/call(i) emit GLSL; vals(i, pre)
// emits [{name, type, value}] for the uniform setter. `pre` is the
// output of the effect's own preparePixel(params) — shared constants.
const STEPS = {
  brightness: {
    decls: (i) => [`uniform float u${i}a;`],
    call: (i) => `c.rgb = q8v(c.rgb * u${i}a);`,
    vals: (i, pre) => [[`u${i}a`, "float", pre]],
  },
  contrast: {
    decls: (i) => [`uniform float u${i}a;`],
    call: (i) => `c.rgb = q8v((c.rgb - 128.0) * u${i}a + 128.0);`,
    vals: (i, pre) => [[`u${i}a`, "float", pre]],
  },
  saturate: {
    decls: (i) => [`uniform float u${i}a;`],
    call: (i) => `{
      float l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      c.rgb = q8v(vec3(l) + (c.rgb - vec3(l)) * u${i}a);
    }`,
    vals: (i, pre) => [[`u${i}a`, "float", pre]],
  },
  grayscale: {
    decls: (i) => [
      `uniform vec3 u${i}w;`,
      `uniform float u${i}gain;`,
      `uniform float u${i}ck;`,
      `uniform float u${i}sa;`,
      `uniform float u${i}ha;`,
      `uniform float u${i}norm;`,
    ],
    call: (i) => `{
      float v = dot(u${i}w, c.rgb) * u${i}gain / 255.0;
      if (v > 0.75) v = 0.75 + 0.25 * (1.0 - exp(-3.0 * (v - 0.75))) / u${i}norm;
      v = 128.0 + (v * 255.0 - 128.0) * u${i}ck;
      float l = clamp(v, 0.0, 255.0) / 255.0;
      float t1 = 1.0 - l / 0.5, t2 = (l - 0.5) / 0.5;
      float delta = u${i}sa * (l < 0.5 ? t1 * t1 : 0.0)
                  + u${i}ha * (l > 0.5 ? t2 * t2 : 0.0);
      v = clamp(rnd(v + delta), 0.0, 255.0);
      c.rgb = vec3(v);
    }`,
    vals: (i, p) => [
      [`u${i}w`, "vec3", [p.wr, p.wg, p.wb]],
      [`u${i}gain`, "float", p.gain],
      [`u${i}ck`, "float", p.contrastK],
      [`u${i}sa`, "float", p.sAmt],
      [`u${i}ha`, "float", p.hAmt],
      [`u${i}norm`, "float", p.shoulderNorm],
    ],
  },
  hue: {
    decls: (i) => [`uniform float u${i}cos;`, `uniform float u${i}sin;`],
    call: (i) => `{
      vec3 r0 = c.rgb;
      c.r = q8f(r0.r * (0.213 + u${i}cos * 0.787 - u${i}sin * 0.213) + r0.g * (0.715 - u${i}cos * 0.715 - u${i}sin * 0.715) + r0.b * (0.072 - u${i}cos * 0.072 + u${i}sin * 0.928));
      c.g = q8f(r0.r * (0.213 - u${i}cos * 0.213 + u${i}sin * 0.143) + r0.g * (0.715 + u${i}cos * 0.285 + u${i}sin * 0.14) + r0.b * (0.072 - u${i}cos * 0.072 - u${i}sin * 0.283));
      c.b = q8f(r0.r * (0.213 - u${i}cos * 0.213 - u${i}sin * 0.787) + r0.g * (0.715 - u${i}cos * 0.715 + u${i}sin * 0.715) + r0.b * (0.072 + u${i}cos * 0.928 + u${i}sin * 0.072));
    }`,
    vals: (i, p) => [[`u${i}cos`, "float", p.cos], [`u${i}sin`, "float", p.sin]],
  },
  sepia: {
    decls: (i) => [`uniform float u${i}a;`],
    call: (i) => `{
      vec3 r0 = c.rgb;
      float sr = clamp(r0.r * 0.393 + r0.g * 0.769 + r0.b * 0.189, 0.0, 255.0);
      float sg = clamp(r0.r * 0.349 + r0.g * 0.686 + r0.b * 0.168, 0.0, 255.0);
      float sb = clamp(r0.r * 0.272 + r0.g * 0.534 + r0.b * 0.131, 0.0, 255.0);
      c.rgb = q8v(r0 + (vec3(sr, sg, sb) - r0) * u${i}a);
    }`,
    vals: (i, pre) => [[`u${i}a`, "float", pre]],
  },
  invert: {
    decls: (i) => [`uniform float u${i}a;`],
    call: (i) => `c.rgb = q8v(c.rgb * (1.0 - u${i}a) + (255.0 - c.rgb) * u${i}a);`,
    vals: (i, pre) => [[`u${i}a`, "float", pre]],
  },
  opacity: {
    decls: (i) => [`uniform float u${i}a;`],
    call: (i) => `c.a = q8f(c.a * u${i}a);`,
    vals: (i, pre) => [[`u${i}a`, "float", pre]],
  },
  duotone: gradientStep("duotone"),
  tritone: gradientStep("tritone"),
  heatmap: gradientStep("heatmap"),
  posterize: {
    decls: (i) => [`uniform float u${i}steps;`],
    call: (i) => `c.rgb = vec3(posterizeB(c.r, u${i}steps), posterizeB(c.g, u${i}steps), posterizeB(c.b, u${i}steps));`,
    vals: (i, pre) => [[`u${i}steps`, "float", pre]],
  },
  solarize: {
    decls: (i) => [`uniform float u${i}thr;`, `uniform float u${i}mix;`],
    call: (i) => `{
      for (int ch = 0; ch < 3; ch++) {
        float v = c[ch];
        float s = v <= u${i}thr ? v : 255.0 - v;
        c[ch] = clamp(rnd(v + (s - v) * u${i}mix), 0.0, 255.0);
      }
    }`,
    vals: (i, p) => [[`u${i}thr`, "float", p.threshold], [`u${i}mix`, "float", p.mix]],
  },
  hueband: {
    decls: (i) => [`uniform float u${i}seg;`, `uniform float u${i}spread;`],
    call: (i) => `{
      vec3 hsl = rgbToHslG(c.rgb);
      if (hsl.y != 0.0) {
        float band = floor(hsl.x / u${i}seg);
        float h2 = mod((band + 0.5) * u${i}seg + band * u${i}spread * u${i}seg, 360.0);
        c.rgb = hslToRgbG(vec3(h2, hsl.y, hsl.z));
      }
    }`,
    vals: (i, p) => [[`u${i}seg`, "float", p.seg], [`u${i}spread`, "float", p.spread]],
  },
  shadowshighlights: {
    decls: (i) => [`uniform float u${i}sa;`, `uniform float u${i}ha;`],
    call: (i) => `{
      float l = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255.0;
      float t1 = 1.0 - l / 0.5, t2 = (l - 0.5) / 0.5;
      float ws = l < 0.5 ? t1 * t1 : 0.0;
      float wh = l > 0.5 ? t2 * t2 : 0.0;
      float delta = u${i}sa * ws + u${i}ha * wh;
      if (delta != 0.0) {
        c.rgb = vec3(
          clamp(rnd(c.r + delta), 0.0, 255.0),
          clamp(rnd(c.g + delta), 0.0, 255.0),
          clamp(rnd(c.b + delta), 0.0, 255.0));
      }
    }`,
    vals: (i, p) => [[`u${i}sa`, "float", p.sAmt], [`u${i}ha`, "float", p.hAmt]],
  },
};

// duotone/tritone/heatmap share the gradient-map machinery — same
// prepared colors array (n entries, padded to 6 for the GLSL decl).
function gradientStep() {
  return {
    decls: (i) => [`uniform vec3 u${i}C[6];`, `uniform int u${i}N;`],
    call: (i) => `c.rgb = gradientMapG(c.rgb, u${i}C, u${i}N);`,
    vals: (i, pre) => {
      const flat = new Float32Array(18);
      pre.forEach((rgb, k) => { flat[k * 3] = rgb[0]; flat[k * 3 + 1] = rgb[1]; flat[k * 3 + 2] = rgb[2]; });
      return [[`u${i}C`, "vec3[]", flat], [`u${i}N`, "int", pre.length]];
    },
  };
}

export function canRunGPU(type) {
  return Boolean(STEPS[type]);
}

// run: array of expanded effect entries { type, params } with params
// ALREADY renderScale-scaled. Returns { src, uniforms }.
export function buildFusedRun(run, preparePixelFor) {
  let decls = "";
  let body = "";
  const uniforms = [];
  run.forEach((e, i) => {
    const step = STEPS[e.type];
    const pre = preparePixelFor(e.type, e.params);
    for (const d of step.decls(i)) decls += d + "\n";
    body += "  " + step.call(i) + "\n";
    for (const [name, type, value] of step.vals(i, pre)) uniforms.push({ name, type, value });
  });
  const src = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSrc;
in vec2 vUv;
out vec4 fragColor;
${HELPERS}
${decls}
void main() {
  vec4 c = texture(uSrc, vUv) * 255.0;
${body}  fragColor = c / 255.0;
}`;
  return { src, uniforms };
}
