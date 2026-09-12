import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };
type DriveFile = { id: string; name: string; mimeType?: string };

const projectRoot = process.cwd();
const exportRoot = path.resolve(process.env.ARCHIVE_SCREEN_EXPORT_ROOT || "Z:/SCAN/WEB_SCREEN_ARCHIVE");
const folderMime = "application/vnd.google-apps.folder";

function loadLocalEnv(): void {
  const file = path.join(projectRoot, ".env.local");
  if (!fsSync.existsSync(file)) return;
  for (const line of fsSync.readFileSync(file, "utf8").split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/gu, "");
  }
}

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

async function accessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = encode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = encode(JSON.stringify({ iss: account.client_email, scope: "https://www.googleapis.com/auth/drive", aud: account.token_uri || "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signature = crypto.createSign("RSA-SHA256").update(`${header}.${payload}`).end().sign(account.private_key, "base64url");
  const response = await fetch(account.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${payload}.${signature}` }),
  });
  const body = await response.json() as { access_token?: string };
  if (!response.ok || !body.access_token) throw new Error("Google Drive отклонил служебный доступ на запись.");
  return body.access_token;
}

function escapeQuery(value: string): string { return value.replaceAll("'", "\\'"); }

async function driveFetch(token: string, target: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/${target}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...init?.headers } });
  if (!response.ok) throw new Error(`Google Drive вернул ошибку ${response.status}.`);
  return response;
}

async function findChild(token: string, parentId: string, name: string, folder: boolean): Promise<DriveFile | null> {
  const q = `'${escapeQuery(parentId)}' in parents and name = '${escapeQuery(name)}' and trashed = false${folder ? ` and mimeType = '${folderMime}'` : ""}`;
  const response = await driveFetch(token, `files?${new URLSearchParams({ q, fields: "files(id,name,mimeType)", pageSize: "1" })}`);
  return ((await response.json()) as { files?: DriveFile[] }).files?.[0] || null;
}

async function ensureFolder(token: string, parentId: string, name: string): Promise<string> {
  const found = await findChild(token, parentId, name, true);
  if (found) return found.id;
  const response = await driveFetch(token, "files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: folderMime, parents: [parentId] }) });
  return ((await response.json()) as DriveFile).id;
}

function mimeFor(file: string): string {
  if (file.endsWith(".webp")) return "image/webp";
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

async function uploadFile(token: string, parentId: string, absolutePath: string, name: string): Promise<void> {
  const existing = await findChild(token, parentId, name, false);
  const bytes = await fs.readFile(absolutePath);
  const endpoint = existing ? `upload/drive/v3/files/${encodeURIComponent(existing.id)}?uploadType=media` : "upload/drive/v3/files?uploadType=multipart";
  if (existing) {
    const response = await fetch(`https://www.googleapis.com/${endpoint}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeFor(name) }, body: bytes });
    if (!response.ok) throw new Error(`Не удалось обновить ${name} (${response.status}).`);
    return;
  }
  const boundary = `archive-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name, parents: [parentId] });
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeFor(name)}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const response = await fetch(`https://www.googleapis.com/${endpoint}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body });
  if (!response.ok) throw new Error(`Не удалось загрузить ${name} (${response.status}).`);
}

async function syncFolder(token: string, driveParent: string, localFolder: string): Promise<number> {
  let uploaded = 0;
  for (const entry of await fs.readdir(localFolder, { withFileTypes: true })) {
    const localPath = path.join(localFolder, entry.name);
    if (entry.isDirectory()) uploaded += await syncFolder(token, await ensureFolder(token, driveParent, entry.name), localPath);
    else if (entry.isFile()) { await uploadFile(token, driveParent, localPath, entry.name); uploaded += 1; }
  }
  return uploaded;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const rootId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const rawAccount = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (!rootId || !rawAccount) throw new Error("Нужны GOOGLE_DRIVE_FOLDER_ID и GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON в .env.local.");
  const account = JSON.parse(rawAccount) as ServiceAccount;
  if (!account.client_email || !account.private_key) throw new Error("Некорректный GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON.");
  if (!fsSync.existsSync(path.join(exportRoot, "archive-index.json"))) throw new Error("Сначала создайте экранный экспорт.");
  const token = await accessToken(account);
  const manifestOnly = process.env.ARCHIVE_SCREEN_SYNC_MANIFEST_ONLY === "1";
  const uploaded = manifestOnly
    ? (await uploadFile(token, rootId, path.join(exportRoot, "archive-index.json"), "archive-index.json"), 1)
    : await syncFolder(token, rootId, exportRoot);
  process.stdout.write(`Drive sync complete: ${uploaded} files uploaded or updated.\n`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
