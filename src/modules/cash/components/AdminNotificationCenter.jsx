import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, AlertTriangle, Package, Megaphone, ChevronRight, CheckCircle2, MapPin } from "lucide-react";

/**
 * Campana del header: comunicados SaaS + alertas de inventario (stock bajo/agotado, productos pausados por stock).
 */
export default function AdminNotificationCenter({
	broadcasts = [],
	broadcastsLoading = false,
	ackingId = null,
	onAcknowledge,
	inventoryBranchRows = [],
	products = [],
	selectedBranch = null,
	setActiveTab,
	setEditingProduct,
	setIsModalOpen,
	canAccessInventory = true,
	canAccessProducts = true,
}) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef(null);

	const pausedByStock = useMemo(
		() => (products || []).filter((p) => p.inventory_pause_reason === "out_of_stock"),
		[products],
	);

	const stockAlerts = useMemo(() => {
		const rows = inventoryBranchRows || [];
		const out = [];
		for (const r of rows) {
			const meta = r.inventory_items || {};
			const name = meta.name || "Artículo";
			const st = Number(r.current_stock) || 0;
			const minB = Number(r.min_stock);
			const minI = Number(meta.min_stock);
			const min = Number.isFinite(minB) && minB >= 0 ? minB : Number.isFinite(minI) && minI >= 0 ? minI : 0;
			if (st <= 0) {
				out.push({ key: `out-${r.inventory_item_id}`, kind: "agotado", name, id: r.inventory_item_id });
			} else if (st <= min && min > 0) {
				out.push({ key: `low-${r.inventory_item_id}`, kind: "bajo", name, id: r.inventory_item_id, st, min });
			}
		}
		return out;
	}, [inventoryBranchRows]);

	const pendingBroadcasts = useMemo(
		() => (broadcasts || []).filter((b) => !b.readAt),
		[broadcasts],
	);

	const badgeCount = pausedByStock.length + stockAlerts.length + pendingBroadcasts.length;

	useEffect(() => {
		if (!open) return;
		const onDoc = (e) => {
			if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
		};
		document.addEventListener("mousedown", onDoc);
		return () => document.removeEventListener("mousedown", onDoc);
	}, [open]);

	const scrollBroadcasts = useCallback(() => {
		document.getElementById("admin-broadcasts-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
		setOpen(false);
	}, []);

	const goInventory = useCallback(() => {
		if (canAccessInventory) setActiveTab?.("inventory");
		setOpen(false);
	}, [canAccessInventory, setActiveTab]);

	const goProduct = useCallback(
		(p) => {
			if (canAccessProducts) {
				setActiveTab?.("products");
				setEditingProduct?.(p);
				setIsModalOpen?.(true);
			}
			setOpen(false);
		},
		[canAccessProducts, setActiveTab, setEditingProduct, setIsModalOpen],
	);

	const branchLabel = selectedBranch?.id && selectedBranch.id !== "all" ? selectedBranch.name : null;

	return (
		<div className="admin-notification-center" ref={rootRef}>
			<button
				type="button"
				className="btn-icon-refresh admin-icon-btn header-action-bell header-action-notifications admin-notification-center__trigger"
				onClick={() => setOpen((v) => !v)}
				title="Notificaciones"
				aria-label="Notificaciones"
				aria-expanded={open}
			>
				<Bell size={24} strokeWidth={1.65} aria-hidden />
				{badgeCount > 0 ? (
					<span className="admin-notification-center__badge" aria-hidden>
						{badgeCount > 99 ? "99+" : badgeCount}
					</span>
				) : null}
			</button>

			{open ? (
				<div
					className="admin-notification-center__popover"
					role="dialog"
					aria-labelledby="admin-notification-center-title"
				>
					<header className="admin-notification-center__head">
						<h2 className="admin-notification-center__title" id="admin-notification-center-title">
							Notificaciones
						</h2>
						{branchLabel ? (
							<p className="admin-notification-center__sub">
								<MapPin size={12} strokeWidth={2} className="admin-notification-center__sub-icon" aria-hidden />
								<span>{branchLabel}</span>
							</p>
						) : (
							<p className="admin-notification-center__sub admin-notification-center__sub--all-branches">
								Vista general · elige sucursal para alertas de stock
							</p>
						)}
					</header>

					<div className="admin-notification-center__scroll">
						<section className="admin-notification-center__panel" aria-labelledby="notif-section-inventory">
							<div className="admin-notification-center__panel-head">
								<span className="admin-notification-center__panel-icon" aria-hidden>
									<Package size={18} strokeWidth={1.75} />
								</span>
								<h3 className="admin-notification-center__panel-title" id="notif-section-inventory">
									Inventario
								</h3>
							</div>
							<div className="admin-notification-center__panel-body">
							{!branchLabel ? (
								<div className="admin-notification-center__empty-state">
									<span className="admin-notification-center__empty-icon-wrap" aria-hidden>
										<MapPin size={22} strokeWidth={1.65} />
									</span>
									<p className="admin-notification-center__empty-text">
										Selecciona una sucursal arriba para ver stock bajo, agotados y productos pausados.
									</p>
								</div>
							) : pausedByStock.length > 0 ? (
								<ul className="admin-notification-center__list">
									{pausedByStock.map((p) => (
										<li key={p.id}>
											<button
												type="button"
												className="admin-notification-center__row"
												onClick={() => goProduct(p)}
												disabled={!canAccessProducts}
											>
												<span className="admin-notification-center__row-icon admin-notification-center__row-icon--warn">
													<AlertTriangle size={16} />
												</span>
												<span className="admin-notification-center__row-body">
													<strong>Producto pausado por stock</strong>
													<span>{p.name}</span>
												</span>
												<ChevronRight size={16} className="admin-notification-center__chev" />
											</button>
										</li>
									))}
								</ul>
							) : null}
							{branchLabel && stockAlerts.length > 0 ? (
								<ul className="admin-notification-center__list">
									{stockAlerts.map((a) => (
										<li key={a.key}>
											<button
												type="button"
												className="admin-notification-center__row"
												onClick={goInventory}
												disabled={!canAccessInventory}
											>
												<span
													className={`admin-notification-center__row-icon ${a.kind === "agotado" ? "admin-notification-center__row-icon--danger" : "admin-notification-center__row-icon--warn"}`}
												>
													<AlertTriangle size={16} />
												</span>
												<span className="admin-notification-center__row-body">
													<strong>{a.kind === "agotado" ? "Agotado" : "Stock bajo"}</strong>
													<span>
														{a.name}
														{a.st != null ? ` · ${a.st} (mín. ${a.min})` : ""}
													</span>
												</span>
												<ChevronRight size={16} className="admin-notification-center__chev" />
											</button>
										</li>
									))}
								</ul>
							) : null}
							{branchLabel && pausedByStock.length === 0 && stockAlerts.length === 0 ? (
								<div className="admin-notification-center__empty-state admin-notification-center__empty-state--positive">
									<span className="admin-notification-center__empty-icon-wrap admin-notification-center__empty-icon-wrap--positive" aria-hidden>
										<CheckCircle2 size={22} strokeWidth={1.65} />
									</span>
									<p className="admin-notification-center__empty-text">Sin alertas de inventario en esta sucursal.</p>
								</div>
							) : null}
							</div>
						</section>

						<section className="admin-notification-center__panel" aria-labelledby="notif-section-broadcasts">
							<div className="admin-notification-center__panel-head">
								<span className="admin-notification-center__panel-icon admin-notification-center__panel-icon--accent" aria-hidden>
									<Megaphone size={18} strokeWidth={1.75} />
								</span>
								<h3 className="admin-notification-center__panel-title" id="notif-section-broadcasts">
									Comunicados
								</h3>
							</div>
							<div className="admin-notification-center__panel-body">
							{broadcastsLoading ? (
								<div className="admin-notification-center__empty-state">
									<p className="admin-notification-center__empty-text admin-notification-center__empty-text--loading">Cargando…</p>
								</div>
							) : pendingBroadcasts.length === 0 ? (
								<div className="admin-notification-center__empty-state admin-notification-center__empty-state--muted">
									<span className="admin-notification-center__empty-icon-wrap" aria-hidden>
										<Megaphone size={22} strokeWidth={1.65} />
									</span>
									<p className="admin-notification-center__empty-text">No hay comunicados pendientes.</p>
								</div>
							) : (
								<ul className="admin-notification-center__list">
									{pendingBroadcasts.map((item) => (
										<li key={item.id}>
											<div className="admin-notification-center__broadcast">
												<strong>{item.title}</strong>
												<p>{item.message}</p>
												<div className="admin-notification-center__broadcast-actions">
													<button
														type="button"
														className="admin-btn secondary admin-notification-center__action-btn"
														onClick={() => onAcknowledge?.(item.id)}
														disabled={ackingId === item.id}
													>
														{ackingId === item.id ? "Guardando…" : "Marcar leído"}
													</button>
													<button
														type="button"
														className="admin-btn secondary admin-notification-center__action-btn"
														onClick={scrollBroadcasts}
													>
														Ver en página
													</button>
												</div>
											</div>
										</li>
									))}
								</ul>
							)}
							</div>
						</section>
					</div>
				</div>
			) : null}
		</div>
	);
}
