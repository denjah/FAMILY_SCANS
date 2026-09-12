import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { findRuntimeAsset } from "@/lib/archive";
import { getRequestSession, isSameOrigin } from "@/lib/auth";
import { commentStorageAvailable, createComment, listComments } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CommentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  kind: z.enum(["comment", "memory", "correction", "identification", "date_suggestion"]),
});

async function authorize(request: NextRequest, assetId: string) {
  const session = getRequestSession(request);
  const asset = await findRuntimeAsset(assetId);
  if (!session || !asset || (asset.sensitive && session.role !== "admin")) return null;
  return { session, asset };
}

export async function GET(request: NextRequest, context: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await context.params;
  const access = await authorize(request, assetId);
  if (!access) return NextResponse.json({ error: "Не найдено." }, { status: 404 });
  if (!commentStorageAvailable()) return NextResponse.json({ comments: [], storageAvailable: false }, { headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json({ comments: await listComments(assetId, access.session) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest, context: { params: Promise<{ assetId: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Запрос отклонен." }, { status: 403 });
  const { assetId } = await context.params;
  const access = await authorize(request, assetId);
  if (!access) return NextResponse.json({ error: "Не найдено." }, { status: 404 });
  if (!commentStorageAvailable()) return NextResponse.json({ error: "Хранилище воспоминаний ещё подключается." }, { status: 503 });
  const parsed = CommentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Напишите текст воспоминания." }, { status: 400 });
  const comment = await createComment(crypto.randomUUID(), assetId, parsed.data.kind, parsed.data.body, access.session);
  return NextResponse.json({ comment }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
