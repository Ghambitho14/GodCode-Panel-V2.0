import React, { useState, useRef, useEffect } from 'react';
import { Clock, XCircle, Upload, ImageIcon, Printer, Edit2, Copy, Send, ChefHat, Banknote } from 'lucide-react';
import { formatTimeElapsed } from '@/shared/utils/formatters';
import {
    buildOrderWhatsAppShareText,
    buildOrderDeliveryDriverPack,
    shareDeliveryPackViaWhatsApp,
    getPaymentLabel,
    isOrderDelivery,
    orderDeliveryKanbanSubtitle,
} from '@/shared/utils/orderUtils';
import { printOrderTicket } from '@/modules/cash/admin/utils/receiptPrinting';
import OrderEditModal from './OrderEditModal';

const OrderCard = ({ order, queueIndex, moveOrder, setReceiptModalOrder, branch, clients, logoUrl, companyName, showNotify, products, categories, onOrderSaved }) => {
    const [editOpen, setEditOpen] = useState(false);
    const [ticketMenuOpen, setTicketMenuOpen] = useState(false);
    const ticketMenuRef = useRef(null);
    const isDelivery = isOrderDelivery(order);
    const deliverySubtitle = isDelivery ? orderDeliveryKanbanSubtitle(order) : '';
    // `companyName` se inyecta al header (h1) del ticket cliente. La sucursal
    // sigue presentandose abajo via prefijo [Sucursal: X] en la nota.
    const ticketPrintOpts = (variant) => ({
        variant,
        branchAddress: branch?.address ?? null,
        companyName: companyName ?? null,
    });

    useEffect(() => {
        if (!ticketMenuOpen) return;
        const onDown = (ev) => {
            const el = ticketMenuRef.current;
            if (el && !el.contains(ev.target)) setTicketMenuOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [ticketMenuOpen]);

    /** Ticket cocina: al pasar a cocina (también reimprimir desde el menú si falló la impresora). */
    const handleMoveToKitchen = (e) => {
        e.stopPropagation();
        printOrderTicket(order, branch?.name, logoUrl ?? null, ticketPrintOpts('kitchen'));
        moveOrder(order.id, 'active');
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

    // Lógica VIP: Buscar cliente y verificar si tiene más de 5 pedidos
    const clientData = clients?.find(c => c.id === order.client_id);
    const isVip = clientData?.total_orders >= 5;

    return (
        <div className={`kanban-card glass animate-slide-up ${order.status === 'pending' ? 'urgent-pulse' : ''}`}>
            <div className="kanban-card-top">
            {/* ENCABEZADO */}
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
                        title="Copiar resumen del pedido (cliente, productos, pago, total; si es envío: código de verificación, dirección y enlace al mapa)"
                    >
                        <Copy size={17} aria-hidden />
                    </button>
                    {isDelivery ? (
                        <button
                            type="button"
                            onClick={handleDeliveryWhatsApp}
                            className="admin-icon-btn admin-icon-btn--sm"
                            title="Abrir WhatsApp con el texto del envío; eliges el contacto en la app"
                            aria-label="Enviar datos de delivery por WhatsApp"
                        >
                            <Send size={17} aria-hidden />
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
                            title="Imprimir tickets (cocina o caja; reimprimir si falló la impresora)"
                            aria-expanded={ticketMenuOpen}
                            aria-haspopup="menu"
                            aria-label="Menú imprimir tickets"
                        >
                            <Printer size={17} aria-hidden />
                        </button>
                        {ticketMenuOpen ? (
                            <div className="order-ticket-menu-panel" role="menu" onClick={(e) => e.stopPropagation()}>
                                <button type="button" className="order-ticket-menu-item" role="menuitem" onClick={printKitchenAgain}>
                                    <ChefHat size={16} aria-hidden />
                                    Ticket cocina
                                </button>
                                <button type="button" className="order-ticket-menu-item" role="menuitem" onClick={printTicketCaja}>
                                    <Banknote size={16} aria-hidden />
                                    Ticket caja
                                </button>
                            </div>
                        ) : null}
                    </div>
                <span className={`payment-badge ${order.payment_type === 'online' ? 'online' : ''}`}>
                    {getPaymentLabel(order)}
                </span>
                </div>
            </div>

            {deliverySubtitle ? (
                <div
                    className="order-delivery-mini"
                    style={{
                        marginTop: 6,
                        marginBottom: 2,
                        fontSize: 11,
                        lineHeight: 1.35,
                        color: '#475569',
                        wordBreak: 'break-word',
                    }}
                    title={deliverySubtitle}
                >
                    {deliverySubtitle}
                </div>
            ) : null}

            {/* CLIENTE */}
            <div className="card-client">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <h4 className="card-client-name">{order.client_name}</h4>
                    {isVip ? (
                        <span
                            className="order-card-vip-badge"
                            title={`Cliente habitual · ${clientData.total_orders} pedidos`}
                        >
                            VIP
                        </span>
                    ) : null}
                </div>
            </div>

            <hr className="kanban-card-divider" />
            </div>

            <div className="kanban-card-scroll">
            {/* PRODUCTOS (Ticket list) */}
            <div className="card-items">
        {order.items.map((item, idx) => {
            const itemNote = typeof item.note === 'string' ? item.note.trim() : '';
            return (
            <div key={idx} className="order-item-row" style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, width: '100%' }}>
                    <span className="qty-circle">{item.quantity}</span>
                    <span className="item-name">{item.name}</span>
                </div>
                {Array.isArray(item.extras) && item.extras.length > 0 && (
                    <div style={{ marginTop: '2px', marginLeft: '4px', fontSize: '11px', opacity: 0.75, lineHeight: '1.3' }}>
                        {item.extras.map((extra, extraIdx) => (
                            <div key={extraIdx} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                <span style={{ opacity: 0.6 }}>+</span>
                                <span>{extra.quantity || 1}x {extra.name}</span>
                            </div>
                        ))}
                    </div>
                )}
                {itemNote ? (
                    <div
                        className="order-item-note"
                        title={itemNote}
                    >
                        <span className="order-item-note-tag">NOTA</span>
                        <span className="order-item-note-text">{itemNote}</span>
                    </div>
                ) : null}
            </div>
            );
        })}
            </div>

            {/* COMPROBANTE DE TRANSFERENCIA */}
            {order.payment_type === 'online' && (
                <div className="receipt-container" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                    {order.payment_ref && order.payment_ref.startsWith('http') ? (
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <a href={order.payment_ref} target="_blank" rel="noreferrer" className="receipt-link" style={{ flex: 1, textDecoration: 'none' }}>
                                <ImageIcon size={14} /> Ver Comprobante
                            </a>
                            <button type="button" onClick={() => setReceiptModalOrder(order)} className="order-card-receipt-secondary">
                                Cambiar
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setReceiptModalOrder(order)}
                            className="receipt-link"
                            title="Opcional: subir imagen del comprobante"
                            style={{
                                background: 'rgba(148, 163, 184, 0.12)',
                                color: '#64748b',
                                border: '1px solid rgba(148, 163, 184, 0.35)',
                                width: '100%',
                                display: 'flex',
                                justifyContent: 'center',
                                cursor: 'pointer',
                            }}
                        >
                            <Upload size={14} aria-hidden /> Comprobante (opcional)
                        </button>
                    )}
                </div>
            )}
            </div>

            <div className="kanban-card-foot">
            {/* TOTAL */}
            <div className="card-total">
                <span className="total-label">TOTAL</span>
                <span className="total-amount" style={{ fontSize: '1.05rem' }}>${order.total.toLocaleString('es-CL')}</span>
            </div>

            {/* ACCIONES KANBAN */}
            <div className="card-actions" style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                {order.status === 'pending' && (
                    <>
                        <button onClick={() => moveOrder(order.id, 'cancelled')} className="btn-icon-action cancel" style={{ flex: '0 0 40px' }} title="Cancelar Pedido">
                            <XCircle size={18} />
                        </button>
                        <button onClick={handleMoveToKitchen} className="btn-action primary" style={{ flex: 1 }}>
                            A Cocina
                        </button>
                    </>
                )}
                {order.status === 'active' && <button onClick={() => moveOrder(order.id, 'completed')} className="btn-action success" style={{ flex: 1, margin: 0 }}>Pedido Listo</button>}
                {order.status === 'completed' && <button onClick={() => moveOrder(order.id, 'picked_up')} className="btn-action" style={{ background: 'var(--accent-primary)', color: '#fff', flex: 1, margin: 0 }}>Entregado al Cliente</button>}
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        setEditOpen(true);
                    }}
                    className="btn-icon-action"
                    style={{ flex: '0 0 40px' }}
                    title="Editar pedido"
                    aria-label="Editar pedido"
                >
                    <Edit2 size={18} />
                </button>
            </div>
            </div>

            {editOpen ? (
                <OrderEditModal
                    isOpen={editOpen}
                    order={order}
                    onClose={() => setEditOpen(false)}
                    products={products}
                    categories={categories}
                    branch={branch}
                    logoUrl={logoUrl ?? null}
                    companyName={companyName}
                    showNotify={showNotify}
                    onOrderSaved={onOrderSaved}
                    moveOrder={moveOrder}
                />
            ) : null}
        </div>
    );
};

export default OrderCard;
