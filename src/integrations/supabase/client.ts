import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAccessToken } from "./auth-session";

const CONFIG_WARN =
  "[GodCode] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. Copiá .env.example a .env y pegá URL + anon key del proyecto (Supabase → Settings → API).";

function resolveConfig(): { url: string; anonKey: string } {
  const url = String(import.meta.env.VITE_SUPABASE_URL ?? "").trim();
  const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();

  if (url && anonKey) {
    return { url, anonKey };
  }

  if (import.meta.env.DEV) {
    console.warn(CONFIG_WARN);
    // Valores sintácticamente válidos para que createClient no reviente al cargar la app sin .env.
    // Las llamadas a la API fallarán hasta configurar el proyecto real.
    return {
      url: "https://placeholder-not-configured.supabase.co",
      anonKey:
        "eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYWNlaG9sZGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjAsImV4cCI6OTk5OTk5OTk5OX0.invalid-placeholder",
    };
  }

  throw new Error(CONFIG_WARN);
}

/**
 * Quita sesiones Supabase viejas guardadas en el navegador. Con el BFF de cookies
 * httpOnly el access token vive solo en memoria y el refresh token en la cookie
 * `gc_rt`, asi que ya no debe quedar nada de `sb-*-auth-token` en local/session storage.
 */
function clearLegacyAuthStorage(): void {
  if (typeof window === "undefined") return;
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      for (let i = store.length - 1; i >= 0; i -= 1) {
        const key = store.key(i);
        if (key?.startsWith("sb-") && key.includes("auth-token")) {
          store.removeItem(key);
        }
      }
    } catch {
      /* ignore quota / private mode */
    }
  }
}

clearLegacyAuthStorage();

const { url, anonKey } = resolveConfig();

/**
 * Cliente Supabase del navegador (Vite).
 *
 * Auth gestionada por el BFF: el access token se inyecta vía el callback
 * `accessToken` (lo provee `auth-session`), que se encarga de renovarlo contra
 * `/api/auth/*`. Por eso NO usamos el namespace `supabase.auth` (queda
 * inhabilitado al pasar `accessToken`) ni persistimos sesión en el navegador.
 */
export const supabase: SupabaseClient = createClient(url, anonKey, {
  accessToken: () => getAccessToken(),
});

/**
 * Cliente sin persistencia para validaciones puntuales (p. ej. re-auth en zona peligro)
 * sin rotar ni invalidar la sesión del panel principal.
 */
export function createEphemeralSupabaseClient(): SupabaseClient {
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
