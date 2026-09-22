// incremental.js — pure helpers for incremental (cached) rendering.
//
// Hosts may retain the intermediate buffer produced after each spec effect
// and re-render only the tail after a parameter change. planInvalidate
// compares the previous and next per-effect cache keys and returns the
// first dirty position.
//
// Key derivation is the host's choice (e.g. JSON.stringify([type, params])).
//
// Returns the first index that must be re-rendered. A return value
// >= nextKeys.length means nothing needs rendering — the final buffer is
// already cached. This covers two cases: identical stacks (no diff found)
// and the next stack being a strict prefix of the previous one (trailing
// effects removed — the buffer at nextKeys.length - 1 is still valid).
export function planInvalidate(previousKeys, nextKeys) {
  const length = Math.max(previousKeys.length, nextKeys.length);
  for (let i = 0; i < length; i++) {
    if (previousKeys[i] !== nextKeys[i]) return i;
  }
  return nextKeys.length;
}
