import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { findRuntimeAsset } from "@/lib/archive";
import { getRequestSession, isSameOrigin } from "@/lib/auth";
import { commentStorageAvailable, saveAssetMetadata } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MetadataSchema = z.object({
  names: z.string().trim().max(500),
  year: z.string().trim().max(40),
  caption: z.string().trim().max(2000),
});

export async function PUT(request: NextRequest, context: { params: Promise<{ assetId: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Запрос отклонен." }, { status: 403 });
  const { assetId } = await context.params;
  const session = getRequestSession(request);
  const asset = await findRuntimeAsset(assetId);
  if (!session || !asset || (asset.sensitive && session.role !== "admin")) return NextResponse.json({ error: "Не найдено." }, { status: 404 });
  if (!commentStorageAvailable()) return NextResponse.json({ error: "Хранилище ещё подключается." }, { status: 503 });
  const parsed = MetadataSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Проверьте введённые данные." }, { status: 400 });
  const metadata = await saveAssetMetadata(assetId, parsed.data);
  return NextResponse.json({ metadata }, { headers: { "Cache-Control": "private, no-store" } });
}
