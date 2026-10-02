import { NextRequest, NextResponse } from "next/server";
import { getRequestSession, isSameOrigin } from "@/lib/auth";
import { commentStorageAvailable, hostedCommentDatabase, listCommentsForSync, mergeCommentsForSync, type CommentSyncRecord } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let running = false;

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  const session = getRequestSession(request);
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Только владелец может синхронизировать комментарии." }, { status: 403 });
  if (hostedCommentDatabase()) return NextResponse.json({ error: "Нажмите синхронизацию в локальной версии архива." }, { status: 409 });
  if (!commentStorageAvailable()) return NextResponse.json({ error: "Локальная база комментариев недоступна." }, { status: 503 });
  if (running) return NextResponse.json({ error: "Синхронизация уже выполняется." }, { status: 409 });

  const endpoint = process.env.ARCHIVE_COMMENT_SYNC_URL;
  const secret = process.env.ARCHIVE_COMMENT_SYNC_SECRET;
  if (!endpoint || !secret || secret.length < 32) {
    return NextResponse.json({ error: "Настройте адрес общей версии и секрет синхронизации на локальном компьютере и в Vercel." }, { status: 503 });
  }
  let target: URL;
  try {
    target = new URL(endpoint);
  } catch {
    return NextResponse.json({ error: "Некорректный адрес общей версии." }, { status: 503 });
  }
  if (target.protocol !== "https:" && target.hostname !== "localhost") {
    return NextResponse.json({ error: "Адрес общей версии должен использовать HTTPS." }, { status: 503 });
  }

  running = true;
  try {
    const localComments = await listCommentsForSync();
    const response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ comments: localComments }),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    const result = await response.json().catch(() => null) as { error?: string; comments?: CommentSyncRecord[]; count?: number } | null;
    if (!response.ok || !result?.comments) {
      return NextResponse.json({ error: result?.error || "Общая версия не приняла синхронизацию." }, { status: response.status || 502 });
    }
    await mergeCommentsForSync(result.comments);
    return NextResponse.json({ message: "Готово: локальные и облачные комментарии объединены.", count: result.count ?? result.comments.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Local comment sync failed", error);
    return NextResponse.json({ error: "Не удалось связаться с общей версией. Проверьте интернет и журнал локального сервера." }, { status: 502 });
  } finally {
    running = false;
  }
}
