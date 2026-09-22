// Seeded randomness — mulberry32, the same algorithm both apps already use.
// Verbatim port of seededRandom from wobbletonefx app.js so glitch seeds keep
// their meaning. Never use Math.random() in engine code.

export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}
