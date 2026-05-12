import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { X, History, Clock, User, DollarSign, CreditCard, Smartphone, XCircle } from 'lucide-react';
import { cashService } from '../../services/cashService';
import { supabase, TABLES } from '@/integrations/supabase';
import { getPaymentLabel } from '@/shared/utils/orderUtils';
import AdminIconSlot from '../AdminIconSlot';

const PaymentMethodBreakdownHeader = ({ Icon, label }) => (
    <div
        style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontSize: '0.72rem',
            fontWeight: 600,
            color: 'var(--c-text-secondary, var(--admin-text-muted))',
        }}
    >
        <AdminIconSlot Icon={Icon} slotSize="xxs" />
        <span>{label}</span>
    </div>
);

const CashShiftDetailModal = ({ isOpen, onClose, shift, getTotals, orders = [] }) => {
    const [movements, setMovements] = useState([]);
    const [loading, setLoading] = useState(false);
    const [openedByLabel, setOpenedByLabel] = useState('');

    const shiftRowId = shift?.id ?? shift?.shift_id;
    const openedById = shift?.opened_by ?? null;

    /** Pedidos cancelados en el rango del turno (misma lógica que la lista reciente de caja). */
    const cancelledOrdersInShift = useMemo(() => {
        if (!shift?.opened_at || !shift?.closed_at) return [];
        const branchId = shift.branch_id;
        if (branchId == null || branchId === '') return [];
        const openedAt = new Date(shift.opened_at).getTime();
        const closedAt = new Date(shift.closed_at).getTime();
        return (orders || [])
            .filter(
                (o) =>
                    o?.status === 'cancelled' &&
                    String(o.branch_id) === String(branchId) &&
                    new Date(o.created_at).getTime() >= openedAt &&
                    new Date(o.created_at).getTime() <= closedAt
            )
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }, [shift, orders]);

    const movementsWithCancellations = useMemo(() => {
        const synthetic = (cancelledOrdersInShift || []).map((order) => ({
            id: `cancel-${order.id}`,
            type: 'cancel',
            order_id: order.id,
            description: `Pedido #${String(order.id).slice(-4)} cancelado`,
            created_at: order.created_at,
            amount: 0,
            payment_method: null,
            orders: order,
        }));
        const base = movements || [];
        return [...base, ...synthetic].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
    }, [movements, cancelledOrdersInShift]);

    const loadMovements = useCallback(async () => {
        if (shiftRowId == null || shiftRowId === '') return;
        setLoading(true);
        try {
            const data = await cashService.getShiftMovements(shiftRowId);
            setMovements(data || []);
        } catch {
            setMovements([]);
        } finally {
            setLoading(false);
        }
    }, [shiftRowId]);

    useEffect(() => {
        if (isOpen && shift) {
            loadMovements();
        }
    }, [isOpen, shift, loadMovements]);

    useEffect(() => {
        let cancelled = false;
        if (!isOpen || !openedById) {
            setOpenedByLabel('');
            return undefined;
        }

        (async () => {
            try {
                const { data, error } = await supabase
                    .from(TABLES.users)
                    .select('id, name, email')
                    .eq('id', openedById)
                    .maybeSingle();
                if (cancelled) return;
                if (error || !data) {
                    setOpenedByLabel(`Usuario ${String(openedById).slice(0, 8)}`);
                    return;
                }
                setOpenedByLabel(data.name || data.email || `Usuario ${String(data.id).slice(0, 8)}`);
            } catch {
                if (!cancelled) {
                    setOpenedByLabel(`Usuario ${String(openedById).slice(0, 8)}`);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [isOpen, openedById]);

    if (!isOpen || !shift) return null;

    const totals = getTotals ? getTotals(movements) : { income: 0, expense: 0, cash: 0, card: 0, online: 0 };

    // Conteo de pedidos del turno (excluye cancelados/devueltos):
    // 1) Prioriza shift.orders_count del embed PostgREST (que ya filtra status != 'cancelled').
    // 2) Si no esta disponible (turno actual sin embed), cae al conteo de movements type='sale'
    //    MENOS los pedidos cancelados detectados en el rango del turno (cancelledOrdersInShift).
    const shiftOrdersCount = (() => {
        if (Number.isFinite(Number(shift?.orders_count))) {
            return Number(shift.orders_count);
        }
        if (Array.isArray(shift?.orders) && Number.isFinite(Number(shift.orders[0]?.count))) {
            return Number(shift.orders[0].count);
        }
        const saleMovements = (movements || []).filter(m => m.type === 'sale').length;
        const cancelled = Array.isArray(cancelledOrdersInShift) ? cancelledOrdersInShift.length : 0;
        return Math.max(0, saleMovements - cancelled);
    })();

    // #region agent log
    try {
        fetch('http://127.0.0.1:7461/ingest/e68a46d1-59e8-49d9-bde5-733f5c55d988', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '502478' },
            body: JSON.stringify({
                sessionId: '502478',
                runId: 'post-fix-cancelled-filter',
                hypothesisId: 'H2',
                location: 'CashShiftDetailModal.jsx:render',
                message: 'shiftOrdersCount computed for past-shift detail modal',
                data: {
                    shift_id: shift?.id,
                    embed_orders_count: shift?.orders_count,
                    embed_raw_orders: shift?.orders,
                    sale_movements: (movements || []).filter(m => m.type === 'sale').length,
                    cancelled_in_shift: Array.isArray(cancelledOrdersInShift) ? cancelledOrdersInShift.length : 0,
                    final_count: shiftOrdersCount,
                },
                timestamp: Date.now(),
            }),
        }).catch(() => {});
    } catch (e) { void e; }
    // #endregion

    return (
        <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
            <div className="modal-content glass" style={{ maxWidth: 650, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
                <header className="modal-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <History className="text-accent" size={24} />
                        <div>
                            <h3 className="fw-700" style={{ margin: 0 }}>Viendo Turno Pasado</h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                    {new Date(shift.closed_at).toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' })}
                                </span>
                                <span
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        fontSize: '0.7rem',
                                        fontWeight: 600,
                                        color: 'var(--c-text-secondary, var(--text-secondary))',
                                        background: 'var(--c-surface-hover, rgba(255,255,255,0.06))',
                                        border: '1px solid var(--c-border, rgba(255,255,255,0.08))',
                                        borderRadius: 999,
                                        padding: '2px 8px',
                                    }}
                                    title="Cantidad de pedidos registrados en este turno"
                                >
                                    {shiftOrdersCount} {shiftOrdersCount === 1 ? 'pedido' : 'pedidos'}
                                </span>
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className="btn-close"><X size={24} /></button>
                </header>

                <div className="modal-body" style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {/* INFO HEADER */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 15 }}>
                        <div className="glass" style={{ padding: 18, borderRadius: 16, border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div className="flex-center" style={{ gap: 8, color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: 10 }}>
                                <Clock size={14} /> Horarios del Turno
                            </div>
                            <div style={{ fontSize: '0.95rem', fontWeight: 500, lineHeight: 1.5 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Apertura:</span> 
                                    <span>{new Date(shift.opened_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Cierre:</span> 
                                    <span>{new Date(shift.closed_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                            </div>
                        </div>
                        <div className="glass" style={{ padding: 18, borderRadius: 16, border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div className="flex-center" style={{ gap: 8, color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: 10 }}>
                                <User size={14} /> Responsable de Apertura
                            </div>
                            <div style={{ fontSize: '0.95rem', fontWeight: 600, textAlign: 'center', padding: '5px 0' }}>
                                {openedByLabel || (openedById ? 'Cargando…' : 'Sin registrar')}
                            </div>
                        </div>
                    </div>

                    {/* KPIs PRINCIPALES */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
                        <div className="mini-kpi glass" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: 15 }}>
                            <label style={{ marginBottom: 5 }}>Base Caja</label>
                            <span style={{ fontSize: '1.1rem' }}>${(shift.opening_balance || 0).toLocaleString('es-CL')}</span>
                        </div>
                        <div className="mini-kpi glass" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: 15 }}>
                            <label style={{ marginBottom: 5 }}>Efectivo Final</label>
                            <span style={{ color: '#25d366', fontSize: '1.1rem' }}>${(shift.actual_balance || 0).toLocaleString('es-CL')}</span>
                        </div>
                        <div className="mini-kpi glass" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: 15 }}>
                            <label style={{ marginBottom: 5 }}>Ingresos Totales</label>
                            <span style={{ color: '#38bdf8', fontSize: '1.1rem' }}>+${(totals.income || 0).toLocaleString('es-CL')}</span>
                        </div>
                        <div className="mini-kpi glass" style={{ 
                            flexDirection: 'column', 
                            alignItems: 'flex-start', 
                            padding: 15,
                            border: shift.actual_balance < shift.expected_balance ? '1px solid rgba(230, 57, 70, 0.3)' : '1px solid rgba(37, 211, 102, 0.3)',
                            background: shift.actual_balance < shift.expected_balance ? 'rgba(230, 57, 70, 0.05)' : 'rgba(37, 211, 102, 0.05)'
                        }}>
                            <label style={{ marginBottom: 5 }}>{(shift.actual_balance || 0) >= (shift.expected_balance || 0) ? 'Sobrante' : 'Faltante'}</label>
                            <span className={(shift.actual_balance || 0) >= (shift.expected_balance || 0) ? 'profit-plus' : 'profit-minus'} style={{ fontSize: '1.1rem' }}>
                                ${Math.abs((shift.actual_balance || 0) - (shift.expected_balance || 0)).toLocaleString('es-CL')}
                            </span>
                        </div>
                    </div>

                    {/* DESGLOSE POR METODO */}
                    <h4 style={{ fontSize: '0.9rem', marginBottom: 15, color: 'var(--text-secondary)' }}>Desglose por Métodos de Pago</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 30 }}>
                        <div className="glass" style={{ padding: 12, textAlign: 'center', borderRadius: 10 }}>
                            <PaymentMethodBreakdownHeader Icon={DollarSign} label="Efectivo" />
                            <div style={{ fontWeight: 700 }}>${(totals.cash || 0).toLocaleString('es-CL')}</div>
                        </div>
                        <div className="glass" style={{ padding: 12, textAlign: 'center', borderRadius: 10 }}>
                            <PaymentMethodBreakdownHeader Icon={CreditCard} label="Tarjeta" />
                            <div style={{ fontWeight: 700 }}>${(totals.card || 0).toLocaleString('es-CL')}</div>
                        </div>
                        <div className="glass" style={{ padding: 12, textAlign: 'center', borderRadius: 10 }}>
                            <PaymentMethodBreakdownHeader Icon={Smartphone} label="Transf." />
                            <div style={{ fontWeight: 700 }}>${(totals.online || 0).toLocaleString('es-CL')}</div>
                        </div>
                    </div>

                    {/* TABLA DE MOVIMIENTOS */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 15 }}>
                        <Clock size={16} className="text-secondary" />
                        <h4 style={{ margin: 0, fontSize: '0.9rem' }}>Movimientos de este Turno</h4>
                    </div>

                    {loading ? (
                        <div style={{ padding: 40, textAlign: 'center' }}>Cargando transacciones...</div>
                    ) : movementsWithCancellations.length === 0 ? (
                        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            No hay movimientos registrados para este turno.
                        </div>
                    ) : (
                        <div className="cash-shift-movements-scroll">
                            <table className="cash-movements-table" style={{ borderSpacing: 0 }}>
                                <tbody>
                                    {movementsWithCancellations.map(m => (
                                        <tr key={m.id} className={`movement-row ${m.type === 'cancel' ? 'movement-row--cancelled' : ''}`}>
                                            <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', width: 80, padding: '12px 15px' }}>
                                                {new Date(m.created_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                                            </td>
                                            <td style={{ width: 110, padding: '12px 0' }}>
                                                <span className={`movement-type type-${m.type === 'cancel' ? 'cancel' : m.type}`} style={{ fontSize: '0.65rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                    {m.type === 'cancel' ? (
                                                        <>
                                                            <XCircle size={12} aria-hidden />
                                                            Cancelado
                                                        </>
                                                    ) : m.type === 'sale' ? 'Venta' : (m.type === 'income' ? 'Ingreso' : 'Egreso')}
                                                </span>
                                            </td>
                                            <td style={{ fontSize: '0.85rem', padding: '12px 10px' }}>
                                                <div style={{ fontWeight: 500 }}>{m.description}</div>
                                                {m.orders && (
                                                    <div style={{ fontSize: '0.75rem', color: m.type === 'cancel' ? '#f87171' : 'var(--accent-primary)', marginTop: 2, marginBottom: 2 }}>
                                                        <div style={{ fontWeight: 600 }}>{m.orders.client_name || 'Cliente Casual'}</div>
                                                        {m.orders.items && (
                                                            <div style={{ opacity: 0.85, fontSize: '0.7rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>
                                                                {Array.isArray(m.orders.items)
                                                                    ? m.orders.items.map(i => `${i.quantity}x ${(i.name ?? '').split(' (')[0]}`).join(', ')
                                                                    : ''}
                                                            </div>
                                                        )}
                                                        {Number(m.orders.delivery_fee) > 0 ? (
                                                            <div style={{ fontSize: '0.72rem', color: 'var(--accent-primary)', marginTop: 4, fontWeight: 600 }}>
                                                                Envío cobrado: ${Number(m.orders.delivery_fee).toLocaleString('es-CL')}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                )}
                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                                                    {m.type === 'cancel'
                                                        ? 'Pedido anulado en el turno'
                                                        : (m.orders ? getPaymentLabel(m.orders) : (m.payment_method === 'cash' ? 'Efectivo' : (m.payment_method === 'card' ? 'Tarjeta' : 'Transf.')))}
                                                </div>
                                            </td>
                                            <td style={{ textAlign: 'right', padding: '12px 15px' }}>
                                                {m.type === 'cancel' ? (
                                                    <span style={{ fontSize: '0.85rem', color: '#f87171', fontWeight: 700 }}>—</span>
                                                ) : (
                                                    <span className={`movement-amount ${m.type === 'expense' ? 'amount-minus' : 'amount-plus'}`} style={{ fontSize: '0.9rem' }}>
                                                        {m.type === 'expense' ? '-' : '+'}${Number(m.amount).toLocaleString('es-CL')}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <div className="modal-footer" style={{ borderTop: 'none', marginTop: 10 }}>
                    <button className="btn btn-secondary btn-block" onClick={onClose}>Cerrar Detalle</button>
                </div>
            </div>
        </div>
    );
};

export default CashShiftDetailModal;
