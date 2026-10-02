import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };
type OAuthClient = { clientId: string; clientSecret: string; refreshToken: string };
type DriveFile = { id: string; name: string; mimeType?: string; md5Checksum?: string };

const projectRoot = process.cwd();
const exportRoot = path.resolve(process.env.ARCHIVE_SCREEN_EXPORT_ROOT || "Z:/SCAN/WEB_SCREEN_ARCHIVE");
const folderMime = "application/vnd.google-apps.folder";
const childrenCache = new Map<string, DriveFile[]>();
let tokenSource: (() => Promise<string>) | null = null;
let tokenValue = "";
let tokenExpiresAt = 0;

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

async function oauthAccessToken(client: OAuthClient): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: client.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !body.access_token) throw new Error(`Google Drive отклонил OAuth-доступ на запись${body.error_description ? `: ${body.error_description}` : "."}`);
  return body.access_token;
}

function configureTokenSource(source: () => Promise<string>): void {
  tokenSource = source;
  tokenValue = "";
  tokenExpiresAt = 0;
}

async function driveToken(force = false): Promise<string> {
  if (!tokenSource) throw new Error("Не настроен доступ к Google Drive.");
  if (force || !tokenValue || tokenExpiresAt < Date.now() + 60_000) {
    tokenValue = await tokenSource();
    tokenExpiresAt = Date.now() + 55 * 60_000;
  }
  return tokenValue;
}

function escapeQuery(value: string): string { return value.replaceAll("'", "\\'"); }

async function driveFetch(target: string, init?: RequestInit, retry = true): Promise<Response> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/${target}`, { ...init, headers: { Authorization: `Bearer ${await driveToken(!retry)}`, ...init?.headers } });
  if (response.status === 401 && retry) return driveFetch(target, init, false);
  if (!response.ok) throw new Error(`Google Drive вернул ошибку ${response.status}.`);
  return response;
}

async function children(parentId: string): Promise<DriveFile[]> {
  const cached = childrenCache.get(parentId);
  if (cached) return cached;
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const q = `'${escapeQuery(parentId)}' in parents and trashed = false`;
    const response = await driveFetch(`files?${new URLSearchParams({ q, fields: "nextPageToken,files(id,name,mimeType,md5Checksum)", pageSize: "1000", ...(pageToken ? { pageToken } : {}) })}`);
    const body = await response.json() as { files?: DriveFile[]; nextPageToken?: string };
    files.push(...(body.files || []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  childrenCache.set(parentId, files);
  return files;
}

async function findChild(parentId: string, name: string, folder: boolean): Promise<DriveFile | null> {
  return (await children(parentId)).find((file) => file.name === name && (!folder || file.mimeType === folderMime)) || null;
}

async function ensureFolder(parentId: string, name: string): Promise<string> {
  const found = await findChild(parentId, name, true);
  if (found) return found.id;
  const response = await driveFetch("files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: folderMime, parents: [parentId] }) });
  return ((await response.json()) as DriveFile).id;
}

function mimeFor(file: string): string {
  if (file.endsWith(".webp")) return "image/webp";
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

async function uploadFile(parentId: string, absolutePath: string, name: string): Promise<boolean> {
  const existing = await findChild(parentId, name, false);
  if (existing && process.env.ARCHIVE_SCREEN_SYNC_NEW_ONLY === "1") return false;
  const bytes = await fs.readFile(absolutePath);
  const checksum = crypto.createHash("md5").update(bytes).digest("hex");
  if (existing?.md5Checksum === checksum) return false;
  const endpoint = existing ? `upload/drive/v3/files/${encodeURIComponent(existing.id)}?uploadType=media` : "upload/drive/v3/files?uploadType=multipart";
  const upload = async (method: "PATCH" | "POST", body: Buffer, contentType: string, retry = true): Promise<void> => {
    const response = await fetch(`https://www.googleapis.com/${endpoint}`, { method, headers: { Authorization: `Bearer ${await driveToken(!retry)}`, "Content-Type": contentType }, body: body as unknown as BodyInit });
    if (response.status === 401 && retry) return upload(method, body, contentType, false);
    if (!response.ok) throw new Error(`Не удалось ${existing ? "обновить" : "загрузить"} ${name} (${response.status}): ${await response.text()}`);
  };
  if (existing) {
    await upload("PATCH", bytes, mimeFor(name));
    return true;
  }
  const boundary = `archive-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name, parents: [parentId] });
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeFor(name)}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  await upload("POST", body, `multipart/related; boundary=${boundary}`);
  return true;
}

async function syncFolder(driveParent: string, localFolder: string): Promise<{ uploaded: number; unchanged: number }> {
  const counts = { uploaded: 0, unchanged: 0 };
  for (const entry of await fs.readdir(localFolder, { withFileTypes: true })) {
    if (entry.name === ".export-state.json") continue;
    const localPath = path.join(localFolder, entry.name);
    if (entry.isDirectory()) {
      const child = await syncFolder(await ensureFolder(driveParent, entry.name), localPath);
      counts.uploaded += child.uploaded;
      counts.unchanged += child.unchanged;
    } else if (entry.isFile()) {
      if (await uploadFile(driveParent, localPath, entry.name)) counts.uploaded += 1;
      else counts.unchanged += 1;
    }
  }
  return counts;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const rootId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const rawAccount = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  const oauthClientId = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID;
  const oauthClientSecret = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET;
  const oauthRefreshToken = process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN;
  if (!rootId) throw new Error("Нужен GOOGLE_DRIVE_FOLDER_ID в .env.local.");
  if (!fsSync.existsSync(path.join(exportRoot, "archive-index.json"))) throw new Error("Сначала создайте экранный экспорт.");
  configureTokenSource(oauthClientId && oauthClientSecret && oauthRefreshToken
    ? () => oauthAccessToken({ clientId: oauthClientId, clientSecret: oauthClientSecret, refreshToken: oauthRefreshToken })
    : (() => {
        if (!rawAccount) throw new Error("Нужны OAuth-параметры или GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON в .env.local.");
        const account = JSON.parse(rawAccount) as ServiceAccount;
        if (!account.client_email || !account.private_key) throw new Error("Некорректный GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON.");
        return () => accessToken(account);
      })());
  const manifestOnly = process.env.ARCHIVE_SCREEN_SYNC_MANIFEST_ONLY === "1";
  const counts = manifestOnly
    ? { uploaded: Number(await uploadFile(rootId, path.join(exportRoot, "archive-index.json"), "archive-index.json")), unchanged: 0 }
    : await syncFolder(rootId, exportRoot);
  process.stdout.write(`Drive sync complete: ${counts.uploaded} files uploaded or updated, ${counts.unchanged} unchanged.\n`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
