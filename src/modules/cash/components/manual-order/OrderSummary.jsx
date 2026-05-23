import React, { useState, useRef, useEffect } from 'react';
import { ShoppingBag, Printer, ChefHat, Banknote, Minus, Plus, StickyNote, Trash2 } from 'lucide-react';
import { formatCurrency } from '@/shared/utils/formatters';
import { PRODUCT_IMAGE_PLACEHOLDER } from '../../constants/productImagePlaceholder';

/**
 * Componente que gestiona el listado del Carrito de Compras (ítems agregados),
 * las notas individuales para cocina por cada producto, y la impresión rápida de tickets.
 */
const OrderSummary = ({
    manualOrder,
    updateQuantity,
    removeItem,
    updateItemNote,
    printManualKitchen,
    printManualCaja
}) => {
    // --- ESTADOS LOCALES ---
    const [printMenuOpen, setPrintMenuOpen] = useState(false);
    const [openNoteIds, setOpenNoteIds] = useState(() => new Set());
    const printMenuRef = useRef(null);

    const isItemNoteOpen = (item) => openNoteIds.has(item.id) || (item.note ?? '').length > 0;

    const toggleItemNote = (itemId) => setOpenNoteIds((prev) => {
        const next = new Set(prev);
        if (next.has(itemId)) next.delete(itemId);
        else next.add(itemId);
        return next;
    });

    // --- MANEJO CLICK OUTSIDE PARA MENÚ IMPRESIÓN ---
    useEffect(() => {
        if (!printMenuOpen) return;
        const onDown = (ev) => {
            const el = printMenuRef.current;
            if (el && !el.contains(ev.target)) setPrintMenuOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [printMenuOpen]);

    const totalQty = manualOrder.items.reduce((acc, i) => acc + i.quantity, 0);

    return (
        <div className="manual-order-section manual-order-summary-section">
            <div className="manual-order-section-title manual-order-summary-head">
                <div className="manual-order-summary-head-row">
                    <div className="manual-order-summary-head-label">
                        <ShoppingBag size={14} aria-hidden />
                        RESUMEN ORDEN ({totalQty})
                    </div>
                    {manualOrder.items.length > 0 && (
                        <div className="manual-order-print-menu" ref={printMenuRef}>
                            <button
                                type="button"
                                onClick={() => setPrintMenuOpen((v) => !v)}
                                className="manual-order-summary-print"
                                title="Imprimir tickets"
                                aria-expanded={printMenuOpen}
                                aria-haspopup="menu"
                                aria-label="Imprimir tickets"
                            >
                                <Printer size={14} aria-hidden />
                            </button>
                            {printMenuOpen && (
                                <div className="manual-order-print-panel" role="menu">
                                    <button
                                        type="button"
                                        className="manual-order-print-item"
                                        role="menuitem"
                                        onClick={() => {
                                            printManualKitchen();
                                            setPrintMenuOpen(false);
                                        }}
                                    >
                                        <ChefHat size={16} aria-hidden />
                                        Ticket cocina
                                    </button>
                                    <button
                                        type="button"
                                        className="manual-order-print-item"
                                        role="menuitem"
                                        onClick={() => {
                                            printManualCaja();
                                            setPrintMenuOpen(false);
                                        }}
                                    >
                                        <Banknote size={16} aria-hidden />
                                        Ticket caja
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="manual-order-cart-body">
                {manualOrder.items.length === 0 ? (
                    <div className="manual-order-cart-empty">
                        <ShoppingBag size={42} strokeWidth={1} className="manual-order-cart-empty-icon" aria-hidden />
                        <div className="manual-order-cart-empty-text">CARRITO VACÍO</div>
                    </div>
                ) : (
                    <div className="manual-order-cart-list">
                        {manualOrder.items.map(item => (
                            <div key={item.id} className="manual-order-cart-item animate-slide-up">
                                <div className="manual-order-cart-item-accent" aria-hidden />

                                <img
                                    src={item.image_url || PRODUCT_IMAGE_PLACEHOLDER}
                                    alt={item.name}
                                    className="manual-order-cart-item-thumb"
                                    onError={(e) => { e.target.src = PRODUCT_IMAGE_PLACEHOLDER }}
                                />

                                <div className="manual-order-cart-item-info">
                                    <div className="manual-order-cart-item-title">{item.name}</div>
                                    <div className="manual-order-cart-item-price-block">
                                        {(() => {
                                            const hasDiscount = Boolean(item.has_discount) && item.discount_price != null && Number(item.discount_price) > 0;
                                            const unit = hasDiscount ? Number(item.discount_price) : Number(item.price);
                                            const subtotal = unit * Number(item.quantity || 1);
                                            return (
                                                <div className="manual-order-cart-price-rows">
                                                    {hasDiscount && (
                                                        <div className="manual-order-cart-discount-row">
                                                            <span className="manual-order-cart-badge-oferta">Oferta</span>
                                                            <span className="manual-order-cart-price-old">
                                                                {formatCurrency(Number(item.price))}
                                                            </span>
                                                        </div>
                                                    )}
                                                    <div className="manual-order-cart-price-main-row">
                                                        <span className="manual-order-cart-price-total">
                                                            {formatCurrency(subtotal)}
                                                        </span>
                                                        <span className="manual-order-cart-price-unit">
                                                            {formatCurrency(unit)} c/u
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>

                                <div className="manual-order-cart-stepper">
                                    <button
                                        type="button"
                                        className="manual-order-cart-step-btn"
                                        onClick={() => updateQuantity(item.id, -1)}
                                        aria-label="Reducir cantidad"
                                    >
                                        <Minus size={14} aria-hidden />
                                    </button>
                                    <span className="manual-order-cart-step-qty">{item.quantity}</span>
                                    <button
                                        type="button"
                                        className="manual-order-cart-step-btn"
                                        onClick={() => updateQuantity(item.id, 1)}
                                        aria-label="Aumentar cantidad"
                                    >
                                        <Plus size={14} aria-hidden />
                                    </button>
                                </div>

                                <button
                                    type="button"
                                    className={`manual-order-cart-note-btn ${(item.note ?? '').length > 0 ? 'has-note' : ''}`}
                                    onClick={() => toggleItemNote(item.id)}
                                    title={(item.note ?? '').length > 0 ? 'Editar comentario' : 'Agregar comentario para cocina'}
                                    aria-label={(item.note ?? '').length > 0 ? 'Editar comentario' : 'Agregar comentario'}
                                    aria-pressed={isItemNoteOpen(item)}
                                >
                                    <StickyNote size={14} aria-hidden />
                                </button>

                                <button
                                    type="button"
                                    className="manual-order-cart-remove"
                                    onClick={() => removeItem(item.id)}
                                    title="Eliminar ítem"
                                    aria-label="Eliminar ítem"
                                >
                                    <Trash2 size={14} aria-hidden />
                                </button>

                                {isItemNoteOpen(item) && (
                                    <div className="manual-order-cart-item-note">
                                        <textarea
                                            className="manual-order-cart-item-note-input"
                                            value={item.note ?? ''}
                                            onChange={(e) => updateItemNote(item.id, e.target.value)}
                                            placeholder="Comentario para cocina (ej: sin cebolla, salsa aparte). Max 140."
                                            maxLength={140}
                                            rows={2}
                                            aria-label={`Comentario para ${item.name}`}
                                        />
                                        <span className="manual-order-cart-item-note-counter">
                                            {(item.note ?? '').length}/140
                                        </span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(OrderSummary);
