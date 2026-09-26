import test from "node:test";
import assert from "node:assert/strict";
import { planInvalidate, choosePreviewDim, PREVIEW_STEPS } from "../incremental.js";

test("planInvalidate on a cold cache renders everything", () => {
  assert.equal(planInvalidate([], []), 0);         // empty stack: nothing to render (0 >= 0)
  assert.equal(planInvalidate([], ["a", "b"]), 0); // cold cache → render all
});

test("planInvalidate on identical stacks renders nothing", () => {
  assert.equal(planInvalidate(["a", "b"], ["a", "b"]), 2); // >= nextKeys.length → reuse tail
});

test("planInvalidate returns the first changed index", () => {
  assert.equal(planInvalidate(["a", "b", "c"], ["a", "X", "c"]), 1);
  assert.equal(planInvalidate(["x", "b"], ["a", "b"]), 0);   // head changed → render all
  assert.equal(planInvalidate(["a", "b"], ["a", "b"]), 2);
});

test("planInvalidate handles appended and trimmed tails", () => {
  assert.equal(planInvalidate(["a", "b"], ["a", "b", "c"]), 2); // render the new tail
  assert.equal(planInvalidate(["a", "b", "c"], ["a"]), 1);      // 1 >= 1 → buffers[0] still valid
});

test("planInvalidate treats a param change as a key change", () => {
  const key = (v) => JSON.stringify(["blur", { v }]);
  assert.equal(planInvalidate([key(1), key(2)], [key(1), key(5)]), 1);
});

/* ---------- choosePreviewDim ---------- */

const policy = (over) => choosePreviewDim({
  currentDim: 1600, lastMs: 100, now: 1000, lastChangeAt: -Infinity, fastStreak: 0, ...over,
});

test("choosePreviewDim steps down once per slow render, floors at 640", () => {
  assert.equal(policy({ lastMs: 400 }).dim, 1200);
  assert.equal(policy({ currentDim: 640, lastMs: 5000 }).dim, 640); // floor
});

test("choosePreviewDim never exceeds the 1600 cap or skips a step", () => {
  assert.equal(policy({ lastMs: 10, fastStreak: 5 }).dim, 1600);          // already at cap
  assert.equal(policy({ currentDim: 640, lastMs: 10, fastStreak: 2 }).dim, 900); // single step up
});

test("choosePreviewDim steps up only after 3 consecutive fast renders", () => {
  assert.equal(policy({ lastMs: 40, fastStreak: 1 }).dim, 1600); // 2nd fast render: no change yet
  const two = { currentDim: 900, lastMs: 40, fastStreak: 2 };
  assert.equal(policy(two).dim, 1200); // 3rd fast render steps up
});

test("choosePreviewDim honours the 500ms cooldown", () => {
  // last change 200ms ago → slow render cannot step down yet.
  assert.equal(policy({ lastMs: 900, now: 1000, lastChangeAt: 800 }).dim, 1600);
  // ...but the fastStreak still accumulates under cooldown.
  assert.equal(policy({ lastMs: 30, now: 1000, lastChangeAt: 800, fastStreak: 2 }).dim, 1600);
});

test("choosePreviewDim resets the streak on a mid-range render", () => {
  const s = policy({ currentDim: 900, lastMs: 150, fastStreak: 2 });
  assert.equal(s.fastStreak, 0);
  assert.equal(s.dim, 900);
});

test("PREVIEW_STEPS ladder is ascending and capped at 1600", () => {
  assert.deepEqual(PREVIEW_STEPS, [640, 900, 1200, 1600]);
});
