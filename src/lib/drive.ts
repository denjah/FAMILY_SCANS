import crypto from "node:crypto";

type DriveFile = { id: string; name: string; mimeType?: string };
type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const FOLDER_MIME = "application/vnd.google-apps.folder";
let tokenCache: { value: string; expiresAt: number } | null = null;
const childCache = new Map<string, DriveFile>();

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function serviceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is not configured");
  const account = JSON.parse(raw) as ServiceAccount;
  if (!account.client_email || !account.private_key) throw new Error("Google Drive service account is invalid");
  return account;
}

export function hostedArchiveEnabled(): boolean {
  return Boolean(process.env.GOOGLE_DRIVE_FOLDER_ID && process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON);
}

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const account = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = encode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = encode(JSON.stringify({ iss: account.client_email, scope: DRIVE_SCOPE, aud: account.token_uri || "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const assertion = `${header}.${payload}.${crypto.createSign("RSA-SHA256").update(`${header}.${payload}`).end().sign(account.private_key, "base64url")}`;
  const response = await fetch(account.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Google token request failed (${response.status})`);
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("Google token response is incomplete");
  tokenCache = { value: body.access_token, expiresAt: Date.now() + (body.expires_in || 3600) * 1000 };
  return body.access_token;
}

async function driveFetch(path: string): Promise<Response> {
  const token = await accessToken();
  const response = await fetch(`https://www.googleapis.com/drive/v3/${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`Google Drive request failed (${response.status})`);
  return response;
}

function escaped(value: string): string {
  return value.replaceAll("'", "\\'");
}

async function child(parentId: string, name: string, folder = false): Promise<DriveFile> {
  const key = `${parentId}:${folder ? "folder" : "file"}:${name}`;
  const cached = childCache.get(key);
  if (cached) return cached;
  const q = `'${escaped(parentId)}' in parents and name = '${escaped(name)}' and trashed = false${folder ? ` and mimeType = '${FOLDER_MIME}'` : ""}`;
  const params = new URLSearchParams({ q, fields: "files(id,name,mimeType)", pageSize: "10" });
  const response = await driveFetch(`files?${params}`);
  const body = await response.json() as { files?: DriveFile[] };
  const file = body.files?.[0];
  if (!file) throw new Error(`Drive file not found: ${name}`);
  childCache.set(key, file);
  return file;
}

export async function downloadDriveFile(fileId: string): Promise<Uint8Array> {
  const response = await driveFetch(`files/${encodeURIComponent(fileId)}?alt=media`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function downloadHostedManifest(): Promise<Uint8Array> {
  const root = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!root) throw new Error("GOOGLE_DRIVE_FOLDER_ID is not configured");
  return downloadDriveFile((await child(root, "archive-index.json")).id);
}

export async function downloadHostedMedia(assetId: string, page?: number): Promise<Uint8Array> {
  const root = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!root) throw new Error("GOOGLE_DRIVE_FOLDER_ID is not configured");
  const media = await child(root, "media", true);
  const file = page === undefined
    ? await child(media.id, `${assetId}.webp`)
    : await child((await child(media.id, assetId, true)).id, `page-${String(page + 1).padStart(3, "0")}.webp`);
  return downloadDriveFile(file.id);
}
