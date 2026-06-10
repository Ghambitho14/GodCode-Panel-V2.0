import React, { useEffect, useRef } from 'react';
import { createChart, AreaSeries, HistogramSeries } from 'lightweight-charts';
import {
    attachResizeObserver,
    buildAreaColors,
    buildHistogramColor,
    createDashboardChartOptions,
    readAccentColor,
} from './rptLightweightChartShared';

/**
 * Serie temporal `YYYY-MM-DD` → Lightweight Charts (área o histograma, una serie).
 * @param {{ time: string, value: number }[]} props.data
 * @param {'area' | 'histogram'} props.variant
 */
export default function RPTLightweightChart({
    data,
    variant,
    height = 260,
    areaColors: areaColorsProp,
    histogramColor: histogramColorProp,
}) {
    const hostRef = useRef(null);

    useEffect(() => {
        const el = hostRef.current;
        if (!el || !Array.isArray(data) || data.length === 0) {
            return undefined;
        }

        const accent = readAccentColor();
        const areaColors = areaColorsProp ?? buildAreaColors(accent);
        const histogramColor =
            histogramColorProp ?? buildHistogramColor(accent, 'bar-solid');
        const w = Math.max(1, el.clientWidth || el.offsetWidth || 320);

        const chart = createChart(
            el,
            createDashboardChartOptions({ width: w, height, showRightScale: false }),
        );

        if (variant === 'histogram') {
            const s = chart.addSeries(HistogramSeries, {
                priceScaleId: 'left',
                color: histogramColor,
                priceFormat: { type: 'price', precision: 0, minMove: 1 },
            });
            s.setData(data);
        } else {
            const s = chart.addSeries(AreaSeries, {
                priceScaleId: 'left',
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

        const ro = attachResizeObserver(el, chart, height);

        return () => {
            ro.disconnect();
            chart.remove();
        };
    }, [data, variant, height, areaColorsProp, histogramColorProp]);

    if (!data?.length) return null;

    return <div ref={hostRef} className="rpt-lwc-host" style={{ width: '100%', height }} />;
}
