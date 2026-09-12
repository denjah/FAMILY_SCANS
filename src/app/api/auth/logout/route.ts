import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, isSameOrigin } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Запрос отклонен." }, { status: 403 });
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
