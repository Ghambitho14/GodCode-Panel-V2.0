import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

const { url, anonKey } = resolveConfig();

/** Shared browser Supabase client (Vite). */
export const supabase: SupabaseClient = createClient(url, anonKey);
