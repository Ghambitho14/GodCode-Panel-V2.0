import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Columns3, Maximize2 } from 'lucide-react';
import AdminIconSlot from './AdminIconSlot';
import OrderCard from './OrderCard';

const KANBAN_VIEW_STORAGE_KEY = 'tenant-admin-kanban-view';

const AdminKanban = ({ columns, isMobile, mobileTab, setMobileTab, moveOrder, setReceiptModalOrder, branch, clients, logoUrl, companyName, showNotify, products, categories, onOrderSaved }) => {

    const [mounted, setMounted] = useState(false);
    /** 'split' = tres columnas; 'single' = una etapa a pantalla completa (solo escritorio; móvil sigue en pestañas) */
    const [kanbanViewMode, setKanbanViewModeState] = useState('split');

    useEffect(() => {
        const t = setTimeout(() => setMounted(true), 0);
        return () => clearTimeout(t);
    }, []);

    useEffect(() => {
        try {
            const v = localStorage.getItem(KANBAN_VIEW_STORAGE_KEY);
            if (v === 'single' || v === 'split') {
                queueMicrotask(() => setKanbanViewModeState(v));
            }
        } catch {
            /* ignore */
        }
    }, []);

    const setKanbanViewMode = useCallback((mode) => {
        setKanbanViewModeState(mode);
        try {
            localStorage.setItem(KANBAN_VIEW_STORAGE_KEY, mode);
        } catch {
            /* ignore */
        }
    }, []);

    // 1. CONFIGURACIÓN CENTRALIZADA
    // Aquí defines tus columnas. Si quieres agregar una, solo la pones aquí y listo.
    const columnConfig = useMemo(() => [
        { 
            id: 'pending', 
            title: 'ENTRANTES', 
            shortTitle: 'Entrantes', // Para el botón móvil
            dotClass: 'dot-orange', 
            emptyMsg: 'Sin pedidos' 
        },
        { 
            id: 'active', 
            title: 'COCINANDO', 
            shortTitle: 'Cocina', 
            dotClass: 'dot-red', 
            emptyMsg: 'Cocina libre' 
        },
        { 
            id: 'completed', 
            title: 'LISTOS', 
            shortTitle: 'Listos', 
            dotClass: 'dot-green', 
            emptyMsg: 'Nada listo' 
        }
    ], []);

    const showDesktopSingle = mounted && !isMobile && kanbanViewMode === 'single';
    const showDesktopSplit = mounted && !isMobile && kanbanViewMode === 'split';
    const isColumnHidden = (colId) => {
        if (!mounted) return false;
        if (isMobile && mobileTab !== colId) return true;
        if (showDesktopSingle && mobileTab !== colId) return true;
        return false;
    };

    return (
        <>
            {!isMobile && (
                <div className="kanban-view-toolbar" role="group" aria-label="Vista del tablero de pedidos">
                    <span className="kanban-view-toolbar-label">Vista</span>
                    <div className="kanban-view-toggle">
                        <button
                            type="button"
                            className={kanbanViewMode === 'split' ? 'active' : ''}
                            onClick={() => setKanbanViewMode('split')}
                            aria-pressed={kanbanViewMode === 'split'}
                            title="Ver entrantes, cocinando y listos a la vez"
                        >
                            <Columns3 size={16} strokeWidth={2.25} aria-hidden />
                            Tres columnas
                        </button>
                        <button
                            type="button"
                            className={kanbanViewMode === 'single' ? 'active' : ''}
                            onClick={() => setKanbanViewMode('single')}
                            aria-pressed={kanbanViewMode === 'single'}
                            title="Una etapa a la vez, ancho completo"
                        >
                            <AdminIconSlot Icon={Maximize2} slotSize="sm" />
                            Una columna
                        </button>
                    </div>
                </div>
            )}

            {/* Pestañas: móvil siempre; escritorio solo en vista una columna */}
            <div className={`mobile-tabs ${showDesktopSingle ? 'kanban-tabs-desktop' : ''}`}>
                {columnConfig.map(col => (
                    <button
                        key={col.id}
                        type="button"
                        onClick={() => setMobileTab(col.id)}
                        className={mobileTab === col.id ? 'active' : ''}
                    >
                        {col.shortTitle} ({columns[col.id]?.length || 0})
                    </button>
                ))}
            </div>

            {/* Tablero */}
            <div
                className={[
                    'kanban-board',
                    showDesktopSingle ? 'kanban-board--focus-desktop' : '',
                    showDesktopSplit ? 'kanban-board--split-desktop' : '',
                ].filter(Boolean).join(' ')}
            >
                {columnConfig.map((col) => {
                    const ordersInColumn = columns[col.id] || [];
                    const hidden = isColumnHidden(col.id);

                    return (
                        <div 
                            key={col.id} 
                            className={`kanban-column col-${col.id} ${hidden ? 'kanban-column--hidden' : ''}`}
                        >
                            {/* Header */}
                            <div className="column-header">
                                <span className={`dot ${col.dotClass}`}></span>
                                <h3>{col.title}</h3>
                                <span className="count">{ordersInColumn.length}</span>
                            </div>

                            {/* Body */}
                            <div className="column-body">
                                {ordersInColumn.length === 0 ? (
                                    <div className="empty-zone">{col.emptyMsg}</div>
                                ) : (
                                    ordersInColumn.map((order, idx) => (
                                        <OrderCard
                                            key={order.id}
                                            order={order}
                                            queueIndex={idx + 1}
                                            moveOrder={moveOrder}
                                            setReceiptModalOrder={setReceiptModalOrder}
                                            branch={branch}
                                            clients={clients}
                                            logoUrl={logoUrl}
                                            companyName={companyName}
                                            showNotify={showNotify}
                                            products={products}
                                            categories={categories}
                                            onOrderSaved={onOrderSaved}
                                        />
                                    ))
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );
};

export default AdminKanban;
