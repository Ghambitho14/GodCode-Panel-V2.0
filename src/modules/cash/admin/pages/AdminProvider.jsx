import React, { useState, useEffect, useMemo, useCallback, createContext, useContext, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase, TABLES } from '@/integrations/supabase';
import { uploadImage, validateImageFile } from '@/shared/utils/cloudinary';
import { useCashSystem } from '../../hooks/useCashSystem';
import { sanitizeOrder } from '@/shared/utils/orderUtils';
import { getAppScopedPath } from '@/shared/utils/app-route';
import {
	ADMIN_PANEL_TAB_IDS,
	DEFAULT_ROLE_NAV_PERMISSIONS as SHARED_DEFAULT_ROLE_NAV_PERMISSIONS,
	normalizePanelUserRole,
	normalizeStoredNavTabId,
} from '@/shared/constants/admin-panel-tabs';
import { playOrderNotificationSound, primeOrderNotificationAudio } from '../utils/playOrderNotificationSound';
import { callGuardedRpc } from '../utils/rpcGuard';

const ALL_ADMIN_TABS = ADMIN_PANEL_TAB_IDS;
const DEFAULT_ROLE_NAV_PERMISSIONS = { ...SHARED_DEFAULT_ROLE_NAV_PERMISSIONS };

/** Tubería feliz: pending → active → completed → picked_up (cancelled se trata aparte). */
const ORDER_PIPELINE_RANK = /** @type {const} */ ({ pending: 0, active: 1, completed: 2, picked_up: 3 });

/** @returns {number} -1 si no aplica a la tubería (p. ej. cancelled u otro). */
function orderPipelineRank(status) {
	if (status === 'cancelled') return -1;
	return ORDER_PIPELINE_RANK[/** @type {keyof typeof ORDER_PIPELINE_RANK} */ (status)] ?? -1;
}

/**
 * Si loadData trae filas stale mientras la UI avanzó optimista, conserva el status más avanzado del cliente.
 * Cancelled: si el servidor ya canceló, manda el servidor; si el cliente ya canceló y el servidor va atrasado, se mantiene cancelled.
 */
function mergeOrdersFromServer(prev, serverList) {
	const serverById = new Map(serverList.map((o) => [o.id, o]));
	const mergedCore = serverList.map((serverRow) => {
		const p = prev.find((o) => o.id === serverRow.id);
		if (!p) return serverRow;
		const ps = p.status;
		const ss = serverRow.status;
		if (ss === 'cancelled') return serverRow;
		if (ps === 'cancelled') return { ...serverRow, status: 'cancelled' };
		const rp = orderPipelineRank(ps);
		const rs = orderPipelineRank(ss);
		if (rp >= 0 && rs >= 0 && rp > rs) return { ...serverRow, status: ps };
		return serverRow;
	});
	const onlyPrev = prev.filter((p) => !serverById.has(p.id));
	const combined = [...mergedCore, ...onlyPrev];
	combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
	return combined;
}

const normalizePanelAccess = (raw) => {
	const allowed = new Set(ALL_ADMIN_TABS);

	if (!Array.isArray(raw)) return null;

	const cleanTabs = [...new Set(
		raw
			.filter((tab) => typeof tab === 'string')
			.map((tab) => normalizeStoredNavTabId(tab))
			.filter((tab) => allowed.has(tab)),
	)];

	if (cleanTabs.length === 0) return null;
	return cleanTabs;
};

export const AdminContext = createContext(null);

export const useAdmin = () => {
	const context = useContext(AdminContext);
	if (!context) throw new Error('useAdmin must be used within an AdminProvider');
	return context;
};

/**
 * @param {Object} props
 * @param {import('react').ReactNode} props.children
 * @param {string} props.companyId
 * @param {string | null | undefined} [props.initialUserRole]
 * @param {string[] | null | undefined} [props.panelAccess]
 * @param {any[]} [props.dynamicModules]
 */
/**
 * @param {object} root0
 * @param {React.ReactNode} root0.children
 * @param {string} root0.companyId
 * @param {string | null} [root0.initialUserRole]
 * @param {string[] | null | undefined} [root0.panelAccess]
 * @param {any[]} [root0.dynamicModules]
 * @param {Record<string, string>} [root0.resolvedTabLabels]
 * @param {boolean} [root0.adminShortcutsEnabled]
 */
export const AdminProvider = ({
	children,
	companyId,
	initialUserRole = null,
	panelAccess,
	dynamicModules = /** @type {any[]} */ ([]),
	resolvedTabLabels = /** @type {Record<string, string>} */ ({}),
	adminShortcutsEnabled = true,
}) => {
	const navigateFn = useNavigate();
	const { pathname } = useLocation();
	const navigate = useCallback((path) => navigateFn(getAppScopedPath(pathname || '/', path)), [pathname, navigateFn]);

	const [activeTab, setActiveTab] = useState('orders');
	const [products, setProducts] = useState([]);
	const [categories, setCategories] = useState([]);
	const [orders, setOrders] = useState([]);
	const [clients, setClients] = useState([]);
	const [branches, setBranches] = useState([]);
	const [selectedBranch, setSelectedBranch] = useState(null);
	const [isHistoryView, setIsHistoryView] = useState(false);
	const [mobileTab, setMobileTab] = useState('pending');
	const [searchQuery, setSearchQuery] = useState('');
	const [filterCategory, setFilterCategory] = useState('all');
	const [filterStatus, setFilterStatus] = useState('all');
	const [viewMode, setViewMode] = useState('grid');
	const [sortOrder, setSortOrder] = useState('name-asc');
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [lastDataRefreshAt, setLastDataRefreshAt] = useState(/** @type {number | null} */ (null));
	const sessionRestoredRef = useRef(false);
	const inventoryRefreshTimerRef = useRef(null);
	/** Evita doble moveOrder al mismo pedido y coordina merge en loadData. */
	const orderMoveInFlightRef = useRef(/** @type {Set<string>} */ (new Set()));
	// Siempre false en el primer render (SSR = cliente) para evitar hydration mismatch;
	// el valor real se aplica en useEffect tras montar (véase listener resize).
	const [isMobile, setIsMobile] = useState(false);
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editingProduct, setEditingProduct] = useState(null);
	const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
	const [editingCategory, setEditingCategory] = useState(null);
	const [notification, setNotification] = useState(null);
	const [receiptModalOrder, setReceiptModalOrder] = useState(null);
	const [receiptPreview, setReceiptPreview] = useState(null);
	const [isManualOrderModalOpen, setIsManualOrderModalOpen] = useState(false);
	const [uploadingReceipt, setUploadingReceipt] = useState(false);
	const [scopeModal, setScopeModal] = useState({ isOpen: false, item: null, type: 'product' });
	const [productToDelete, setProductToDelete] = useState(null);
	const [categoryToDelete, setCategoryToDelete] = useState(null);
	const [userRole, setUserRole] = useState(() => normalizePanelUserRole(initialUserRole));
	const [userEmail, setUserEmail] = useState(null);
	const [assignedBranchId, setAssignedBranchId] = useState(null);
	const [selectedClient, setSelectedClient] = useState(null);
	const [selectedClientOrders, setSelectedClientOrders] = useState([]);
	const [clientHistoryLoading, setClientHistoryLoading] = useState(false);
	/** Filas `inventory_branch` + `inventory_items` de la sucursal seleccionada (alertas campana / inventario). */
	const [inventoryBranchRows, setInventoryBranchRows] = useState(/** @type {any[]} */ ([]));

	const normalizedPanelAccess = useMemo(
		() => normalizePanelAccess(panelAccess),
		[panelAccess]
	);

	const normalizedDynamicModules = useMemo(() => (
		Array.isArray(dynamicModules)
			? dynamicModules
				.filter((module) => module && typeof module.tabId === 'string' && module.tabId.startsWith('module:'))
				.map((module) => ({
					id: module.id,
					tabId: module.tabId,
					label: module.label,
					description: module.description || '',
					navGroup: module.navGroup || 'root',
					navOrder: Number.isFinite(Number(module.navOrder)) ? Number(module.navOrder) : 100,
					allowedRoles: Array.isArray(module.allowedRoles) ? module.allowedRoles : ['admin', 'ceo'],
					isActive: Boolean(module.isActive),
				}))
			: []
	), [dynamicModules]);

	const allowedTabs = useMemo(() => {
		const rawRoleKey = (userRole || '').toLowerCase();
		const roleKey = rawRoleKey === 'staff' ? 'cashier' : rawRoleKey;
		const companyAllowedTabs = new Set(normalizedPanelAccess ?? ALL_ADMIN_TABS);
		/*
		 * Sin rol aún: no usar el fallback del cajero (bloqueaba CEO/productos hasta verifyAdminAccess).
		 * Tras verify, si el rol es inválido, verify redirige; aquí damos acceso amplio solo mientras roleKey está vacío.
		 */
		if (!roleKey) {
			return companyAllowedTabs;
		}

		const fallbackForRole = DEFAULT_ROLE_NAV_PERMISSIONS[roleKey] ?? DEFAULT_ROLE_NAV_PERMISSIONS.cashier;
		const roleAllowedTabs = Array.isArray(fallbackForRole) ? fallbackForRole : DEFAULT_ROLE_NAV_PERMISSIONS.cashier;

		return new Set(roleAllowedTabs.filter((tab) => companyAllowedTabs.has(tab)));
	}, [normalizedPanelAccess, userRole]);

	const dynamicModuleTabs = useMemo(() => {
		const roleKey = String(userRole || '').toLowerCase() === 'staff'
			? 'cashier'
			: String(userRole || '').toLowerCase();

		return new Set(
			normalizedDynamicModules
				.filter((module) => module.isActive)
				.filter((module) => {
					if (!roleKey) return false;
					if (!Array.isArray(module.allowedRoles) || module.allowedRoles.length === 0) return true;
					return module.allowedRoles.map((role) => String(role).toLowerCase()).includes(roleKey);
				})
				.map((module) => module.tabId)
		);
	}, [normalizedDynamicModules, userRole]);

	const canAccessTab = useCallback((tabId) => (
		allowedTabs.has(tabId) || dynamicModuleTabs.has(tabId)
	), [allowedTabs, dynamicModuleTabs]);
	const isBranchLocked = Boolean(assignedBranchId);

	useEffect(() => {
		sessionRestoredRef.current = false;
	}, [companyId]);

	useEffect(() => {
		if (!userRole || typeof window === 'undefined') return;
		if (sessionRestoredRef.current) return;
		if (branches.length === 0) return;
		try {
			const storedTab = localStorage.getItem(`godcode-panel:${companyId}:activeTab`);
			if (storedTab && canAccessTab(storedTab)) {
				setActiveTab(storedTab);
			}
			if (!isBranchLocked) {
				const bid = localStorage.getItem(`godcode-panel:${companyId}:branchId`);
				if (bid) {
					const b = branches.find((branch) => branch.id === bid);
					if (b) {
						setSelectedBranch(b);
					}
				}
			}
		} catch {
			/* ignore */
		}
		sessionRestoredRef.current = true;
	}, [userRole, branches, companyId, canAccessTab, isBranchLocked]);

	useEffect(() => {
		if (!userRole || typeof window === 'undefined') return;
		try {
			localStorage.setItem(`godcode-panel:${companyId}:activeTab`, activeTab);
		} catch {
			/* ignore */
		}
	}, [activeTab, companyId, userRole]);

	useEffect(() => {
		if (!userRole || typeof window === 'undefined') return;
		if (!selectedBranch?.id || selectedBranch.id === 'all') return;
		try {
			localStorage.setItem(`godcode-panel:${companyId}:branchId`, selectedBranch.id);
		} catch {
			/* ignore */
		}
	}, [selectedBranch?.id, companyId, userRole]);

	useEffect(() => {
		const handleResize = () => setIsMobile(window.innerWidth <= 1024);
		handleResize();
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	}, []);

	const showNotify = useCallback((msg, type = 'success') => {
		setNotification({ msg, type });
		setTimeout(() => setNotification(null), 3000);
	}, []);

	const setActiveTabWithGuard = useCallback((tabId) => {
		if (canAccessTab(tabId)) {
			setActiveTab(tabId);
			return;
		}

		showNotify('Necesitas un rol diferente para acceder a esta sección.', 'error');
	}, [canAccessTab, showNotify]);

	const setSelectedBranchWithGuard = useCallback((nextBranch) => {
		if (!isBranchLocked) {
			setSelectedBranch(nextBranch);
			return;
		}

		const nextBranchId = nextBranch?.id || null;
		if (nextBranchId === assignedBranchId) {
			setSelectedBranch(nextBranch);
			return;
		}

		showNotify('Tu correo está asignado a un local específico y no puedes cambiar de sucursal.', 'error');
	}, [assignedBranchId, isBranchLocked, showNotify]);

	const cashSystem = useCashSystem(showNotify, selectedBranch?.id);

	const verifyAdminAccess = useCallback(async () => {
		const {
			data: { user },
			error: userError,
		} = await supabase.auth.getUser();

		if (userError || !user?.email) {
			setUserRole(null);
			setUserEmail(null);
			setAssignedBranchId(null);
			navigate('/');
			return;
		}

		setUserEmail(user.email.trim().toLowerCase());

		const { data: userRowByAuth, error: userByAuthError } = await supabase
			.from(TABLES.users)
			.select('role,branch_id,company_id')
			.eq('auth_user_id', user.id || '')
			.maybeSingle();

		if (userByAuthError) {
			setUserRole(null);
			setAssignedBranchId(null);
			showNotify('No se pudieron validar tus permisos de usuario', 'error');
			return;
		}

		let userRow = userRowByAuth;

		if (!userRow) {
			const normalizedEmail = user.email.trim().toLowerCase();
			const { data: userRowByEmail, error: userByEmailError } = await supabase
				.from(TABLES.users)
				.select('role,branch_id,company_id')
				.ilike('email', normalizedEmail)
				.eq('company_id', companyId)
				.maybeSingle();

			if (userByEmailError) {
				setUserRole(null);
				setAssignedBranchId(null);
				showNotify('No se pudieron validar tus permisos de usuario', 'error');
				return;
			}

			userRow = userRowByEmail;
		}

		if (!userRow?.company_id) {
			setUserRole(null);
			setAssignedBranchId(null);
			showNotify('Tu usuario no está asociado a una empresa.', 'error');
			return;
		}

		if (String(userRow.company_id) !== String(companyId)) {
			setUserRole(null);
			setAssignedBranchId(null);
			await supabase.auth.signOut();
			navigate('/');
			showNotify('Tu cuenta no pertenece a esta empresa.', 'error');
			return;
		}

		// Roles permitidos para tenants
		const allowedRoles = ['owner', 'admin', 'ceo', 'cashier'];
		const effectiveRole = normalizePanelUserRole(userRow?.role);
		const hasAllowedRole = Boolean(effectiveRole && allowedRoles.includes(effectiveRole));

		if (!hasAllowedRole) {
			setUserRole(null);
			setAssignedBranchId(null);
			await supabase.auth.signOut();
			navigate('/');
			showNotify('No tienes permisos de administrador para este local', 'error');
			return;
		}

		setUserRole(effectiveRole);
		setAssignedBranchId(userRow?.branch_id || null);
	}, [companyId, navigate, showNotify]);

	useEffect(() => {
		verifyAdminAccess();

		const {
			data: { subscription },
		} = supabase.auth.onAuthStateChange((event) => {
			if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
				verifyAdminAccess();
			}
			if (event === 'SIGNED_OUT') {
				setUserRole(null);
				setUserEmail(null);
				setAssignedBranchId(null);
				navigate('/');
			}
		});

		return () => {
			subscription.unsubscribe();
		};
	}, [navigate, verifyAdminAccess]);

	const refreshBranches = useCallback(async () => {
		if (!companyId) {
			setBranches([]);
			setSelectedBranch(null);
			setLoading(false);
			return;
		}
		const { data, error } = await supabase
			.from(TABLES.branches)
			.select('*')
			.eq('company_id', companyId)
			.order('name');
		if (!error && data?.length > 0) {
			setBranches(data);
			setSelectedBranch(prev => {
				if (assignedBranchId) {
					const assignedBranch = data.find(b => b.id === assignedBranchId);
					return assignedBranch || data[0];
				}
				if (!prev || prev.id === 'all') return prev || data[0];
				const updated = data.find(b => b.id === prev.id);
				return updated || data[0];
			});
		} else {
			setBranches([]);
			setSelectedBranch(null);
			/* Sin sucursal loadData() no corre; sin esto el panel queda en spinner infinito. */
			setLoading(false);
		}
	}, [assignedBranchId, companyId]);

	useEffect(() => { refreshBranches(); }, [refreshBranches]);

	useEffect(() => {
		if (branches.length === 0) return;
		if (assignedBranchId) {
			const assignedBranch = branches.find((branch) => branch.id === assignedBranchId);
			if (assignedBranch && selectedBranch?.id !== assignedBranch.id) {
				setSelectedBranch(assignedBranch);
			}
			return;
		}
		if (activeTab !== 'analytics' && (!selectedBranch || selectedBranch.id === 'all')) {
			setSelectedBranch(branches[0]);
		}
	}, [activeTab, assignedBranchId, branches, selectedBranch]);

	useEffect(() => {
		if (!userRole) return;
		if (canAccessTab(activeTab)) return;

		const [firstAllowedTab] = Array.from(new Set([...allowedTabs, ...dynamicModuleTabs]));
		setActiveTab(firstAllowedTab || 'orders');
	}, [activeTab, allowedTabs, canAccessTab, dynamicModuleTabs, userRole]);

	const loadData = useCallback(async (isRefresh = false) => {
		if (!selectedBranch) return;
		if (!companyId) return;
		if (isRefresh) setRefreshing(true);
		else setLoading(true);
		try {
			const isAllBranches = selectedBranch.id === 'all';
			// Cargar solo categorías del tenant actual; evita mezclar categorías legacy de otros tenants.
			const categoriesQuery = supabase
				.from(TABLES.categories)
				.select('*')
				.eq('company_id', companyId)
				.order('order');
			const promises = [
				categoriesQuery,
				supabase.from(TABLES.products).select('*').eq('company_id', companyId).order('name'),
				isAllBranches
					? supabase.from(TABLES.orders).select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(100)
					: supabase.from(TABLES.orders).select('*').eq('company_id', companyId).eq('branch_id', selectedBranch.id).order('created_at', { ascending: false }).limit(100),
				supabase.from(TABLES.clients).select('*').eq('company_id', companyId).order('last_order_at', { ascending: false }).limit(200)
			];
			if (!isAllBranches) {
				promises.push(supabase.from(TABLES.category_branch).select('category_id, order, is_active').eq('branch_id', selectedBranch.id));
				promises.push(supabase.from(TABLES.product_prices).select('*').eq('company_id', companyId).eq('branch_id', selectedBranch.id));
				promises.push(supabase.from(TABLES.product_branch).select('*').eq('company_id', companyId).eq('branch_id', selectedBranch.id));
				promises.push(
					supabase
						.from(TABLES.inventory_branch)
						.select('id, inventory_item_id, branch_id, current_stock, min_stock, updated_at, inventory_items(id, name, unit, min_stock, category)')
						.eq('branch_id', selectedBranch.id)
				);
			}
			const results = await Promise.all(promises);
			const [catsRes, globalProductsRes, ordsRes, cltsRes] = results;
			const categoryBranchRes = !isAllBranches ? results[4] : { data: [] };
			const pricesRes = !isAllBranches ? results[5] : { data: [] };
			const branchStatusRes = !isAllBranches ? results[6] : { data: [] };
			const inventoryBranchRes = !isAllBranches ? results[7] : { data: [], error: null };
			if (catsRes.error) throw catsRes.error;
			if (globalProductsRes.error) throw globalProductsRes.error;
			if (ordsRes.error) throw ordsRes.error;
			if (cltsRes.error) throw cltsRes.error;
			if (!isAllBranches) {
				if (pricesRes.error) throw pricesRes.error;
				if (branchStatusRes.error) throw branchStatusRes.error;
				if (inventoryBranchRes.error) {
					console.warn('inventory_branch load:', inventoryBranchRes.error);
					setInventoryBranchRows([]);
				} else {
					setInventoryBranchRows(inventoryBranchRes.data || []);
				}
			} else {
				setInventoryBranchRows([]);
			}
			const branchPrices = pricesRes.data || [];
			const branchStatuses = branchStatusRes.data || [];
			const mergedProducts = (globalProductsRes.data || []).map(prod => {
				if (isAllBranches) return prod;
				const priceData = branchPrices.find(p => p.product_id === prod.id);
				const statusData = branchStatuses.find(s => s.product_id === prod.id);
				return {
					...prod,
					price: priceData ? priceData.price : 0,
					has_discount: priceData ? priceData.has_discount : false,
					discount_price: priceData ? priceData.discount_price : 0,
					// Sin fila en product_branch: no asumir "desactivado" — heredar is_active global del catálogo.
					is_active: statusData ? statusData.is_active : Boolean(prod.is_active),
					is_special: statusData ? statusData.is_special : false,
					category_id: statusData?.category_id || prod.category_id,
					price_id: priceData?.id,
					branch_relation_id: statusData?.id,
					inventory_pause_reason: statusData?.inventory_pause_reason ?? null,
					inventory_paused_at: statusData?.inventory_paused_at ?? null,
				};
			});
			const cleanOrders = (ordsRes.data || []).map(sanitizeOrder);
			const allClients = cltsRes.data || [];
			const branchCategoryMap = (categoryBranchRes.data || []).reduce((acc, row) => {
				acc[row.category_id] = { order: row.order, is_active: row.is_active };
				return acc;
			}, {});
			const categoriesData = (catsRes.data || []).map(cat => {
				if (isAllBranches) return { ...cat, order: cat.order ?? 0, is_active: cat.is_active ?? true };
				const branchInfo = branchCategoryMap[cat.id];
				return {
					id: cat.id,
					name: cat.name,
					company_id: cat.company_id,
					order: branchInfo?.order ?? cat.order ?? 0,
					is_active: branchInfo?.is_active ?? true
				};
			}).sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
			setCategories(categoriesData);
			setProducts(mergedProducts);
			setOrders((prev) =>
				orderMoveInFlightRef.current.size > 0 ? mergeOrdersFromServer(prev, cleanOrders) : cleanOrders
			);
			setClients(allClients);
			setLastDataRefreshAt(Date.now());
		} catch {
			showNotify("Error de conexión", 'error');
		} finally {
			setLoading(false);
			setRefreshing(false);
		}
	}, [showNotify, selectedBranch, companyId]);

	const loadClientHistory = useCallback(async (client) => {
		if (!client) return;
		if (!companyId) return;
		setClientHistoryLoading(true);
		try {
			const { data, error } = await supabase
				.from(TABLES.orders)
				.select('*')
				.eq('client_id', client.id)
				.eq('company_id', companyId)
				.order('created_at', { ascending: false });
			if (error) throw error;
			setSelectedClientOrders((data || []).map(sanitizeOrder));
		} catch {
			showNotify('Error al cargar historial', 'error');
		} finally {
			setClientHistoryLoading(false);
		}
	}, [showNotify, companyId]);

	const handleSelectClient = useCallback((client) => {
		setSelectedClient(client);
		loadClientHistory(client);
	}, [loadClientHistory]);

	/** `branch_id` del row Realtime (INSERT/UPDATE/DELETE). */
	const orderRealtimeBranchId = (row) => {
		if (!row || typeof row !== 'object') return null;
		const bid = row.branch_id ?? row.branchId;
		if (bid == null || bid === '') return null;
		return String(bid);
	};

	const handleRealtimeEvent = useCallback((payload) => {
		const sid = selectedBranch?.id ?? null;
		if (!sid) return;

		const isAllBranches = sid === 'all';
		const isSingleBranch = sid !== 'all';

		if (payload.eventType === 'INSERT') {
			const raw = payload.new;
			const bid = orderRealtimeBranchId(raw);
			if (isSingleBranch && bid !== String(sid)) return;

			const newOrder = sanitizeOrder(raw);
			setOrders((prev) => [newOrder, ...prev]);

			if (isSingleBranch) {
				showNotify(`Nuevo pedido #${newOrder.id.toString().slice(-4)}`, 'success');
				playOrderNotificationSound();
			} else {
				const branchName =
					(Array.isArray(branches) ? branches.find((b) => String(b.id) === bid)?.name : null) ||
					'Sucursal';
				showNotify(`Nuevo pedido #${newOrder.id.toString().slice(-4)} · ${branchName}`, 'success');
			}

			if (inventoryRefreshTimerRef.current) clearTimeout(inventoryRefreshTimerRef.current);
			inventoryRefreshTimerRef.current = setTimeout(() => {
				inventoryRefreshTimerRef.current = null;
				loadData(true);
			}, 500);
			return;
		}

		if (payload.eventType === 'UPDATE') {
			const raw = payload.new;
			const bid = orderRealtimeBranchId(raw);
			if (isSingleBranch && bid != null && bid !== String(sid)) return;
			if (!raw?.id) return;
			setOrders((prev) => prev.map((o) => (o.id === raw.id ? sanitizeOrder(raw) : o)));
			return;
		}

		if (payload.eventType === 'DELETE') {
			const raw = payload.old;
			const bid = orderRealtimeBranchId(raw);
			if (isSingleBranch && bid != null && bid !== String(sid)) return;
			if (!raw?.id) return;
			setOrders((prev) => prev.filter((o) => o.id !== raw.id));
		}
	}, [showNotify, loadData, selectedBranch, branches]);

	useEffect(() => {
		const onFirstInteract = () => {
			primeOrderNotificationAudio();
			window.removeEventListener('pointerdown', onFirstInteract);
			window.removeEventListener('keydown', onFirstInteract);
		};
		window.addEventListener('pointerdown', onFirstInteract, { passive: true });
		window.addEventListener('keydown', onFirstInteract);
		return () => {
			window.removeEventListener('pointerdown', onFirstInteract);
			window.removeEventListener('keydown', onFirstInteract);
		};
	}, []);

	useEffect(() => {
		loadData();
		const onVisibilityChange = () => {
			if (document.visibilityState === 'visible' && !isModalOpen && !editingProduct) loadData(true);
		};
		document.addEventListener('visibilitychange', onVisibilityChange);

		// Sin sucursal resuelta no suscribimos: evita INSERT globales y sonidos ajenos al cargar.
		if (!selectedBranch?.id) {
			return () => {
				document.removeEventListener('visibilitychange', onVisibilityChange);
			};
		}

		// Una sucursal: filtro server-side. "Todas": sin filtro; el handler acota sonido y estado.
		const channel = supabase
			.channel('table-db-changes')
			.on('postgres_changes', {
				event: '*',
				schema: 'public',
				table: 'orders',
				filter: selectedBranch.id !== 'all' ? `branch_id=eq.${selectedBranch.id}` : undefined,
			}, handleRealtimeEvent)
			.subscribe();

		return () => {
			document.removeEventListener('visibilitychange', onVisibilityChange);
			supabase.removeChannel(channel);
		};
	}, [loadData, handleRealtimeEvent, isModalOpen, editingProduct, selectedBranch]);

	const moveOrder = useCallback(async (orderId, nextStatus) => {
		if (orderMoveInFlightRef.current.has(orderId)) return;
		orderMoveInFlightRef.current.add(orderId);
		const previousRow = orders.find((o) => o.id === orderId);
		setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: nextStatus } : o)));
		try {
			const { error } = await supabase
				.from(TABLES.orders)
				.update({ status: nextStatus })
				.eq('id', orderId)
				.eq('company_id', companyId);
			if (error) throw error;
			if (nextStatus === 'active') {
				const targetOrder = previousRow;
				if (targetOrder) {
					const ok = await cashSystem.registerSale(targetOrder);
					if (!ok) {
						showNotify('No se pudo registrar la venta en caja', 'error');
					}
				}
			}
			if (nextStatus === 'cancelled') {
				const targetOrder = previousRow;
				if (targetOrder && (targetOrder.status === 'active' || targetOrder.status === 'completed' || targetOrder.status === 'picked_up')) {
					const ok = await cashSystem.registerRefund(targetOrder);
					if (!ok) {
						showNotify('No se pudo registrar la devolucion en caja', 'error');
					}
				}
			}
			showNotify('Pedido actualizado');
		} catch {
			if (previousRow) {
				setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...previousRow } : o)));
			}
			showNotify('Error al actualizar', 'error');
		} finally {
			orderMoveInFlightRef.current.delete(orderId);
		}
	}, [orders, cashSystem, showNotify, companyId]);

	const uploadReceiptToOrder = useCallback(async (orderId, file) => {
		if (!file) return;
		setUploadingReceipt(true);
		try {
			const receiptUrl = await uploadImage(file, 'receipts');
			const { error } = await supabase
				.from(TABLES.orders)
				.update({ payment_ref: receiptUrl })
				.eq('id', orderId)
				.eq('company_id', companyId);
			if (error) throw error;
			setOrders(prev => prev.map(o => o.id === orderId ? { ...o, payment_ref: receiptUrl } : o));
			if (selectedClient) {
				setSelectedClientOrders(prev => prev.map(o => o.id === orderId ? { ...o, payment_ref: receiptUrl } : o));
			}
			showNotify('Comprobante agregado');
			setReceiptModalOrder(null);
			setReceiptPreview(null);
		} catch (error) {
			showNotify('Error al subir comprobante: ' + error.message, 'error');
		} finally {
			setUploadingReceipt(false);
		}
	}, [selectedClient, showNotify, companyId]);

	const handleReceiptFileChange = useCallback((e) => {
		const file = e.target.files[0];
		if (file) {
			const { valid, error: validationError } = validateImageFile(file);
			if (!valid) {
				showNotify(validationError || 'Archivo no válido', 'error');
				e.target.value = '';
				return;
			}
			setReceiptPreview(prev => {
				if (prev) URL.revokeObjectURL(prev);
				return URL.createObjectURL(file);
			});
		}
	}, [showNotify]);

	const handleSaveProduct = useCallback(async (formData, localFile) => {
		if (!selectedBranch) return;
		if (selectedBranch.id === 'all') {
			showNotify('Selecciona una sucursal para crear o editar productos', 'error');
			return;
		}
		setRefreshing(true);
		try {
			let finalImageUrl = formData.image_url;
			if (localFile) finalImageUrl = await uploadImage(localFile, 'menu');
			// `p_price` y `p_discount_price` son NUMERIC en la RPC. Si pasamos un
			// JS Number entero (ej. 1500), PostgREST lo serializa como integer y
			// PG no resuelve la firma (busca un overload uuid,...,integer,...).
			// Forzamos string -> PG hace cast a numeric sin ambiguedad.
			const priceStr = String(Number(formData.price) || 0);
			const discountStr = formData.has_discount
				? String(Number(formData.discount_price) || 0)
				: null;
			// Regla multi-sucursal:
			// - CREATE (sin editingProduct): se aplica a TODAS las branches activas
			//   de la company con el mismo precio inicial, asi el producto aparece
			//   listo para vender en cualquier sucursal.
			// - EDIT: solo se toca la branch seleccionada (override por sucursal),
			//   para que el cajero pueda subir/bajar el precio en una sin pisar
			//   las demas.
			const applyToAllBranches = !editingProduct;
			const { data: productId, error } = await supabase.rpc('admin_upsert_product_with_branch', {
				p_product_id: editingProduct?.id || null,
				p_name: formData.name,
				p_description: formData.description,
				p_image_url: finalImageUrl,
				p_category_id: formData.category_id || null,
				p_branch_id: selectedBranch.id,
				p_price: priceStr,
				p_has_discount: formData.has_discount || false,
				p_discount_price: discountStr,
				p_is_active: editingProduct ? Boolean(editingProduct.is_active) : true,
				p_is_special: formData.is_special || false,
				p_apply_to_all_branches: applyToAllBranches
			});
			if (error) throw error;
			if (!productId) throw new Error('No se pudo guardar el producto');
			const dishKind =
				typeof formData.dish_kind === 'string' ? formData.dish_kind.trim().slice(0, 64) : '';
			const { error: dishErr } = await supabase
				.from(TABLES.products)
				.update({ dish_kind: dishKind || null })
				.eq('id', productId)
				.eq('company_id', companyId);
			if (dishErr) console.warn('dish_kind:', dishErr);

			// --- NUEVA LÓGICA DE RECETAS (BILL OF MATERIALS) ---
			if (Array.isArray(formData.recipe)) {
				// 1. Eliminar receta anterior
				const { error: delErr } = await supabase
					.from('product_inventory_recipe')
					.delete()
					.eq('product_id', productId)
					.eq('company_id', companyId);
				
				if (delErr) console.warn('recipe delete:', delErr);

				// 2. Insertar nueva receta (solo líneas válidas)
				const rowsToInsert = formData.recipe
					.filter(r => r.inventory_item_id && (Number(r.qty_per_sale) || 0) > 0)
					.map(r => ({
						product_id: productId,
						inventory_item_id: r.inventory_item_id,
						qty_per_sale: Number(r.qty_per_sale) || 0,
						company_id: companyId
					}));

				if (rowsToInsert.length > 0) {
					const { error: insErr } = await supabase
						.from('product_inventory_recipe')
						.insert(rowsToInsert);
					if (insErr) console.warn('recipe insert:', insErr);
				}
			}

			showNotify(editingProduct ? "Producto actualizado" : "Producto creado");
			setIsModalOpen(false);
			loadData(true);
		} catch (error) {
			showNotify("Error: " + error.message, 'error');
		} finally {
			setRefreshing(false);
		}
	}, [selectedBranch, editingProduct, showNotify, loadData, companyId]);

	const deleteProduct = useCallback((id) => setProductToDelete(id), []);

	const confirmDeleteProduct = useCallback(async () => {
		if (!productToDelete) return;
		const id = productToDelete;
		setProductToDelete(null);
		try {
			const { error } = await supabase.rpc('admin_delete_product_with_branch', {
				p_product_id: id
			});
			if (error) throw error;
			showNotify("Producto eliminado correctamente");
			loadData(true);
		} catch (error) {
			showNotify("No se pudo eliminar: " + (error.message || 'Error desconocido'), 'error');
		}
	}, [productToDelete, showNotify, loadData]);

	const toggleProductActive = useCallback((product, e) => {
		e.stopPropagation();
		if (!selectedBranch) return;
		setScopeModal({ isOpen: true, item: product, type: 'product' });
	}, [selectedBranch]);

	const handleScopeConfirm = useCallback(async (scope) => {
		const { item, type } = scopeModal;
		setScopeModal(prev => ({ ...prev, isOpen: false }));
		if (!item) return;
		const newActive = !item.is_active;
		if (type === 'product') {
			setProducts(prev => prev.map(p => p.id === item.id ? { ...p, is_active: newActive } : p));
		}
		try {
			if (scope === 'global' || selectedBranch?.id === 'all') {
				const scopedCompanyId = companyId || selectedBranch?.company_id || item.company_id || null;
				let query = supabase.from(TABLES.products).update({ is_active: newActive }).eq('id', item.id);
				if (scopedCompanyId) {
					query = query.eq('company_id', scopedCompanyId);
				}
				const { error } = await query;
				if (error) throw error;
				showNotify(newActive ? 'Activado en todos los locales' : 'Desactivado en todos los locales');
			} else {
				// Pre-flight: si activamos localmente un producto que esta apagado a nivel global,
				// el trigger sync_product_branch_parent_state forzaria is_active=false silenciosamente.
				// Solucion: promover global a true antes del upsert local.
				let promotedGlobal = false;
				if (type === 'product' && newActive) {
					const { data: parent, error: selErr } = await supabase
						.from(TABLES.products)
						.select('is_active')
						.eq('id', item.id)
						.maybeSingle();
					if (selErr) throw selErr;
					if (parent && parent.is_active === false) {
						const scopedCompanyId = companyId || selectedBranch?.company_id || item.company_id || null;
						let promoteQuery = supabase.from(TABLES.products).update({ is_active: true }).eq('id', item.id);
						if (scopedCompanyId) {
							promoteQuery = promoteQuery.eq('company_id', scopedCompanyId);
						}
						const { error: gErr } = await promoteQuery;
						if (gErr) throw gErr;
						promotedGlobal = true;
					}
				}
				const row = {
					product_id: item.id,
					branch_id: selectedBranch.id,
					is_active: newActive,
					company_id: selectedBranch.company_id || null,
				};
				if (newActive) {
					row.inventory_pause_reason = null;
					row.inventory_paused_at = null;
				}
				const { error } = await supabase.from(TABLES.product_branch).upsert(row, { onConflict: 'product_id, branch_id' });
				if (error) throw error;
				if (promotedGlobal) {
					showNotify('Producto reactivado (estaba apagado en todos los locales)');
				} else {
					showNotify(newActive ? 'Activado en este local' : 'Desactivado en este local');
				}
			}
			loadData(true);
		} catch {
			loadData(true);
			showNotify('Error al cambiar estado', 'error');
		}
	}, [scopeModal, selectedBranch, showNotify, loadData, companyId]);

	const handleSaveCategory = useCallback(async (formData) => {
		if (!selectedBranch || selectedBranch.id === 'all') {
			showNotify('Selecciona una sucursal para gestionar categorías', 'error');
			return;
		}
		try {
			const orderValue = Number(formData.order);
			const normalizedOrder = Number.isFinite(orderValue) && orderValue > 0 ? orderValue : null;
			if (editingCategory) {
				const { error } = await supabase
					.from(TABLES.categories)
					.update({ name: formData.name })
					.eq('id', editingCategory.id);
				if (error) throw error;

				const { error: statusError } = await supabase
					.from(TABLES.category_branch)
					.upsert({
						category_id: editingCategory.id,
						branch_id: selectedBranch.id,
						is_active: formData.is_active,
						company_id: selectedBranch.company_id || null
					}, { onConflict: 'category_id, branch_id' });
				if (statusError) throw statusError;

				if (normalizedOrder && normalizedOrder !== editingCategory.order) {
					const { error: reorderError, notGranted } = await callGuardedRpc(
						'admin_set_category_order',
						{
							p_branch_id: selectedBranch.id,
							p_category_id: editingCategory.id,
							p_new_order: normalizedOrder,
						},
						{ showNotify, label: 'Reordenar categoría' },
					);
					if (notGranted) return;
					if (reorderError) throw reorderError;
				}
			} else {
				const { error, notGranted } = await callGuardedRpc(
					'admin_create_category_with_overrides',
					{
						p_name: formData.name,
						p_branch_id: selectedBranch.id,
						p_order: normalizedOrder,
						p_is_active: formData.is_active,
					},
					{ showNotify, label: 'Crear categoría' },
				);
				if (notGranted) return;
				if (error) throw error;
			}
			setIsCategoryModalOpen(false);
			loadData(true);
			showNotify('Categoría guardada');
		} catch (error) {
			showNotify('Error al guardar: ' + error.message, 'error');
		}
	}, [selectedBranch, editingCategory, showNotify, loadData]);

	const reorderCategories = useCallback(async (orderedIds) => {
		if (!selectedBranch || selectedBranch.id === 'all') return;
		if (!Array.isArray(orderedIds) || orderedIds.length === 0) return;
		setCategories(prev => {
			const orderMap = new Map(orderedIds.map((id, index) => [id, index + 1]));
			return prev.map(cat => orderMap.has(cat.id) ? { ...cat, order: orderMap.get(cat.id) } : cat);
		});
		const { error, notGranted } = await callGuardedRpc(
			'admin_reorder_categories',
			{
				p_branch_id: selectedBranch.id,
				p_category_ids: orderedIds,
			},
			{ showNotify, label: 'Reordenar categorías' },
		);
		if (notGranted) {
			loadData(true);
			return;
		}
		if (error) {
			showNotify('No se pudo reordenar categorías', 'error');
			loadData(true);
		}
	}, [selectedBranch, showNotify, loadData]);

	const toggleCategoryActive = useCallback(async (categoryId, nextValue) => {
		if (!selectedBranch || selectedBranch.id === 'all') return;
		setCategories(prev => prev.map(cat => cat.id === categoryId ? { ...cat, is_active: nextValue } : cat));
		const { error } = await supabase
			.from(TABLES.category_branch)
			.upsert({
				category_id: categoryId,
				branch_id: selectedBranch.id,
				is_active: nextValue,
				company_id: selectedBranch.company_id || null
			}, { onConflict: 'category_id, branch_id' });
		if (error) {
			showNotify('No se pudo actualizar la categoría', 'error');
			loadData(true);
		}
	}, [selectedBranch, showNotify, loadData]);

	const deleteCategory = useCallback((cat) => {
		setCategoryToDelete(cat);
	}, []);

	const confirmDeleteCategory = useCallback(async () => {
		if (!categoryToDelete) return;
		const id = categoryToDelete.id;
		setCategoryToDelete(null);
		try {
			await supabase
				.from(TABLES.products)
				.update({ category_id: null })
				.eq('category_id', id)
				.eq('company_id', companyId);
			const { error } = await supabase
				.from(TABLES.categories)
				.delete()
				.eq('id', id)
				.eq('company_id', companyId);
			if (error) throw error;
			showNotify('Categoría eliminada');
			loadData(true);
		} catch (error) {
			showNotify('No se pudo eliminar: ' + (error.message || 'Error desconocido'), 'error');
		}
	}, [categoryToDelete, showNotify, loadData, companyId]);

	const kanbanColumns = useMemo(() => {
		const byCreatedAsc = (a, b) =>
			new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
		const sortCol = (list) => [...list].sort(byCreatedAsc);
		return {
			pending: sortCol(orders.filter((o) => o.status === 'pending')),
			active: sortCol(orders.filter((o) => o.status === 'active')),
			completed: sortCol(orders.filter((o) => o.status === 'completed')),
			cancelled: orders.filter((o) => o.status === 'cancelled'),
			history: orders.filter((o) => o.status === 'picked_up' || o.status === 'cancelled'),
		};
	}, [orders]);

	const processedProducts = useMemo(() => {
		let result = products.filter(p =>
			p.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
			(filterCategory === 'all' || p.category_id === filterCategory) &&
			(filterStatus === 'all' || (filterStatus === 'active' ? p.is_active : !p.is_active))
		);
		return result.sort((a, b) => {
			if (filterStatus === 'all' && a.is_active !== b.is_active) return a.is_active ? -1 : 1;
			if (sortOrder === 'name-asc') return a.name.localeCompare(b.name);
			if (sortOrder === 'price-asc') return a.price - b.price;
			if (sortOrder === 'price-desc') return b.price - a.price;
			return 0;
		});
	}, [products, searchQuery, filterCategory, filterStatus, sortOrder]);

	const productStats = useMemo(() => ({
		total: products.length,
		active: products.filter(p => p.is_active).length,
		paused: products.filter(p => !p.is_active).length
	}), [products]);

	const value = useMemo(() => ({
		companyId,
		navigate,
		activeTab, setActiveTab: setActiveTabWithGuard,
		products, setProducts,
		categories, setCategories,
		orders, setOrders,
		clients, setClients,
		branches, setBranches,
		selectedBranch, setSelectedBranch: setSelectedBranchWithGuard,
		assignedBranchId,
		isBranchLocked,
		isHistoryView, setIsHistoryView,
		mobileTab, setMobileTab,
		searchQuery, setSearchQuery,
		filterCategory, setFilterCategory,
		filterStatus, setFilterStatus,
		viewMode, setViewMode,
		sortOrder, setSortOrder,
		loading, setLoading,
		refreshing, setRefreshing,
		isMobile, setIsMobile,
		isModalOpen, setIsModalOpen,
		editingProduct, setEditingProduct,
		isCategoryModalOpen, setIsCategoryModalOpen,
		editingCategory, setEditingCategory,
		notification, setNotification,
		receiptModalOrder, setReceiptModalOrder,
		receiptPreview, setReceiptPreview,
		isManualOrderModalOpen, setIsManualOrderModalOpen,
		uploadingReceipt, setUploadingReceipt,
		selectedClient, setSelectedClient,
		selectedClientOrders, setSelectedClientOrders,
		clientHistoryLoading, setClientHistoryLoading,
		userRole,
		showNotify,
		cashSystem,
		loadData,
		refreshBranches,
		handleSelectClient,
		moveOrder,
		uploadReceiptToOrder,
		handleReceiptFileChange,
		handleSaveProduct,
		deleteProduct,
		toggleProductActive,
		scopeModal,
		handleScopeConfirm,
		setScopeModal,
		handleSaveCategory,
		deleteCategory,
		categoryToDelete,
		setCategoryToDelete,
		confirmDeleteCategory,
		toggleCategoryActive,
		reorderCategories,
		canAccessTab,
		panelAccess: normalizedPanelAccess,
		kanbanColumns,
		processedProducts,
		productStats,
		inventoryBranchRows,
		dynamicModules: normalizedDynamicModules,
		resolvedTabLabels,
		adminShortcutsEnabled,
		lastDataRefreshAt,
		userEmail,
		productToDelete,
		setProductToDelete,
		confirmDeleteProduct,
	}), [
		companyId,
		navigate, activeTab, setActiveTabWithGuard, products, categories, orders, clients, branches, selectedBranch,
		isHistoryView, mobileTab, searchQuery, filterCategory, filterStatus, viewMode, sortOrder,
		loading, refreshing, isMobile, isModalOpen, editingProduct, isCategoryModalOpen, editingCategory,
		notification, receiptModalOrder, receiptPreview, isManualOrderModalOpen, uploadingReceipt,
		selectedClient, selectedClientOrders, clientHistoryLoading, userRole, showNotify, cashSystem,
		loadData, refreshBranches, handleSelectClient, moveOrder, uploadReceiptToOrder, handleReceiptFileChange,
		handleSaveProduct, deleteProduct, toggleProductActive, scopeModal, handleScopeConfirm, handleSaveCategory,
		deleteCategory, categoryToDelete, confirmDeleteCategory, toggleCategoryActive, reorderCategories,
		assignedBranchId, isBranchLocked, setSelectedBranchWithGuard, 		canAccessTab, normalizedPanelAccess, kanbanColumns, processedProducts, productStats, inventoryBranchRows, normalizedDynamicModules,
		resolvedTabLabels, adminShortcutsEnabled, lastDataRefreshAt, userEmail, productToDelete, confirmDeleteProduct,
	]);

	return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
};
