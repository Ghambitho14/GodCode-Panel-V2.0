import React from "react";

export function AdminBroadcastsBanner({ broadcasts, broadcastsLoading, ackingId, onAcknowledge }) {
	return (
		<>
			{broadcasts.length > 0 ? (
				<div
					id="admin-broadcasts-section"
					className="glass admin-broadcasts-wrap"
				>
					{broadcasts.map((item) => {
						const isCritical = item.priority === "critical" || item.priority === "high";
						const isRead = Boolean(item.readAt);
						return (
							<div
								key={item.id}
								className={`admin-broadcast-item${isCritical ? " admin-broadcast-item--critical" : ""}`}
							>
								<div style={{ minWidth: 0 }}>
									<p className="admin-broadcast-meta">
										{item.broadcastType} · prioridad {item.priority}
									</p>
									<h3 className="admin-broadcast-title">{item.title}</h3>
									<p className="admin-broadcast-message">{item.message}</p>
									<p className="admin-broadcast-date">
										Desde {new Date(item.startsAt).toLocaleString("es-CL")}
									</p>
								</div>

								<div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
									{isRead ? (
										<span className="admin-broadcast-status admin-broadcast-status--read">Leído</span>
									) : (
										<span className="admin-broadcast-status admin-broadcast-status--pending">Pendiente</span>
									)}
									{!isRead ? (
										<button
											type="button"
											className="admin-btn secondary"
											onClick={() => onAcknowledge(item.id)}
											disabled={ackingId === item.id}
											style={{ fontSize: 12, padding: "6px 10px", minHeight: "auto" }}
										>
											{ackingId === item.id ? "Guardando..." : "Marcar leído"}
										</button>
									) : null}
								</div>
							</div>
						);
					})}
				</div>
			) : null}

			{broadcastsLoading ? (
				<div className="glass admin-broadcast-loading">
					Cargando comunicados...
				</div>
			) : null}
		</>
	);
}

export default AdminBroadcastsBanner;
