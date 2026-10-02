import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { commentStorageAvailable, hostedCommentDatabase, listCommentsForSync, mergeCommentsForSync } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CommentSchema = z.object({
  id: z.string().min(1).max(200),
  assetId: z.string().min(1).max(1000),
  authorId: z.string().min(1).max(200),
  authorDisplayName: z.string().min(1).max(80),
  kind: z.enum(["comment", "memory", "correction", "identification", "date_suggestion"]),
  body: z.string().min(1).max(5000),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: z.number().int().positive(),
  deletedAt: z.string().datetime().nullable(),
});
const PayloadSchema = z.object({ comments: z.array(CommentSchema).max(5000) });

function authorized(request: NextRequest): boolean {
  const secret = process.env.ARCHIVE_COMMENT_SYNC_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!secret || secret.length < 32 || !supplied) return false;
  const expectedBytes = Buffer.from(secret);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && crypto.timingSafeEqual(expectedBytes, suppliedBytes);
}

/** Private machine-to-machine endpoint used only by the locally authenticated owner sync action. */
export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Синхронизация не настроена или ключ неверен." }, { status: 401 });
  if (!hostedCommentDatabase()) return NextResponse.json({ error: "Этот адрес не подключён к общей облачной базе." }, { status: 409 });
  if (!commentStorageAvailable()) return NextResponse.json({ error: "Облачное хранилище комментариев недоступно." }, { status: 503 });

  const parsed = PayloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректный набор комментариев для синхронизации." }, { status: 400 });

  try {
    await mergeCommentsForSync(parsed.data.comments);
    const comments = await listCommentsForSync();
    return NextResponse.json({ comments, count: comments.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Hosted comment sync failed", error);
    return NextResponse.json({ error: "Не удалось объединить комментарии с облачной базой." }, { status: 500 });
  }
}
