import crypto from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export { hashPassword, verifyPassword } from "@/lib/password";

export type ArchiveRole = "contributor" | "admin";
export interface ArchiveSession {
  sub: string;
  role: ArchiveRole;
  displayName: string;
  iat: number;
  exp: number;
  ver: string;
}

export const SESSION_COOKIE = "archive_session";
export const SECURE_SESSION_COOKIE = "__Host-archive_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;

function safeEqualText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sessionSecret(): Buffer {
  const value = process.env.ARCHIVE_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("ARCHIVE_SESSION_SECRET is missing or too short");
  return Buffer.from(value, "base64url");
}

export function verifyInviteToken(value: string): boolean {
  const expected = process.env.ARCHIVE_INVITE_TOKEN || "";
  return Boolean(value && expected && safeEqualText(value, expected));
}

function signPayload(encodedPayload: string): string {
  return crypto.createHmac("sha256", sessionSecret()).update(encodedPayload).digest("base64url");
}

export function createSession(displayName: string, role: ArchiveRole): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: ArchiveSession = {
    sub: crypto.randomUUID(),
    role,
    displayName: displayName.slice(0, 80),
    iat: now,
    exp: now + SESSION_SECONDS,
    ver: process.env.ARCHIVE_SESSION_VERSION || "1",
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signPayload(encoded)}`;
}

export function parseSession(value: string | undefined): ArchiveSession | null {
  if (!value) return null;
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;
  const expected = signPayload(encoded);
  if (!safeEqualText(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ArchiveSession;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now || payload.iat > now + 60) return null;
    if (payload.ver !== (process.env.ARCHIVE_SESSION_VERSION || "1")) return null;
    if (!payload.displayName || !["contributor", "admin"].includes(payload.role)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<ArchiveSession | null> {
  const store = await cookies();
  return parseSession(store.get(SECURE_SESSION_COOKIE)?.value || store.get(SESSION_COOKIE)?.value);
}

export function getRequestSession(request: NextRequest): ArchiveSession | null {
  return parseSession(request.cookies.get(SECURE_SESSION_COOKIE)?.value || request.cookies.get(SESSION_COOKIE)?.value);
}

export function setSessionCookie(response: NextResponse, token: string, request: NextRequest): void {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const configuredOrigin = process.env.ARCHIVE_PUBLIC_ORIGIN;
  const secure = forwardedProto === "https" || request.nextUrl.protocol === "https:" || configuredOrigin?.startsWith("https://") === true;
  response.cookies.set(secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
  response.cookies.set(SECURE_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}

export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "");
  const requestOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : request.nextUrl.origin;
  const configured = process.env.ARCHIVE_PUBLIC_ORIGIN;
  return origin === requestOrigin || Boolean(configured && origin === configured);
}
