import fs from "node:fs";
import path from "node:path";

async function main(): Promise<void> {
const mediaName = process.argv[2];
if (!mediaName || !/^[a-f0-9]{24}\.webp$/u.test(mediaName)) throw new Error("Передайте имя webp-файла из screen export.");

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/u).flatMap((line) => {
  const index = line.indexOf("=");
  return index < 0 ? [] : [[line.slice(0, index), line.slice(index + 1)]];
}));
const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ client_id: env.GOOGLE_DRIVE_OAUTH_CLIENT_ID, client_secret: env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET, refresh_token: env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN, grant_type: "refresh_token" }),
});
const token = (await tokenResponse.json() as { access_token?: string }).access_token;
if (!token) throw new Error("OAuth-токен недоступен.");
const headers = { Authorization: `Bearer ${token}` };
async function find(parent: string, name: string): Promise<{ id: string } | undefined> {
  const q = `'${parent}' in parents and name = '${name}' and trashed = false`;
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q, fields: "files(id)", pageSize: "1" })}`, { headers });
  return (await response.json() as { files?: { id: string }[] }).files?.[0];
}
const media = await find(env.GOOGLE_DRIVE_FOLDER_ID, "media");
if (!media) throw new Error("Папка media не найдена в Google Drive.");
const existing = await find(media.id, mediaName);
const response = await fetch(existing ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media` : "https://www.googleapis.com/upload/drive/v3/files?uploadType=media", {
  method: existing ? "PATCH" : "POST", headers: { ...headers, "Content-Type": "image/webp" }, body: fs.readFileSync(path.join("Z:/SCAN/WEB_SCREEN_ARCHIVE/media", mediaName)),
});
if (!response.ok) throw new Error(`Не удалось загрузить ${mediaName}: ${response.status}`);
console.log(`Uploaded ${mediaName}.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
