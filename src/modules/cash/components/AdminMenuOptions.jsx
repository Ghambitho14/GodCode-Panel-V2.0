import React, { useCallback, useMemo, useState } from "react";
import { Images, Truck } from "lucide-react";
import AdminMenuDeliverySection from "./AdminMenuDeliverySection";
import AdminMenuCarousel from "./AdminMenuCarousel";
import "../styles/AdminMenuOptions.css";

const SUB_TAB_IDS = /** @type {const} */ (["delivery", "carousel"]);

function normalizeStoredSubTab(raw) {
	if (raw === "cart") return "delivery";
	if (raw && SUB_TAB_IDS.includes(/** @type {typeof SUB_TAB_IDS[number]} */ (raw))) {
		return /** @type {typeof SUB_TAB_IDS[number]} */ (raw);
	}
	return "delivery";
}

function getStoredSubTab(storageKey) {
	try {
		const normalized = normalizeStoredSubTab(localStorage.getItem(storageKey));
		if (normalized === "delivery") {
			localStorage.setItem(storageKey, "delivery");
		}
		return normalized;
	} catch {
		return "delivery";
	}
}

/**
 * Pestaña "Opciones de menú": sub-pestañas Envío y Carrusel.
 * Bebidas y Extras del carrito viven en entradas propias del sidebar (menu_beverages / menu_extras).
 */
export default function AdminMenuOptions({ showNotify, selectedBranch, companyId, onDeliverySaved }) {
	const branchKey = selectedBranch?.id ?? "__none__";
	const storageKey = useMemo(
		() =>
			companyId
				? `tenant-admin:${companyId}:menuOptionsSubTab:${branchKey}`
				: `tenant-admin:local:menuOptionsSubTab:${branchKey}`,
		[companyId, branchKey],
	);

	const [activeSubTabByKey, setActiveSubTabByKey] = useState(() => ({}));
	const activeSubTab = activeSubTabByKey[storageKey] ?? getStoredSubTab(storageKey);

	const persistSubTab = useCallback(
		(id) => {
			setActiveSubTabByKey((prev) => ({ ...prev, [storageKey]: id }));
			try {
				localStorage.setItem(storageKey, id);
			} catch {}
		},
		[storageKey],
	);

	return (
		<div className="admin-menu-options" data-tab="menu-options">
			<div
				className="admin-menu-options-subtabs"
				role="tablist"
				aria-label="Secciones de opciones de menú"
			>
				<button
					type="button"
					role="tab"
					id="menu-options-subtab-delivery"
					aria-selected={activeSubTab === "delivery"}
					aria-controls="menu-options-panel-delivery"
					className={`admin-menu-options-subtab ${activeSubTab === "delivery" ? "is-active" : ""}`}
					onClick={() => persistSubTab("delivery")}
				>
					<Truck size={18} strokeWidth={1.65} aria-hidden />
					<span>Envío y delivery</span>
				</button>
				<button
					type="button"
					role="tab"
					id="menu-options-subtab-carousel"
					aria-selected={activeSubTab === "carousel"}
					aria-controls="menu-options-panel-carousel"
					className={`admin-menu-options-subtab ${activeSubTab === "carousel" ? "is-active" : ""}`}
					onClick={() => persistSubTab("carousel")}
				>
					<Images size={18} strokeWidth={1.65} aria-hidden />
					<span>Carrusel</span>
				</button>
			</div>

			<div
				role="tabpanel"
				id="menu-options-panel-delivery"
				aria-labelledby="menu-options-subtab-delivery"
				hidden={activeSubTab !== "delivery"}
				className="admin-menu-options-subpanel"
			>
				<AdminMenuDeliverySection
					showNotify={showNotify}
					selectedBranch={selectedBranch}
					onSaved={onDeliverySaved}
				/>
			</div>

			<div
				role="tabpanel"
				id="menu-options-panel-carousel"
				aria-labelledby="menu-options-subtab-carousel"
				hidden={activeSubTab !== "carousel"}
				className="admin-menu-options-subpanel"
			>
				<div className="admin-menu-options-carousel-wrap">
					<p className="admin-menu-options-section-label">Carrusel por sucursal</p>
					<AdminMenuCarousel
						showNotify={showNotify}
						selectedBranch={selectedBranch}
						companyId={companyId}
					/>
				</div>
			</div>
		</div>
	);
}
