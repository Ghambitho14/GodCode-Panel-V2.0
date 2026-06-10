import { useState, useCallback } from 'react';
import { formatRut, validateRut } from '@/shared/utils/formatters';
import { computeDeliveryFee } from '@/lib/delivery-settings';
import {
    normalizeManualPhone,
    fetchClientAddresses,
    mapAddressToFormFields,
} from '../../services/clientService';

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
    selected_client_id: '',
    saved_addresses: [],
    selected_address_id: '',
};

function resolveDeliveryFeeForAddress(branchDeliveryCfg, subtotal, namedAreaId) {
    if (!branchDeliveryCfg || !namedAreaId) return null;
    const r = computeDeliveryFee(branchDeliveryCfg, 0, Number(subtotal) || 0, {
        namedAreaId,
    });
    return r.fee >= 0 ? Math.round(r.fee * 100) / 100 : null;
}

function mergeAddressIntoForm(prev, addressRow, branchDeliveryCfg, subtotal) {
    const fields = mapAddressToFormFields(addressRow);
    const addressId = addressRow?.id != null ? String(addressRow.id) : '';
    const feeFromZone = resolveDeliveryFeeForAddress(
        branchDeliveryCfg,
        subtotal,
        fields.delivery_named_area_id,
    );

    return {
        ...prev,
        ...fields,
        selected_address_id: addressId,
        ...(feeFromZone != null ? { delivery_fee: feeFromZone } : {}),
    };
}

/**
 * Hook especializado en gestionar todos los estados del formulario del pedido manual:
 * nombre del cliente, RUT (formateo y validación), teléfono, notas del pedido, tipo de despacho,
 * dirección de entrega, kilómetros, tarifas y comprobantes de pago.
 */
export const useManualOrderForm = () => {
    const [form, setForm] = useState(() => ({ ...initialFormState }));
    const [rutValid, setRutValid] = useState(true);
    const [phoneValid, setPhoneValid] = useState(true);

    const applySavedAddress = useCallback((addressRow, branchDeliveryCfg, subtotal = 0) => {
        if (!addressRow || typeof addressRow !== 'object') return;
        setForm((prev) => mergeAddressIntoForm(prev, addressRow, branchDeliveryCfg, subtotal));
    }, []);

    const updateClientName = useCallback((val, opts = {}) => {
        setForm((prev) => {
            const next = { ...prev, client_name: val };
            if (!opts.fromClientSelect && prev.selected_client_id) {
                next.selected_client_id = '';
                next.saved_addresses = [];
                next.selected_address_id = '';
            }
            return next;
        });
    }, []);

    const updateCouponCode = useCallback((val) => {
        setForm(prev => ({ ...prev, coupon_code: typeof val === 'string' ? val : '' }));
    }, []);

    const updateNote = useCallback((val) => {
        setForm(prev => ({ ...prev, note: val }));
    }, []);

    const updateOrderType = useCallback((val, branchDeliveryCfg = null, subtotal = 0) => {
        setForm((prev) => {
            if (val === 'pickup') {
                return {
                    ...prev,
                    order_type: val,
                    delivery_named_area_id: '',
                    delivery_fee: 0,
                    delivery_address: '',
                    delivery_reference: '',
                    delivery_km: '',
                    selected_address_id: '',
                };
            }

            const next = { ...prev, order_type: val };
            if (
                val === 'delivery' &&
                Array.isArray(prev.saved_addresses) &&
                prev.saved_addresses.length > 0 &&
                !prev.delivery_address &&
                !prev.delivery_reference &&
                !prev.delivery_named_area_id
            ) {
                return mergeAddressIntoForm(
                    next,
                    prev.saved_addresses[0],
                    branchDeliveryCfg,
                    subtotal,
                );
            }
            return next;
        });
    }, []);

    const updateDeliveryAddress = useCallback((val) => {
        setForm(prev => ({ ...prev, delivery_address: val, selected_address_id: '' }));
    }, []);

    const updateDeliveryReference = useCallback((val) => {
        setForm((prev) => ({
            ...prev,
            delivery_reference: typeof val === 'string' ? val : '',
            selected_address_id: '',
        }));
    }, []);

    const updateDeliveryKm = useCallback((val) => {
        setForm((prev) => ({
            ...prev,
            delivery_km: val === '' || val == null ? '' : String(val),
            selected_address_id: '',
        }));
    }, []);

    const updateDeliveryFee = useCallback((val) => {
        setForm(prev => ({ ...prev, delivery_fee: Number(val) || 0 }));
    }, []);

    const updateDeliveryNamedAreaId = useCallback((val) => {
        setForm((prev) => ({
            ...prev,
            delivery_named_area_id: typeof val === 'string' ? val : '',
            selected_address_id: '',
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
        setForm((prev) => ({
            ...prev,
            client_phone: cleaned,
            ...(prev.selected_client_id ? {
                selected_client_id: '',
                saved_addresses: [],
                selected_address_id: '',
            } : {}),
        }));

        const digitCount = cleaned.replace(/\D/g, '').length;
        setPhoneValid(digitCount >= 11);
    }, []);

    const applyClientRecord = useCallback(async (client, opts = {}) => {
        if (!client || typeof client !== 'object') return;

        const { branchDeliveryCfg = null, subtotal = 0 } = opts;
        const name = String(client.name ?? '').trim();
        const rutRaw = String(client.rut ?? client.document ?? '').trim();
        const rut = rutRaw ? formatRut(rutRaw) : '';
        const phone = normalizeManualPhone(client.phone) || '+56 9 ';
        const clientId = client.id != null ? String(client.id) : '';

        let savedAddresses = [];
        if (clientId) {
            try {
                savedAddresses = await fetchClientAddresses(clientId);
            } catch {
                savedAddresses = [];
            }
        }

        setForm((prev) => {
            let next = {
                ...prev,
                client_name: name || prev.client_name,
                client_rut: rut || prev.client_rut,
                client_phone: phone || prev.client_phone,
                selected_client_id: clientId,
                saved_addresses: savedAddresses,
                selected_address_id: '',
            };

            if (prev.order_type === 'delivery' && savedAddresses.length > 0) {
                next = mergeAddressIntoForm(
                    next,
                    savedAddresses[0],
                    branchDeliveryCfg,
                    subtotal,
                );
            }

            return next;
        });

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
        applySavedAddress,
        resetForm,
        getInputStyle
    };
};
