import { supabase } from '@/integrations/supabase';

/**
 * Servicio de comunicados internos (broadcasts) que el dueno del SaaS publica
 * para sus tenants.
 *
 * Reemplaza al endpoint Next.js legacy `/api/tenant-broadcasts` (panel-viejo)
 * y NO depende del SaaS en runtime: invoca la Edge Function `tenant-broadcasts`
 * deployada en el mismo proyecto Supabase compartido.
 *
 * El header `Authorization: Bearer <jwt>` lo agrega `supabase.functions.invoke`
 * automaticamente con la sesion del usuario logueado.
 *
 * Tablas usadas internamente por la Edge Function (NO accesibles desde el cliente
 * por RLS): `saas_broadcasts`, `saas_broadcast_reads`, `users`, `companies`.
 */

const FN_NAME = 'tenant-broadcasts';

/**
 * Construye un Error con el mensaje devuelto por la Edge Function (si existe).
 * @param {{ data: any, error: any }} response
 * @param {string} fallbackMessage
 * @returns {Error}
 */
function buildFnError(response, fallbackMessage) {
	const dataMsg =
		response?.data && typeof response.data === 'object' && response.data !== null
			? response.data.error
			: null;
	const ctxMsg = response?.error?.message;
	return new Error(String(dataMsg || ctxMsg || fallbackMessage));
}

/**
 * Lee la lista de broadcasts visibles para la company del usuario logueado.
 *
 * Cada item ya viene en camelCase listo para el componente:
 *  { id, title, message, broadcastType, priority, startsAt, endsAt, requiresAck, readAt }
 *
 * @returns {Promise<Array<{
 *   id: string,
 *   title: string,
 *   message: string,
 *   broadcastType: string,
 *   priority: string,
 *   startsAt: string,
 *   endsAt: string | null,
 *   requiresAck: boolean,
 *   readAt: string | null,
 * }>>}
 */
export async function listBroadcasts() {
	const response = await supabase.functions.invoke(FN_NAME, { method: 'GET' });
	if (response.error) {
		throw buildFnError(response, 'Error al cargar comunicados');
	}
	const payload = response.data;
	if (payload && typeof payload === 'object' && Array.isArray(payload.broadcasts)) {
		return payload.broadcasts;
	}
	return [];
}

/**
 * Marca un comunicado como leido por el usuario logueado.
 * La Edge Function valida que el broadcast aplique al tenant antes de
 * upsertar en `saas_broadcast_reads`.
 *
 * @param {string} broadcastId
 * @returns {Promise<{ success: true }>}
 */
export async function acknowledgeBroadcast(broadcastId) {
	const id = String(broadcastId ?? '').trim();
	if (!id) {
		throw new Error('Falta broadcastId');
	}
	const response = await supabase.functions.invoke(FN_NAME, {
		method: 'POST',
		body: { broadcastId: id },
	});
	if (response.error) {
		throw buildFnError(response, 'No se pudo registrar el acuse');
	}
	return { success: true };
}
