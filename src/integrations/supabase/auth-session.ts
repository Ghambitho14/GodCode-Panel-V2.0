/**
 * Gestor de sesion del panel (cliente del BFF de cookies httpOnly).
 *
 * El refresh token NUNCA vive en JS: queda en la cookie httpOnly `gc_rt` que
 * gestiona el backend (`/api/auth/*`). Aqui solo guardamos el access token en
 * memoria y lo renovamos contra el BFF.
 *
 * Puntos clave:
 * - `getAccessToken()` lo consume `createClient({ accessToken })`: puede llamarse
 *   muchas veces y en paralelo, por eso el refresh usa un lock single-flight.
 * - El refresh token compartido (una sola cookie por origen) elimina el problema
 *   de "cada pestana con su propia copia" y la pelea por la rotacion.
 */

const SESSION_URL = "/api/auth/session";
const LOGIN_URL = "/api/auth/login";
const REFRESH_URL = "/api/auth/refresh";
const LOGOUT_URL = "/api/auth/logout";

/** Margen antes de `expires_at` para renovar de forma proactiva (ms). */
const EXPIRY_SKEW_MS = 60_000;

export interface SessionUser {
  id: string;
  email: string | null;
}

interface SessionPayload {
  access_token: string;
  expires_at: number | null;
  user?: { id?: string | null; email?: string | null } | null;
}

type AuthEvent = "signed_in" | "signed_out";

type SessionStatus = "unknown" | "active" | "none";

interface CurrentSession {
  accessToken: string;
  expiresAtMs: number | null;
  user: SessionUser;
}

let current: CurrentSession | null = null;
let status: SessionStatus = "unknown";
let refreshInFlight: Promise<string | null> | null = null;
const listeners = new Set<(event: AuthEvent) => void>();

function emit(event: AuthEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      /* no romper el resto de listeners */
    }
  }
}

/** Suscribe a eventos de sesion. Devuelve la funcion para desuscribir. */
export function onAuthEvent(callback: (event: AuthEvent) => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function getCurrentUser(): SessionUser | null {
  return current?.user ?? null;
}

function applyPayload(payload: SessionPayload): SessionUser {
  current = {
    accessToken: payload.access_token,
    expiresAtMs:
      typeof payload.expires_at === "number" ? payload.expires_at * 1000 : null,
    user: {
      id: payload.user?.id ?? "",
      email: payload.user?.email ?? null,
    },
  };
  status = "active";
  return current.user;
}

function clearSession(notify: boolean): void {
  const hadSession = current !== null;
  current = null;
  status = "none";
  if (notify && hadSession) emit("signed_out");
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error?.trim() || fallback;
  } catch {
    return fallback;
  }
}

function postBff(url: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "X-GC-Auth": "1" },
  });
}

/** Inicia sesion via BFF. El refresh token se guarda en la cookie httpOnly. */
export async function login(email: string, password: string): Promise<SessionUser> {
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-GC-Auth": "1" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Credenciales incorrectas."));
  }
  const payload = (await res.json()) as SessionPayload;
  const user = applyPayload(payload);
  emit("signed_in");
  return user;
}

/**
 * Restaura la sesion al arrancar / tras F5 leyendo la cookie httpOnly.
 * Devuelve el usuario si hay sesion valida, o `null` si no la hay.
 * Ante error de red NO destruye el estado en memoria (evita expulsar por un blip).
 */
export async function bootstrapSession(): Promise<SessionUser | null> {
  // Si ya sabemos que NO hay sesion (p. ej. justo tras logout), no golpeamos la red:
  // evita un 401 ruidoso en consola en la pantalla de login.
  if (status === "none") return null;
  // Si ya hay sesion activa en memoria, la reutilizamos (los tokens se renuevan
  // de forma perezosa en getAccessToken cuando hace falta).
  if (status === "active" && current) return current.user;

  try {
    const res = await fetch(SESSION_URL, {
      method: "GET",
      credentials: "include",
      headers: { "X-GC-Auth": "1" },
    });
    if (!res.ok) {
      if (res.status === 401) clearSession(false);
      return current?.user ?? null;
    }
    const payload = (await res.json()) as SessionPayload;
    const user = applyPayload(payload);
    emit("signed_in");
    return user;
  } catch {
    return current?.user ?? null;
  }
}

function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await postBff(REFRESH_URL);
      if (!res.ok) {
        if (res.status === 401) clearSession(true);
        return current?.accessToken ?? null;
      }
      const payload = (await res.json()) as SessionPayload;
      applyPayload(payload);
      return current?.accessToken ?? null;
    } catch {
      // Error de red: conservamos el token actual (si lo hay) y reintentaremos luego.
      return current?.accessToken ?? null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * Devuelve un access token valido para Supabase (PostgREST / Storage / Realtime).
 * Lo consume `createClient({ accessToken })`. Renueva proactivamente cerca del
 * vencimiento y deduplica refrescos concurrentes (single-flight).
 */
export async function getAccessToken(): Promise<string | null> {
  if (status === "none") return null;

  if (current) {
    const fresh =
      current.expiresAtMs === null ||
      Date.now() < current.expiresAtMs - EXPIRY_SKEW_MS;
    if (fresh) return current.accessToken;
  }

  return refreshAccessToken();
}

/** Cierra sesion: revoca en el BFF (best-effort) y limpia el estado en memoria. */
export async function logout(): Promise<void> {
  try {
    await postBff(LOGOUT_URL);
  } catch {
    /* best-effort: igual limpiamos abajo */
  }
  clearSession(true);
}
