import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { findRuntimeAsset } from "@/lib/archive";
import { getRequestSession } from "@/lib/auth";
import { archiveRoot, derivativesRoot, resolveInside } from "@/lib/paths";
import { downloadHostedMedia, hostedArchiveEnabled } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const variants = {
  thumb: { edge: 560, quality: 72 },
  screen: { edge: 2048, quality: 82 },
  full: { edge: 3200, quality: 88 },
} as const;
const execFileAsync = promisify(execFile);

function pageFor(request: NextRequest, asset: { technicalMetadata: { mimeType: string; pages: number | null } }): number {
  if (asset.technicalMetadata.mimeType !== "application/pdf") return 0;
  return Math.min(
    Math.max(0, Number.parseInt(request.nextUrl.searchParams.get("page") || "0", 10) || 0),
    Math.max(0, (asset.technicalMetadata.pages || 1) - 1),
  );
}

function poppler(name: "pdftoppm"): string {
  const directory = process.env.ARCHIVE_POPPLER_BIN;
  return directory ? path.join(directory, `${name}${process.platform === "win32" ? ".exe" : ""}`) : name;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ assetId: string; variant: string }> },
) {
  const session = getRequestSession(request);
  const { assetId, variant: variantName } = await context.params;
  const variant = variants[variantName as keyof typeof variants];
  const asset = await findRuntimeAsset(assetId);
  if (!session || !variant || !asset || !asset.webPreview || (asset.sensitive && session.role !== "admin")) {
    return new NextResponse("Not found", { status: 404 });
  }

  if (hostedArchiveEnabled()) {
    try {
      const body = await downloadHostedMedia(assetId, asset.technicalMetadata.mimeType === "application/pdf" ? pageFor(request, asset) : undefined);
      const output = new ArrayBuffer(body.byteLength);
      new Uint8Array(output).set(body);
      return new NextResponse(output, { headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
    } catch {
      return new NextResponse("Preview unavailable", { status: 404 });
    }
  }

  const source = resolveInside(archiveRoot(), asset.relativePath);
  const page = pageFor(request, asset);
  const derivativeDirectory = derivativesRoot();
  await fs.mkdir(derivativeDirectory, { recursive: true });
  const derivative = resolveInside(derivativeDirectory, path.join(variantName, `${asset.id}${asset.technicalMetadata.mimeType === "application/pdf" ? `-p${page + 1}` : ""}.webp`));
  await fs.mkdir(path.dirname(derivative), { recursive: true });

  try {
    const [sourceStat, derivativeStat] = await Promise.all([
      fs.stat(source),
      fs.stat(derivative).catch(() => null),
    ]);
    if (!derivativeStat || derivativeStat.mtimeMs < sourceStat.mtimeMs) {
      const temporary = `${derivative}.${process.pid}.${Date.now()}.tmp`;
      if (asset.technicalMetadata.mimeType === "application/pdf") {
        const pdfRasterPrefix = `${temporary}-pdf`;
        const pdfRaster = `${pdfRasterPrefix}.png`;
        await execFileAsync(poppler("pdftoppm"), ["-f", String(page + 1), "-l", String(page + 1), "-scale-to", String(variant.edge), "-png", "-singlefile", source, pdfRasterPrefix]);
        await sharp(pdfRaster, { failOn: "none", limitInputPixels: false }).webp({ quality: variant.quality, effort: 4 }).toFile(temporary);
        await fs.unlink(pdfRaster).catch(() => undefined);
      } else {
        await sharp(source, { failOn: "none", limitInputPixels: false, page, pages: 1 })
          .rotate()
          .resize(variant.edge, variant.edge, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: variant.quality, effort: 4 })
          .toFile(temporary);
      }
      await fs.rename(temporary, derivative);
    }
    const body = await fs.readFile(derivative);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": "image/webp",
        // A derivative is versioned by source mtime on the server. It is safe and vital
        // to keep it in the visitor's browser cache between gallery visits.
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${asset.id}-${variantName}.webp"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Preview unavailable", { status: 404 });
  }
}
