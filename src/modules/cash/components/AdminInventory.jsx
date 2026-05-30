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
	Save,
} from "lucide-react";
import { supabase, TABLES } from "@/integrations/supabase";
import InventoryItemModal from "./InventoryItemModal";
import { downloadExcel } from "@/shared/utils/exportUtils";
import { isTypingContext } from "@/modules/cash/admin/utils/keyboardAdmin";
import { getInputUnitOptions, getUnitLabel, normalizeUnit, recipeUnitSelectLabel, toNativeQty } from "@/lib/recipe-units";
import { branchSettingsService } from "@/modules/cash/services/branchSettingsService";

const SUB_TABS = [
	{ id: "summary", label: "Resumen", icon: LayoutDashboard },
	{ id: "supplies", label: "Artículos", icon: Package },
	{ id: "movements", label: "Movimientos", icon: History },
	{ id: "recipes", label: "Recetas / Consumo", icon: ChefHat },
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
	kitchen: "General",
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

const RECIPE_PAGE_SIZE = 60;

const AdminInventory = ({
	showNotify,
	branchId,
	branches,
	companyId,
	products = [],
	categories = [],
	onRefreshCatalog,
}) => {
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
	const [recipePickProductOpen, setRecipePickProductOpen] = useState(false);
	const [recipeFilter, setRecipeFilter] = useState("all");
	const [recipePickSearch, setRecipePickSearch] = useState("");
	const [recipePickShowAll, setRecipePickShowAll] = useState(false);
	const [recipeListLimit, setRecipeListLimit] = useState(RECIPE_PAGE_SIZE);
	const [inventoryEnforceOnSale, setInventoryEnforceOnSale] = useState(true);
	const [inventoryEnforceSaving, setInventoryEnforceSaving] = useState(false);
	const [insumoLineFilter, setInsumoLineFilter] = useState("");
	/** Sugerencias de categoría (se actualiza dentro de loadItems con el carrito de la sucursal). */
	const [cartCatalogCategoryHints, setCartCatalogCategoryHints] = useState([]);
	/** Bebidas/extras del carrito sin insumo vinculado (esta sucursal). */
	const [unlinkedCartItems, setUnlinkedCartItems] = useState([]);
	const [newItemPreset, setNewItemPreset] = useState(null);
	const pendingCatalogLinkRef = useRef(null);

	useEffect(() => {
		const onKey = (e) => {
			if (isModalOpen || recipeEditingProduct || recipePickProductOpen) return;
			if (isTypingContext(e.target)) return;
			const map = { 1: "summary", 2: "supplies", 3: "movements", 4: "recipes" };
			const next = map[e.key];
			if (!next) return;
			e.preventDefault();
			setSubTab(next);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [isModalOpen, recipeEditingProduct, recipePickProductOpen]);

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
				showNotify("Artículo creado y vinculado al ítem del carrito.", "success");
			} catch {
				showNotify(
					"Artículo guardado. Vincúlalo manualmente en Menú → Bebidas o Extras si hace falta.",
					"error",
				);
			}
		},
		[branchId, showNotify],
	);

	useEffect(() => {
		loadItems();
	}, [loadItems]);

	useEffect(() => {
		if (!branchId || branchId === "all") {
			setInventoryEnforceOnSale(true);
			return;
		}
		let cancelled = false;
		(async () => {
			try {
				const data = await branchSettingsService.getDeliverySettings(branchId);
				if (cancelled) return;
				setInventoryEnforceOnSale(data?.inventoryEnforceOnSale !== false);
			} catch {
				if (!cancelled) setInventoryEnforceOnSale(true);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [branchId]);

	const handleInventoryEnforceToggle = useCallback(
		async (enabled) => {
			if (!branchId || branchId === "all" || inventoryEnforceSaving) return;
			setInventoryEnforceSaving(true);
			try {
				await branchSettingsService.saveDeliverySettings(branchId, {
					inventoryEnforceOnSale: enabled,
				});
				setInventoryEnforceOnSale(enabled);
				if (!enabled) {
					const { error } = await supabase
						.from(TABLES.product_branch)
						.update({
							inventory_pause_reason: null,
							inventory_paused_at: null,
							is_active: true,
						})
						.eq("branch_id", branchId)
						.eq("inventory_pause_reason", "out_of_stock");
					if (error) throw error;
					showNotify(
						"Control de stock desactivado. Los productos pausados solo por inventario se reactivaron.",
						"success",
					);
				} else {
					showNotify(
						"Control de stock activado: sin stock no se vende y los productos pueden pausarse automáticamente.",
						"success",
					);
				}
				onRefreshCatalog?.();
			} catch (e) {
				showNotify(e?.message || "Error al guardar la configuración", "error");
			} finally {
				setInventoryEnforceSaving(false);
			}
		},
		[branchId, inventoryEnforceSaving, showNotify, onRefreshCatalog],
	);

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

	const recipeItemOptionsWithStock = useMemo(() => {
		const stockById = new Map(items.map((it) => [String(it.id).toLowerCase(), it.stock]));
		return recipeItemOptions.map((it) => ({
			...it,
			stock: stockById.has(String(it.id).toLowerCase()) ? stockById.get(String(it.id).toLowerCase()) : null,
		}));
	}, [recipeItemOptions, items]);

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
			Artículo: item.name,
			Tipo: ITEM_TYPE_LABELS[item.item_type] || item.item_type,
			Categoria: item.category || "Sin categoría",
			"Tipo bebida": item.beverage_kind || "",
			Etiquetas: Array.isArray(item.tags) ? item.tags.join(", ") : "",
			Stock: item.stock,
			Unidad: getUnitLabel(item.unit || "un", { short: true }),
			Estado: item.stock <= 0 ? "Agotado" : item.stock <= item.min_stock ? "Bajo" : "OK",
		}));
		downloadExcel(
			dataToExport,
			`Inventario_${new Date().toLocaleDateString("es-CL").replace(/\//g, "-")}.xls`,
		);
	};

	const handleDelete = async (id) => {
		if (!window.confirm("¿Estás seguro de eliminar este artículo?")) return;
		try {
			const { error } = await supabase
				.from(TABLES.inventory_items)
				.delete()
				.eq("id", id)
				.eq("company_id", companyId);
			if (error) throw error;
			showNotify("Artículo eliminado", "success");
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

	const categoryNameById = useMemo(() => {
		const m = new Map();
		for (const c of categories || []) {
			if (c?.id) m.set(c.id, String(c.name ?? "").trim() || "Sin categoría");
		}
		return m;
	}, [categories]);

	const recipeProductBaseList = useMemo(() => {
		return (products || []).map((p) => {
			const lines = recipesByProduct.get(p.id) || [];
			const hasRecipe = lines.length > 0;
			const insumoNames = lines
				.map((l) => itemNameById.get(l.inventory_item_id))
				.filter(Boolean);
			return {
				...p,
				categoryName: categoryNameById.get(p.category_id) || "",
				hasRecipe,
				insumoCount: lines.length,
				insumoNames,
			};
		});
	}, [products, recipesByProduct, categoryNameById, itemNameById]);

	const recipeStats = useMemo(() => {
		let withRecipe = 0;
		for (const p of recipeProductBaseList) {
			if (p.hasRecipe) withRecipe++;
		}
		return {
			withRecipe,
			withoutRecipe: recipeProductBaseList.length - withRecipe,
			total: recipeProductBaseList.length,
		};
	}, [recipeProductBaseList]);

	const matchesRecipeSearch = useCallback(
		(p, q) => {
			if (!q) return true;
			if ((p.name || "").toLowerCase().includes(q)) return true;
			if ((p.categoryName || "").toLowerCase().includes(q)) return true;
			for (const name of p.insumoNames || []) {
				if (String(name).toLowerCase().includes(q)) return true;
			}
			return false;
		},
		[],
	);

	const recipeProductList = useMemo(() => {
		const q = recipeSearch.trim().toLowerCase();
		let list = recipeProductBaseList.filter((p) => {
			if (!matchesRecipeSearch(p, q)) return false;
			if (recipeFilter === "with") return p.hasRecipe;
			if (recipeFilter === "without") return !p.hasRecipe;
			return true;
		});
		list = [...list].sort((a, b) => {
			if (a.hasRecipe !== b.hasRecipe) return a.hasRecipe ? 1 : -1;
			return (a.name || "").localeCompare(b.name || "", "es", { sensitivity: "base" });
		});
		return list;
	}, [recipeProductBaseList, recipeSearch, recipeFilter, matchesRecipeSearch]);

	const recipeProductListVisible = useMemo(
		() => recipeProductList.slice(0, recipeListLimit),
		[recipeProductList, recipeListLimit],
	);

	const recipePickProductList = useMemo(() => {
		const q = recipePickSearch.trim().toLowerCase();
		return recipeProductBaseList
			.filter((p) => {
				if (!recipePickShowAll && p.hasRecipe) return false;
				return matchesRecipeSearch(p, q);
			})
			.sort((a, b) => {
				if (a.hasRecipe !== b.hasRecipe) return a.hasRecipe ? 1 : -1;
				return (a.name || "").localeCompare(b.name || "", "es", { sensitivity: "base" });
			})
			.slice(0, 80);
	}, [recipeProductBaseList, recipePickSearch, recipePickShowAll, matchesRecipeSearch]);

	const filteredInsumoOptionsForRecipe = useMemo(() => {
		const q = insumoLineFilter.trim().toLowerCase();
		if (!q) return recipeItemOptionsWithStock;
		return recipeItemOptionsWithStock.filter((it) => {
			const name = (it.name || "").toLowerCase();
			const cat = (it.category || "").toLowerCase();
			const unit = getUnitLabel(it.unit || "un", { short: true }).toLowerCase();
			return name.includes(q) || cat.includes(q) || unit.includes(q);
		});
	}, [recipeItemOptionsWithStock, insumoLineFilter]);

	const openRecipeEditor = (product) => {
		setRecipeEditingProduct(product);
		setInsumoLineFilter("");
		const lines = recipesByProduct.get(product.id) || [];
		const opts = companyInventoryItems.length > 0 ? companyInventoryItems : items;
		setRecipeLines(
			lines.map((l) => {
				const item = opts.find((it) => String(it.id) === String(l.inventory_item_id));
				const native = normalizeUnit(item?.unit || "un");
				return {
					id: l.id,
					inventory_item_id: l.inventory_item_id,
					qty_per_sale: Number(l.qty_per_sale) || 1,
					input_unit: native,
				};
			}),
		);
	};

	const openAddRecipePicker = () => {
		setRecipePickSearch("");
		setRecipePickShowAll(false);
		setRecipePickProductOpen(true);
	};

	const addRecipeLine = () => {
		setRecipeLines((prev) => [
			...prev,
			{ id: null, inventory_item_id: "", qty_per_sale: 1, input_unit: "un" },
		]);
	};

	const updateRecipeLine = (index, field, value) => {
		setRecipeLines((prev) => prev.map((line, i) => (i === index ? { ...line, [field]: value } : line)));
	};

	const removeRecipeLine = (index) => {
		setRecipeLines((prev) => prev.filter((_, i) => i !== index));
	};

	const onRecipeInventoryChange = (index, itemId) => {
		const item = recipeItemOptionsWithStock.find((it) => String(it.id) === String(itemId));
		const native = normalizeUnit(item?.unit || "un");
		setRecipeLines((prev) =>
			prev.map((line, i) =>
				i === index ? { ...line, inventory_item_id: itemId, input_unit: native } : line,
			),
		);
	};

	const pickProductForRecipe = (product) => {
		setRecipePickProductOpen(false);
		openRecipeEditor(product);
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
					const native = normalizeUnit(inv?.unit || "un");
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

			{branchId && branchId !== "all" ? (
				<div className="inventory-enforce-panel glass">
					<div className="inventory-enforce-panel__text">
						<strong className="inventory-enforce-panel__title">Control de stock en ventas</strong>
						<p className="inventory-enforce-panel__desc">
							{inventoryEnforceOnSale
								? "Activado: si falta stock según la receta, el producto no se vende y puede pausarse en el menú."
								: "Desactivado: puedes vender y configurar recetas aunque el stock esté en cero (útil mientras cargas inventario)."}
						</p>
					</div>
					<label className="inventory-enforce-panel__switch switch-control" title="Control de stock en ventas">
						<input
							type="checkbox"
							checked={inventoryEnforceOnSale}
							disabled={inventoryEnforceSaving}
							onChange={(e) => void handleInventoryEnforceToggle(e.target.checked)}
							aria-label="Control de stock en ventas"
						/>
						<span className="slider" aria-hidden="true" />
					</label>
				</div>
			) : null}

			{subTab === "summary" && (
				<div className="inventory-summary inventory-summary--grid">
					<div className="summary-card">
						<span className="summary-card__icon-wrap" aria-hidden>
							<Package size={22} strokeWidth={2} />
						</span>
						<div className="summary-card__text">
							<div className="summary-card__value">{summary.total}</div>
							<div className="summary-card__label">Artículos en sucursal</div>
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
							Aquí controlas <strong>stock por sucursal</strong> (materia prima, empaque, repuestos, etc.). En{" "}
							<strong>Recetas / Consumo</strong> defines qué artículos se descuentan al vender cada producto del
							catálogo. Si usas carrito de bebidas o extras, también puedes vincular esos ítems a un artículo.
						</p>
						<div className="summary-card__actions-row">
							<button type="button" className="btn btn-secondary btn-sm" onClick={() => setSubTab("supplies")}>
								<List size={16} /> Ver artículos
							</button>
							<button type="button" className="btn btn-secondary btn-sm" onClick={() => setSubTab("recipes")}>
								<ChefHat size={16} /> Consumo por venta
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
								<Plus size={18} /> Nuevo artículo
							</button>
						</div>
					</div>

					<p className="inventory-context-hint">
						<strong>Artículos = stock físico.</strong> Usa el <strong>tipo</strong> (General, Bebida, Extra) para
						ordenar. El consumo al vender un producto del catálogo se configura en{" "}
						<strong>Recetas / Consumo</strong>. Si un ítem del carrito no tiene artículo vinculado, usa{" "}
						<strong>Registrar en inventario</strong> abajo.
					</p>

					{branchId !== "all" && (unlinkedBeverages.length > 0 || unlinkedExtras.length > 0) ? (
						<div className="inventory-cart-unlinked-banner" role="region" aria-label="Ítems del carrito sin artículo">
							<div className="inventory-cart-unlinked-banner__top">
								<span className="inventory-cart-unlinked-banner__icon-wrap" aria-hidden>
									<Link2Off size={22} strokeWidth={2} />
								</span>
								<div className="inventory-cart-unlinked-banner__copy">
									<strong className="inventory-cart-unlinked-banner__title">
										Carrito sin artículo vinculado ·{" "}
										{unlinkedBeverages.length + unlinkedExtras.length}{" "}
										{unlinkedBeverages.length + unlinkedExtras.length === 1 ? "ítem" : "ítems"}
									</strong>
									<p className="inventory-cart-unlinked-banner__lead">
										Despliega cada sección, elige un ítem y usa{" "}
										<strong>Registrar en inventario</strong> para crear el artículo y enlazarlo en Menú.
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
								{ id: "kitchen", label: "General" },
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
								placeholder="Buscar artículo o categoría…"
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
							<p>No hay artículos o no coinciden con los filtros.</p>
							{items.length === 0 && (
								<button className="btn btn-primary" type="button" onClick={handleCreate}>
									Crear primer artículo
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
												Artículo {sortKey === "name" ? (sortDir === "asc" ? "↑" : "↓") : ""}
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
																title="Este artículo está vinculado a una bebida o extra del carrito en esta sucursal"
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
													<td className="inventory-td-unit">{getUnitLabel(item.unit || "un", { short: true })}</td>
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
										<th>Artículo</th>
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

			{subTab === "recipes" && (
				<div className="inventory-recipes">
					<p className="inventory-recipes__lead">
						Asocia cada <strong>producto del catálogo</strong> con los <strong>artículos</strong> que se consumen por
						venta. Al confirmar un pedido, el sistema descontará el stock según las cantidades definidas aquí.
					</p>

					<div className="inventory-header inventory-toolbar--recipes">
						<button type="button" className="btn btn-primary btn-icon-text" onClick={openAddRecipePicker}>
							<Plus size={18} /> Agregar receta
						</button>
						<div className="search-inventory">
							<Search size={18} className="inventory-search-icon" aria-hidden />
							<input
								type="search"
								placeholder="Buscar por producto, categoría o artículo…"
								value={recipeSearch}
								onChange={(e) => {
									setRecipeSearch(e.target.value);
									setRecipeListLimit(RECIPE_PAGE_SIZE);
								}}
								aria-label="Buscar productos para receta"
							/>
						</div>
					</div>

					<div className="inventory-toolbar">
						<div className="inventory-toolbar__chips inventory-toolbar__chips--wrap">
							{[
								{ id: "all", label: "Todos" },
								{ id: "without", label: "Sin receta" },
								{ id: "with", label: "Con receta" },
							].map((c) => (
								<button
									key={c.id}
									type="button"
									className={`inventory-chip ${recipeFilter === c.id ? "inventory-chip--active" : ""}`}
									onClick={() => {
										setRecipeFilter(c.id);
										setRecipeListLimit(RECIPE_PAGE_SIZE);
									}}
								>
									{c.label}
								</button>
							))}
						</div>
						<p className="inventory-muted inventory-recipes__stats">
							{recipeStats.withoutRecipe} sin receta · {recipeStats.withRecipe} con receta · {recipeStats.total}{" "}
							productos
						</p>
					</div>

					{recipesLoading ? (
						<p className="inventory-muted">Cargando recetas…</p>
					) : recipeProductList.length === 0 ? (
						<p className="inventory-recipes-empty">
							No hay productos que coincidan. Crea productos en la sección Productos o ajusta la búsqueda.
						</p>
					) : (
						<>
							<div className="inventory-recipe-grid">
								{recipeProductListVisible.map((product) => {
									const summary =
										product.insumoNames?.length > 0
											? product.insumoNames.slice(0, 2).join(" · ") +
												(product.insumoNames.length > 2 ? ` +${product.insumoNames.length - 2}` : "")
											: null;
									return (
										<button
											key={product.id}
											type="button"
											className="inventory-recipe-card"
											onClick={() => openRecipeEditor(product)}
										>
											<div className="inventory-recipe-card__head">
												<div className="inventory-recipe-card__title-wrap">
													<ChefHat size={18} className="inventory-recipe-card__icon" aria-hidden />
													<strong>{product.name}</strong>
												</div>
												<span
													className={`inventory-recipe-card__badge ${
														product.hasRecipe
															? "inventory-recipe-card__badge--ok"
															: "inventory-recipe-card__badge--empty"
													}`}
												>
													{product.hasRecipe
														? `${product.insumoCount} artículo${product.insumoCount === 1 ? "" : "s"}`
														: "Sin receta"}
												</span>
											</div>
											{product.categoryName ? (
												<span className="inventory-recipe-card__meta">{product.categoryName}</span>
											) : null}
											<span className="inventory-recipe-card__meta">
												{summary || (product.hasRecipe ? "Clic para editar" : "Clic para configurar")}
											</span>
										</button>
									);
								})}
							</div>
							{recipeProductList.length > recipeListLimit ? (
								<div className="inventory-recipes__more">
									<button
										type="button"
										className="btn btn-secondary btn-sm"
										onClick={() => setRecipeListLimit((n) => n + RECIPE_PAGE_SIZE)}
									>
										Mostrar más ({recipeProductList.length - recipeListLimit} restantes)
									</button>
								</div>
							) : null}
						</>
					)}
				</div>
			)}

			{recipePickProductOpen ? (
				<div
					className="modal-overlay"
					role="dialog"
					aria-modal="true"
					aria-labelledby="recipe-pick-title"
					onClick={() => setRecipePickProductOpen(false)}
				>
					<div
						className="modal-content inventory-recipe-modal inventory-recipe-picker animate-scale-in"
						onClick={(e) => e.stopPropagation()}
					>
						<header className="modal-header">
							<div>
								<h3 id="recipe-pick-title">Agregar receta</h3>
								<p className="inventory-modal-subtitle">
									Busca un producto del catálogo. Por defecto se listan los que aún no tienen consumo configurado.
								</p>
							</div>
							<button
								type="button"
								className="btn-close"
								aria-label="Cerrar"
								onClick={() => setRecipePickProductOpen(false)}
							>
								<X size={22} />
							</button>
						</header>
						<div className="inventory-recipe-picker__toolbar">
							<div className="search-inventory inventory-recipe-picker__search">
								<Search size={18} className="inventory-search-icon" aria-hidden />
								<input
									type="search"
									placeholder="Buscar producto o categoría…"
									value={recipePickSearch}
									onChange={(e) => setRecipePickSearch(e.target.value)}
									aria-label="Buscar en lista de productos"
									autoFocus
								/>
							</div>
							<label className="inventory-recipe-picker__toggle">
								<input
									type="checkbox"
									checked={recipePickShowAll}
									onChange={(e) => setRecipePickShowAll(e.target.checked)}
								/>
								Mostrar también con receta
							</label>
						</div>
						<div className="modal-form-scroll inventory-recipe-picker__list">
							{recipePickProductList.length === 0 ? (
								<p className="inventory-recipe-empty-hint">
									No hay productos que coincidan. Prueba otra búsqueda o activa «Mostrar también con receta».
								</p>
							) : (
								<ul className="inventory-recipe-picker__items">
									{recipePickProductList.map((p) => (
										<li key={p.id}>
											<button type="button" className="inventory-recipe-picker__item" onClick={() => pickProductForRecipe(p)}>
												<span className="inventory-recipe-picker__item-name">{p.name}</span>
												{p.categoryName ? (
													<span className="inventory-recipe-picker__item-cat">{p.categoryName}</span>
												) : null}
												{p.hasRecipe ? (
													<span className="inventory-recipe-picker__item-badge">Ya tiene receta</span>
												) : null}
											</button>
										</li>
									))}
								</ul>
							)}
						</div>
					</div>
				</div>
			) : null}

			{recipeEditingProduct ? (
				<div
					className="modal-overlay"
					role="dialog"
					aria-modal="true"
					aria-labelledby="recipe-edit-title"
					onClick={() => !recipeSaving && setRecipeEditingProduct(null)}
				>
					<div
						className="modal-content inventory-recipe-modal animate-scale-in"
						onClick={(e) => e.stopPropagation()}
					>
						<header className="modal-header">
							<div>
								<h3 id="recipe-edit-title">Consumo por venta</h3>
								<p className="inventory-modal-subtitle">{recipeEditingProduct.name}</p>
							</div>
							<button
								type="button"
								className="btn-close"
								aria-label="Cerrar"
								disabled={recipeSaving}
								onClick={() => setRecipeEditingProduct(null)}
							>
								<X size={22} />
							</button>
						</header>
						<form
							onSubmit={(e) => {
								e.preventDefault();
								void saveRecipes();
							}}
						>
							<div className="modal-form-scroll inventory-recipe-editor__body">
								<div className="inventory-recipe-editor__toolbar">
									<div className="search-inventory inventory-recipe-editor__insumo-search">
										<Search size={18} className="inventory-search-icon" aria-hidden />
										<input
											type="search"
											placeholder="Filtrar artículos por nombre o categoría…"
											value={insumoLineFilter}
											onChange={(e) => setInsumoLineFilter(e.target.value)}
											aria-label="Filtrar artículos"
										/>
									</div>
									<button type="button" className="btn btn-secondary btn-sm" onClick={addRecipeLine}>
										<Plus size={16} /> Agregar artículo
									</button>
								</div>
								{recipeLines.length === 0 ? (
									<p className="inventory-recipe-empty-hint">
										Sin líneas: al guardar, este producto no descontará stock al venderse.
									</p>
								) : (
									<div className="inventory-recipe-lines">
										{recipeLines.map((line, idx) => {
											const sel = recipeItemOptionsWithStock.find(
												(i) => String(i.id) === String(line.inventory_item_id),
											);
											const nativeUnit = normalizeUnit(sel?.unit || "un");
											const unitOpts = sel ? getInputUnitOptions(nativeUnit) : getInputUnitOptions("un");
											const stockHint =
												sel && sel.stock != null && Number.isFinite(Number(sel.stock))
													? `Stock en sucursal: ${Number(sel.stock).toLocaleString("es-CL", { maximumFractionDigits: 4 })} ${getUnitLabel(nativeUnit, { short: true })}`
													: null;
											return (
												<div key={idx} className="inventory-recipe-line">
													<div className="inventory-recipe-line__field inventory-recipe-line__field--full">
														<label>Artículo</label>
														<select
															className="inventory-form-select"
															value={line.inventory_item_id}
															onChange={(e) => onRecipeInventoryChange(idx, e.target.value)}
														>
															<option value="">Selecciona…</option>
															{filteredInsumoOptionsForRecipe.map((item) => {
																const u = normalizeUnit(item.unit || "un");
																const stockLabel =
																	item.stock != null && Number.isFinite(Number(item.stock))
																		? ` · ${Number(item.stock)} ${getUnitLabel(u, { short: true })}`
																		: "";
																return (
																	<option key={item.id} value={item.id}>
																		{item.name} ({getUnitLabel(u, { short: true })}
																		{stockLabel})
																	</option>
																);
															})}
														</select>
														{stockHint ? (
															<p className="form-hint inventory-form-hint">{stockHint}</p>
														) : null}
													</div>
													<div className="inventory-recipe-line__field">
														<label>Cantidad / venta</label>
														<input
															type="number"
															step="any"
															min="0"
															className="form-input"
															value={line.qty_per_sale}
															onChange={(e) => updateRecipeLine(idx, "qty_per_sale", e.target.value)}
														/>
													</div>
													<div className="inventory-recipe-line__field">
														<label>Unidad</label>
														<select
															className="inventory-form-select"
															value={line.input_unit || nativeUnit}
															disabled={!line.inventory_item_id}
															onChange={(e) => updateRecipeLine(idx, "input_unit", e.target.value)}
														>
															{unitOpts.map((u) => (
																<option key={u} value={u}>
																	{recipeUnitSelectLabel(u)}
																</option>
															))}
														</select>
													</div>
													<button
														type="button"
														className="inventory-recipe-line__remove"
														aria-label="Quitar línea"
														onClick={() => removeRecipeLine(idx)}
													>
														<Trash2 size={18} />
													</button>
													{line.inventory_item_id ? (
														<p className="inventory-recipe-line__unit-hint form-hint">
															Se guarda en {getUnitLabel(nativeUnit, { short: true })} (unidad del insumo).
														</p>
													) : null}
												</div>
											);
										})}
									</div>
								)}
							</div>
							<footer className="modal-footer">
								<button
									type="button"
									className="btn btn-secondary"
									disabled={recipeSaving}
									onClick={() => setRecipeEditingProduct(null)}
								>
									Cancelar
								</button>
								<button type="submit" className="btn btn-primary" disabled={recipeSaving}>
									<Save size={18} />
									{recipeSaving ? "Guardando…" : "Guardar receta"}
								</button>
							</footer>
						</form>
					</div>
				</div>
			) : null}

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
