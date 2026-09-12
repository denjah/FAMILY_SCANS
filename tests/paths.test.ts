import assert from "node:assert/strict";
import test from "node:test";
import { resolveInside } from "../src/lib/paths.ts";

test("archive path resolver accepts children and rejects traversal", () => {
  const root = "Z:/SCAN";
  assert.match(resolveInside(root, "ALENA/фото 01.jpg"), /ALENA/);
  assert.throws(() => resolveInside(root, "../outside.txt"), /escapes/);
});
