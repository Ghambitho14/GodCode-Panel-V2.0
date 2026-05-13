import React, { useState, useMemo, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, Plus, Download, Filter, MoreVertical, ArrowUpDown, ChevronLeft, ChevronRight, MessageCircle, Star, UserCircle, Copy, Trash2, Loader2 } from 'lucide-react';
import { supabase, TABLES } from '@/integrations/supabase';
import ClientFormModal from './ClientFormModal';
import AdminIconSlot from './AdminIconSlot';
import { downloadExcel } from '@/shared/utils/exportUtils';
import { getScrollableAncestors } from '@/shared/utils/scrollAncestors';
import { WhatsAppGlyph, buildWhatsAppUrl } from '@/shared/utils/phoneWhatsApp';
import { formatMoneyCl } from '@/shared/utils/numberSafe';

const AdminClients = ({ clients, orders, onSelectClient, onClientCreated, onClientDeleted, showNotify, companyId }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [activeFilter, setActiveFilter] = useState('all'); // all, elite, top, frequent
    const [isFormOpen, setIsFormOpen] = useState(false);
    
    // --- ESTADOS DE TABLA AVANZADA ---
    const [sortConfig, setSortConfig] = useState({ key: 'last_order_at', direction: 'desc' });
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;
    const [menuOpenClientId, setMenuOpenClientId] = useState(null);
    const [deletingClientId, setDeletingClientId] = useState(null);
    /** Coordenadas viewport para menú fijo (evita sticky header y overflow del main) */
    const [kebabMenuPos, setKebabMenuPos] = useState(null);

    const closeKebabMenu = useCallback(() => {
        setMenuOpenClientId(null);
        setKebabMenuPos(null);
    }, []);

    const setCurrentPageWithMenuClose = useCallback(
        (valueOrUpdater) => {
            closeKebabMenu();
            setCurrentPage(valueOrUpdater);
        },
        [closeKebabMenu],
    );

    const updateKebabMenuPosFromButton = useCallback((buttonEl) => {
        if (!buttonEl || typeof buttonEl.getBoundingClientRect !== 'function') return;
        const r = buttonEl.getBoundingClientRect();
        const margin = 10;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const menuW = Math.min(11.5 * remPx, vw - margin * 2);
        const menuH = 220;

        let left = r.right - menuW;
        left = Math.max(margin, Math.min(left, vw - menuW - margin));

        let top = r.bottom + 6;
        if (top + menuH > vh - margin) {
            top = Math.max(margin, r.top - menuH - 6);
        }

        setKebabMenuPos({ top, left });
    }, []);

    useLayoutEffect(() => {
        if (!menuOpenClientId) return undefined;
        const idEscaped = String(menuOpenClientId).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

        let rafId = null;
        const runReposition = () => {
            const btn = document.querySelector(`[data-clients-kebab-id="${idEscaped}"]`);
            if (btn) updateKebabMenuPosFromButton(btn);
        };

        const scheduleReposition = () => {
            if (rafId != null) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                runReposition();
            });
        };

        runReposition();

        const btn = document.querySelector(`[data-clients-kebab-id="${idEscaped}"]`);
        const scrollRoots = btn ? getScrollableAncestors(btn) : [];
        /* main.admin-content suele hacer scroll; por si no entra en la cadena de overflow */
        const mainContent = typeof document !== 'undefined'
            ? document.querySelector('.admin-layout main.admin-content')
            : null;
        const extraScrollRoots = mainContent && !scrollRoots.includes(mainContent) ? [mainContent] : [];

        /* Scroll: reposición inmediata (sin rAF) para que el menú fixed no “flote” desincronizado */
        scrollRoots.forEach((el) => {
            el.addEventListener('scroll', runReposition, { passive: true });
        });
        extraScrollRoots.forEach((el) => {
            el.addEventListener('scroll', runReposition, { passive: true });
        });
        window.addEventListener('scroll', runReposition, true);
        window.addEventListener('resize', scheduleReposition);

        const vv = typeof window !== 'undefined' ? window.visualViewport : null;
        if (vv) {
            vv.addEventListener('scroll', runReposition);
            vv.addEventListener('resize', scheduleReposition);
        }

        return () => {
            if (rafId != null) cancelAnimationFrame(rafId);
            scrollRoots.forEach((el) => {
                el.removeEventListener('scroll', runReposition);
            });
            extraScrollRoots.forEach((el) => {
                el.removeEventListener('scroll', runReposition);
            });
            window.removeEventListener('scroll', runReposition, true);
            window.removeEventListener('resize', scheduleReposition);
            if (vv) {
                vv.removeEventListener('scroll', runReposition);
                vv.removeEventListener('resize', scheduleReposition);
            }
        };
    }, [menuOpenClientId, updateKebabMenuPosFromButton]);

    useEffect(() => {
        if (!menuOpenClientId) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') closeKebabMenu();
        };
        document.addEventListener('keydown', onKey);
        const onDoc = (e) => {
            if (!(e.target instanceof Element)) {
                closeKebabMenu();
                return;
            }
            if (e.target.closest('.clients-kebab-menu--portal')) return;
            if (e.target.closest('[data-clients-kebab-id]')) return;
            closeKebabMenu();
        };
        const t = window.setTimeout(() => {
            document.addEventListener('click', onDoc);
        }, 0);
        return () => {
            window.clearTimeout(t);
            document.removeEventListener('click', onDoc);
            document.removeEventListener('keydown', onKey);
        };
    }, [menuOpenClientId, closeKebabMenu]);

    // Calcular métricas derivadas por cliente usando orders
    const enrichedClients = useMemo(() => {
        if (!Array.isArray(clients)) return [];
        const safeOrders = Array.isArray(orders) ? orders : [];
        
        // [OPTIMIZACIÓN] Crear un mapa indexado por client_id (O(N))
        // Esto evita recorrer todo el array de orders dentro del map de clientes (O(N^2))
        const ordersMap = safeOrders.reduce((acc, o) => {
            if (o.status === 'cancelled') return acc; // Ignorar cancelados globalmente
            if (!acc[o.client_id]) acc[o.client_id] = [];
            acc[o.client_id].push(o);
            return acc;
        }, {});

        return clients.map(client => {
            // Acceso directo O(1) en lugar de filter O(N)
            const clientOrders = ordersMap[client.id] || [];
            
            // [FIX MULTI-SUCURSAL] Usar datos GLOBALES de la DB para segmento y fidelidad
            // Si usamos solo 'clientOrders' (que puede estar filtrado por sucursal), 
            // un cliente VIP parecería nuevo en otra sucursal.
            const globalTotalOrders = client.total_orders || clientOrders.length;
            const dbSpent = Number(client.total_spent);
            const globalTotalSpent = Number.isFinite(dbSpent) && dbSpent > 0
                ? dbSpent
                : clientOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
            
            const fidelityPoints = Math.floor(globalTotalSpent / 1000); // 1 punto por cada $1000
            
            // Segmento
            let segment = 'none';
            if (globalTotalOrders >= 20) segment = 'elite';
            else if (globalTotalOrders >= 10) segment = 'top';
            else if (globalTotalOrders >= 5) segment = 'frequent';
            else if (globalTotalOrders > 0) segment = 'buyer';

            // Estado
            const lastDate = clientOrders.length > 0 
                ? Math.max(...clientOrders.map(o => new Date(o.created_at).getTime()))
                : (client.last_order_at ? new Date(client.last_order_at).getTime() : null);
                
            let status = 'inactive';
            if (lastDate) {
                const daysDiff = (new Date().getTime() - lastDate) / (1000 * 60 * 60 * 24);
                if (daysDiff < 30) status = 'active';
                else if (daysDiff < 60) status = 'risk';
                else if (daysDiff < 90) status = 'sleeping';
                else status = 'inactive';
            }

            return {
                ...client,
                totalOrders: globalTotalOrders, // Mostrar total histórico real
                total_orders: globalTotalOrders,
                total_spent: globalTotalSpent,
                fidelityPoints,
                segment,
                status,
            };
        });
    }, [clients, orders]);

    // Filtrar
    const filteredClients = useMemo(() => {
        return enrichedClients.filter(client => {
            // Texto
            const searchLower = searchTerm.toLowerCase();
            const matchesSearch = 
                (client.name || '').toLowerCase().includes(searchLower) ||
                (client.phone || '').includes(searchLower) ||
                (client.email || '').toLowerCase().includes(searchLower);

            if (!matchesSearch) return false;

            // Tabs
            if (activeFilter === 'all') return true;
            if (activeFilter === 'elite') return client.segment === 'elite';
            if (activeFilter === 'top') return client.segment === 'top';
            if (activeFilter === 'frequent') return client.segment === 'frequent' || client.segment === 'buyer'; // Agrupar?
            // La referencia tenía: Elite, Top, Frecuente
            if (activeFilter === 'frequent_only') return client.segment === 'frequent';

            return true;
        });
    }, [enrichedClients, searchTerm, activeFilter]);

    // --- ORDENAMIENTO (SORTING) ---
    const sortedClients = useMemo(() => {
        const sorted = [...filteredClients];
        if (sortConfig.key) {
            sorted.sort((a, b) => {
                let aVal = a[sortConfig.key];
                let bVal = b[sortConfig.key];

                // Manejo de nulos
                if (aVal === null || aVal === undefined) aVal = '';
                if (bVal === null || bVal === undefined) bVal = '';

                // Manejo específico de fechas y strings
                if (sortConfig.key === 'last_order_at') {
                    aVal = aVal ? new Date(aVal).getTime() : 0;
                    bVal = bVal ? new Date(bVal).getTime() : 0;
                } else if (typeof aVal === 'string') {
                    aVal = aVal.toLowerCase();
                    bVal = bVal.toLowerCase();
                }

                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return sorted;
    }, [filteredClients, sortConfig]);

    // --- PAGINACIÓN ---
    const paginatedClients = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return sortedClients.slice(start, start + itemsPerPage);
    }, [sortedClients, currentPage]);

    const kebabOpenClient = useMemo(
        () => (menuOpenClientId ? paginatedClients.find((c) => c.id === menuOpenClientId) ?? null : null),
        [menuOpenClientId, paginatedClients],
    );

    useEffect(() => {
        if (!menuOpenClientId || kebabOpenClient) return undefined;
        const frameId = window.requestAnimationFrame(() => {
            closeKebabMenu();
        });
        return () => window.cancelAnimationFrame(frameId);
    }, [menuOpenClientId, kebabOpenClient, closeKebabMenu]);

    const totalPages = Math.ceil(sortedClients.length / itemsPerPage);

    const handleSort = (key) => {
        setSortConfig(current => ({
            key,
            direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    const getSegmentBadge = (segment) => {
        switch(segment) {
            case 'elite': return <span className="segment-badge segment-elite">Comprador Élite</span>;
            case 'top': return <span className="segment-badge segment-top">Comprador Top</span>;
            case 'frequent': return <span className="segment-badge segment-frequent">Comprador Frecuente</span>;
            case 'buyer': return <span className="segment-badge segment-buyer">Comprador</span>;
            default: return <span className="segment-badge segment-none">Sin pedidos</span>;
        }
    };

    const getStatusIndicator = (status) => {
        switch(status) {
            case 'active': return <div className="status-indicator"><div className="dot active"></div> Activo</div>;
            case 'risk': return <div className="status-indicator"><div className="dot risk"></div> En riesgo</div>;
            case 'sleeping': return <div className="status-indicator"><div className="dot sleeping"></div> Durmiendo</div>;
            default: return <div className="status-indicator"><div className="dot inactive"></div> Inactivo</div>;
        }
    };

    const handleExportCSV = () => {
        if (filteredClients.length === 0) {
            showNotify('No hay clientes para exportar', 'info');
            return;
        }

        const dataToExport = filteredClients.map(c => ({
            Nombre: c.name || 'Sin Nombre',
            Teléfono: c.phone || '',
            Email: c.email || '',
            RUT: c.rut || '',
            'Total Pedidos': c.totalOrders || 0,
            'Total Gastado ($)': c.total_spent || 0,
            'Puntos Fidelity': c.fidelityPoints || 0,
            Segmento: c.segment || 'none',
            Estado: c.status || 'inactive'
        }));

        downloadExcel(dataToExport, `Clientes_CRM_${new Date().toISOString().split('T')[0]}.xls`);
        showNotify('Base de clientes exportada', 'success');
    };

    const openWhatsApp = (e, phone) => {
        e.stopPropagation();
        const url = buildWhatsAppUrl(phone);
        if (!url) return;
        window.open(url, '_blank');
    };

    const copyPhone = async (e, phone) => {
        e.stopPropagation();
        if (!phone) return;
        try {
            await navigator.clipboard.writeText(phone);
            showNotify('Teléfono copiado', 'success');
        } catch {
            showNotify('No se pudo copiar el teléfono', 'error');
        }
        closeKebabMenu();
    };

    const handleDeleteClient = async (client) => {
        if (!companyId) {
            showNotify('No hay empresa asociada', 'error');
            return;
        }
        const label = client.name?.trim() || 'este cliente';
        const ok = window.confirm(
            `¿Eliminar a ${label}? Esta acción no se puede deshacer.\n\nSi el cliente tiene pedidos u otros registros vinculados, deberás eliminarlos o reasignarlos antes.`,
        );
        if (!ok) return;

        setDeletingClientId(client.id);
        try {
            const { error } = await supabase
                .from(TABLES.clients)
                .delete()
                .eq('id', client.id)
                .eq('company_id', companyId);

            if (error) {
                const msg = String(error.message || '');
                if (error.code === '23503' || /foreign key|llave foránea|violates foreign key/i.test(msg)) {
                    showNotify(
                        'No se puede eliminar: hay pedidos u otros datos vinculados a este cliente.',
                        'error',
                    );
                } else {
                    showNotify(msg || 'Error al eliminar cliente', 'error');
                }
                return;
            }
            showNotify('Cliente eliminado', 'success');
            closeKebabMenu();
            onClientDeleted?.();
        } catch (e) {
            console.error('Error eliminando cliente:', e);
            showNotify('Error al eliminar cliente', 'error');
        } finally {
            setDeletingClientId(null);
        }
    };

    const kebabPortalTarget = typeof document !== 'undefined'
        ? document.querySelector('.admin-layout') ?? document.body
        : null;

    return (
        <div className="clients-container animate-fade">
            
            {/* HEADER */}
            <div className="clients-header clients-header--toolbar-only">
                <div className="clients-actions">
                    <div className="search-box">
                        <Search size={18} className="clients-search-icon" aria-hidden />
                        <input 
                            type="text" 
                            placeholder="Buscar cliente..." 
                            value={searchTerm}
                            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPageWithMenuClose(1); }}
                        />
                    </div>
                    
                    <button className="btn-icon-text btn-white" onClick={handleExportCSV}>
                        <Download size={18} /> Exportar CSV
                    </button>
                    
                    <button className="btn btn-primary btn-icon-text" onClick={() => setIsFormOpen(true)}>
                        <Plus size={18} /> Nuevo cliente
                    </button>
                </div>
            </div>

            {/* FILTROS */}
            <div className="clients-filters">
                <div className="filter-btn-trigger">
                    <Filter size={18} /> Filtro
                </div>
                <button 
                    className={`filter-chip ${activeFilter === 'all' ? 'active' : ''}`}
                    onClick={() => { setActiveFilter('all'); setCurrentPage(1); }}
                >
                    Todo
                </button>
                <button 
                    className={`filter-chip ${activeFilter === 'elite' ? 'active' : ''}`}
                    onClick={() => { setActiveFilter('elite'); setCurrentPageWithMenuClose(1); }}
                >
                    Comprador Élite
                </button>
                <button 
                    className={`filter-chip ${activeFilter === 'top' ? 'active' : ''}`}
                    onClick={() => { setActiveFilter('top'); setCurrentPageWithMenuClose(1); }}
                >
                    Comprador Top
                </button>
                <button 
                    className={`filter-chip ${activeFilter === 'frequent' ? 'active' : ''}`}
                    onClick={() => { setActiveFilter('frequent'); setCurrentPageWithMenuClose(1); }}
                >
                    Comprador Frecuente
                </button>
                <div className="clients-total-count">
                    Total: {filteredClients.length}
                </div>
            </div>

            {/* TABLA (scroll horizontal fuera; contenedor interno visible para menú kebab) */}
            <div className="clients-table-scroll">
            <div className="clients-table-container">
                <table className="clients-table">
                    <thead>
                        <tr>
                            <th onClick={() => handleSort('name')} className="sortable-th">
                                CLIENTE {sortConfig.key === 'name' && <ArrowUpDown size={12} />}
                            </th>
                            <th className="hide-mobile">CANAL</th>
                            <th onClick={() => handleSort('fidelityPoints')} className="sortable-th text-center">
                                PUNTOS {sortConfig.key === 'fidelityPoints' && <ArrowUpDown size={12} />}
                            </th>
                            <th onClick={() => handleSort('totalOrders')} className="sortable-th text-center">
                                PEDIDOS {sortConfig.key === 'totalOrders' && <ArrowUpDown size={12} />}
                            </th>
                            <th onClick={() => handleSort('total_spent')} className="sortable-th text-center">
                                GASTO TOTAL {sortConfig.key === 'total_spent' && <ArrowUpDown size={12} />}
                            </th>
                            <th onClick={() => handleSort('last_order_at')} className="sortable-th">
                                ÚLTIMA VEZ {sortConfig.key === 'last_order_at' && <ArrowUpDown size={12} />}
                            </th>
                            <th>SEGMENTO</th>
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedClients.map(client => (
                            <tr key={client.id} onClick={() => onSelectClient && onSelectClient(client)} style={{ cursor: 'pointer' }}>
                                <td data-label="Cliente">
                                    <div className="client-card-header">
                                        <div className="client-card-header__title-row">
                                            <h4>{client.name || 'Sin Nombre'}</h4>
                                            <div
                                                className="clients-row-kebab-wrap"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <button
                                                    type="button"
                                                    className="admin-icon-btn admin-icon-btn--sm clients-kebab-trigger"
                                                    data-clients-kebab-id={client.id}
                                                    aria-expanded={menuOpenClientId === client.id}
                                                    aria-haspopup="menu"
                                                    aria-controls={menuOpenClientId === client.id ? 'clients-kebab-menu-popover' : undefined}
                                                    id={menuOpenClientId === client.id ? 'clients-kebab-trigger-active' : undefined}
                                                    aria-label="Más acciones"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (menuOpenClientId === client.id) {
                                                            closeKebabMenu();
                                                        } else {
                                                            updateKebabMenuPosFromButton(e.currentTarget);
                                                            setMenuOpenClientId(client.id);
                                                        }
                                                    }}
                                                >
                                                    <MoreVertical size={16} strokeWidth={1.5} aria-hidden />
                                                </button>
                                            </div>
                                        </div>
                                        {client.phone ? (
                                            <div className="client-card-header__contact-row">
                                                <span className="client-phone-text">{client.phone}</span>
                                                <button
                                                    type="button"
                                                    className="clients-whatsapp-btn"
                                                    onClick={(e) => openWhatsApp(e, client.phone)}
                                                    title="Abrir chat en WhatsApp"
                                                    aria-label="Abrir conversación en WhatsApp con este cliente"
                                                >
                                                    <WhatsAppGlyph className="clients-whatsapp-btn__glyph" />
                                                </button>
                                            </div>
                                        ) : null}
                                        {client.email ? <span className="client-email">{client.email}</span> : null}
                                    </div>
                                </td>
                                <td className="hide-mobile" data-label="Canal">
                                    <span className="clients-channel-label">
                                        {client.source === 'pos' ? 'PDV' : 'Menú digital'}
                                    </span>
                                </td>
                                <td className="text-center" data-label="Puntos">
                                    <span className="points-badge">
                                        <AdminIconSlot
                                            Icon={Star}
                                            tone="accent"
                                            slotSize="xxs"
                                            className="points-badge-star"
                                            fill="currentColor"
                                            strokeWidth={0}
                                        />
                                        <span className="points-badge-value">{client.fidelityPoints}</span>
                                    </span>
                                </td>
                                <td className="text-center" data-label="Pedidos">
                                    <span className="text-lg font-bold">{client.totalOrders}</span>
                                </td>
                                <td className="text-center" data-label="Gasto Total">
                                    <span className="text-success font-semibold">
                                        ${formatMoneyCl(client.total_spent)}
                                    </span>
                                </td>
                                <td data-label="Última vez">
                                    <div className="client-last-visit-stack">
                                        <div className="text-sm text-gray-400">
                                            {client.last_order_at ? new Date(client.last_order_at).toLocaleDateString('es-CL') : '-'}
                                        </div>
                                        <div className="text-xs opacity-60 client-last-visit-status">
                                            {getStatusIndicator(client.status)}
                                        </div>
                                    </div>
                                </td>
                                <td data-label="Segmento">
                                    {getSegmentBadge(client.segment)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            </div>

            {/* PAGINACIÓN */}
            {totalPages > 1 && (
                <div className="pagination-controls">
                    <span className="pagination-info">
                        Página {currentPage} de {totalPages}
                    </span>
                    <div className="pagination-buttons">
                        <button className="btn-icon-sm" onClick={() => setCurrentPageWithMenuClose((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>
                            <ChevronLeft size={18} />
                        </button>
                        <button className="btn-icon-sm" onClick={() => setCurrentPageWithMenuClose((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                            <ChevronRight size={18} />
                        </button>
                    </div>
                </div>
            )}

            {menuOpenClientId && kebabOpenClient && kebabMenuPos && kebabPortalTarget
                ? createPortal(
                    <div
                        id="clients-kebab-menu-popover"
                        className="clients-kebab-menu clients-kebab-menu--portal"
                        style={{ top: kebabMenuPos.top, left: kebabMenuPos.left }}
                        role="menu"
                        aria-label="Acciones del cliente"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            role="menuitem"
                            className="clients-kebab-menu__item"
                            onClick={() => {
                                onSelectClient?.(kebabOpenClient);
                                closeKebabMenu();
                            }}
                        >
                            <UserCircle size={16} aria-hidden className="clients-kebab-menu__icon" />
                            Ver ficha
                        </button>
                        {kebabOpenClient.phone ? (
                            <>
                                <button
                                    type="button"
                                    role="menuitem"
                                    className="clients-kebab-menu__item"
                                    onClick={(e) => {
                                        openWhatsApp(e, kebabOpenClient.phone);
                                        closeKebabMenu();
                                    }}
                                >
                                    <MessageCircle size={16} aria-hidden className="clients-kebab-menu__icon" />
                                    Abrir WhatsApp
                                </button>
                                <button
                                    type="button"
                                    role="menuitem"
                                    className="clients-kebab-menu__item"
                                    onClick={(e) => void copyPhone(e, kebabOpenClient.phone)}
                                >
                                    <Copy size={16} aria-hidden className="clients-kebab-menu__icon" />
                                    Copiar teléfono
                                </button>
                            </>
                        ) : null}
                        <button
                            type="button"
                            role="menuitem"
                            className="clients-kebab-menu__item clients-kebab-menu__item--danger"
                            disabled={deletingClientId === kebabOpenClient.id}
                            onClick={() => void handleDeleteClient(kebabOpenClient)}
                        >
                            {deletingClientId === kebabOpenClient.id ? (
                                <Loader2 size={16} aria-hidden className="clients-kebab-menu__icon animate-spin" />
                            ) : (
                                <Trash2 size={16} aria-hidden className="clients-kebab-menu__icon" />
                            )}
                            Eliminar cliente
                        </button>
                    </div>,
                    kebabPortalTarget,
                )
                : null}

            <ClientFormModal 
                isOpen={isFormOpen}
                onClose={() => setIsFormOpen(false)}
                onClientCreated={onClientCreated}
                showNotify={showNotify}
                companyId={companyId}
            />

        </div>
    );
};

export default AdminClients;
