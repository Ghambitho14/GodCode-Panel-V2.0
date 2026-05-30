import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { X, History, Clock, User, DollarSign, CreditCard, Smartphone, XCircle, Eye } from 'lucide-react';
import { getOrderForMovement, isMovementOrderClickable } from '../../utils/getOrderForMovement';
import { cashService } from '../../services/cashService';
import {
    isManualLocalExpense,
    isCashWithdrawal,
    isOperatingLocalExpense,
} from '../../utils/cashMovementKinds';
import { supabase, TABLES } from '@/integrations/supabase';
import { getPaymentLabel } from '@/shared/utils/orderUtils';
import { getClosedShiftReconciliation, diffCounted } from '../../utils/shiftCloseReconciliation';
import { formatCurrency } from '@/shared/utils/formatters';
import { useLockBodyScroll } from '@/shared/hooks/useLockBodyScroll';
import AdminIconSlot from '../AdminIconSlot';

const PaymentMethodChip = ({ Icon, label, value }) => (
    <div className="cash-shift-detail-method-chip">
        <PaymentMethodBreakdownHeader Icon={Icon} label={label} />
        <span className="cash-shift-detail-method-chip__value">{value}</span>
    </div>
);

const PaymentMethodBreakdownHeader = ({ Icon, label }) => (
    <div className="cash-shift-detail-method-head">
        <AdminIconSlot Icon={Icon} slotSize="xxs" />
        <span>{label}</span>
    </div>
);

function fmtHist(n) {
    try {
        return formatCurrency(n);
    } catch {
        return `$${(n || 0).toLocaleString('es-CL')}`;
    }
}

function movementTypeLabel(m) {
    if (m.type === 'cancel') return 'Cancelado';
    if (m.type === 'sale') return 'Venta';
    if (m.type === 'income') return 'Ingreso';
    if (isCashWithdrawal(m)) return 'Retiro efectivo';
    if (isOperatingLocalExpense(m)) return 'Gasto operativo';
    if (isManualLocalExpense(m)) return 'Gasto local';
    return 'Devolución';
}

const PAYMENT_LABEL_SHORT = {
    Efectivo: 'Efectivo',
    Tarjeta: 'Tarjeta',
    Transferencia: 'Transf.',
    MercadoPago: 'MP',
    'Tarjeta (Online)': 'T.Online',
    'Pago Móvil': 'P.Móvil',
    'En local': 'Local',
    Zelle: 'Zelle',
    PayPal: 'PayPal',
};

function movementPaymentLabel(m) {
    if (m.type === 'cancel') return '—';
    if (m.orders) {
        const label = getPaymentLabel(m.orders);
        return PAYMENT_LABEL_SHORT[label] || label;
    }
    if (m.payment_method === 'cash') return 'Efectivo';
    if (m.payment_method === 'card') return 'Tarjeta';
    if (m.payment_method === 'online') return 'Transf.';
    return '—';
}

function formatMovementDateTime(iso) {
    const d = new Date(iso);
    return {
        date: d.toLocaleDateString('es-CL', { dateStyle: 'short' }),
        time: d.toLocaleTimeString('es-CL', { timeStyle: 'short' }),
    };
}

const CashShiftDetailModal = ({ isOpen, onClose, shift, getTotals, orders = [], onMovementClick }) => {
    const [movements, setMovements] = useState([]);
    const [loading, setLoading] = useState(false);
    const [openedByLabel, setOpenedByLabel] = useState('');

    const shiftRowId = shift?.id ?? shift?.shift_id;
    const openedById = shift?.opened_by ?? null;

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
            const fallback = `Usuario ${String(openedById).slice(0, 8)}`;
            try {
                const lookupBy = async (column) => {
                    const { data, error } = await supabase
                        .from(TABLES.users)
                        .select('id, email, auth_user_id')
                        .eq(column, openedById)
                        .maybeSingle();
                    if (error) return { data: null, error };
                    return { data, error: null };
                };

                let { data } = await lookupBy('id');
                if (!data?.email) {
                    const byAuth = await lookupBy('auth_user_id');
                    if (byAuth.data) data = byAuth.data;
                }

                if (cancelled) return;

                const email = data?.email ? String(data.email).trim() : '';
                setOpenedByLabel(email || fallback);
            } catch {
                if (!cancelled) {
                    setOpenedByLabel(fallback);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [isOpen, openedById]);

    useLockBodyScroll(isOpen && !!shift);

    if (!isOpen || !shift) return null;

    const totals = getTotals
        ? getTotals(movements)
        : {
            income: 0,
            expense: 0,
            cash: 0,
            card: 0,
            online: 0,
            manualExpenses: 0,
            manualExpenseCount: 0,
            cashWithdrawals: 0,
            cashWithdrawalCount: 0,
            operatingExpenses: 0,
            operatingExpenseCount: 0,
            refundExpenses: 0,
            refundExpenseCount: 0,
        };

    const shiftOrdersCount = (() => {
        if (Number.isFinite(Number(shift?.orders_count))) {
            return Number(shift.orders_count);
        }
        if (Array.isArray(shift?.orders) && Number.isFinite(Number(shift.orders[0]?.count))) {
            return Number(shift.orders[0].count);
        }
        const saleMovements = (movements || []).filter((m) => m.type === 'sale').length;
        const cancelled = Array.isArray(cancelledOrdersInShift) ? cancelledOrdersInShift.length : 0;
        return Math.max(0, saleMovements - cancelled);
    })();

    const cashDiff = (shift.actual_balance || 0) - (shift.expected_balance || 0);
    const isSurplus = cashDiff >= 0;
    const reconciliation = shift.closed_at ? getClosedShiftReconciliation(shift, totals) : null;

    const reconcileRows = [
        { key: 'cash', label: 'Efectivo', Icon: DollarSign },
        { key: 'card', label: 'Tarjeta (punto)', Icon: CreditCard },
        { key: 'online', label: 'Transferencia', Icon: Smartphone },
    ];

    return (
        <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="cash-shift-detail-title">
            <div
                className="modal-content glass cash-shift-detail-modal"
                onClick={(e) => e.stopPropagation()}
            >
                <header className="modal-header cash-shift-detail-modal__header">
                    <div className="cash-shift-detail-modal__title-block">
                        <History className="text-accent" size={22} aria-hidden />
                        <div>
                            <h3 id="cash-shift-detail-title" className="cash-shift-detail-modal__title">
                                Turno cerrado
                            </h3>
                            <div className="cash-shift-detail-modal__meta">
                                <span>
                                    {new Date(shift.closed_at).toLocaleDateString('es-CL', {
                                        weekday: 'short',
                                        day: '2-digit',
                                        month: 'long',
                                        year: 'numeric',
                                    })}
                                </span>
                                <span className="cash-shift-detail-modal__badge">
                                    {shiftOrdersCount} {shiftOrdersCount === 1 ? 'pedido' : 'pedidos'}
                                </span>
                                <span className="cash-shift-detail-modal__badge cash-shift-detail-modal__badge--muted">
                                    {movementsWithCancellations.length}{' '}
                                    {movementsWithCancellations.length === 1 ? 'movimiento' : 'movimientos'}
                                </span>
                            </div>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} className="btn-close" aria-label="Cerrar">
                        <X size={22} strokeWidth={2} />
                    </button>
                </header>

                <div className="cash-shift-detail-modal__body">
                    <aside className="cash-shift-detail-summary">
                        <section className="cash-shift-detail-card">
                            <h4 className="cash-shift-detail-section-title">
                                <Clock size={15} aria-hidden /> Información del turno
                            </h4>
                            <dl className="cash-shift-detail-dl">
                                <div className="cash-shift-detail-dl__row">
                                    <dt>Apertura</dt>
                                    <dd>
                                        {new Date(shift.opened_at).toLocaleString('es-CL', {
                                            dateStyle: 'short',
                                            timeStyle: 'short',
                                        })}
                                    </dd>
                                </div>
                                <div className="cash-shift-detail-dl__row">
                                    <dt>Cierre</dt>
                                    <dd>
                                        {new Date(shift.closed_at).toLocaleString('es-CL', {
                                            dateStyle: 'short',
                                            timeStyle: 'short',
                                        })}
                                    </dd>
                                </div>
                                <div className="cash-shift-detail-dl__row">
                                    <dt>
                                        <User size={13} aria-hidden /> Responsable
                                    </dt>
                                    <dd>{openedByLabel || (openedById ? 'Cargando…' : 'Sin registrar')}</dd>
                                </div>
                            </dl>
                        </section>

                        <section className="cash-shift-detail-card">
                            <h4 className="cash-shift-detail-section-title">Resumen de caja</h4>
                            <div className="cash-shift-detail-kpi-grid">
                                <div className="cash-shift-detail-kpi">
                                    <span className="cash-shift-detail-kpi__label">Base caja</span>
                                    <span className="cash-shift-detail-kpi__value">{fmtHist(shift.opening_balance)}</span>
                                </div>
                                <div className="cash-shift-detail-kpi">
                                    <span className="cash-shift-detail-kpi__label">Efectivo final</span>
                                    <span className="cash-shift-detail-kpi__value cash-shift-detail-kpi__value--income">
                                        {fmtHist(shift.actual_balance)}
                                    </span>
                                </div>
                                <div
                                    className={`cash-shift-detail-kpi cash-shift-detail-kpi--highlight${isSurplus ? ' cash-shift-detail-kpi--surplus' : ' cash-shift-detail-kpi--shortage'}`}
                                >
                                    <span className="cash-shift-detail-kpi__label">
                                        {isSurplus ? 'Sobrante' : 'Faltante'}
                                    </span>
                                    <span
                                        className={
                                            isSurplus
                                                ? 'cash-shift-detail-kpi__value cash-shift-detail-kpi__value--income'
                                                : 'cash-shift-detail-kpi__value cash-shift-detail-kpi__value--expense'
                                        }
                                    >
                                        {fmtHist(Math.abs(cashDiff))}
                                    </span>
                                </div>
                                <div className="cash-shift-detail-kpi">
                                    <span className="cash-shift-detail-kpi__label">Ingresos</span>
                                    <span className="cash-shift-detail-kpi__value cash-shift-detail-kpi__value--income">
                                        +{fmtHist(totals.income)}
                                    </span>
                                </div>
                                <div className="cash-shift-detail-kpi">
                                    <span className="cash-shift-detail-kpi__label">Gastos del local</span>
                                    <span className="cash-shift-detail-kpi__value cash-shift-detail-kpi__value--expense">
                                        −{fmtHist(totals.manualExpenses)}
                                    </span>
                                    <span className="cash-shift-detail-kpi__sub">
                                        {totals.manualExpenseCount ?? 0} mov.
                                    </span>
                                </div>
                                <div className="cash-shift-detail-kpi">
                                    <span className="cash-shift-detail-kpi__label">Devoluciones</span>
                                    <span className="cash-shift-detail-kpi__value cash-shift-detail-kpi__value--warn">
                                        −{fmtHist(totals.refundExpenses)}
                                    </span>
                                    <span className="cash-shift-detail-kpi__sub">
                                        {totals.refundExpenseCount ?? 0} mov.
                                    </span>
                                </div>
                            </div>
                        </section>

                        {reconciliation ? (
                            <section className="cash-shift-detail-card">
                                <h4 className="cash-shift-detail-section-title">Cuadre al cierre</h4>
                                <div className="cash-shift-detail-reconcile">
                                    {reconcileRows.map(({ key, label, Icon }) => {
                                        const { expected, actual } = reconciliation[key];
                                        const hasActual = actual != null && !Number.isNaN(actual);
                                        const diff = hasActual ? diffCounted(expected, actual) : null;
                                        return (
                                            <div key={key} className="cash-shift-detail-reconcile__row">
                                                <PaymentMethodBreakdownHeader Icon={Icon} label={label} />
                                                <div className="cash-shift-detail-reconcile__nums">
                                                    <span>
                                                        Esp. <strong>{fmtHist(expected)}</strong>
                                                    </span>
                                                    <span>
                                                        Cont.{' '}
                                                        <strong>{hasActual ? fmtHist(actual) : '—'}</strong>
                                                    </span>
                                                    {hasActual && diff ? (
                                                        <span
                                                            className={`cash-shift-close-diff cash-shift-close-diff--${diff.status === 'match' ? 'match' : diff.status}`}
                                                        >
                                                            {diff.status === 'match'
                                                                ? 'Cuadrado'
                                                                : `${diff.status === 'surplus' ? 'Sobrante' : 'Faltante'}: ${fmtHist(Math.abs(diff.diff))}`}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        ) : null}

                        <section className="cash-shift-detail-card">
                            <h4 className="cash-shift-detail-section-title">Neto por método</h4>
                            <div className="cash-shift-detail-methods-row">
                                <PaymentMethodChip Icon={DollarSign} label="Efectivo" value={fmtHist(totals.cash)} />
                                <PaymentMethodChip Icon={CreditCard} label="Tarjeta" value={fmtHist(totals.card)} />
                                <PaymentMethodChip Icon={Smartphone} label="Transf." value={fmtHist(totals.online)} />
                            </div>
                        </section>
                    </aside>

                    <section className="cash-shift-detail-movements-panel">
                        <div className="cash-shift-detail-movements-head">
                            <h4 className="cash-shift-detail-section-title cash-shift-detail-section-title--lg">
                                Movimientos del turno
                            </h4>
                            {!loading ? (
                                <span className="cash-shift-detail-movements-count">
                                    {movementsWithCancellations.length} en total
                                </span>
                            ) : null}
                        </div>

                        {loading ? (
                            <div className="cash-shift-detail-movements-empty">Cargando transacciones…</div>
                        ) : movementsWithCancellations.length === 0 ? (
                            <div className="cash-shift-detail-movements-empty">
                                No hay movimientos registrados para este turno.
                            </div>
                        ) : (
                            <div className="cash-shift-detail-movements">
                                <table className="cash-shift-detail-movements-table cash-movements-table">
                                    <colgroup>
                                        <col className="cash-shift-detail-movements-col-time" />
                                        <col className="cash-shift-detail-movements-col-type" />
                                        <col className="cash-shift-detail-movements-col-detail" />
                                        <col className="cash-shift-detail-movements-col-method" />
                                        <col className="cash-shift-detail-movements-col-num" />
                                    </colgroup>
                                    <thead>
                                        <tr>
                                            <th>Fecha / hora</th>
                                            <th>Tipo</th>
                                            <th>Detalle</th>
                                            <th className="cash-shift-detail-movements-table__method">Método</th>
                                            <th className="cash-shift-detail-movements-table__num">Monto</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {movementsWithCancellations.map((m) => {
                                            const movementDatetime = formatMovementDateTime(m.created_at);
                                            const paymentLabel = movementPaymentLabel(m);
                                            const paymentTitle =
                                                m.orders && m.type !== 'cancel'
                                                    ? getPaymentLabel(m.orders)
                                                    : paymentLabel;
                                            const clickable =
                                                Boolean(onMovementClick) &&
                                                isMovementOrderClickable(m, orders);
                                            const orderForRow = clickable
                                                ? getOrderForMovement(m, orders)
                                                : null;
                                            const handleRowActivate = () => {
                                                if (clickable && onMovementClick) onMovementClick(m);
                                            };
                                            return (
                                            <tr
                                                key={m.id}
                                                className={`movement-row${m.type === 'cancel' ? ' movement-row--cancelled' : ''}${clickable ? ' movement-row--clickable' : ''}`}
                                                onClick={clickable ? handleRowActivate : undefined}
                                                onKeyDown={
                                                    clickable
                                                        ? (e) => {
                                                              if (e.key === 'Enter' || e.key === ' ') {
                                                                  e.preventDefault();
                                                                  handleRowActivate();
                                                              }
                                                          }
                                                        : undefined
                                                }
                                                role={clickable ? 'button' : undefined}
                                                tabIndex={clickable ? 0 : undefined}
                                                aria-label={
                                                    clickable && orderForRow
                                                        ? `Ver detalle del pedido ${orderForRow.id}`
                                                        : undefined
                                                }
                                            >
                                                <td className="cash-shift-detail-movements-table__time">
                                                    <div className="cash-shift-detail-movement-datetime">
                                                        <span className="cash-shift-detail-movement-datetime__date">
                                                            {movementDatetime.date}
                                                        </span>
                                                        <span className="cash-shift-detail-movement-datetime__time">
                                                            {movementDatetime.time}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <span
                                                        className={`movement-type type-${m.type === 'cancel' ? 'cancel' : m.type}`}
                                                    >
                                                        {m.type === 'cancel' ? (
                                                            <>
                                                                <XCircle size={12} aria-hidden />
                                                                Cancelado
                                                            </>
                                                        ) : (
                                                            movementTypeLabel(m)
                                                        )}
                                                    </span>
                                                </td>
                                                <td className="cash-shift-detail-movements-table__detail">
                                                    <div className="cash-shift-detail-movement-desc">
                                                        {m.description || '—'}
                                                        {clickable ? (
                                                            <span className="cash-shift-detail-movement-view-hint">
                                                                <Eye size={12} aria-hidden /> Ver detalle
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                    {m.orders ? (
                                                        <div className="cash-shift-detail-movement-order">
                                                            <span className="cash-shift-detail-movement-order__client">
                                                                {m.orders.client_name || 'Cliente casual'}
                                                            </span>
                                                            {Array.isArray(m.orders.items) && m.orders.items.length > 0 ? (
                                                                <span className="cash-shift-detail-movement-order__items">
                                                                    {m.orders.items
                                                                        .map(
                                                                            (i) =>
                                                                                `${i.quantity}x ${(i.name ?? '').split(' (')[0]}`
                                                                        )
                                                                        .join(', ')}
                                                                </span>
                                                            ) : null}
                                                            {Number(m.orders.delivery_fee) > 0 ? (
                                                                <span className="cash-shift-detail-movement-order__delivery">
                                                                    Envío: {fmtHist(m.orders.delivery_fee)}
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                    ) : null}
                                                </td>
                                                <td
                                                    className="cash-shift-detail-movements-table__method"
                                                    title={paymentTitle}
                                                >
                                                    {paymentLabel}
                                                </td>
                                                <td className="cash-shift-detail-movements-table__num">
                                                    {m.type === 'cancel' ? (
                                                        <span className="cash-shift-detail-amount-cancel">—</span>
                                                    ) : (
                                                        <span
                                                            className={
                                                                m.type === 'expense'
                                                                    ? 'movement-amount amount-minus'
                                                                    : 'movement-amount amount-plus'
                                                            }
                                                        >
                                                            {m.type === 'expense' ? '−' : '+'}
                                                            {fmtHist(m.amount)}
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>
                </div>

                <footer className="modal-footer cash-shift-detail-modal__footer">
                    <button type="button" className="btn btn-secondary btn-block" onClick={onClose}>
                        Cerrar detalle
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default CashShiftDetailModal;
