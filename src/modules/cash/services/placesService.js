/**
 * Servicio de autocompletado y geocoding de lugares via Photon.
 *
 * Photon (https://photon.komoot.io/) es un proxy publico sobre OpenStreetMap.
 * No requiere API key, soporta CORS abierto, uso libre documentado.
 *
 * Reemplaza al endpoint Next.js legacy `/api/places-autocomplete` que en
 * `proyecto viejo` (panel-viejo/app/api/places-autocomplete/route.ts) ejecutaba
 * exactamente esta misma logica server-side. Como Photon es publico y nuestro
 * componente solo se monta dentro del panel autenticado (ManualOrderModal con
 * caja abierta), no hace falta proxy ni Edge Function.
 *
 * `geocodeToCoords` se usa para autocalcular distancia en pedidos con modo
 * `distance`: misma regla "RLS resuelve / 3rd party publico -> client-side".
 * El `geocode` Edge Function vive aparte porque cubre `named_areas` y necesita
 * leer `branches.delivery_settings` con service_role para el match fuzzy.
 */

import { isValidLatLng } from '@/lib/geo';

const PHOTON_URL = 'https://photon.komoot.io/api/';

/** Bbox aproximado (minLon,minLat,maxLon,maxLat) por region soportada. */
const REGION_BBOX = {
	cl: '-75.8,-56.5,-65.2,-17.0',
	ve: '-73.6,0.4,-59.4,12.6',
};

const MIN_LEN = 2;
const MAX_Q = 96;
const MAX_RESULTS = 10;

/**
 * @param {unknown} raw
 * @returns {'cl' | 've'}
 */
function normalizeRegion(raw) {
	const u = String(raw ?? 'cl').trim().toLowerCase();
	if (u === 've' || u === 'venezuela') return 've';
	return 'cl';
}

/**
 * Filtra features de Photon por region. Acepta countrycode ISO o country textual.
 * Si Photon no devuelve ni cc ni country, asume que el bbox ya filtro y acepta.
 * @param {'cl' | 've'} region
 * @param {Record<string, unknown>} p
 */
function matchesRegion(region, p) {
	const cc = String(p.countrycode ?? '').trim().toUpperCase();
	if (region === 'cl') {
		if (cc === 'CL') return true;
		const c = String(p.country ?? '').trim().toLowerCase();
		if (c.includes('chile')) return true;
		return !cc && !c;
	}
	if (cc === 'VE') return true;
	const c = String(p.country ?? '').trim().toLowerCase();
	if (c.includes('venezuela')) return true;
	return !cc && !c;
}

/**
 * Construye un label legible a partir de las propiedades de Photon.
 * @param {Record<string, unknown>} p
 * @returns {string}
 */
function labelFromProps(p) {
	const name =
		p.name ||
		p.city ||
		p.district ||
		p.locality ||
		p.county ||
		'';
	if (!name) return '';
	const region = p.state || p.county || '';
	const parts = [String(name).trim()];
	if (
		region &&
		!String(name).toLowerCase().includes(String(region).toLowerCase())
	) {
		parts.push(String(region).trim());
	}
	return parts.join(' · ').slice(0, 120);
}

/**
 * Busca sugerencias de lugares en Photon, filtrando por region y deduplicando labels.
 *
 * @param {object} args
 * @param {string} args.q - texto a buscar (>= 2 caracteres).
 * @param {string} [args.region='cl'] - 'cl' | 've'.
 * @param {number} [args.lat] - latitud bias opcional.
 * @param {number} [args.lng] - longitud bias opcional.
 * @param {AbortSignal} [args.signal] - signal para cancelar.
 * @returns {Promise<{ label: string }[]>}
 */
export async function searchPlaces({ q, region, lat, lng, signal } = {}) {
	const trimmed = String(q ?? '').trim();
	if (trimmed.length < MIN_LEN) return [];
	if (trimmed.length > MAX_Q) return [];

	const reg = normalizeRegion(region);
	const url = new URL(PHOTON_URL);
	url.searchParams.set('q', trimmed);
	// Photon solo admite lang: default | de | en | fr (no "es"); con "es" devuelve error sin features.
	url.searchParams.set('lang', 'default');
	url.searchParams.set('limit', '14');
	url.searchParams.set('bbox', REGION_BBOX[reg]);
	const latNum = Number(lat);
	const lngNum = Number(lng);
	if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
		url.searchParams.set('lat', String(latNum));
		url.searchParams.set('lon', String(lngNum));
	}

	const res = await fetch(url.toString(), {
		signal,
		cache: 'no-store',
		headers: { Accept: 'application/json' },
	});
	if (!res.ok) {
		throw new Error('Servicio de mapas no disponible');
	}

	const data = await res.json().catch(() => ({}));
	const features = Array.isArray(data?.features) ? data.features : [];
	const seen = new Set();
	/** @type {{ label: string }[]} */
	const suggestions = [];
	for (const f of features) {
		const p = f?.properties;
		if (!p || !matchesRegion(reg, p)) continue;
		const label = labelFromProps(p);
		if (!label) continue;
		const key = label.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		suggestions.push({ label });
		if (suggestions.length >= MAX_RESULTS) break;
	}
	return suggestions;
}

const MIN_GEOCODE_LEN = 8;
const MAX_GEOCODE_Q = 200;

/**
 * Geocodifica una direccion en texto a coordenadas WGS84 para autocalcular
 * distancia (modo `distance` del delivery). Codigos de error consistentes con
 * `geocodeService.js` (`short_address`, `geocode_failed`).
 *
 * Photon devuelve coords en formato GeoJSON: `geometry.coordinates = [lng, lat]`.
 *
 * @param {object} args
 * @param {string} args.address - direccion del cliente.
 * @param {string} [args.region='cl'] - 'cl' | 've' (filtro pais).
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<
 *   | { ok: true, lat: number, lng: number, label: string }
 *   | { ok: false, code: 'short_address'|'geocode_failed', message: string }
 * >}
 */
export async function geocodeToCoords({ address, region, signal } = {}) {
	const trimmed = String(address ?? '').trim();
	if (trimmed.length < MIN_GEOCODE_LEN) {
		return {
			ok: false,
			code: 'short_address',
			message: 'Escribe una direccion mas completa para calcular la distancia.',
		};
	}
	if (trimmed.length > MAX_GEOCODE_Q) {
		return {
			ok: false,
			code: 'short_address',
			message: 'La direccion es demasiado larga.',
		};
	}

	const reg = normalizeRegion(region);
	const url = new URL(PHOTON_URL);
	url.searchParams.set('q', trimmed);
	url.searchParams.set('lang', 'default');
	url.searchParams.set('limit', '1');
	url.searchParams.set('bbox', REGION_BBOX[reg]);

	let res;
	try {
		res = await fetch(url.toString(), {
			signal,
			cache: 'no-store',
			headers: { Accept: 'application/json' },
		});
	} catch (err) {
		throw new Error(
			err instanceof Error ? err.message : 'Servicio de mapas no disponible',
		);
	}
	if (!res.ok) {
		throw new Error('Servicio de mapas no disponible');
	}

	const data = await res.json().catch(() => ({}));
	const features = Array.isArray(data?.features) ? data.features : [];
	const feat = features[0];
	const coords = feat?.geometry?.coordinates;
	if (!Array.isArray(coords) || coords.length < 2) {
		return {
			ok: false,
			code: 'geocode_failed',
			message: 'No pudimos ubicar esa direccion. Revisa e intenta de nuevo.',
		};
	}

	const lng = Number(coords[0]);
	const lat = Number(coords[1]);
	if (!isValidLatLng(lat, lng)) {
		return {
			ok: false,
			code: 'geocode_failed',
			message:
				'Coordenadas invalidas devueltas por el geocoder. Escribe los km manualmente.',
		};
	}

	const props = (feat?.properties && typeof feat.properties === 'object'
		? feat.properties
		: {});
	const label = labelFromProps(props) || trimmed;

	return { ok: true, lat, lng, label };
}
