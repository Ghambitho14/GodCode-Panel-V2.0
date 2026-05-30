import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase para uso EXCLUSIVO en el servidor (Vercel Serverless / BFF).
 *
 * No persiste sesion ni auto-refresca: cada request crea un cliente efimero que
 * solo se usa para hablar con GoTrue (login / refresh / logout). El refresh token
 * vive en una cookie httpOnly que gestiona el BFF; el navegador nunca lo ve en JS.
 */

function resolveServerConfig(): { url: string; anonKey: string } {
  // Preferimos vars sin prefijo VITE_ (server-only). Caemos a las VITE_* que ya
  // existen en el proyecto Vercel para no duplicar configuracion.
  const url = String(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
  ).trim();
  const anonKey = String(
    process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "",
  ).trim();

  if (!url || !anonKey) {
    throw new Error(
      "[GodCode BFF] Faltan SUPABASE_URL / SUPABASE_ANON_KEY (o sus equivalentes VITE_*) en el entorno del servidor.",
    );
  }

  return { url, anonKey };
}

export function createServerSupabaseClient(): SupabaseClient {
  const { url, anonKey } = resolveServerConfig();
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
