import { supabase, TABLES } from '@/integrations/supabase';
import { normalizePhoneDigits } from '@/shared/utils/phoneWhatsApp';

/**
 * Normaliza teléfono chileno al formato canónico del panel: +56 9 XXXX XXXX
 * @param {unknown} phone
 * @returns {string}
 */
export function normalizeManualPhone(phone) {
	const raw = phone == null ? '' : String(phone).trim();
	if (!raw) return '';

	let digits = normalizePhoneDigits(raw);
	if (!digits) return raw;

	if (digits.length === 9 && digits.startsWith('9')) {
		digits = `56${digits}`;
	} else if (digits.length === 8 && digits.startsWith('9')) {
		digits = `569${digits}`;
	} else if (digits.length > 11 && digits.startsWith('56')) {
		digits = digits.slice(0, 11);
	}

	if (digits.length < 11 || !digits.startsWith('56')) {
		return raw;
	}

	const local9 = digits.slice(2, 11);
	if (local9.length < 9) return raw;

	return `+56 ${local9.slice(0, 1)} ${local9.slice(1, 5)} ${local9.slice(5, 9)}`;
}

/**
 * @param {unknown} phone
 * @returns {string}
 */
export function normalizePhoneForSearch(phone) {
	return normalizePhoneDigits(phone);
}

/**
 * @param {Record<string, unknown> | null | undefined} addr
 * @returns {{
 *   delivery_address: string;
 *   delivery_reference: string;
 *   delivery_named_area_id: string;
 *   delivery_km: string;
 * }}
 */
export function mapAddressToFormFields(addr) {
	if (!addr || typeof addr !== 'object') {
		return {
			delivery_address: '',
			delivery_reference: '',
			delivery_named_area_id: '',
			delivery_km: '',
		};
	}

	const line =
		(typeof addr.address_line === 'string' && addr.address_line.trim())
			? addr.address_line.trim()
			: (typeof addr.address === 'string' && addr.address.trim())
				? addr.address.trim()
				: '';

	const ref =
		(typeof addr.reference === 'string' && addr.reference.trim())
			? addr.reference.trim()
			: '';

	const namedAreaId =
		typeof addr.named_area_id === 'string' ? addr.named_area_id.trim() : '';

	const kmRaw = addr.delivery_km;
	const deliveryKm =
		kmRaw != null && kmRaw !== '' && Number.isFinite(Number(kmRaw))
			? String(kmRaw)
			: '';

	return {
		delivery_address: line,
		delivery_reference: ref,
		delivery_named_area_id: namedAreaId,
		delivery_km: deliveryKm,
	};
}

/**
 * @param {string} clientId
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function fetchClientAddresses(clientId) {
	const id = String(clientId ?? '').trim();
	if (!id) return [];

	const { data, error } = await supabase
		.from(TABLES.client_addresses)
		.select('*')
		.eq('client_id', id)
		.order('last_used_at', { ascending: false });

	if (error) throw error;
	return data || [];
}

/**
 * Etiqueta legible para selector de direcciones guardadas.
 * @param {Record<string, unknown>} addr
 * @returns {string}
 */
export function formatSavedAddressLabel(addr) {
	if (!addr || typeof addr !== 'object') return 'Dirección';
	const parts = [];
	const ref = typeof addr.reference === 'string' ? addr.reference.trim() : '';
	const line = typeof addr.address_line === 'string' ? addr.address_line.trim() : '';
	if (ref) parts.push(ref);
	if (line && line !== ref) parts.push(line);
	return parts.filter(Boolean).join(' · ') || 'Dirección guardada';
}
