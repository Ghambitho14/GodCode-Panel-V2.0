import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2, Volume1, VolumeX, Check } from 'lucide-react';
import {
    getOrderSoundMode,
    setOrderSoundMode,
    ORDER_SOUND_MODE_CHANGE_EVENT,
    ORDER_SOUND_MODE_OPTIONS,
    labelForOrderSoundMode,
} from '../utils/orderNotificationPrefs';

function iconForMode(mode) {
    if (mode === 'off') return VolumeX;
    if (mode === 'online_only') return Volume1;
    return Volume2;
}

export default function OrderNotificationSoundControl() {
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState(() => getOrderSoundMode());
    const rootRef = useRef(null);

    useEffect(() => {
        const sync = () => setMode(getOrderSoundMode());
        window.addEventListener(ORDER_SOUND_MODE_CHANGE_EVENT, sync);
        window.addEventListener('storage', sync);
        return () => {
            window.removeEventListener(ORDER_SOUND_MODE_CHANGE_EVENT, sync);
            window.removeEventListener('storage', sync);
        };
    }, []);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e) => {
            if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    const selectMode = useCallback((next) => {
        setOrderSoundMode(next);
        setMode(next);
        setOpen(false);
    }, []);

    const Icon = iconForMode(mode);
    const title = `Sonido de pedidos: ${labelForOrderSoundMode(mode)}`;

    return (
        <div className="order-sound-control" ref={rootRef}>
            <button
                type="button"
                className={`btn-icon-refresh admin-icon-btn header-action-order-sound order-sound-control__trigger${mode !== 'all' ? ' order-sound-control__trigger--muted' : ''}`}
                onClick={() => setOpen((v) => !v)}
                title={title}
                aria-label={title}
                aria-expanded={open}
                aria-haspopup="dialog"
            >
                <Icon size={24} strokeWidth={1.65} aria-hidden />
            </button>

            {open ? (
                <div
                    className="order-sound-control__popover"
                    role="dialog"
                    aria-labelledby="order-sound-control-title"
                >
                    <header className="order-sound-control__head">
                        <h2 className="order-sound-control__title" id="order-sound-control-title">
                            Sonido de pedidos
                        </h2>
                        <p className="order-sound-control__sub">
                            Elige cuándo reproducir el aviso al recibir un pedido nuevo.
                        </p>
                    </header>
                    <ul className="order-sound-control__options" role="listbox" aria-label="Modo de sonido">
                        {ORDER_SOUND_MODE_OPTIONS.map((opt) => {
                            const active = mode === opt.value;
                            return (
                                <li key={opt.value}>
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={active}
                                        className={`order-sound-control__option${active ? ' is-active' : ''}`}
                                        onClick={() => selectMode(opt.value)}
                                    >
                                        <span className="order-sound-control__option-text">
                                            <span className="order-sound-control__option-label">{opt.label}</span>
                                            <span className="order-sound-control__option-desc">{opt.description}</span>
                                        </span>
                                        {active ? (
                                            <Check size={18} strokeWidth={2.25} className="order-sound-control__check" aria-hidden />
                                        ) : null}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}
