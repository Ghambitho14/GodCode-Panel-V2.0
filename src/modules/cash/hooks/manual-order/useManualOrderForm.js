import { useState, useCallback } from 'react';
import { formatRut, validateRut } from '@/shared/utils/formatters';

const initialFormState = {
    client_name: 'CAJA',
    client_rut: '1-9',
    client_phone: '+56 9 0000 0000',
    payment_type: 'tienda',
    payment_mode: 'single',
    cash_amount: 0,
    card_amount: 0,
    cash_tendered: '',
    order_type: 'pickup',
    delivery_address: '',
    delivery_reference: '',
    delivery_km: '',
    delivery_fee: 0,
    delivery_named_area_id: '',
    note: '',
    coupon_code: '',
};

/**
 * Hook especializado en gestionar todos los estados del formulario del pedido manual:
 * nombre del cliente, RUT (formateo y validación), teléfono, notas del pedido, tipo de despacho,
 * dirección de entrega, kilómetros, tarifas y comprobantes de pago.
 */
export const useManualOrderForm = () => {
    const [form, setForm] = useState(() => ({ ...initialFormState }));
    const [rutValid, setRutValid] = useState(true);
    const [phoneValid, setPhoneValid] = useState(true);

    const updateClientName = useCallback((val) => {
        setForm(prev => ({ ...prev, client_name: val }));
    }, []);

    const updateCouponCode = useCallback((val) => {
        setForm(prev => ({ ...prev, coupon_code: typeof val === 'string' ? val : '' }));
    }, []);

    const updateNote = useCallback((val) => {
        setForm(prev => ({ ...prev, note: val }));
    }, []);

    const updateOrderType = useCallback((val) => {
        setForm((prev) => ({
            ...prev,
            order_type: val,
            ...(val === 'pickup'
                ? {
                    delivery_named_area_id: '',
                    delivery_fee: 0,
                    delivery_address: '',
                    delivery_reference: '',
                    delivery_km: '',
                  }
                : {}),
        }));
    }, []);

    const updateDeliveryAddress = useCallback((val) => {
        setForm(prev => ({ ...prev, delivery_address: val }));
    }, []);

    const updateDeliveryReference = useCallback((val) => {
        setForm((prev) => ({
            ...prev,
            delivery_reference: typeof val === 'string' ? val : '',
        }));
    }, []);

    const updateDeliveryKm = useCallback((val) => {
        setForm((prev) => ({
            ...prev,
            delivery_km: val === '' || val == null ? '' : String(val),
        }));
    }, []);

    const updateDeliveryFee = useCallback((val) => {
        setForm((prev) => ({ ...prev, delivery_fee: Number(val) || 0 }));
    }, []);

    const updateDeliveryNamedAreaId = useCallback((val) => {
        setForm((prev) => ({
            ...prev,
            delivery_named_area_id: typeof val === 'string' ? val : '',
        }));
    }, []);

    const updatePaymentType = useCallback((type) => {
        setForm(prev => ({
            ...prev,
            payment_type: type,
            payment_mode: 'single',
            cash_amount: 0,
            card_amount: 0,
            cash_tendered: '',
        }));
    }, []);

    const updatePaymentMode = useCallback((mode) => {
        setForm(prev => ({
            ...prev,
            payment_mode: mode === 'mixed' ? 'mixed' : 'single',
            cash_amount: mode === 'mixed' ? prev.cash_amount : 0,
            card_amount: mode === 'mixed' ? prev.card_amount : 0,
            cash_tendered: '',
            ...(mode === 'mixed' ? { payment_type: 'tienda' } : {}),
        }));
    }, []);

    const updateCashAmount = useCallback((val) => {
        const parsed = val === '' || val == null ? 0 : Math.max(0, Math.round(Number(String(val).replace(/\D/g, '')) || 0));
        setForm(prev => ({ ...prev, cash_amount: parsed, cash_tendered: '' }));
    }, []);

    const updateCardAmount = useCallback((val) => {
        const parsed = val === '' || val == null ? 0 : Math.max(0, Math.round(Number(String(val).replace(/\D/g, '')) || 0));
        setForm(prev => ({ ...prev, card_amount: parsed }));
    }, []);

    const updateCashTendered = useCallback((val) => {
        if (val === '' || val == null) {
            setForm(prev => ({ ...prev, cash_tendered: '' }));
            return;
        }
        const parsed = Math.max(0, Math.round(Number(String(val).replace(/\D/g, '')) || 0));
        setForm(prev => ({ ...prev, cash_tendered: parsed }));
    }, []);

    const handleRutChange = useCallback((e) => {
        const rawValue = e.target.value;
        const formatted = formatRut(rawValue);
        setForm(prev => ({ ...prev, client_rut: formatted }));
        setRutValid(validateRut(formatted));
    }, []);

    const handlePhoneChange = useCallback((e) => {
        let input = e.target.value;
        if (!input.startsWith("+56 9")) {
            if (input.length < 6) input = "+56 9 ";
        }
        const cleaned = input;
        setForm(prev => ({ ...prev, client_phone: cleaned }));

        const digitCount = cleaned.replace(/\D/g, '').length;
        setPhoneValid(digitCount >= 11);
    }, []);

    const applyClientRecord = useCallback((client) => {
        if (!client || typeof client !== 'object') return;
        const name = String(client.name ?? '').trim();
        const rutRaw = String(client.rut ?? client.document ?? '').trim();
        const rut = rutRaw ? formatRut(rutRaw) : '';
        let phone = String(client.phone ?? '').trim();
        if (!phone.startsWith('+56 9')) {
            const digits = phone.replace(/\D/g, '');
            if (digits.length >= 9) {
                const local = digits.startsWith('56') ? digits.slice(2) : digits;
                phone = local.startsWith('9') ? `+56 ${local}` : `+56 9 ${local}`;
            } else if (!phone) {
                phone = '+56 9 ';
            }
        }
        setForm((prev) => ({
            ...prev,
            client_name: name || prev.client_name,
            client_rut: rut || prev.client_rut,
            client_phone: phone || prev.client_phone,
        }));
        setRutValid(rut ? validateRut(rut) : false);
        const digitCount = phone.replace(/\D/g, '').length;
        setPhoneValid(digitCount >= 11);
    }, []);

    const resetForm = useCallback(() => {
        setForm({ ...initialFormState });
        setRutValid(true);
        setPhoneValid(true);
    }, []);

    const getInputStyle = useCallback((isValid) => {
        if (isValid === true) return { borderColor: '#25d366', boxShadow: '0 0 0 1px #25d366' };
        if (isValid === false) return { borderColor: '#ff4444', boxShadow: '0 0 0 1px #ff4444' };
        return {};
    }, []);

    return {
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
        resetForm,
        getInputStyle
    };
};
