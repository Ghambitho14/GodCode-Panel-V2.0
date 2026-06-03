import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredMenuPosition } from '../hooks/useAnchoredMenuPosition';

const getPortalTarget = () => {
	if (typeof document === 'undefined') return null;
	return document.querySelector('.admin-layout') ?? document.body;
};

/**
 * Menú anclado vía portal (fixed) para no quedar detrás de otras kanban cards.
 */
const OrderCardAnchoredMenu = ({
	anchorRef,
	isOpen,
	onClose,
	children,
	className = '',
	panelRef,
	menuWidth = 220,
	menuHeight = 200,
	align = 'right',
}) => {
	const internalRef = useRef(null);
	const mergedRef = panelRef || internalRef;
	const pos = useAnchoredMenuPosition(anchorRef, isOpen, { menuWidth, menuHeight, align });

	useEffect(() => {
		if (!isOpen) return undefined;
		const onOutsideClick = (ev) => {
			if (ev.target instanceof Element && ev.target.closest('.order-ticket-menu-panel--portal')) {
				return;
			}
			const anchor = anchorRef?.current;
			const panel = mergedRef.current;
			if (anchor && anchor.contains(ev.target)) return;
			if (panel && panel.contains(ev.target)) return;
			onClose?.();
		};
		const timerId = window.setTimeout(() => {
			document.addEventListener('click', onOutsideClick);
		}, 0);
		return () => {
			window.clearTimeout(timerId);
			document.removeEventListener('click', onOutsideClick);
		};
	}, [isOpen, onClose, anchorRef, mergedRef]);

	useEffect(() => {
		if (!isOpen) return undefined;
		const onKey = (e) => {
			if (e.key === 'Escape') onClose?.();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [isOpen, onClose]);

	const portalTarget = getPortalTarget();
	if (!isOpen || !pos || !portalTarget) return null;

	return createPortal(
		<div
			ref={mergedRef}
			className={`order-ticket-menu-panel order-ticket-menu-panel--portal${className ? ` ${className}` : ''}`}
			style={{ top: pos.top, left: pos.left }}
			role="menu"
			onClick={(e) => e.stopPropagation()}
		>
			{children}
		</div>,
		portalTarget,
	);
};

export default OrderCardAnchoredMenu;
