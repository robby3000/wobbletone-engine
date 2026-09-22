import test from "node:test";
import assert from "node:assert/strict";
import { planInvalidate } from "../incremental.js";

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
