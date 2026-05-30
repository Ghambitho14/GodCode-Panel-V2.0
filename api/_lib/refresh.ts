import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createServerSupabaseClient } from "./supabase.js";
import {
  clearRefreshCookie,
  jsonSession,
  readRefreshCookie,
  setRefreshCookie,
} from "./http.js";

/**
 * Logica compartida por /api/auth/refresh y /api/auth/session:
 * lee la cookie `gc_rt`, pide a Supabase un nuevo par de tokens (rotacion),
 * vuelve a setear la cookie y responde con el access token fresco.
 *
 * Si no hay cookie o el refresh falla: limpia la cookie y responde 401.
 */
export async function handleRefreshFromCookie(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const refreshToken = readRefreshCookie(req);
  if (!refreshToken) {
    res.status(401).json({ error: "Sin sesión." });
    return;
  }

  try {
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      clearRefreshCookie(res);
      res.status(401).json({ error: "Sesión expirada." });
      return;
    }

    setRefreshCookie(res, data.session.refresh_token);
    jsonSession(res, {
      access_token: data.session.access_token,
      expires_at: data.session.expires_at ?? null,
      user: data.user,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error de servidor." });
  }
}
