import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Tag, Plus, Loader2, Pencil, Ban, CircleCheck } from "lucide-react";
import { supabase, TABLES } from "@/integrations/supabase";
import { formatCurrency } from "@/shared/utils/formatters";
import { normalizeCouponCode } from "@/lib/discount-coupon";

const emptyDraft = () => ({
	id: "",
	code: "",
	discount_type: "percent",
	discount_value: "10",
	scope: "global",
	restricted_client_id: "",
	min_order_subtotal: "0",
	max_redemptions: "",
	max_redemptions_per_client: "1",
	valid_from: "",
	valid_until: "",
	is_active: true,
});

function toDatetimeLocal(val) {
	if (val == null || val === "") return "";
	try {
		const d = new Date(val);
		if (Number.isNaN(d.getTime())) return "";
		const pad = (n) => String(n).padStart(2, "0");
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	} catch {
		return "";
	}
}

function fromDatetimeLocal(s) {
	const t = String(s ?? "").trim();
	if (!t) return null;
	const d = new Date(t);
	if (Number.isNaN(d.getTime())) return null;
	return d.toISOString();
}

function FieldLabel({ children }) {
	return <label className="admin-coupons__label p">{children}</label>;
}

function formatCouponRowDates(row) {
	const fmt = (v) => {
		if (!v) return "—";
		try {
			return new Date(v).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
		} catch {
			return String(v);
		}
	};
	return { from: fmt(row.valid_from), until: fmt(row.valid_until) };
}

export default function AdminCoupons({ showNotify, companyId }) {
	const [rows, setRows] = useState([]);
	const [clients, setClients] = useState([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [draft, setDraft] = useState(() => emptyDraft());
	const [editing, setEditing] = useState(false);

	const cid = typeof companyId === "string" && companyId.trim() ? companyId.trim() : "";

	const load = useCallback(async () => {
		if (!cid) {
			setRows([]);
			setClients([]);
			setLoading(false);
			return;
		}
		setLoading(true);
		try {
			const [cRes, clRes] = await Promise.all([
				supabase
					.from(TABLES.discount_coupons)
					.select("*")
					.eq("company_id", cid)
					.order("created_at", { ascending: false }),
				supabase
					.from(TABLES.clients)
					.select("id, name, phone")
					.eq("company_id", cid)
					.order("last_order_at", { ascending: false })
					.limit(500),
			]);
			if (cRes.error) throw cRes.error;
			if (clRes.error) throw clRes.error;
			setRows(cRes.data || []);
			setClients(clRes.data || []);
		} catch (e) {
			showNotify?.(e.message || "Error al cargar cupones", "error");
		} finally {
			setLoading(false);
		}
	}, [cid, showNotify]);

	useEffect(() => {
		void load();
	}, [load]);

	const resetForm = () => {
		setDraft(emptyDraft());
		setEditing(false);
	};

	const startEdit = (row) => {
		setDraft({
			id: row.id,
			code: String(row.code ?? ""),
			discount_type: row.discount_type === "fixed_amount" ? "fixed_amount" : "percent",
			discount_value: String(Number(row.discount_value ?? 0)),
			scope: row.scope === "client_only" ? "client_only" : "global",
			restricted_client_id: row.restricted_client_id ? String(row.restricted_client_id) : "",
			min_order_subtotal: String(Number(row.min_order_subtotal ?? 0)),
			max_redemptions:
				row.max_redemptions == null || row.max_redemptions === "" ? "" : String(Number(row.max_redemptions)),
			max_redemptions_per_client: String(Number(row.max_redemptions_per_client ?? 1) || 1),
			valid_from: toDatetimeLocal(row.valid_from),
			valid_until: toDatetimeLocal(row.valid_until),
			is_active: row.is_active !== false,
		});
		setEditing(true);
	};

	const buildPayload = () => {
		const code = normalizeCouponCode(draft.code);
		const dv = Number(draft.discount_value);
		const scope = draft.scope === "client_only" ? "client_only" : "global";
		const restricted = scope === "client_only" ? String(draft.restricted_client_id || "").trim() : null;
		if (!code) throw new Error("El código es obligatorio.");
		if (!Number.isFinite(dv) || dv < 0) throw new Error("El valor del descuento no es válido.");
		if (draft.discount_type === "percent" && dv > 100) throw new Error("El porcentaje no puede superar 100.");
		if (scope === "client_only" && !restricted) throw new Error("Selecciona un cliente para este cupón restringido.");
		const ms = Number(draft.min_order_subtotal);
		if (!Number.isFinite(ms) || ms < 0) throw new Error("El mínimo del pedido no es válido.");
		const mr =
			String(draft.max_redemptions ?? "").trim() === ""
				? null
				: Math.max(1, Number(draft.max_redemptions));
		if (
			String(draft.max_redemptions ?? "").trim() !== "" &&
			(!Number.isFinite(mr) || mr <= 0)
		) {
			throw new Error("El máximo de usos global no es válido (dejar vacío = sin límite).");
		}
		const mrc = Math.max(1, Number(draft.max_redemptions_per_client) || 1);
		const vf = fromDatetimeLocal(draft.valid_from);
		const vu = fromDatetimeLocal(draft.valid_until);
		const base = {
			company_id: cid,
			code,
			discount_type: draft.discount_type === "fixed_amount" ? "fixed_amount" : "percent",
			discount_value: dv,
			scope,
			restricted_client_id: scope === "client_only" ? restricted : null,
			min_order_subtotal: ms,
			max_redemptions: mr,
			max_redemptions_per_client: mrc,
			valid_from: vf,
			valid_until: vu,
			is_active: Boolean(draft.is_active),
			updated_at: new Date().toISOString(),
		};
		return base;
	};

	const submit = async () => {
		if (!cid) return;
		setSaving(true);
		try {
			const payload = buildPayload();
			if (editing && draft.id) {
				const { error } = await supabase.from(TABLES.discount_coupons).update(payload).eq("id", draft.id);
				if (error) throw error;
				showNotify?.("Cupón actualizado.");
			} else {
				const insertRow = {
					...payload,
				};
				const { error } = await supabase.from(TABLES.discount_coupons).insert(insertRow);
				if (error) throw error;
				showNotify?.("Cupón creado.");
			}
			resetForm();
			await load();
		} catch (e) {
			const msg =
				e?.code === "23505"
					? "Ya existe un cupón con ese código para esta empresa."
					: e.message || "No se pudo guardar.";
			showNotify?.(msg, "error");
		} finally {
			setSaving(false);
		}
	};

	const toggleActive = async (row) => {
		if (!row?.id) return;
		setSaving(true);
		try {
			const { error } = await supabase
				.from(TABLES.discount_coupons)
				.update({ is_active: !row.is_active, updated_at: new Date().toISOString() })
				.eq("id", row.id);
			if (error) throw error;
			showNotify?.(!row.is_active ? "Cupón activado." : "Cupón desactivado.");
			await load();
		} catch (e) {
			showNotify?.(e.message || "Error al actualizar", "error");
		} finally {
			setSaving(false);
		}
	};

	const clientLabel = useCallback(
		(id) => {
			const c = clients.find((x) => x.id === id);
			if (!c) return String(id ?? "").slice(0, 8) + "…";
			const ph = String(c.phone ?? "").trim();
			return `${String(c.name ?? "").trim() || "(Sin nombre)"}${ph ? ` · ${ph}` : ""}`;
		},
		[clients],
	);

	const subtitle = useMemo(
		() =>
			editing ? "Editar cupón existente." : "Crea cupones globales o solo para un cliente (por teléfono existente).",
		[editing],
	);

	if (!cid) {
		return (
			<p className="admin-toolbar-hint admin-coupons__empty-company">
				Selecciona una empresa válida para administrar cupones.
			</p>
		);
	}

	return (
		<div className="admin-coupons">
			<div className="admin-toolbar glass admin-coupons__toolbar">
				<div className="admin-coupons__toolbar-head">
					<div className="admin-coupons__toolbar-title">
						<Tag size={22} strokeWidth={1.6} aria-hidden />
						<h2>Cupones</h2>
					</div>
					<button
						type="button"
						className="admin-btn secondary admin-coupons__refresh-btn"
						disabled={loading || saving}
						onClick={() => void load()}
					>
						<Loader2 size={14} className={loading ? "animate-spin" : ""} aria-hidden /> Actualizar
					</button>
				</div>
				<p className="admin-toolbar-hint admin-coupons__toolbar-hint">
					Los pedidos validan el código en servidor; el cliente del cupón debe existir antes del pedido si el
					alcance es &quot;solo cliente&quot;.
				</p>
			</div>

			<div className="glass admin-coupons__form-card">
				<div className="admin-coupons__form-card-head">
					<span className="admin-coupons__form-card-title">{editing ? "Editar cupón" : "Nuevo cupón"}</span>
					{editing ? (
						<button type="button" className="btn-icon-toggle" onClick={resetForm}>
							Cancelar edición
						</button>
					) : null}
				</div>
				<p className="admin-coupons__form-subtitle">{subtitle}</p>

				<div className="admin-coupons__matrix">
					<p
						className="admin-coupons__grid-eyebrow titulo-cupon-section"
						style={{ color: "#000", WebkitTextFillColor: "#000" }}
					>
						Descuento y alcance
					</p>
					<div className="admin-coupons__form-field admin-coupons__cell-span-3">
						<FieldLabel>Código</FieldLabel>
						<input
							className="form-input"
							value={draft.code}
							disabled={saving}
							onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
							placeholder="EJEMPLO15"
						/>
					</div>
					<div className="admin-coupons__form-field admin-coupons__cell-span-3">
						<FieldLabel>Tipo</FieldLabel>
						<select
							className="form-input"
							value={draft.discount_type}
							disabled={saving}
							onChange={(e) => setDraft((d) => ({ ...d, discount_type: e.target.value }))}
						>
							<option value="percent">Porcentaje</option>
							<option value="fixed_amount">Monto fijo</option>
						</select>
					</div>
					<div className="admin-coupons__form-field admin-coupons__cell-span-3">
						<FieldLabel>{draft.discount_type === "percent" ? "Porcentaje" : "Monto (CLP)"}</FieldLabel>
						<input
							type="number"
							min="0"
							step="1"
							className="form-input"
							disabled={saving}
							value={draft.discount_value}
							onChange={(e) => setDraft((d) => ({ ...d, discount_value: e.target.value }))}
						/>
					</div>
					<div className="admin-coupons__form-field admin-coupons__cell-span-3">
						<FieldLabel>Alcance</FieldLabel>
						<select
							className="form-input"
							disabled={saving}
							value={draft.scope}
							onChange={(e) =>
								setDraft((d) => ({
									...d,
									scope: e.target.value,
									restricted_client_id:
										e.target.value === "client_only" ? d.restricted_client_id : "",
								}))
							}
						>
							<option value="global">Global</option>
							<option value="client_only">Solo cliente</option>
						</select>
					</div>

					<p
						className="admin-coupons__grid-eyebrow titulo-cupon-section"
						style={{ color: "#000", WebkitTextFillColor: "#000" }}
					>
						Cliente (cupones restringidos)
					</p>
					<div className="admin-coupons__form-field admin-coupons__cell-full">
						<FieldLabel>Cliente restringido — solo si el alcance es «Solo cliente»</FieldLabel>
						<select
							className="form-input admin-coupons__select-client"
							disabled={saving || draft.scope !== "client_only"}
							value={draft.restricted_client_id}
							onChange={(e) =>
								setDraft((d) => ({ ...d, restricted_client_id: e.target.value }))
							}
						>
							<option value="">— Elegir cliente —</option>
							{clients.map((c) => (
								<option key={c.id} value={c.id}>
									{String(c.name || "").trim() || "(Sin nombre)"} · {String(c.phone || "").trim() || ""}
								</option>
							))}
						</select>
					</div>

					<p
						className="admin-coupons__grid-eyebrow titulo-cupon-section"
						style={{ color: "#000", WebkitTextFillColor: "#000" }}
					>
						Límites y vigencia
					</p>
					<div className="admin-coupons__form-field admin-coupons__cell-span-4">
						<FieldLabel>Mínimo pedido (subtotal ítems)</FieldLabel>
						<input
							type="number"
							min="0"
							className="form-input"
							disabled={saving}
							value={draft.min_order_subtotal}
							onChange={(e) =>
								setDraft((d) => ({
									...d,
									min_order_subtotal: e.target.value,
								}))
							}
						/>
					</div>
					<div className="admin-coupons__form-field admin-coupons__cell-span-4">
						<FieldLabel>Usos máx. totales</FieldLabel>
						<input
							type="number"
							min="1"
							className="form-input"
							disabled={saving}
							placeholder="Sin límite"
							value={draft.max_redemptions}
							onChange={(e) => setDraft((d) => ({ ...d, max_redemptions: e.target.value }))}
						/>
						<span className="admin-coupons__field-hint">Vacío = ilimitado</span>
					</div>
					<div className="admin-coupons__form-field admin-coupons__cell-span-4">
						<FieldLabel>Por cliente</FieldLabel>
						<input
							type="number"
							min="1"
							className="form-input"
							disabled={saving}
							value={draft.max_redemptions_per_client}
							onChange={(e) =>
								setDraft((d) => ({
									...d,
									max_redemptions_per_client: e.target.value,
								}))
							}
						/>
					</div>
					<div className="admin-coupons__form-field admin-coupons__cell-span-6">
						<FieldLabel>Válido desde</FieldLabel>
						<input
							type="datetime-local"
							className="form-input"
							disabled={saving}
							value={draft.valid_from}
							onChange={(e) => setDraft((d) => ({ ...d, valid_from: e.target.value }))}
						/>
					</div>
					<div className="admin-coupons__form-field admin-coupons__cell-span-6">
						<FieldLabel>Válido hasta</FieldLabel>
						<input
							type="datetime-local"
							className="form-input"
							disabled={saving}
							value={draft.valid_until}
							onChange={(e) =>
								setDraft((d) => ({ ...d, valid_until: e.target.value }))
							}
						/>
					</div>

					<label className="admin-coupons__checkbox-row">
						<input
							type="checkbox"
							checked={draft.is_active}
							disabled={saving}
							onChange={(e) =>
								setDraft((d) => ({ ...d, is_active: e.target.checked }))
							}
						/>
						Cupón activo
					</label>
				</div>

				<div className="admin-coupons__form-footer">
					<button
						type="button"
						className="admin-btn primary admin-coupons__submit-btn"
						disabled={saving || loading}
						onClick={() => void submit()}
					>
						{saving ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Plus size={16} aria-hidden />}
						{saving ? "Guardando…" : editing ? "Actualizar cupón" : "Crear cupón"}
					</button>
				</div>
			</div>

			<div className="glass staff-table-glass admin-staff-panel">
				{loading ? (
					<div className="admin-staff-loading admin-coupons__loading">
						<Loader2 size={32} className="animate-spin" aria-hidden />
					</div>
				) : rows.length === 0 ? (
					<p className="admin-staff-empty admin-coupons__panel-empty">No hay cupones aún.</p>
				) : (
					<div className="staff-table-wrapper admin-staff-table-wrap">
						<table className="staff-table admin-staff-table">
							<thead>
								<tr>
									<th>Código</th>
									<th>Desc.</th>
									<th>Alcance</th>
									<th>Estado</th>
									<th>Usos</th>
									<th>Vigencia</th>
									<th />
								</tr>
							</thead>
							<tbody>
								{rows.map((row) => {
									const pct = row.discount_type === "percent";
									const dsc = pct
										? `${Number(row.discount_value)} %`
										: formatCurrency(Number(row.discount_value));
									const vd = formatCouponRowDates(row);
									const mr = row.max_redemptions != null ? String(row.max_redemptions) : "∞";
									const rc = String(row.redemptions_count ?? 0);
									const scopeLbl =
										row.scope === "client_only" && row.restricted_client_id
											? `Cliente: ${clientLabel(row.restricted_client_id)}`
											: "Global";
									return (
										<tr key={row.id}>
											<td>
												<strong>{String(row.code)}</strong>
											</td>
											<td>{dsc}</td>
											<td className="admin-coupons__scope-cell">{scopeLbl}</td>
											<td>
												{row.is_active ? (
													<span className="admin-coupons__status admin-coupons__status--active">Activo</span>
												) : (
													<span className="admin-coupons__status admin-coupons__status--inactive">Inactivo</span>
												)}
											</td>
											<td>
												{rc} / {mr}
											</td>
											<td className="admin-coupons__dates-cell">
												{vd.from}
												<br />
												→ {vd.until}
											</td>
											<td className="admin-coupons__actions-cell">
												<button
													type="button"
													title="Editar"
													className="btn-icon-toggle"
													disabled={saving}
													onClick={() => startEdit(row)}
												>
													<Pencil size={14} aria-hidden />
												</button>
												<button
													type="button"
													title={row.is_active ? "Desactivar" : "Activar"}
													className="btn-icon-toggle"
													disabled={saving}
													onClick={() => void toggleActive(row)}
												>
													{row.is_active ? <Ban size={14} aria-hidden /> : <CircleCheck size={14} aria-hidden />}
												</button>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	);
}
