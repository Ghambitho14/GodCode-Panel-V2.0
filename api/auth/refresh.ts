import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleRefreshFromCookie } from "../_lib/refresh.js";
import { methodGuard, passesCsrfCheck } from "../_lib/http.js";

/**
 * POST /api/auth/refresh
 *
 * Renueva el access token usando el refresh token de la cookie httpOnly y rota
 * la cookie. Protegido con check CSRF basico (cabecera X-GC-Auth + Origin).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodGuard(req, res, "POST")) return;
  if (!passesCsrfCheck(req)) {
    res.status(403).json({ error: "Petición no autorizada." });
    return;
  }
  await handleRefreshFromCookie(req, res);
}
