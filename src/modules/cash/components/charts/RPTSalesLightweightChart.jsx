import React, { useEffect, useMemo, useRef } from 'react';
import {
    createChart,
    AreaSeries,
    HistogramSeries,
    LineSeries,
} from 'lightweight-charts';
import {
    attachResizeObserver,
    buildAreaColors,
    buildHistogramColor,
    createDashboardChartOptions,
    readAccentColor,
} from './rptLightweightChartShared';

const EXPENSES_LINE_COLOR = '#64748b';

/**
 * Ventas por día — Lightweight Charts (área o histograma + línea de gastos).
 * @param {{ key: string, label: string, sales: number, expenses: number }[]} props.points
 * @param {'area' | 'bar-solid' | 'bar-gradient'} props.variant
 */
export default function RPTSalesLightweightChart({
    points = [],
    variant = 'bar-gradient',
    height = 280,
    showExpenses = true,
}) {
    const hostRef = useRef(null);

    const data = useMemo(
        () => (points || []).filter((p) => p && p.key),
        [points],
    );

    const salesData = useMemo(
        () =>
            data.map((p) => ({
                time: p.key,
                value: Math.max(0, Number(p.sales) || 0),
            })),
        [data],
    );

    const expensesData = useMemo(
        () =>
            data.map((p) => ({
                time: p.key,
                value: Math.max(0, Number(p.expenses) || 0),
            })),
        [data],
    );

    const hasExpenses =
        showExpenses && expensesData.some((d) => d.value > 0);

    useEffect(() => {
        const el = hostRef.current;
        if (!el || salesData.length === 0) {
            return undefined;
        }

        const accent = readAccentColor();
        const w = Math.max(1, el.clientWidth || el.offsetWidth || 320);

        const chart = createChart(
            el,
            createDashboardChartOptions({
                width: w,
                height,
                showRightScale: hasExpenses,
            }),
        );

        const isArea = variant === 'area';
        const areaColors = buildAreaColors(accent);

        if (isArea) {
            const salesSeries = chart.addSeries(AreaSeries, {
                priceScaleId: 'left',
                lineColor: areaColors.lineColor,
                topColor: areaColors.topColor,
                bottomColor: areaColors.bottomColor,
                lineWidth: 2,
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: salesData.length > 60 ? 3 : 5,
                priceFormat: { type: 'price', precision: 0, minMove: 1 },
            });
            salesSeries.setData(salesData);
        } else {
            const salesSeries = chart.addSeries(HistogramSeries, {
                priceScaleId: 'left',
                color: buildHistogramColor(accent, variant),
                priceFormat: { type: 'price', precision: 0, minMove: 1 },
            });
            salesSeries.setData(salesData);
        }

        if (hasExpenses) {
            const expensesSeries = chart.addSeries(LineSeries, {
                priceScaleId: 'right',
                color: EXPENSES_LINE_COLOR,
                lineWidth: 2,
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: 4,
                priceFormat: { type: 'price', precision: 0, minMove: 1 },
            });
            expensesSeries.setData(expensesData);
        }

        chart.timeScale().fitContent();

        const ro = attachResizeObserver(el, chart, height);

        return () => {
            ro.disconnect();
            chart.remove();
        };
    }, [salesData, expensesData, variant, height, hasExpenses]);

    if (!data.length) return null;

    return (
        <div className="rpt-sales-lwc" style={{ height }}>
            <div className="rpt-sales-lwc__legend" aria-hidden>
                <span className="rpt-sales-lwc__legend-item rpt-sales-lwc__legend-item--sales">
                    Ventas
                </span>
                {hasExpenses ? (
                    <span className="rpt-sales-lwc__legend-item rpt-sales-lwc__legend-item--expenses">
                        Gastos
                    </span>
                ) : null}
            </div>
            <div ref={hostRef} className="rpt-lwc-host rpt-sales-lwc__canvas" />
        </div>
    );
}
