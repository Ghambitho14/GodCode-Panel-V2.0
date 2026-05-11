import React, { useCallback, useEffect, useMemo, useState } from "react";
import "../styles/AdminMenuOptions.css";
import "../styles/AdminMenuCarousel.css";
import { CupSoda, Edit3, Eye, EyeOff, Loader2, Package, Plus, Sparkles, Trash2, X } from "lucide-react";
import { supabase, TABLES } from "@/integrations/supabase";
import { uploadImage, validateImageFile } from "@/shared/utils/cloudinary";
import {
	CART_UPSELL_MAX_ITEMS,
	cartUpsellEffectiveMaxPerOrder,
} from "@/lib/delivery-settings";
import { parseTagList } from "@/lib/inventory-taxonomy";
import { branchSettingsService } from "@/modules/cash/services/branchSettingsService";
import AdminHelpTip from "./AdminHelpTip";
import AdminCartUpsellItemModal from "./AdminCartUpsellItemModal";

const PLACEHOLDER_IMG = "/tenant/logo-placeholder.svg";

function branchFlag(map, branchId, defaultOn = true) {
	if (!branchId || !map || typeof map !== "object") return defaultOn;
	if (Object.prototype.hasOwnProperty.call(map, branchId)) {
		return map[branchId] !== false;
	}
	return defaultOn;
}

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normInvUuid(raw) {
	if (raw == null || raw === "") return null;
	const s = String(raw).trim();
	if (!s || !UUID_RE.test(s)) return null;
	return s.toLowerCase();
}

function normalizeItemsFromApi(catalog) {
	if (!Array.isArray(catalog)) return [];
	return catalog
		.map((row) => {
			const rawInv = row.inventoryItemId ?? row.inventory_item_id;
			const inventoryItemId = normInvUuid(rawInv);
			let maxPerOrder = null;
			const m = row.maxPerOrder ?? row.max_per_order;
			if (m != null && Number.isFinite(Number(m))) {
				maxPerOrder = Math.min(9999, Math.max(1, Math.floor(Number(m))));
			}
			let unitsPerSale = Math.max(
				1,
				Math.min(999, Math.floor(Number(row.unitsPerSale ?? row.units_per_sale) || 1)),
			);
			if (!inventoryItemId) unitsPerSale = 1;
			const catRaw = row.category ?? row.catalogCategory ?? row.group;
			const category =
				typeof catRaw === "string" ? catRaw.trim().slice(0, 64) : "";
			const bkRaw = row.beverageKind ?? row.beverage_kind;
			const beverageKind =
				typeof bkRaw === "string" ? bkRaw.trim().slice(0, 64) : "";
			const tags = parseTagList(row.tags ?? row.catalogTags);
			return {
				id: String(row.id ?? "").trim(),
				name: String(row.name ?? "").trim(),
				price: Number(row.price) || 0,
				imageUrl: String(row.imageUrl ?? row.image_url ?? "").trim(),
				active: row.active !== false,
				category,
				beverageKind,
				tags,
				inventoryItemId,
				maxPerOrder,
				unitsPerSale,
			};
		})
		.filter((row) => row.id && row.name);
}

/**
 * @param {{ variant: 'beverages' | 'extras', showNotify: function, selectedBranch: object, companyId?: string, onSaved?: function }} props
 */
export default function AdminMenuCartUpsellSection({
	variant,
	showNotify,
	selectedBranch,
	companyId = "",
	onSaved,
}) {
	const isBev = variant === "beverages";
	const branchId = selectedBranch?.id ?? "";
	const effectiveCompanyId = String(companyId || selectedBranch?.company_id || "").trim();

	const cfg = useMemo(() => {
		if (isBev) {
			return {
				pageTitle: "Bebidas en carrito",
				pageLead:
					"Agrupa por categoría propia (aguas, refrescos, jugos…) — no comparten categorías con los insumos del inventario.",
				pageHelp:
					"Categoría agrupa en el carrito (Refrescos, Aguas…). Elige el tipo de bebida (Refresco, Agua…). Opcional: vincula un insumo tipo Bebida para descontar stock al vender.",
				Icon: CupSoda,
				newLabel: "Nueva bebida",
				saveSuccess: "Bebidas actualizadas.",
				helpToggle:
					"Si está activo, el cliente puede ver y elegir estas bebidas en el flujo del carrito en esta sucursal.",
			};
		}
		return {
			pageTitle: "Extras en carrito",
			pageLead:
				"Pueden ser complementos solo de menú o enlazarse a un insumo que ya controlas en inventario (salsas, toppings…).",
			pageHelp:
				"Categorías aparte (salsas, aderezos…). El vínculo a insumo es opcional: sirve para descontar stock al vender.",
			Icon: Sparkles,
			newLabel: "Nuevo extra",
			saveSuccess: "Extras actualizados.",
			helpToggle: "Extras opcionales ofrecidos en el carrito para esta sucursal.",
		};
	}, [isBev]);

	const [loading, setLoading] = useState(!!branchId);
	const [saving, setSaving] = useState(false);
	const [sectionOn, setSectionOn] = useState(true);
	const [items, setItems] = useState([]);
	const [modalOpen, setModalOpen] = useState(false);
	const [editingIndex, setEditingIndex] = useState(null);
	const [imgBroken, setImgBroken] = useState({});
	const [inventoryOptions, setInventoryOptions] = useState([]);
	const [pickInventoryOpen, setPickInventoryOpen] = useState(false);
	const [pickInvSearch, setPickInvSearch] = useState("");

	const stockByInventoryId = useMemo(() => {
		const m = {};
		for (const o of inventoryOptions) m[String(o.id).toLowerCase()] = o.stock;
		return m;
	}, [inventoryOptions]);

	const refreshInventoryOptions = useCallback(async () => {
		if (!branchId || !effectiveCompanyId) {
			setInventoryOptions([]);
			return;
		}
		try {
			const { data: allItems, error: e1 } = await supabase
				.from(TABLES.inventory_items)
				.select("id, name, unit, item_type")
				.eq("company_id", effectiveCompanyId)
				.order("name");
			if (e1) throw e1;
			const { data: branchStock, error: e2 } = await supabase
				.from(TABLES.inventory_branch)
				.select("inventory_item_id, current_stock")
				.eq("branch_id", branchId);
			if (e2) throw e2;
			const stockMap = new Map(
				(branchStock || []).map((s) => [
					String(s.inventory_item_id).toLowerCase(),
					Number(s.current_stock) || 0,
				]),
			);
			const opts = (allItems || []).map((it) => ({
				id: it.id,
				name: String(it.name ?? "").trim() || "Sin nombre",
				unit: String(it.unit ?? "un").trim() || "un",
				item_type: String(it.item_type || "kitchen").trim() || "kitchen",
				stock: stockMap.has(String(it.id).toLowerCase())
					? (stockMap.get(String(it.id).toLowerCase()) ?? 0)
					: 0,
			}));
			opts.sort((a, b) => a.name.localeCompare(b.name, "es"));
			setInventoryOptions(opts);
		} catch {
			setInventoryOptions([]);
		}
	}, [branchId, effectiveCompanyId]);

	useEffect(() => {
		void refreshInventoryOptions();
	}, [refreshInventoryOptions]);

	useEffect(() => {
		if (!branchId) return;
		const ch = `cart-upsell-inv-${branchId}`;
		const channel = supabase
			.channel(ch)
			.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table: TABLES.inventory_branch,
					filter: `branch_id=eq.${branchId}`,
				},
				() => {
					void refreshInventoryOptions();
				},
			)
			.subscribe();
		return () => {
			try {
				supabase.removeChannel(channel);
			} catch {
				/* ignore */
			}
		};
	}, [branchId, refreshInventoryOptions]);

	const applyPayload = useCallback(
		(data) => {
			if (isBev) {
				setSectionOn(branchFlag(data.beveragesUpsellEnabledByBranch, branchId, true));
				setItems(normalizeItemsFromApi(data.cartBeveragesCatalog));
			} else {
				setSectionOn(branchFlag(data.extrasEnabledByBranch, branchId, true));
				setItems(normalizeItemsFromApi(data.cartGlobalExtrasCatalog));
			}
			setImgBroken({});
		},
		[branchId, isBev],
	);

	const load = useCallback(async () => {
		if (!branchId) {
			setLoading(false);
			return;
		}
		setLoading(true);
		try {
			const data = await branchSettingsService.getDeliverySettings(branchId);
			if (!data) throw new Error("Sucursal no encontrada");
			applyPayload(data);
		} catch (e) {
			showNotify(e instanceof Error ? e.message : "Error al cargar", "error");
			setItems([]);
		} finally {
			setLoading(false);
		}
	}, [branchId, showNotify, applyPayload]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (!branchId) return;
		const ch = `branch-delivery-upsell-${variant}-${branchId}`;
		const channel = supabase
			.channel(ch)
			.on(
				"postgres_changes",
				{ event: "UPDATE", schema: "public", table: "branches", filter: `id=eq.${branchId}` },
				() => {
					void load();
				},
			)
			.subscribe();
		return () => {
			try {
				supabase.removeChannel(channel);
			} catch {}
		};
	}, [branchId, load, variant]);

	const persistCatalog = useCallback(
		async (nextItems) => {
			if (!branchId) return;
			if (nextItems.length > CART_UPSELL_MAX_ITEMS) {
				showNotify(`Máximo ${CART_UPSELL_MAX_ITEMS} ítems en este catálogo.`, "error");
				return;
			}
			const seen = new Set();
			for (const row of nextItems) {
				if (seen.has(row.id)) {
					showNotify("Hay ids duplicados en el catálogo.", "error");
					return;
				}
				seen.add(row.id);
			}
			const catalog = nextItems.map((i) => {
				const inventoryItemId = normInvUuid(i.inventoryItemId);
				let maxPerOrder = null;
				if (i.maxPerOrder != null && Number.isFinite(Number(i.maxPerOrder))) {
					maxPerOrder = Math.min(9999, Math.max(1, Math.floor(Number(i.maxPerOrder))));
				}
				const unitsPerSale = inventoryItemId
					? Math.max(1, Math.min(999, Math.floor(Number(i.unitsPerSale) || 1)))
					: 1;
				const category =
					typeof i.category === "string" ? i.category.trim().slice(0, 64) : "";
				const beverageKind =
					isBev && typeof i.beverageKind === "string"
						? i.beverageKind.trim().slice(0, 64)
						: "";
				const tags = parseTagList(i.tags);
				const row = {
					id: i.id.slice(0, 128),
					name: i.name.slice(0, 160),
					price: Math.max(0, Number(i.price) || 0),
					imageUrl: (i.imageUrl || "").trim().slice(0, 2048),
					active: i.active !== false,
					category,
					tags,
					inventoryItemId,
					maxPerOrder,
					unitsPerSale,
				};
				if (isBev && beverageKind) row.beverageKind = beverageKind;
				return row;
			});
			setSaving(true);
			try {
				const body = {};
				if (isBev) {
					body.beveragesUpsellEnabledByBranch = { [branchId]: sectionOn };
					body.cartBeveragesCatalog = catalog;
				} else {
					body.extrasEnabledByBranch = { [branchId]: sectionOn };
					body.cartGlobalExtrasCatalog = catalog;
				}
				const data = await branchSettingsService.saveDeliverySettings(branchId, body);
				applyPayload(data);
				showNotify(cfg.saveSuccess);
				if (typeof onSaved === "function") onSaved();
				setModalOpen(false);
				setEditingIndex(null);
			} catch (e) {
				showNotify(e instanceof Error ? e.message : "Error al guardar", "error");
				void load();
			} finally {
				setSaving(false);
			}
		},
		[branchId, isBev, sectionOn, applyPayload, showNotify, onSaved, cfg.saveSuccess, load],
	);

	const catalogGroups = useMemo(() => {
		const sorted = [...items].sort((a, b) => {
			const ca = String(a.category || "").trim().toLowerCase();
			const cb = String(b.category || "").trim().toLowerCase();
			if (ca !== cb) {
				if (!ca) return 1;
				if (!cb) return -1;
				return ca.localeCompare(cb, "es");
			}
			return String(a.name || "").localeCompare(String(b.name || ""), "es");
		});
		const groups = [];
		for (const it of sorted) {
			const raw = String(it.category || "").trim();
			const label = raw || "Sin categoría";
			const last = groups[groups.length - 1];
			if (!last || last.label !== label) {
				groups.push({ label, items: [it] });
			} else {
				last.items.push(it);
			}
		}
		return groups;
	}, [items]);

	const persistSectionOnly = useCallback(
		async (nextOn) => {
			if (!branchId) return;
			setSaving(true);
			try {
				const body = {};
				if (isBev) body.beveragesUpsellEnabledByBranch = { [branchId]: nextOn };
				else body.extrasEnabledByBranch = { [branchId]: nextOn };
				const data = await branchSettingsService.saveDeliverySettings(branchId, body);
				applyPayload(data);
				showNotify(nextOn ? "Sección activada para clientes." : "Sección desactivada para clientes.");
				if (typeof onSaved === "function") onSaved();
			} catch (e) {
				showNotify(e instanceof Error ? e.message : "Error al guardar", "error");
				void load();
			} finally {
				setSaving(false);
			}
		},
		[branchId, isBev, applyPayload, showNotify, onSaved, load],
	);

	const modalItem = editingIndex !== null ? items[editingIndex] ?? null : null;

	const occupiedIds = useMemo(() => {
		if (editingIndex === null) return items.map((i) => i.id);
		return items.filter((_, idx) => idx !== editingIndex).map((i) => i.id);
	}, [items, editingIndex]);

	const ITEM_TYPE_SHORT = {
		kitchen: "Cocina",
		beverage: "Bebida",
		sellable_extra: "Extra",
		other: "Otro",
	};

	const suggestExtraId = () =>
		`extra-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

	const appendExtraFromInventoryRow = async (inv) => {
		if (!inv?.id || isBev) return;
		if (items.some((x) => normInvUuid(x.inventoryItemId) === normInvUuid(inv.id))) {
			showNotify("Ese insumo ya está en el catálogo de extras.", "error");
			return;
		}
		if (items.length >= CART_UPSELL_MAX_ITEMS) {
			showNotify(`Máximo ${CART_UPSELL_MAX_ITEMS} ítems.`, "error");
			return;
		}
		let id = suggestExtraId();
		let guard = 0;
		const taken = new Set(items.map((i) => i.id));
		while (taken.has(id) && guard++ < 64) id = suggestExtraId();
		const newItem = {
			id,
			name: inv.name,
			price: 0,
			imageUrl: "",
			active: true,
			category: "Extras",
			beverageKind: "",
			tags: [],
			inventoryItemId: inv.id,
			maxPerOrder: null,
			unitsPerSale: 1,
		};
		setPickInventoryOpen(false);
		setPickInvSearch("");
		await persistCatalog([...items, newItem]);
		showNotify("Extra añadido desde inventario. Revisa precio e imagen.");
	};

	const pickInventoryCandidates = useMemo(() => {
		const q = pickInvSearch.trim().toLowerCase();
		return inventoryOptions.filter((o) => {
			if (!q) return true;
			return o.name.toLowerCase().includes(q);
		});
	}, [inventoryOptions, pickInvSearch]);

	const openCreate = () => {
		setEditingIndex(null);
		setModalOpen(true);
	};

	const openEdit = (idx) => {
		setEditingIndex(idx);
		setModalOpen(true);
	};

	const openEditForItem = (catalogItem) => {
		const idx = items.findIndex((i) => i.id === catalogItem.id);
		if (idx < 0) return;
		setEditingIndex(idx);
		setModalOpen(true);
	};

	const closeModal = () => {
		if (saving) return;
		setModalOpen(false);
		setEditingIndex(null);
	};

	const handleModalSubmit = async (draft, localFile) => {
		let imageUrl = String(draft.imageUrl ?? "").trim();
		if (localFile) {
			const v = validateImageFile(localFile);
			if (!v.valid) {
				showNotify(v.error || "Archivo no válido", "error");
				return;
			}
			try {
				imageUrl = await uploadImage(localFile, "menu");
			} catch (err) {
				showNotify(err instanceof Error ? err.message : "Error al subir imagen", "error");
				return;
			}
		}
		const price = Number(String(draft.price).replace(",", "."));
		if (!Number.isFinite(price) || price < 0) {
			showNotify("Precio inválido.", "error");
			return;
		}
		const inventoryItemId = normInvUuid(draft.inventoryItemId);
		let maxPerOrder = null;
		if (draft.maxPerOrder != null && draft.maxPerOrder !== "") {
			const mx = Math.floor(Number(draft.maxPerOrder));
			if (Number.isFinite(mx) && mx >= 1) maxPerOrder = Math.min(9999, mx);
		}
		const unitsPerSale = inventoryItemId
			? Math.max(1, Math.min(999, Math.floor(Number(draft.unitsPerSale) || 1)))
			: 1;
		const category =
			typeof draft.category === "string" ? draft.category.trim().slice(0, 64) : "";
		const beverageKind =
			isBev && typeof draft.beverageKind === "string"
				? draft.beverageKind.trim().slice(0, 64)
				: "";
		const tags = parseTagList(draft.tags);
		const newItem = {
			id: draft.id.trim().slice(0, 128),
			name: draft.name.trim().slice(0, 160),
			price,
			imageUrl: imageUrl.slice(0, 2048),
			active: draft.active !== false,
			category,
			beverageKind,
			tags,
			inventoryItemId,
			maxPerOrder,
			unitsPerSale,
		};
		let next;
		if (editingIndex !== null) {
			next = items.map((x, i) => (i === editingIndex ? newItem : x));
		} else {
			if (items.length >= CART_UPSELL_MAX_ITEMS) {
				showNotify(`Máximo ${CART_UPSELL_MAX_ITEMS} ítems.`, "error");
				return;
			}
			next = [...items, newItem];
		}
		await persistCatalog(next);
	};

	const handleModalDelete = async (item) => {
		const next = items.filter((i) => i.id !== item.id);
		await persistCatalog(next);
	};

	const toggleItemActive = async (e, catalogItem) => {
		e.stopPropagation();
		if (!sectionOn || saving) return;
		const next = items.map((x) =>
			x.id === catalogItem.id ? { ...x, active: !(x.active !== false) } : x,
		);
		await persistCatalog(next);
	};

	const formatPrice = (p) => {
		const cur = String(selectedBranch?.currency || "CLP")
			.trim()
			.toUpperCase();
		if (/^[A-Z]{3}$/.test(cur)) {
			try {
				return new Intl.NumberFormat("es-CL", {
					style: "currency",
					currency: cur,
					maximumFractionDigits: 0,
				}).format(p);
			} catch {
				/* ignore */
			}
		}
		return `$${p}`;
	};

	const countActive = items.filter((i) => i.active !== false).length;
	const summary = !sectionOn
		? isBev
			? "Bebidas desactivadas para clientes en esta sucursal."
			: "Extras desactivados para clientes en esta sucursal."
		: isBev
			? `${countActive} activas · ${items.length} en catálogo`
			: `${countActive} activos · ${items.length} en catálogo`;

	const { pageTitle, pageLead, pageHelp, Icon, newLabel, helpToggle } = cfg;
	const lockUi = loading || saving;

	if (!branchId) {
		return (
			<section className="glass animate-fade admin-menu-options-card admin-menu-options-cart-upsell">
				<p className="admin-menu-options-card-desc" style={{ margin: 0 }}>
					Selecciona una <strong style={{ color: "white" }}>sucursal</strong> en el encabezado para configurar{" "}
					{isBev ? "las bebidas" : "los extras"} del carrito.
				</p>
			</section>
		);
	}

	return (
		<section
			className="admin-menu-options-cart-upsell"
			aria-busy={loading}
			data-loading={loading ? "true" : "false"}
			data-variant={variant}
		>
			<div className="admin-cart-upsell-toolbar glass animate-fade">
				<div className="admin-cart-upsell-toolbar__text">
					<div className="admin-cart-upsell-page-head">
						<div className="admin-menu-options-card-icon admin-cart-upsell-page-icon" aria-hidden>
							<Icon size={24} strokeWidth={1.65} />
						</div>
						<div className="admin-cart-upsell-page-head__copy">
							<div className="admin-cart-upsell-page-title-row">
								<h2 className="admin-cart-upsell-page-title">{pageTitle}</h2>
								<AdminHelpTip text={pageHelp} className="admin-menu-options-section-label--with-tip" />
							</div>
							<p className="admin-cart-upsell-page-lead">{pageLead}</p>
						</div>
					</div>
				</div>
				<div className="admin-cart-upsell-toolbar__actions">
					{!isBev ? (
						<button
							type="button"
							className="btn btn-secondary admin-cart-upsell-toolbar__cta-secondary"
							disabled={lockUi || !sectionOn || items.length >= CART_UPSELL_MAX_ITEMS}
							onClick={() => {
								setPickInvSearch("");
								setPickInventoryOpen(true);
							}}
						>
							<Package size={18} strokeWidth={1.65} aria-hidden />
							Desde inventario
						</button>
					) : null}
					<button
						type="button"
						className="btn btn-primary admin-cart-upsell-toolbar__cta"
						disabled={lockUi || !sectionOn || items.length >= CART_UPSELL_MAX_ITEMS}
						onClick={openCreate}
					>
						<Plus size={18} strokeWidth={1.65} aria-hidden />
						{newLabel}
					</button>
				</div>
			</div>

			{loading && (
				<div className="admin-menu-options-cart-loading glass animate-fade" aria-live="polite">
					<Loader2 className="animate-spin" size={20} aria-hidden style={{ marginRight: 8 }} />
					Cargando…
				</div>
			)}

			<div
				className={`admin-menu-options-card glass animate-fade admin-menu-options-cart-block ${
					!sectionOn ? "admin-menu-options-cart-block--dim" : ""
				}`}
			>
				<div className="admin-menu-options-card-head admin-menu-options-card-head--delivery admin-cart-upsell-catalog-head">
					<div className="admin-cart-upsell-catalog-head__main">
						<h3 className="admin-cart-upsell-catalog-title">Catálogo</h3>
						<p className="admin-cart-upsell-catalog-summary">{summary}</p>
					</div>
					<div className="admin-cart-upsell-catalog-toggle">
						<div className="admin-cart-upsell-catalog-toggle__text">
							<span className="admin-cart-upsell-catalog-toggle__label">Mostrar en carrito</span>
							<AdminHelpTip text={helpToggle} className="admin-menu-options-section-label--with-tip" />
						</div>
						<button
							type="button"
							className={`menu-carousel-switch admin-cart-upsell-catalog-switch ${sectionOn ? "is-on" : ""}`}
							disabled={lockUi}
							onClick={() => void persistSectionOnly(!sectionOn)}
							aria-pressed={sectionOn}
							aria-label={sectionOn ? "Desactivar sección en carrito para clientes" : "Activar sección en carrito para clientes"}
						>
							<span className="menu-carousel-switch-knob" />
						</button>
					</div>
				</div>

				{!sectionOn && (
					<p className="admin-menu-options-cart-muted">
						Activa esta sección para mostrar el catálogo y poder editar.
					</p>
				)}

				{sectionOn && items.length === 0 && !loading && (
					<div className="admin-menu-options-cart-empty admin-cart-upsell-empty">
						<p>Aún no hay ítems. Crea el primero con el botón «{newLabel}».</p>
						<button
							type="button"
							className="btn btn-primary"
							disabled={lockUi}
							onClick={openCreate}
						>
							<Plus size={18} strokeWidth={1.65} aria-hidden />
							{newLabel}
						</button>
					</div>
				)}

				{sectionOn && items.length > 0 && (
					<div className="admin-cart-upsell-catalog-groups">
						{catalogGroups.map((group) => (
							<div key={group.label} className="admin-cart-upsell-category-block">
								<h4 className="admin-cart-upsell-category-block__title">{group.label}</h4>
								<div className="admin-cart-upsell-grid">
									{group.items.map((item) => {
										const url =
											item.imageUrl && /^https?:\/\//i.test(item.imageUrl) ? item.imageUrl : null;
										const broken = imgBroken[item.id];
										const showImg = url && !broken;
										const invKey =
											item.inventoryItemId != null && String(item.inventoryItemId).trim()
												? String(item.inventoryItemId).trim().toLowerCase()
												: null;
										const invMeta = invKey
											? inventoryOptions.find(
													(o) => String(o.id).toLowerCase() === invKey,
												)
											: null;
										const branchStock =
											invKey != null ? (stockByInventoryId[invKey] ?? null) : null;
										const effMax = cartUpsellEffectiveMaxPerOrder(
											{
												inventoryItemId: item.inventoryItemId ?? null,
												maxPerOrder: item.maxPerOrder ?? null,
												unitsPerSale: Math.max(1, item.unitsPerSale || 1),
											},
											branchStock,
										);
										let stockStatTone = "muted";
										let stockStatMain = "—";
										let stockStatSub = "Sin inventario";
										if (item.inventoryItemId) {
											if (!invMeta) {
												stockStatMain = "—";
												stockStatSub = "Revisa inventario";
												stockStatTone = "warn";
											} else {
												const n = branchStock ?? 0;
												stockStatMain = String(n);
												stockStatSub = invMeta.unit;
												stockStatTone = n <= 0 ? "out" : "ok";
											}
										} else {
											stockStatSub = isBev ? "Sin vínculo" : "Opcional";
										}
										let limitStatTone = "muted";
										let limitStatMain;
										let limitStatSub;
										if (effMax != null) {
											limitStatMain = `Hasta ${effMax}`;
											limitStatSub = "por pedido";
											limitStatTone = "ok";
										} else if (item.inventoryItemId) {
											limitStatMain = "Según stock";
											limitStatSub = "sin tope manual";
											limitStatTone = "muted";
										} else {
											limitStatMain = "Sin tope";
											limitStatSub = "por ítem";
											limitStatTone = "muted";
										}
										return (
											<div
												key={item.id}
												className={`admin-cart-upsell-card glass ${item.active === false ? "is-inactive" : ""}`}
												role="button"
												tabIndex={0}
												onClick={() => openEditForItem(item)}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === " ") {
														e.preventDefault();
														openEditForItem(item);
													}
												}}
												aria-label={`Editar ${item.name}`}
											>
												<div className="admin-cart-upsell-card__img-wrap">
													{showImg ? (
														<img
															src={url}
															alt=""
															className="admin-cart-upsell-card__img"
															onError={() => setImgBroken((m) => ({ ...m, [item.id]: true }))}
														/>
													) : (
														<img
															src={PLACEHOLDER_IMG}
															alt=""
															className="admin-cart-upsell-card__img admin-cart-upsell-card__img--placeholder"
														/>
													)}
													<button
														type="button"
														className={`admin-cart-upsell-card__status ${item.active !== false ? "is-on" : ""}`}
														onClick={(e) => void toggleItemActive(e, item)}
														disabled={lockUi}
														title={item.active !== false ? "Pausar en carrito" : "Activar en carrito"}
														aria-label={item.active !== false ? "Pausar" : "Activar"}
													>
														{item.active !== false ? <Eye size={16} /> : <EyeOff size={16} />}
													</button>
												</div>
												<div className="admin-cart-upsell-card__body">
													<div className="admin-cart-upsell-card__title-row">
														<h4 className="admin-cart-upsell-card__title">{item.name}</h4>
														<p className="admin-cart-upsell-card__price">{formatPrice(item.price)}</p>
													</div>
													<div className="admin-cart-upsell-card__stats" aria-label="Cantidades">
														<div
															className={`admin-cart-upsell-card__stat admin-cart-upsell-card__stat--${stockStatTone}`}
														>
															<span className="admin-cart-upsell-card__stat-label">Stock</span>
															<span className="admin-cart-upsell-card__stat-value">{stockStatMain}</span>
															<span className="admin-cart-upsell-card__stat-sub">{stockStatSub}</span>
														</div>
														<div
															className={`admin-cart-upsell-card__stat admin-cart-upsell-card__stat--${limitStatTone}`}
														>
															<span className="admin-cart-upsell-card__stat-label">Límite cliente</span>
															<span className="admin-cart-upsell-card__stat-value">{limitStatMain}</span>
															<span className="admin-cart-upsell-card__stat-sub">{limitStatSub}</span>
														</div>
													</div>
													<div className="admin-cart-upsell-card__actions">
														<button
															type="button"
															className="btn btn-secondary btn-sm admin-cart-upsell-card__btn-primary"
															onClick={(e) => {
																e.stopPropagation();
																openEditForItem(item);
															}}
														>
															<Edit3 size={16} strokeWidth={1.65} aria-hidden />
															Editar
														</button>
														<button
															type="button"
															className="btn btn-ghost btn-sm admin-cart-upsell-card__btn-danger"
															onClick={(e) => {
																e.stopPropagation();
																if (window.confirm(`¿Eliminar «${item.name}»?`)) {
																	void handleModalDelete(item);
																}
															}}
															disabled={lockUi}
															title="Eliminar del catálogo"
															aria-label={`Eliminar ${item.name}`}
														>
															<Trash2 size={16} strokeWidth={1.65} aria-hidden />
														</button>
													</div>
												</div>
											</div>
										);
									})}
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{modalOpen && (
				<AdminCartUpsellItemModal
					isOpen={modalOpen}
					onClose={closeModal}
					variant={variant}
					item={modalItem}
					saving={saving}
					existingIds={occupiedIds}
					inventoryOptions={inventoryOptions}
					onSubmit={(payload, file) => void handleModalSubmit(payload, file)}
					onDelete={modalItem ? (it) => void handleModalDelete(it) : undefined}
				/>
			)}

			{pickInventoryOpen && !isBev ? (
				<div
					className="modal-overlay"
					onClick={() => {
						if (!saving) setPickInventoryOpen(false);
					}}
					role="presentation"
				>
					<div
						className="modal-content product-modal-content admin-cart-upsell-pick-inv"
						onClick={(e) => e.stopPropagation()}
						role="dialog"
						aria-modal="true"
						aria-labelledby="cart-pick-inv-title"
					>
						<header className="modal-header">
							<div>
								<h3 id="cart-pick-inv-title">Añadir extra desde inventario</h3>
								<p className="modal-subtitle">
									Se crea una línea en el carrito con el insumo vinculado; ajusta precio e imagen después.
								</p>
							</div>
							<button
								type="button"
								onClick={() => !saving && setPickInventoryOpen(false)}
								className="btn-close"
								aria-label="Cerrar"
							>
								<X size={24} />
							</button>
						</header>
						<div className="modal-form-scroll">
							<div className="form-group">
								<input
									type="search"
									className="form-input"
									placeholder="Buscar insumo…"
									value={pickInvSearch}
									onChange={(e) => setPickInvSearch(e.target.value)}
									autoComplete="off"
								/>
							</div>
							<ul className="admin-cart-upsell-pick-inv__list">
								{pickInventoryCandidates.length === 0 ? (
									<li className="admin-cart-upsell-pick-inv__empty">Sin coincidencias.</li>
								) : (
									pickInventoryCandidates.map((o) => (
										<li key={o.id}>
											<button
												type="button"
												className="admin-cart-upsell-pick-inv__row"
												disabled={saving}
												onClick={() => void appendExtraFromInventoryRow(o)}
											>
												<span className="admin-cart-upsell-pick-inv__name">{o.name}</span>
												<span className="admin-cart-upsell-pick-inv__meta">
													{ITEM_TYPE_SHORT[o.item_type] || o.item_type} · {o.stock} {o.unit}
												</span>
											</button>
										</li>
									))
								)}
							</ul>
						</div>
					</div>
				</div>
			) : null}
		</section>
	);
}
