import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  if (!/^(?:razdelit0[1-5]|rosett(?:0[1-9]|1[0-8]))\.svg$/.test(name)) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const svg = await fs.readFile(path.join(process.cwd(), "elements", name));
    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
