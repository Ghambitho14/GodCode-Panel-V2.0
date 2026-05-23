import { getPaymentLabel } from '@/shared/utils/orderUtils';

/**
 * Cuadre guardado en turno cerrado (usa snapshots en BD o fallback desde movimientos).
 * @param {Record<string, unknown>} shift
 * @param {{ cash?: number; card?: number; online?: number } | null} totalsFromMovements
 */
export function getClosedShiftReconciliation(shift, totalsFromMovements) {
    const t = totalsFromMovements || {};
    return {
        cash: {
            expected: Number(shift?.expected_balance) || 0,
            actual: shift?.actual_balance != null ? Number(shift.actual_balance) : null,
        },
        card: {
            expected:
                shift?.expected_card_balance != null
                    ? Number(shift.expected_card_balance)
                    : Number(t.card) || 0,
            actual: shift?.actual_card_balance != null ? Number(shift.actual_card_balance) : null,
        },
        online: {
            expected:
                shift?.expected_online_balance != null
                    ? Number(shift.expected_online_balance)
                    : Number(t.online) || 0,
            actual: shift?.actual_online_balance != null ? Number(shift.actual_online_balance) : null,
        },
    };
}

/**
 * Montos esperados por método al cerrar turno.
 * @param {{ cash?: number; card?: number; online?: number } | null} totals
 * @param {{ expected_balance?: number; opening_balance?: number } | null} activeShift
 */
export function getExpectedByMethod(totals, activeShift) {
    const cash = Number(activeShift?.expected_balance ?? activeShift?.opening_balance ?? 0);
    return {
        cash: Number.isFinite(cash) ? cash : 0,
        card: Number(totals?.card) || 0,
        online: Number(totals?.online) || 0,
    };
}

/**
 * @param {number} expected
 * @param {number} counted
 * @returns {{ diff: number; status: 'match' | 'surplus' | 'shortage' }}
 */
export function diffCounted(expected, counted) {
    const exp = Number(expected) || 0;
    const cnt = Number(counted) || 0;
    const diff = cnt - exp;
    if (Math.abs(diff) < 0.01) return { diff: 0, status: 'match' };
    if (diff > 0) return { diff, status: 'surplus' };
    return { diff, status: 'shortage' };
}

function movementPaymentLabel(m) {
    if (m?.orders) return getPaymentLabel(m.orders);
    if (m.payment_method === 'cash') return 'Efectivo';
    if (m.payment_method === 'card') return 'Tarjeta';
    if (m.payment_method === 'online') return 'Transf.';
    return '—';
}

function saleRowLabel(m) {
    if (m.description) return m.description;
    const oid = m.order_id ?? m.orders?.id;
    if (oid != null) return `Pedido #${String(oid).slice(-4)}`;
    return 'Venta';
}

/**
 * Ventas del turno para tabla de cierre.
 * @param {Array<Record<string, unknown>>} movements
 */
export function buildShiftSalesRows(movements) {
    return (movements || [])
        .filter((m) => m.type === 'sale')
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .map((m) => ({
            id: m.id,
            at: m.created_at,
            label: saleRowLabel(m),
            methodLabel: movementPaymentLabel(m),
            amount: Number(m.amount) || 0,
        }));
}

/**
 * Otros movimientos (ingresos manuales, etc.) excluyendo ventas y cancelaciones.
 * @param {Array<Record<string, unknown>>} movements
 */
export function buildShiftOtherMovementRows(movements) {
    return (movements || [])
        .filter((m) => m.type !== 'sale' && m.type !== 'cancel')
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .map((m) => ({
            id: m.id,
            at: m.created_at,
            label: m.description || (m.type === 'income' ? 'Ingreso manual' : m.type),
            methodLabel: movementPaymentLabel(m),
            amount: Number(m.amount) || 0,
            type: m.type,
        }));
}
