import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Store, Truck, MapPin, User, CheckCircle2, Loader2, Banknote } from 'lucide-react';
import { formatCurrency } from '@/shared/utils/formatters';
import { geocodeAddress } from '../../services/geocodeService';
import { geocodeToCoords } from '../../services/placesService';
import { haversineKm, isValidLatLng } from '@/lib/geo';
import {
    computeDeliveryFee,
    effectiveDeliveryPricingMode,
} from '@/lib/delivery-settings';

const sanitizeInputLive = (text) => {
    if (text == null || text === '') return '';
    return text.replace(/[<>]/g, '');
};

const normalizeSearch = (value) => String(value ?? '').trim().toLowerCase();

const filterClientsByNamePrefix = (clients, query) => {
    const q = normalizeSearch(query);
    if (!q || !Array.isArray(clients)) return [];
    return clients
        .filter((c) => normalizeSearch(c?.name).startsWith(q))
        .slice(0, 8);
};

/**
 * Paso Cliente: dos columnas (datos cliente | retiro/delivery).
 */
const ClientForm = ({
    manualOrder,
    branchDeliveryCfg,
    clients = [],
    updateOrderType,
    updateDeliveryAddress,
    updateDeliveryReference,
    updateDeliveryKm,
    updateDeliveryFee,
    updateDeliveryNamedAreaId,
    updateClientName,
    applyClientRecord,
    handleRutChange,
    handlePhoneChange,
    rutValid,
    phoneValid,
    getInputStyle,
    branch,
    showNotify,
}) => {
    const [detectingZone, setDetectingZone] = useState(false);
    const [calculatingDistance, setCalculatingDistance] = useState(false);
    const [clientSuggestionsOpen, setClientSuggestionsOpen] = useState(false);
    const clientSearchRef = useRef(null);

    const isPickup = manualOrder.order_type !== 'delivery';
    const isDelivery = manualOrder.order_type === 'delivery';

    const clientSuggestions = useMemo(
        () => filterClientsByNamePrefix(clients, manualOrder.client_name),
        [clients, manualOrder.client_name],
    );

    const showClientSuggestions =
        clientSuggestionsOpen &&
        clientSuggestions.length > 0 &&
        normalizeSearch(manualOrder.client_name).length >= 1;

    useEffect(() => {
        const onDocClick = (e) => {
            if (!clientSearchRef.current?.contains(e.target)) {
                setClientSuggestionsOpen(false);
            }
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, []);

    const showNamedZonePicker = Boolean(
        branchDeliveryCfg &&
        isDelivery &&
        effectiveDeliveryPricingMode(branchDeliveryCfg) === 'named' &&
        (branchDeliveryCfg.namedAreas?.length ?? 0) > 0,
    );

    const namedAreaAutoMode = showNamedZonePicker &&
        String(branchDeliveryCfg?.namedAreaResolution ?? '').toLowerCase() === 'address_matched';

    const showDistancePricing = Boolean(
        branchDeliveryCfg &&
        isDelivery &&
        effectiveDeliveryPricingMode(branchDeliveryCfg) === 'distance',
    );

    const distanceAutoMode = showDistancePricing &&
        isValidLatLng(branchDeliveryCfg?.originLat, branchDeliveryCfg?.originLng);

    const handleDetectZone = async () => {
        if (detectingZone) return;
        const branchId = String(branch?.id ?? '').trim();
        const address = String(manualOrder.delivery_address ?? '').trim();
        if (!branchId) {
            showNotify?.('Selecciona una sucursal primero.', 'warning');
            return;
        }
        if (!address) {
            showNotify?.('Escribe una dirección para detectar la zona.', 'warning');
            return;
        }
        setDetectingZone(true);
        try {
            const result = await geocodeAddress({ branchId, address });
            if (result.ok) {
                updateDeliveryNamedAreaId(result.namedAreaId);
                showNotify?.(`Zona detectada: ${result.label}`, 'success');
            } else {
                showNotify?.(result.message, 'warning');
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Error al detectar la zona';
            showNotify?.(msg, 'error');
        } finally {
            setDetectingZone(false);
        }
    };

    const handleCalculateDistance = async () => {
        if (calculatingDistance) return;
        const address = String(manualOrder.delivery_address ?? '').trim();
        if (!address) {
            showNotify?.('Escribe una dirección para calcular la distancia.', 'warning');
            return;
        }
        if (!isValidLatLng(branchDeliveryCfg?.originLat, branchDeliveryCfg?.originLng)) {
            showNotify?.(
                'Configura la ubicación del local en Settings para autocalcular distancia.',
                'warning',
            );
            return;
        }
        setCalculatingDistance(true);
        try {
            const result = await geocodeToCoords({ address });
            if (!result.ok) {
                showNotify?.(result.message, 'warning');
                return;
            }
            const km = haversineKm(
                { lat: Number(branchDeliveryCfg.originLat), lng: Number(branchDeliveryCfg.originLng) },
                { lat: result.lat, lng: result.lng },
            );
            const safeKm = Number.isFinite(km) && km >= 0 ? km : 0;
            updateDeliveryKm(safeKm.toFixed(2));
            showNotify?.(
                `Distancia calculada: ${safeKm.toFixed(2)} km (${result.label})`,
                'success',
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Error al calcular la distancia';
            showNotify?.(msg, 'error');
        } finally {
            setCalculatingDistance(false);
        }
    };

    const handleSelectClient = (client) => {
        applyClientRecord?.(client);
        setClientSuggestionsOpen(false);
    };

    const handleClientNameChange = (value) => {
        updateClientName(sanitizeInputLive(value));
        setClientSuggestionsOpen(true);
    };

    const deliveryFields = isDelivery ? (
        <div className="manual-order-fulfillment-fields animate-fade-in">
            {namedAreaAutoMode ? (
                <>
                    <div className="manual-order-input-wrapper full-width">
                        <MapPin size={14} className="manual-order-input-icon" aria-hidden />
                        <input
                            type="text"
                            placeholder="DIRECCIÓN DE ENTREGA *"
                            className="manual-order-input"
                            value={manualOrder.delivery_address}
                            onChange={(e) => updateDeliveryAddress(e.target.value)}
                        />
                    </div>
                    <button
                        type="button"
                        className="manual-order-inline-action"
                        onClick={handleDetectZone}
                        disabled={detectingZone || !manualOrder.delivery_address}
                    >
                        {detectingZone ? (
                            <>
                                <Loader2 size={14} className="animate-spin" />
                                Detectando...
                            </>
                        ) : (
                            <>
                                <MapPin size={14} />
                                Detectar zona
                            </>
                        )}
                    </button>
                </>
            ) : null}

            {showNamedZonePicker ? (
                <div className="manual-order-input-wrapper full-width">
                    <MapPin size={14} className="manual-order-input-icon" aria-hidden />
                    <select
                        id="manual-order-delivery-zone"
                        aria-label="Zona de entrega"
                        className="manual-order-input"
                        value={manualOrder.delivery_named_area_id || ''}
                        onChange={(e) => {
                            const v = e.target.value;
                            updateDeliveryNamedAreaId(v);
                            if (v && branchDeliveryCfg) {
                                const subtotal = Number(manualOrder.total) || 0;
                                const r = computeDeliveryFee(branchDeliveryCfg, 0, subtotal, { namedAreaId: v });
                                if (r.fee >= 0) {
                                    updateDeliveryFee(String(Math.round(r.fee * 100) / 100));
                                }
                            }
                        }}
                    >
                        <option value="">{namedAreaAutoMode ? 'ZONA DETECTADA / SELECCIÓN MANUAL' : 'ZONA DE ENTREGA *'}</option>
                        {(branchDeliveryCfg?.namedAreas ?? []).map((z) => (
                            <option key={z.id} value={z.id}>
                                {z.name} — {formatCurrency(z.feeFlat)}
                            </option>
                        ))}
                    </select>
                </div>
            ) : null}

            {showNamedZonePicker ? (
                <div className="manual-order-input-wrapper full-width">
                    <MapPin size={14} className="manual-order-input-icon manual-order-input-icon--muted" aria-hidden />
                    <input
                        type="text"
                        placeholder="REFERENCIA: CALLE, NÚMERO U OBSERVACIÓN (OPC.)"
                        className="manual-order-input"
                        value={manualOrder.delivery_reference}
                        onChange={(e) => updateDeliveryReference(e.target.value)}
                    />
                </div>
            ) : null}

            {showDistancePricing ? (
                <div className="manual-order-input-wrapper full-width">
                    <MapPin size={14} className="manual-order-input-icon manual-order-input-icon--muted" aria-hidden />
                    <input
                        type="text"
                        inputMode="decimal"
                        placeholder="DISTANCIA APROX. (KM) — OPC."
                        className="manual-order-input"
                        value={manualOrder.delivery_km}
                        onChange={(e) => updateDeliveryKm(e.target.value)}
                    />
                </div>
            ) : null}

            {!showNamedZonePicker ? (
                <div className="manual-order-input-wrapper full-width">
                    <MapPin size={14} className="manual-order-input-icon" aria-hidden />
                    <input
                        type="text"
                        placeholder={showDistancePricing ? 'DIRECCIÓN DE ENTREGA *' : 'DIRECCIÓN DE ENTREGA'}
                        className="manual-order-input"
                        value={manualOrder.delivery_address}
                        onChange={(e) => updateDeliveryAddress(e.target.value)}
                    />
                </div>
            ) : null}

            {distanceAutoMode ? (
                <button
                    type="button"
                    className="manual-order-inline-action"
                    onClick={handleCalculateDistance}
                    disabled={calculatingDistance || !manualOrder.delivery_address}
                >
                    {calculatingDistance ? (
                        <>
                            <Loader2 size={14} className="animate-spin" />
                            Calculando...
                        </>
                    ) : (
                        <>
                            <MapPin size={14} />
                            Calcular distancia
                        </>
                    )}
                </button>
            ) : null}

            {showDistancePricing && !distanceAutoMode && (
                <p className="manual-order-fulfillment-hint">
                    Configura la ubicación del local en Settings → Delivery para autocalcular distancia.
                </p>
            )}

            <div className="manual-order-input-wrapper full-width">
                <Banknote size={14} className="manual-order-input-icon" aria-hidden />
                <input
                    type="number"
                    placeholder={
                        showNamedZonePicker || showDistancePricing
                            ? 'COSTO ENVÍO (calculado; puedes ajustar)'
                            : 'COSTO DE ENVÍO (OPCIONAL)'
                    }
                    className="manual-order-input"
                    value={manualOrder.delivery_fee || ''}
                    onChange={(e) => updateDeliveryFee(e.target.value)}
                />
            </div>
        </div>
    ) : (
        <p className="manual-order-fulfillment-hint manual-order-fulfillment-hint--pickup">
            El cliente retira en el local. No se requieren datos de despacho.
        </p>
    );

    return (
        <div className="manual-order-client-form-component">
            <div className="manual-order-client-columns">
                {/* Columna 1: datos cliente */}
                <div className="manual-order-client-col manual-order-client-col--customer">
                    <div className="manual-order-section manual-order-section--flat">
                        <div className="manual-order-section-title">
                            <User size={14} aria-hidden />
                            DATOS CLIENTE
                        </div>

                        <div className="manual-order-form-grid">
                            <div
                                className="manual-order-input-wrapper full-width manual-order-client-search"
                                ref={clientSearchRef}
                            >
                                <input
                                    type="text"
                                    placeholder="NOMBRE COMPLETO *"
                                    className="manual-order-input"
                                    value={manualOrder.client_name}
                                    onChange={(e) => handleClientNameChange(e.target.value)}
                                    onFocus={() => setClientSuggestionsOpen(true)}
                                    autoComplete="off"
                                    aria-label="Nombre completo del cliente"
                                    aria-expanded={showClientSuggestions}
                                    aria-controls="manual-order-client-suggestions"
                                    style={{
                                        paddingRight: manualOrder.client_name.length >= 3 ? '40px' : '16px',
                                    }}
                                />
                                {manualOrder.client_name.length >= 3 && (
                                    <div className="manual-order-validation-icon">
                                        <CheckCircle2 size={18} color="#25d366" />
                                    </div>
                                )}
                                {showClientSuggestions && (
                                    <ul
                                        id="manual-order-client-suggestions"
                                        className="manual-order-client-suggestions"
                                        role="listbox"
                                    >
                                        {clientSuggestions.map((client) => (
                                            <li key={client.id} role="option">
                                                <button
                                                    type="button"
                                                    className="manual-order-client-suggestion"
                                                    onMouseDown={(e) => e.preventDefault()}
                                                    onClick={() => handleSelectClient(client)}
                                                >
                                                    <span className="manual-order-client-suggestion__name">
                                                        {client.name}
                                                    </span>
                                                    <span className="manual-order-client-suggestion__meta">
                                                        {[client.rut, client.phone].filter(Boolean).join(' · ')}
                                                    </span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>

                            <div className="manual-order-input-wrapper">
                                <input
                                    type="text"
                                    placeholder="RUT *"
                                    className="manual-order-input"
                                    value={manualOrder.client_rut}
                                    onChange={handleRutChange}
                                    style={{
                                        ...getInputStyle(rutValid),
                                        paddingRight: rutValid ? '40px' : '16px',
                                    }}
                                />
                                {rutValid && (
                                    <div className="manual-order-validation-icon">
                                        <CheckCircle2 size={18} color="#25d366" />
                                    </div>
                                )}
                            </div>

                            <div className="manual-order-input-wrapper">
                                <input
                                    type="tel"
                                    placeholder="+56 9..."
                                    className="manual-order-input"
                                    value={manualOrder.client_phone}
                                    onChange={handlePhoneChange}
                                    style={{
                                        ...getInputStyle(phoneValid),
                                        paddingRight: phoneValid ? '40px' : '16px',
                                    }}
                                />
                                {phoneValid && (
                                    <div className="manual-order-validation-icon">
                                        <CheckCircle2 size={18} color="#25d366" />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Columna 2: retiro / delivery */}
                <div className="manual-order-client-col manual-order-client-col--fulfillment">
                    <div className="manual-order-section manual-order-section--flat">
                        <div className="manual-order-section-title">
                            <Truck size={14} aria-hidden />
                            RETIRO O DELIVERY
                        </div>

                        <div className="manual-order-order-type-toggle">
                            <button
                                type="button"
                                className={`manual-order-order-type-btn${isPickup ? ' is-active' : ''}`}
                                onClick={() => updateOrderType('pickup')}
                            >
                                <Store size={16} />
                                LOCAL / RETIRO
                            </button>
                            <button
                                type="button"
                                className={`manual-order-order-type-btn${isDelivery ? ' is-active' : ''}`}
                                onClick={() => updateOrderType('delivery')}
                            >
                                <Truck size={16} />
                                DELIVERY
                            </button>
                        </div>

                        {deliveryFields}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default React.memo(ClientForm);
