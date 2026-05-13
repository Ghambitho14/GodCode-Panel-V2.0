import React, { useEffect, useMemo, useState } from 'react';
import {
    Chart as ChartJS,
    CategoryScale, LinearScale, PointElement, LineElement, BarElement,
    Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import {
    ArrowUpRight, ArrowDownRight, Calendar,
    ShoppingBag, Users, DollarSign, CreditCard,
    Smartphone, TrendingUp, Package, Clock, MapPin, Truck,
    BarChart3, AreaChart, Wallet, Banknote, Download, Loader2
} from 'lucide-react';
import { supabase, TABLES } from '@/integrations/supabase';
import AdminIconSlot from './AdminIconSlot';
import AdminMenuSelect from './AdminMenuSelect';
import { formatCurrency } from '@/shared/utils/formatters';
import { isOnlineOrder, getPaymentSlug, getPaymentLabel } from '@/shared/utils/orderUtils';
import { downloadExcel } from '@/shared/utils/exportUtils';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler);

const CHART_KIND_OPTIONS = [
    { value: 'area', label: 'Área', Icon: AreaChart },
    { value: 'bar', label: 'Barras', Icon: BarChart3 },
];

const RPT_PERIOD_OPTIONS = [
    { value: '7', label: '7 días' },
    { value: '15', label: '15 días' },
    { value: '30', label: '30 días' },
    { value: '90', label: '3 meses' },
    { value: 'all', label: 'Todo' },
];

const fmt = (n) => {
    try { return formatCurrency(n); } catch { return `$${(n || 0).toLocaleString('es-CL')}`; }
};


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

/** `orders` desde el panel sigue limitado a 100 filas (kanban). Los KPIs usan fetch propio vía `analyticsOrders`. */
const AdminAnalytics = ({ orders, clients, branches, showNotify, companyId, selectedBranch }) => {
    const [filterPeriod, setFilterPeriod] = useState('7');
    const [chartTab, setChartTab] = useState('all');
    const [chartKind, setChartKind] = useState('area');
    const [expensesData, setExpensesData] = useState({ total: 0, prevTotal: 0 });
    const [loadingExpenses, setLoadingExpenses] = useState(false);
    const [analyticsDate, setAnalyticsDate] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const [exportLoading, setExportLoading] = useState(false);
    /** Pedidos del rango para KPIs/gráficos (no el slice de 100 del provider). */
    const [analyticsOrders, setAnalyticsOrders] = useState([]);
    const [loadingAnalyticsOrders, setLoadingAnalyticsOrders] = useState(false);

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

    const getMonthRangeUtc = (yyyyMm) => {
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
    };

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
     * Egresos de caja para analytics: solo movimientos `expense` manuales
     * (`order_id` nulo). Las devoluciones de pedido usan el mismo tipo pero
     * llevan `order_id` y no deben duplicarse con ventas ya excluidas por cancelación.
     */
    useEffect(() => {
        const fetchExpenses = async () => {
            setLoadingExpenses(true);
            try {
                const now = new Date();
                const cutoff = new Date(now);
                cutoff.setDate(now.getDate() - days);

                const prevCutoff = new Date(cutoff);
                prevCutoff.setDate(prevCutoff.getDate() - days);

                const baseExpenseQuery = () => {
                    let q = supabase
                        .from(TABLES.cash_movements)
                        .select(`amount, created_at, ${TABLES.cash_shifts}!inner(branch_id, company_id)`)
                        .eq('type', 'expense')
                        .is('order_id', null);
                    if (companyId) {
                        q = q.eq(`${TABLES.cash_shifts}.company_id`, companyId);
                    }
                    if (selectedBranch?.id && selectedBranch.id !== 'all') {
                        q = q.eq(`${TABLES.cash_shifts}.branch_id`, selectedBranch.id);
                    }
                    return q;
                };

                const { data: currentMovements, error: currentError } = await baseExpenseQuery().gte(
                    'created_at',
                    cutoff.toISOString(),
                );

                if (currentError) throw currentError;

                let prevMovements = [];
                if (filterPeriod !== 'all') {
                    const { data: prevData, error: prevError } = await baseExpenseQuery()
                        .gte('created_at', prevCutoff.toISOString())
                        .lt('created_at', cutoff.toISOString());
                    if (prevError) throw prevError;
                    prevMovements = prevData || [];
                }

                const total = (currentMovements || []).reduce((acc, m) => acc + (Number(m.amount) || 0), 0);
                const prevTotal = (prevMovements || []).reduce((acc, m) => acc + (Number(m.amount) || 0), 0);

                setExpensesData({ total, prevTotal });
            } catch (err) {
                console.error('Error fetching expenses for analytics:', err);
                setExpensesData({ total: 0, prevTotal: 0 });
            } finally {
                setLoadingExpenses(false);
            }
        };

        fetchExpenses();
    }, [days, filterPeriod, companyId, selectedBranch?.id]);

    // --- CORE DATA ---
    const { chartData, kpis, trends, paymentBreakdown, branchStats } = useMemo(() => {
        if (!ordersForAnalytics || ordersForAnalytics.length === 0) {
            return {
                chartData: { labels: [], datasets: [] },
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
            if (chartTab === 'online') return isOnlineOrder(o);
            if (chartTab === 'store') return !isOnlineOrder(o);
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

        // --- CHART DATA ---
        const salesByDate = {};
        const labels = [];
        
        // Inicializar días
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date();
            d.setDate(now.getDate() - i);
            // [FIX] Usar fecha LOCAL para la clave, no UTC, para alinear con lo que ve el usuario
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const key = `${year}-${month}-${day}`;
            
            labels.push(d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }));
            salesByDate[key] = 0;
        }

        current.forEach(o => {
            // [FIX] Convertir created_at (UTC) a fecha local del navegador para agrupar correctamente
            const localDate = new Date(o.created_at).toLocaleDateString('en-CA'); // YYYY-MM-DD local
            if (salesByDate[localDate] !== undefined) {
                salesByDate[localDate] += Number(o.total);
            }
        });

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
            chartData: {
                labels,
                datasets: [{
                    label: 'Ventas',
                    data: Object.values(salesByDate),
                    borderColor: '#e63946',
                    backgroundColor: 'rgba(230, 57, 70, 0.08)',
                    tension: 0.4,
                    fill: true,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: '#e63946',
                    pointBorderWidth: 2,
                    pointRadius: days > 30 ? 0 : 3,
                    pointHoverRadius: 5,
                }],
            },
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
    }, [ordersForAnalytics, filterPeriod, chartTab, days, branches, expensesData]);

    const chartRenderData = useMemo(() => {
        const base = chartData;
        if (!base.labels?.length || !base.datasets?.[0]) return base;
        const src = base.datasets[0];
        const labels = base.labels;
        const data = src.data;
        const pr = days > 30 ? 0 : 3;
        const kind = chartKind === 'bar' ? 'bar' : 'area';

        if (kind === 'bar') {
            return {
                labels,
                datasets: [{
                    label: 'Ventas',
                    data,
                    backgroundColor: 'rgba(230, 57, 70, 0.72)',
                    borderColor: 'rgba(230, 57, 70, 0.95)',
                    borderWidth: 0,
                    borderRadius: 6,
                    borderSkipped: false,
                }],
            };
        }

        /* Área: línea curva + relleno (sin escalones; dataset explícito para no arrastrar props raras) */
        return {
            labels,
            datasets: [{
                label: 'Ventas',
                data,
                fill: true,
                tension: 0.4,
                stepped: false,
                borderWidth: 2,
                borderColor: '#e63946',
                backgroundColor: 'rgba(230, 57, 70, 0.14)',
                pointBackgroundColor: '#fff',
                pointBorderColor: '#e63946',
                pointBorderWidth: 2,
                pointRadius: pr,
                pointHoverRadius: 5,
            }],
        };
    }, [chartData, chartKind, days]);

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


    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: 'rgba(0,0,0,0.85)', padding: 12, cornerRadius: 10,
                titleFont: { size: 13, weight: '600' }, bodyFont: { size: 13 },
                displayColors: false,
                callbacks: { label: (ctx) => fmt(ctx.raw) }
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
                ticks: { color: '#666', font: { size: 11 }, callback: (v) => v >= 1000 ? `$${v / 1000}k` : `$${v}` },
                border: { display: false },
            },
            x: {
                grid: { display: false },
                ticks: { color: '#4b5563', font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 },
                border: { display: false }
            }
        }
    };

    const activeChartKind = chartKind === 'bar' ? 'bar' : 'area';

    return (
        <div className="rpt-container rpt-container--compact-toolbar animate-fade">
            {/* HEADER */}
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
                        <span className="rpt-kpi-label">Egresos totales</span>
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

            {/* CHART + SIDEBAR */}
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
                    <div className="rpt-chart-wrapper">
                        {activeChartKind === 'bar' ? (
                            <Bar data={chartRenderData} options={chartOptions} />
                        ) : (
                            <Line data={chartRenderData} options={chartOptions} />
                        )}
                    </div>
                </div>

                {/* SIDEBAR */}
                <div className="rpt-sidebar">
                    {/* Payment Breakdown */}
                    <div className="rpt-side-card">
                        <h4><AdminIconSlot Icon={CreditCard} slotSize="xs" tone="accent" /> Métodos de pago</h4>
                        <div className="rpt-payment-list">
                            {[
                                { label: 'Efectivo', value: paymentBreakdown.cash, Icon: DollarSign, color: '#22c55e' },
                                { label: 'Tarjeta', value: paymentBreakdown.card, Icon: CreditCard, color: '#3b82f6' },
                                { label: 'Transferencia', value: paymentBreakdown.online, Icon: Smartphone, color: '#a855f7' },
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

            {/* MONTHLY EXPORT SECTION */}
            <div style={{ marginTop: '2rem', padding: '1.5rem', background: 'rgba(255, 255, 255, 0.03)', borderRadius: 12, border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600, color: 'var(--admin-text, #0f172a)' }}>Descargar Reporte Mensual</h3>
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
                                minWidth: 180
                            }}
                        />
                    </div>
                    <button
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
                            transition: 'opacity 0.2s'
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
                </div>
            </div>
        </div>
    );
};

export default AdminAnalytics;
