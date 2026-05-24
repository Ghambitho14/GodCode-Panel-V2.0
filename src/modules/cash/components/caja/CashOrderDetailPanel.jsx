import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
	X, KeyRound, MapPin, Truck, Store, Send, ExternalLink, ChefHat, Banknote, Phone,
} from 'lucide-react';
import { supabase, TABLES } from '@/integrations/supabase';
import { formatCurrency } from '@/shared/utils/formatters';
import { useLockBodyScroll } from '@/shared/hooks/useLockBodyScroll';
import {
	getPaymentLabel,
	isOrderDelivery,
	deliveryAddressLines,
	buildOrderDeliveryDriverPack,
	shareDeliveryPackViaWhatsApp,
	sanitizeOrder,
} from '@/shared/utils/orderUtils';
import { printOrderTicket } from '@/modules/cash/admin/utils/receiptPrinting';
import { buildWhatsAppUrl, normalizePhoneDigits, WhatsAppGlyph } from '@/shared/utils/phoneWhatsApp';
import '@/modules/cash/styles/OrderCard.css';
import './CashOrderDetailPanel.css';

const fmt = (n) => {
	try {
		return formatCurrency(n);
	} catch {
		return `$${(n || 0).toLocaleString('es-CL')}`;
	}
};

const STATUS_LABELS = {
	pending: 'Pendiente',
	active: 'En cocina',
	completed: 'Listo',
	picked_up: 'Entregado',
	cancelled: 'Cancelado',
};

const ADDRESS_FIELD_LABELS = [
	['named_area_label', 'Zona'],
	['zone_label', 'Zona'],
	['formatted_address', 'Dirección'],
	['label', 'Etiqueta'],
	['address', 'Dirección'],
	['street', 'Calle'],
	['line1', 'Dirección'],
	['line_1', 'Dirección'],
	['street_detail', 'Detalle'],
	['reference', 'Referencia'],
	['referencia', 'Referencia'],
	['description', 'Indicaciones'],
	['comuna', 'Comuna'],
	['commune', 'Comuna'],
	['city', 'Ciudad'],
	['ciudad', 'Ciudad'],
];

function parseItems(raw) {
	if (Array.isArray(raw)) return raw;
	if (typeof raw === 'string') {
		try {
			const p = JSON.parse(raw);
			return Array.isArray(p) ? p : [];
		} catch {
			return [];
		}
	}
	return [];
}

function structuredAddressRows(addr, fallbackLines = []) {
	if (!addr || typeof addr !== 'object' || Array.isArray(addr)) {
		return fallbackLines.map((value, i) => ({
			key: `line-${i}`,
			label: i === 0 ? 'Dirección' : 'Detalle',
			value,
		}));
	}
	const rows = [];
	const seenValues = new Set();
	for (const [field, label] of ADDRESS_FIELD_LABELS) {
		const raw = addr[field];
		if (raw == null) continue;
		const value = String(raw).trim();
		if (!value) continue;
		const dedupe = value.toLowerCase();
		if (seenValues.has(dedupe)) continue;
		seenValues.add(dedupe);
		rows.push({ key: field, label, value });
	}
	if (rows.length > 0) return rows;
	return fallbackLines.map((value, i) => ({
		key: `fallback-${i}`,
		label: i === 0 ? 'Dirección' : 'Detalle',
		value,
	}));
}

/** Separa prefijo [Sucursal: …] del cuerpo de la nota del pedido. */
function splitOrderNote(note) {
	const text = String(note ?? '').trim();
	if (!text) return { branchLine: null, body: '' };
	const match = text.match(/^\[Sucursal:\s*([^\]]+)\]\s*\n?(.*)$/s);
	if (match) {
		return { branchLine: match[1].trim(), body: match[2].trim() };
	}
	return { branchLine: null, body: text };
}

function buildTelHref(phone) {
	const digits = normalizePhoneDigits(phone);
	if (!digits) return null;
	const withCountry = digits.startsWith('56') ? digits : `56${digits}`;
	return `tel:+${withCountry}`;
}

export default function CashOrderDetailPanel({
	order,
	onClose,
	branch = null,
	showNotify,
	logoUrl = null,
	companyName = null,
}) {
	const [liveOrder, setLiveOrder] = useState(order);
	const [refreshingOrder, setRefreshingOrder] = useState(false);

	useLockBodyScroll(Boolean(order));

	useEffect(() => {
		if (!order?.id) {
			setLiveOrder(null);
			return;
		}
		setLiveOrder(order);
		let cancelled = false;
		setRefreshingOrder(true);
		(async () => {
			try {
				const { data, error } = await supabase
					.from(TABLES.orders)
					.select('*')
					.eq('id', order.id)
					.maybeSingle();
				if (cancelled) return;
				if (error) throw error;
				if (data) setLiveOrder(sanitizeOrder(data));
			} catch {
				/* conservar snapshot del movimiento */
			} finally {
				if (!cancelled) setRefreshingOrder(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [order?.id]);

	useEffect(() => {
		const onEsc = (e) => {
			if (e.key === 'Escape') onClose();
		};
		if (order) window.addEventListener('keydown', onEsc);
		return () => window.removeEventListener('keydown', onEsc);
	}, [order, onClose]);

	if (!order || typeof document === 'undefined') return null;

	const displayOrder = liveOrder ?? order;
	const items = parseItems(displayOrder.items);
	const isDelivery = isOrderDelivery(displayOrder);
	const deliveryFee = Number(displayOrder.delivery_fee) || 0;
	const addrLines = deliveryAddressLines(displayOrder.delivery_address);
	const addrObj =
		displayOrder.delivery_address && typeof displayOrder.delivery_address === 'object' && !Array.isArray(displayOrder.delivery_address)
			? displayOrder.delivery_address
			: null;
	const mapsUrl = addrObj?.maps_url ? String(addrObj.maps_url).trim() : '';
	const handoff =
		displayOrder.handoff_code != null && String(displayOrder.handoff_code).trim() !== ''
			? String(displayOrder.handoff_code).trim()
			: '';
	const addressRows = structuredAddressRows(addrObj, addrLines);
	const createdAt = new Date(displayOrder.created_at);
	const { branchLine: noteBranchLine, body: noteBody } = splitOrderNote(displayOrder.note);
	const hasNote = Boolean(noteBranchLine || noteBody);
	const clientPhone = displayOrder.client_phone ? String(displayOrder.client_phone).trim() : '';
	const telHref = clientPhone ? buildTelHref(clientPhone) : null;
	const whatsAppHref = clientPhone ? buildWhatsAppUrl(clientPhone) : null;

	const ticketPrintOpts = (variant) => ({
		variant,
		branchAddress: branch?.address ?? null,
		companyName: companyName ?? null,
	});

	const handleDeliveryWhatsApp = async () => {
		const text = buildOrderDeliveryDriverPack(
			displayOrder,
			branch?.name ?? null,
			branch?.address ?? null,
		);
		await shareDeliveryPackViaWhatsApp(text, {
			onError: (msg) => showNotify?.(msg, 'error'),
		});
	};

	const panel = (
		<div
			className="admin-layout order-detail-overlay cash-order-detail-overlay"
			onClick={onClose}
			role="presentation"
		>
			<div
				className="order-detail-panel cash-order-detail-drawer"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby="cash-order-detail-title"
			>
				<div className="order-detail-head">
					<div className="order-detail-head-text">
						<p className="order-detail-eyebrow">Detalle del pedido</p>
						<h2 id="cash-order-detail-title" className="order-detail-title">
							Pedido #{String(displayOrder.id).slice(-4)}
						</h2>
					</div>
					<button
						type="button"
						className="order-detail-close"
						onClick={onClose}
						aria-label="Cerrar"
					>
						<X size={22} strokeWidth={2} />
					</button>
				</div>

				<div className="order-detail-body">
					<div className="order-detail-meta-grid">
						<div className="order-detail-card">
							<span className="order-detail-label">Estado y pago</span>
							<div className="order-detail-card-main">
								<p className="order-detail-value">
									{STATUS_LABELS[displayOrder.status] || displayOrder.status || '—'}
									<span className="order-detail-value-sep">·</span>
									{getPaymentLabel(displayOrder)}
									{refreshingOrder ? (
										<span className="order-detail-muted cash-order-detail-status-sync"> · actualizando…</span>
									) : null}
								</p>
								<ul className="order-detail-facts">
									<li>{createdAt.toLocaleString('es-CL')}</li>
									{branch?.name ? <li>{branch.name}</li> : null}
								</ul>
							</div>
							<div className="order-detail-card-foot" aria-hidden />
						</div>

						<div className="order-detail-card">
							<span className="order-detail-label">Cliente</span>
							<div className="order-detail-card-main">
								<p className="order-detail-value">{displayOrder.client_name || 'Sin nombre'}</p>
								<ul className="order-detail-facts">
									{clientPhone ? (
										<li className="cash-order-detail-phone-row">
											<a href={telHref || undefined} className="cash-order-detail-phone-link">
												<Phone size={14} aria-hidden />
												{clientPhone}
											</a>
											{whatsAppHref ? (
												<a
													href={whatsAppHref}
													target="_blank"
													rel="noopener noreferrer"
													className="cash-order-detail-wa-btn"
													title="Abrir WhatsApp con el cliente"
													aria-label="Abrir WhatsApp con el cliente"
												>
													<WhatsAppGlyph className="cash-order-detail-wa-glyph" />
												</a>
											) : null}
										</li>
									) : null}
									{displayOrder.client_rut && String(displayOrder.client_rut).trim() ? (
										<li>RUT {String(displayOrder.client_rut).trim()}</li>
									) : null}
								</ul>
							</div>
							<div className="order-detail-card-foot" aria-hidden />
						</div>

						<div className="order-detail-card">
							<span className="order-detail-label">Entrega</span>
							<div className="order-detail-card-main">
								<div
									className={`order-detail-fulfillment ${isDelivery ? 'is-delivery' : 'is-pickup'}`}
								>
									{isDelivery ? <Truck size={18} aria-hidden /> : <Store size={18} aria-hidden />}
									{isDelivery ? 'Delivery' : 'Retiro en local'}
								</div>
							</div>
							<div className="order-detail-card-foot">
								<span className="order-detail-kv-label">Cargo envío</span>
								<span className="order-detail-kv-value">
									{isDelivery && deliveryFee > 0 ? fmt(deliveryFee) : '—'}
								</span>
							</div>
						</div>
					</div>

					{handoff ? (
						<div className="order-detail-section order-detail-handoff-block">
							<span className="order-detail-label">Código de verificación</span>
							<div className="order-detail-handoff-code">
								<KeyRound size={18} className="order-detail-handoff-icon" aria-hidden />
								<span className="order-detail-handoff-digits">{handoff}</span>
							</div>
							<p className="order-detail-handoff-hint order-detail-muted">
								Pedir este código al cliente al entregar.
							</p>
						</div>
					) : null}

					{isDelivery && addressRows.length > 0 ? (
						<div className="order-detail-section order-detail-block order-detail-block--address">
							<span className="order-detail-label">Dirección de envío</span>
							<dl className="order-detail-address-grid">
								{addressRows.map((row) => (
									<div key={row.key} className="order-detail-address-row">
										<dt>{row.label}</dt>
										<dd>{row.value}</dd>
									</div>
								))}
							</dl>
							{mapsUrl ? (
								<a
									href={mapsUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="order-detail-ticket-btn order-detail-maps-link"
								>
									<MapPin size={18} aria-hidden />
									Abrir en mapas
									<ExternalLink size={14} aria-hidden className="order-detail-link-icon" />
								</a>
							) : null}
						</div>
					) : null}

					<div className="order-detail-section order-detail-products">
						<span className="order-detail-label">Productos ({items.length})</span>
						<ul className="order-detail-items">
							{items.map((item, i) => {
								const q = Number(item.quantity) || 1;
								const unit =
									Number(
										item.has_discount && item.discount_price != null
											? item.discount_price
											: item.price,
									) || 0;
								const itemNote = typeof item.note === 'string' ? item.note.trim() : '';
								return (
									<li key={`${item.id ?? i}-${i}`} className="order-detail-item-row">
										<div className="order-detail-item-main">
											<span className="order-detail-item-qty">{q}x</span>
											<span className="order-detail-item-name">{item.name || 'Producto'}</span>
										</div>
										<span className="order-detail-item-price">{fmt(q * unit)}</span>
										{itemNote ? (
											<div className="order-detail-item-desc order-detail-item-note">
												Nota: {itemNote}
											</div>
										) : null}
									</li>
								);
							})}
						</ul>
					</div>

					{hasNote ? (
						<div className="order-detail-section">
							<span className="order-detail-label">Nota del pedido</span>
							{noteBranchLine ? (
								<p className="order-detail-muted cash-order-detail-note-branch">
									Sucursal: {noteBranchLine}
								</p>
							) : null}
							{noteBody ? <p className="order-detail-note">{noteBody}</p> : null}
						</div>
					) : null}

					<div className="order-detail-section">
						<span className="order-detail-label">Acciones</span>
						<div className="order-detail-ticket-actions">
							<button
								type="button"
								className="order-detail-ticket-btn order-detail-ticket-btn--primary"
								onClick={() => {
									printOrderTicket(displayOrder, branch?.name, logoUrl ?? null, ticketPrintOpts('kitchen'));
								}}
							>
								<ChefHat size={18} aria-hidden />
								Ticket cocina
							</button>
							<button
								type="button"
								className="order-detail-ticket-btn"
								onClick={() => {
									printOrderTicket(displayOrder, branch?.name, logoUrl ?? null, ticketPrintOpts('cashier'));
								}}
							>
								<Banknote size={18} aria-hidden />
								Ticket caja
							</button>
							{telHref ? (
								<a href={telHref} className="order-detail-ticket-btn">
									<Phone size={18} aria-hidden />
									Llamar cliente
								</a>
							) : null}
							{whatsAppHref ? (
								<a
									href={whatsAppHref}
									target="_blank"
									rel="noopener noreferrer"
									className="order-detail-ticket-btn"
								>
									<WhatsAppGlyph className="cash-order-detail-wa-glyph cash-order-detail-wa-glyph--btn" />
									WhatsApp cliente
								</a>
							) : null}
							{isDelivery && mapsUrl ? (
								<a
									href={mapsUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="order-detail-ticket-btn"
								>
									<MapPin size={18} aria-hidden />
									Abrir en mapas
								</a>
							) : null}
							{isDelivery ? (
								<button
									type="button"
									className="order-detail-ticket-btn"
									onClick={() => void handleDeliveryWhatsApp()}
								>
									<Send size={18} aria-hidden />
									WhatsApp envío
								</button>
							) : null}
						</div>
					</div>
				</div>

				<div className="order-detail-foot cash-order-detail-foot">
					<div className="order-detail-total-row cash-order-detail-total-row">
						<span className="order-detail-label order-detail-label--inline">Total</span>
						<span className="order-detail-total">{fmt(displayOrder.total || 0)}</span>
					</div>
					<button type="button" className="admin-btn primary order-detail-done" onClick={onClose}>
						Cerrar
					</button>
				</div>
			</div>
		</div>
	);

	return createPortal(panel, document.body);
}
