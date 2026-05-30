import React, { useMemo, useState } from 'react';
import { scaleBand, scaleLinear, max } from 'd3';
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

/**
 * Barras verticales Rosen — una sola serie (p. ej. gastos del local).
 * @param {{ key: string, label: string, value: number }[]} props.points
 */
export default function RPTRosenBarChart({ points = [], height = 220, ariaLabel = 'Gráfico de barras' }) {
    const [hoverKey, setHoverKey] = useState(null);

    const data = useMemo(
        () => (points || []).filter((p) => p && p.key),
        [points],
    );

    const chart = useMemo(() => {
        if (!data.length) return null;

        const maxValue = max(data, (d) => d.value) ?? 0;

        const xScale = scaleBand()
            .domain(data.map((d) => d.key))
            .range([0, 100])
            .padding(data.length > 45 ? 0.28 : data.length > 20 ? 0.38 : 0.52);

        const yScale = scaleLinear()
            .domain([0, maxValue || 1])
            .nice()
            .range([100, 0]);

        return {
            xScale,
            yScale,
            ticks: yScale.ticks(6),
        };
    }, [data]);

    if (!data.length || !chart) return null;

    const hovered = hoverKey ? data.find((d) => d.key === hoverKey) : null;
    const labelStep = data.length > 20 ? Math.ceil(data.length / 10) : data.length > 12 ? 2 : 1;

    return (
        <div
            className={`rpt-rosen-chart rpt-rosen-chart--single-bar${hoverKey ? ' has-hovered' : ''}`}
            style={{ height }}
            role="img"
            aria-label={ariaLabel}
        >
            <div className="rpt-rosen-chart__axis rpt-rosen-chart__axis--left">
                {chart.ticks.map((value) => (
                    <span
                        key={`y-${value}`}
                        className="rpt-rosen-chart__tick"
                        style={{ top: `${chart.yScale(value)}%` }}
                    >
                        {fmtAxis(value)}
                    </span>
                ))}
            </div>

            <div className="rpt-rosen-chart__plot">
                <svg
                    className="rpt-rosen-chart__grid"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden
                >
                    {chart.ticks.map((value) => (
                        <line
                            key={`g-${value}`}
                            x1={0}
                            x2={100}
                            y1={chart.yScale(value)}
                            y2={chart.yScale(value)}
                            vectorEffect="non-scaling-stroke"
                        />
                    ))}
                </svg>

                <div className="rpt-rosen-chart__bars">
                    {data.map((d) => {
                        const barWidth = chart.xScale.bandwidth();
                        const barHeight = chart.yScale(0) - chart.yScale(d.value);
                        const isBarHovered = hoverKey === d.key;
                        return (
                            <div
                                key={d.key}
                                className={`rpt-rosen-chart__bar rpt-rosen-chart__bar--solid${isBarHovered ? ' is-hovered' : ''}`}
                                style={{
                                    width: `${barWidth}%`,
                                    height: `${barHeight}%`,
                                    marginLeft: `${chart.xScale(d.key)}%`,
                                }}
                            />
                        );
                    })}
                </div>

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
                                aria-label={`${d.label}: ${fmtTooltip(d.value)}`}
                            />
                        );
                    })}
                </div>

                <div className="rpt-rosen-chart__labels">
                    {data.map((d, i) => {
                        if (i % labelStep !== 0 && i !== data.length - 1) return null;
                        const x = chart.xScale(d.key) + chart.xScale.bandwidth() / 2;
                        return (
                            <span
                                key={d.key}
                                className={`rpt-rosen-chart__x-label${data.length > 10 ? ' rpt-rosen-chart__x-label--rotated' : ''}`}
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
                            {fmtTooltip(hovered.value)}
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
