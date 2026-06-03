import React from 'react';
import { ShoppingBag, User } from 'lucide-react';
import OrderCardAnchoredMenu from '../OrderCardAnchoredMenu';

/**
 * Menú desplegable para elegir qué sección del pedido editar (portal fixed).
 */
const OrderEditMenu = ({ isOpen, onClose, onSelect, anchorRef }) => {
	const options = [
		{ step: 1, label: 'Productos del pedido', Icon: ShoppingBag },
		{ step: 2, label: 'Cliente, entrega y pago', Icon: User },
	];

	return (
		<OrderCardAnchoredMenu
			anchorRef={anchorRef}
			isOpen={isOpen}
			onClose={onClose}
			className="manual-order-edit-menu-panel"
			menuWidth={240}
			menuHeight={160}
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
		</OrderCardAnchoredMenu>
	);
};

export default OrderEditMenu;
