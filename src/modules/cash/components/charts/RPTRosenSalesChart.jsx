import React, { useMemo, useState } from 'react';
import {
    scaleBand,
    scaleLinear,
    max,
    min,
    line as d3Line,
    area as d3Area,
    curveMonotoneX,
} from 'd3';
import { formatCurrency } from '@/shared/utils/formatters';

function fmtAxis(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
    return String(Math.round(v));
}

function fmtTooltip(n) {
    try {
        return formatCurrency(n);
    } catch {
        return `$${Number(n || 0).toLocaleString('es-CL')}`;
    }
}

/** Sin hueco entre sub-barras del grupo (estilo Rosen Multi Bars). */
const PX_BETWEEN_GROUPED_BARS = 0;

/**
 * Gráfico ventas + gastos inspirado en Rosen Charts (bar-charts/14_BarChartLine).
 * @param {{ key: string, label: string, sales: number, expenses: number }[]} props.points
 * @param {'area' | 'bar-solid' | 'bar-gradient'} props.variant
 */
export default function RPTRosenSalesChart({
    points = [],
    variant = 'bar-gradient',
    height = 280,
    showExpenses = true,
}) {
    const [hoverKey, setHoverKey] = useState(null);

    const data = useMemo(
        () => (points || []).filter((p) => p && p.key),
        [points]
    );

    const hasExpenses = showExpenses && data.some((d) => (d.expenses || 0) > 0);
    /** Solo "Barras": doble barra. "Barras degradado" y "Área": barras/área + línea de gastos. */
    const isGroupedBars = hasExpenses && variant === 'bar-solid';

    const chart = useMemo(() => {
        if (!data.length) return null;

        const maxSales = max(data, (d) => d.sales) ?? 0;
        const maxExpenses = max(data, (d) => d.expenses) ?? 0;
        const minExpenses = min(data, (d) => d.expenses) ?? 0;

        const xScale = scaleBand()
            .domain(data.map((d) => d.key))
            .range([0, 100])
            .padding(
                isGroupedBars
                    ? data.length > 20
                        ? 0.35
                        : 0.4
                    : data.length > 45
                      ? 0.08
                      : data.length > 20
                        ? 0.18
                        : 0.3,
            );

        const groupedMax = isGroupedBars
            ? max(data.flatMap((d) => [d.sales, d.expenses])) ?? 0
            : 0;

        const ySales = scaleLinear()
            .domain([0, isGroupedBars ? groupedMax || 1 : maxSales || 1])
            .nice()
            .range([100, 0]);

        const yExpenses =
            hasExpenses && maxExpenses > 0 && !isGroupedBars
                ? scaleLinear()
                      .domain([Math.min(0, minExpenses), maxExpenses])
                      .nice()
                      .range([100, 0])
                : null;

        const lineExpenses =
            hasExpenses && !isGroupedBars && yExpenses
                ? d3Line()
                      .x((d) => {
                          const x = xScale(d.key) ?? 0;
                          return x + (xScale.bandwidth() ?? 0) / 2;
                      })
                      .y((d) => yExpenses(d.expenses))
                      .curve(curveMonotoneX)
                : null;

        const areaSales =
            variant === 'area'
                ? d3Area()
                      .x((d) => {
                          const x = xScale(d.key) ?? 0;
                          return x + (xScale.bandwidth() ?? 0) / 2;
                      })
                      .y0(() => ySales(0))
                      .y1((d) => ySales(d.sales))
                      .curve(curveMonotoneX)
                : null;

        const lineSales =
            variant === 'area'
                ? d3Line()
                      .x((d) => {
                          const x = xScale(d.key) ?? 0;
                          return x + (xScale.bandwidth() ?? 0) / 2;
                      })
                      .y((d) => ySales(d.sales))
                      .curve(curveMonotoneX)
                : null;

        return {
            xScale,
            ySales,
            yExpenses,
            expensesPath: lineExpenses ? lineExpenses(data) : null,
            salesAreaPath: areaSales ? areaSales(data) : null,
            salesLinePath: lineSales ? lineSales(data) : null,
            salesTicks: ySales.ticks(6),
            expenseTicks: yExpenses ? yExpenses.ticks(6) : [],
            isGroupedBars,
            groupedBarCount: isGroupedBars ? 2 : 1,
        };
    }, [data, hasExpenses, isGroupedBars, variant]);

    if (!data.length || !chart) return null;

    const hovered = hoverKey ? data.find((d) => d.key === hoverKey) : null;
    const labelStep = data.length > 20 ? Math.ceil(data.length / 12) : data.length > 12 ? 2 : 1;

    const renderGroupedBars = () => {
        const numBars = chart.groupedBarCount;
        return (
            <div className="rpt-rosen-chart__bars rpt-rosen-chart__bars--grouped">
                {data.map((d) => {
                    const values = [d.sales, d.expenses];
                    const innerBarWidth =
                        (100 - PX_BETWEEN_GROUPED_BARS * (numBars - 1)) / numBars;
                    return (
                        <div
                            key={d.key}
                            className="rpt-rosen-chart__bar-group"
                            style={{
                                left: `${chart.xScale(d.key)}%`,
                                width: `${chart.xScale.bandwidth()}%`,
                            }}
                        >
                            {values.map((value, barIndex) => {
                                const barHeight = chart.ySales(0) - chart.ySales(value);
                                const barX = barIndex * (innerBarWidth + PX_BETWEEN_GROUPED_BARS);
                                const barClass =
                                    barIndex === 0
                                        ? 'rpt-rosen-chart__bar rpt-rosen-chart__bar--multi-sales'
                                        : 'rpt-rosen-chart__bar rpt-rosen-chart__bar--multi-expenses';
                                return (
                                    <div
                                        key={barIndex}
                                        className={barClass}
                                        style={{
                                            left: `${barX}%`,
                                            width: `${innerBarWidth}%`,
                                            height: `${barHeight}%`,
                                        }}
                                    />
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        );
    };

    const variantClass =
        variant === 'area'
            ? 'rpt-rosen-chart--area'
            : variant === 'bar-gradient'
              ? 'rpt-rosen-chart--bar-gradient'
              : 'rpt-rosen-chart--bar-solid';

    return (
        <div
            className={`rpt-rosen-chart ${variantClass}${isGroupedBars ? ' rpt-rosen-chart--multi-bar' : ''}`}
            style={{ height }}
            role="img"
            aria-label="Gráfico de ventas y gastos por día"
        >
            <div className="rpt-rosen-chart__legend">
                <span className="rpt-rosen-chart__legend-item rpt-rosen-chart__legend-item--sales">
                    Ventas
                </span>
                {hasExpenses ? (
                    <span className="rpt-rosen-chart__legend-item rpt-rosen-chart__legend-item--expenses">
                        Gastos
                    </span>
                ) : null}
            </div>

            <div className="rpt-rosen-chart__axis rpt-rosen-chart__axis--left">
                {chart.salesTicks.map((value) => (
                    <span
                        key={`s-${value}`}
                        className="rpt-rosen-chart__tick"
                        style={{ top: `${chart.ySales(value)}%` }}
                    >
                        {fmtAxis(value)}
                    </span>
                ))}
            </div>

            {hasExpenses && !isGroupedBars ? (
                <div className="rpt-rosen-chart__axis rpt-rosen-chart__axis--right">
                    {chart.expenseTicks.map((value) => (
                        <span
                            key={`e-${value}`}
                            className="rpt-rosen-chart__tick rpt-rosen-chart__tick--expenses"
                            style={{ top: `${chart.yExpenses(value)}%` }}
                        >
                            {fmtAxis(value)}
                        </span>
                    ))}
                </div>
            ) : null}

            <div className="rpt-rosen-chart__plot">
                <svg
                    className="rpt-rosen-chart__grid"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden
                >
                    {chart.salesTicks.map((value) => (
                        <line
                            key={`g-${value}`}
                            x1={0}
                            x2={100}
                            y1={chart.ySales(value)}
                            y2={chart.ySales(value)}
                            vectorEffect="non-scaling-stroke"
                        />
                    ))}
                </svg>

                {variant === 'area' ? (
                    <svg
                        className="rpt-rosen-chart__area-layer"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        aria-hidden
                    >
                        {chart.salesAreaPath ? (
                            <path d={chart.salesAreaPath} className="rpt-rosen-chart__area-fill" />
                        ) : null}
                        {chart.salesLinePath ? (
                            <path
                                d={chart.salesLinePath}
                                className="rpt-rosen-chart__area-line"
                                fill="none"
                                vectorEffect="non-scaling-stroke"
                            />
                        ) : null}
                    </svg>
                ) : isGroupedBars ? (
                    renderGroupedBars()
                ) : (
                    <div className="rpt-rosen-chart__bars">
                        {data.map((d) => {
                            const barWidth = chart.xScale.bandwidth();
                            const barHeight = chart.ySales(0) - chart.ySales(d.sales);
                            const barClass =
                                variant === 'bar-gradient'
                                    ? 'rpt-rosen-chart__bar rpt-rosen-chart__bar--gradient'
                                    : 'rpt-rosen-chart__bar rpt-rosen-chart__bar--solid';
                            return (
                                <div
                                    key={d.key}
                                    className={barClass}
                                    style={{
                                        width: `${barWidth}%`,
                                        height: `${barHeight}%`,
                                        marginLeft: `${chart.xScale(d.key)}%`,
                                    }}
                                />
                            );
                        })}
                    </div>
                )}

                {hasExpenses && chart.expensesPath && !isGroupedBars ? (
                    <svg
                        className="rpt-rosen-chart__line-layer"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        aria-hidden
                    >
                        <path
                            d={chart.expensesPath}
                            className="rpt-rosen-chart__expenses-line"
                            fill="none"
                            vectorEffect="non-scaling-stroke"
                        />
                    </svg>
                ) : null}

                <div className="rpt-rosen-chart__hits">
                    {data.map((d) => {
                        const barWidth = chart.xScale.bandwidth();
                        return (
                            <button
                                key={d.key}
                                type="button"
                                className="rpt-rosen-chart__hit"
                                style={{
                                    width: `${barWidth}%`,
                                    marginLeft: `${chart.xScale(d.key)}%`,
                                }}
                                onMouseEnter={() => setHoverKey(d.key)}
                                onMouseLeave={() => setHoverKey(null)}
                                onFocus={() => setHoverKey(d.key)}
                                onBlur={() => setHoverKey(null)}
                                aria-label={`${d.label}: ventas ${fmtTooltip(d.sales)}${
                                    hasExpenses ? `, gastos ${fmtTooltip(d.expenses)}` : ''
                                }`}
                            />
                        );
                    })}
                </div>

                <div className="rpt-rosen-chart__labels">
                    {data.map((d, i) => {
                        if (i % labelStep !== 0 && i !== data.length - 1) return null;
                        const x = chart.xScale(d.key) + chart.xScale.bandwidth() / 2;
                        const rotateLabels = isGroupedBars && data.length > 10;
                        return (
                            <span
                                key={d.key}
                                className={`rpt-rosen-chart__x-label${rotateLabels ? ' rpt-rosen-chart__x-label--rotated' : ''}`}
                                style={{ left: `${x}%` }}
                            >
                                {d.label}
                            </span>
                        );
                    })}
                </div>

                {hovered ? (
                    <div
                        className="rpt-rosen-chart__tooltip"
                        style={{
                            left: `${chart.xScale(hovered.key) + chart.xScale.bandwidth() / 2}%`,
                        }}
                    >
                        <div className="rpt-rosen-chart__tooltip-date">{hovered.label}</div>
                        <div className="rpt-rosen-chart__tooltip-row">
                            <span className="rpt-rosen-chart__swatch rpt-rosen-chart__swatch--sales" />
                            {fmtTooltip(hovered.sales)}
                        </div>
                        {hasExpenses ? (
                            <div className="rpt-rosen-chart__tooltip-row">
                                <span className="rpt-rosen-chart__swatch rpt-rosen-chart__swatch--expenses" />
                                {fmtTooltip(hovered.expenses)}
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
