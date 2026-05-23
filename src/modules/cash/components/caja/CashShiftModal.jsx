import React, { useEffect, useMemo, useState } from 'react';
import { X, Lock, Unlock, AlertTriangle, CheckCircle2, Clock, DollarSign, CreditCard, Smartphone, ChevronDown, ChevronUp } from 'lucide-react';
import { formatCurrency } from '@/shared/utils/formatters';
import {
    getExpectedByMethod,
    diffCounted,
    buildShiftSalesRows,
    buildShiftOtherMovementRows,
} from '../../utils/shiftCloseReconciliation';
import { useLockBodyScroll } from '@/shared/hooks/useLockBodyScroll';

const fmt = (n) => {
    try {
        return formatCurrency(n);
    } catch {
        return `$${(n || 0).toLocaleString('es-CL')}`;
    }
};

function formatShiftDuration(openedAt) {
    if (!openedAt) return '—';
    const ms = Date.now() - new Date(openedAt).getTime();
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function DiffBadge({ expected, counted }) {
    const { diff, status } = diffCounted(expected, counted);
    if (status === 'match') {
        return (
            <span className="cash-shift-close-diff cash-shift-close-diff--match">
                <CheckCircle2 size={14} aria-hidden />
                Cuadrado
            </span>
        );
    }
    const isSurplus = status === 'surplus';
    return (
        <span className={`cash-shift-close-diff cash-shift-close-diff--${status}`}>
            <AlertTriangle size={14} aria-hidden />
            {isSurplus ? 'Sobrante' : 'Faltante'}: {fmt(Math.abs(diff))}
        </span>
    );
}

function MethodCountRow({ id, label, Icon, expected, value, onChange }) {
    const counted = parseFloat(value);
    const hasValue = value !== '' && !Number.isNaN(counted) && counted >= 0;
    return (
        <div className="cash-shift-close-method">
            <div className="cash-shift-close-method__head">
                <span className="cash-shift-close-method__label">
                    <Icon size={16} strokeWidth={1.75} aria-hidden />
                    {label}
                </span>
                <span className="cash-shift-close-method__expected">
                    Esperado: <strong>{fmt(expected)}</strong>
                </span>
            </div>
            <div className="cash-shift-close-method__input-wrap">
                <span className="cash-shift-modal__currency" aria-hidden>$</span>
                <input
                    id={id}
                    type="number"
                    min="0"
                    step="1"
                    className="form-input cash-shift-close-method__input"
                    placeholder="0"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                />
            </div>
            {hasValue ? <DiffBadge expected={expected} counted={counted} /> : null}
        </div>
    );
}

const CashShiftModal = ({ isOpen, onClose, type, onConfirm, activeShift, movements = [], getTotals }) => {
    const [amount, setAmount] = useState('');
    const [countedCash, setCountedCash] = useState('');
    const [countedCard, setCountedCard] = useState('');
    const [countedOnline, setCountedOnline] = useState('');
    const [error, setError] = useState('');
    const [showOtherMovements, setShowOtherMovements] = useState(false);

    const isOpening = type === 'open';

    const totals = useMemo(() => {
        if (isOpening || !getTotals) return null;
        return getTotals(movements);
    }, [isOpening, getTotals, movements]);

    const expectedByMethod = useMemo(() => {
        if (!totals || !activeShift) return { cash: 0, card: 0, online: 0 };
        return getExpectedByMethod(totals, activeShift);
    }, [totals, activeShift]);

    const salesRows = useMemo(() => buildShiftSalesRows(movements), [movements]);
    const otherRows = useMemo(() => buildShiftOtherMovementRows(movements), [movements]);

    useEffect(() => {
        if (isOpen) {
            setAmount('');
            setCountedCash('');
            setCountedCard('');
            setCountedOnline('');
            setError('');
            setShowOtherMovements(false);
        }
    }, [isOpen]);

    useLockBodyScroll(isOpen);

    if (!isOpen) return null;

    const parseNonNegative = (val) => {
        const n = parseFloat(val);
        if (Number.isNaN(n) || n < 0) return null;
        return n;
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (isOpening) {
            const numAmount = parseFloat(amount);
            if (Number.isNaN(numAmount) || numAmount < 0) {
                setError('Ingresa un monto válido');
                return;
            }
            onConfirm(numAmount);
            onClose();
            return;
        }

        const cash = parseNonNegative(countedCash);
        const card = parseNonNegative(countedCard);
        const online = parseNonNegative(countedOnline);
        if (cash === null) {
            setError('Ingresa el efectivo físico contado');
            return;
        }
        if (card === null || online === null) {
            setError('Ingresa montos válidos para tarjeta y transferencia (pueden ser 0)');
            return;
        }
        setError('');
        onConfirm({ cash, card, online });
        onClose();
    };

    const cashNum = parseFloat(countedCash);
    const canClose =
        countedCash !== '' &&
        !Number.isNaN(cashNum) &&
        cashNum >= 0 &&
        countedCard !== '' &&
        !Number.isNaN(parseFloat(countedCard)) &&
        parseFloat(countedCard) >= 0 &&
        countedOnline !== '' &&
        !Number.isNaN(parseFloat(countedOnline)) &&
        parseFloat(countedOnline) >= 0;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className={`modal-content cash-shift-modal${!isOpening ? ' cash-shift-modal--close' : ''}`}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="cash-shift-modal-title"
            >
                <header className="modal-header cash-shift-modal__header">
                    <div className="cash-shift-modal__header-main">
                        <span
                            className={`cash-shift-modal__header-icon${isOpening ? ' cash-shift-modal__header-icon--open' : ''}`}
                            aria-hidden
                        >
                            {isOpening ? (
                                <Unlock className="text-accent" size={20} strokeWidth={1.75} />
                            ) : (
                                <Lock className="text-danger" size={20} strokeWidth={1.75} />
                            )}
                        </span>
                        <h3 id="cash-shift-modal-title">{isOpening ? 'Apertura de caja' : 'Cierre de caja'}</h3>
                    </div>
                    <button type="button" onClick={onClose} className="btn-close" aria-label="Cerrar">
                        <X size={20} strokeWidth={2} />
                    </button>
                </header>

                <form onSubmit={handleSubmit} className="cash-shift-modal__form">
                    <div className="modal-form cash-shift-modal__body">
                        {isOpening ? (
                            <>
                                <p className="cash-shift-modal__lead">
                                    Ingresa el monto inicial con el que empiezas el turno (base de caja).
                                </p>
                                <div className="form-group">
                                    <label htmlFor="cash-shift-open-amount">Monto inicial</label>
                                    <div className="cash-shift-close-method__input-wrap">
                                        <span className="cash-shift-modal__currency" aria-hidden>$</span>
                                        <input
                                            id="cash-shift-open-amount"
                                            type="number"
                                            className="form-input cash-shift-close-method__input"
                                            placeholder="0"
                                            autoFocus
                                            value={amount}
                                            onChange={(e) => setAmount(e.target.value)}
                                            required
                                        />
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                <p className="cash-shift-modal__lead">
                                    Cuadra efectivo, tarjeta (punto) y transferencias con lo registrado en el turno antes de cerrar.
                                </p>

                                {activeShift ? (
                                    <div className="cash-shift-close-summary">
                                        <div className="cash-shift-close-summary__item">
                                            <Clock size={14} aria-hidden />
                                            <span>
                                                Abierto{' '}
                                                {new Date(activeShift.opened_at).toLocaleString('es-CL', {
                                                    dateStyle: 'short',
                                                    timeStyle: 'short',
                                                })}
                                            </span>
                                        </div>
                                        <div className="cash-shift-close-summary__item">
                                            <span>Base: {fmt(activeShift.opening_balance || 0)}</span>
                                        </div>
                                        <div className="cash-shift-close-summary__item">
                                            <span>Duración: {formatShiftDuration(activeShift.opened_at)}</span>
                                        </div>
                                    </div>
                                ) : null}

                                <h4 className="cash-shift-close-section-title">Cuadre por método</h4>
                                <div className="cash-shift-close-methods">
                                    <MethodCountRow
                                        id="counted-cash"
                                        label="Efectivo físico"
                                        Icon={DollarSign}
                                        expected={expectedByMethod.cash}
                                        value={countedCash}
                                        onChange={setCountedCash}
                                    />
                                    <MethodCountRow
                                        id="counted-card"
                                        label="Tarjeta (punto)"
                                        Icon={CreditCard}
                                        expected={expectedByMethod.card}
                                        value={countedCard}
                                        onChange={setCountedCard}
                                    />
                                    <MethodCountRow
                                        id="counted-online"
                                        label="Transferencia"
                                        Icon={Smartphone}
                                        expected={expectedByMethod.online}
                                        value={countedOnline}
                                        onChange={setCountedOnline}
                                    />
                                </div>

                                <h4 className="cash-shift-close-section-title">
                                    Ventas del turno ({salesRows.length})
                                </h4>
                                <div className="cash-shift-close-sales-scroll">
                                    {salesRows.length === 0 ? (
                                        <p className="cash-shift-close-empty">Sin ventas registradas en este turno.</p>
                                    ) : (
                                        <table className="cash-movements-table cash-shift-close-sales-table">
                                            <thead>
                                                <tr>
                                                    <th>Fecha / hora</th>
                                                    <th>Pedido</th>
                                                    <th>Método</th>
                                                    <th className="cash-shift-close-sales-table__num">Monto</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {salesRows.map((row) => (
                                                    <tr key={row.id}>
                                                        <td className="cash-shift-close-sales-table__time">
                                                            {new Date(row.at).toLocaleString('es-CL', {
                                                                dateStyle: 'short',
                                                                timeStyle: 'short',
                                                            })}
                                                        </td>
                                                        <td>{row.label}</td>
                                                        <td>{row.methodLabel}</td>
                                                        <td className="cash-shift-close-sales-table__num">{fmt(row.amount)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>

                                {otherRows.length > 0 ? (
                                    <div className="cash-shift-close-other">
                                        <button
                                            type="button"
                                            className="cash-shift-close-other-toggle"
                                            onClick={() => setShowOtherMovements((v) => !v)}
                                        >
                                            {showOtherMovements ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                            Otros movimientos ({otherRows.length})
                                        </button>
                                        {showOtherMovements ? (
                                            <ul className="cash-shift-close-other-list">
                                                {otherRows.map((row) => (
                                                    <li key={row.id}>
                                                        <span className="cash-shift-close-other-list__time">
                                                            {new Date(row.at).toLocaleTimeString('es-CL', {
                                                                hour: '2-digit',
                                                                minute: '2-digit',
                                                            })}
                                                        </span>
                                                        <span>{row.label}</span>
                                                        <span className="cash-shift-close-other-list__method">{row.methodLabel}</span>
                                                        <span className="cash-shift-close-other-list__amount">{fmt(row.amount)}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : null}
                                    </div>
                                ) : null}
                            </>
                        )}

                        {error ? <p className="cash-shift-modal__error">{error}</p> : null}
                    </div>

                    <div className="cash-shift-modal__footer">
                        <button type="button" onClick={onClose} className="btn btn-secondary">
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className={`btn ${isOpening ? 'btn-primary' : 'btn-danger'}`}
                            disabled={!isOpening && !canClose}
                        >
                            {isOpening ? (
                                <>
                                    <Unlock size={16} aria-hidden /> Abrir caja
                                </>
                            ) : (
                                <>
                                    <Lock size={16} aria-hidden /> Cerrar turno
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CashShiftModal;
