import { supabase } from "@/integrations/supabase";

/**
 * Wrapper alrededor de `supabase.rpc()` que detecta el código `42501`
 * (insufficient_privilege / forbidden) y otras señales de "grant pendiente"
 * para que la UI pueda mostrar un mensaje accionable en vez de un error
 * genérico.
 *
 * Contexto: varias RPCs admin (ver
 * `GodCode/docs/security-audit-supabase.md` §5 y
 * `GodCode/docs/security-remediation-plan.md` Bloque B3) hoy solo tienen GRANT
 * para `service_role`. Cuando el SPA las invoca con la anon key + JWT del
 * cajero, fallan con 42501. Hasta que se coordine con el repo del SaaS para
 * agregar el grant a `authenticated` (o se cree una Edge Function `admin-ops`),
 * estas RPCs no se pueden ejecutar desde GodCode.
 *
 * Uso:
 *   const result = await callGuardedRpc('admin_purge_clients', undefined, {
 *     showNotify,
 *   });
 *   if (result.notGranted) return; // ya se notificó al usuario
 *   if (result.error) throw result.error;
 *   // ...usar result.data
 */

export interface RpcGuardOptions {
	/** Si se pasa, se invoca con (mensaje, "warning") cuando el grant falta. */
	showNotify?: ((message: string, kind?: string) => void) | null;
	/** Etiqueta legible de la RPC para el mensaje al usuario. Default: nombre técnico. */
	label?: string;
}

export interface RpcGuardResult<T> {
	data: T | null;
	error: unknown;
	/** True cuando la RPC falló por falta de grant a authenticated (42501). */
	notGranted: boolean;
}

const GRANT_PENDING_MESSAGE = (label: string) =>
	`La acción "${label}" requiere coordinación con el equipo del SaaS para habilitar permisos en la base de datos. ` +
	`Hoy esa función solo es ejecutable con service_role (ver docs/security-remediation-plan.md, Bloque B3).`;

function isGrantMissingError(err: unknown): boolean {
	if (!err || typeof err !== "object") return false;
	const e = err as { code?: unknown; message?: unknown; status?: unknown };
	if (typeof e.code === "string" && e.code === "42501") return true;
	if (typeof e.status === "number" && e.status === 403) return true;
	if (typeof e.message === "string") {
		const m = e.message.toLowerCase();
		if (m.includes("permission denied")) return true;
		if (m.includes("insufficient_privilege")) return true;
		if (m.includes("not authorized")) return true;
	}
	return false;
}

export async function callGuardedRpc<T = unknown>(
	rpcName: string,
	args?: Record<string, unknown>,
	options: RpcGuardOptions = {},
): Promise<RpcGuardResult<T>> {
	const label = options.label ?? rpcName;
	const { data, error } = await supabase.rpc(rpcName, args);

	if (error && isGrantMissingError(error)) {
		const msg = GRANT_PENDING_MESSAGE(label);
		if (typeof options.showNotify === "function") {
			try {
				options.showNotify(msg, "warning");
			} catch {
				/* noop */
			}
		}
		if (import.meta.env.DEV) {
			console.warn(`[rpcGuard] grant pendiente para RPC \`${rpcName}\``, error);
		}
		return { data: null, error, notGranted: true };
	}

	return { data: (data ?? null) as T | null, error, notGranted: false };
}
