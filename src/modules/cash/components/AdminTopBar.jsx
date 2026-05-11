import React from "react";
/**
 * Cabecera de página del admin: título + acciones (campana / notificaciones va en `children`).
 * hideTitleVisual: oculta el H1 en pantalla (p. ej. móvil en Cocina en vivo); mantiene texto para lectores de pantalla.
 */
export default function AdminTopBar({ title, children, hideTitleVisual = false }) {
	return (
		<header className="content-header admin-top-bar">
			<div
				className={
					hideTitleVisual
						? "content-header-title-block content-header-title-block--visually-collapsed"
						: "content-header-title-block"
				}
			>
				<h1 className={hideTitleVisual ? "admin-visually-hidden" : undefined}>{title}</h1>
			</div>
			<div className="header-actions header-actions--mobile-toolbar">
				{children}
			</div>
		</header>
	);
}
