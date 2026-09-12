import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { getRequestSession, isSameOrigin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
let running = false;

async function runScript(name: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const cli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  await execFileAsync(process.execPath, [cli, path.join(process.cwd(), "scripts", name)], { env, timeout: 30 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Запрос отклонен." }, { status: 403 });
  const session = getRequestSession(request);
  if (!session || session.role !== "admin" || process.env.ARCHIVE_SYNC_ENABLED !== "1") return NextResponse.json({ error: "Синхронизация доступна только владельцу на локальном компьютере." }, { status: 403 });
  if (running) return NextResponse.json({ error: "Синхронизация уже выполняется." }, { status: 409 });
  running = true;
  try {
    await runScript("index-archive.ts");
    await runScript("export-screen-archive.ts", { ...process.env, ARCHIVE_SCREEN_EXPORT_REPLACE: "1" });
    await runScript("sync-screen-archive.ts");
    return NextResponse.json({ message: "Готово: папки пересканированы, экранные версии загружены. Веб-архив обновится в течение 5 минут." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Archive sync failed", error);
    return NextResponse.json({ error: "Синхронизация не завершилась. Проверьте настройки Google Drive и журнал локального сервера." }, { status: 500 });
  } finally {
    running = false;
  }
}
