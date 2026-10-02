import fs from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getRequestSession } from "@/lib/auth";

export const runtime = "nodejs";

const ICON_NAMES = new Set([
  "ALL_0.jpg", "ALL_1.jpg",
  "BAB_0.jpg", "BAB_01.jpg",
  "DAN_0.jpg", "DAN_1.jpg",
  "DEN_0.jpg", "DEN_1.jpg",
  "MAMA_0.jpg", "MAMA_1.jpg",
  "PAPA_0.jpg", "PAPA_1.jpg",
]);

export async function GET(request: NextRequest, context: { params: Promise<{ name: string }> }) {
  if (!getRequestSession(request)) return new NextResponse("Unauthorized", { status: 401 });
  const { name } = await context.params;
  if (!ICON_NAMES.has(name)) return new NextResponse("Not found", { status: 404 });

  try {
    const image = await fs.readFile(path.join(process.cwd(), "ICONS", name));
    return new NextResponse(image, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
