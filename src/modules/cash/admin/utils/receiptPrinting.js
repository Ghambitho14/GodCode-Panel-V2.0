import { formatCurrency } from '@/shared/utils/formatters';
import {
	deliveryAddressLines,
	getPaymentLabel,
	isOrderDelivery,
} from '@/shared/utils/orderUtils';

/**
 * Impresión térmica desde el navegador: mm + pt evitan preview borroso.
 * 80 mm = rollo habitual; el texto va en negrita uniforme para que la térmica
 * no deje líneas “fantasma” (peso 400/italic suele salir muy tenue).
 */
const THERMAL_PAPER_MM = 80;
const CONTENT_MM = THERMAL_PAPER_MM <= 58 ? 48 : 72;

/** @typedef {'kitchen' | 'cashier'} TicketVariant */

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function resolveSafeLogoUrl(logoUrl) {
	if (!logoUrl) return '';
	try {
		const parsed = new URL(logoUrl, window.location.origin);
		if (parsed.protocol === 'https:') return parsed.href;
		if (import.meta.env.DEV && parsed.protocol === 'http:') return parsed.href;
		return '';
	} catch {
		return '';
	}
}

/**
 * @param {Record<string, unknown>} order
 * @returns {string}
 */
function formatTicketDateTime(order) {
	const d = order?.created_at ? new Date(order.created_at) : new Date();
	if (Number.isNaN(d.getTime())) {
		return new Date().toLocaleString('es-CL', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	}
	return d.toLocaleString('es-CL', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

/**
 * Fecha y hora con guión (estilo ticket cocina / Oishi): «29/03/2026 - 17:47».
 * @param {Record<string, unknown>} order
 * @returns {string}
 */
function formatTicketDateTimeDash(order) {
	const d = order?.created_at ? new Date(order.created_at) : new Date();
	if (Number.isNaN(d.getTime())) {
		const n = new Date();
		return formatDateDashFromDate(n);
	}
	return formatDateDashFromDate(d);
}

/**
 * @param {Date} d
 */
function formatDateDashFromDate(d) {
	const datePart = d.toLocaleDateString('es-CL', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
	});
	const timePart = d.toLocaleTimeString('es-CL', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	});
	return `${datePart} - ${timePart}`;
}

/**
 * @param {Record<string, unknown>} order
 * @returns {string}
 */
function formatOrderNumberForTicket(order) {
	const raw =
		order?.shift_sequence ??
		order?.display_id ??
		order?.order_number ??
		order?.id;
	if (raw == null || raw === '') return '—';
	return String(raw);
}

/** Texto central del ticket cliente: «En el local» vs domicilio (como Oishi). */
function whereLabelForClientTicket(order) {
	return isOrderDelivery(order) ? 'Domicilio' : 'En el local';
}

/** Bloque compacto dirección/envío para tickets térmicos. */
function deliveryShipmentSectionHtml(order) {
	if (!isOrderDelivery(order)) return '';
	const feeNum = Number(order?.delivery_fee);
	const feeLbl =
		Number.isFinite(feeNum) && feeNum > 0 ? formatCurrency(feeNum) : 'GRATIS';
	const hc = order?.handoff_code;
	const codeLine =
		hc != null && String(hc).trim() !== ''
			? `<p class="c-delivery-meta">COD. VERIF: ${escapeHtml(String(hc).trim())}</p>`
			: '';
	const lines = deliveryAddressLines(order?.delivery_address);
	const addrInner = lines.length
		? lines
				.map((line) => `<p class="c-delivery-line">${escapeHtml(line)}</p>`)
				.join('')
		: '<p class="c-delivery-line">(Sin texto de ubicación guardado)</p>';
	return `
			<div class="c-delivery-box">
				<p class="c-delivery-heading">DATOS ENVÍO</p>
				<p class="c-delivery-meta">Cargo envío: ${escapeHtml(feeLbl)}</p>
				${codeLine}
				${addrInner}
			</div>`;
}

/**
 * Limpia los prefijos `[Sucursal: ...]` y `[Envío: $...]` que `createOrder`
 * inyecta en `note`. Esa metadata se usa internamente (asignacion de sucursal
 * + auditoria del envio) pero contamina la lectura del ticket:
 *   - Cocina ya sabe en que sucursal esta y no le importa el monto.
 *   - Caja muestra la sucursal en el header (h1) y el envio en la fila "Envío"
 *     del bloque de totales; repetirlo en la nota es ruido para el cliente.
 *
 * Se aplica al ticket de cocina y al ticket de caja, dejando intacta la
 * "nota real" que escribio el cajero.
 */
function stripInternalNoteHints(rawNote) {
	if (!rawNote) return '';
	return String(rawNote)
		.replace(/^\s*\[Sucursal:[^\]]*\]\s*\n?/i, '')
		.replace(/\n?\[Envío:[^\]]*\]\s*$/i, '')
		.trim();
}

/** Nota por línea persistida en `items` (jsonb); tolera valores no-string. */
function plainItemNote(item) {
	const n = item?.note;
	if (n == null) return '';
	const s = typeof n === 'string' ? n : String(n);
	return s.trim();
}

/**
 * Canal mostrado en «#n - En el local - WEB» (override opcional desde options).
 * @param {Record<string, unknown>} order
 * @param {string | null | undefined} override
 */
function orderChannelForTicket(order, override) {
	const o = override != null ? String(override).trim() : '';
	if (o) return o;
	const ch = order?.order_channel != null ? String(order.order_channel).trim() : '';
	if (ch) return ch;
	return order?.payment_type === 'online' ? 'WEB' : 'PDV';
}

/**
 * @param {Record<string, unknown>} order
 * @returns {string} HTML escapado
 */
function clientReferenceLineHtml(order) {
	const h = order?.handoff_code;
	if (h != null && String(h).trim() !== '') {
		return escapeHtml(`CL-${String(h).trim()}`);
	}
	const raw = order?.display_id ?? order?.order_number ?? order?.id;
	if (raw == null || raw === '') return '—';
	const compact = String(raw).replace(/-/g, '');
	return escapeHtml(compact.length > 12 ? `REF-${compact.slice(-10)}` : `REF-${compact}`);
}

/**
 * @param {Record<string, unknown>} order
 * @returns {{ itemsSubtotal: number, deliveryFee: number, grandTotal: number }}
 */
function summarizeAmounts(order) {
	const items = order?.items || [];
	let itemsSubtotal = 0;
	for (const it of items) {
		const price = (it.has_discount && it.discount_price > 0)
			? Number(it.discount_price)
			: Number(it.price);
		if (!Number.isFinite(price)) continue;
		itemsSubtotal += price * (Number(it.quantity) || 1);
		
		// Agregar precio de extras
		if (Array.isArray(it.extras) && it.extras.length > 0) {
			for (const extra of it.extras) {
				const extraPrice = Number(extra.price) || 0;
				if (!Number.isFinite(extraPrice)) continue;
				itemsSubtotal += extraPrice * (Number(extra.quantity) || 1);
			}
		}
	}
	const deliveryFee = Number(order?.delivery_fee);
	const fee = Number.isFinite(deliveryFee) && deliveryFee > 0 ? deliveryFee : 0;
	const grandTotal = Number(order?.total) || 0;
	return { itemsSubtotal, deliveryFee: fee, grandTotal };
}

/**
 * @param {Record<string, unknown>} order
 * @returns {string}
 */
function ticketPaymentStatusLabel(order) {
	if (order?.payment_type === 'online') {
		const ref = order?.payment_ref;
		if (typeof ref === 'string' && ref.startsWith('http')) {
			return 'Pagado (comprobante)';
		}
		return 'No pagado';
	}
	if (order?.payment_type === 'tarjeta') {
		return 'Pago con tarjeta';
	}
	return 'Pago en local';
}

/**
 * Estilos base compartidos: negrita en todo el cuerpo (legible en térmicas).
 * @param {number} contentMm
 */
function cssThermalBase(contentMm) {
	return `
		/* PDF / impresora de hoja: página estándar; el ticket ocupa todo el ancho útil. */
		@page {
			size: A4 portrait;
			margin: 12mm 14mm;
		}
		html {
			-webkit-text-size-adjust: 100%;
			text-size-adjust: 100%;
		}
		body {
			font-family: 'Courier New', 'Courier Prime', 'Liberation Mono', Consolas, monospace;
			font-size: 11pt;
			font-weight: 700;
			line-height: 1.38;
			width: 100%;
			max-width: min(100%, ${contentMm}mm);
			margin: 0 auto;
			padding: 3mm 2mm 4mm;
			color: #000;
			background: #fff;
			box-sizing: border-box;
			-webkit-print-color-adjust: exact;
			print-color-adjust: exact;
		}
		/* Sin itálica ni pesos livianos: en térmicas casi no se ven */
		body, body p, body span, body div, body h1, body h2, body small {
			font-style: normal !important;
			font-weight: 700 !important;
		}
		.ticket-brand {
			font-family: 'Arial Black', 'Helvetica Neue', Helvetica, Arial, sans-serif;
			font-weight: 900 !important;
			font-style: normal !important;
			letter-spacing: 0.06em;
			line-height: 1.15;
		}
		.rule-thick {
			border: none;
			border-top: 2px solid #000;
			margin: 3mm 0;
		}
		.rule-dots {
			border: none;
			border-top: 1px dotted #000;
			margin: 2.5mm 0;
		}
		@media print {
			body {
				max-width: 100% !important;
				width: 100% !important;
				margin: 0 !important;
				padding: 0 0 4mm !important;
				font-size: 12pt !important;
				-webkit-font-smoothing: none;
				font-smooth: never;
				text-rendering: geometricPrecision;
			}
			.c-logo {
				max-width: 52% !important;
			}
		}
	`;
}

/**
 * @param {Record<string, unknown>} order
 * @param {string} branchName
 * @param {string | null} logoUrl
 * @param {TicketVariant} variant
 * @param {{
 *   branchAddress?: string | null;
 *   ticketFooterLine?: string | null;
 *   orderChannel?: string | null;
 *   companyName?: string | null;
 * }} [printOptions]
 */
function buildTicketHtml(order, branchName, logoUrl, variant, printOptions = {}) {
	// El titulo grande del ticket cliente muestra el nombre de la EMPRESA
	// (companyName). La sucursal ya viaja en el prefijo `[Sucursal: X]` de
	// la nota; no queremos duplicarla. Si nadie pasa `companyName`, caemos al
	// `branchName` por compat con callers viejos.
	const companyNameRaw =
		printOptions.companyName != null ? String(printOptions.companyName).trim() : '';
	const headerName = companyNameRaw || branchName || 'NOMBRE DEL LOCAL';
	const safeBranchName = escapeHtml(headerName);
	const safeOrderId = escapeHtml(formatOrderNumberForTicket(order));
	const safeClientName = escapeHtml(order.client_name || 'Mostrador');
	// Misma limpieza que el ticket de cocina: descartamos los prefijos
	// `[Sucursal: ...]` y `[Envío: $...]` para que el cliente solo vea la nota
	// real escrita por el cajero. La sucursal aparece en el h1 y el envio en
	// la fila de totales.
	const safeOrderNote = order.note ? escapeHtml(stripInternalNoteHints(order.note)) : '';
	const dateTimeLine = escapeHtml(formatTicketDateTime(order));
	const logoMaxWidthMm = CONTENT_MM <= 50 ? 40 : 56;
	const logoMaxHeightMm = 13;
	const safeLogoUrl = variant === 'cashier' ? resolveSafeLogoUrl(logoUrl) : '';

	if (variant === 'kitchen') {
		// El ticket de cocina siempre lleva "COCINA" como destino del trabajo.
		// La info de fulfillment (Domicilio / En el local) ya no se muestra:
		// no es util para preparar el pedido y desordena la lectura rapida.
		const channelEsc = escapeHtml(orderChannelForTicket(order, printOptions.orderChannel));
		const orderBandLine = `#${safeOrderId} - COCINA - ${channelEsc}`;
		const refLineHtml = clientReferenceLineHtml(order);
		const dateDash = escapeHtml(formatTicketDateTimeDash(order));
		const safeKitchenNote = escapeHtml(stripInternalNoteHints(order.note));

		const itemsKitchen = (order.items || []).map((item) => {
			const safeQuantity = Number(item.quantity) || 1;
			const safeName = escapeHtml(String(item.name || '').toUpperCase());
			let extrasHtml = '';
			if (Array.isArray(item.extras) && item.extras.length > 0) {
				extrasHtml = item.extras.map((extra) => {
					const extraQty = Number(extra.quantity) || 1;
					const extraName = escapeHtml(String(extra.name || 'Extra').toUpperCase());
					return `<div class="k-extra">+ ${extraQty}x ${extraName}</div>`;
				}).join('');
			}
			// Comentario por item: solo se imprime en el ticket de cocina. Se
			// rendea en mayusculas y con marca "!! NOTA:" para que el cocinero
			// no se lo coma de un vistazo.
			const noteRaw = plainItemNote(item);
			const itemNoteHtml = noteRaw
				? `<div class="k-item-note">!! NOTA: ${escapeHtml(noteRaw.toUpperCase())}</div>`
				: '';
			return `
		<div class="k-item">
			<div class="k-line">X${safeQuantity} ${safeName}</div>
			${extrasHtml ? `<div class="k-extras-wrap">${extrasHtml}</div>` : ''}
			${itemNoteHtml}
		</div>`;
		}).join('');

		const footerRaw = printOptions.ticketFooterLine != null ? String(printOptions.ticketFooterLine).trim() : '';
		const footerKitchen = footerRaw || 'panel administrativo GodCode';
		const footerHtml = escapeHtml(footerKitchen);

		return `
		<html>
		<head>
			<meta charset="utf-8" />
			<title>Comanda cocina #${safeOrderId}</title>
			<style>
				${cssThermalBase(CONTENT_MM)}
				.k-band {
					text-align: center;
					padding: 2.5mm 0 3mm;
					border-top: 1px dashed #000;
					border-bottom: 1px dashed #000;
				}
				.k-band-time {
					font-size: 10pt;
					margin: 0 0 2.5mm;
				}
				.k-band-order {
					font-size: 12.5pt;
					margin: 0 0 2mm;
					letter-spacing: 0.02em;
				}
				.k-band-ref {
					font-size: 10pt;
					margin: 0;
					letter-spacing: 0.04em;
				}
				.k-list {
					margin-top: 0;
					padding-top: 2mm;
				}
				.k-item {
					padding: 2.5mm 0;
					border-bottom: 1px dashed #000;
					page-break-inside: avoid;
					color: #000;
				}
				.k-item:last-child { border-bottom: none; }
				.k-line {
					font-size: 11.5pt;
					word-break: break-word;
					text-transform: uppercase;
					letter-spacing: 0.03em;
					line-height: 1.3;
					color: #000;
				}
				.k-extras-wrap {
					margin-top: 1.5mm;
					margin-left: 1mm;
					padding-left: 2mm;
					border-left: 2px dashed #000;
					color: #000;
				}
				.k-extra {
					font-size: 9pt;
					margin: 0.8mm 0;
					word-break: break-word;
					text-transform: uppercase;
					line-height: 1.3;
				}
				/* Comentario por item ("sin cebolla", "salsa aparte"). Lo dejamos
				   con la misma jerarquia visual que las notas de pedido (k-note)
				   pero mas chico y atado al item, no al pedido completo. */
				.k-item-note {
					margin-top: 1.5mm;
					margin-left: 1mm;
					padding: 1mm 2mm;
					border: 1.5px solid #000;
					font-size: 9.5pt;
					font-weight: 700;
					line-height: 1.25;
					word-break: break-word;
					text-transform: uppercase;
				}
				.k-note {
					margin-top: 4mm;
					font-size: 10pt;
					border: 2px solid #000;
					padding: 2.5mm;
					text-align: center;
					line-height: 1.35;
				}
				.k-foot-block {
					margin-top: 4mm;
					text-align: center;
				}
				.k-rule-tight {
					margin: 0.6mm 0 !important;
					border-top: 1px dashed #000 !important;
				}
				.k-brand-foot {
					font-size: 9pt;
					margin: 2mm 0 0;
					line-height: 1.4;
				}
			</style>
		</head>
		<body>
			<div class="k-band">
				<p class="k-band-time">${dateDash}</p>
				<p class="k-band-order">${orderBandLine}</p>
				<p class="k-band-ref">${refLineHtml}</p>
			</div>
			<div class="k-list">${itemsKitchen}</div>
			${safeKitchenNote ? `<hr class="rule-dots" /><div class="k-note">NOTA: ${safeKitchenNote}</div>` : ''}
			<div class="k-foot-block">
				<hr class="rule-dots k-rule-tight" />
				<hr class="rule-dots k-rule-tight" />
				<p class="k-brand-foot">${footerHtml}</p>
			</div>
		</body>
		</html>`;
	}

	const rawAddr = printOptions.branchAddress != null ? String(printOptions.branchAddress).trim() : '';
	const addrParts = rawAddr ? rawAddr.split(/\n|,/).map((s) => s.trim()).filter(Boolean) : [];
	const addressHtml = addrParts.length
		? addrParts.map((line) => `<p class="c-address">${escapeHtml(line)}</p>`).join('')
		: '';

	const whereLblEsc = escapeHtml(whereLabelForClientTicket(order));
	const channelEsc = escapeHtml(orderChannelForTicket(order, printOptions.orderChannel));
	const orderBandLine = `#${safeOrderId} - ${whereLblEsc} - ${channelEsc}`;
	const refLineHtml = clientReferenceLineHtml(order);
	const { itemsSubtotal, deliveryFee, grandTotal } = summarizeAmounts(order);
	const payStatusEsc = escapeHtml(ticketPaymentStatusLabel(order));
	const totalPlain = Math.round(Number(grandTotal) || 0).toLocaleString('es-CL');
	const payDetailLine = escapeHtml(`${getPaymentLabel(order)} ${totalPlain}`);

	const footerRaw = printOptions.ticketFooterLine != null ? String(printOptions.ticketFooterLine).trim() : '';
	const footerLine = footerRaw || 'panel administrativo GodCode';
	const footerHtml = escapeHtml(footerLine);

	const itemsHtml = (order.items || []).map((item) => {
		const price = (item.has_discount && item.discount_price > 0)
			? Number(item.discount_price)
			: Number(item.price);

		const lineTotal = price * (item.quantity || 1);
		const safeQuantity = Number(item.quantity) || 1;
		const safeName = escapeHtml(String(item.name || '').toUpperCase());
		const safeDescription = item.description ? escapeHtml(String(item.description).toUpperCase()) : '';
		const leftCol = `X${safeQuantity} ${safeName}`;

		let extrasHtml = '';
		if (Array.isArray(item.extras) && item.extras.length > 0) {
			extrasHtml = item.extras.map((extra) => {
				const extraQty = Number(extra.quantity) || 1;
				const extraPrice = Number(extra.price) || 0;
				const extraLineTotal = extraPrice * extraQty;
				const extraName = escapeHtml(String(extra.name || 'Extra').toUpperCase());
				return `
			<div class="c-item c-item-extra">
				<div class="c-row">
					<span class="c-line-text">+ ${extraQty}x ${extraName}</span>
					<span class="c-price">${formatCurrency(extraLineTotal)}</span>
				</div>
			</div>
			`;
			}).join('');
		}

		// Comentario por item: tambien aparece en el ticket de caja para que el
		// cliente vea que su pedido especial quedo registrado. Se rendea con
		// "NOTA: ..." debajo del nombre, sin borde fuerte (no es para cocina).
		const noteRaw = plainItemNote(item);
		const itemNoteHtml = noteRaw
			? `<div class="c-item-note">NOTA: ${escapeHtml(noteRaw.toUpperCase())}</div>`
			: '';

		return `
		<div class="c-item">
			<div class="c-row">
				<span class="c-line-text">${leftCol}</span>
				<span class="c-price">${formatCurrency(lineTotal)}</span>
			</div>
			${itemNoteHtml}
		</div>
		${extrasHtml}
	`;
	}).join('');

	const deliveryFeeRow =
		isOrderDelivery(order) && deliveryFee > 0
			? `<div class="c-money-row"><span>Envío</span><span>${formatCurrency(deliveryFee)}</span></div>`
			: isOrderDelivery(order)
				? `<div class="c-money-row"><span>Envío</span><span>GRATIS</span></div>`
				: '';

	return `
		<html>
		<head>
			<meta charset="utf-8" />
			<title>Ticket cliente #${safeOrderId}</title>
			<style>
				${cssThermalBase(CONTENT_MM)}
				.c-head {
					text-align: center;
					margin-bottom: 2mm;
					padding-bottom: 2mm;
				}
				.c-logo {
					max-width: ${logoMaxWidthMm}mm;
					max-height: ${logoMaxHeightMm}mm;
					width: auto;
					height: auto;
					display: block;
					margin: 0 auto 2mm;
					object-fit: contain;
					image-rendering: auto;
					filter: contrast(1.2);
				}
				.c-brand {
					font-size: 17pt;
					margin: 0 0 2mm;
					text-transform: uppercase;
					line-height: 1.15;
				}
				.c-address {
					font-size: 9pt;
					margin: 0 0 1.5mm;
					line-height: 1.35;
					text-transform: none;
				}
				.c-delivery-box {
					margin: 2mm 0 3mm;
					padding: 2.5mm 2mm;
					border: 2px dashed #000;
					text-align: center;
				}
				.c-delivery-heading {
					margin: 0 0 1.5mm;
					font-size: 11pt;
					font-weight: 800;
					letter-spacing: 0.05em;
					text-transform: uppercase;
				}
				.c-delivery-meta {
					margin: 0 0 1mm;
					font-size: 9pt;
					text-transform: none;
				}
				.c-delivery-line {
					margin: 0.9mm 0 0;
					font-size: 9pt;
					line-height: 1.35;
					word-break: break-word;
					text-transform: none;
				}
				.c-band {
					margin-top: 2mm;
					padding: 2.5mm 0;
					text-align: center;
					border-top: 1px dashed #000;
					border-bottom: 1px dashed #000;
				}
				.c-band-time {
					font-size: 10pt;
					margin: 0 0 2mm;
				}
				.c-band-order {
					font-size: 12.5pt;
					margin: 0 0 2mm;
					letter-spacing: 0.02em;
				}
				.c-band-ref {
					font-size: 10pt;
					margin: 0;
					letter-spacing: 0.04em;
				}
				.c-client-name {
					font-size: 11pt;
					margin: 3mm 0 0;
					text-align: center;
					text-transform: none;
				}
				.c-items {
					margin-top: 2mm;
					padding-top: 2mm;
					border-top: 1px dashed #000;
				}
				.c-item {
					margin-bottom: 2.5mm;
					padding-bottom: 2mm;
					border-bottom: 1px dashed #000;
					page-break-inside: avoid;
				}
				.c-item:last-child { border-bottom: none; }
				.c-row {
					display: flex;
					justify-content: space-between;
					align-items: flex-start;
					gap: 2mm;
					font-size: 10.5pt;
				}
				.c-line-text {
					flex: 1;
					word-break: break-word;
					text-transform: uppercase;
					letter-spacing: 0.02em;
					line-height: 1.3;
				}
				.c-price {
					white-space: nowrap;
					flex-shrink: 0;
					font-size: 10.5pt;
				}
				.c-detail {
					font-size: 9.5pt;
					margin: 1.5mm 0 0 3mm;
					padding-left: 2mm;
					border-left: 3px solid #000;
					word-break: break-word;
					line-height: 1.35;
					text-transform: uppercase;
				}
				.c-item-extra {
					opacity: 0.85;
				}
				.c-item-extra .c-row {
					padding-left: 2mm;
					border-left: 2px dashed #000;
				}
				.c-item-extra .c-line-text {
					font-size: 9.5pt;
				}
				/* Comentario por item en el ticket de caja: linea discreta debajo
				   del nombre, sin borde fuerte (el cliente solo necesita ver que
				   su pedido especial quedo registrado). */
				.c-item-note {
					margin-top: 1mm;
					padding-left: 2mm;
					font-size: 9pt;
					font-weight: 600;
					line-height: 1.25;
					word-break: break-word;
					text-transform: uppercase;
				}
				.c-money-block {
					margin-top: 2mm;
					padding-top: 2mm;
					border-top: 1px dashed #000;
				}
				.c-money-row {
					display: flex;
					justify-content: space-between;
					align-items: baseline;
					font-size: 10.5pt;
					margin: 0 0 1.5mm;
				}
				.c-total-big {
					display: flex;
					justify-content: space-between;
					align-items: baseline;
					margin-top: 2mm;
					padding-top: 2mm;
					border-top: 2px solid #000;
					font-size: 13pt;
				}
				.c-legal {
					font-size: 8.5pt;
					margin: 2.5mm 0 0;
					text-align: center;
					line-height: 1.35;
					text-transform: none;
				}
				.c-pay-block {
					margin-top: 3mm;
					padding-top: 2mm;
					border-top: 1px dashed #000;
				}
				.c-pay-row {
					font-size: 10pt;
					margin: 0 0 1.5mm;
				}
				.c-pay-strong {
					display: flex;
					justify-content: space-between;
					align-items: baseline;
					font-size: 11pt;
					margin-top: 2mm;
				}
				.c-pay-detail {
					font-size: 9.5pt;
					margin-top: 2mm;
					text-transform: none;
				}
				.c-note {
					margin-top: 3mm;
					font-size: 10pt;
					border: 2px solid #000;
					padding: 2.5mm;
					text-align: center;
					line-height: 1.35;
				}
				.c-foot {
					text-align: center;
					margin-top: 4mm;
					padding-top: 2mm;
					border-top: 1px dashed #000;
					font-size: 9pt;
					line-height: 1.4;
					text-transform: none;
				}
			</style>
		</head>
		<body>
			<div class="c-head">
				${safeLogoUrl ? `<img src="${safeLogoUrl}" class="c-logo" alt="" />` : ''}
				<h1 class="ticket-brand c-brand">${safeBranchName}</h1>
				${addressHtml}
			</div>
			<div class="c-band">
				<p class="c-band-time">${dateTimeLine}</p>
				<p class="c-band-order">${orderBandLine}</p>
				<p class="c-band-ref">${refLineHtml}</p>
			</div>
			${deliveryShipmentSectionHtml(order)}
			<p class="c-client-name">${safeClientName}</p>
			<div class="c-items">${itemsHtml}</div>
			<div class="c-money-block">
				<div class="c-money-row"><span>Subtotal</span><span>${formatCurrency(itemsSubtotal)}</span></div>
				${deliveryFeeRow}
				<div class="c-total-big"><span>Total</span><span>${formatCurrency(grandTotal)}</span></div>
				<p class="c-legal">Este documento no tiene valor fiscal.</p>
			</div>
			<div class="c-pay-block">
				<p class="c-pay-row">Estado de pago: ${payStatusEsc}</p>
				<div class="c-pay-strong"><span>Total a pagar</span><span>${formatCurrency(grandTotal)}</span></div>
				<p class="c-pay-detail">${payDetailLine}</p>
			</div>
			${safeOrderNote ? `<div class="c-note">NOTA: ${safeOrderNote}</div>` : ''}
			<div class="c-foot">${footerHtml}</div>
		</body>
		</html>
	`;
}

function schedulePrintAfterLoad(printWindow, hasLogo) {
	const runPrint = () => {
		printWindow.print();
		printWindow.close();
	};
	if (hasLogo) {
		const img = printWindow.document.querySelector('.c-logo');
		if (img) {
			if (img.complete && img.naturalWidth > 0) {
				setTimeout(runPrint, 100);
			} else {
				const timeout = setTimeout(runPrint, 2000);
				img.onload = () => {
					clearTimeout(timeout);
					setTimeout(runPrint, 150);
				};
				img.onerror = () => {
					clearTimeout(timeout);
					setTimeout(runPrint, 150);
				};
			}
		} else {
			setTimeout(runPrint, 400);
		}
	} else {
		setTimeout(runPrint, 300);
	}
}

/**
 * @param {Record<string, unknown>} order
 * @param {string} [branchName]
 * @param {string | null} [logoUrl]
 * @param {{
 *   variant?: TicketVariant;
 *   branchAddress?: string | null;
 *   ticketFooterLine?: string | null;
 *   orderChannel?: string | null;
 *   companyName?: string | null;
 * }} [options]
 */
export const printOrderTicket = (order, branchName = 'NOMBRE DEL LOCAL', logoUrl = null, options = {}) => {
	const variant = options.variant === 'kitchen' ? 'kitchen' : 'cashier';
	const previewWindowWidth = 520;
	const printWindow = window.open('', '', `width=${previewWindowWidth},height=700`);
	if (!printWindow) {
		return;
	}

	const html = buildTicketHtml(order, branchName, logoUrl, variant, options);
	const hasLogo = variant === 'cashier' && Boolean(resolveSafeLogoUrl(logoUrl));

	printWindow.document.write(html);
	printWindow.document.close();
	schedulePrintAfterLoad(printWindow, hasLogo);
};
