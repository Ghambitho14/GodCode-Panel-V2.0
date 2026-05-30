import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleRefreshFromCookie } from "../_lib/refresh.js";
import { methodGuard } from "../_lib/http.js";

/**
 * GET /api/auth/session
 *
 * Usado al arrancar la app (y tras F5): si la cookie httpOnly tiene un refresh
 * token valido, devuelve un access token fresco + el usuario. Si no, 401.
 * No requiere check CSRF porque es GET idempotente que solo lee la cookie.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodGuard(req, res, "GET")) return;
  await handleRefreshFromCookie(req, res);
}
