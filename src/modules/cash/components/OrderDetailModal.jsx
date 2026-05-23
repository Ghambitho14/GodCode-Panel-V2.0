import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
    X,
    KeyRound,
    MapPin,
    Store,
    Truck,
    ChefHat,
    Banknote,
    Copy,
    Send,
    ImageIcon,
    ExternalLink,
} from 'lucide-react';
import { formatCurrency } from '@/shared/utils/formatters';
import {
    getPaymentLabel,
    isOrderDelivery,
    deliveryAddressLines,
    buildOrderWhatsAppShareText,
    buildOrderDeliveryDriverPack,
    shareDeliveryPackViaWhatsApp,
} from '@/shared/utils/orderUtils';
import { printOrderTicket } from '@/modules/cash/admin/utils/receiptPrinting';

const STATUS_LABELS = {
    pending: 'Pendiente',
    active: 'En cocina',
    completed: 'Listo',
    picked_up: 'Entregado',
    cancelled: 'Cancelado',
};

function fmt(n) {
    try {
        return formatCurrency(n);
    } catch {
        return `$${(n || 0).toLocaleString('es-CL')}`;
    }
}

function orderTitle(order) {
    const idPart = order?.display_id ?? order?.order_number ?? order?.id;
    if (idPart != null && idPart !== '') return `Pedido ${idPart}`;
    return 'Pedido';
}

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

/** Filas etiquetadas para mostrar dirección sin un solo bloque ilegible. */
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

const OrderDetailModal = ({
    order,
    onClose,
    branch = null,
    logoUrl = null,
    companyName = null,
    showNotify,
    setReceiptModalOrder,
}) => {
    useEffect(() => {
        if (!order) return;
        const onEsc = (e) => {
            if (e.key === 'Escape') onClose?.();
        };
        window.addEventListener('keydown', onEsc);
        return () => window.removeEventListener('keydown', onEsc);
    }, [order, onClose]);

    if (!order || typeof document === 'undefined') return null;

    const items = parseItems(order.items);
    const isDelivery = isOrderDelivery(order);
    const addrLines = deliveryAddressLines(order.delivery_address);
    const addrObj =
        order.delivery_address && typeof order.delivery_address === 'object' && !Array.isArray(order.delivery_address)
            ? order.delivery_address
            : null;
    const mapsUrl = addrObj?.maps_url ? String(addrObj.maps_url).trim() : '';
    const handoff =
        order.handoff_code != null && String(order.handoff_code).trim() !== ''
            ? String(order.handoff_code).trim()
            : '';
    const deliveryFee = Number(order.delivery_fee) || 0;
    const couponCode = order.coupon_code ? String(order.coupon_code).trim() : '';
    const addressRows = structuredAddressRows(addrObj, addrLines);
    const createdAt = new Date(order.created_at);

    const ticketPrintOpts = (variant) => ({
        variant,
        branchAddress: branch?.address ?? null,
        companyName: companyName ?? null,
    });

    const handleCopyShare = async () => {
        const text = buildOrderWhatsAppShareText(order, branch?.name);
        try {
            await navigator.clipboard.writeText(text);
            showNotify?.('Resumen del pedido copiado.', 'success');
        } catch {
            showNotify?.('No se pudo copiar el resumen.', 'error');
        }
    };

    const handleDeliveryWhatsApp = async () => {
        const text = buildOrderDeliveryDriverPack(order, branch?.name ?? null, branch?.address ?? null);
        await shareDeliveryPackViaWhatsApp(text, {
            onError: (msg) => showNotify?.(msg, 'error'),
        });
    };

    const modal = (
        <div
            className="admin-layout order-detail-overlay"
            onClick={onClose}
            role="presentation"
        >
            <div
                className="order-detail-panel"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="order-detail-title"
            >
                <div className="order-detail-head">
                    <div className="order-detail-head-text">
                        <p className="order-detail-eyebrow">Todo el detalle del pedido</p>
                        <h2 id="order-detail-title" className="order-detail-title">
                            {orderTitle(order)}
                        </h2>
                    </div>
                    <button type="button" className="order-detail-close" onClick={onClose} aria-label="Cerrar detalle">
                        <X size={22} strokeWidth={2} />
                    </button>
                </div>

                <div className="order-detail-body">
                    <div className="order-detail-meta-grid">
                        <div className="order-detail-card">
                            <span className="order-detail-label">Estado y pago</span>
                            <div className="order-detail-card-main">
                                <p className="order-detail-value">
                                    {STATUS_LABELS[order.status] || order.status || '—'}
                                    <span className="order-detail-value-sep">·</span>
                                    {getPaymentLabel(order)}
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
                                <p className="order-detail-value">{order.client_name || 'Sin nombre'}</p>
                                <ul className="order-detail-facts">
                                    {order.client_phone ? <li>{order.client_phone}</li> : null}
                                    {order.client_rut && String(order.client_rut).trim() ? (
                                        <li>RUT {String(order.client_rut).trim()}</li>
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
                                        {Array.isArray(item.extras) && item.extras.length > 0 ? (
                                            <div className="order-detail-item-desc">
                                                {item.extras.map((ex, exIdx) => (
                                                    <div key={exIdx}>
                                                        + {ex.quantity || 1}x {ex.name}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : null}
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

                    {couponCode ? (
                        <div className="order-detail-section">
                            <span className="order-detail-label">Cupón</span>
                            <p className="order-detail-value">{couponCode}</p>
                        </div>
                    ) : null}

                    {order.note && String(order.note).trim() ? (
                        <div className="order-detail-section">
                            <span className="order-detail-label">Nota del pedido</span>
                            <p className="order-detail-note">{String(order.note).trim()}</p>
                        </div>
                    ) : null}

                    <div className="order-detail-total-row">
                        <span className="order-detail-label order-detail-label--inline">Total</span>
                        <span className="order-detail-total">{fmt(order.total || 0)}</span>
                    </div>

                    {order.payment_type === 'online' && order.payment_ref && String(order.payment_ref).startsWith('http') ? (
                        <div className="order-detail-section">
                            <span className="order-detail-label">Comprobante</span>
                            <a
                                href={order.payment_ref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="order-detail-ticket-btn order-detail-receipt-link"
                            >
                                <ImageIcon size={18} aria-hidden />
                                Ver comprobante
                            </a>
                        </div>
                    ) : null}

                    <div className="order-detail-section">
                        <span className="order-detail-label">Acciones</span>
                        <div className="order-detail-ticket-actions">
                            <button
                                type="button"
                                className="order-detail-ticket-btn order-detail-ticket-btn--primary"
                                onClick={() => {
                                    printOrderTicket(order, branch?.name, logoUrl ?? null, ticketPrintOpts('kitchen'));
                                }}
                            >
                                <ChefHat size={18} aria-hidden />
                                Ticket cocina
                            </button>
                            <button
                                type="button"
                                className="order-detail-ticket-btn"
                                onClick={() => {
                                    printOrderTicket(order, branch?.name, logoUrl ?? null, ticketPrintOpts('cashier'));
                                }}
                            >
                                <Banknote size={18} aria-hidden />
                                Ticket caja
                            </button>
                            <button type="button" className="order-detail-ticket-btn" onClick={() => void handleCopyShare()}>
                                <Copy size={18} aria-hidden />
                                Copiar resumen
                            </button>
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
                            {order.payment_type === 'online' && setReceiptModalOrder ? (
                                <button
                                    type="button"
                                    className="order-detail-ticket-btn"
                                    onClick={() => {
                                        setReceiptModalOrder(order);
                                        onClose?.();
                                    }}
                                >
                                    <ImageIcon size={18} aria-hidden />
                                    {order.payment_ref ? 'Cambiar comprobante' : 'Subir comprobante'}
                                </button>
                            ) : null}
                        </div>
                    </div>
                </div>

                <div className="order-detail-foot">
                    <button type="button" className="admin-btn primary order-detail-done" onClick={onClose}>
                        Cerrar
                    </button>
                </div>
            </div>
        </div>
    );

    return createPortal(modal, document.body);
};

export default OrderDetailModal;
