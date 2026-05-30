import { isMenuOrder } from '@/shared/utils/orderUtils';

export const ORDER_SOUND_STORAGE_KEY = 'godcode-order-sound-mode';
export const ORDER_SOUND_MODE_CHANGE_EVENT = 'order-sound-mode-change';

/** @typedef {'all' | 'online_only' | 'off'} OrderSoundMode */

const VALID_MODES = new Set(['all', 'online_only', 'off']);

/**
 * @returns {OrderSoundMode}
 */
export function getOrderSoundMode() {
    if (typeof window === 'undefined') return 'all';
    try {
        const raw = window.localStorage.getItem(ORDER_SOUND_STORAGE_KEY);
        if (raw && VALID_MODES.has(raw)) return /** @type {OrderSoundMode} */ (raw);
    } catch {
        /* ignore */
    }
    return 'all';
}

/**
 * @param {OrderSoundMode} mode
 */
export function setOrderSoundMode(mode) {
    if (!VALID_MODES.has(mode)) return;
    try {
        window.localStorage.setItem(ORDER_SOUND_STORAGE_KEY, mode);
    } catch {
        /* ignore */
    }
    window.dispatchEvent(new CustomEvent(ORDER_SOUND_MODE_CHANGE_EVENT, { detail: { mode } }));
}

/**
 * @param {Record<string, unknown> | null | undefined} order
 * @returns {boolean}
 */
export function shouldPlayOrderSound(order) {
    const mode = getOrderSoundMode();
    if (mode === 'off') return false;
    if (mode === 'online_only') return isMenuOrder(order);
    return true;
}

export const ORDER_SOUND_MODE_OPTIONS = [
    {
        value: 'all',
        label: 'Todos los pedidos',
        description: 'Suena con pedidos online y pedidos manuales de caja.',
    },
    {
        value: 'online_only',
        label: 'Solo pedidos online',
        description: 'Silencia pedidos manuales y presenciales; avisa solo menú público.',
    },
    {
        value: 'off',
        label: 'Silenciar todo',
        description: 'No reproduce sonido; las notificaciones visuales siguen activas.',
    },
];

/**
 * @param {OrderSoundMode} mode
 */
export function labelForOrderSoundMode(mode) {
    return ORDER_SOUND_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? 'Sonido de pedidos';
}
