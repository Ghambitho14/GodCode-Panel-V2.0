import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Save, Trash2, X, Image as ImageIcon } from "lucide-react";
import { parseTagList } from "@/lib/inventory-taxonomy";
import "../styles/AdminMenuCarousel.css";

const BEVERAGE_CATEGORY_PRESETS = [
	"Aguas",
	"Refrescos",
	"Jugos naturales",
	"Té y café",
	"Cervezas",
	"Otros",
];
const EXTRA_CATEGORY_PRESETS = ["Salsas", "Aderezos", "Toppings", "Otros"];

/** Tipo de bebida (independiente del grupo del catálogo). */
const BEVERAGE_KIND_PRESETS = ["Agua", "Refresco", "Jugo natural", "Té y café", "Cerveza", "Otro"];

const INV_TYPE_LABEL = {
	kitchen: "Cocina",
	beverage: "Bebida",
	sellable_extra: "Extra",
	other: "Otro",
};

/**
 * Modal crear/editar ítem de carrito (bebidas / extras), UX alineada con ProductModal.
 */
export default function AdminCartUpsellItemModal({
	isOpen,
	onClose,
	variant,
	item,
	saving,
	existingIds,
	inventoryOptions = [],
	onSubmit,
	onDelete,
}) {
	const isBev = variant === "beverages";
	const categoryPresets = isBev ? BEVERAGE_CATEGORY_PRESETS : EXTRA_CATEGORY_PRESETS;
	const categoryListId = `cart-upsell-cat-${isBev ? "bev" : "ext"}`;
	const beverageKindListId = `cart-upsell-bev-kind-${isBev ? "bev" : "ext"}`;
	const fileInputRef = useRef(null);
	const nameInputRef = useRef(null);

	const suggestId = useCallback(() => {
		const p = isBev ? "bebida" : "extra";
		return `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
	}, [isBev]);

	const [formData, setFormData] = useState({
		id: "",
		name: "",
		price: "",
		category: "",
		beverageKind: "",
		tagsInput: "",
		imageUrl: "",
		active: true,
		inventoryItemId: "",
		maxPerOrder: "",
		unitsPerSale: "1",
	});
	const [localFile, setLocalFile] = useState(null);
	const [previewUrl, setPreviewUrl] = useState("");
	const [isDragging, setIsDragging] = useState(false);
	const [isDirty, setIsDirty] = useState(false);
	const [errors, setErrors] = useState({});

	useEffect(() => {
		if (!isOpen) return;
		const run = () => {
		if (item) {
			const inv = item.inventoryItemId && String(item.inventoryItemId).trim();
			const hasInv = Boolean(inv);
			const tagArr = Array.isArray(item.tags) ? item.tags : [];
			setFormData({
				id: String(item.id ?? ""),
				name: String(item.name ?? ""),
				price: item.price != null && item.price !== "" ? String(item.price) : "",
				category: String(item.category ?? "").trim(),
				beverageKind: String(item.beverageKind ?? item.beverage_kind ?? "").trim(),
				tagsInput: tagArr.filter(Boolean).join(", "),
				imageUrl: String(item.imageUrl ?? item.image_url ?? ""),
				active: item.active !== false,
				inventoryItemId: inv || "",
				maxPerOrder:
					item.maxPerOrder != null && item.maxPerOrder !== ""
						? String(item.maxPerOrder)
						: "",
				unitsPerSale: hasInv
					? String(Math.max(1, Math.min(999, Math.floor(Number(item.unitsPerSale) || 1))))
					: "1",
			});
			const u = String(item.imageUrl ?? item.image_url ?? "").trim();
			setPreviewUrl(u);
		} else {
			let id = suggestId();
			const taken = Array.isArray(existingIds) ? existingIds : [];
			let guard = 0;
			while (taken.includes(id) && guard++ < 64) {
				id = suggestId();
			}
			setFormData({
				id,
				name: "",
				price: "",
				category: "",
				beverageKind: "",
				tagsInput: "",
				imageUrl: "",
				active: true,
				inventoryItemId: "",
				maxPerOrder: "",
				unitsPerSale: "1",
			});
			setPreviewUrl("");
		}
		setLocalFile(null);
		setIsDirty(false);
		setErrors({});
		setTimeout(() => nameInputRef.current?.focus(), 80);
		};

		queueMicrotask(run);
	}, [isOpen, item, suggestId, existingIds, isBev]);

	const handleSafeClose = useCallback(() => {
		if (isDirty && !saving) {
			if (typeof window !== "undefined" && window.confirm("¿Cerrar sin guardar los cambios?")) {
				onClose();
			}
			return;
		}
		onClose();
	}, [isDirty, saving, onClose]);

	const handleChange = (e) => {
		const { name, value, type, checked } = e.target;
		setFormData((prev) => ({
			...prev,
			[name]: type === "checkbox" ? checked : value,
		}));
		setIsDirty(true);
	};

	const handleInventoryChange = (e) => {
		const value = e.target.value;
		setFormData((prev) => ({
			...prev,
			inventoryItemId: value,
			unitsPerSale: value ? prev.unitsPerSale || "1" : "1",
		}));
		setIsDirty(true);
	};

	const processFile = (file) => {
		if (file && file.type.startsWith("image/")) {
			if (file.size > 20 * 1024 * 1024) {
				alert("La imagen es muy pesada (Máx 20MB)");
				return;
			}
			setLocalFile(file);
			setPreviewUrl(URL.createObjectURL(file));
			setFormData((prev) => ({ ...prev, imageUrl: "" }));
			setIsDirty(true);
		}
	};

	const handleFileChange = (e) => processFile(e.target.files?.[0]);
	const handleDragEvents = (e, dragging) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging(dragging);
	};
	const handleDrop = (e) => {
		handleDragEvents(e, false);
		if (e.dataTransfer.files?.[0]) processFile(e.dataTransfer.files[0]);
	};

	const clearImage = (e) => {
		e.stopPropagation();
		if (window.confirm("¿Quitar la imagen actual?")) {
			setLocalFile(null);
			setPreviewUrl("");
			setFormData((prev) => ({ ...prev, imageUrl: "" }));
			setIsDirty(true);
			if (fileInputRef.current) fileInputRef.current.value = "";
		}
	};

	const validate = () => {
		const newErrors = {};
		const id = String(formData.id ?? "").trim();
		const name = String(formData.name ?? "").trim();
		const priceStr = String(formData.price ?? "").replace(",", ".").trim();
		if (!item) {
			if (!id) newErrors.id = "No se pudo preparar el ítem. Cierra e inténtalo de nuevo.";
			if (id && existingIds.includes(id))
				newErrors.id = "Cierra el formulario y vuelve a intentar.";
		}
		if (!name) newErrors.name = "Nombre requerido";
		const price = Number(priceStr);
		if (!Number.isFinite(price) || price < 0) newErrors.price = "Precio inválido (≥ 0)";
		const maxStr = String(formData.maxPerOrder ?? "").trim();
		if (maxStr) {
			const mx = Math.floor(Number(maxStr.replace(",", ".")));
			if (!Number.isFinite(mx) || mx < 1 || mx > 9999) {
				newErrors.maxPerOrder = "Entre 1 y 9999 o déjalo vacío";
			}
		}
		if (formData.inventoryItemId) {
			const u = Math.floor(Number(String(formData.unitsPerSale ?? "").replace(",", ".")));
			if (!Number.isFinite(u) || u < 1 || u > 999) {
				newErrors.unitsPerSale = "Entre 1 y 999";
			}
		}
		setErrors(newErrors);
		return Object.keys(newErrors).length === 0;
	};

	const handleSubmit = (e) => {
		e.preventDefault();
		if (!validate()) return;
		const maxStr = String(formData.maxPerOrder ?? "").trim();
		const maxPerOrder =
			maxStr && Number.isFinite(Math.floor(Number(maxStr.replace(",", "."))))
				? Math.min(9999, Math.max(1, Math.floor(Number(maxStr.replace(",", ".")))))
				: null;
		const invSel = formData.inventoryItemId ? String(formData.inventoryItemId).trim() : "";
		const unitsPerSale = invSel
			? Math.max(1, Math.min(999, Math.floor(Number(String(formData.unitsPerSale).replace(",", ".")) || 1)))
			: 1;
		const category = String(formData.category ?? "").trim().slice(0, 64);
		const beverageKind =
			isBev && String(formData.beverageKind ?? "").trim()
				? String(formData.beverageKind).trim().slice(0, 64)
				: "";
		const tagPieces = String(formData.tagsInput ?? "")
			.split(/[,;]/)
			.map((t) => t.trim())
			.filter(Boolean);
		const tags = parseTagList(tagPieces);
		onSubmit(
			{
				id: item ? String(item.id ?? "").trim() : String(formData.id ?? "").trim(),
				name: String(formData.name ?? "").trim(),
				price: String(formData.price ?? "").replace(",", ".").trim(),
				category,
				beverageKind,
				tags,
				imageUrl: String(formData.imageUrl ?? "").trim(),
				active: formData.active !== false,
				inventoryItemId: invSel || null,
				maxPerOrder,
				unitsPerSale,
			},
			localFile,
		);
	};

	const handleDeleteClick = () => {
		if (!item || typeof onDelete !== "function") return;
		if (window.confirm("¿Eliminar este ítem del catálogo?")) {
			onDelete(item);
		}
	};

	const inventoryOrphanSelected = Boolean(
		formData.inventoryItemId &&
			!inventoryOptions.some((o) => o.id === formData.inventoryItemId),
	);

	if (!isOpen) return null;

	const titleNew = isBev ? "Nueva bebida" : "Nuevo extra";
	const titleEdit = isBev ? "Editar bebida" : "Editar extra";

	return (
		<div className="modal-overlay" onClick={handleSafeClose} role="dialog" aria-modal="true">
			<div
				className="modal-content product-modal-content admin-cart-upsell-item-modal"
				onClick={(e) => e.stopPropagation()}
			>
				<header className="modal-header">
					<div>
						<h3 className="fw-700">{item ? titleEdit : titleNew}</h3>
						<p className="modal-subtitle">
							{item ? "Revisa datos, cantidades y visibilidad." : "Nombre y precio obligatorios; el resto es opcional."}
						</p>
					</div>
					<button type="button" onClick={handleSafeClose} className="btn-close" aria-label="Cerrar">
						<X size={24} />
					</button>
				</header>

				<form onSubmit={handleSubmit} autoComplete="off">
					<div className="modal-form-scroll">
						<div className="admin-cart-upsell-modal-section">
							<h4 className="admin-cart-upsell-modal-section__title">Datos del ítem</h4>
						<div
							className={`product-image-section ${isDragging ? "dragging" : ""} ${errors.image ? "error-border" : ""}`}
							onDragOver={(e) => handleDragEvents(e, true)}
							onDragLeave={(e) => handleDragEvents(e, false)}
							onDrop={handleDrop}
							onClick={() => fileInputRef.current?.click()}
						>
							<input
								type="file"
								ref={fileInputRef}
								onChange={handleFileChange}
								accept="image/jpeg,image/png,image/webp"
								className="hidden"
								style={{ display: "none" }}
							/>
							{previewUrl ? (
								<div className="image-preview-container">
									<img
										src={previewUrl}
										alt=""
										className="image-preview"
										width={400}
										height={300}
									/>
									<div className="image-overlay">
										<button
											type="button"
											className="btn-icon-overlay"
											onClick={clearImage}
											title="Quitar imagen"
										>
											<Trash2 size={18} />
										</button>
										<span className="overlay-text">Click para cambiar</span>
									</div>
								</div>
							) : (
								<div className="dropzone-placeholder">
									<div className="icon-circle">
										<ImageIcon size={28} />
									</div>
									<p className="drop-text">
										Arrastra una imagen o <span>haz click aquí</span>
									</p>
									<p className="drop-hint">JPG, PNG, WEBP (Máx 20MB)</p>
								</div>
							)}
						</div>

						<div className="form-group">
							<label>
								Nombre <span className="req">*</span>
							</label>
							<input
								ref={nameInputRef}
								className={`form-input ${errors.name ? "error" : ""}`}
								name="name"
								value={formData.name}
								onChange={handleChange}
								placeholder={isBev ? "Ej: Coca-Cola 350 ml" : "Ej: Salsa BBQ"}
							/>
							{errors.name && <span className="error-text">{errors.name}</span>}
						</div>

						<div className="form-group">
							<label>
								Precio <span className="req">*</span>
							</label>
							<input
								type="text"
								inputMode="decimal"
								className={`form-input ${errors.price ? "error" : ""}`}
								name="price"
								value={formData.price}
								onChange={handleChange}
								placeholder="0"
							/>
							{errors.price && <span className="error-text">{errors.price}</span>}
						</div>

						<div className="form-group">
							<label htmlFor="cart-upsell-category">Categoría en este catálogo</label>
							<input
								id="cart-upsell-category"
								className="form-input"
								name="category"
								value={formData.category}
								onChange={handleChange}
								list={categoryListId}
								placeholder={isBev ? "Ej. Aguas, Refrescos…" : "Ej. Salsas, Toppings…"}
								maxLength={64}
								autoComplete="off"
							/>
							<datalist id={categoryListId}>
								{categoryPresets.map((p) => (
									<option key={p} value={p} />
								))}
							</datalist>
							<small className="admin-cart-upsell-modal-hint">
								{isBev
									? "Solo agrupa bebidas (aguas, refrescos…). No es la categoría de insumos del inventario."
									: "Solo agrupa extras (salsas, aderezos…). Puedes escribir una categoría nueva."}
							</small>
						</div>

						{isBev ? (
							<div className="form-group">
								<label htmlFor="cart-upsell-bev-kind">Tipo de bebida</label>
								<input
									id="cart-upsell-bev-kind"
									className="form-input"
									name="beverageKind"
									value={formData.beverageKind}
									onChange={handleChange}
									list={beverageKindListId}
									placeholder="Ej. Refresco"
									maxLength={64}
									autoComplete="off"
								/>
								<datalist id={beverageKindListId}>
									{BEVERAGE_KIND_PRESETS.map((p) => (
										<option key={p} value={p} />
									))}
								</datalist>
								<small className="admin-cart-upsell-modal-hint">
									Independiente del grupo del catálogo (Refrescos, Aguas…). Sirve para reportes y coherencia
									con inventario.
								</small>
							</div>
						) : null}

						{!item && errors.id && <p className="error-text" role="alert">{errors.id}</p>}
						</div>

						<div className="admin-cart-upsell-modal-section">
							<h4 className="admin-cart-upsell-modal-section__title">Inventario (opcional)</h4>
							<div className="form-group">
								<label>Vincular a insumo de la empresa</label>
								<select
									className="form-input"
									value={formData.inventoryItemId}
									onChange={handleInventoryChange}
									disabled={inventoryOptions.length === 0 && !formData.inventoryItemId}
								>
									<option value="">Sin vincular (solo menú)</option>
									{inventoryOrphanSelected && (
										<option value={formData.inventoryItemId}>
											Insumo guardado (revisa sucursal en inventario)
										</option>
									)}
									{inventoryOptions.map((o) => (
										<option key={o.id} value={o.id}>
											{o.name} — {o.stock} {o.unit}
											{o.item_type ? ` (${INV_TYPE_LABEL[o.item_type] || o.item_type})` : ""}
										</option>
									))}
								</select>
								<small className="admin-cart-upsell-modal-hint">
									{isBev
										? "Recomendado: insumo con tipo «Bebida» en inventario. Si hay vínculo, cada venta descuenta stock."
										: "Si hay vínculo, cada venta descuenta stock en esta sucursal."}
								</small>
							</div>

							{formData.inventoryItemId ? (
								<div className="form-group">
									<label>
										Stock que resta cada unidad vendida <span className="req">*</span>
									</label>
									<input
										type="text"
										inputMode="numeric"
										className={`form-input ${errors.unitsPerSale ? "error" : ""}`}
										name="unitsPerSale"
										value={formData.unitsPerSale}
										onChange={handleChange}
										placeholder="1"
									/>
									{errors.unitsPerSale && <span className="error-text">{errors.unitsPerSale}</span>}
									<small className="admin-cart-upsell-modal-hint">
										Por ejemplo 1 si cada venta descuenta una unidad del insumo.
									</small>
								</div>
							) : null}

							<div className="form-group">
								<label>Máximo por pedido (opcional)</label>
								<input
									type="text"
									inputMode="numeric"
									className={`form-input ${errors.maxPerOrder ? "error" : ""}`}
									name="maxPerOrder"
									value={formData.maxPerOrder}
									onChange={handleChange}
									placeholder="Sin tope extra"
								/>
								{errors.maxPerOrder && <span className="error-text">{errors.maxPerOrder}</span>}
								<small className="admin-cart-upsell-modal-hint">
									Tope para el cliente por ítem. Si hay insumo vinculado, también se respeta el stock.
								</small>
							</div>
						</div>

						<div className="admin-cart-upsell-modal-section admin-cart-upsell-modal-section--compact">
							<h4 className="admin-cart-upsell-modal-section__title">Más opciones</h4>
						<div className="form-group">
							<label>URL de imagen (opcional)</label>
							<input
								className="form-input"
								name="imageUrl"
								value={formData.imageUrl}
								onChange={handleChange}
								placeholder="https://…"
								disabled={Boolean(localFile)}
								autoComplete="off"
							/>
							<small className="admin-cart-upsell-modal-hint">Solo si no subes archivo arriba.</small>
						</div>
						</div>

						<div className="admin-cart-upsell-modal-section">
							<h4 className="admin-cart-upsell-modal-section__title">Visibilidad</h4>
							<div
								className={`product-modal-switch-row${formData.active ? " product-modal-switch-row--offer-on" : ""}`}
							>
								<div className="switch-content">
									<span className="switch-title">Visible en carrito</span>
									<span className="switch-desc">Si está apagado, el cliente no lo verá en la lista</span>
								</div>
								<button
									type="button"
									className={`menu-carousel-switch menu-carousel-switch--sm${formData.active ? " is-on" : ""}`}
									role="switch"
									aria-checked={formData.active}
									aria-label={formData.active ? "Ocultar en carrito" : "Visible en carrito"}
									onClick={() => {
										setFormData((prev) => ({ ...prev, active: !prev.active }));
										setIsDirty(true);
									}}
								>
									<span className="menu-carousel-switch-knob" aria-hidden />
								</button>
							</div>
						</div>
					</div>

					<footer className="modal-footer">
						<div className="modal-footer__start">
							{item && typeof onDelete === "function" && (
								<button
									type="button"
									className="btn btn-ghost text-danger"
									onClick={handleDeleteClick}
									disabled={saving}
								>
									<Trash2 size={18} />
									Eliminar
								</button>
							)}
						</div>
						<div className="modal-footer__end">
							<button type="button" onClick={handleSafeClose} className="btn btn-secondary" disabled={saving}>
								Cancelar
							</button>
							<button type="submit" className="btn btn-primary" disabled={saving}>
								{saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
								<span>{saving ? "Guardando…" : "Guardar"}</span>
							</button>
						</div>
					</footer>
				</form>
			</div>
		</div>
	);
}
