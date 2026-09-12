import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { findRuntimeAsset } from "@/lib/archive";
import { archiveRoot, derivativesRoot, resolveInside } from "@/lib/paths";
import { downloadHostedMedia, hostedArchiveEnabled } from "@/lib/drive";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await context.params;
  const asset = await findRuntimeAsset(assetId);
  // The landing page deliberately exposes only a low-resolution derivative of ordinary photos.
  if (!asset || asset.kind !== "photo" || asset.sensitive || !asset.webPreview) return new NextResponse("Not found", { status: 404 });

  if (hostedArchiveEnabled()) {
    try {
      const body = await downloadHostedMedia(assetId);
      const output = new ArrayBuffer(body.byteLength);
      new Uint8Array(output).set(body);
      return new NextResponse(output, { headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800", "X-Content-Type-Options": "nosniff" } });
    } catch {
      return new NextResponse("Preview unavailable", { status: 404 });
    }
  }

  const source = resolveInside(archiveRoot(), asset.relativePath);
  const directory = derivativesRoot();
  const derivative = resolveInside(directory, path.join("landing", `${asset.id}.webp`));
  await fs.mkdir(path.dirname(derivative), { recursive: true });
  try {
    const [sourceStat, derivativeStat] = await Promise.all([fs.stat(source), fs.stat(derivative).catch(() => null)]);
    if (!derivativeStat || derivativeStat.mtimeMs < sourceStat.mtimeMs) {
      const temporary = `${derivative}.${process.pid}.${Date.now()}.tmp`;
      await sharp(source, { failOn: "none", limitInputPixels: false })
        .rotate()
        .resize(1440, 980, { fit: "cover", position: "attention", withoutEnlargement: true })
        .webp({ quality: 60, effort: 4 })
        .toFile(temporary);
      await fs.rename(temporary, derivative);
    }
    const body = await fs.readFile(derivative);
    return new NextResponse(new Uint8Array(body), { headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new NextResponse("Preview unavailable", { status: 404 });
  }
}
