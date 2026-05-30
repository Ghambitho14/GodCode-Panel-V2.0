import React from 'react';
import { Tag, Store, CreditCard, Receipt as ReceiptIcon, Upload, CheckCircle2, FileText } from 'lucide-react';
import { formatCurrency } from '@/shared/utils/formatters';
import AdminIconSlot from '../AdminIconSlot';

/**
 * Checkout del paso Pago: método de pago, cupón, desglose y confirmación.
 */
const PaymentDetails = ({
    manualOrder,
    updateCouponCode,
    couponPreview,
    updatePaymentType,
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
}) => {
    const deliveryFeeAmt = manualOrder.order_type === 'delivery' ? (Number(manualOrder.delivery_fee) || 0) : 0;
    const grossItems = manualOrder.total;
    const couponDiscountApplied =
        couponPreview?.variant === 'success' && Number(couponPreview.discount) > 0
            ? Math.min(grossItems, Number(couponPreview.discount))
            : 0;
    const totalToPay = Math.max(0, grossItems - couponDiscountApplied + deliveryFeeAmt);

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
                        className={`manual-order-payment-btn ${manualOrder.payment_type === 'tienda' ? 'active' : ''}`}
                        onClick={() => updatePaymentType('tienda')}
                    >
                        <Store size={20} />
                        EFECTIVO
                    </button>
                    <button
                        type="button"
                        className={`manual-order-payment-btn ${manualOrder.payment_type === 'tarjeta' ? 'active' : ''}`}
                        onClick={() => updatePaymentType('tarjeta')}
                    >
                        <CreditCard size={20} />
                        TARJETA
                    </button>
                    <button
                        type="button"
                        className={`manual-order-payment-btn ${manualOrder.payment_type === 'online' ? 'active' : ''}`}
                        onClick={() => updatePaymentType('online')}
                    >
                        <ReceiptIcon size={20} />
                        TRANSF.
                    </button>
                </div>
            </div>

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

            {manualOrder.payment_type === 'online' && (
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
                        : 'Revisa nombre, RUT, teléfono, productos en el carrito y datos de delivery antes de confirmar.'}
                </p>
            ) : null}

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
                    disabled={loading}
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
        </div>
    );
};

export default React.memo(PaymentDetails);
