import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createServerSupabaseClient } from "../_lib/supabase.js";
import {
  clearRefreshCookie,
  methodGuard,
  passesCsrfCheck,
  readRefreshCookie,
} from "../_lib/http.js";

/**
 * POST /api/auth/logout
 *
 * Revoca la sesion en Supabase (best-effort) y limpia la cookie httpOnly.
 * Siempre responde 200 para que el panel pueda cerrar sesion localmente aunque
 * la revocacion remota falle.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodGuard(req, res, "POST")) return;
  if (!passesCsrfCheck(req)) {
    res.status(403).json({ error: "Petición no autorizada." });
    return;
  }

  const refreshToken = readRefreshCookie(req);
  if (refreshToken) {
    try {
      const supabase = createServerSupabaseClient();
      // Establece la sesion solo para poder revocarla; no persiste nada.
      await supabase.auth.setSession({
        access_token: "",
        refresh_token: refreshToken,
      });
      await supabase.auth.signOut();
    } catch {
      /* best-effort: igual limpiamos la cookie abajo */
    }
  }

  clearRefreshCookie(res);
  res.status(200).json({ ok: true });
}
