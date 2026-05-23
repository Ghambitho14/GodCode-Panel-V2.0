import React, { useEffect, useRef } from 'react';
import { ShoppingBag, User, CreditCard } from 'lucide-react';

/**
 * Menú desplegable para elegir qué sección del pedido editar (mismo patrón que tickets).
 */
const OrderEditMenu = ({ isOpen, onClose, onSelect, anchorRef }) => {
    const panelRef = useRef(null);

    useEffect(() => {
        if (!isOpen) return;
        const onDown = (ev) => {
            const anchor = anchorRef?.current;
            const panel = panelRef.current;
            if (anchor && anchor.contains(ev.target)) return;
            if (panel && panel.contains(ev.target)) return;
            onClose?.();
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [isOpen, onClose, anchorRef]);

    if (!isOpen) return null;

    const options = [
        { step: 1, label: 'Productos del pedido', Icon: ShoppingBag },
        { step: 2, label: 'Cliente y entrega', Icon: User },
        { step: 3, label: 'Pago y total', Icon: CreditCard },
    ];

    return (
        <div
            ref={panelRef}
            className="order-ticket-menu-panel manual-order-edit-menu-panel"
            role="menu"
            onClick={(e) => e.stopPropagation()}
        >
            <p className="manual-order-edit-menu-title">¿Qué quieres editar?</p>
            {options.map(({ step, label, Icon }) => (
                <button
                    key={step}
                    type="button"
                    className="order-ticket-menu-item"
                    role="menuitem"
                    onClick={() => {
                        onSelect?.(step);
                        onClose?.();
                    }}
                >
                    <Icon size={16} aria-hidden />
                    {label}
                </button>
            ))}
        </div>
    );
};

export default OrderEditMenu;
