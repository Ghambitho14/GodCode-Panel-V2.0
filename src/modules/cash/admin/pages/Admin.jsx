import React from 'react';
import {
  Loader2, Search, Filter, CheckCircle2, AlertCircle,
  Package, PlusCircle, X, Trash2, Plus, Edit, RefreshCw, List, ShoppingBag, Tag, LayoutGrid, ArrowUpDown, Eye, EyeOff, Upload, HelpCircle, Store,
} from 'lucide-react';
import ProductModal from '../products/components/ProductModal';
import CategoryModal from '../products/components/CategoryModal';
import AdminSidebar from '../../components/AdminSidebar';
import AdminKanban from '../../components/AdminKanban';
import ManualOrderModal from '../../components/ManualOrderModal';
import InventoryCard from '../../components/InventoryCard';
import ClientDetailsPanel from '../../components/ClientDetailsPanel';
import ScopeSelectionModal from '../../components/ScopeSelectionModal';
import TenantTicketsPanel from '../../components/TenantTicketsPanel';
import AdminErrorBoundary from '../../components/AdminErrorBoundary';
import AdminCommandPalette from '../../components/AdminCommandPalette';
import AdminShortcutsModal from '../../components/AdminShortcutsModal';
import AdminTabFallback from '../../components/AdminTabFallback';
import AdminBroadcastsBanner from '../../components/AdminBroadcastsBanner';
import AdminTopBar from '../../components/AdminTopBar';
import AdminNotificationCenter from '../../components/AdminNotificationCenter';
import AdminBranchSelector from '../../components/AdminBranchSelector';
import AdminHeaderClock from '../../components/AdminHeaderClock';
import { isModKey, isTypingContext } from '../utils/keyboardAdmin';
import { ADMIN_PANEL_TAB_IDS } from '@/shared/constants/admin-panel-tabs';
import { listBroadcasts, acknowledgeBroadcast as acknowledgeBroadcastService } from '../../services/broadcastsService';

const AdminAnalytics = React.lazy(() => import('../../components/AdminAnalytics'));
const AdminClients = React.lazy(() => import('../../components/AdminClients'));
const AdminInventory = React.lazy(() => import('../../components/AdminInventory'));
const AdminHistoryTable = React.lazy(() => import('../../components/AdminHistoryTable'));
const CashManager = React.lazy(() => import('../../components/caja/CashManager'));
const AdminCoupons = React.lazy(() => import('../../components/AdminCoupons'));
const AdminMenuOptions = React.lazy(() => import('../../components/AdminMenuOptions'));
const AdminMenuBeverages = React.lazy(() => import('../../components/AdminMenuBeverages'));
const AdminMenuExtras = React.lazy(() => import('../../components/AdminMenuExtras'));
import { supabase, TABLES } from '@/integrations/supabase';
import { AdminProvider, useAdmin } from './AdminProvider';

export const AdminPage = ({ companyName, logoUrl, userEmail: initialEmail, primaryColor, storefrontMenuUrl = null }) => {
  const {
    navigate,
    activeTab, setActiveTab,
    products,
    categories,
    orders,
    clients,
    branches,
    selectedBranch, setSelectedBranch,
    isBranchLocked,
    isHistoryView, setIsHistoryView,
    mobileTab, setMobileTab,
    searchQuery, setSearchQuery,
    filterCategory, setFilterCategory,
    filterStatus, setFilterStatus,
    viewMode, setViewMode,
    sortOrder, setSortOrder,
    refreshing,
    isMobile,
    isModalOpen, setIsModalOpen,
    editingProduct, setEditingProduct,
    isCategoryModalOpen, setIsCategoryModalOpen,
    editingCategory, setEditingCategory,
    notification,
    receiptModalOrder, setReceiptModalOrder,
    receiptPreview, setReceiptPreview,
    isManualOrderModalOpen, setIsManualOrderModalOpen,
    uploadingReceipt,
    selectedClient, setSelectedClient,
    selectedClientOrders,
    clientHistoryLoading,
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
    kanbanColumns,
    processedProducts,
    productStats,
    userRole,
    userEmail,
    dynamicModules,
    canAccessTab,
    productToDelete,
    setProductToDelete,
    confirmDeleteProduct,
    reorderCategories,
    toggleCategoryActive,
    resolvedTabLabels,
    adminShortcutsEnabled,
    lastDataRefreshAt,
    loading,
    inventoryBranchRows,
    companyId,
  } = useAdmin();

  const tabLabels = React.useMemo(() => resolvedTabLabels || {}, [resolvedTabLabels]);

  const nextCategoryOrder = React.useMemo(() => {
    const maxOrder = categories.reduce((maxValue, cat) => {
      const value = Number(cat.order);
      if (!Number.isFinite(value)) return maxValue;
      return Math.max(maxValue, value);
    }, 0);
    return maxOrder + 1;
  }, [categories]);

  const sortedCategories = React.useMemo(() => (
    [...categories].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
  ), [categories]);

  const companyIdForClients = React.useMemo(() => {
    if (selectedBranch && selectedBranch.id !== 'all' && selectedBranch.company_id) {
      return selectedBranch.company_id;
    }
    const fallback = (branches || []).find(b => b.id !== 'all' && b.company_id);
    return fallback?.company_id || null;
  }, [selectedBranch, branches]);

  const [recipeInventoryItems, setRecipeInventoryItems] = React.useState([]);

  React.useEffect(() => {
    if (!companyId || !isModalOpen) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from(TABLES.inventory_items)
        .select('id, name, unit')
        .eq('company_id', companyId)
        .order('name');
      if (cancelled) return;
      if (error) {
        console.warn('recipe inventory_items:', error);
        setRecipeInventoryItems([]);
        return;
      }
      setRecipeInventoryItems(data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, isModalOpen]);

  const productRecipeInventoryOptions = React.useMemo(() => {
    const stockMap = new Map(
      (inventoryBranchRows || []).map((r) => [
        String(r.inventory_item_id).toLowerCase(),
        r.current_stock,
      ]),
    );
    return (recipeInventoryItems || []).map((it) => ({
      id: it.id,
      name: String(it.name ?? '').trim() || 'Sin nombre',
      unit: String(it.unit ?? 'un').trim() || 'un',
      stock: stockMap.has(String(it.id).toLowerCase())
        ? Number(stockMap.get(String(it.id).toLowerCase()))
        : null,
    }));
  }, [recipeInventoryItems, inventoryBranchRows]);

  const [dragCategoryId, setDragCategoryId] = React.useState(null);
  const [dragOverCategoryId, setDragOverCategoryId] = React.useState(null);
  const dragEnabled = !isMobile;

  const [broadcasts, setBroadcasts] = React.useState([]);
  const [broadcastsLoading, setBroadcastsLoading] = React.useState(false);
  const [ackingId, setAckingId] = React.useState(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = React.useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = React.useState(false);

  const dynamicModuleByTab = React.useMemo(() => {
    const map = new Map();
    (dynamicModules || []).forEach((module) => {
      if (module?.tabId) {
        map.set(module.tabId, module);
      }
    });
    return map;
  }, [dynamicModules]);

  const activeDynamicModule = dynamicModuleByTab.get(activeTab) || null;

  const hideKitchenTitleOnMobile = isMobile && activeTab === 'orders' && !isHistoryView;

  const pageTitle = React.useMemo(() => {
    if (activeTab === 'orders') return isHistoryView ? 'Historial' : 'Cocina en Vivo';
    if (activeTab === 'caja') {
      const c = tabLabels.caja || 'Caja';
      return `${c} y Turnos`;
    }
    if (activeTab === 'analytics') return tabLabels.analytics || 'Reportes';
    if (activeDynamicModule) return tabLabels[activeTab] || activeDynamicModule.label;
    return tabLabels[activeTab] || activeTab;
  }, [activeTab, activeDynamicModule, isHistoryView, tabLabels]);

  const lastSyncLabel = React.useMemo(() => {
    if (!lastDataRefreshAt) return null;
    try {
      return new Date(lastDataRefreshAt).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'medium' });
    } catch {
      return null;
    }
  }, [lastDataRefreshAt]);

  const paletteItems = React.useMemo(() => {
    const core = ADMIN_PANEL_TAB_IDS.filter((id) => canAccessTab(id)).map((id) => ({
      id,
      label: tabLabels[id] || id,
      group: 'Panel',
    }));
    const mods = (dynamicModules || [])
      .filter((m) => canAccessTab(m.tabId))
      .map((m) => ({
        id: m.tabId,
        label: tabLabels[m.tabId] || m.label,
        group: 'Módulos',
      }));
    return [...core, ...mods];
  }, [canAccessTab, dynamicModules, tabLabels]);

  const shortcutRows = React.useMemo(() => {
    if (!adminShortcutsEnabled) return [];
    const base = [
      { keys: 'Mod + K', description: 'Buscar sección', group: 'General' },
      { keys: 'Mod + Shift + R', description: 'Actualizar datos del panel', group: 'General' },
      { keys: '?', description: 'Mostrar atajos', group: 'General' },
      { keys: 'Esc', description: 'Cerrar ventanas emergentes', group: 'General' },
    ];
    if (activeTab === 'inventory' && canAccessTab('inventory')) {
      base.push(
        { keys: '1 · 2 · 3 · 4', description: 'Resumen, Insumos, Movimientos, Recetas (con foco en la página, sin escribir en un campo)', group: 'Inventario' },
      );
    }
    return base;
  }, [adminShortcutsEnabled, activeTab, canAccessTab]);

  React.useEffect(() => {
    if (!adminShortcutsEnabled) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setCommandPaletteOpen(false);
        setShortcutsHelpOpen(false);
        return;
      }
      if (isTypingContext(e.target)) return;
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShortcutsHelpOpen((open) => !open);
        setCommandPaletteOpen(false);
        return;
      }
      if (isModKey(e) && String(e.key).toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((open) => !open);
        setShortcutsHelpOpen(false);
        return;
      }
      if (isModKey(e) && e.shiftKey && String(e.key).toLowerCase() === 'r') {
        e.preventDefault();
        void loadData(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [adminShortcutsEnabled, loadData]);

  const loadBroadcasts = React.useCallback(async () => {
    setBroadcastsLoading(true);
    try {
      const items = await listBroadcasts();
      setBroadcasts(Array.isArray(items) ? items : []);
    } catch {
      setBroadcasts([]);
    } finally {
      setBroadcastsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadBroadcasts();
  }, [loadBroadcasts]);

  const acknowledgeBroadcast = async (broadcastId) => {
    if (!broadcastId) return;

    setAckingId(broadcastId);
    try {
      await acknowledgeBroadcastService(broadcastId);
      setBroadcasts((prev) => prev.map((item) => (
        item.id === broadcastId
          ? { ...item, readAt: new Date().toISOString() }
          : item
      )));
      showNotify('Comunicado marcado como leído.');
    } catch (err) {
      showNotify(err instanceof Error ? err.message : 'No se pudo registrar el acuse', 'error');
    } finally {
      setAckingId(null);
    }
  };

  const handleDragStart = (categoryId) => {
    setDragCategoryId(categoryId);
  };

  const handleDragOver = (event, categoryId) => {
    event.preventDefault();
    if (categoryId !== dragOverCategoryId) {
      setDragOverCategoryId(categoryId);
    }
  };

  const handleDragLeave = (categoryId) => {
    if (dragOverCategoryId === categoryId) {
      setDragOverCategoryId(null);
    }
  };

  const handleDrop = async (event, categoryId) => {
    event.preventDefault();
    if (!dragCategoryId || dragCategoryId === categoryId) {
      setDragCategoryId(null);
      setDragOverCategoryId(null);
      return;
    }

    const ids = sortedCategories.map(cat => cat.id);
    const fromIndex = ids.indexOf(dragCategoryId);
    const toIndex = ids.indexOf(categoryId);
    if (fromIndex === -1 || toIndex === -1) {
      setDragCategoryId(null);
      setDragOverCategoryId(null);
      return;
    }

    const nextIds = [...ids];
    const [moved] = nextIds.splice(fromIndex, 1);
    nextIds.splice(toIndex, 0, moved);

    await reorderCategories(nextIds);
    setDragCategoryId(null);
    setDragOverCategoryId(null);
  };

  return (
    <div className="admin-layout">
      {notification && (
        <div className={`admin-notification ${notification.type} animate-slide-up`}>
          {notification.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{notification.msg}</span>
        </div>
      )}

      {productToDelete && (
        <div className="admin-modal-overlay" onClick={() => setProductToDelete(null)}>
          <div className="admin-confirm-modal" onClick={e => e.stopPropagation()}>
            <p>¿Eliminar producto?</p>
            <div className="admin-confirm-modal__actions">
              <button type="button" className="admin-btn secondary" onClick={() => setProductToDelete(null)}>Cancelar</button>
              <button type="button" className="admin-btn danger" onClick={confirmDeleteProduct}>Eliminar</button>
            </div>
          </div>
        </div>
      )}

      {categoryToDelete && (
        <div className="admin-modal-overlay" onClick={() => setCategoryToDelete(null)}>
          <div className="admin-confirm-modal" onClick={e => e.stopPropagation()}>
            <p>¿Eliminar categoría &quot;{categoryToDelete.name}&quot;? Los productos quedarán sin categoría.</p>
            <div className="admin-confirm-modal__actions">
              <button type="button" className="admin-btn secondary" onClick={() => setCategoryToDelete(null)}>Cancelar</button>
              <button type="button" className="admin-btn danger" onClick={confirmDeleteCategory}>Eliminar</button>
            </div>
          </div>
        </div>
      )}

      <AdminSidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isMobile={isMobile}
        kanbanColumns={kanbanColumns}
        userRole={userRole}
        canAccessTab={canAccessTab}
        onDeniedAccess={() => showNotify('Necesitas un rol diferente para acceder a esta sección.', 'error')}
        userEmail={userEmail || initialEmail}
        branchName={selectedBranch?.name}
        logoUrl={logoUrl}
        dynamicModules={dynamicModules}
        storefrontMenuUrl={storefrontMenuUrl}
        tabLabelsById={tabLabels}
        onLogout={async () => {
          await supabase.auth.signOut();
          navigate('/');
        }}
      />

      <main className="admin-content">
        <AdminTopBar
          title={pageTitle}
          hideTitleVisual={hideKitchenTitleOnMobile}
        >
            <AdminHeaderClock dataSyncedAtLabel={lastSyncLabel} className="header-action-clock" />
            <AdminNotificationCenter
              broadcasts={broadcasts}
              broadcastsLoading={broadcastsLoading}
              ackingId={ackingId}
              onAcknowledge={acknowledgeBroadcast}
              inventoryBranchRows={inventoryBranchRows}
              products={products}
              selectedBranch={selectedBranch}
              setActiveTab={setActiveTab}
              setEditingProduct={setEditingProduct}
              setIsModalOpen={setIsModalOpen}
              canAccessInventory={canAccessTab('inventory')}
              canAccessProducts={canAccessTab('products')}
            />
            {adminShortcutsEnabled ? (
              <button
                type="button"
                className="btn-icon-refresh admin-icon-btn header-action-shortcuts"
                onClick={() => { setShortcutsHelpOpen(true); setCommandPaletteOpen(false); }}
                title="Atajos de teclado (?)"
                aria-label="Atajos de teclado"
              >
                <HelpCircle size={24} strokeWidth={1.65} aria-hidden />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => loadData(true)}
              className="btn-icon-refresh admin-icon-btn header-action-refresh"
              disabled={refreshing}
              title="Actualizar datos (Mod+Shift+R)"
              aria-label="Actualizar datos"
            >
              <RefreshCw size={24} strokeWidth={1.65} className={refreshing ? 'animate-spin' : ''} />
            </button>

            <AdminBranchSelector
              branches={branches}
              selectedBranch={selectedBranch}
              onSelectBranch={setSelectedBranch}
              disabled={isBranchLocked}
              allowAllOption={activeTab === 'analytics'}
              lockTitle="Tu correo está bloqueado a una sucursal específica."
              className="header-action-branch"
            />

            {activeTab === 'orders' && (
              <div className="header-actions-orders-row">
                <button
                  type="button"
                  className={`btn header-action-orders-history ${isHistoryView ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setIsHistoryView(!isHistoryView)}
                >
                  {isHistoryView ? 'Ver Tablero' : 'Ver Historial'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsManualOrderModalOpen(true)}
                  className="btn btn-primary header-action-orders-manual"
                  disabled={selectedBranch?.id === 'all' || !selectedBranch}
                  title={selectedBranch?.id === 'all' ? 'Selecciona una sucursal' : undefined}
                >
                  <PlusCircle size={18} /> Pedido Manual
                </button>
              </div>
            )}
            {activeTab === 'products' && (
              <button
                type="button"
                onClick={() => { setEditingProduct(null); setIsModalOpen(true); }}
                className="btn btn-primary header-action-generic"
                disabled={!selectedBranch || selectedBranch.id === 'all'}
                title={selectedBranch?.id === 'all' ? 'Selecciona una sucursal' : undefined}
              >
                <Plus size={18} /> Nuevo Plato
              </button>
            )}
            {activeTab === 'categories' && (
              <button
                type="button"
                onClick={() => { setEditingCategory(null); setIsCategoryModalOpen(true); }}
                className="btn btn-primary header-action-generic"
                disabled={!selectedBranch || selectedBranch.id === 'all'}
                title={selectedBranch?.id === 'all' ? 'Selecciona una sucursal' : undefined}
              >
                <Plus size={18} /> Nueva Categ.
              </button>
            )}
        </AdminTopBar>

        <AdminBroadcastsBanner
          broadcasts={broadcasts}
          broadcastsLoading={broadcastsLoading}
          ackingId={ackingId}
          onAcknowledge={acknowledgeBroadcast}
        />

        {branches.length === 0 && !loading ? (
          <div className="admin-empty-branches glass animate-fade" role="status">
            <div className="admin-empty-branches__icon" aria-hidden>
              <Store size={40} strokeWidth={1.5} />
            </div>
            <h2 className="admin-empty-branches__title">No hay sucursales</h2>
            <p className="admin-empty-branches__text">
              Esta empresa aún no tiene locales configurados en el sistema, o no pudimos cargarlos.
              Las sucursales se crean desde el panel de administración SaaS; cuando existan, podrás gestionar pedidos, menú y caja por local.
            </p>
            <button
              type="button"
              className="admin-btn primary admin-empty-branches__retry"
              onClick={() => void refreshBranches()}
            >
              <RefreshCw size={18} strokeWidth={1.65} />
              Reintentar carga
            </button>
          </div>
        ) : branches.length === 0 ? (
          <AdminTabFallback />
        ) : (
        <>
        {/* 1. PEDIDOS */}
        {activeTab === 'orders' && (
          !isHistoryView ? (
            <AdminErrorBoundary tabLabel={tabLabels.orders || 'Pedidos'} onRetry={() => loadData(true)}>
              <AdminKanban
                columns={kanbanColumns}
                isMobile={isMobile}
                mobileTab={mobileTab}
                setMobileTab={setMobileTab}
                moveOrder={moveOrder}
                setReceiptModalOrder={setReceiptModalOrder}
                branch={selectedBranch}
                clients={clients}
                logoUrl={logoUrl}
                companyName={companyName}
                showNotify={showNotify}
                products={products}
                categories={categories}
                onOrderSaved={() => loadData(true)}
              />
            </AdminErrorBoundary>
          ) : (
            <AdminErrorBoundary tabLabel={tabLabels.orders || 'Pedidos'} onRetry={() => loadData(true)}>
              <React.Suspense fallback={<AdminTabFallback />}>
                <AdminHistoryTable orders={kanbanColumns.history} setReceiptModalOrder={setReceiptModalOrder} />
              </React.Suspense>
            </AdminErrorBoundary>
          )
        )}

        {/* 2. INVENTARIO (productos / platos) */}
        {activeTab === 'products' && (
          <AdminErrorBoundary
            tabLabel={tabLabels.products || 'Productos'}
            onRetry={() => loadData(true)}
          >
          <div className="products-view animate-fade">
            
            {/* BARRA DE ESTADÍSTICAS */}
            <div className="admin-stats-bar glass">
              <div className="admin-stats-bar__item">
                <div className="admin-stats-bar__icon"><Package size={18} /></div>
                <div>
                  <span className="admin-stats-bar__label">Total Platos</span>
                  <strong className="admin-stats-bar__value">{productStats.total}</strong>
                </div>
              </div>
              <div className="admin-stats-bar__divider" aria-hidden />
              <div className="admin-stats-bar__item">
                <div className="admin-stats-bar__icon admin-stats-bar__icon--success"><Eye size={18} /></div>
                <div>
                  <span className="admin-stats-bar__label">Activos</span>
                  <strong className="admin-stats-bar__value admin-stats-bar__value--success">{productStats.active}</strong>
                </div>
              </div>
              <div className="admin-stats-bar__divider" aria-hidden />
              <div className="admin-stats-bar__item">
                <div className="admin-stats-bar__icon admin-stats-bar__icon--danger"><EyeOff size={18} /></div>
                <div>
                  <span className="admin-stats-bar__label">Pausados</span>
                  <strong className="admin-stats-bar__value admin-stats-bar__value--danger">{productStats.paused}</strong>
                </div>
              </div>
            </div>

            <div className="admin-toolbar glass">
              <div className="admin-toolbar-row">
                <div className="search-box">
                  <Search size={18} />
                  <input placeholder="Buscar plato..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                </div>
                
                <div className="filter-box">
                  <Filter size={18} />
                  <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
                    <option value="all">Todas las categorías</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                <div className="filter-box">
                  <Eye size={18} />
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                    <option value="all">Todos los estados</option>
                    <option value="active">Solo Activos</option>
                    <option value="paused">Solo Pausados</option>
                  </select>
                </div>
              </div>

              <div className="admin-toolbar-actions">
                 <div className="filter-box filter-box--compact">
                    <ArrowUpDown size={18} />
                    <select value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
                      <option value="name-asc">Nombre (A-Z)</option>
                      <option value="price-asc">Precio (Menor a Mayor)</option>
                      <option value="price-desc">Precio (Mayor a Menor)</option>
                    </select>
                 </div>
                 <button className={`btn-icon-toggle ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')} title="Vista Grilla">
                    <LayoutGrid size={18} />
                 </button>
                 <button className={`btn-icon-toggle ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')} title="Vista Lista">
                    <List size={18} />
                 </button>
              </div>
            </div>
            
            <div className={`inventory-grid ${viewMode === 'list' ? 'list-mode' : ''}`}>
              {processedProducts.map(p => (
                  <InventoryCard
                    key={p.id}
                    product={p}
                    viewMode={viewMode}
                    toggleProductActive={toggleProductActive}
                    setEditingProduct={setEditingProduct}
                    setIsModalOpen={setIsModalOpen}
                    deleteProduct={deleteProduct}
                  />
                ))
              }
            </div>
          </div>
          </AdminErrorBoundary>
        )}

        {/* 2.5 NUEVO INVENTARIO (INSUMOS) */}
        {activeTab === 'inventory' && (
          <AdminErrorBoundary tabLabel={tabLabels.inventory || 'Inventario'} onRetry={() => loadData(true)}>
            <React.Suspense fallback={<AdminTabFallback />}>
              <AdminInventory
                showNotify={showNotify}
                branchId={selectedBranch?.id}
                branches={branches}
                companyId={companyIdForClients}
                products={products}
              />
            </React.Suspense>
          </AdminErrorBoundary>
        )}

        {activeTab === 'menu_options' && (
          <AdminErrorBoundary tabLabel={tabLabels.menu_options || 'Opciones de menú'} onRetry={() => void refreshBranches()}>
            <React.Suspense fallback={<AdminTabFallback />}>
              <AdminMenuOptions
                showNotify={showNotify}
                selectedBranch={selectedBranch}
                companyId={companyIdForClients}
                onDeliverySaved={() => void refreshBranches()}
              />
            </React.Suspense>
          </AdminErrorBoundary>
        )}

        {activeTab === 'menu_beverages' && (
          <AdminErrorBoundary tabLabel={tabLabels.menu_beverages || 'Bebidas'} onRetry={() => void refreshBranches()}>
            <React.Suspense fallback={<AdminTabFallback />}>
              <AdminMenuBeverages
                showNotify={showNotify}
                selectedBranch={selectedBranch}
                companyId={companyIdForClients}
                onSaved={() => void refreshBranches()}
              />
            </React.Suspense>
          </AdminErrorBoundary>
        )}

        {activeTab === 'menu_extras' && (
          <AdminErrorBoundary tabLabel={tabLabels.menu_extras || 'Extras'} onRetry={() => void refreshBranches()}>
            <React.Suspense fallback={<AdminTabFallback />}>
              <AdminMenuExtras
                showNotify={showNotify}
                selectedBranch={selectedBranch}
                companyId={companyIdForClients}
                onSaved={() => void refreshBranches()}
              />
            </React.Suspense>
          </AdminErrorBoundary>
        )}

        {/* 3. REPORTES */}
        {activeTab === 'analytics' && (
          <AdminErrorBoundary tabLabel={tabLabels.analytics || 'Reportes'} onRetry={() => loadData(true)}>
            <React.Suspense fallback={<AdminTabFallback />}>
              <AdminAnalytics 
                orders={orders} 
                products={products} 
                clients={clients} 
                branches={branches.filter(b => b.id !== 'all')}
                showNotify={showNotify}
                companyId={companyIdForClients}
                selectedBranch={selectedBranch}
              />
            </React.Suspense>
          </AdminErrorBoundary>
        )}

        {/* 4. CLIENTES */}
        {activeTab === 'clients' && (
          <AdminErrorBoundary tabLabel={tabLabels.clients || 'Clientes'} onRetry={() => loadData(true)}>
            <React.Suspense fallback={<AdminTabFallback />}>
              <AdminClients
                clients={clients}
                orders={orders}
                onSelectClient={handleSelectClient}
                onClientCreated={() => loadData(true)}
                onClientDeleted={() => loadData(true)}
                showNotify={showNotify}
                companyId={companyIdForClients}
              />
            </React.Suspense>
          </AdminErrorBoundary>
        )}

        {activeTab === 'coupons' && (
          <AdminErrorBoundary tabLabel={tabLabels.coupons || 'Cupones'} onRetry={() => loadData(true)}>
            <React.Suspense fallback={<AdminTabFallback />}>
              <AdminCoupons showNotify={showNotify} companyId={companyIdForClients} />
            </React.Suspense>
          </AdminErrorBoundary>
        )}

        {activeDynamicModule && activeDynamicModule.tabId === 'module:tickets' && (
          <AdminErrorBoundary tabLabel={tabLabels['module:tickets'] || activeDynamicModule.label || 'Soporte'} onRetry={() => loadData(true)}>
            <TenantTicketsPanel showNotify={showNotify} primaryColor={primaryColor} />
          </AdminErrorBoundary>
        )}

        {activeDynamicModule && activeDynamicModule.tabId !== 'module:tickets' && (
          <AdminErrorBoundary tabLabel={tabLabels[activeDynamicModule.tabId] || activeDynamicModule.label || 'Módulo'} onRetry={() => loadData(true)}>
          <div className="glass admin-dynamic-module">
            <div>
              <p className="admin-dynamic-module__desc">
                {activeDynamicModule.description || 'Módulo agregado desde SaaS. Aquí vivirá la nueva funcionalidad del panel admin.'}
              </p>
            </div>
            <div className="admin-dynamic-module__placeholder">
              <p>
                Este espacio está listo para implementar la lógica del módulo <strong>{activeDynamicModule.label}</strong>.
              </p>
            </div>
          </div>
          </AdminErrorBoundary>
        )}

        {/* 4.5 CAJA */}
        {activeTab === 'caja' && (
          <AdminErrorBoundary tabLabel={tabLabels.caja || 'Caja'} onRetry={() => loadData(true)}>
            <React.Suspense fallback={<AdminTabFallback />}>
              <CashManager
                showNotify={showNotify}
                selectedBranchId={selectedBranch?.id}
                selectedBranch={selectedBranch}
                orders={orders}
              />
            </React.Suspense>
          </AdminErrorBoundary>
        )}

        {/* 5. CATEGORÍAS */}
        {activeTab === 'categories' && (
          <AdminErrorBoundary tabLabel={tabLabels.categories || 'Categorías'} onRetry={() => loadData(true)}>
          <div className="cat-container">
            {(!selectedBranch || selectedBranch.id === 'all') ? (
              <div className="cat-empty-state">
                <div className="cat-empty-icon">
                  <List size={48} />
                </div>
                <h3 className="cat-empty-title">Selecciona una sucursal</h3>
                <p className="cat-empty-text">El orden y activación de categorías es por local.</p>
              </div>
            ) : (
            <div className="cat-grid">
              {sortedCategories.map(c => {
                const categoryProducts = products.filter(p => p.category_id === c.id);
                const activeProducts = categoryProducts.filter(p => p.is_active);
                const totalRevenue = orders
                  .filter(o => o.status === 'completed' || o.status === 'picked_up')
                  .reduce((sum, order) => {
                    const items = Array.isArray(order.items) ? order.items : [];
                    return sum + items.reduce((itemSum, item) => {
                      const product = products.find(p => p.id === (item.id ?? item.product_id));
                      if (!product || product.category_id !== c.id) return itemSum;
                      const qty = Math.max(0, Number(item.quantity) || 1);
                      const price = Number(item.price) ?? 0;
                      return itemSum + price * qty;
                    }, 0);
                  }, 0);
                
                return (
                  <div
                    key={c.id}
                    className={`cat-card glass${dragCategoryId === c.id ? ' is-dragging' : ''}${dragOverCategoryId === c.id ? ' is-drop-target' : ''}`}
                    draggable={dragEnabled}
                    onDragStart={dragEnabled ? () => handleDragStart(c.id) : undefined}
                    onDragEnd={dragEnabled ? () => { setDragCategoryId(null); setDragOverCategoryId(null); } : undefined}
                    onDragOver={dragEnabled ? (event) => handleDragOver(event, c.id) : undefined}
                    onDragLeave={dragEnabled ? () => handleDragLeave(c.id) : undefined}
                    onDrop={dragEnabled ? (event) => handleDrop(event, c.id) : undefined}
                  >
                    <div className="cat-card-header">
                      <div className="cat-icon-wrapper">
                        <Tag size={24} />
                      </div>
                      <button
                        type="button"
                        className="cat-status-badge cat-status-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleCategoryActive(c.id, !c.is_active);
                        }}
                        title={c.is_active ? 'Desactivar categoría' : 'Activar categoría'}
                      >
                        <span className={`cat-status-dot ${c.is_active ? 'active' : 'inactive'}`}></span>
                        <span className="cat-status-text">{c.is_active ? 'Activa' : 'Inactiva'}</span>
                      </button>
                    </div>
                    
                    <div className="cat-card-body">
                      <div className="cat-name-row">
                        <h3 className="cat-name">{c.name}</h3>
                        <span className="cat-order-badge">#{Number(c.order) || 0}</span>
                      </div>
                      
                      <div className="cat-stats">
                        <div className="cat-stat">
                          <span className="cat-stat-label">Productos</span>
                          <span className="cat-stat-value">{categoryProducts.length}</span>
                        </div>
                        <div className="cat-stat">
                          <span className="cat-stat-label">Activos</span>
                          <span className="cat-stat-value">{activeProducts.length}</span>
                        </div>
                      </div>
                      
                      <div className="cat-revenue">
                        <span className="cat-revenue-label">Ingresos totales</span>
                        <span className="cat-revenue-value">${totalRevenue.toLocaleString('es-CL')}</span>
                      </div>
                      
                      <div className="cat-progress-wrapper">
                        <div className="cat-progress-bar">
                          <div 
                            className="cat-progress-fill" 
                            style={{ width: `${products.length > 0 ? (categoryProducts.length / products.length) * 100 : 0}%` }}
                          ></div>
                        </div>
                        <span className="cat-progress-text">
                          {products.length > 0 ? Math.round((categoryProducts.length / products.length) * 100) : 0}% del catálogo
                        </span>
                      </div>
                    </div>
                    
                    <div className="cat-card-footer">
                      <button 
                        onClick={() => { setEditingCategory(c); setIsCategoryModalOpen(true) }} 
                        className="cat-btn-edit"
                      >
                        <Edit size={16} />
                        Editar
                      </button>
                      <button 
                        onClick={() => {
                          setFilterCategory(c.id);
                          setActiveTab('products');
                        }}
                        className="cat-btn-view"
                      >
                        <ShoppingBag size={16} />
                        Ver productos
                      </button>
                      <button 
                        type="button"
                        onClick={() => deleteCategory(c)}
                        className="cat-btn-delete"
                        title="Eliminar categoría"
                      >
                        <Trash2 size={16} />
                        Borrar
                      </button>
                    </div>
                  </div>
                );
              })}
              
              {categories.length === 0 && (
                <div className="cat-empty-state">
                  <div className="cat-empty-icon">
                    <List size={48} />
                  </div>
                  <h3 className="cat-empty-title">No hay categorías</h3>
                  <p className="cat-empty-text">Crea tu primera categoría para organizar tus productos</p>
                  <button 
                    onClick={() => { setEditingCategory(null); setIsCategoryModalOpen(true) }} 
                    className="btn btn-primary"
                  >
                    <Plus size={18} /> Crear Categoría
                  </button>
                </div>
              )}
            </div>
            )}
          </div>
          </AdminErrorBoundary>
        )}
        </>
        )}

        <AdminCommandPalette
          open={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          items={paletteItems}
          onSelect={(id) => setActiveTab(id)}
        />
        <AdminShortcutsModal
          open={shortcutsHelpOpen}
          onClose={() => setShortcutsHelpOpen(false)}
          rows={shortcutRows}
        />
      </main>

      {/* PANEL CLIENTE LATERAL (MODULARIZADO) */}
      <ClientDetailsPanel
        selectedClient={selectedClient}
        setSelectedClient={setSelectedClient}
        clientHistoryLoading={clientHistoryLoading}
        selectedClientOrders={selectedClientOrders}
        setReceiptModalOrder={setReceiptModalOrder}
      />



      {/* MODAL COMPROBANTE (EXISTENTE) */}
      {receiptModalOrder && (
        <div className="admin-panel-overlay" onClick={() => { if (receiptPreview) URL.revokeObjectURL(receiptPreview); setReceiptModalOrder(null); setReceiptPreview(null); }}>
          <div className="admin-side-panel glass animate-slide-in" style={{ maxWidth: 450 }} onClick={e => e.stopPropagation()}>
            <div className="admin-side-header">
              <h3>Comprobante de Pago</h3>
              <button onClick={() => { if (receiptPreview) URL.revokeObjectURL(receiptPreview); setReceiptModalOrder(null); setReceiptPreview(null); }} className="btn-close-sidepanel"><X size={24} /></button>
            </div>
            <div className="admin-side-body">
              {receiptModalOrder.payment_ref && receiptModalOrder.payment_ref.startsWith('http') && !receiptPreview && (
                <div style={{ marginBottom: 20 }}>
                  <p style={{ marginBottom: 10, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Comprobante actual:</p>
                  <a href={receiptModalOrder.payment_ref} target="_blank" rel="noreferrer" style={{ display: 'block', marginBottom: 15 }}>
                    <img src={receiptModalOrder.payment_ref} alt="Comprobante" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--card-border)' }} />
                  </a>
                </div>
              )}

              <div className="form-group">
                <label>Subir nuevo comprobante</label>
                <div className="upload-box" onClick={() => document.getElementById('receipt-upload-modal').click()} style={{ borderColor: receiptPreview ? '#25d366' : 'var(--card-border)' }}>
                  <input type="file" id="receipt-upload-modal" accept="image/*" hidden onChange={handleReceiptFileChange} />
                  {receiptPreview ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 15, justifyContent: 'center', position: 'relative' }}>
                      <img src={receiptPreview} alt="Preview" style={{ width: 80, height: 80, borderRadius: 8, objectFit: 'cover', border: '1px solid white' }} />
                      <div style={{ textAlign: 'left' }}>
                        <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: 'white' }}>Imagen Seleccionada</span>
                        <span style={{ fontSize: '0.75rem', color: '#25d366' }}>Click para cambiar</span>
                        <button 
                          type="button" 
                          className="btn-text" 
                          style={{ color: '#ff4444', fontSize: '0.75rem', padding: 0, marginTop: 4 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setReceiptPreview(null);
                            document.getElementById('receipt-upload-modal').value = '';
                          }}
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="upload-placeholder">
                      <Upload size={24} />
                      <span>Subir imagen</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="admin-side-footer">
              <button
                className="btn btn-primary btn-block"
                onClick={() => {
                  const fileInput = document.getElementById('receipt-upload-modal');
                  if (fileInput?.files[0]) {
                    uploadReceiptToOrder(receiptModalOrder.id, fileInput.files[0]);
                  } else {
                    showNotify('Selecciona una imagen', 'error');
                  }
                }}
                disabled={uploadingReceipt || !receiptPreview}
              >
                {uploadingReceipt ? 'Subiendo...' : 'Guardar Comprobante'}
              </button>
            </div>
          </div>
        </div>
      )}


      <ManualOrderModal
        isOpen={isManualOrderModalOpen}
        onClose={() => setIsManualOrderModalOpen(false)}
        products={products}
        categories={categories}
        onOrderSaved={() => loadData(true)}
        isMobile={isMobile}
        showNotify={showNotify}
        registerSale={cashSystem.registerSale}
        branch={selectedBranch}
        logoUrl={logoUrl}
        companyName={companyName}
      />

      {isModalOpen && (
        <ProductModal
          key={`product-modal-${editingProduct?.id ?? 'new'}`}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveProduct}
          product={editingProduct}
          categories={categories}
          saving={refreshing}
          companyId={companyId}
          inventoryItems={productRecipeInventoryOptions}
        />
      )}

      {/* MODAL DE SELECCIÓN DE ALCANCE */}
      <ScopeSelectionModal
        isOpen={scopeModal.isOpen}
        onClose={() => setScopeModal({ ...scopeModal, isOpen: false })}
        onConfirm={handleScopeConfirm}
        branchName={selectedBranch?.name || 'Sucursal'}
        actionType={scopeModal.item?.is_active ? 'deactivate' : 'activate'}
      />

      <CategoryModal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        onSave={handleSaveCategory}
        category={editingCategory}
        defaultOrder={editingCategory ? editingCategory.order : nextCategoryOrder}
      />
    </div>
  );
};

const Admin = () => (
  <AdminProvider>
    <AdminPage />
  </AdminProvider>
);

export default Admin;
