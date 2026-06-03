import React, { useState, useRef, useMemo } from 'react';
import {
    Clock, XCircle, Upload, ImageIcon, Printer, Edit2, Copy, Send,
    ChefHat, Banknote, Eye, ChevronDown, ChevronUp,
} from 'lucide-react';
import OrderDetailModal from './OrderDetailModal';
import { formatTimeElapsed } from '@/shared/utils/formatters';
import {
    buildOrderWhatsAppShareText,
    buildOrderDeliveryDriverPack,
    shareDeliveryPackViaWhatsApp,
    getPaymentLabel,
    getOrderCouponDiscountMeta,
    isOrderDelivery,
    orderDeliveryKanbanSubtitle,
} from '@/shared/utils/orderUtils';
import { printOrderTicket } from '@/modules/cash/admin/utils/receiptPrinting';
import ManualOrderModal from './ManualOrderModal';
import OrderEditMenu from './manual-order/OrderEditMenu';
import OrderCardAnchoredMenu from './OrderCardAnchoredMenu';

function buildItemsSummary(items) {
    const list = Array.isArray(items) ? items : [];
    const count = list.length;
    if (count === 0) return { count: 0, text: 'Sin productos' };
    const preview = list
        .slice(0, 2)
        .map((item) => `${item.quantity ?? 1}x ${item.name ?? 'Producto'}`)
        .join(', ');
    const suffix = count > 2 ? '…' : '';
    return {
        count,
        text: `${count} producto${count === 1 ? '' : 's'} · ${preview}${suffix}`,
    };
}

const OrderCard = ({
    order, queueIndex, moveOrder, setReceiptModalOrder, branch, clients,
    logoUrl, companyName, showNotify, products, categories, onOrderSaved,
    gridTile = false,
}) => {
    const [editMenuOpen, setEditMenuOpen] = useState(false);
    const [editWizardOpen, setEditWizardOpen] = useState(false);
    const [editInitialStep, setEditInitialStep] = useState(1);
    const [ticketMenuOpen, setTicketMenuOpen] = useState(false);
    const [detailOpen, setDetailOpen] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const ticketMenuRef = useRef(null);
    const editMenuRef = useRef(null);
    const isDelivery = isOrderDelivery(order);
    const deliverySubtitle = isDelivery ? orderDeliveryKanbanSubtitle(order) : '';

    const ticketPrintOpts = (variant) => ({
        variant,
        branchAddress: branch?.address ?? null,
        companyName: companyName ?? null,
    });

    const menuOpen = editMenuOpen || ticketMenuOpen;

    const handleMoveToKitchen = (e) => {
        e.stopPropagation();
        printOrderTicket(order, branch?.name, logoUrl ?? null, ticketPrintOpts('kitchen'));
        moveOrder(order.id, 'active');
    };

    const handleCancelOrder = (e) => {
        e?.stopPropagation?.();
        const refundNote = '\n\nSi el pedido tiene venta registrada en caja, se aplicará una devolución automática.';
        const ok = typeof window !== 'undefined'
            ? window.confirm(`¿Cancelar pedido #${String(order.id).slice(-4)}?${refundNote}`)
            : true;
        if (!ok) return;
        moveOrder(order.id, 'cancelled');
    };

    const printKitchenAgain = (e) => {
        e.stopPropagation();
        printOrderTicket(order, branch?.name, logoUrl ?? null, ticketPrintOpts('kitchen'));
        setTicketMenuOpen(false);
    };

    const printTicketCaja = (e) => {
        e.stopPropagation();
        printOrderTicket(order, branch?.name, logoUrl ?? null, ticketPrintOpts('cashier'));
        setTicketMenuOpen(false);
    };

    const handleCopyShare = async (e) => {
        e.stopPropagation();
        const text = buildOrderWhatsAppShareText(order, branch?.name);
        try {
            await navigator.clipboard.writeText(text);
            showNotify?.(
                isDelivery
                    ? 'Resumen copiado (productos, totales y datos de envío).'
                    : 'Resumen del pedido copiado.',
            );
        } catch {
            showNotify?.('No se pudo copiar. Copia manualmente el texto del pedido.', 'error');
        }
    };

    const handleDeliveryWhatsApp = async (e) => {
        e.stopPropagation();
        const text = buildOrderDeliveryDriverPack(order, branch?.name ?? null, branch?.address ?? null);
        await shareDeliveryPackViaWhatsApp(text, {
            onError: (msg) => showNotify?.(msg, 'error'),
        });
    };

    const clientData = clients?.find((c) => c.id === order.client_id);
    const isVip = clientData?.total_orders >= 5;
    const itemsSummary = useMemo(() => buildItemsSummary(order.items), [order.items]);
    const discountMeta = useMemo(() => getOrderCouponDiscountMeta(order), [order]);

    return (
        <div className={`kanban-card glass animate-slide-up${expanded ? ' kanban-card--expanded' : ''}${menuOpen ? ' kanban-card--menu-open' : ''}${gridTile ? ' kanban-card--grid-tile' : ''} ${order.status === 'pending' ? 'urgent-pulse' : ''}`}>
            <div className="kanban-card-top">
                <div className="card-header-row">
                    <span className="order-time" title={new Date(order.created_at).toLocaleString()}>
                        {queueIndex != null ? (
                            <span className="order-queue-badge" title={`Pedido ${queueIndex} en la cola (más antiguo primero)`}>
                                {queueIndex}
                            </span>
                        ) : null}
                        <Clock size={12} />
                        {formatTimeElapsed(order.created_at)}
                    </span>
                    <div className="order-card-header-tools">
                        <button
                            type="button"
                            onClick={handleCopyShare}
                            className="admin-icon-btn admin-icon-btn--sm"
                            title="Copiar resumen del pedido"
                        >
                            <Copy size={14} aria-hidden />
                        </button>
                        {isDelivery ? (
                            <button
                                type="button"
                                onClick={handleDeliveryWhatsApp}
                                className="admin-icon-btn admin-icon-btn--sm"
                                title="WhatsApp envío"
                                aria-label="Enviar datos de delivery por WhatsApp"
                            >
                                <Send size={14} aria-hidden />
                            </button>
                        ) : null}
                        <div className="order-ticket-menu" ref={ticketMenuRef}>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setTicketMenuOpen((v) => !v);
                                }}
                                className="admin-icon-btn admin-icon-btn--sm"
                                title="Imprimir tickets"
                                aria-expanded={ticketMenuOpen}
                                aria-haspopup="menu"
                                aria-label="Menú imprimir tickets"
                            >
                                <Printer size={14} aria-hidden />
                            </button>
                            {ticketMenuOpen ? (
                                <OrderCardAnchoredMenu
                                    anchorRef={ticketMenuRef}
                                    isOpen={ticketMenuOpen}
                                    onClose={() => setTicketMenuOpen(false)}
                                    menuWidth={200}
                                    menuHeight={120}
                                >
                                    <button type="button" className="order-ticket-menu-item" role="menuitem" onClick={printKitchenAgain}>
                                        <ChefHat size={16} aria-hidden />
                                        Ticket cocina
                                    </button>
                                    <button type="button" className="order-ticket-menu-item" role="menuitem" onClick={printTicketCaja}>
                                        <Banknote size={16} aria-hidden />
                                        Ticket caja
                                    </button>
                                </OrderCardAnchoredMenu>
                            ) : null}
                        </div>
                        <span className={`payment-badge ${order.payment_type === 'online' ? 'online' : ''}`}>
                            {getPaymentLabel(order)}
                        </span>
                    </div>
                </div>

                {expanded && deliverySubtitle ? (
                    <div className="order-delivery-mini" title={deliverySubtitle}>
                        {deliverySubtitle}
                    </div>
                ) : null}

                <div className="card-client">
                    <div className="card-client-name-row">
                        <h4 className="card-client-name">{order.client_name}</h4>
                        {isVip ? (
                            <span className="order-card-vip-badge" title={`Cliente habitual · ${clientData.total_orders} pedidos`}>
                                VIP
                            </span>
                        ) : null}
                    </div>
                    <div className="card-kanban-meta-row">
                        {isDelivery ? (
                            <span className="order-fulfillment-pill--delivery" title="Pedido con envío">
                                Delivery
                            </span>
                        ) : null}
                        <button
                            type="button"
                            className="order-detail-trigger"
                            onClick={(e) => {
                                e.stopPropagation();
                                setDetailOpen(true);
                                setTicketMenuOpen(false);
                                setEditMenuOpen(false);
                            }}
                            title="Ver todo el detalle del pedido"
                        >
                            <Eye size={12} aria-hidden />
                            Ver detalle
                        </button>
                    </div>
                </div>

                <hr className="kanban-card-divider" />
            </div>

            <div className="kanban-card-scroll">
                {!expanded ? (
                    <div className="card-items-summary" title={itemsSummary.text}>
                        <p className="card-items-summary__text">{itemsSummary.text}</p>
                        {deliverySubtitle ? (
                            <p className="card-items-summary__delivery" title={deliverySubtitle}>
                                {deliverySubtitle}
                            </p>
                        ) : null}
                        <button
                            type="button"
                            className="kanban-card-expand-toggle kanban-card-expand-toggle--inline"
                            onClick={(e) => {
                                e.stopPropagation();
                                setExpanded(true);
                            }}
                            aria-expanded={false}
                        >
                            <ChevronDown size={14} aria-hidden />
                            Ver más ({itemsSummary.count})
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="card-items card-items--expanded">
                            {order.items.map((item, idx) => {
                                const itemNote = typeof item.note === 'string' ? item.note.trim() : '';
                                return (
                                    <div key={idx} className="order-item-row order-item-row--stacked">
                                        <div className="order-item-row__main">
                                            <span className="qty-circle">{item.quantity}</span>
                                            <span className="item-name">{item.name}</span>
                                        </div>
                                        {Array.isArray(item.extras) && item.extras.length > 0 ? (
                                            <div className="order-item-extras">
                                                {item.extras.map((extra, extraIdx) => (
                                                    <div key={extraIdx} className="order-item-extra-line">
                                                        <span className="order-item-extra-plus">+</span>
                                                        <span>{extra.quantity || 1}x {extra.name}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : null}
                                        {itemNote ? (
                                            <div className="order-item-note" title={itemNote}>
                                                <span className="order-item-note-tag">NOTA</span>
                                                <span className="order-item-note-text">{itemNote}</span>
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}
                            <button
                                type="button"
                                className="kanban-card-expand-toggle kanban-card-expand-toggle--inline"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setExpanded(false);
                                }}
                                aria-expanded
                            >
                                <ChevronUp size={14} aria-hidden />
                                Ver menos
                            </button>
                        </div>

                        {order.payment_type === 'online' ? (
                            <div className="receipt-container receipt-container--kanban">
                                {order.payment_ref && order.payment_ref.startsWith('http') ? (
                                    <div className="receipt-container__row">
                                        <a href={order.payment_ref} target="_blank" rel="noreferrer" className="receipt-link">
                                            <ImageIcon size={14} aria-hidden /> Ver Comprobante
                                        </a>
                                        <button type="button" onClick={() => setReceiptModalOrder(order)} className="order-card-receipt-secondary">
                                            Cambiar
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setReceiptModalOrder(order)}
                                        className="receipt-link receipt-link--optional"
                                        title="Opcional: subir imagen del comprobante"
                                    >
                                        <Upload size={14} aria-hidden /> Comprobante (opcional)
                                    </button>
                                )}
                            </div>
                        ) : null}
                    </>
                )}
            </div>

            <div className="kanban-card-foot">
                <div className="card-total">
                    <span className="total-label">TOTAL</span>
                    <div className="card-total-amounts">
                        <span className="total-amount">${order.total.toLocaleString('es-CL')}</span>
                        {discountMeta ? (
                            <span
                                className="card-total-before"
                                aria-label={`Precio antes del descuento: $${discountMeta.originalTotal.toLocaleString('es-CL')}, ${discountMeta.discountPercent}% de descuento`}
                            >
                                <span className="card-total-before-price">
                                    ${discountMeta.originalTotal.toLocaleString('es-CL')}
                                </span>
                                <span className="card-total-before-pct">-{discountMeta.discountPercent}%</span>
                            </span>
                        ) : null}
                    </div>
                </div>

                <div className="card-actions">
                    {order.status === 'pending' ? (
                        <>
                            <button type="button" onClick={handleCancelOrder} className="btn-icon-action cancel" title="Cancelar Pedido">
                                <XCircle size={16} />
                            </button>
                            <button type="button" onClick={handleMoveToKitchen} className="btn-action primary">
                                A Cocina
                            </button>
                        </>
                    ) : null}
                    {order.status === 'active' ? (
                        <>
                            <button type="button" onClick={handleCancelOrder} className="btn-icon-action cancel" title="Cancelar Pedido">
                                <XCircle size={16} />
                            </button>
                            <button type="button" onClick={() => moveOrder(order.id, 'completed')} className="btn-action success">
                                Pedido Listo
                            </button>
                        </>
                    ) : null}
                    {order.status === 'completed' ? (
                        <>
                            <button type="button" onClick={handleCancelOrder} className="btn-icon-action cancel" title="Cancelar Pedido">
                                <XCircle size={16} />
                            </button>
                            <button
                                type="button"
                                onClick={() => moveOrder(order.id, 'picked_up')}
                                className="btn-action btn-action--deliver"
                            >
                                Entregado al Cliente
                            </button>
                        </>
                    ) : null}
                    <div className="order-ticket-menu order-edit-menu-wrap" ref={editMenuRef}>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setEditMenuOpen((v) => !v);
                                setTicketMenuOpen(false);
                            }}
                            className="btn-icon-action"
                            title="Editar pedido"
                            aria-label="Editar pedido"
                            aria-expanded={editMenuOpen}
                            aria-haspopup="menu"
                        >
                            <Edit2 size={16} />
                        </button>
                        <OrderEditMenu
                            isOpen={editMenuOpen}
                            anchorRef={editMenuRef}
                            onClose={() => setEditMenuOpen(false)}
                            onSelect={(step) => {
                                setEditInitialStep(step);
                                setEditWizardOpen(true);
                            }}
                        />
                    </div>
                </div>
            </div>

            {detailOpen ? (
                <OrderDetailModal
                    order={order}
                    onClose={() => setDetailOpen(false)}
                    branch={branch}
                    logoUrl={logoUrl ?? null}
                    companyName={companyName}
                    showNotify={showNotify}
                    setReceiptModalOrder={setReceiptModalOrder}
                />
            ) : null}

            {editWizardOpen ? (
                <ManualOrderModal
                    isOpen={editWizardOpen}
                    editOrder={order}
                    initialStep={editInitialStep}
                    moveOrder={moveOrder}
                    onClose={() => setEditWizardOpen(false)}
                    products={products}
                    categories={categories}
                    clients={clients}
                    branch={branch}
                    logoUrl={logoUrl ?? null}
                    companyName={companyName}
                    showNotify={showNotify}
                    onOrderSaved={(saved) => {
                        onOrderSaved?.(saved);
                        setEditWizardOpen(false);
                    }}
                />
            ) : null}
        </div>
    );
};

export default OrderCard;
