import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
    Unlock, Lock, History, 
    Clock, Calendar, TrendingUp, TrendingDown,
    ArrowUpCircle, ArrowDownCircle, Eye, XCircle,
    DollarSign, CreditCard, Smartphone, ChevronRight, Truck,
    MapPin, Calculator,
} from 'lucide-react';
import { useAdmin } from '@/modules/cash/admin/pages/AdminProvider';
import { isValidBranchId } from '@/shared/utils/safeIds';
import CashShiftModal from './CashShiftModal';
import CashMovementModal from './CashMovementModal';
import CashShiftDetailModal from './CashShiftDetailModal';
import CashOrderDetailPanel from './CashOrderDetailPanel';
import { formatCurrency } from '@/shared/utils/formatters';
import { getPaymentLabel } from '@/shared/utils/orderUtils';
import AdminIconSlot from '../AdminIconSlot';
import AdminMenuSelect from '../AdminMenuSelect';

const fmt = (n) => {
    try { return formatCurrency(n); } catch { return `$${(n || 0).toLocaleString('es-CL')}`; }
};

const CASH_SHIFT_HISTORY_PERIOD_OPTIONS = [
    { value: '7', label: '7 días' },
    { value: '30', label: '30 días' },
    { value: '90', label: '3 meses' },
    { value: '365', label: '1 año' },
];

const ElapsedTime = ({ since }) => {
    const [elapsed, setElapsed] = useState('');
    useEffect(() => {
        const calc = () => {
            const diff = Date.now() - new Date(since).getTime();
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            setElapsed(h > 0 ? `${h}h ${m}m` : `${m}m`);
        };
        calc();
        const id = setInterval(calc, 60000);
        return () => clearInterval(id);
    }, [since]);
    return <span>{elapsed}</span>;
};

const CashManager = ({ showNotify, selectedBranchId, selectedBranch = null, orders = [] }) => {
    const { cashSystem } = useAdmin();
    const {
        activeShift, loading: loadingSystem, movements,
        openShift, closeShift, addManualMovement,
        getPastShifts, getTotals,
    } = cashSystem;

    const [pastShifts, setPastShifts] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [viewingShift, setViewingShift] = useState(null);
    const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
    const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);
    const [movementType, setMovementType] = useState('income');
    const [filterPeriod, setFilterPeriod] = useState('30');
    const [selectedMovementOrder, setSelectedMovementOrder] = useState(null);

    const getOrderForMovement = useCallback(
        (movement, ordersList) => {
            const list = ordersList || orders || [];
            const fromJoin = movement?.orders;
            if (fromJoin?.id) return fromJoin;
            const id = movement?.order_id ?? movement?.orderId;
            if (id != null) {
                const found = list.find((o) => String(o.id) === String(id));
                if (found) return found;
            }
            const desc = String(movement?.description || '');
            const match = desc.match(/#(\d{1,8})/);
            if (!match) return null;
            const num = match[1].replace(/^0+/, '') || '0';
            return (
                list.find((o) => {
                    const sid = String(o.id);
                    return (
                        sid.replace(/^0+/, '') === num ||
                        sid.slice(-4).replace(/^0+/, '') === num
                    );
                }) ?? null
            );
        },
        [orders]
    );

    const loadHistory = useCallback(async () => {
        setLoadingHistory(true);
        try {
            const data = await getPastShifts();
            setPastShifts(data || []);
        } catch {
            showNotify('Error al cargar historial', 'error');
        } finally {
            setLoadingHistory(false);
        }
    }, [getPastShifts, showNotify]);

    useEffect(() => { loadHistory(); }, [loadHistory, activeShift]);

    const totals = useMemo(() => getTotals(movements), [movements, getTotals]);
    const deliveryNet = Math.max(
        0,
        (Number(totals.deliveryCollected) || 0) - (Number(totals.deliveryRefunded) || 0)
    );
    const deliveryPendingToPay = Math.max(
        0,
        deliveryNet - (Number(totals.deliveryPaidToCourier) || 0)
    );

    const salesCount = useMemo(() => movements.filter(m => m.type === 'sale').length, [movements]);
    const movementCount = movements.length;

    const filteredShifts = useMemo(() => {
        const days = parseInt(filterPeriod);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        return pastShifts.filter(s => new Date(s.closed_at) >= cutoff);
    }, [pastShifts, filterPeriod]);

    const cancelledOrdersInShift = useMemo(() => {
        if (!activeShift || !selectedBranchId || selectedBranchId === 'all') return [];
        const openedAt = activeShift.opened_at ? new Date(activeShift.opened_at).getTime() : null;
        if (!openedAt) return [];
        return (orders || [])
            .filter((o) => o?.status === 'cancelled' && o?.branch_id === selectedBranchId && new Date(o.created_at).getTime() >= openedAt)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }, [activeShift, selectedBranchId, orders]);

    const recentMovements = useMemo(() => {
        const cancelled = (cancelledOrdersInShift || []).map((order) => ({
            id: `cancel-${order.id}`,
            type: 'cancel',
            orderId: order.id,
            description: `Pedido #${String(order.id).slice(-4)} cancelado`,
            created_at: order.created_at,
            amount: 0,
        }));
        return [...(movements || []), ...cancelled]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 8);
    }, [movements, cancelledOrdersInShift]);

    const handleMovementClick = useCallback(
        (m) => {
            const order = getOrderForMovement(m, orders);
            if (order) setSelectedMovementOrder(order);
        },
        [getOrderForMovement, orders]
    );

    if (loadingSystem) return (
        <div className="cash-loading">
            <div className="cash-spinner" />
            <span>Cargando caja...</span>
        </div>
    );

    if (!selectedBranchId || selectedBranchId === 'all' || !isValidBranchId(selectedBranchId)) {
        return (
            <div className="cash-empty-state">
                <div className="cash-empty-icon"><MapPin size={48} /></div>
                <h3>Selecciona una sucursal</h3>
                <p>Elige una sucursal en el menú superior para gestionar la caja de ese local.</p>
            </div>
        );
    }

    return (
        <div className="cash-container animate-fade">
            {/* HEADER */}
            <header className="cash-header">
                <div className="cash-header-left">
                    <AdminIconSlot Icon={Calculator} slotSize="lg" tone="accent" className="cash-header-brand-icon" />
                    {activeShift ? (
                        <div className="cash-header-status">
                            <span className="cash-pulse" />
                            Turno activo · <ElapsedTime since={activeShift.opened_at} />
                        </div>
                    ) : null}
                </div>
                <div className="cash-header-actions">
                    {activeShift ? (
                        <>
                            <button className="btn btn-income" onClick={() => { setMovementType('income'); setIsMovementModalOpen(true); }}>
                                <ArrowUpCircle size={16} /> Ingreso
                            </button>
                            <button className="btn btn-expense" onClick={() => { setMovementType('expense'); setIsMovementModalOpen(true); }}>
                                <ArrowDownCircle size={16} /> Egreso
                            </button>
                            <button className="btn btn-danger" onClick={() => setIsShiftModalOpen(true)}>
                                <Lock size={16} /> Cerrar caja
                            </button>
                        </>
                    ) : (
                        <button className="btn btn-primary btn-open-shift" onClick={() => setIsShiftModalOpen(true)}>
                            <Unlock size={18} /> Abrir caja
                        </button>
                    )}
                </div>
            </header>

            {/* TURNO ACTIVO: KPI DASHBOARD */}
            {activeShift ? (
                <section className="cash-section">
                    <div className="cash-kpi-grid">
                        <div className="cash-kpi balance">
                            <div className="cash-kpi-header">
                                <AdminIconSlot
                                    Icon={DollarSign}
                                    slotSize="sm"
                                    style={{
                                        color: 'var(--c-balance)',
                                        background: 'rgba(2, 132, 199, 0.12)',
                                        borderColor: 'rgba(2, 132, 199, 0.28)',
                                    }}
                                />
                                <span>Balance Esperado</span>
                            </div>
                            <div className="cash-kpi-value">{fmt(activeShift.expected_balance ?? activeShift.opening_balance ?? 0)}</div>
                            <div className="cash-kpi-sub">Base: {fmt(activeShift.opening_balance || 0)}</div>
                        </div>

                        <div className="cash-kpi income">
                            <div className="cash-kpi-header">
                                <AdminIconSlot
                                    Icon={TrendingUp}
                                    slotSize="sm"
                                    style={{
                                        color: 'var(--c-income)',
                                        background: 'rgba(22, 163, 74, 0.12)',
                                        borderColor: 'rgba(22, 163, 74, 0.28)',
                                    }}
                                />
                                <span>Ingresos</span>
                            </div>
                            <div className="cash-kpi-value">{fmt(totals.income)}</div>
                            <div className="cash-kpi-sub">{salesCount} ventas · {movementCount - salesCount > 0 ? `${movements.filter(m => m.type === 'income').length} manuales` : 'sin manuales'}</div>
                        </div>

                        <div className="cash-kpi expense">
                            <div className="cash-kpi-header">
                                <AdminIconSlot
                                    Icon={TrendingDown}
                                    slotSize="sm"
                                    style={{
                                        color: 'var(--c-expense)',
                                        background: 'rgba(220, 38, 38, 0.1)',
                                        borderColor: 'rgba(220, 38, 38, 0.28)',
                                    }}
                                />
                                <span>Egresos</span>
                            </div>
                            <div className="cash-kpi-value">{fmt(totals.expenses)}</div>
                            <div className="cash-kpi-sub">{movements.filter(m => m.type === 'expense').length} movimientos</div>
                        </div>

                        <div className="cash-kpi methods">
                            <div className="cash-kpi-header">
                                <AdminIconSlot
                                    Icon={CreditCard}
                                    slotSize="sm"
                                    style={{
                                        color: 'var(--c-text-secondary)',
                                        background: 'var(--admin-icon-bg)',
                                        borderColor: 'var(--admin-border)',
                                    }}
                                />
                                <span>Por Método</span>
                            </div>
                            <div className="cash-methods-grid">
                                <div className="cash-method-row">
                                    <AdminIconSlot Icon={DollarSign} slotSize="xxs" style={{ color: 'var(--c-income)', background: 'rgba(22, 163, 74, 0.1)', borderColor: 'rgba(22, 163, 74, 0.22)' }} />
                                    <span>Efectivo</span>
                                    <strong>{fmt(totals.cash)}</strong>
                                </div>
                                <div className="cash-method-row">
                                    <AdminIconSlot Icon={CreditCard} slotSize="xxs" style={{ color: '#2563eb', background: 'rgba(37, 99, 235, 0.08)', borderColor: 'rgba(37, 99, 235, 0.22)' }} />
                                    <span>Tarjeta</span>
                                    <strong>{fmt(totals.card)}</strong>
                                </div>
                                <div className="cash-method-row">
                                    <AdminIconSlot Icon={Smartphone} slotSize="xxs" style={{ color: '#7c3aed', background: 'rgba(124, 58, 237, 0.08)', borderColor: 'rgba(124, 58, 237, 0.22)' }} />
                                    <span>Transf.</span>
                                    <strong>{fmt(totals.online)}</strong>
                                </div>
                            </div>
                        </div>

                        <div className="cash-kpi delivery">
                            <div className="cash-kpi-header">
                                <AdminIconSlot
                                    Icon={Truck}
                                    slotSize="sm"
                                    style={{
                                        color: '#f59e0b',
                                        background: 'rgba(245, 158, 11, 0.12)',
                                        borderColor: 'rgba(245, 158, 11, 0.28)',
                                    }}
                                />
                                <span>Delivery a pagar</span>
                            </div>
                            <div className="cash-kpi-value">{fmt(deliveryPendingToPay)}</div>
                            <div className="cash-kpi-sub">
                                Cobrado: {fmt(deliveryNet)} · Pagado: {fmt(totals.deliveryPaidToCourier || 0)}
                            </div>
                        </div>
                    </div>

                    {/* ÚLTIMOS MOVIMIENTOS */}
                    {recentMovements.length > 0 && (
                        <div className="cash-recent">
                            <div className="cash-recent-header">
                                <h4><AdminIconSlot Icon={Clock} slotSize="sm" tone="accent" /> Últimos movimientos</h4>
                                <button className="btn-text" onClick={() => setViewingShift(activeShift)}>
                                    Ver todos <ChevronRight size={14} />
                                </button>
                            </div>
                            <div className="cash-recent-list">
                                {recentMovements.map(m => {
                                    const order = getOrderForMovement(m, orders);
                                    const clickable = Boolean(order);
                                    const isCancel = m.type === 'cancel';
                                    const paymentMethod = m.payment_method ?? order?.payment_type;
                                    const paymentSlug = isCancel ? null : (paymentMethod === 'cash' ? 'cash' : paymentMethod === 'card' || paymentMethod === 'tarjeta' ? 'card' : 'transfer');
                                    const paymentLabel = order ? getPaymentLabel(order) : (paymentMethod === 'cash' ? 'Efectivo' : paymentMethod === 'card' || paymentMethod === 'tarjeta' ? 'Tarjeta' : 'Transf.');
                                    const movementColor = isCancel ? '#f87171' : paymentSlug === 'cash' ? '#4ade80' : paymentSlug === 'transfer' ? '#facc15' : paymentSlug === 'card' ? '#60a5fa' : undefined;
                                    const textStyle = movementColor ? { color: movementColor } : undefined;
                                    return (
                                        <div
                                            key={m.id}
                                            className={`cash-recent-item ${clickable ? 'cash-recent-item-clickable' : ''} ${isCancel ? 'cash-recent-item--cancelled' : ''} ${paymentSlug ? `cash-recent-item--${paymentSlug}` : ''}`}
                                            onClick={clickable ? () => handleMovementClick(m) : undefined}
                                            onKeyDown={
                                                clickable
                                                    ? (e) => {
                                                            if (e.key === 'Enter' || e.key === ' ') {
                                                                e.preventDefault();
                                                                handleMovementClick(m);
                                                            }
                                                        }
                                                    : undefined
                                            }
                                            role={clickable ? 'button' : undefined}
                                            tabIndex={clickable ? 0 : -1}
                                        >
                                            <div className={`cash-recent-icon ${m.type}`} style={isCancel ? { background: 'rgba(239, 68, 68, 0.2)', color: '#f87171' } : undefined}>
                                                {m.type === 'expense' ? <ArrowDownCircle size={16} /> : m.type === 'cancel' ? <XCircle size={16} /> : <ArrowUpCircle size={16} />}
                                            </div>
                                            <div className="cash-recent-info">
                                                <span className="cash-recent-desc" style={textStyle}>{m.description || (m.type === 'sale' ? 'Venta' : m.type === 'income' ? 'Ingreso' : m.type === 'cancel' ? 'Cancelado' : 'Egreso')}</span>
                                                <span className="cash-recent-time" style={textStyle}>
                                                    {new Date(m.created_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                                                    {isCancel ? ' · Cancelado' : ` · ${paymentLabel}`}
                                                    {!isCancel && order && Number(order.delivery_fee) > 0
                                                        ? ` · Envío ${fmt(Number(order.delivery_fee))}`
                                                        : ''}
                                                </span>
                                            </div>
                                            {m.type === 'cancel' ? (
                                                <span className="cash-recent-amount cash-recent-amount-cancel" style={{ color: '#f87171', fontWeight: 700 }}>Cancelado</span>
                                            ) : (
                                                <span className={`cash-recent-amount ${m.type === 'expense' ? 'negative' : 'positive'}`} style={movementColor ? { color: movementColor } : undefined}>
                                                    {m.type === 'expense' ? '-' : '+'}{fmt(m.amount)}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </section>
            ) : (
                <section className="cash-empty-state">
                    <div className="cash-empty-icon">
                        <Lock size={48} />
                    </div>
                    <h3>Caja cerrada</h3>
                    <p>Abre un turno para comenzar a registrar ventas e ingresos.</p>
                    <button className="btn btn-primary" onClick={() => setIsShiftModalOpen(true)}>
                        <Unlock size={18} /> Abrir caja
                    </button>
                </section>
            )}

            {/* HISTORIAL DE TURNOS */}
            <section className="cash-section">
                <div className="cash-section-header">
                    <h3 className="cash-section-title cash-section-title--with-icon"><AdminIconSlot Icon={History} slotSize="sm" tone="accent" /> Historial de turnos</h3>
                    <div className="cash-filters-inline">
                        <AdminMenuSelect
                            value={filterPeriod}
                            onChange={setFilterPeriod}
                            options={CASH_SHIFT_HISTORY_PERIOD_OPTIONS}
                            aria-label="Período del historial de turnos"
                            icon={<Calendar size={18} strokeWidth={1.65} className="text-accent" />}
                        />
                    </div>
                </div>

                {loadingHistory ? (
                    <div className="cash-history-loading">Cargando historial...</div>
                ) : filteredShifts.length === 0 ? (
                    <div className="cash-history-empty">
                        <Calendar size={32} />
                        <span>No hay turnos cerrados en este período.</span>
                    </div>
                ) : (
                    <div className="cash-history-list">
                        {filteredShifts.map(shift => {
                            const diff = shift.difference ?? ((shift.actual_balance || 0) - (shift.expected_balance || 0));
                            const duration = shift.closed_at && shift.opened_at
                                ? Math.round((new Date(shift.closed_at) - new Date(shift.opened_at)) / 60000)
                                : 0;
                            const durationStr = duration >= 60 ? `${Math.floor(duration / 60)}h ${duration % 60}m` : `${duration}m`;

                            return (
                                <div key={shift.id} className="cash-history-card" onClick={() => setViewingShift(shift)}>
                                    <div className="cash-history-date">
                                        <span className="cash-history-day">
                                            {new Date(shift.opened_at).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })}
                                        </span>
                                        <span className="cash-history-hours">
                                            {new Date(shift.opened_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                                            {' → '}
                                            {new Date(shift.closed_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                        <span className="cash-history-duration">
                                            <Clock size={12} /> {durationStr}
                                        </span>
                                        <span className="cash-history-orders">
                                            {Number(shift.orders_count ?? 0)} {Number(shift.orders_count ?? 0) === 1 ? 'pedido' : 'pedidos'}
                                        </span>
                                    </div>

                                    <div className="cash-history-amounts">
                                        <div className="cash-history-col">
                                            <label>Sistema</label>
                                            <span>{fmt(shift.expected_balance)}</span>
                                        </div>
                                        <div className="cash-history-col">
                                            <label>Conteo</label>
                                            <span>{fmt(shift.actual_balance)}</span>
                                        </div>
                                        <div className="cash-history-col">
                                            <label>Diferencia</label>
                                            <span className={diff >= 0 ? 'diff-positive' : 'diff-negative'}>
                                                {diff >= 0 ? '+' : ''}{fmt(Math.abs(diff))}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="cash-history-arrow">
                                        <Eye size={16} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* MODALES */}
            <CashShiftModal 
                isOpen={isShiftModalOpen} 
                onClose={() => setIsShiftModalOpen(false)}
                type={activeShift ? 'close' : 'open'}
                activeShift={activeShift}
                onConfirm={activeShift ? closeShift : openShift}
            />

            <CashMovementModal 
                isOpen={isMovementModalOpen}
                onClose={() => setIsMovementModalOpen(false)}
                type={movementType}
                onConfirm={addManualMovement}
            />

            <CashShiftDetailModal 
                isOpen={!!viewingShift}
                onClose={() => setViewingShift(null)}
                shift={viewingShift}
                getTotals={getTotals}
                orders={orders}
            />

            <CashOrderDetailPanel
                order={selectedMovementOrder}
                branch={selectedBranch}
                showNotify={showNotify}
                onClose={() => setSelectedMovementOrder(null)}
            />
        </div>
    );
};

export default CashManager;
