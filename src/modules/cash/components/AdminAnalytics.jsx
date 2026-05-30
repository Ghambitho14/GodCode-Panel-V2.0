import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ArrowUpRight, ArrowDownRight, Calendar,
    ShoppingBag, Users, DollarSign, CreditCard,
    Smartphone, TrendingUp, Package, Clock, MapPin, Truck,
    BarChart3, AreaChart, Wallet, Banknote, Download, Loader2, Plus
} from 'lucide-react';
import { supabase, TABLES } from '@/integrations/supabase';
import { cashService } from '../services/cashService';
import { expenseBucketKey, labelForExpenseBucket } from '../utils/cashExpenseBuckets';
import {
    labelForManualExpenseKind,
    isCashWithdrawal,
    isOperatingLocalExpense,
    isOrderLinkedExpense,
    EXPENSE_KIND_OPERATING,
} from '../utils/cashMovementKinds';
import AdminIconSlot from './AdminIconSlot';
import AdminMenuSelect from './AdminMenuSelect';
import { formatCurrency } from '@/shared/utils/formatters';
import { isMenuOrder, getPaymentSlug, getPaymentLabel } from '@/shared/utils/orderUtils';
import { downloadExcel } from '@/shared/utils/exportUtils';
import { isValidBranchId } from '@/shared/utils/safeIds';
import { useAdmin } from '../admin/pages/AdminProvider';
import LocalExpenseModal from './expenses/LocalExpenseModal';
import RPTRosenSalesChart from './charts/RPTRosenSalesChart';
import RPTRosenBarChart from './charts/RPTRosenBarChart';
import RPTRosenDonutChart from './charts/RPTRosenDonutChart';

const CHART_KIND_OPTIONS = [
    { value: 'area', label: 'Área', Icon: AreaChart },
    { value: 'bar-solid', label: 'Barras', Icon: BarChart3 },
    { value: 'bar-gradient', label: 'Barras degradado', Icon: BarChart3 },
];

function formatSalesChartLabel(isoDate, dayCount) {
    const d = new Date(`${isoDate}T12:00:00`);
    if (dayCount <= 15) {
        return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
    }
    return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'numeric' });
}

const RPT_PERIOD_OPTIONS = [
    { value: '7', label: '7 días' },
    { value: '15', label: '15 días' },
    { value: '30', label: '30 días' },
    { value: '90', label: '3 meses' },
    { value: 'all', label: 'Todo' },
];

const EXPENSE_AGG_OPTIONS = [
    { value: 'day', label: 'Día' },
    { value: 'week', label: 'Semana' },
    { value: 'month', label: 'Mes' },
];

const EXPENSE_RANGE_MODE_OPTIONS = [
    { value: 'inform', label: 'Ventana del informe' },
    { value: 'calendarMonth', label: 'Mes calendario' },
];

const fmt = (n) => {
    try { return formatCurrency(n); } catch { return `$${(n || 0).toLocaleString('es-CL')}`; }
};

/** Rango UTC half-open [start, end) para un mes calendario `yyyy-mm`. */
function getMonthRangeUtc(yyyyMm) {
    const [yearStr, monthStr] = String(yyyyMm).split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return null;
    }
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const nextMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    return {
        startIso: start.toISOString(),
        endIso: nextMonth.toISOString(),
    };
}

function getPrevMonthRangeUtc(yyyyMm) {
    const [yearStr, monthStr] = String(yyyyMm).split('-');
    let year = Number(yearStr);
    let month = Number(monthStr);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return null;
    }
    month -= 1;
    if (month < 1) {
        month = 12;
        year -= 1;
    }
    return getMonthRangeUtc(`${year}-${String(month).padStart(2, '0')}`);
}


const TrendBadge = ({ value }) => {
    if (value === 0) return <span className="rpt-trend neutral">0%</span>;
    const pos = value > 0;
    return (
        <span className={`rpt-trend ${pos ? 'positive' : 'negative'}`}>
            {pos ? <ArrowUpRight size={13} aria-hidden /> : <ArrowDownRight size={13} aria-hidden />}
            {Math.abs(value)}%
        </span>
    );
};

function buildExpenseChartData(rows, expenseAgg) {
    const acc = new Map();
    for (const row of rows || []) {
        const iso = row.created_at;
        if (!iso) continue;
        const key = expenseBucketKey(iso, expenseAgg);
        acc.set(key, (acc.get(key) || 0) + (Number(row.amount) || 0));
    }
    const keys = [...acc.keys()].sort();
    return {
        expenseBucketsOrdered: keys.map((k) => ({
            key: k,
            label: labelForExpenseBucket(k, expenseAgg),
            total: acc.get(k) || 0,
        })),
        expenseBarPoints: keys.map((k) => ({
            key: k,
            label: labelForExpenseBucket(k, expenseAgg),
            value: Number(acc.get(k)) || 0,
        })),
    };
}

/** `orders` desde el panel sigue limitado a 100 filas (kanban). Los KPIs usan fetch propio vía `analyticsOrders`. */
const AdminAnalytics = ({ orders, clients, branches, showNotify, companyId, selectedBranch, view = 'full' }) => {
    const [filterPeriod, setFilterPeriod] = useState('7');
    const [chartTab, setChartTab] = useState('all');
    const [chartKind, setChartKind] = useState('bar-gradient');
    /** Pestaña principal del bloque informe: ventas (gráfico + barra lateral) o gastos del local. */
    const [expensesData, setExpensesData] = useState({ total: 0, prevTotal: 0 });
    const [loadingExpenses, setLoadingExpenses] = useState(false);
    const [manualExpenseRows, setManualExpenseRows] = useState([]);
    const [refundExpenseRows, setRefundExpenseRows] = useState([]);
    const [expenseAgg, setExpenseAgg] = useState('day');
    const [expenseRangeMode, setExpenseRangeMode] = useState('inform');
    const [exportExpensesLoading, setExportExpensesLoading] = useState(false);
    const [analyticsDate, setAnalyticsDate] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const [exportLoading, setExportLoading] = useState(false);
    /** Pedidos del rango para KPIs/gráficos (no el slice de 100 del provider). */
    const [analyticsOrders, setAnalyticsOrders] = useState([]);
    const [loadingAnalyticsOrders, setLoadingAnalyticsOrders] = useState(false);
    const [expenseRefreshNonce, setExpenseRefreshNonce] = useState(0);
    const [isAddExpenseModalOpen, setIsAddExpenseModalOpen] = useState(false);
    /** @type {'all' | 'operating' | 'cash_withdrawal' | 'order_refund'} */
    const [expenseKindFilter, setExpenseKindFilter] = useState('all');
    const { cashSystem, moveOrder } = useAdmin();

    const days = filterPeriod === 'all' ? 365 : parseInt(filterPeriod);

    useEffect(() => {
        if (!companyId) return;
        let cancelled = false;
        setLoadingAnalyticsOrders(true);
        (async () => {
            try {
                let q = supabase.from(TABLES.orders).select('*').eq('company_id', companyId);
                if (filterPeriod !== 'all') {
                    const cutoff = new Date();
                    cutoff.setDate(cutoff.getDate() - days);
                    q = q.gte('created_at', cutoff.toISOString());
                }
                if (selectedBranch?.id && selectedBranch.id !== 'all') {
                    q = q.eq('branch_id', selectedBranch.id);
                }
                const { data, error } = await q.order('created_at', { ascending: false }).limit(5000);
                if (cancelled) return;
                if (error) throw error;
                setAnalyticsOrders(data ?? []);
            } catch (e) {
                console.error('Error fetching analytics orders:', e);
                if (!cancelled) setAnalyticsOrders([]);
            } finally {
                if (!cancelled) setLoadingAnalyticsOrders(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [companyId, selectedBranch?.id, days, filterPeriod]);

    useEffect(() => {
        if (!companyId) {
            setAnalyticsOrders(Array.isArray(orders) ? orders : []);
            setLoadingAnalyticsOrders(false);
        }
    }, [companyId, orders]);

    const ordersForAnalytics = useMemo(() => {
        if (loadingAnalyticsOrders && analyticsOrders.length === 0 && Array.isArray(orders) && orders.length > 0) {
            return orders;
        }
        return analyticsOrders;
    }, [loadingAnalyticsOrders, analyticsOrders, orders]);

    const branchNameById = useMemo(() => {
        const map = {};
        (branches || []).forEach((b) => {
            if (b?.id != null) map[String(b.id)] = b.name || b.label || String(b.id);
        });
        return map;
    }, [branches]);

    const operatingExpenseRows = useMemo(
        () => (manualExpenseRows || []).filter((r) => isOperatingLocalExpense(r)),
        [manualExpenseRows],
    );

    const withdrawalExpenseRows = useMemo(
        () => (manualExpenseRows || []).filter((r) => isCashWithdrawal(r)),
        [manualExpenseRows],
    );

    const operatingChartData = useMemo(
        () => buildExpenseChartData(operatingExpenseRows, expenseAgg),
        [operatingExpenseRows, expenseAgg],
    );

    const withdrawalChartData = useMemo(
        () => buildExpenseChartData(withdrawalExpenseRows, expenseAgg),
        [withdrawalExpenseRows, expenseAgg],
    );

    const manualExpenseBreakdown = useMemo(() => {
        const rows = manualExpenseRows || [];
        let operating = 0;
        let operatingCount = 0;
        let withdrawals = 0;
        let withdrawalCount = 0;
        for (const row of rows) {
            const amount = Number(row.amount) || 0;
            if (isCashWithdrawal(row)) {
                withdrawals += amount;
                withdrawalCount += 1;
            } else if (isOperatingLocalExpense(row)) {
                operating += amount;
                operatingCount += 1;
            }
        }
        return { operating, operatingCount, withdrawals, withdrawalCount };
    }, [manualExpenseRows]);

    const refundBreakdown = useMemo(() => {
        const rows = refundExpenseRows || [];
        let total = 0;
        for (const row of rows) {
            total += Number(row.amount) || 0;
        }
        return { total, count: rows.length };
    }, [refundExpenseRows]);

    const filteredManualExpenseRows = useMemo(() => {
        if (expenseKindFilter === 'order_refund') {
            return refundExpenseRows || [];
        }
        const rows = manualExpenseRows || [];
        if (expenseKindFilter === 'cash_withdrawal') {
            return rows.filter((r) => isCashWithdrawal(r));
        }
        if (expenseKindFilter === 'operating') {
            return rows.filter((r) => isOperatingLocalExpense(r));
        }
        return [...rows, ...(refundExpenseRows || [])];
    }, [manualExpenseRows, refundExpenseRows, expenseKindFilter]);

    const showOperatingExpenseBlock =
        expenseKindFilter === 'all' || expenseKindFilter === 'operating';
    const showWithdrawalExpenseBlock =
        expenseKindFilter === 'all' || expenseKindFilter === 'cash_withdrawal';

    const handleExportManualExpensesExcel = async () => {
        if (exportExpensesLoading) return;
        const exportRows = [...(manualExpenseRows || []), ...(refundExpenseRows || [])];
        if (!exportRows.length) {
            if (showNotify) showNotify('No hay gastos del local en este período', 'info');
            return;
        }
        setExportExpensesLoading(true);
        try {
            const rows = [...exportRows].sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
            );
            const dataToExport = rows.map((row) => {
                const sh = row[TABLES.cash_shifts] || row.cash_shifts;
                const bid = sh?.branch_id;
                const branchName = bid != null ? (branchNameById[String(bid)] || String(bid)) : '';
                const d = new Date(row.created_at);
                const pm = row.payment_method;
                const metodo =
                    pm === 'cash' ? 'Efectivo' : pm === 'card' ? 'Tarjeta' : pm === 'online' ? 'Transferencia' : String(pm || '');
                return {
                    Fecha: d.toLocaleDateString('es-CL'),
                    Hora: d.toLocaleTimeString('es-CL'),
                    Tipo: labelForManualExpenseKind(row),
                    Sucursal: branchName,
                    Monto: row.amount,
                    Metodo: metodo,
                    Descripcion: row.description || '',
                };
            });
            const tag = expenseRangeMode === 'calendarMonth' ? analyticsDate : `ultimos_${days}d`;
            downloadExcel(dataToExport, `Gastos_local_${tag}.xls`);
            if (showNotify) showNotify('Excel de gastos generado', 'success');
        } catch {
            if (showNotify) showNotify('Error al exportar gastos', 'error');
        } finally {
            setExportExpensesLoading(false);
        }
    };

    const handleExportMonthlyManualExpensesExcel = async () => {
        if (exportExpensesLoading || !companyId) return;
        const range = getMonthRangeUtc(analyticsDate);
        if (!range) {
            if (showNotify) showNotify('Mes inválido', 'error');
            return;
        }
        setExportExpensesLoading(true);
        try {
            const rows = await cashService.getManualExpenseMovementsInRange({
                companyId,
                branchId: selectedBranch?.id,
                startIso: range.startIso,
                endIso: range.endIso,
            });
            if (!rows.length) {
                if (showNotify) showNotify('No hay gastos del local en ese mes', 'info');
                return;
            }
            const sorted = [...rows].sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
            );
            const dataToExport = sorted.map((row) => {
                const sh = row[TABLES.cash_shifts] || row.cash_shifts;
                const bid = sh?.branch_id;
                const branchName = bid != null ? (branchNameById[String(bid)] || String(bid)) : '';
                const d = new Date(row.created_at);
                const pm = row.payment_method;
                const metodo =
                    pm === 'cash' ? 'Efectivo' : pm === 'card' ? 'Tarjeta' : pm === 'online' ? 'Transferencia' : String(pm || '');
                return {
                    Fecha: d.toLocaleDateString('es-CL'),
                    Hora: d.toLocaleTimeString('es-CL'),
                    Tipo: labelForManualExpenseKind(row),
                    Sucursal: branchName,
                    Monto: row.amount,
                    Metodo: metodo,
                    Descripcion: row.description || '',
                };
            });
            const [year, month] = String(analyticsDate).split('-');
            downloadExcel(dataToExport, `Gastos_local_${year || '0000'}_${month || '00'}.xls`);
            if (showNotify) showNotify('Excel de gastos del mes generado', 'success');
        } catch {
            if (showNotify) showNotify('Error al exportar gastos del mes', 'error');
        } finally {
            setExportExpensesLoading(false);
        }
    };

    const tryOpenRegisterExpenseModal = useCallback(() => {
        if (!selectedBranch?.id || selectedBranch.id === 'all' || !isValidBranchId(selectedBranch.id)) {
            if (showNotify) showNotify('Selecciona una sucursal para registrar un movimiento.', 'info');
            return;
        }
        if (!cashSystem?.activeShift) {
            if (showNotify) showNotify('Abre la caja en esta sucursal para registrar movimientos del local.', 'info');
            return;
        }
        setIsAddExpenseModalOpen(true);
    }, [selectedBranch, cashSystem?.activeShift, showNotify]);

    const handleAfterExpenseMovement = useCallback(async () => {
        setExpenseRefreshNonce((n) => n + 1);
        if (typeof cashSystem.refresh === 'function') {
            await cashSystem.refresh();
        }
    }, [cashSystem]);

    const handleConfirmRegisterLocalExpense = useCallback(
        async (type, amount, description, paymentMethod) => {
            return cashSystem.addManualMovement(type, amount, description, paymentMethod, {
                expenseKind: EXPENSE_KIND_OPERATING,
                successMessage: 'Gasto del local registrado',
            });
        },
        [cashSystem],
    );

    const handleExportMonthlyExcel = async () => {
        if (exportLoading) return;
        const range = getMonthRangeUtc(analyticsDate);
        if (!range) {
            if (showNotify) showNotify('Mes inválido', 'error');
            return;
        }

        setExportLoading(true);
        try {
            let query = supabase
                .from(TABLES.orders)
                .select('*')
                .gte('created_at', range.startIso)
                .lt('created_at', range.endIso)
                .order('created_at', { ascending: true });

            if (companyId) {
                query = query.eq('company_id', companyId);
            }

            if (selectedBranch && selectedBranch.id && selectedBranch.id !== 'all') {
                query = query.eq('branch_id', selectedBranch.id);
            }

            const { data: fullMonthOrders, error } = await query;

            if (error) throw error;

            if (!fullMonthOrders || fullMonthOrders.length === 0) {
                if (showNotify) showNotify('No hay datos para exportar en este período', 'info');
                return;
            }

            const dataToExport = fullMonthOrders.map(order => {
                const d = new Date(order.created_at);
                let items = Array.isArray(order.items) ? order.items : [];
                if (typeof order.items === 'string') {
                    try { items = JSON.parse(order.items); } catch {}
                }
                const itemsText = items.map(i => `${i.quantity}x ${i.name}`).join(' | ');
                return {
                    Fecha: d.toLocaleDateString('es-CL'),
                    Hora: d.toLocaleTimeString('es-CL'),
                    Cliente: order.client_name,
                    RUT: order.client_rut,
                    Teléfono: order.client_phone,
                    Items: itemsText,
                    Total: order.total,
                    'Método Pago': getPaymentLabel(order) || '',
                    'Ref. Pago': order.payment_ref || ''
                };
            });

            const [year, month] = String(analyticsDate).split('-');
            downloadExcel(dataToExport, `Reporte_${year || '0000'}_${month || '00'}.xls`);
            if (showNotify) showNotify('Reporte Excel generado', 'success');
        } catch (err) {
            if (showNotify) showNotify('Error al generar reporte: ' + (err instanceof Error ? err.message : String(err)), 'error');
        } finally {
            setExportLoading(false);
        }
    };

    /**
     * Gastos manuales del local (`expense` sin `order_id`). Rango según expenseRangeMode
     * o ventana del informe (últimos N días).
     */
    useEffect(() => {
        let cancelled = false;

        const fetchExpenses = async () => {
            setLoadingExpenses(true);
            try {
                const now = new Date();
                let startIso;
                let endIso;
                let prevStartIso;
                let prevEndIso;

                if (expenseRangeMode === 'calendarMonth') {
                    const range = getMonthRangeUtc(analyticsDate);
                    if (!range) {
                        if (!cancelled) {
                            setManualExpenseRows([]);
                            setRefundExpenseRows([]);
                            setExpensesData({ total: 0, prevTotal: 0 });
                        }
                        return;
                    }
                    startIso = range.startIso;
                    endIso = range.endIso;
                    const prevRange = getPrevMonthRangeUtc(analyticsDate);
                    if (prevRange) {
                        prevStartIso = prevRange.startIso;
                        prevEndIso = prevRange.endIso;
                    }
                } else {
                    const cutoff = new Date(now);
                    cutoff.setDate(now.getDate() - days);
                    startIso = cutoff.toISOString();
                    endIso = undefined;
                    if (filterPeriod !== 'all') {
                        const prevCutoff = new Date(cutoff);
                        prevCutoff.setDate(prevCutoff.getDate() - days);
                        prevStartIso = prevCutoff.toISOString();
                        prevEndIso = cutoff.toISOString();
                    }
                }

                const fetchParams = {
                    companyId: companyId || null,
                    branchId: selectedBranch?.id,
                    startIso,
                    endIso,
                };

                const currentRows = await cashService.getManualExpenseMovementsInRange(fetchParams);
                const currentRefunds = await cashService.getOrderRefundMovementsInRange(fetchParams);
                if (cancelled) return;

                let prevRows = [];
                let prevRefunds = [];
                if (prevStartIso != null && prevEndIso != null) {
                    const prevParams = {
                        companyId: companyId || null,
                        branchId: selectedBranch?.id,
                        startIso: prevStartIso,
                        endIso: prevEndIso,
                    };
                    [prevRows, prevRefunds] = await Promise.all([
                        cashService.getManualExpenseMovementsInRange(prevParams),
                        cashService.getOrderRefundMovementsInRange(prevParams),
                    ]);
                }
                if (cancelled) return;

                const total = currentRows.reduce((acc, m) => acc + (Number(m.amount) || 0), 0)
                    + currentRefunds.reduce((acc, m) => acc + (Number(m.amount) || 0), 0);
                const prevTotal = prevRows.reduce((acc, m) => acc + (Number(m.amount) || 0), 0)
                    + prevRefunds.reduce((acc, m) => acc + (Number(m.amount) || 0), 0);
                setManualExpenseRows(currentRows);
                setRefundExpenseRows(currentRefunds);
                setExpensesData({ total, prevTotal });
            } catch (err) {
                console.error('Error fetching expenses for analytics:', err);
                if (!cancelled) {
                    setManualExpenseRows([]);
                    setRefundExpenseRows([]);
                    setExpensesData({ total: 0, prevTotal: 0 });
                }
            } finally {
                if (!cancelled) setLoadingExpenses(false);
            }
        };

        fetchExpenses();
        return () => {
            cancelled = true;
        };
    }, [days, filterPeriod, companyId, selectedBranch?.id, expenseRangeMode, analyticsDate, expenseRefreshNonce]);

    // --- CORE DATA ---
    const { salesChartPoints, kpis, trends, paymentBreakdown, branchStats } = useMemo(() => {
        if (!ordersForAnalytics || ordersForAnalytics.length === 0) {
            return {
                salesChartPoints: [],
                kpis: { total: 0, count: 0, ticket: 0, deliveryTotal: 0, deliveryCount: 0, net: -(expensesData.total || 0) },
                trends: { total: 0, count: 0, delivery: 0, expenses: 0, net: 0 },
                paymentBreakdown: { cash: 0, card: 0, online: 0 },
                branchStats: []
            };
        }
        const now = new Date();
        const cutoff = new Date(now);
        cutoff.setDate(now.getDate() - days);

        const prevCutoff = new Date(cutoff);
        prevCutoff.setDate(prevCutoff.getDate() - days);

        const filterByTab = (o) => {
            if (chartTab === 'all') return true;
            if (chartTab === 'online') return isMenuOrder(o);
            if (chartTab === 'store') return !isMenuOrder(o);
            return true;
        };

        const valid = ordersForAnalytics.filter(o => o.status !== 'cancelled');
        
        // [FIX] Crear Set de IDs válidos para filtrar órdenes huérfanas ("Sin asignar")
        const validBranchIds = new Set((branches || []).map(b => b.id));
        
        const current = valid.filter(o => {
            const d = new Date(o.created_at);
            const matchesTime = (filterPeriod === 'all' ? true : d >= cutoff) && filterByTab(o);
            return matchesTime;
        });

        const prev = valid.filter(o => {
            const d = new Date(o.created_at);
            const matchesTime = filterPeriod === 'all' ? false : (d >= prevCutoff && d < cutoff) && filterByTab(o);
            return matchesTime && o.branch_id && validBranchIds.has(o.branch_id);
        });

        // --- CHART DATA (serie diaria local YYYY-MM-DD) ---
        const salesByDate = {};
        const chartDateKeys = [];

        for (let i = days - 1; i >= 0; i--) {
            const d = new Date();
            d.setDate(now.getDate() - i);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const key = `${year}-${month}-${day}`;

            chartDateKeys.push(key);
            salesByDate[key] = 0;
        }

        current.forEach(o => {
            // [FIX] Convertir created_at (UTC) a fecha local del navegador para agrupar correctamente
            const localDate = new Date(o.created_at).toLocaleDateString('en-CA'); // YYYY-MM-DD local
            if (salesByDate[localDate] !== undefined) {
                salesByDate[localDate] += Number(o.total);
            }
        });

        const expensesByDate = {};
        chartDateKeys.forEach((k) => {
            expensesByDate[k] = 0;
        });
        for (const row of manualExpenseRows || []) {
            const iso = row.created_at;
            if (!iso) continue;
            const localDate = new Date(iso).toLocaleDateString('en-CA');
            if (expensesByDate[localDate] !== undefined) {
                expensesByDate[localDate] += Number(row.amount) || 0;
            }
        }

        // --- KPIS ---
        const totalSales = current.reduce((a, o) => a + Number(o.total), 0);
        const count = current.length;
        const ticket = count > 0 ? totalSales / count : 0;

        const prevSales = prev.reduce((a, o) => a + Number(o.total), 0);
        const prevCount = prev.length;

        const totalNet = totalSales - (expensesData.total || 0);
        const prevNet = prevSales - (expensesData.prevTotal || 0);

        // --- DELIVERY: solo suma `delivery_fee` (no el total del pedido). Valor = cobro envíos del período.
        const deliveryOrdersCurrent = current.filter((o) => {
            const fee = Number(o?.delivery_fee);
            return Number.isFinite(fee) && fee > 0;
        });
        const deliveryCount = deliveryOrdersCurrent.length;
        const totalDeliveryFees = deliveryOrdersCurrent.reduce(
            (a, o) => a + Number(o.delivery_fee),
            0
        );
        const prevTotalDeliveryFees = prev
            .filter((o) => {
                const fee = Number(o?.delivery_fee);
                return Number.isFinite(fee) && fee > 0;
            })
            .reduce((a, o) => a + Number(o.delivery_fee), 0);
        const trendDelivery =
            prevTotalDeliveryFees === 0
                ? totalDeliveryFees > 0
                    ? 100
                    : 0
                : Math.round(
                      ((totalDeliveryFees - prevTotalDeliveryFees) / prevTotalDeliveryFees) * 100
                  );

        // --- PAYMENT BREAKDOWN (incl. payment_method_specific: Zelle, Pago Móvil, etc.) ---
        const pb = { cash: 0, card: 0, online: 0 };
        current.forEach(o => {
            const slug = getPaymentSlug(o);
            if (slug === 'transfer') pb.online += Number(o.total);
            else if (slug === 'card') pb.card += Number(o.total);
            else pb.cash += Number(o.total);
        });

        // --- BRANCH BREAKDOWN ---
        const bStats = {};
        const realBranches = (branches || []).filter(b => b.id && b.id !== 'all');
        realBranches.forEach(b => {
            bStats[b.id] = { id: b.id, name: b.name || 'Sucursal sin nombre', total: 0, count: 0 };
        });
        
        current.forEach(o => {
            const bid = o.branch_id || '_sin_asignar_';
            if (!bStats[bid]) {
                // [ROBUSTEZ] Manejo seguro de sucursales eliminadas o antiguas
                const branchName = realBranches.find(b => b.id === bid)?.name || (bid === '_sin_asignar_' ? 'Sin asignar' : 'Sucursal eliminada');
                bStats[bid] = {
                    id: bid,
                    name: branchName,
                    total: 0,
                    count: 0
                };
            }
            bStats[bid].total += Number(o.total);
            bStats[bid].count += 1;
        });

        const sortedBranches = Object.values(bStats)
            .filter(b => b.total > 0 || b.count > 0)
            .sort((a, b) => b.total - a.total);

        return {
            salesChartPoints: chartDateKeys.map((k) => ({
                key: k,
                label: formatSalesChartLabel(k, days),
                sales: Number(salesByDate[k]) || 0,
                expenses: Number(expensesByDate[k]) || 0,
            })),
            kpis: {
                total: totalSales,
                count,
                ticket,
                deliveryTotal: totalDeliveryFees,
                deliveryCount,
                net: totalNet
            },
            trends: {
                total: prevSales === 0 ? (totalSales > 0 ? 100 : 0) : Math.round(((totalSales - prevSales) / prevSales) * 100),
                count: prevCount === 0 ? (count > 0 ? 100 : 0) : Math.round(((count - prevCount) / prevCount) * 100),
                delivery: trendDelivery,
                expenses: !expensesData.prevTotal ? (expensesData.total > 0 ? 100 : 0) : Math.round(((expensesData.total - expensesData.prevTotal) / expensesData.prevTotal) * 100),
                net: !prevNet ? (totalNet !== 0 ? 100 : 0) : Math.round(((totalNet - prevNet) / prevNet) * 100)
            },
            paymentBreakdown: pb,
            branchStats: sortedBranches
        };
    }, [ordersForAnalytics, filterPeriod, chartTab, days, branches, expensesData, manualExpenseRows]);

    // --- NEW CLIENTS ---
    const newClientsInfo = useMemo(() => {
        if (!clients) return { count: 0, trend: 0, total: 0 };
        const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
        const prevCutoff = new Date(); prevCutoff.setDate(cutoff.getDate() - days);
        
        const currentNew = clients.filter(c => new Date(c.created_at || new Date()) >= cutoff).length;
        const prevNew = filterPeriod === 'all' ? 0 : clients.filter(c => {
            const d = new Date(c.created_at || new Date());
            return d >= prevCutoff && d < cutoff;
        }).length;

        return {
            count: currentNew,
            trend: prevNew === 0 ? (currentNew > 0 ? 100 : 0) : Math.round(((currentNew - prevNew) / prevNew) * 100),
            total: clients.length,
        };
    }, [clients, filterPeriod, days]);

    // --- TOP 5 PRODUCTS ---
    const topProducts = useMemo(() => {
        if (!ordersForAnalytics) return [];
        const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
        const filtered = ordersForAnalytics.filter(o => o.status !== 'cancelled' && (filterPeriod === 'all' || new Date(o.created_at) >= cutoff));
        
        const counts = {};
        const revenue = {};
        
        filtered.forEach(o => {
            if (o.items && Array.isArray(o.items)) {
                o.items.forEach(item => {
                    const name = item.name ? String(item.name).split(' (')[0] : 'Desconocido';
                    counts[name] = (counts[name] || 0) + (item.quantity || 1);
                    revenue[name] = (revenue[name] || 0) + ((item.price || 0) * (item.quantity || 1));
                });
            }
        });

        return Object.entries(counts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([name, qty]) => ({ name, qty, revenue: revenue[name] || 0 }));
    }, [ordersForAnalytics, filterPeriod, days]);

    // --- PEAK HOUR ---
    const peakHour = useMemo(() => {
        if (!ordersForAnalytics || ordersForAnalytics.length === 0) return null;
        const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
        
        const hourCounts = {};
        ordersForAnalytics.filter(o => o.status !== 'cancelled' && (filterPeriod === 'all' || new Date(o.created_at) >= cutoff))
            .forEach(o => {
                const h = new Date(o.created_at).getHours();
                hourCounts[h] = (hourCounts[h] || 0) + 1;
            });

        const sorted = Object.entries(hourCounts).sort(([, a], [, b]) => b - a);
        if (sorted.length === 0) return null;
        
        const h = parseInt(sorted[0][0]);
        return { hour: `${h}:00 - ${h + 1}:00`, count: sorted[0][1] };
    }, [ordersForAnalytics, filterPeriod, days]);


    const activeChartKind =
        chartKind === 'bar-gradient'
            ? 'bar-gradient'
            : chartKind === 'bar-solid' || chartKind === 'bar'
              ? 'bar-solid'
              : 'area';

    const reportPeriodHeader = (
        <header className="rpt-header rpt-header--actions-only">
            <div className="rpt-header-actions">
                <AdminMenuSelect
                    className="rpt-period-menu-select"
                    value={filterPeriod}
                    onChange={setFilterPeriod}
                    options={RPT_PERIOD_OPTIONS}
                    aria-label="Rango de fechas del informe"
                    icon={<Calendar size={18} strokeWidth={1.65} className="text-accent" />}
                />
            </div>
        </header>
    );

    const gastosLocalSection = (
        <div className={`rpt-chart-card rpt-expenses-card${view === 'expensesOnly' ? ' rpt-chart-card--expenses-solo' : ''}${expenseKindFilter !== 'all' ? ' rpt-chart-card--expenses-filtered' : ''}`}>
            <div className="rpt-chart-header rpt-expenses-card-header">
                <div className="rpt-expenses-title-block">
                    <h3>Gastos del local</h3>
                    <p className="rpt-expenses-subtitle">
                        Mercadería, arriendo, sueldo y gastos operativos. Los retiros de efectivo hechos en Caja también
                        aparecen aquí para control del CEO.
                    </p>
                </div>
                <div className="rpt-expenses-toolbar">
                    <button type="button" className="rpt-btn-register-expense" onClick={tryOpenRegisterExpenseModal}>
                        <Plus size={17} strokeWidth={2.25} aria-hidden />
                        Registrar movimiento
                    </button>
                    <div className="rpt-expenses-toolbar-cluster" aria-label="Vista del informe de gastos">
                        <AdminMenuSelect
                            value={expenseRangeMode}
                            onChange={setExpenseRangeMode}
                            options={EXPENSE_RANGE_MODE_OPTIONS}
                            aria-label="Rango de gastos del local"
                            icon={<Calendar size={18} strokeWidth={1.65} className="text-accent" />}
                        />
                        <div className="rpt-expenses-agg" role="group" aria-label="Agrupar gastos por">
                            <span className="rpt-expenses-agg-label">Agrupar</span>
                            <div className="rpt-expenses-agg-tabs">
                                {EXPENSE_AGG_OPTIONS.map(({ value, label }) => (
                                    <button
                                        key={value}
                                        type="button"
                                        className={`rpt-tab ${expenseAgg === value ? 'active' : ''}`}
                                        onClick={() => setExpenseAgg(value)}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="rpt-tab rpt-tab--export-expenses"
                        onClick={handleExportManualExpensesExcel}
                        disabled={exportExpensesLoading || !(manualExpenseRows.length || refundExpenseRows.length)}
                    >
                        {exportExpensesLoading ? (
                            <Loader2 size={14} className="rpt-expenses-spin" aria-hidden />
                        ) : (
                            <Download size={14} aria-hidden />
                        )}
                        <span>Excel (vista)</span>
                    </button>
                </div>
            </div>
            {expenseRangeMode === 'calendarMonth' && (
                <p className="rpt-expenses-calendar-hint">
                    El mes calendario coincide con el selector de &quot;Descargar Reporte Mensual&quot; ({analyticsDate}).
                </p>
            )}
            <div className="rpt-expenses-kind-filter" role="group" aria-label="Filtrar por tipo de egreso">
                {[
                    ['all', 'Todos'],
                    ['operating', 'Gastos operativos'],
                    ['cash_withdrawal', 'Retiros caja'],
                    ['order_refund', 'Devoluciones'],
                ].map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        className={`rpt-tab${expenseKindFilter === value ? ' active' : ''}`}
                        onClick={() => setExpenseKindFilter(value)}
                    >
                        {label}
                    </button>
                ))}
            </div>
            {(manualExpenseRows.length > 0 || refundExpenseRows.length > 0) && expenseKindFilter === 'all' ? (
                <p className="rpt-expenses-breakdown">
                    Total período: <strong>{fmt(expensesData.total)}</strong>
                    {' · '}
                    Operativos: <strong>{fmt(manualExpenseBreakdown.operating)}</strong> (
                    {manualExpenseBreakdown.operatingCount})
                    {' · '}
                    Retiros caja: <strong>{fmt(manualExpenseBreakdown.withdrawals)}</strong> (
                    {manualExpenseBreakdown.withdrawalCount})
                    {' · '}
                    Devoluciones: <strong>{fmt(refundBreakdown.total)}</strong> ({refundBreakdown.count})
                </p>
            ) : null}
            <div className="rpt-expenses-blocks">
                {showOperatingExpenseBlock ? (
                <section className="rpt-expenses-block">
                    <div className="rpt-expenses-block-head">
                        <h4 className="rpt-expenses-section-title">Gastos operativos</h4>
                        <span className="rpt-expenses-block-meta">
                            {manualExpenseBreakdown.operatingCount} mov. ·{' '}
                            {fmt(manualExpenseBreakdown.operating)}
                        </span>
                    </div>
                    <div className="rpt-expenses-split">
                        <div className="rpt-chart-wrapper rpt-chart-wrapper--rosen rpt-expenses-chart-wrap">
                            {operatingChartData.expenseBarPoints.length ? (
                                <RPTRosenBarChart
                                    points={operatingChartData.expenseBarPoints}
                                    height={220}
                                    ariaLabel="Gastos operativos por período"
                                />
                            ) : (
                                <div className="rpt-empty rpt-expenses-empty-chart">
                                    {loadingExpenses
                                        ? 'Cargando…'
                                        : 'Sin gastos operativos en este período.'}
                                </div>
                            )}
                        </div>
                        <div className="rpt-expense-panel rpt-expense-panel--totals">
                            <table className="rpt-expense-table">
                                <thead>
                                    <tr>
                                        <th>Período</th>
                                        <th className="rpt-expense-table__num">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {operatingChartData.expenseBucketsOrdered.length === 0 ? (
                                        <tr>
                                            <td colSpan={2} className="rpt-expense-table__empty">
                                                Sin datos agregados.
                                            </td>
                                        </tr>
                                    ) : (
                                        operatingChartData.expenseBucketsOrdered.map((row) => (
                                            <tr key={row.key}>
                                                <td>{row.label}</td>
                                                <td className="rpt-expense-table__num rpt-expense-table__amount">
                                                    {fmt(row.total)}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
                ) : null}

                {showWithdrawalExpenseBlock ? (
                <section className="rpt-expenses-block rpt-expenses-block--withdrawals">
                    <div className="rpt-expenses-block-head">
                        <h4 className="rpt-expenses-section-title">Retiros de caja</h4>
                        <span className="rpt-expenses-block-meta">
                            {manualExpenseBreakdown.withdrawalCount} mov. ·{' '}
                            {fmt(manualExpenseBreakdown.withdrawals)}
                        </span>
                    </div>
                    <div className="rpt-expenses-split">
                        <div className="rpt-chart-wrapper rpt-chart-wrapper--rosen rpt-expenses-chart-wrap">
                            {withdrawalChartData.expenseBarPoints.length ? (
                                <RPTRosenBarChart
                                    points={withdrawalChartData.expenseBarPoints}
                                    height={220}
                                    ariaLabel="Retiros de caja por período"
                                />
                            ) : (
                                <div className="rpt-empty rpt-expenses-empty-chart">
                                    {loadingExpenses
                                        ? 'Cargando…'
                                        : 'Sin retiros de caja en este período.'}
                                </div>
                            )}
                        </div>
                        <div className="rpt-expense-panel rpt-expense-panel--totals">
                            <table className="rpt-expense-table">
                                <thead>
                                    <tr>
                                        <th>Período</th>
                                        <th className="rpt-expense-table__num">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {withdrawalChartData.expenseBucketsOrdered.length === 0 ? (
                                        <tr>
                                            <td colSpan={2} className="rpt-expense-table__empty">
                                                Sin datos agregados.
                                            </td>
                                        </tr>
                                    ) : (
                                        withdrawalChartData.expenseBucketsOrdered.map((row) => (
                                            <tr key={row.key}>
                                                <td>{row.label}</td>
                                                <td className="rpt-expense-table__num rpt-expense-table__amount">
                                                    {fmt(row.total)}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
                ) : null}
            </div>
            <div className="rpt-expenses-recent-head">
                <h4 className="rpt-expenses-section-title">Movimientos recientes</h4>
                <span className="rpt-expenses-recent-meta">Últimos 80</span>
            </div>
            <div className="rpt-expense-panel rpt-expense-panel--movements">
                <table className="rpt-expense-table rpt-expense-table--movements">
                    <thead>
                        <tr>
                            <th>Fecha</th>
                            <th>Tipo</th>
                            <th>Sucursal</th>
                            <th>Método</th>
                            <th>Detalle</th>
                            <th className="rpt-expense-table__num">Monto</th>
                        </tr>
                    </thead>
                    <tbody>
                        {!filteredManualExpenseRows || filteredManualExpenseRows.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="rpt-expense-table__empty">
                                    {loadingExpenses
                                        ? 'Cargando…'
                                        : manualExpenseRows.length || refundExpenseRows.length
                                          ? 'Sin movimientos para este filtro.'
                                          : 'Sin movimientos.'}
                                </td>
                            </tr>
                        ) : (
                            [...filteredManualExpenseRows]
                                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                                .slice(0, 80)
                                .map((row) => {
                                    const sh = row[TABLES.cash_shifts] || row.cash_shifts;
                                    const bid = sh?.branch_id;
                                    const branchName = bid != null ? (branchNameById[String(bid)] || String(bid)) : '—';
                                    const d = new Date(row.created_at);
                                    const pm = row.payment_method;
                                    const metodo =
                                        pm === 'cash'
                                            ? 'Efectivo'
                                            : pm === 'card'
                                              ? 'Tarjeta'
                                              : pm === 'online'
                                                ? 'Transf.'
                                                : String(pm || '—');
                                    const kindLabel = labelForManualExpenseKind(row);
                                    const isRefund = isOrderLinkedExpense(row);
                                    return (
                                        <tr key={row.id}>
                                            <td className="rpt-expense-table__nowrap">
                                                {d.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}
                                            </td>
                                            <td>
                                                <span
                                                    className={`rpt-expense-kind-badge${isCashWithdrawal(row) ? ' rpt-expense-kind-badge--withdrawal' : ''}${isRefund ? ' rpt-expense-kind-badge--refund' : ''}`}
                                                >
                                                    {kindLabel}
                                                </span>
                                            </td>
                                            <td>{branchName}</td>
                                            <td>{metodo}</td>
                                            <td className="rpt-expense-table__ellipsis">{row.description || '—'}</td>
                                            <td className="rpt-expense-table__num rpt-expense-table__amount">{fmt(row.amount)}</td>
                                        </tr>
                                    );
                                })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const monthlyExportBlock = (
        <div
            style={{
                marginTop: '2rem',
                padding: '1.5rem',
                background: 'rgba(255, 255, 255, 0.03)',
                borderRadius: 12,
                border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
        >
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600, color: 'var(--admin-text, #0f172a)' }}>
                Descargar Reporte Mensual
            </h3>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--admin-text-muted, #6b7280)', fontWeight: 500 }}>Seleccionar mes</label>
                    <input
                        type="month"
                        value={analyticsDate}
                        onChange={(e) => setAnalyticsDate(e.target.value)}
                        style={{
                            padding: '8px 12px',
                            background: 'rgba(0, 0, 0, 0.2)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: 6,
                            color: 'var(--admin-text, #0f172a)',
                            fontFamily: 'inherit',
                            fontSize: '0.9rem',
                            minWidth: 180,
                        }}
                    />
                </div>
                <button
                    type="button"
                    onClick={handleExportMonthlyExcel}
                    disabled={exportLoading}
                    style={{
                        padding: '10px 16px',
                        background: 'var(--accent-primary, #3b82f6)',
                        color: 'white',
                        border: 'none',
                        borderRadius: 6,
                        cursor: exportLoading ? 'not-allowed' : 'pointer',
                        opacity: exportLoading ? 0.7 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: '0.9rem',
                        fontWeight: 500,
                        transition: 'opacity 0.2s',
                    }}
                >
                    {exportLoading ? (
                        <>
                            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                            Generando...
                        </>
                    ) : (
                        <>
                            <Download size={16} />
                            Descargar Excel
                        </>
                    )}
                </button>
                <button
                    type="button"
                    onClick={handleExportMonthlyManualExpensesExcel}
                    disabled={exportExpensesLoading || !companyId}
                    style={{
                        padding: '10px 16px',
                        background: 'rgba(5, 150, 105, 0.95)',
                        color: 'white',
                        border: 'none',
                        borderRadius: 6,
                        cursor: exportExpensesLoading || !companyId ? 'not-allowed' : 'pointer',
                        opacity: exportExpensesLoading || !companyId ? 0.7 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: '0.9rem',
                        fontWeight: 500,
                    }}
                >
                    {exportExpensesLoading ? (
                        <>
                            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                            Generando...
                        </>
                    ) : (
                        <>
                            <Download size={16} />
                            Excel gastos del mes
                        </>
                    )}
                </button>
            </div>
        </div>
    );

    if (view === 'expensesOnly') {
        return (
            <div className="rpt-container rpt-container--compact-toolbar animate-fade">
                {reportPeriodHeader}
                {gastosLocalSection}
                {monthlyExportBlock}
                <LocalExpenseModal
                    isOpen={isAddExpenseModalOpen}
                    onClose={() => setIsAddExpenseModalOpen(false)}
                    branchId={selectedBranch?.id}
                    branchName={selectedBranch?.name || selectedBranch?.label}
                    activeShift={cashSystem?.activeShift}
                    onConfirmOperating={handleConfirmRegisterLocalExpense}
                    registerRefund={cashSystem.registerRefund}
                    moveOrder={moveOrder}
                    showNotify={showNotify}
                    companyId={companyId}
                    onAfterSuccess={handleAfterExpenseMovement}
                />
            </div>
        );
    }

    return (
        <div className="rpt-container rpt-container--compact-toolbar animate-fade">
            {reportPeriodHeader}

            {/* KPI ROW */}
            <div className="rpt-kpi-row">
                <div className="rpt-kpi">
                    <div className="rpt-kpi-icon sales"><DollarSign size={20} /></div>
                    <div className="rpt-kpi-body">
                        <span className="rpt-kpi-label">Ventas totales</span>
                        <span className="rpt-kpi-value">{fmt(kpis.total)}</span>
                        {loadingAnalyticsOrders && <span className="rpt-kpi-meta">Cargando pedidos…</span>}
                    </div>
                    <TrendBadge value={trends.total} />
                </div>
                <div className="rpt-kpi">
                    <div className="rpt-kpi-icon orders"><ShoppingBag size={20} /></div>
                    <div className="rpt-kpi-body">
                        <span className="rpt-kpi-label">Pedidos</span>
                        <span className="rpt-kpi-value">{kpis.count}</span>
                    </div>
                    <TrendBadge value={trends.count} />
                </div>
                <div className="rpt-kpi">
                    <div className="rpt-kpi-icon ticket"><TrendingUp size={20} /></div>
                    <div className="rpt-kpi-body">
                        <span className="rpt-kpi-label">Ticket promedio</span>
                        <span className="rpt-kpi-value">{fmt(Math.round(kpis.ticket))}</span>
                    </div>
                </div>
                <div
                    className="rpt-kpi"
                    title="Suma solo de delivery_fee (tarifa de envío) en el período. No incluye el monto de productos del pedido."
                >
                    <div className="rpt-kpi-icon delivery"><Truck size={20} aria-hidden /></div>
                    <div className="rpt-kpi-body">
                        <span className="rpt-kpi-label">Total delivery</span>
                        <span className="rpt-kpi-value">{fmt(Math.round(kpis.deliveryTotal ?? 0))}</span>
                        <span className="rpt-kpi-meta">
                            {(kpis.deliveryCount ?? 0).toLocaleString('es-CL')}{' '}
                            pedido{(kpis.deliveryCount ?? 0) === 1 ? '' : 's'} con envío · solo tarifas
                        </span>
                    </div>
                    <TrendBadge value={trends.delivery} />
                </div>
                <div className="rpt-kpi">
                    <div className="rpt-kpi-icon clients"><Users size={20} /></div>
                    <div className="rpt-kpi-body">
                        <span className="rpt-kpi-label">Nuevos clientes</span>
                        <span className="rpt-kpi-value">{newClientsInfo.count}</span>
                    </div>
                    <TrendBadge value={newClientsInfo.trend} />
                </div>
                {/* KPI EGRESOS */}
                <div className="rpt-kpi">
                    <div className="rpt-kpi-icon expenses"><Wallet size={20} /></div>
                    <div className="rpt-kpi-body">
                        <span className="rpt-kpi-label">Gastos del local</span>
                        <span className="rpt-kpi-value">{fmt(expensesData.total)}</span>
                        {loadingExpenses && <span className="rpt-kpi-meta">Cargando...</span>}
                    </div>
                    <TrendBadge value={trends.expenses} />
                </div>
                {/* KPI BALANCE NETO */}
                <div className="rpt-kpi">
                    <div className="rpt-kpi-icon balance"><Banknote size={20} /></div>
                    <div className="rpt-kpi-body">
                        <span className="rpt-kpi-label">Balance neto</span>
                        <span className="rpt-kpi-value">{fmt(kpis.net)}</span>
                    </div>
                    <TrendBadge value={trends.net} />
                </div>
            </div>

            {/* Bloque principal Reportes: ventas (gráfico + lateral). Gastos del local: menú Ventas → Gastos del local */}
            <div className="rpt-main-grid">
                <div className="rpt-chart-card">
                    <div className="rpt-chart-header">
                        <h3>Ventas por día</h3>
                        <div className="rpt-chart-toolbar">
                            <div className="rpt-chart-kind" role="group" aria-label="Tipo de gráfico">
                                {CHART_KIND_OPTIONS.map(({ value, label, Icon }) => (
                                    <button
                                        key={value}
                                        type="button"
                                        className={`rpt-chart-kind-btn ${activeChartKind === value ? 'active' : ''}`}
                                        onClick={() => setChartKind(value)}
                                        title={label}
                                        aria-pressed={activeChartKind === value}
                                        aria-label={label}
                                    >
                                        <Icon size={16} strokeWidth={1.75} aria-hidden />
                                        <span className="rpt-chart-kind-label">{label}</span>
                                    </button>
                                ))}
                            </div>
                            <div className="rpt-chart-tabs">
                                {[['all', 'Todos'], ['store', 'Tienda'], ['online', 'Online']].map(([key, label]) => (
                                    <button key={key} className={`rpt-tab ${chartTab === key ? 'active' : ''}`} onClick={() => setChartTab(key)}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="rpt-chart-wrapper rpt-chart-wrapper--rosen">
                        {salesChartPoints.length ? (
                            <RPTRosenSalesChart
                                points={salesChartPoints}
                                variant={activeChartKind}
                                height={days > 90 ? 260 : 280}
                                showExpenses
                            />
                        ) : (
                            <div className="rpt-empty" style={{ padding: '3rem', textAlign: 'center' }}>
                                Sin datos de ventas
                            </div>
                        )}
                    </div>
                </div>

                {/* SIDEBAR */}
                <div className="rpt-sidebar">
                    {/* Payment Breakdown */}
                    <div className="rpt-side-card">
                        <h4><AdminIconSlot Icon={CreditCard} slotSize="xs" tone="accent" /> Métodos de pago</h4>
                        <div style={{ marginBottom: '1.25rem', marginTop: '0.5rem', display: 'flex', justifyContent: 'center' }}>
                            <RPTRosenDonutChart
                                data={[
                                    { label: 'Efectivo', value: paymentBreakdown.cash, color: '#22c55e' },
                                    { label: 'Tarjeta', value: paymentBreakdown.card, color: '#3b82f6' },
                                    { label: 'Pago online', value: paymentBreakdown.online, color: '#a855f7' },
                                ]}
                                height={150}
                            />
                        </div>
                        <div className="rpt-payment-list">
                            {[
                                { label: 'Efectivo', value: paymentBreakdown.cash, Icon: DollarSign, color: '#22c55e' },
                                { label: 'Tarjeta', value: paymentBreakdown.card, Icon: CreditCard, color: '#3b82f6' },
                                { label: 'Pago online', value: paymentBreakdown.online, Icon: Smartphone, color: '#a855f7' },
                            ].map(pm => {
                                const pct = kpis.total > 0 ? Math.round((pm.value / kpis.total) * 100) : 0;
                                return (
                                    <div key={pm.label} className="rpt-payment-row">
                                        <div className="rpt-payment-info">
                                            <AdminIconSlot
                                                Icon={pm.Icon}
                                                slotSize="xxs"
                                                size={12}
                                                style={{
                                                    color: pm.color,
                                                    background: `color-mix(in srgb, ${pm.color} 14%, var(--admin-card-bg, #fff))`,
                                                    borderColor: `color-mix(in srgb, ${pm.color} 32%, var(--admin-border, #e8ecf1))`,
                                                }}
                                            />
                                            <span>{pm.label}</span>
                                        </div>
                                        <div className="rpt-payment-bar-wrap">
                                            <div className="rpt-payment-bar" style={{ width: `${pct}%`, background: pm.color }} />
                                        </div>
                                        <div className="rpt-payment-values">
                                            <strong>{fmt(pm.value)}</strong>
                                            <span>{pct}%</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Peak Hour */}
                    {peakHour && (
                        <div className="rpt-side-card rpt-peak">
                            <h4><AdminIconSlot Icon={Clock} slotSize="xs" tone="accent" /> Hora pico</h4>
                            <div className="rpt-peak-value">{peakHour.hour}</div>
                            <div className="rpt-peak-sub">{peakHour.count} pedidos en este horario</div>
                        </div>
                    )}

                    {/* Quick Stats */}
                    <div className="rpt-side-card">
                        <h4><AdminIconSlot Icon={Users} slotSize="xs" tone="accent" /> Clientes</h4>
                        <div className="rpt-quick-stats">
                            <div className="rpt-quick-stat">
                                <span className="rpt-quick-label">Total registrados</span>
                                <span className="rpt-quick-value">{newClientsInfo.total}</span>
                            </div>
                            <div className="rpt-quick-stat">
                                <span className="rpt-quick-label">Nuevos ({filterPeriod === 'all' ? 'total' : `${days}d`})</span>
                                <span className="rpt-quick-value">{newClientsInfo.count}</span>
                            </div>
                        </div>
                    </div>

                    {/* Branch Breakdown */}
                    {branchStats.length > 0 && (
                        <div className="rpt-side-card">
                            <h4><AdminIconSlot Icon={MapPin} slotSize="xs" tone="accent" /> Ventas por Sucursal</h4>
                            <div className="rpt-payment-list">
                                {branchStats.map(b => {
                                    const pct = kpis.total > 0 ? Math.round((b.total / kpis.total) * 100) : 0;
                                    return (
                                        <div key={b.id} className="rpt-payment-row">
                                            <div className="rpt-payment-info" style={{flex: 1}}>
                                                <span style={{fontSize: '0.85rem'}}>{b.name}</span>
                                            </div>
                                            <div className="rpt-payment-values" style={{textAlign: 'right'}}>
                                                <strong>{fmt(b.total)}</strong>
                                                <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-muted, #5a6169)', marginLeft: 6 }}>{pct}%</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* TOP PRODUCTS */}
            <div className="rpt-products-card">
                <h3><AdminIconSlot Icon={Package} slotSize="sm" tone="accent" /> Top productos vendidos</h3>
                {topProducts.length === 0 ? (
                    <div className="rpt-empty">No hay datos de productos en este período.</div>
                ) : (
                    <div className="rpt-products-list">
                        {topProducts.map((p, i) => {
                            const maxQty = topProducts[0]?.qty || 1;
                            const pct = Math.round((p.qty / maxQty) * 100);
                            return (
                                <div key={p.name} className="rpt-product-row">
                                    <span className="rpt-product-rank">#{i + 1}</span>
                                    <div className="rpt-product-info">
                                        <span className="rpt-product-name">{p.name}</span>
                                        <div className="rpt-product-bar-wrap">
                                            <div className="rpt-product-bar" style={{ width: `${pct}%` }} />
                                        </div>
                                    </div>
                                    <div className="rpt-product-stats">
                                        <span className="rpt-product-qty">{p.qty} uds</span>
                                        <span className="rpt-product-rev">{fmt(p.revenue)}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {monthlyExportBlock}
            <LocalExpenseModal
                isOpen={isAddExpenseModalOpen}
                onClose={() => setIsAddExpenseModalOpen(false)}
                branchId={selectedBranch?.id}
                branchName={selectedBranch?.name || selectedBranch?.label}
                activeShift={cashSystem?.activeShift}
                onConfirmOperating={handleConfirmRegisterLocalExpense}
                registerRefund={cashSystem.registerRefund}
                moveOrder={moveOrder}
                showNotify={showNotify}
                companyId={companyId}
                onAfterSuccess={handleAfterExpenseMovement}
            />
        </div>
    );
};

export default AdminAnalytics;
