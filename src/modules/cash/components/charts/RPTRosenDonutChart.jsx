import React, { useMemo, useState } from 'react';
import { pie as d3Pie, arc as d3Arc } from 'd3';
import { formatCurrency } from '@/shared/utils/formatters';

/**
 * Gráfico interactivo tipo Donut para el desglose de métodos de pago.
 * @param {{ label: string, value: number, color: string }[]} props.data
 */
export default function RPTRosenDonutChart({ data = [], height = 180 }) {
    const [hoverIndex, setHoverIndex] = useState(null);

    const chartData = useMemo(() => {
        return (data || []).filter((d) => d && d.value > 0);
    }, [data]);

    const total = useMemo(() => {
        return chartData.reduce((acc, curr) => acc + (curr.value || 0), 0);
    }, [chartData]);

    const arcs = useMemo(() => {
        const pieGenerator = d3Pie()
            .value((d) => d.value)
            .sort(null);
        return pieGenerator(chartData);
    }, [chartData]);

    const innerRadius = 54;
    const outerRadius = 75;
    const hoverOuterRadius = 81;

    const arcGenerator = (d, isHovered) => {
        const generator = d3Arc()
            .innerRadius(innerRadius)
            .outerRadius(isHovered ? hoverOuterRadius : outerRadius)
            .cornerRadius(4)
            .padAngle(0.04);
        return generator(d);
    };

    if (total === 0) {
        return (
            <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--admin-text-muted, #64748b)', fontSize: '0.85rem' }}>
                Sin datos de pagos
            </div>
        );
    }

    const hoveredData = hoverIndex !== null ? chartData[hoverIndex] : null;

    const fmtVal = (val) => {
        try {
            return formatCurrency(val);
        } catch {
            return `$${val.toLocaleString('es-CL')}`;
        }
    };

    return (
        <div className="rpt-donut-chart-container" style={{ height, position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <svg width={height} height={height} viewBox="-90 -90 180 180" style={{ overflow: 'visible' }}>
                <g>
                    {arcs.map((arc, index) => {
                        const isHovered = hoverIndex === index;
                        return (
                            <path
                                key={index}
                                d={arcGenerator(arc, isHovered)}
                                fill={arc.data.color}
                                style={{
                                    transition: 'all 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
                                    cursor: 'pointer',
                                    filter: hoverIndex === null || isHovered 
                                        ? `drop-shadow(0px 4px 8px ${arc.data.color}35)` 
                                        : 'opacity(0.4) saturate(60%)',
                                }}
                                onMouseEnter={() => setHoverIndex(index)}
                                onMouseLeave={() => setHoverIndex(null)}
                            />
                        );
                    })}
                </g>
            </svg>
            <div
                className="rpt-donut-center-label"
                style={{
                    position: 'absolute',
                    textAlign: 'center',
                    pointerEvents: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    width: `${innerRadius * 2 - 8}px`,
                    height: `${innerRadius * 2 - 8}px`,
                }}
            >
                <span style={{ fontSize: '0.66rem', fontWeight: '700', textTransform: 'uppercase', color: 'var(--admin-text-muted, #64748b)', letterSpacing: '0.06em' }}>
                    {hoveredData ? hoveredData.label : 'Total'}
                </span>
                <span style={{ fontSize: hoveredData ? '0.82rem' : '0.95rem', fontWeight: '900', color: 'var(--admin-text, #0f172a)', marginTop: '2px', wordBreak: 'break-all', transition: 'font-size 0.15s ease' }}>
                    {hoveredData ? fmtVal(hoveredData.value) : fmtVal(total)}
                </span>
                {hoveredData && (
                    <span style={{ fontSize: '0.72rem', fontWeight: '700', color: hoveredData.color, marginTop: '2px' }}>
                        {Math.round((hoveredData.value / total) * 100)}%
                    </span>
                )}
            </div>
        </div>
    );
}
