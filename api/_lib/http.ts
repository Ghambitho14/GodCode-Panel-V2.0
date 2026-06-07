import type { VercelRequest, VercelResponse } from "@vercel/node";

/** Nombre de la cookie httpOnly que guarda el refresh token. */
export const REFRESH_COOKIE = "gc_rt";

/** Vida de la cookie (segundos). 30 dias: el refresh token de Supabase la respalda. */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function isProd(): boolean {
  return String(process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "") !== "development";
}

function serializeCookie(value: string, maxAgeSeconds: number): string {
  const parts = [
    `${REFRESH_COOKIE}=${value}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  // Secure solo en entornos servidos por HTTPS (prod / preview). En `vercel dev`
  // local sobre http, Secure impediria que el navegador guarde la cookie.
  if (isProd()) parts.push("Secure");
  return parts.join("; ");
}

export function setRefreshCookie(res: VercelResponse, token: string): void {
  res.setHeader("Set-Cookie", serializeCookie(token, COOKIE_MAX_AGE_SECONDS));
}

export function clearRefreshCookie(res: VercelResponse): void {
  res.setHeader("Set-Cookie", serializeCookie("", 0));
}

export function readRefreshCookie(req: VercelRequest): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === REFRESH_COOKIE) {
      const v = rest.join("=").trim();
      return v ? decodeURIComponent(v) : null;
    }
  }
  return null;
}

/**
 * Defensa CSRF barata para endpoints que dependen de la cookie (refresh/logout):
 * - Exige cabecera propia `X-GC-Auth` (un fetch cross-site no puede setearla sin CORS).
 * - Valida que el Origin sea el mismo host del request.
 * Devuelve true si la peticion es legitima.
 */
export function passesCsrfCheck(req: VercelRequest): boolean {
  if (req.headers["x-gc-auth"] !== "1") return false;
  const origin = req.headers.origin;
  // M2: POST cross-site siempre envía Origin; sin Origin rechazamos (excepto GET implícito).
  if (!origin) return false;
  try {
    const originHost = new URL(String(origin)).host;
    const host = String(req.headers.host ?? "");
    return Boolean(host) && originHost === host;
  } catch {
    return false;
  }
}

export function methodGuard(
  req: VercelRequest,
  res: VercelResponse,
  allowed: string,
): boolean {
  if (req.method !== allowed) {
    res.status(405).json({ error: "Method not allowed" });
    return false;
  }
  return true;
}

export interface SessionPayload {
  access_token: string;
  expires_at: number | null;
  user: { id: string; email: string | null };
}

export function jsonSession(
  res: VercelResponse,
  session: {
    access_token: string;
    expires_at?: number | null;
    user?: { id: string; email?: string | null } | null;
  },
): void {
  const payload: SessionPayload = {
    access_token: session.access_token,
    expires_at: session.expires_at ?? null,
    user: {
      id: session.user?.id ?? "",
      email: session.user?.email ?? null,
    },
  };
  res.status(200).json(payload);
}
