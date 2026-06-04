import React from 'react';
import { Tag, Store, CreditCard, Receipt as ReceiptIcon, Upload, CheckCircle2, FileText, Coins, Split } from 'lucide-react';
import { formatCurrency } from '@/shared/utils/formatters';
import {
    computeChangeDue,
    getCashDueAmount,
    validateCheckoutPayment,
} from '@/shared/utils/orderUtils';
import AdminIconSlot from '../AdminIconSlot';

const BILL_SHORTCUTS = [1000, 2000, 5000, 10000, 20000];

/**
 * Checkout del paso Pago: método de pago, cupón, desglose y confirmación.
 */
const PaymentDetails = ({
    manualOrder,
    updateCouponCode,
    couponPreview,
    updatePaymentType,
    updatePaymentMode,
    updateCashAmount,
    updateCardAmount,
    updateCashTendered,
    receiptFile,
    receiptPreview,
    handleFileChange,
    removeReceipt,
    submitOrder,
    loading,
    isFormValid,
    goPrevStep,
    confirmLabel = 'CONFIRMAR PEDIDO',
    onCancelOrder = null,
    isEditMode = false,
    hideCheckoutActions = false,
}) => {
    const deliveryFeeAmt = manualOrder.order_type === 'delivery' ? (Number(manualOrder.delivery_fee) || 0) : 0;
    const grossItems = manualOrder.total;
    const couponDiscountApplied =
        couponPreview?.variant === 'success' && Number(couponPreview.discount) > 0
            ? Math.min(grossItems, Number(couponPreview.discount))
            : 0;
    const totalToPay = Math.max(0, grossItems - couponDiscountApplied + deliveryFeeAmt);

    const isMixed = manualOrder.payment_mode === 'mixed';
    const showCashTender =
        isMixed
            ? (Number(manualOrder.cash_amount) || 0) > 0
            : manualOrder.payment_type === 'tienda';

    const cashDue = getCashDueAmount({
        payment_mode: manualOrder.payment_mode,
        payment_type: manualOrder.payment_type,
        cash_amount: manualOrder.cash_amount,
        totalToPay,
    });

    const changeDue = showCashTender
        ? computeChangeDue(manualOrder.cash_tendered, cashDue)
        : 0;

    const paymentValidation = validateCheckoutPayment({
        payment_mode: manualOrder.payment_mode,
        payment_type: manualOrder.payment_type,
        cash_amount: manualOrder.cash_amount,
        card_amount: manualOrder.card_amount,
        cash_tendered: manualOrder.cash_tendered,
        totalToPay,
    });

    const mixedSum = (Number(manualOrder.cash_amount) || 0) + (Number(manualOrder.card_amount) || 0);
    const mixedDiff = totalToPay - mixedSum;

    const handleBillShortcut = (amount) => {
        updateCashTendered(amount);
    };

    const paymentMethodsDisabled = isMixed;

    return (
        <div className="manual-order-checkout">
            <div className="manual-order-checkout-section">
                <div className="manual-order-checkout-section-title">
                    <CreditCard size={14} aria-hidden />
                    MÉTODO DE PAGO
                </div>
                <div className="manual-order-payment-methods">
                    <button
                        type="button"
                        className={`manual-order-payment-btn ${!isMixed && manualOrder.payment_type === 'tienda' ? 'active' : ''}`}
                        onClick={() => updatePaymentType('tienda')}
                        disabled={paymentMethodsDisabled}
                    >
                        <Store size={20} />
                        EFECTIVO
                    </button>
                    <button
                        type="button"
                        className={`manual-order-payment-btn ${!isMixed && manualOrder.payment_type === 'tarjeta' ? 'active' : ''}`}
                        onClick={() => updatePaymentType('tarjeta')}
                        disabled={paymentMethodsDisabled}
                    >
                        <CreditCard size={20} />
                        TARJETA
                    </button>
                    <button
                        type="button"
                        className={`manual-order-payment-btn ${!isMixed && manualOrder.payment_type === 'online' ? 'active' : ''}`}
                        onClick={() => updatePaymentType('online')}
                        disabled={paymentMethodsDisabled}
                    >
                        <ReceiptIcon size={20} />
                        TRANSF.
                    </button>
                </div>
                <button
                    type="button"
                    className={`manual-order-mixed-toggle ${isMixed ? 'active' : ''}`}
                    onClick={() => updatePaymentMode(isMixed ? 'single' : 'mixed')}
                >
                    <Split size={16} aria-hidden />
                    Pago mixto (efectivo + tarjeta)
                </button>
            </div>

            {isMixed ? (
                <div className="manual-order-checkout-section manual-order-mixed-split animate-fade-in">
                    <div className="manual-order-checkout-section-title">
                        <Split size={14} aria-hidden />
                        DESGLOSE DEL PAGO
                    </div>
                    <div className="manual-order-mixed-split__grid">
                        <label className="manual-order-mixed-split__field">
                            <span>Efectivo</span>
                            <input
                                type="number"
                                inputMode="numeric"
                                min="0"
                                step="1"
                                className="manual-order-input"
                                value={manualOrder.cash_amount || ''}
                                onChange={(e) => updateCashAmount(e.target.value)}
                                placeholder="0"
                            />
                        </label>
                        <label className="manual-order-mixed-split__field">
                            <span>Tarjeta</span>
                            <input
                                type="number"
                                inputMode="numeric"
                                min="0"
                                step="1"
                                className="manual-order-input"
                                value={manualOrder.card_amount || ''}
                                onChange={(e) => updateCardAmount(e.target.value)}
                                placeholder="0"
                            />
                        </label>
                    </div>
                    {totalToPay > 0 ? (
                        <p
                            className={`manual-order-mixed-split__status ${
                                Math.abs(mixedDiff) <= 1
                                    ? 'manual-order-mixed-split__status--ok'
                                    : mixedDiff > 0
                                      ? 'manual-order-mixed-split__status--warn'
                                      : 'manual-order-mixed-split__status--error'
                            }`}
                            role="status"
                        >
                            {Math.abs(mixedDiff) <= 1
                                ? 'Cuadra con el total a pagar'
                                : mixedDiff > 0
                                  ? `Falta ${formatCurrency(mixedDiff)}`
                                  : `Sobra ${formatCurrency(Math.abs(mixedDiff))}`}
                        </p>
                    ) : null}
                </div>
            ) : null}

            {showCashTender ? (
                <div className="manual-order-checkout-section manual-order-cash-tender animate-fade-in">
                    <div className="manual-order-checkout-section-title">
                        <Coins size={14} aria-hidden />
                        EFECTIVO RECIBIDO
                    </div>
                    <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="1"
                        className="manual-order-input manual-order-cash-tender__input"
                        value={manualOrder.cash_tendered === '' ? '' : manualOrder.cash_tendered}
                        onChange={(e) => updateCashTendered(e.target.value)}
                        placeholder={cashDue > 0 ? formatCurrency(cashDue) : '0'}
                    />
                    <div className="manual-order-cash-tender__shortcuts">
                        {BILL_SHORTCUTS.map((bill) => (
                            <button
                                key={bill}
                                type="button"
                                className="manual-order-cash-tender__shortcut"
                                onClick={() => handleBillShortcut(bill)}
                            >
                                {formatCurrency(bill)}
                            </button>
                        ))}
                    </div>
                    {cashDue > 0 && manualOrder.cash_tendered !== '' ? (
                        <div
                            className={`manual-order-change-due ${
                                paymentValidation.valid ? 'manual-order-change-due--ok' : 'manual-order-change-due--error'
                            }`}
                            role="status"
                        >
                            <span className="manual-order-change-due__label">Cambio a devolver</span>
                            <span className="manual-order-change-due__amount">
                                {paymentValidation.reason === 'insufficient_tender'
                                    ? `Faltan ${formatCurrency(cashDue - (Number(manualOrder.cash_tendered) || 0))}`
                                    : formatCurrency(changeDue)}
                            </span>
                        </div>
                    ) : null}
                </div>
            ) : null}

            <div className="manual-order-checkout-section manual-order-checkout-coupon">
                <div className="manual-order-checkout-section-title">
                    <Tag size={14} aria-hidden />
                    CÓDIGO DE DESCUENTO (OPC.)
                </div>
                <input
                    type="text"
                    className="manual-order-input manual-order-checkout-coupon-input"
                    autoComplete="off"
                    spellCheck={false}
                    value={manualOrder.coupon_code ?? ''}
                    onChange={(e) => updateCouponCode(e.target.value)}
                    placeholder="Ej. PROMO15"
                />
                {couponPreview?.loading && (
                    <span className="manual-order-checkout-coupon-msg">Validando código…</span>
                )}
                {couponPreview?.message && (
                    <span
                        className={`manual-order-checkout-coupon-msg manual-order-checkout-coupon-msg--${couponPreview.variant || 'info'}`}
                    >
                        {couponPreview.message}
                    </span>
                )}
            </div>

            <div className="manual-order-checkout-section manual-order-total-breakdown">
                <div className="manual-order-checkout-section-title">
                    TOTAL
                </div>
                <div className="manual-order-total-breakdown__rows">
                    <div className="manual-order-total-breakdown__row">
                        <span>Artículos</span>
                        <span>{formatCurrency(grossItems)}</span>
                    </div>
                    {couponDiscountApplied > 0 && (
                        <div className="manual-order-total-breakdown__row manual-order-total-breakdown__row--discount">
                            <span>Descuento (cupón)</span>
                            <span>−{formatCurrency(couponDiscountApplied)}</span>
                        </div>
                    )}
                    {deliveryFeeAmt > 0 && (
                        <div className="manual-order-total-breakdown__row">
                            <span>Delivery</span>
                            <span>{formatCurrency(deliveryFeeAmt)}</span>
                        </div>
                    )}
                </div>
                <div className="manual-order-total-breakdown__final">
                    <span className="manual-order-total-label">TOTAL A PAGAR</span>
                    <span className="manual-order-total-amount">{formatCurrency(totalToPay)}</span>
                </div>
            </div>

            {manualOrder.payment_type === 'online' && !isMixed && (
                <div className="manual-order-checkout-section manual-order-receipt-upload animate-fade-in">
                    <div className="manual-order-checkout-section-title">
                        <Upload size={14} aria-hidden />
                        COMPROBANTE (OPC.)
                    </div>
                    <p className="manual-order-receipt-hint">
                        Podés confirmar el pedido sin imagen. Si querés, subí el comprobante ahora o después desde la tarjeta del pedido.
                    </p>
                    <label htmlFor="receipt-upload" className="manual-order-receipt-dropzone">
                        <AdminIconSlot Icon={FileText} slotSize="md" tone="accent" />
                        <span>{receiptFile ? receiptFile.name : 'Click para subir imagen'}</span>
                    </label>
                    <input
                        id="receipt-upload"
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                        className="manual-order-receipt-input-hidden"
                    />
                    {receiptPreview && (
                        <div className="manual-order-receipt-preview">
                            <img src={receiptPreview} alt="Preview comprobante" />
                            <button
                                type="button"
                                className="manual-order-receipt-remove"
                                onClick={(e) => {
                                    e.preventDefault();
                                    removeReceipt();
                                }}
                            >
                                QUITAR
                            </button>
                        </div>
                    )}
                </div>
            )}

            {!isFormValid() && !loading ? (
                <p className="manual-order-confirm-hint" role="status">
                    {isEditMode
                        ? 'Revisa los datos del pedido antes de guardar los cambios.'
                        : paymentValidation.reason === 'insufficient_tender'
                          ? 'Indica el monto recibido en efectivo (debe cubrir lo que paga el cliente).'
                          : paymentValidation.reason === 'split_mismatch'
                            ? 'El desglose mixto debe sumar exactamente el total a pagar.'
                            : 'Revisa nombre, RUT, teléfono, productos en el carrito y datos de delivery antes de confirmar.'}
                </p>
            ) : null}

            {!hideCheckoutActions ? (
            <div className="manual-order-checkout-actions">
                {goPrevStep ? (
                    <button
                        type="button"
                        className="manual-order-checkout-back manual-order-steps-nav__btn manual-order-steps-nav__btn--back"
                        onClick={goPrevStep}
                    >
                        Atrás
                    </button>
                ) : null}
                {onCancelOrder ? (
                    <button
                        type="button"
                        className="manual-order-checkout-cancel manual-order-steps-nav__btn manual-order-steps-nav__btn--back"
                        onClick={onCancelOrder}
                        disabled={loading}
                    >
                        Cancelar pedido
                    </button>
                ) : null}
                <button
                    type="button"
                    className="manual-order-confirm-btn"
                    onClick={submitOrder}
                    disabled={loading || !isFormValid()}
                >
                    {loading ? (
                        <>
                            <div className="manual-order-confirm-spinner" />
                            PROCESANDO...
                        </>
                    ) : (
                        <>
                            <CheckCircle2 size={20} />
                            {confirmLabel}
                        </>
                    )}
                </button>
            </div>
            ) : null}
        </div>
    );
};

export default React.memo(PaymentDetails);
