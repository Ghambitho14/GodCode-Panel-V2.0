import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createServerSupabaseClient } from "../_lib/supabase.js";
import { jsonSession, methodGuard, setRefreshCookie } from "../_lib/http.js";

/**
 * POST /api/auth/login  { email, password }
 *
 * Autentica contra Supabase EN EL SERVIDOR. El refresh token se guarda en la
 * cookie httpOnly `gc_rt` (no viaja al JS). Responde con el access token + datos
 * minimos del usuario para que el panel opere en memoria.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!methodGuard(req, res, "POST")) return;

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body;
  const email = String(body?.email ?? "").trim();
  const password = String(body?.password ?? "");

  if (!email || !password) {
    res.status(400).json({ error: "Email y contraseña son obligatorios." });
    return;
  }

  try {
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      res.status(401).json({ error: "Credenciales incorrectas." });
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

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
