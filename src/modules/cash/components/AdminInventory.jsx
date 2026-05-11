import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
	Search,
	Download,
	Plus,
	Trash2,
	Edit,
	AlertTriangle,
	Package,
	LayoutDashboard,
	List,
	History,
	ChefHat,
	ChevronDown,
	ChevronRight,
	Link2Off,
	X,
} from "lucide-react";
import { supabase, TABLES } from "@/integrations/supabase";
import InventoryItemModal from "./InventoryItemModal";
import { downloadExcel } from "@/shared/utils/exportUtils";
import { isTypingContext } from "@/modules/cash/admin/utils/keyboardAdmin";
import { toNativeQty } from "@/lib/recipe-units";
import { branchSettingsService } from "@/modules/cash/services/branchSettingsService";

const SUB_TABS = [
	{ id: "summary", label: "Resumen", icon: LayoutDashboard },
	{ id: "supplies", label: "Insumos", icon: Package },
	{ id: "movements", label: "Movimientos", icon: History },
];

function formatMovementType(t) {
	const m = {
		sale: "Venta",
		adjustment: "Ajuste",
		purchase: "Entrada",
		return: "Devolución",
		transfer: "Transferencia",
	};
	return m[t] || t;
}

/** Etiquetas sugeridas desde catálogo carrito (bebidas / extras) de la sucursal. */
function categoryHintsFromCartCatalogs(cartBeveragesCatalog, cartGlobalExtrasCatalog) {
	const bev = Array.isArray(cartBeveragesCatalog) ? cartBeveragesCatalog : [];
	const ext = Array.isArray(cartGlobalExtrasCatalog) ? cartGlobalExtrasCatalog : [];
	const seen = new Set();
	const out = [];
	const add = (raw) => {
		const t = String(raw ?? "").trim();
		if (!t) return;
		const k = t.toLowerCase();
		if (seen.has(k)) return;
		seen.add(k);
		out.push(t);
	};
	if (bev.length) add("Bebidas");
	if (ext.length) add("Extras");
	for (const x of bev) add(x?.category);
	for (const x of ext) add(x?.category);
	return out;
}

const INV_ITEM_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ITEM_TYPE_LABELS = {
	kitchen: "Cocina",
	beverage: "Bebida",
	sellable_extra: "Extra",
	other: "Otro",
};

/**
 * IDs de insumos referenciados por el carrito (bebidas/extras) e ítems del menú aún sin vínculo.
 */
function extractCartInventoryLinkInfo(cartBeveragesCatalog, cartGlobalExtrasCatalog) {
	const linkedIds = new Set();
	const unlinked = [];
	const ingest = (arr, variant) => {
		for (const x of Array.isArray(arr) ? arr : []) {
			if (!x || typeof x !== "object") continue;
			const raw = x.inventoryItemId ?? x.inventory_item_id;
			const sid = typeof raw === "string" ? raw.trim() : "";
			if (sid && INV_ITEM_UUID.test(sid)) {
				linkedIds.add(sid);
			} else if (variant === "extras" && String(x.name ?? "").trim()) {
				// Bebidas del carrito no exigen insumo; los extras pueden inventarse o vincularse.
				unlinked.push({ variant, item: x });
			}
		}
	};
	ingest(cartBeveragesCatalog, "beverages");
	ingest(cartGlobalExtrasCatalog, "extras");
	return { linkedIds, unlinked };
}

const AdminInventory = ({ showNotify, branchId, branches, companyId, products = [] }) => {
	const [items, setItems] = useState([]);
	/** Todos los insumos de la empresa (p. ej. selector de recetas con vista «Todas las sucursales»). */
	const [companyInventoryItems, setCompanyInventoryItems] = useState([]);
	const [loading, setLoading] = useState(true);
	const [searchTerm, setSearchTerm] = useState("");
	const [statusFilter, setStatusFilter] = useState("all");
	const [itemTypeFilter, setItemTypeFilter] = useState("all");
	const [sortKey, setSortKey] = useState("name");
	const [sortDir, setSortDir] = useState("asc");
	const [subTab, setSubTab] = useState("summary");
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editingItem, setEditingItem] = useState(null);
	const [movements, setMovements] = useState([]);
	const [movementsLoading, setMovementsLoading] = useState(false);
	const [expandedItemId, setExpandedItemId] = useState(null);
	const [recentByItem, setRecentByItem] = useState(() => new Map());
	const [recipes, setRecipes] = useState([]);
	const [recipesLoading, setRecipesLoading] = useState(false);
	const [recipeSearch, setRecipeSearch] = useState("");
	const [recipeEditingProduct, setRecipeEditingProduct] = useState(null);
	const [recipeLines, setRecipeLines] = useState([]);
	const [recipeSaving, setRecipeSaving] = useState(false);
	/** Sugerencias de categoría (se actualiza dentro de loadItems con el carrito de la sucursal). */
	const [cartCatalogCategoryHints, setCartCatalogCategoryHints] = useState([]);
	/** Bebidas/extras del carrito sin insumo vinculado (esta sucursal). */
	const [unlinkedCartItems, setUnlinkedCartItems] = useState([]);
	const [newItemPreset, setNewItemPreset] = useState(null);
	const pendingCatalogLinkRef = useRef(null);

	useEffect(() => {
		const onKey = (e) => {
			if (isModalOpen || recipeEditingProduct) return;
			if (isTypingContext(e.target)) return;
			const map = { 1: "summary", 2: "supplies", 3: "movements" };
			const next = map[e.key];
			if (!next) return;
			e.preventDefault();
			setSubTab(next);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [isModalOpen, recipeEditingProduct]);

	const loadItems = useCallback(async () => {
		if (!branchId) return;
		if (!companyId) {
			setItems([]);
			setLoading(false);
			setCartCatalogCategoryHints([]);
			setUnlinkedCartItems([]);
			return;
		}
		setLoading(true);
		let linkedInventoryIds = new Set();
		try {
			const { data: allItems, error: itemsError } = await supabase
				.from(TABLES.inventory_items)
				.select("*")
				.eq("company_id", companyId)
				.order("name");

			if (itemsError) throw itemsError;
			setCompanyInventoryItems(allItems || []);

			let branchStock = [];
			let query = supabase.from(TABLES.inventory_branch).select("*");
			if (branchId !== "all") {
				query = query.eq("branch_id", branchId);
			} else {
				const validBranchIds = branches.filter((b) => b.id !== "all").map((b) => b.id);
				if (validBranchIds.length > 0) query = query.in("branch_id", validBranchIds);
			}
			const { data, error: stockError } = await query;
			if (stockError) throw stockError;
			branchStock = data || [];

			if (branchId !== "all") {
				try {
					const deliveryData = await branchSettingsService.getDeliverySettings(branchId);
					if (deliveryData) {
						const { linkedIds, unlinked } = extractCartInventoryLinkInfo(
							deliveryData.cartBeveragesCatalog,
							deliveryData.cartGlobalExtrasCatalog,
						);
						linkedInventoryIds = linkedIds;
						setUnlinkedCartItems(unlinked);
						setCartCatalogCategoryHints(
							categoryHintsFromCartCatalogs(
								deliveryData.cartBeveragesCatalog,
								deliveryData.cartGlobalExtrasCatalog,
							),
						);
					} else {
						setUnlinkedCartItems([]);
						setCartCatalogCategoryHints([]);
					}
				} catch {
					setUnlinkedCartItems([]);
					setCartCatalogCategoryHints([]);
				}
			} else {
				setUnlinkedCartItems([]);
				setCartCatalogCategoryHints([]);
			}

			let mergedItems = (allItems || []).map((item) => {
				const itemStocks = branchStock?.filter((s) => s.inventory_item_id === item.id);
				const stockEntry = branchId !== "all" ? itemStocks.find((s) => s.branch_id === branchId) : null;
				const totalStock =
					branchId === "all"
						? itemStocks.reduce((sum, s) => sum + (parseFloat(s.current_stock) || 0), 0)
						: parseFloat(stockEntry?.current_stock) || 0;
				const totalMinStock =
					branchId === "all"
						? itemStocks.reduce((sum, s) => sum + (parseFloat(s.min_stock) || 0), 0)
						: parseFloat(stockEntry?.min_stock) || parseFloat(item.min_stock) || 0;

				const linkedFromCart = branchId !== "all" && linkedInventoryIds.has(item.id);

				const itemType =
					typeof item.item_type === "string" && item.item_type.trim()
						? item.item_type.trim()
						: "kitchen";

				return {
					...item,
					item_type: itemType,
					stock: totalStock,
					min_stock: totalMinStock,
					branch_relation_id: stockEntry?.id,
					existsInBranch: !!stockEntry || branchId === "all",
					branch_ids: itemStocks.map((s) => s.branch_id),
					linkedFromCart,
				};
			});

			if (branchId !== "all") {
				mergedItems = mergedItems.filter(
					(item) => item.existsInBranch || linkedInventoryIds.has(item.id),
				);
			}

			setItems(mergedItems);
		} catch (error) {
			console.error("Error loading inventory:", error);
			if (error.code === "42P01") {
				showNotify("Tabla inventory_items no existe. Ejecuta el script SQL.", "error");
			} else {
				showNotify("Error al cargar inventario", "error");
			}
		} finally {
			setLoading(false);
		}
	}, [showNotify, branchId, companyId, branches]);

	const patchCatalogInventoryLink = useCallback(
		async (link, inventoryItemId) => {
			if (!branchId || branchId === "all" || !link?.catalogItemId) return;
			try {
				const data = await branchSettingsService.getDeliverySettings(branchId);
				if (!data) throw new Error("GET");
				const key = link.variant === "beverages" ? "cartBeveragesCatalog" : "cartGlobalExtrasCatalog";
				const arr = Array.isArray(data[key]) ? data[key] : [];
				const next = arr.map((row) => {
					if (String(row?.id) !== String(link.catalogItemId)) return row;
					return { ...row, inventoryItemId };
				});
				await branchSettingsService.saveDeliverySettings(branchId, { [key]: next });
				showNotify("Insumo creado y vinculado al ítem del carrito.", "success");
			} catch {
				showNotify(
					"Insumo guardado. Vincúlalo manualmente en Menú → Bebidas o Extras si hace falta.",
					"error",
				);
			}
		},
		[branchId, showNotify],
	);

	useEffect(() => {
		loadItems();
	}, [loadItems]);

	const loadMovements = useCallback(async () => {
		if (!branchId || branchId === "all" || !companyId) {
			setMovements([]);
			return;
		}
		setMovementsLoading(true);
		try {
			const { data, error } = await supabase
				.from(TABLES.inventory_movements)
				.select("*")
				.eq("branch_id", branchId)
				.eq("company_id", companyId)
				.order("created_at", { ascending: false })
				.limit(200);
			if (error) throw error;
			setMovements(data || []);
		} catch (e) {
			console.warn("movements", e);
			setMovements([]);
		} finally {
			setMovementsLoading(false);
		}
	}, [branchId, companyId]);

	const handleInventoryModalSaved = useCallback(
		async (detail) => {
			// Capturar antes de await: onClose() del modal vacía el ref en el mismo tick.
			const link = pendingCatalogLinkRef.current;
			await loadItems();
			void loadMovements();
			pendingCatalogLinkRef.current = null;
			setNewItemPreset(null);
			if (detail?.isNew && link && detail?.id) {
				await patchCatalogInventoryLink(link, detail.id);
				await loadItems();
			}
		},
		[loadItems, loadMovements, patchCatalogInventoryLink],
	);

	useEffect(() => {
		if (subTab === "movements") void loadMovements();
	}, [subTab, loadMovements]);

	const loadRecipes = useCallback(async () => {
		if (!companyId) {
			setRecipes([]);
			return;
		}
		setRecipesLoading(true);
		try {
			const { data, error } = await supabase
				.from(TABLES.product_inventory_recipe)
				.select("*")
				.eq("company_id", companyId);
			if (error) throw error;
			setRecipes(data || []);
		} catch (e) {
			console.warn("recipes", e);
			setRecipes([]);
		} finally {
			setRecipesLoading(false);
		}
	}, [companyId]);

	useEffect(() => {
		if (subTab === "recipes") void loadRecipes();
	}, [subTab, loadRecipes]);

	const itemNameById = useMemo(() => {
		const m = new Map();
		for (const it of items) m.set(it.id, it.name);
		for (const it of companyInventoryItems) if (!m.has(it.id)) m.set(it.id, it.name);
		return m;
	}, [items, companyInventoryItems]);

	/**
	 * Etiquetas para autocompletar categoría: insumos existentes + bebidas/extras del carrito
	 * de esta sucursal (solo grupos del menú, sin nombres de ítems).
	 */
	const existingInventoryCategoryLabels = useMemo(() => {
		const seen = new Set();
		const out = [];
		const add = (raw) => {
			const t = String(raw ?? "").trim();
			if (!t) return;
			const k = t.toLowerCase();
			if (seen.has(k)) return;
			seen.add(k);
			out.push(t);
		};
		for (const s of cartCatalogCategoryHints) add(s);
		for (const it of companyInventoryItems || []) add(it?.category);
		out.sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
		return out;
	}, [companyInventoryItems, cartCatalogCategoryHints]);

	const recipeItemOptions = companyInventoryItems.length > 0 ? companyInventoryItems : items;

	const loadRecentForItem = useCallback(
		async (inventoryItemId) => {
			if (!branchId || branchId === "all" || !companyId) return;
			const { data, error } = await supabase
				.from(TABLES.inventory_movements)
				.select("id, quantity_delta, movement_type, created_at, note, order_id")
				.eq("branch_id", branchId)
				.eq("inventory_item_id", inventoryItemId)
				.order("created_at", { ascending: false })
				.limit(8);
			if (error) return;
			setRecentByItem((prev) => {
				const next = new Map(prev);
				next.set(inventoryItemId, data || []);
				return next;
			});
		},
		[branchId, companyId],
	);

	const summary = useMemo(() => {
		let lowStock = 0;
		let outOfStock = 0;
		items.forEach((item) => {
			if (item.stock <= 0) outOfStock++;
			else if (item.stock <= item.min_stock) lowStock++;
		});
		return { lowStock, outOfStock, total: items.length };
	}, [items]);

	const { unlinkedBeverages, unlinkedExtras } = useMemo(() => {
		const bev = [];
		const ext = [];
		for (const row of unlinkedCartItems) {
			if (row.variant === "beverages") bev.push(row);
			else if (row.variant === "extras") ext.push(row);
		}
		return { unlinkedBeverages: bev, unlinkedExtras: ext };
	}, [unlinkedCartItems]);

	const filteredItems = useMemo(() => {
		let list = items.filter((item) => {
			const q = searchTerm.toLowerCase();
			const matchText =
				item.name.toLowerCase().includes(q) ||
				(item.category && item.category.toLowerCase().includes(q)) ||
				(Array.isArray(item.tags) &&
					item.tags.some((t) => String(t).toLowerCase().includes(q))) ||
				(item.beverage_kind && String(item.beverage_kind).toLowerCase().includes(q));
			if (!matchText) return false;
			if (itemTypeFilter !== "all" && (item.item_type || "kitchen") !== itemTypeFilter) return false;
			if (statusFilter === "ok") return item.stock > item.min_stock && item.stock > 0;
			if (statusFilter === "low") return item.stock > 0 && item.stock <= item.min_stock;
			if (statusFilter === "out") return item.stock <= 0;
			return true;
		});
		list = [...list].sort((a, b) => {
			let av;
			let bv;
			if (sortKey === "stock") {
				av = a.stock;
				bv = b.stock;
			} else if (sortKey === "category") {
				av = (a.category || "").toLowerCase();
				bv = (b.category || "").toLowerCase();
			} else {
				av = (a.name || "").toLowerCase();
				bv = (b.name || "").toLowerCase();
			}
			if (av < bv) return sortDir === "asc" ? -1 : 1;
			if (av > bv) return sortDir === "asc" ? 1 : -1;
			return 0;
		});
		return list;
	}, [items, searchTerm, statusFilter, itemTypeFilter, sortKey, sortDir]);

	const toggleSort = (key) => {
		if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		else {
			setSortKey(key);
			setSortDir("asc");
		}
	};

	const handleExport = () => {
		const dataToExport = filteredItems.map((item) => ({
			Insumo: item.name,
			Tipo: ITEM_TYPE_LABELS[item.item_type] || item.item_type,
			Categoria: item.category || "Sin categoría",
			"Tipo bebida": item.beverage_kind || "",
			Etiquetas: Array.isArray(item.tags) ? item.tags.join(", ") : "",
			Stock: item.stock,
			Unidad: item.unit || "",
			Estado: item.stock <= 0 ? "Agotado" : item.stock <= item.min_stock ? "Bajo" : "OK",
		}));
		downloadExcel(
			dataToExport,
			`Inventario_${new Date().toLocaleDateString("es-CL").replace(/\//g, "-")}.xls`,
		);
	};

	const handleDelete = async (id) => {
		if (!window.confirm("¿Estás seguro de eliminar este insumo?")) return;
		try {
			const { error } = await supabase
				.from(TABLES.inventory_items)
				.delete()
				.eq("id", id)
				.eq("company_id", companyId);
			if (error) throw error;
			showNotify("Insumo eliminado", "success");
			loadItems();
		} catch (error) {
			console.error(error);
			showNotify("Error al eliminar", "error");
		}
	};

	const handleEdit = (item) => {
		pendingCatalogLinkRef.current = null;
		setNewItemPreset(null);
		setEditingItem(item);
		setIsModalOpen(true);
	};

	const handleCreate = () => {
		pendingCatalogLinkRef.current = null;
		setNewItemPreset(null);
		setEditingItem(null);
		setIsModalOpen(true);
	};

	const openRegisterFromCart = (row) => {
		pendingCatalogLinkRef.current = {
			variant: row.variant,
			catalogItemId: row.item.id,
		};
		setEditingItem(null);
		setNewItemPreset({
			name: String(row.item.name || "").trim(),
			category: row.variant === "beverages" ? "Bebidas" : "Extras",
			itemType: row.variant === "beverages" ? "beverage" : "sellable_extra",
			beverageKind:
				row.variant === "beverages"
					? String(row.item.beverageKind ?? row.item.beverage_kind ?? "").trim()
					: "",
		});
		setIsModalOpen(true);
	};

	const recipesByProduct = useMemo(() => {
		const m = new Map();
		for (const r of recipes) {
			const pid = r.product_id;
			if (!m.has(pid)) m.set(pid, []);
			m.get(pid).push(r);
		}
		return m;
	}, [recipes]);

	const productsWithRecipes = useMemo(() => {
		const q = recipeSearch.trim().toLowerCase();
		return (products || [])
			.filter((p) => {
				if (!q) return true;
				return (p.name || "").toLowerCase().includes(q);
			})
			.slice(0, 200);
	}, [products, recipeSearch]);

	const openRecipeEditor = (product) => {
		setRecipeEditingProduct(product);
		const lines = recipesByProduct.get(product.id) || [];
		const opts = companyInventoryItems.length > 0 ? companyInventoryItems : items;
		setRecipeLines(
			lines.map((l) => {
				const item = opts.find((it) => String(it.id) === String(l.inventory_item_id));
				const native = item?.unit || "un";
				return {
					id: l.id,
					inventory_item_id: l.inventory_item_id,
					qty_per_sale: Number(l.qty_per_sale) || 1,
					input_unit: native,
				};
			}),
		);
	};

	const addRecipeLine = () => {
		setRecipeLines((prev) => [
			...prev,
			{ id: null, inventory_item_id: "", qty_per_sale: 1, input_unit: "un" },
		]);
	};

	const saveRecipes = async () => {
		if (!recipeEditingProduct || !companyId) return;
		setRecipeSaving(true);
		try {
			const productId = recipeEditingProduct.id;
			const { error: delErr } = await supabase
				.from(TABLES.product_inventory_recipe)
				.delete()
				.eq("product_id", productId)
				.eq("company_id", companyId);
			if (delErr) throw delErr;
			const itemOpts = recipeItemOptions;
			const rows = recipeLines
				.filter((l) => l.inventory_item_id && String(l.inventory_item_id).trim())
				.map((l) => {
					const inv = itemOpts.find((it) => String(it.id) === String(l.inventory_item_id));
					const native = inv?.unit || "un";
					const qtyNative = toNativeQty(
						Number(l.qty_per_sale),
						l.input_unit || native,
						native,
					);
					return {
						company_id: companyId,
						product_id: productId,
						inventory_item_id: String(l.inventory_item_id).trim(),
						qty_per_sale: Math.max(0.0001, qtyNative || 0),
					};
				});
			if (rows.length > 0) {
				const { error: insErr } = await supabase.from(TABLES.product_inventory_recipe).insert(rows);
				if (insErr) throw insErr;
			}
			showNotify("Receta guardada", "success");
			setRecipeEditingProduct(null);
			await loadRecipes();
		} catch (e) {
			showNotify(e?.message || "Error al guardar receta", "error");
		} finally {
			setRecipeSaving(false);
		}
	};

	const movementRows = useMemo(() => {
		return movements.map((m) => ({
			...m,
			itemName: itemNameById.get(m.inventory_item_id) || "—",
		}));
	}, [movements, itemNameById]);

	return (
		<div className="inventory-view animate-fade">
			<nav className="inventory-subtabs" aria-label="Secciones de inventario">
				{SUB_TABS.map(({ id, label, icon: Icon }) => (
					<button
						key={id}
						type="button"
						className={`inventory-subtab ${subTab === id ? "inventory-subtab--active" : ""}`}
						aria-current={subTab === id ? "page" : undefined}
						onClick={() => setSubTab(id)}
					>
						<Icon size={17} aria-hidden />
						{label}
					</button>
				))}
			</nav>

			{subTab === "summary" && (
				<div className="inventory-summary inventory-summary--grid">
					<div className="summary-card">
						<span className="summary-card__icon-wrap" aria-hidden>
							<Package size={22} strokeWidth={2} />
						</span>
						<div className="summary-card__text">
							<div className="summary-card__value">{summary.total}</div>
							<div className="summary-card__label">Insumos en sucursal</div>
						</div>
					</div>
					<div className="summary-card summary-card--warn">
						<span className="summary-card__icon-wrap" aria-hidden>
							<AlertTriangle size={22} strokeWidth={2} />
						</span>
						<div className="summary-card__text">
							<div className="summary-card__value">{summary.lowStock}</div>
							<div className="summary-card__label">Stock bajo</div>
						</div>
					</div>
					<div className="summary-card summary-card--danger">
						<span className="summary-card__icon-wrap" aria-hidden>
							<AlertTriangle size={22} strokeWidth={2} />
						</span>
						<div className="summary-card__text">
							<div className="summary-card__value">{summary.outOfStock}</div>
							<div className="summary-card__label">Agotados</div>
						</div>
					</div>
					<div className="summary-card summary-card--actions">
						<p className="summary-card__hint">
							Aquí controlas <strong>cantidades</strong> (stock por sucursal): agua embotellada, refrescos,
							salsas, etc. son <strong>insumos</strong> como cualquier otro. En <strong>Menú → Bebidas</strong>{" "}
							o <strong>Extras</strong> defines precio y apariencia en el carrito y, si quieres, vinculas ese
							ítem al mismo insumo para descontar al vender.
						</p>
						<div className="summary-card__actions-row">
							<button type="button" className="btn btn-secondary btn-sm" onClick={() => setSubTab("supplies")}>
								<List size={16} /> Ver insumos
							</button>
							<button type="button" className="btn btn-secondary btn-sm" onClick={() => setSubTab("recipes")}>
								<ChefHat size={16} /> Gestionar recetas
							</button>
						</div>
					</div>
				</div>
			)}

			{subTab === "supplies" && (
				<>
					<div className="inventory-header inventory-header--toolbar-only">
						<div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
							<button className="btn btn-secondary btn-icon-text" type="button" onClick={handleExport}>
								<Download size={18} /> Exportar
							</button>
							<button className="btn btn-primary btn-icon-text" type="button" onClick={handleCreate}>
								<Plus size={18} /> Nuevo insumo
							</button>
						</div>
					</div>

					<p className="inventory-context-hint">
						<strong>Insumos = stock físico.</strong> Usa el <strong>tipo</strong> (Cocina, Bebida, Extra) para
						ordenar; las <strong>bebidas</strong> con stock suelen ser tipo Bebida y vincularse desde Menú →
						Bebidas. Los <strong>extras</strong> pueden ser solo menú o enlazarse a un insumo para descontar al
						vender. Si un extra del carrito no tiene insumo, usa <strong>Registrar en inventario</strong> abajo.
					</p>

					{branchId !== "all" && (unlinkedBeverages.length > 0 || unlinkedExtras.length > 0) ? (
						<div className="inventory-cart-unlinked-banner" role="region" aria-label="Ítems del carrito sin insumo">
							<div className="inventory-cart-unlinked-banner__top">
								<span className="inventory-cart-unlinked-banner__icon-wrap" aria-hidden>
									<Link2Off size={22} strokeWidth={2} />
								</span>
								<div className="inventory-cart-unlinked-banner__copy">
									<strong className="inventory-cart-unlinked-banner__title">
										Carrito sin insumo vinculado ·{" "}
										{unlinkedBeverages.length + unlinkedExtras.length}{" "}
										{unlinkedBeverages.length + unlinkedExtras.length === 1 ? "ítem" : "ítems"}
									</strong>
									<p className="inventory-cart-unlinked-banner__lead">
										Despliega cada sección, elige un ítem y usa{" "}
										<strong>Registrar en inventario</strong> para crear el insumo y enlazarlo en Menú.
									</p>
								</div>
							</div>
							<div className="inventory-cart-unlinked-banner__folds">
								<div className="inventory-cart-unlinked-folds">
								{unlinkedBeverages.length > 0 ? (
									<details className="inventory-cart-unlinked-fold">
										<summary className="inventory-cart-unlinked-fold__summary">
											<ChevronRight
												className="inventory-cart-unlinked-fold__chev"
												size={18}
												aria-hidden
											/>
											<span className="inventory-cart-unlinked-fold__label">Todas las bebidas</span>
											<span className="inventory-cart-unlinked-fold__count">{unlinkedBeverages.length}</span>
										</summary>
										<div className="inventory-cart-unlinked-fold__body">
											<ul className="inventory-cart-unlinked-list">
												{unlinkedBeverages.map((row) => (
													<li key={`${row.variant}-${row.item.id}`}>
														<span className="inventory-cart-unlinked-list__name">{row.item.name}</span>
														<button
															type="button"
															className="btn btn-secondary btn-sm"
															onClick={() => openRegisterFromCart(row)}
														>
															Registrar en inventario
														</button>
													</li>
												))}
											</ul>
										</div>
									</details>
								) : null}
								{unlinkedExtras.length > 0 ? (
									<details className="inventory-cart-unlinked-fold">
										<summary className="inventory-cart-unlinked-fold__summary">
											<ChevronRight
												className="inventory-cart-unlinked-fold__chev"
												size={18}
												aria-hidden
											/>
											<span className="inventory-cart-unlinked-fold__label">Todos los extras</span>
											<span className="inventory-cart-unlinked-fold__count">{unlinkedExtras.length}</span>
										</summary>
										<div className="inventory-cart-unlinked-fold__body">
											<ul className="inventory-cart-unlinked-list">
												{unlinkedExtras.map((row) => (
													<li key={`${row.variant}-${row.item.id}`}>
														<span className="inventory-cart-unlinked-list__name">{row.item.name}</span>
														<button
															type="button"
															className="btn btn-secondary btn-sm"
															onClick={() => openRegisterFromCart(row)}
														>
															Registrar en inventario
														</button>
													</li>
												))}
											</ul>
										</div>
									</details>
								) : null}
								</div>
							</div>
						</div>
					) : null}

					<div className="inventory-toolbar">
						<div className="inventory-toolbar__chips inventory-toolbar__chips--wrap">
							{[
								{ id: "all", label: "Todos" },
								{ id: "ok", label: "OK" },
								{ id: "low", label: "Bajo" },
								{ id: "out", label: "Agotado" },
							].map((c) => (
								<button
									key={c.id}
									type="button"
									className={`inventory-chip ${statusFilter === c.id ? "inventory-chip--active" : ""}`}
									onClick={() => setStatusFilter(c.id)}
								>
									{c.label}
								</button>
							))}
						</div>
						<div className="inventory-toolbar__chips inventory-toolbar__chips--wrap">
							<span className="inventory-toolbar__chip-label">Tipo:</span>
							{[
								{ id: "all", label: "Todos" },
								{ id: "kitchen", label: "Cocina" },
								{ id: "beverage", label: "Bebida" },
								{ id: "sellable_extra", label: "Extra" },
								{ id: "other", label: "Otro" },
							].map((c) => (
								<button
									key={c.id}
									type="button"
									className={`inventory-chip ${itemTypeFilter === c.id ? "inventory-chip--active" : ""}`}
									onClick={() => setItemTypeFilter(c.id)}
								>
									{c.label}
								</button>
							))}
						</div>
						<div className="search-inventory">
							<Search size={18} className="inventory-search-icon" aria-hidden />
							<input
								type="search"
								placeholder="Buscar insumo o categoría…"
								value={searchTerm}
								onChange={(e) => setSearchTerm(e.target.value)}
								aria-label="Buscar en inventario"
							/>
						</div>
					</div>

					{loading ? (
						<div className="inventory-loading">Cargando inventario…</div>
					) : filteredItems.length === 0 ? (
						<div className="inventory-empty">
							<p>No hay insumos o no coinciden con los filtros.</p>
							{items.length === 0 && (
								<button className="btn btn-primary" type="button" onClick={handleCreate}>
									Crear primer insumo
								</button>
							)}
						</div>
					) : (
						<div className="inventory-table-container">
							<table className="inventory-table">
								<thead>
									<tr>
										<th className="inventory-th-expand" aria-hidden />
										<th>
											<button type="button" className="inventory-th-sort" onClick={() => toggleSort("name")}>
												Insumo {sortKey === "name" ? (sortDir === "asc" ? "↑" : "↓") : ""}
											</button>
										</th>
										<th>Tipo</th>
										<th>
											<button type="button" className="inventory-th-sort" onClick={() => toggleSort("stock")}>
												Stock {sortKey === "stock" ? (sortDir === "asc" ? "↑" : "↓") : ""}
											</button>
										</th>
										<th>Unidad</th>
										<th>Estado</th>
										<th style={{ textAlign: "right" }}>Acciones</th>
									</tr>
								</thead>
								<tbody>
									{filteredItems.map((item) => {
										let statusBadge;
										if (item.stock <= 0) statusBadge = <span className="stock-badge out">Agotado</span>;
										else if (item.stock <= item.min_stock)
											statusBadge = <span className="stock-badge low">Bajo</span>;
										else statusBadge = <span className="stock-badge available">OK</span>;
										const expanded = expandedItemId === item.id;
										const recent = recentByItem.get(item.id) || [];

										return (
											<React.Fragment key={item.id}>
												<tr className={expanded ? "inventory-row--open" : ""}>
													<td className="inventory-td-expand">
														{branchId !== "all" ? (
															<button
																type="button"
																className="inventory-expand-btn"
																aria-expanded={expanded}
																onClick={() => {
																	if (expanded) {
																		setExpandedItemId(null);
																	} else {
																		setExpandedItemId(item.id);
																		void loadRecentForItem(item.id);
																	}
																}}
																title="Últimos movimientos"
															>
																{expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
															</button>
														) : null}
													</td>
													<td className="inventory-td-name">
														{item.name}
														{item.linkedFromCart ? (
															<span
																className="inventory-cart-link-badge"
																title="Este insumo está vinculado a una bebida o extra del carrito en esta sucursal"
															>
																Carrito
															</span>
														) : null}
													</td>
													<td>
														<span className="inventory-type-badge" title={item.item_type}>
															{ITEM_TYPE_LABELS[item.item_type] || item.item_type}
														</span>
														{item.item_type === "beverage" && item.beverage_kind ? (
															<span className="inventory-beverage-kind"> · {item.beverage_kind}</span>
														) : null}
													</td>
													<td className="inventory-td-stock">{Number(item.stock).toLocaleString("es-CL", { maximumFractionDigits: 3 })}</td>
													<td className="inventory-td-unit">{item.unit}</td>
													<td>{statusBadge}</td>
													<td className="inventory-td-actions">
														<div className="inventory-row-actions">
															<button
																className="btn-icon-sm"
																type="button"
																onClick={() => handleEdit(item)}
																title="Editar"
															>
																<Edit size={16} />
															</button>
															<button
																className="btn-trash-sm"
																type="button"
																onClick={() => handleDelete(item.id)}
																title="Eliminar"
															>
																<Trash2 size={16} />
															</button>
														</div>
													</td>
												</tr>
												{expanded && branchId !== "all" ? (
													<tr className="inventory-expand-row">
														<td colSpan={7}>
															<div className="inventory-expand-panel">
																<strong>Últimos movimientos</strong>
																{recent.length === 0 ? (
																	<p className="inventory-expand-empty">Sin movimientos recientes.</p>
																) : (
																	<ul className="inventory-expand-list">
																		{recent.map((mv) => (
																			<li key={mv.id}>
																				<span className="inventory-expand-type">
																					{formatMovementType(mv.movement_type)}
																				</span>
																				<span
																					className={
																						Number(mv.quantity_delta) < 0
																							? "inventory-expand-delta neg"
																							: "inventory-expand-delta pos"
																					}
																				>
																					{Number(mv.quantity_delta) > 0 ? "+" : ""}
																					{mv.quantity_delta}
																				</span>
																				<span className="inventory-expand-meta">
																					{new Date(mv.created_at).toLocaleString("es-CL")}
																					{mv.order_id ? ` · Pedido #${String(mv.order_id).slice(-6)}` : ""}
																				</span>
																			</li>
																		))}
																	</ul>
																)}
															</div>
														</td>
													</tr>
												) : null}
											</React.Fragment>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</>
			)}

			{subTab === "movements" && (
				<div className="inventory-movements">
					{branchId === "all" ? (
						<p className="inventory-muted">Selecciona una sucursal para ver movimientos.</p>
					) : movementsLoading ? (
						<p className="inventory-muted">Cargando…</p>
					) : movementRows.length === 0 ? (
						<p className="inventory-muted">Aún no hay movimientos registrados en esta sucursal.</p>
					) : (
						<div className="inventory-table-container">
							<table className="inventory-table inventory-table--compact">
								<thead>
									<tr>
										<th>Fecha</th>
										<th>Tipo</th>
										<th>Insumo</th>
										<th>Δ</th>
										<th>Nota / pedido</th>
									</tr>
								</thead>
								<tbody>
									{movementRows.map((m) => (
										<tr key={m.id}>
											<td>{new Date(m.created_at).toLocaleString("es-CL")}</td>
											<td>{formatMovementType(m.movement_type)}</td>
											<td>{m.itemName}</td>
											<td
												className={`inventory-movement-delta ${
													Number(m.quantity_delta) < 0
														? "inventory-movement-delta--neg"
														: "inventory-movement-delta--pos"
												}`}
											>
												{Number(m.quantity_delta) > 0 ? "+" : ""}
												{m.quantity_delta}
											</td>
											<td>
												{m.note || "—"}
												{m.order_id ? ` · #${String(m.order_id).slice(-6)}` : ""}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			)}



			<InventoryItemModal
				isOpen={isModalOpen}
				onClose={() => {
					setIsModalOpen(false);
					pendingCatalogLinkRef.current = null;
					setNewItemPreset(null);
				}}
				onItemSaved={handleInventoryModalSaved}
				itemToEdit={editingItem}
				showNotify={showNotify}
				branchId={branchId}
				branches={branches}
				companyId={companyId}
				existingCategoryLabels={existingInventoryCategoryLabels}
				newItemPreset={newItemPreset}
			/>
		</div>
	);
};

export default AdminInventory;
