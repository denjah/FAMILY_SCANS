import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createSession,
  isSameOrigin,
  setSessionCookie,
  verifyInviteToken,
  verifyPassword,
} from "@/lib/auth";
import { canAttempt, clearFailures, rateLimitKey, recordFailure } from "@/lib/rate-limit";

export const runtime = "nodejs";

const LoginSchema = z.object({
  invite: z.string().min(20).max(200).optional(),
  displayName: z.string().trim().min(2).max(80),
  password: z.string().min(4).max(200),
  admin: z.boolean().optional().default(false),
});

function clientIp(request: NextRequest): string {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Запрос отклонен." }, { status: 403 });
  const parsed = LoginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Проверьте заполненные поля." }, { status: 400 });

  const { invite, displayName, password, admin } = parsed.data;
  const key = rateLimitKey(clientIp(request), invite || "direct-login");
  const limit = canAttempt(key);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Слишком много попыток. Попробуйте позднее." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  // The archive can be entered from its front page with the family password.
  // A personal invitation remains an extra access link, not a second mandatory secret.
  const inviteOk = !invite || verifyInviteToken(invite);
  const passwordOk = admin
    ? verifyPassword(password, process.env.ARCHIVE_ADMIN_PASSWORD_HASH)
    : verifyPassword(password, process.env.ARCHIVE_FAMILY_PASSWORD_HASH);
  if (!inviteOk || !passwordOk) {
    recordFailure(key);
    await new Promise((resolve) => setTimeout(resolve, 450));
    return NextResponse.json({ error: "Имя или пароль не подошли." }, { status: 401 });
  }

  clearFailures(key);
  const response = NextResponse.json({ ok: true });
  setSessionCookie(response, createSession(displayName, admin ? "admin" : "contributor"), request);
  return response;
}
