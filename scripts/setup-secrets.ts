import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const iterations = 210_000;
  const digest = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256");
  return `pbkdf2:${iterations}:${salt.toString("base64url")}:${digest.toString("base64url")}`;
}

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  console.error(".env.local already exists. Remove or rotate it manually; nothing was overwritten.");
  process.exit(1);
}

const familyPassword = `MAMA-${crypto.randomInt(1000, 10_000)}`;
const adminPassword = crypto.randomBytes(12).toString("base64url");
const invite = crypto.randomBytes(24).toString("base64url");
const sessionSecret = crypto.randomBytes(48).toString("base64url");

const contents = [
  "ARCHIVE_ROOT=Z:/SCAN",
  "ARCHIVE_DATA_ROOT=Z:/SCAN/SYSTEM_WEB/data",
  "ARCHIVE_DERIVATIVES_ROOT=Z:/SCAN/SYSTEM_WEB/generated/previews",
  `ARCHIVE_FAMILY_PASSWORD_HASH=${hashPassword(familyPassword)}`,
  `ARCHIVE_ADMIN_PASSWORD_HASH=${hashPassword(adminPassword)}`,
  `ARCHIVE_SESSION_SECRET=${sessionSecret}`,
  `ARCHIVE_INVITE_TOKEN=${invite}`,
  "ARCHIVE_SESSION_VERSION=1",
  "ARCHIVE_PUBLIC_ORIGIN=http://127.0.0.1:3000",
  "",
].join("\n");

fs.writeFileSync(envPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
console.log("Private local secrets created. Save these values outside Git:");
console.log(`Family password: ${familyPassword}`);
console.log(`Admin password: ${adminPassword}`);
console.log(`Local invitation: http://127.0.0.1:3000/i/${invite}`);
