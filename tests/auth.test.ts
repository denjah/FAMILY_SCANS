import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../src/lib/password.ts";

test("password hashes verify without storing plaintext", () => {
  const hash = hashPassword("family-secret");
  assert.equal(hash.includes("family-secret"), false);
  assert.equal(verifyPassword("family-secret", hash), true);
  assert.equal(verifyPassword("wrong", hash), false);
});
