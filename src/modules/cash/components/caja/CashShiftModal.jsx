import React, { useState, useEffect } from 'react';
import { X, Lock, Unlock, Calculator, AlertTriangle } from 'lucide-react';

const CashShiftModal = ({ isOpen, onClose, type, onConfirm, activeShift }) => {
    const [amount, setAmount] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (isOpen) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setAmount('');
            setError('');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        const numAmount = parseFloat(amount);
        
        if (isNaN(numAmount) || numAmount < 0) {
            setError('Ingresa un monto válido');
            return;
        }

        onConfirm(numAmount);
        onClose();
    };

    const isOpening = type === 'open';

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-content cash-shift-modal"
                style={{ maxWidth: 400 }}
                onClick={e => e.stopPropagation()}
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
                    <div className="modal-form">
                        <p className="cash-shift-modal__lead">
                            {isOpening 
                                ? 'Ingresa el monto inicial con el que empiezas el turno (Base de caja).'
                                : 'Ingresa el monto total de efectivo físico que hay en la caja al finalizar el turno.'}
                        </p>

                        {!isOpening && activeShift && (
                            <div className="cash-shift-modal__expected">
                                <div className="cash-shift-modal__expected-row">
                                    <span className="cash-shift-modal__expected-label">Efectivo esperado</span>
                                    <span className="cash-shift-modal__expected-value">${activeShift.expected_balance.toLocaleString('es-CL')}</span>
                                </div>
                                <p className="cash-shift-modal__expected-hint">
                                    Base más ingresos en efectivo menos egresos en efectivo.
                                </p>
                            </div>
                        )}

                        <div className="form-group">
                            <label>{isOpening ? 'Monto Inicial' : 'Total Efectivo Físico'}</label>
                            <div style={{ position: 'relative' }}>
                                <span className="cash-shift-modal__currency" aria-hidden>$</span>
                                <input
                                    type="number"
                                    className="form-input"
                                    style={{ paddingLeft: 30 }}
                                    placeholder="0"
                                    autoFocus
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    required
                                />
                            </div>
                            {error && <span style={{ color: '#e63946', fontSize: '0.8rem', marginTop: 5, display: 'block' }}>{error}</span>}
                        </div>

                        {!isOpening && amount && (
                            <div className="animate-fade cash-shift-modal__diff">
                                {parseFloat(amount) === activeShift?.expected_balance ? (
                                    <div style={{ color: '#25d366', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <Calculator size={16} /> <span>Caja cuadrada perfectamente</span>
                                    </div>
                                ) : (
                                    <div style={{ 
                                        color: parseFloat(amount) > activeShift?.expected_balance ? '#25d366' : '#f4a261', 
                                        fontSize: '0.85rem', 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: 8 
                                    }}>
                                        <AlertTriangle size={16} /> 
                                        <span>
                                            {parseFloat(amount) > activeShift?.expected_balance ? 'Sobrante: ' : 'Faltante: '}
                                            ${ Math.abs(parseFloat(amount) - activeShift?.expected_balance).toLocaleString('es-CL') }
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div style={{ marginTop: 30, display: 'flex', gap: 10 }}>
                        <button type="button" onClick={onClose} className="btn btn-secondary" style={{ flex: 1 }}>Cancelar</button>
                        <button type="submit" className={`btn ${isOpening ? 'btn-primary' : 'btn-danger'}`} style={{ flex: 1 }}>
                            {isOpening ? 'Abrir Caja' : 'Cerrar Turno'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CashShiftModal;
