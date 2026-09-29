import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const root = process.cwd();
const envPath = path.join(root, ".env.local");

function loadEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (match) result[match[1]] = match[2].replace(/^['"]|['"]$/gu, "");
  }
  return result;
}

function saveRefreshToken(token: string): void {
  const previous = fs.readFileSync(envPath, "utf8");
  const next = /^GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN=.*$/mu.test(previous)
    ? previous.replace(/^GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN=.*$/mu, `GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN=${token}`)
    : `${previous.trimEnd()}\nGOOGLE_DRIVE_OAUTH_REFRESH_TOKEN=${token}\n`;
  fs.writeFileSync(envPath, next, "utf8");
}

async function main(): Promise<void> {
  const env = loadEnv();
  const clientId = env.GOOGLE_DRIVE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Добавьте GOOGLE_DRIVE_OAUTH_CLIENT_ID и GOOGLE_DRIVE_OAUTH_CLIENT_SECRET в .env.local.");

  const port = 53682;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const state = crypto.randomBytes(24).toString("base64url");
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", redirectUri);
    if (url.searchParams.get("state") !== state || !url.searchParams.get("code")) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Авторизация не подтверждена. Можно закрыть это окно.");
      return;
    }
    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: url.searchParams.get("code")!, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
      });
      const token = await tokenResponse.json() as { refresh_token?: string; error_description?: string };
      if (!tokenResponse.ok || !token.refresh_token) throw new Error(token.error_description || "Google не вернул refresh token.");
      saveRefreshToken(token.refresh_token);
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<h1>Готово</h1><p>Доступ к Google Drive сохранён локально. Это окно можно закрыть.</p>");
      console.log("OAuth access saved to .env.local.");
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Не удалось сохранить доступ. Вернитесь в терминал.");
      console.error(error);
    } finally {
      server.close();
    }
  });
  server.listen(port, "127.0.0.1", () => {
    const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizeUrl.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "https://www.googleapis.com/auth/drive", access_type: "offline", prompt: "consent", state }).toString();
    console.log(authorizeUrl.toString());
  });
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
