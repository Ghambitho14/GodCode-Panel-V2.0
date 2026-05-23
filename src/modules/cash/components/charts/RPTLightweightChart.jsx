import React, { useEffect, useRef } from 'react';
import {
    createChart,
    ColorType,
    AreaSeries,
    HistogramSeries,
} from 'lightweight-charts';
import { formatCurrency } from '@/shared/utils/formatters';

const DEFAULT_AREA = {
    lineColor: '#e63946',
    topColor: 'rgba(230, 57, 70, 0.22)',
    bottomColor: 'rgba(230, 57, 70, 0.02)',
};

const DEFAULT_HIST = {
    color: 'rgba(220, 38, 38, 0.82)',
};

function formatPriceSafe(n) {
    try {
        return formatCurrency(n);
    } catch {
        return `$${Number(n || 0).toLocaleString('es-CL')}`;
    }
}

/**
 * Serie temporal `YYYY-MM-DD` → Lightweight Charts (área o histograma).
 * @param {{ time: string, value: number }[]} props.data
 * @param {'area' | 'histogram'} props.variant
 */
export default function RPTLightweightChart({
    data,
    variant,
    height = 260,
    areaColors = DEFAULT_AREA,
    histogramColor = DEFAULT_HIST.color,
}) {
    const hostRef = useRef(null);

    useEffect(() => {
        const el = hostRef.current;
        if (!el || !Array.isArray(data) || data.length === 0) {
            return undefined;
        }

        const w = Math.max(1, el.clientWidth || el.offsetWidth || 320);

        const chart = createChart(el, {
            width: w,
            height,
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: 'var(--admin-text-muted, #64748b)',
                fontSize: 11,
                attributionLogo: false,
            },
            grid: {
                vertLines: { color: 'rgba(148, 163, 184, 0.18)' },
                horzLines: { color: 'rgba(148, 163, 184, 0.12)' },
            },
            rightPriceScale: {
                borderVisible: false,
                scaleMargins: { top: 0.1, bottom: 0.08 },
            },
            timeScale: {
                borderVisible: false,
                fixLeftEdge: true,
                fixRightEdge: true,
            },
            crosshair: {
                vertLine: { width: 1, color: 'rgba(100, 116, 139, 0.35)', labelBackgroundColor: '#475569' },
                horzLine: { width: 1, color: 'rgba(100, 116, 139, 0.35)', labelBackgroundColor: '#475569' },
            },
            localization: {
                locale: 'es-CL',
                priceFormatter: formatPriceSafe,
            },
            handleScroll: {
                pressedMouseMove: false,
                horzTouchDrag: false,
                vertTouchDrag: false,
            },
            handleScale: {
                mouseWheel: false,
                pinch: false,
                axisPressedMouseMove: false,
            },
        });

        if (variant === 'histogram') {
            const s = chart.addSeries(HistogramSeries, {
                color: histogramColor,
                priceFormat: { type: 'price', precision: 0, minMove: 1 },
            });
            s.setData(data);
        } else {
            const s = chart.addSeries(AreaSeries, {
                lineColor: areaColors.lineColor,
                topColor: areaColors.topColor,
                bottomColor: areaColors.bottomColor,
                lineWidth: 2,
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: data.length > 60 ? 3 : 4,
            });
            s.setData(data);
        }

        chart.timeScale().fitContent();

        const ro = new ResizeObserver(() => {
            const nw = Math.max(1, el.clientWidth || el.offsetWidth || 320);
            chart.applyOptions({ width: nw, height });
            chart.timeScale().fitContent();
        });
        ro.observe(el);

        return () => {
            ro.disconnect();
            chart.remove();
        };
    }, [data, variant, height, areaColors.lineColor, areaColors.topColor, areaColors.bottomColor, histogramColor]);

    if (!data?.length) return null;

    return <div ref={hostRef} className="rpt-lwc-host" style={{ width: '100%', height }} />;
}
