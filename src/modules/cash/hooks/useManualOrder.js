import { useState, useCallback, useMemo } from 'react';
import { useManualOrderCart } from './manual-order/useManualOrderCart';
import { useManualOrderForm } from './manual-order/useManualOrderForm';
import { useCouponValidation } from './manual-order/useCouponValidation';
import { useReceiptUpload } from './manual-order/useReceiptUpload';
import { createManualOrder } from '../admin/orders/services/orders';
import { validateRut } from '@/shared/utils/formatters';
import { buildPaymentBreakdownForOrder } from '@/shared/utils/orderUtils';
import { effectiveDeliveryPricingMode } from '@/lib/delivery-settings';
import { canOverrideDeliveryFee } from '../utils/deliveryFeePermissions';
import { normalizeManualPhone } from '../services/clientService';

/**
 * Hook orquestador principal del pedido manual.
 * Delega lógicas específicas a sub-hooks especializados y expone una API unificada compatible.
 */
export const useManualOrder = (showNotify, onOrderSaved, onClose, branch, branchDeliveryCfg = null, userRole = null) => {
    
    // 1. Sub-hook para el Carrito
    const {
        items,
        total,
        addItem,
        updateQuantity,
        removeItem,
        updateItemNote,
        resetCart
    } = useManualOrderCart();

    // 2. Sub-hook para el Formulario
    const {
        form,
        rutValid,
        phoneValid,
        updateClientName,
        updateCouponCode,
        updateNote,
        updateOrderType,
        updateDeliveryAddress,
        updateDeliveryReference,
        updateDeliveryKm,
        updateDeliveryFee,
        updateDeliveryNamedAreaId,
        updatePaymentType,
        updatePaymentMode,
        updateCashAmount,
        updateCardAmount,
        updateCashTendered,
        handleRutChange,
        handlePhoneChange,
        applyClientRecord,
        applySavedAddress,
        resetForm,
        getInputStyle
    } = useManualOrderForm();

    // 3. Sub-hook para Cupones
    const {
        couponPreview,
        resetCoupon
    } = useCouponValidation(
        branch?.company_id,
        form.coupon_code,
        total,
        form.client_phone
    );

    // 4. Sub-hook para Comprobante de Transferencia
    const {
        receiptFile,
        receiptPreview,
        handleFileChange,
        removeReceipt,
        resetReceipt
    } = useReceiptUpload(showNotify);

    const [loading, setLoading] = useState(false);

    // Cambiar tipo de pago y limpiar comprobante si no es transferencia
    const handlePaymentTypeChange = useCallback((type) => {
        updatePaymentType(type);
        if (type !== 'online') {
            resetReceipt();
        }
    }, [updatePaymentType, resetReceipt]);

    // Reseteo global de todo el flujo
    const resetOrder = useCallback(() => {
        resetCart();
        resetForm();
        resetCoupon();
        resetReceipt();
    }, [resetCart, resetForm, resetCoupon, resetReceipt]);

    // Modelo de datos unificado compatible con el modal
    const manualOrder = useMemo(() => {
        return {
            ...form,
            items,
            total
        };
    }, [form, items, total]);

    // Envío del pedido manual
    const submitOrder = async () => {
        if (!branch) {
            showNotify('Error: No hay sucursal seleccionada', 'error');
            return;
        }

        const sanitizeInput = (text) => (text ? String(text).replace(/<[^>]*>/g, '').trim() : '');

        const digitCount = (form.client_phone || '').replace(/\D/g, '').length;
        if (!form.client_name || form.client_name.trim().length < 3 || digitCount < 11 || items.length === 0) {
            showNotify('Faltan datos obligatorios o son incorrectos', 'error');
            return;
        }

        if (form.order_type === 'delivery' && branchDeliveryCfg) {
            const pricing = effectiveDeliveryPricingMode(branchDeliveryCfg);
            const areaCount = Array.isArray(branchDeliveryCfg.namedAreas) ? branchDeliveryCfg.namedAreas.length : 0;

            if (pricing === 'named' && areaCount > 0) {
                const zid = String(form.delivery_named_area_id ?? '').trim();
                if (!zid) {
                    showNotify('Selecciona la zona de entrega', 'error');
                    return;
                }
            } else if (pricing === 'distance') {
                const addr = String(form.delivery_address ?? '').trim();
                if (addr.length < 5) {
                    showNotify('La dirección de despacho es obligatoria para delivery por distancia.', 'error');
                    return;
                }
            } else {
                const addr = String(form.delivery_address ?? '').trim();
                const zid = String(form.delivery_named_area_id ?? '').trim();
                if (addr.length < 5 && !zid) {
                    showNotify('Indica dirección de entrega u otra información de ubicación.', 'error');
                    return;
                }
            }
        } else if (
            form.order_type === 'delivery' &&
            !branchDeliveryCfg
        ) {
            const addr = String(form.delivery_address ?? '').trim();
            if (addr.length < 5) {
                showNotify('La dirección de despacho es obligatoria para Delivery', 'error');
                return;
            }
        }

        if (!form.client_rut || !validateRut(form.client_rut)) {
            showNotify('El RUT ingresado no es válido', 'error');
            return;
        }

        setLoading(true);
        try {
            const sanitizedOrder = {
                ...form,
                items,
                total,
                client_name: sanitizeInput(form.client_name),
                client_phone: normalizeManualPhone(sanitizeInput(form.client_phone)),
                client_rut: sanitizeInput(form.client_rut),
                note: sanitizeInput(form.note),
                branch_id: branch.id,
                company_id: branch.company_id,
                branch_name: branch.name,
                order_type: form.order_type,
                delivery_address:
                    form.order_type === 'delivery'
                        ? sanitizeInput(form.delivery_address) || ''
                        : null,
                delivery_reference:
                    form.order_type === 'delivery'
                        ? sanitizeInput(form.delivery_reference) || ''
                        : '',
                delivery_km:
                    form.order_type === 'delivery'
                        ? form.delivery_km === '' ||
                          form.delivery_km == null
                            ? null
                            : Number(String(form.delivery_km).replace(',', '.'))
                        : null,
                delivery_named_area_id:
                    form.order_type === 'delivery'
                        ? String(form.delivery_named_area_id ?? '').trim() || null
                        : null,
                caller_role: userRole,
                ...(canOverrideDeliveryFee(userRole) && form.order_type === 'delivery'
                    ? { manual_delivery_fee: Number(form.delivery_fee) || 0 }
                    : {}),
                coupon_code: sanitizeInput(form.coupon_code) || '',
            };

            const itemsForOrder = (items || []).map((item) => ({
                id: item.id,
                name: String(item.name ?? ''),
                quantity: Number(item.quantity) || 1,
                price: Number(item.price) || 0,
                has_discount: Boolean(item.has_discount),
                discount_price: item.has_discount && item.discount_price != null ? Number(item.discount_price) : null,
                description: item.description ? String(item.description) : null,
                note: item.note ? sanitizeInput(String(item.note)).slice(0, 140) : null,
                manual_order_source: item.manual_order_source || null,
                is_extra: Boolean(item.is_extra)
            }));

            const totalForOrder = itemsForOrder.reduce((acc, i) => {
                const unit = i.has_discount && i.discount_price && Number(i.discount_price) > 0 ? Number(i.discount_price) : Number(i.price);
                return acc + (unit * i.quantity);
            }, 0);

            sanitizedOrder.items = itemsForOrder;
            sanitizedOrder.total = totalForOrder;

            const couponDisc =
                couponPreview?.variant === 'success' && Number(couponPreview.discount) > 0
                    ? Math.min(totalForOrder, Number(couponPreview.discount))
                    : 0;
            const deliveryFeeAmt =
                form.order_type === 'delivery' ? (Number(form.delivery_fee) || 0) : 0;
            const checkoutTotal = Math.max(0, totalForOrder - couponDisc + deliveryFeeAmt);

            sanitizedOrder.payment_breakdown = buildPaymentBreakdownForOrder({
                payment_mode: form.payment_mode,
                payment_type: form.payment_type,
                cash_amount: form.cash_amount,
                card_amount: form.card_amount,
                total: checkoutTotal,
            });

            const result = await createManualOrder(sanitizedOrder, receiptFile);
            const createdOrder = result?.order ?? result;

            showNotify('Pedido creado con éxito', 'success');
            resetOrder();
            if (onOrderSaved) onOrderSaved(createdOrder);
            if (onClose) onClose();

        } catch (error) {
            showNotify(error.message || 'Error al crear pedido', 'error');
        } finally {
            setLoading(false);
        }
    };

    const isValid = useMemo(() => {
        return form.client_name && items.length > 0;
    }, [form.client_name, items]);

    return {
        manualOrder,
        loading,
        rutValid,
        phoneValid,
        receiptFile,
        receiptPreview,
        updateClientName,
        updateCouponCode,
        couponPreview,
        updateNote,
        updatePaymentType: handlePaymentTypeChange,
        updatePaymentMode,
        updateCashAmount,
        updateCardAmount,
        updateCashTendered,
        handleRutChange,
        handlePhoneChange,
        applyClientRecord,
        applySavedAddress,
        handleFileChange,
        removeReceipt,
        addItem,
        updateQuantity,
        removeItem,
        updateItemNote,
        updateOrderType,
        updateDeliveryAddress,
        updateDeliveryReference,
        updateDeliveryKm,
        updateDeliveryFee,
        updateDeliveryNamedAreaId,
        submitOrder,
        resetOrder,
        isValid,
        getInputStyle
    };
};