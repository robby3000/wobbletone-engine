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

/* Adaptive preview resolution. */

// Step ladder the host's preview maxDim walks. Slow renders (>300ms) step
// down; fast renders (<80ms for 3 consecutive renders) step back up. One
// step per adjustment, ≥500ms between changes — pure, so the host owns
// the state fields (lastChangeAt, fastStreak) and passes them back in.
export const PREVIEW_STEPS = [640, 900, 1200, 1600];

export function choosePreviewDim({ currentDim, lastMs, now = 0, lastChangeAt = -Infinity, fastStreak = 0 }) {
  const idx = PREVIEW_STEPS.reduce((best, s, j) => (s <= currentDim ? j : best), 0);
  const cooled = now - lastChangeAt >= 500;
  if (lastMs > 300) {
    if (cooled && idx > 0) return { dim: PREVIEW_STEPS[idx - 1], lastChangeAt: now, fastStreak: 0 };
    return { dim: currentDim, lastChangeAt, fastStreak: 0 };
  }
  if (lastMs < 80) {
    const streak = fastStreak + 1;
    if (streak >= 3 && cooled && idx < PREVIEW_STEPS.length - 1) {
      return { dim: PREVIEW_STEPS[idx + 1], lastChangeAt: now, fastStreak: 0 };
    }
    return { dim: currentDim, lastChangeAt, fastStreak: streak };
  }
  return { dim: currentDim, lastChangeAt, fastStreak: 0 };
}
