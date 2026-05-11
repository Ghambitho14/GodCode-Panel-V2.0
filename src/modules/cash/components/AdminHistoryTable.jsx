import React, { useState, useMemo } from "react";
import {
	Search,
	Filter,
	Calendar,
	DollarSign,
	Package,
	ChevronDown,
	ChevronUp,
	CreditCard,
	Receipt,
	Upload,
	Eye,
} from "lucide-react";
import { getPaymentLabel } from "@/shared/utils/orderUtils";

const AdminHistoryTable = ({ orders, setReceiptModalOrder }) => {
	const [searchTerm, setSearchTerm] = useState("");
	const [filterStatus, setFilterStatus] = useState("all");
	const [expandedRows, setExpandedRows] = useState(new Set());

	const toggleRow = (id) => {
		const newSet = new Set(expandedRows);
		if (newSet.has(id)) newSet.delete(id);
		else newSet.add(id);
		setExpandedRows(newSet);
	};

	const filteredOrders = useMemo(() => {
		return orders.filter((o) => {
			const matchesSearch =
				String(o.client_name || "")
					.toLowerCase()
					.includes(searchTerm.toLowerCase()) ||
				String(o.client_phone || "").includes(searchTerm);

			const matchesStatus = filterStatus === "all" || o.status === filterStatus;

			return matchesSearch && matchesStatus;
		});
	}, [orders, searchTerm, filterStatus]);

	const getStatusConfig = (status) => {
		const statusMap = {
			picked_up: { label: "Entregado", className: "success" },
			completed: { label: "Completado", className: "success" },
			active: { label: "En Cocina", className: "warning" },
			cancelled: { label: "Cancelado", className: "danger" },
			pending: { label: "Pendiente", className: "neutral" },
		};
		return statusMap[status] || { label: status, className: "neutral" };
	};

	return (
		<div className="history-view glass animate-fade">
			<div className="clients-header">
				<p className="admin-history-subtitle admin-history-meta">
					{filteredOrders.length} pedidos encontrados
				</p>

				<div className="clients-actions">
					<div className="search-box">
						<Search size={18} className="admin-history-icon-muted" aria-hidden />
						<input
							type="text"
							placeholder="Buscar por cliente o teléfono..."
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
						/>
					</div>

					<div className="select-wrapper">
						<Filter size={16} className="admin-history-icon-muted" aria-hidden />
						<select
							value={filterStatus}
							onChange={(e) => setFilterStatus(e.target.value)}
							aria-label="Filtrar por estado"
						>
							<option value="all">Todos los estados</option>
							<option value="completed">Completados</option>
							<option value="picked_up">Entregados</option>
							<option value="cancelled">Cancelados</option>
						</select>
					</div>
				</div>
			</div>

			<div className="history-table-wrapper">
				<table className="data-table">
					<thead>
						<tr>
							<th>CLIENTE</th>
							<th>ID.</th>
							<th>FECHA Y HORA</th>
							<th>TIPO PAGO</th>
							<th>TOTAL</th>
							<th>ESTADO</th>
							<th className="admin-history-th-actions">ACCIONES</th>
						</tr>
					</thead>
					<tbody>
						{filteredOrders.length === 0 ? (
							<tr>
								<td colSpan="7" className="admin-history-empty">
									No hay pedidos que coincidan con los filtros.
								</td>
							</tr>
						) : (
							filteredOrders.map((o) => {
								const st = getStatusConfig(o.status);
								const isExpanded = expandedRows.has(o.id);
								return (
									<React.Fragment key={o.id}>
										<tr
											className={`clickable-row${isExpanded ? " admin-history-row-expanded" : ""}`}
											onClick={() => toggleRow(o.id)}
										>
											<td data-label="Cliente">
												<div className="admin-history-client-stack">
													<span className="admin-history-client-name">
														{o.client_name}
													</span>
													{o.client_phone ? (
														<span className="admin-history-muted-sm">
															{o.client_phone}
														</span>
													) : null}
												</div>
											</td>
											<td data-label="Identificador" className="admin-history-muted">
												#{String(o.id).substring(0, 6)}
											</td>
											<td data-label="Fecha y Hora">
												<div className="admin-history-date-row">
													<Calendar size={14} className="admin-history-icon-muted" aria-hidden />
													<span className="admin-history-date-main">
														{new Date(o.created_at).toLocaleDateString()}
													</span>
													<span className="admin-history-muted-sm">
														{new Date(o.created_at).toLocaleTimeString([], {
															hour: "2-digit",
															minute: "2-digit",
														})}
													</span>
												</div>
											</td>
											<td data-label="Tipo Pago">
												<div className="admin-history-payment-row">
													{o.payment_type === "online" ? (
														<Receipt size={14} className="admin-history-icon-muted" aria-hidden />
													) : o.payment_type === "tarjeta" ? (
														<CreditCard size={14} className="admin-history-icon-muted" aria-hidden />
													) : (
														<DollarSign size={14} className="admin-history-icon-muted" aria-hidden />
													)}
													<span className="admin-history-payment-label">
														{getPaymentLabel(o)}
													</span>
												</div>
											</td>
											<td data-label="Total" className="admin-history-total">
												${o.total.toLocaleString("es-CL")}
											</td>
											<td data-label="Estado">
												<span className={`status-badge ${st.className}`}>{st.label}</span>
											</td>
											<td data-label="Acciones" className="admin-history-actions">
												<button type="button" className="btn-icon-text btn-white">
													{isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
													{isExpanded ? "Cerrar" : "Detalles"}
												</button>
											</td>
										</tr>

										{isExpanded ? (
											<tr className="history-expanded-row">
												<td colSpan="7" className="admin-history-expanded-td">
													<div className="history-expanded-content">
														<div className="admin-history-expanded-inner">
															<h4 className="admin-history-section-title">
																<Package size={14} aria-hidden />
																Artículos del Pedido
															</h4>
															<ul className="admin-history-items-list">
																{o.items?.map((item, idx) => (
																	<li key={idx} className="admin-history-item-li">
																		<div className="admin-history-item-line">
																			<span>
																				<b>{item.quantity}x</b> {item.name}
																			</span>
																			<span className="admin-history-muted">
																				${(item.price * item.quantity).toLocaleString("es-CL")}
																			</span>
																		</div>
																		{item.description ? (
																			<span className="admin-history-item-desc">
																				Detalle: {item.description}
																			</span>
																		) : null}
																	</li>
																))}
															</ul>
															{o.note ? (
																<div className="admin-history-note">
																	<span className="admin-history-note-label">
																		NOTA DEL CLIENTE:
																	</span>
																	<span className="admin-history-note-body">{o.note}</span>
																</div>
															) : null}
														</div>

														<div className="admin-history-receipt-panel">
															<h4 className="admin-history-section-title">
																<Receipt size={14} aria-hidden />
																Comprobante
															</h4>
															{o.payment_type === "online" ? (
																<div>
																	{o.payment_ref &&
																	typeof o.payment_ref === "string" &&
																	o.payment_ref.startsWith("http") ? (
																		<div className="admin-history-receipt-actions">
																			<a
																				href={o.payment_ref}
																				target="_blank"
																				rel="noreferrer"
																				className="btn btn-primary admin-history-receipt-link"
																			>
																				<Eye size={16} /> Ver Recibo Guardado
																			</a>
																			{setReceiptModalOrder ? (
																				<button
																					type="button"
																					onClick={(e) => {
																						e.stopPropagation();
																						setReceiptModalOrder(o);
																					}}
																					className="btn btn-secondary admin-history-receipt-btn-secondary"
																				>
																					Cambiar Recibo
																				</button>
																			) : null}
																		</div>
																	) : (
																		<div className="admin-history-receipt-placeholder">
																			<span className="admin-history-receipt-muted">
																				No hay comprobante subido
																			</span>
																			{setReceiptModalOrder ? (
																				<button
																					type="button"
																					onClick={(e) => {
																						e.stopPropagation();
																						setReceiptModalOrder(o);
																					}}
																					className="btn btn-white admin-history-upload-btn"
																				>
																					<Upload size={14} /> Subir Comprobante
																				</button>
																			) : null}
																		</div>
																	)}
																</div>
															) : (
																<div className="admin-history-receipt-info">
																	Pago registrado como {getPaymentLabel(o)}. No requiere
																	comprobante.
																</div>
															)}
														</div>
													</div>
												</td>
											</tr>
										) : null}
									</React.Fragment>
								);
							})
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
};

export default AdminHistoryTable;
