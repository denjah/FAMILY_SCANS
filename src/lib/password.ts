import crypto from "node:crypto";

export function hashPassword(password: string, salt = crypto.randomBytes(16)): string {
  const iterations = 210_000;
  const digest = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256");
  return `pbkdf2:${iterations}:${salt.toString("base64url")}:${digest.toString("base64url")}`;
}

export function verifyPassword(password: string, encoded: string | undefined): boolean {
  if (!encoded) return false;
  const [kind, iterationsText, saltText, digestText] = encoded.split(":");
  if (kind !== "pbkdf2" || !iterationsText || !saltText || !digestText) return false;
  const iterations = Number(iterationsText);
  if (!Number.isSafeInteger(iterations) || iterations < 100_000) return false;
  const expected = Buffer.from(digestText, "base64url");
  const actual = crypto.pbkdf2Sync(password, Buffer.from(saltText, "base64url"), iterations, expected.length, "sha256");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
