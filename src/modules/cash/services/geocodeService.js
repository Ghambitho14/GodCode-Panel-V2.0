import { supabase } from '@/integrations/supabase';

/**
 * Servicio de geocoding para auto-deteccion de zona de delivery.
 *
 * Reemplaza al endpoint Next.js legacy `/api/delivery-geocode` (panel-viejo)
 * y NO depende del SaaS en runtime: invoca la Edge Function `geocode`
 * deployada en el mismo proyecto Supabase compartido.
 *
 * El header `Authorization: Bearer <jwt>` lo agrega `supabase.functions.invoke`
 * automaticamente con la sesion del usuario logueado.
 *
 * Tablas leidas internamente por la Edge Function (con service_role): `users`,
 * `branches.delivery_settings` (validando que la sucursal pertenezca al tenant).
 *
 * Provider de geocoding: Photon (Komoot/OSM), publico, sin API key.
 */

const FN_NAME = 'geocode';

/**
 * Resuelve una direccion en texto a una zona configurada en la sucursal.
 *
 * El calculo de tarifa NO se hace aca: el caller debe usar `computeDeliveryFee`
 * de `@/lib/delivery-settings` con el `namedAreaId` devuelto. Esto evita
 * duplicar logica de cobro entre el cliente y Deno.
 *
 * @param {{ branchId: string, address: string }} params
 * @returns {Promise<
 *   | { ok: true, namedAreaId: string, label: string }
 *   | { ok: false, code: 'short_address'|'geocode_failed'|'no_match'|'ambiguous', message: string }
 * >}
 *
 * Nunca arroja por errores de negocio (direccion corta, sin match, etc.):
 * estos vienen como `{ ok: false, code, message }`. Solo arroja si hay
 * problemas de transporte (sin red, timeout, 5xx sin body) o si faltan
 * parametros obligatorios.
 */
export async function geocodeAddress({ branchId, address }) {
	const bid = String(branchId ?? '').trim();
	const addr = String(address ?? '').trim();
	if (!bid) {
		throw new Error('Falta branchId');
	}
	if (!addr) {
		return {
			ok: false,
			code: 'short_address',
			message: 'Escribe una direccion para detectar la zona.',
		};
	}

	const response = await supabase.functions.invoke(FN_NAME, {
		method: 'POST',
		body: { branchId: bid, address: addr },
	});

	const payload = response?.data;

	if (payload && typeof payload === 'object') {
		// Resultado de negocio (success o error con `ok: false`): la Edge
		// Function siempre devuelve un body JSON estructurado, lo pasamos tal cual.
		if (payload.ok === true && typeof payload.namedAreaId === 'string') {
			return {
				ok: true,
				namedAreaId: payload.namedAreaId,
				label: typeof payload.label === 'string' ? payload.label : '',
			};
		}
		if (payload.ok === false) {
			return {
				ok: false,
				code: typeof payload.code === 'string' ? payload.code : 'no_match',
				message:
					typeof payload.message === 'string'
						? payload.message
						: 'No pudimos detectar la zona.',
			};
		}
	}

	// Sin body parseable: error de transporte real, lo propagamos.
	const transportMsg = response?.error?.message || 'Error al detectar la zona';
	throw new Error(transportMsg);
}
