import { ColorType } from 'lightweight-charts';
import { formatCurrency } from '@/shared/utils/formatters';

export function formatPriceSafe(n) {
    try {
        return formatCurrency(n);
    } catch {
        return `$${Number(n || 0).toLocaleString('es-CL')}`;
    }
}

/** Lee --accent-primary del tema tenant (fallback rojo panel). */
export function readAccentColor(fallback = '#e63946') {
    if (typeof document === 'undefined') return fallback;
    const raw = getComputedStyle(document.documentElement)
        .getPropertyValue('--accent-primary')
        .trim();
    return raw || fallback;
}

export function accentToRgba(hex, alpha) {
    const h = String(hex || '#e63946').replace('#', '');
    if (h.length !== 6) return `rgba(230, 57, 70, ${alpha})`;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function buildAreaColors(accent) {
    return {
        lineColor: accent,
        topColor: accentToRgba(accent, 0.22),
        bottomColor: accentToRgba(accent, 0.02),
    };
}

export function buildHistogramColor(accent, variant) {
    if (variant === 'bar-gradient') {
        return accentToRgba(accent, 0.52);
    }
    return accentToRgba(accent, 0.88);
}

/** Opciones base para gráficos estáticos del panel admin (sin scroll/zoom). */
export function createDashboardChartOptions({ width, height, showRightScale = false }) {
    return {
        width,
        height,
        layout: {
            background: { type: ColorType.Solid, color: 'transparent' },
            textColor: '#64748b',
            fontSize: 11,
            attributionLogo: false,
        },
        grid: {
            vertLines: { color: 'rgba(148, 163, 184, 0.14)' },
            horzLines: { color: 'rgba(148, 163, 184, 0.1)' },
        },
        leftPriceScale: {
            visible: true,
            borderVisible: false,
            scaleMargins: { top: 0.12, bottom: 0.06 },
        },
        rightPriceScale: {
            visible: showRightScale,
            borderVisible: false,
            scaleMargins: { top: 0.12, bottom: 0.06 },
        },
        timeScale: {
            borderVisible: false,
            fixLeftEdge: true,
            fixRightEdge: true,
            tickMarkFormatter: (time) => {
                const iso = typeof time === 'string' ? time : String(time);
                const d = new Date(`${iso}T12:00:00`);
                if (Number.isNaN(d.getTime())) return iso;
                return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
            },
        },
        crosshair: {
            vertLine: {
                width: 1,
                color: 'rgba(100, 116, 139, 0.35)',
                labelBackgroundColor: '#475569',
            },
            horzLine: {
                width: 1,
                color: 'rgba(100, 116, 139, 0.35)',
                labelBackgroundColor: '#475569',
            },
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
    };
}

export function attachResizeObserver(hostEl, chart, height) {
    const ro = new ResizeObserver(() => {
        const nw = Math.max(1, hostEl.clientWidth || hostEl.offsetWidth || 320);
        chart.applyOptions({ width: nw, height });
        chart.timeScale().fitContent();
    });
    ro.observe(hostEl);
    return ro;
}
