import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, MessageCircle, ShoppingBag } from 'lucide-react';
import { formatCurrency } from '@/shared/utils/formatters';
import { useManualOrder } from '../hooks/useManualOrder';
import { useOrderEdit } from '../hooks/useOrderEdit';
import { branchSettingsService } from '../services/branchSettingsService';
import { normalizeDeliverySettings } from '@/lib/delivery-settings';
import { buildDeliveryAddressRecord, validateCheckoutPayment } from '@/shared/utils/orderUtils';
import { printOrderTicket } from '@/modules/cash/admin/utils/receiptPrinting';
import { useAdmin } from '@/modules/cash/admin/pages/AdminProvider';
import { canOverrideDeliveryFee } from '../utils/deliveryFeePermissions';

// Subcomponentes presentacionales
import ManualOrderCatalog from './manual-order/ManualOrderCatalog';
import ClientForm from './manual-order/ClientForm';
import OrderSummary from './manual-order/OrderSummary';
import PaymentDetails from './manual-order/PaymentDetails';

function branchFlag(map, branchId, defaultOn = true) {
    if (!branchId || !map || typeof map !== 'object') return defaultOn;
    if (Object.prototype.hasOwnProperty.call(map, branchId)) {
        return map[branchId] !== false;
    }
    return defaultOn;
}

function normalizeCartUpsellCatalog(catalog, kind) {
    if (!Array.isArray(catalog)) return [];
    return catalog.flatMap((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
        const id = String(row.id ?? '').trim();
        const name = String(row.name ?? '').trim();
        const price = Number(row.price);
        if (!id || !name || !Number.isFinite(price) || price < 0) return [];
        const category = String(row.category ?? row.catalogCategory ?? row.group ?? '').trim();
        const beverageKind = String(row.beverageKind ?? row.beverage_kind ?? '').trim();
        const imageUrl = String(row.imageUrl ?? row.image_url ?? '').trim();

        if (row.active === false || row.is_active === false || row.enabled === false) return [];

        return [{
            id,
            name,
            price,
            has_discount: false,
            discount_price: null,
            image_url: imageUrl,
            description: beverageKind || null,
            category_name: category,
            manual_order_source: kind,
            is_active: true,
        }];
    });
}

const DESKTOP_WIZARD_STEPS = 2;
const MOBILE_WIZARD_STEPS = 3;

const ManualOrderModal = ({
    isOpen,
    onClose,
    products = [],
    categories = [],
    clients = [],
    editOrder = null,
    initialStep = 1,
    moveOrder = null,
    onOrderSaved,
    showNotify,
    branch,
    logoUrl,
    companyName,
    resyncOrderSale = null,
}) => {
    const { userRole } = useAdmin();
    const canEditDeliveryFee = canOverrideDeliveryFee(userRole);
    const isEditMode = Boolean(editOrder?.id);
    // --- ESTADOS LOCALES DE CONFIGURACIÓN Y CATÁLOGO DE UPSELL ---
    const [branchDeliveryCfg, setBranchDeliveryCfg] = useState(null);
    const [cartUpsellCatalogs, setCartUpsellCatalogs] = useState({
        beveragesEnabled: false,
        extrasEnabled: false,
        beverages: [],
        extras: [],
    });

    const createHook = useManualOrder(
        showNotify,
        isEditMode ? undefined : onOrderSaved,
        onClose,
        branch,
        branchDeliveryCfg,
        userRole,
    );

    const editHook = useOrderEdit(
        showNotify,
        isEditMode ? onOrderSaved : undefined,
        onClose,
        branch,
        branchDeliveryCfg,
        isEditMode ? editOrder : null,
        resyncOrderSale,
        userRole,
    );

    const {
        manualOrder, loading, rutValid, phoneValid,
        receiptFile, receiptPreview,
        updateClientName, updateCouponCode, couponPreview, updateNote, updatePaymentType,
        updatePaymentMode, updateCashAmount, updateCardAmount, updateCashTendered,
        handleRutChange,
        handlePhoneChange, handleFileChange, removeReceipt, addItem, updateQuantity, removeItem,
        updateItemNote,
        updateOrderType, updateDeliveryAddress, updateDeliveryReference, updateDeliveryKm,
        updateDeliveryFee, updateDeliveryNamedAreaId,
        applyClientRecord,
        submitOrder, resetOrder, getInputStyle,
    } = isEditMode ? editHook : createHook;

    // --- WIZARD (2 pasos: Productos + Checkout) ---
    const [orderStep, setOrderStep] = useState(1);
    const [isCompactNav, setIsCompactNav] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.matchMedia('(max-width: 767px)').matches;
    });

    const [touchStart, setTouchStart] = useState(null);
    const [touchEnd, setTouchEnd] = useState(null);
    const wasOpenRef = useRef(false);

    const wizardStepCount = isCompactNav ? MOBILE_WIZARD_STEPS : DESKTOP_WIZARD_STEPS;

    const resolveOpenStep = (compact) => {
        if (!isEditMode) return 1;
        const n = Number(initialStep);
        if (!Number.isFinite(n)) return 1;
        const rounded = Math.round(n);
        const maxSteps = compact ? MOBILE_WIZARD_STEPS : DESKTOP_WIZARD_STEPS;
        const legacyMapped = compact
            ? (rounded >= 3 ? 3 : Math.max(1, rounded))
            : (rounded >= 3 ? 2 : rounded);
        return Math.min(maxSteps, Math.max(1, legacyMapped));
    };

    useEffect(() => {
        if (isOpen && !wasOpenRef.current) {
            resetOrder();
            setOrderStep(resolveOpenStep(isCompactNav));
        }
        wasOpenRef.current = isOpen;
    }, [isOpen, resetOrder, isEditMode, initialStep, isCompactNav]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const mq = window.matchMedia('(max-width: 767px)');
        const sync = () => setIsCompactNav(mq.matches);
        sync();
        mq.addEventListener('change', sync);
        return () => mq.removeEventListener('change', sync);
    }, []);

    useEffect(() => {
        setOrderStep((prev) => {
            const max = isCompactNav ? MOBILE_WIZARD_STEPS : DESKTOP_WIZARD_STEPS;
            if (prev <= max) return prev;
            if (!isCompactNav && prev === 3) return 2;
            return max;
        });
    }, [isCompactNav]);

    // Cargar Catálogos de Upsell de la Sucursal al abrir
    useEffect(() => {
        let cancelled = false;
        const resetCatalogs = () => {
            setCartUpsellCatalogs({
                beveragesEnabled: false,
                extrasEnabled: false,
                beverages: [],
                extras: [],
            });
        };

        if (!isOpen || !branch?.id || branch.id === 'all') {
            resetCatalogs();
            setBranchDeliveryCfg(null);
            return undefined;
        }

        const loadCatalogs = async () => {
            try {
                const data = await branchSettingsService.getDeliveryConfig(branch.id);
                if (cancelled) return;
                if (!data) {
                    resetCatalogs();
                    setBranchDeliveryCfg(null);
                    return;
                }

                setBranchDeliveryCfg({
                    ...normalizeDeliverySettings(data),
                    originLat: data.originLat ?? null,
                    originLng: data.originLng ?? null,
                });
                setCartUpsellCatalogs({
                    beveragesEnabled: branchFlag(data.beveragesUpsellEnabledByBranch, branch.id, true),
                    extrasEnabled: branchFlag(data.extrasEnabledByBranch, branch.id, true),
                    beverages: normalizeCartUpsellCatalog(data.cartBeveragesCatalog, 'beverages'),
                    extras: normalizeCartUpsellCatalog(data.cartGlobalExtrasCatalog, 'extras'),
                });
            } catch {
                if (!cancelled) {
                    resetCatalogs();
                    setBranchDeliveryCfg(null);
                }
            }
        };

        void loadCatalogs();
        return () => {
            cancelled = true;
        };
    }, [isOpen, branch?.id]);

    // --- IMPRESIÓN DE TICKETS ---
    const manualOrderForTicket = useMemo(() => {
        if (manualOrder.order_type !== 'delivery') return manualOrder;
        const nid = String(manualOrder.delivery_named_area_id ?? '').trim();
        const nlab = nid && branchDeliveryCfg?.namedAreas?.length
            ? String(branchDeliveryCfg.namedAreas.find((z) => z.id === nid)?.name ?? '')
            : '';
        const da = buildDeliveryAddressRecord({
            rawAddress: manualOrder.delivery_address,
            deliveryReference: manualOrder.delivery_reference,
            namedAreaId: nid || null,
            namedAreaLabel: nlab || null,
        });
        return {
            ...manualOrder,
            delivery_address: da,
            delivery_fee: Number(manualOrder.delivery_fee) || 0,
            channel: 'delivery',
        };
    }, [manualOrder, branchDeliveryCfg]);

    const ticketOpts = (variant) => ({
        variant,
        branchAddress: branch?.address ?? null,
        orderChannel: 'PDV',
        companyName: companyName ?? null,
    });

    const printManualKitchen = () => {
        printOrderTicket(manualOrderForTicket, branch?.name, logoUrl ?? null, ticketOpts('kitchen'));
    };

    const printManualCaja = () => {
        printOrderTicket(manualOrderForTicket, branch?.name, logoUrl ?? null, ticketOpts('cashier'));
    };

    // --- TECLA ESCAPE PARA CERRAR ---
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // --- GESTOS MÓVILES (DESLIZAR HACIA ABAJO PARA CERRAR) ---
    const onTouchStart = (e) => {
        setTouchEnd(null);
        setTouchStart(e.targetTouches[0].clientY);
    };
    const onTouchMove = (e) => setTouchEnd(e.targetTouches[0].clientY);
    const onTouchEnd = () => {
        if (!touchStart || !touchEnd) return;
        const distance = touchStart - touchEnd;
        if (distance < -50) onClose(); // Swipe hacia abajo
    };

    const couponDiscountApplied =
        couponPreview?.variant === 'success' && Number(couponPreview.discount) > 0
            ? Math.min(manualOrder.total ?? 0, Number(couponPreview.discount))
            : 0;
    const deliveryFeeAmt =
        manualOrder.order_type === 'delivery' ? (Number(manualOrder.delivery_fee) || 0) : 0;
    const totalToPay = Math.max(0, (manualOrder.total ?? 0) - couponDiscountApplied + deliveryFeeAmt);

    const isPaymentValid = () => {
        if (totalToPay <= 0) return true;
        return validateCheckoutPayment({
            payment_mode: manualOrder.payment_mode,
            payment_type: manualOrder.payment_type,
            cash_amount: manualOrder.cash_amount,
            card_amount: manualOrder.card_amount,
            cash_tendered: manualOrder.cash_tendered,
            totalToPay,
        }).valid;
    };

    // --- VALIDACIÓN GLOBAL DEL FORMULARIO ---
    const isFormValid = () => {
        const hasItems = manualOrder.items && manualOrder.items.length > 0;
        const hasClientName = manualOrder.client_name && manualOrder.client_name.trim().length >= 3;
        const hasPaymentType = !!manualOrder.payment_type;
        const paymentOk = isPaymentValid();

        if (isEditMode) {
            return hasItems && hasClientName && hasPaymentType && paymentOk;
        }

        const exactRutLength = manualOrder.client_rut?.trim().length || 0;
        const isRutRequiredAndValid = exactRutLength > 0 && rutValid;
        const isPhoneStrictlyValid = phoneValid === true;

        const namedAreasMode = branchDeliveryCfg &&
            manualOrder.order_type === 'delivery' &&
            String(branchDeliveryCfg.pricingMode).toLowerCase() === 'named' &&
            (branchDeliveryCfg.namedAreas?.length ?? 0) > 0;
            
        const distanceMode = branchDeliveryCfg &&
            manualOrder.order_type === 'delivery' &&
            String(branchDeliveryCfg.pricingMode).toLowerCase() === 'distance';

        const hasNamedZoneOk = !namedAreasMode || String(manualOrder.delivery_named_area_id ?? '').trim().length > 0;
        const addrOk = Boolean(manualOrder.delivery_address && manualOrder.delivery_address.trim().length >= 5);
        
        const isDeliveryValid = manualOrder.order_type !== 'delivery'
            || (namedAreasMode && hasNamedZoneOk)
            || (distanceMode && addrOk)
            || (
                !namedAreasMode &&
                !distanceMode &&
                manualOrder.order_type === 'delivery' &&
                branchDeliveryCfg &&
                (addrOk || String(manualOrder.delivery_named_area_id ?? '').trim().length > 0)
            )
            || (
                manualOrder.order_type === 'delivery' &&
                !branchDeliveryCfg &&
                addrOk
            );

        return hasItems && hasClientName && hasPaymentType && paymentOk && isRutRequiredAndValid && isPhoneStrictlyValid && isDeliveryValid;
    };

    const isDeliveryValidForOrder = () => {
        const namedAreasMode = branchDeliveryCfg &&
            manualOrder.order_type === 'delivery' &&
            String(branchDeliveryCfg.pricingMode).toLowerCase() === 'named' &&
            (branchDeliveryCfg.namedAreas?.length ?? 0) > 0;

        const distanceMode = branchDeliveryCfg &&
            manualOrder.order_type === 'delivery' &&
            String(branchDeliveryCfg.pricingMode).toLowerCase() === 'distance';

        const hasNamedZoneOk = !namedAreasMode || String(manualOrder.delivery_named_area_id ?? '').trim().length > 0;
        const addrOk = Boolean(manualOrder.delivery_address && manualOrder.delivery_address.trim().length >= 5);

        return manualOrder.order_type !== 'delivery'
            || (namedAreasMode && hasNamedZoneOk)
            || (distanceMode && addrOk)
            || (
                !namedAreasMode &&
                !distanceMode &&
                manualOrder.order_type === 'delivery' &&
                branchDeliveryCfg &&
                (addrOk || String(manualOrder.delivery_named_area_id ?? '').trim().length > 0)
            )
            || (
                manualOrder.order_type === 'delivery' &&
                !branchDeliveryCfg &&
                addrOk
            );
    };

    const isClientStepValid = () => {
        const hasClientName = manualOrder.client_name && manualOrder.client_name.trim().length >= 3;
        return Boolean(hasClientName && isDeliveryValidForOrder());
    };

    const hasCartItems = (manualOrder.items?.length ?? 0) > 0;
    const cartItemCount = (manualOrder.items ?? []).reduce((acc, i) => acc + (Number(i.quantity) || 1), 0);

    const goNextStep = () => {
        if (orderStep >= wizardStepCount) return;

        if (orderStep === 1) {
            if (!hasCartItems) {
                showNotify?.('Agrega al menos un producto al carrito.', 'warning');
                return;
            }
            setOrderStep(2);
            return;
        }

        if (isCompactNav && orderStep === 2) {
            if (!isClientStepValid()) {
                showNotify?.('Completa el nombre del cliente y los datos de entrega.', 'warning');
                return;
            }
            setOrderStep(3);
        }
    };

    const goPrevStep = () => {
        setOrderStep((prev) => (prev > 1 ? prev - 1 : prev));
    };

    const canCancelOrder = Boolean(
        isEditMode &&
        moveOrder &&
        editOrder?.id &&
        String(editOrder?.status ?? '').toLowerCase() !== 'cancelled',
    );

    const handleCancelOrder = async () => {
        if (!canCancelOrder || loading) return;
        const status = String(editOrder?.status ?? '').toLowerCase();
        const stageLabel =
            status === 'pending' ? 'Pendiente' :
            status === 'active' ? 'En cocina' :
            status === 'completed' ? 'Listo' :
            status === 'picked_up' ? 'Entregado' :
            status;
        const refundWarning = '\n\nSi el pedido tiene venta registrada en caja, se aplicará una devolución automática.';
        const ok = typeof window !== 'undefined'
            ? window.confirm(`Cancelar pedido #${editOrder.id} (estado: ${stageLabel})?${refundWarning}`)
            : true;
        if (!ok) return;
        try {
            await moveOrder(editOrder.id, 'cancelled');
            onClose?.();
        } catch {
            // moveOrder ya notifica errores
        }
    };

    if (!isOpen) return null;

    const sanitizeNote = (text) => {
        if (text == null || text === '') return '';
        return text.replace(/[<>]/g, '');
    };

    const stepLabels = isCompactNav
        ? ['Productos', 'Cliente', 'Pago']
        : ['Productos', 'Cliente y pago'];

    const noteSection = (
        <div className="manual-order-section manual-order-section--note">
            <div className="manual-order-section-title manual-order-section-title--note">
                <MessageCircle size={12} aria-hidden />
                NOTA DEL PEDIDO
            </div>
            <div className="manual-order-note-wrap">
                <textarea
                    placeholder="Nota opcional..."
                    className="manual-order-input manual-order-note-textarea"
                    value={manualOrder.note}
                    onChange={(e) => updateNote(sanitizeNote(e.target.value))}
                    rows={2}
                    maxLength={500}
                    aria-label="Nota o comentario del pedido"
                />
                {manualOrder.note.length > 0 && (
                    <div
                        className={
                            manualOrder.note.length > 450
                                ? 'manual-order-note-count manual-order-note-count--warn'
                                : 'manual-order-note-count'
                        }
                    >
                        {manualOrder.note.length}/500
                    </div>
                )}
            </div>
        </div>
    );

    const clientSection = (
        <ClientForm
            manualOrder={manualOrder}
            branchDeliveryCfg={branchDeliveryCfg}
            clients={clients}
            updateOrderType={updateOrderType}
            updateDeliveryAddress={updateDeliveryAddress}
            updateDeliveryReference={updateDeliveryReference}
            updateDeliveryKm={updateDeliveryKm}
            updateDeliveryFee={updateDeliveryFee}
            updateDeliveryNamedAreaId={updateDeliveryNamedAreaId}
            updateClientName={updateClientName}
            applyClientRecord={applyClientRecord}
            handleRutChange={handleRutChange}
            handlePhoneChange={handlePhoneChange}
            rutValid={rutValid}
            phoneValid={phoneValid}
            getInputStyle={getInputStyle}
            branch={branch}
            showNotify={showNotify}
            canOverrideDeliveryFee={canEditDeliveryFee}
        />
    );

    const showEditSaveOnFooter = isEditMode && orderStep === 1;

    const wizardNavButtons = (
        <div
            className={`manual-order-footer-nav${showEditSaveOnFooter ? ' manual-order-footer-nav--edit' : ''}`}
            role="group"
            aria-label="Navegación del pedido"
        >
            {orderStep > 1 ? (
                <button
                    type="button"
                    className="manual-order-steps-nav__btn manual-order-steps-nav__btn--back"
                    onClick={goPrevStep}
                >
                    Atrás
                </button>
            ) : (
                <span className="manual-order-steps-nav__spacer" aria-hidden />
            )}
            {showEditSaveOnFooter ? (
                <>
                    <button
                        type="button"
                        className="manual-order-steps-nav__btn manual-order-steps-nav__btn--next-secondary"
                        onClick={goNextStep}
                        disabled={!hasCartItems}
                    >
                        Siguiente
                    </button>
                    <button
                        type="button"
                        className="manual-order-steps-nav__btn manual-order-steps-nav__btn--save"
                        onClick={submitOrder}
                        disabled={loading}
                    >
                        {loading ? 'GUARDANDO...' : 'Guardar cambios'}
                    </button>
                </>
            ) : orderStep === 1 ? (
                <button
                    type="button"
                    className="manual-order-steps-nav__btn manual-order-steps-nav__btn--next"
                    onClick={goNextStep}
                    disabled={!hasCartItems}
                >
                    Siguiente
                </button>
            ) : null}
        </div>
    );

    const orderSummaryProps = {
        manualOrder,
        updateQuantity,
        removeItem,
        updateItemNote,
        printManualKitchen,
        printManualCaja,
    };

    const paymentDetailsProps = {
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
        confirmLabel: isEditMode ? 'GUARDAR CAMBIOS' : 'CONFIRMAR PEDIDO',
        onCancelOrder: canCancelOrder ? handleCancelOrder : null,
        isEditMode,
        hideCheckoutActions: false,
    };

    const paymentDetailsMobileProps = {
        ...paymentDetailsProps,
        goPrevStep: null,
        hideCheckoutActions: true,
    };

    const catalogBlock = (
        <ManualOrderCatalog
            products={products}
            categories={categories}
            cartUpsellCatalogs={cartUpsellCatalogs}
            addItem={addItem}
            updateQuantity={updateQuantity}
            removeItem={removeItem}
            getQty={(id) => {
                const key = id == null ? '' : String(id);
                return manualOrder.items.find((i) => String(i.id) === key)?.quantity || 0;
            }}
        />
    );

    const mobileDock = isCompactNav ? (
        <div className="manual-order-mobile-dock" role="group" aria-label="Navegación del pedido">
            {orderStep === 1 ? (
                <>
                    <div className="manual-order-mobile-cart-bar" aria-live="polite">
                        <ShoppingBag size={18} aria-hidden />
                        <span className="manual-order-mobile-cart-bar__text">
                            {hasCartItems
                                ? `${cartItemCount} ${cartItemCount === 1 ? 'ítem' : 'ítems'} · ${formatCurrency(manualOrder.total ?? 0)}`
                                : 'Carrito vacío'}
                        </span>
                    </div>
                    {showEditSaveOnFooter ? (
                        <div className="manual-order-mobile-dock__actions manual-order-mobile-dock__actions--edit">
                            <button
                                type="button"
                                className="manual-order-steps-nav__btn manual-order-steps-nav__btn--next-secondary"
                                onClick={goNextStep}
                                disabled={!hasCartItems}
                            >
                                Siguiente
                            </button>
                            <button
                                type="button"
                                className="manual-order-steps-nav__btn manual-order-steps-nav__btn--save"
                                onClick={submitOrder}
                                disabled={loading}
                            >
                                {loading ? 'GUARDANDO...' : 'Guardar'}
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            className="manual-order-steps-nav__btn manual-order-steps-nav__btn--next"
                            onClick={goNextStep}
                            disabled={!hasCartItems}
                        >
                            Siguiente
                        </button>
                    )}
                </>
            ) : null}
            {orderStep === 2 ? (
                <div className="manual-order-mobile-dock__actions">
                    <button
                        type="button"
                        className="manual-order-steps-nav__btn manual-order-steps-nav__btn--back"
                        onClick={goPrevStep}
                    >
                        Atrás
                    </button>
                    <button
                        type="button"
                        className="manual-order-steps-nav__btn manual-order-steps-nav__btn--next"
                        onClick={goNextStep}
                        disabled={!isClientStepValid()}
                    >
                        Siguiente
                    </button>
                </div>
            ) : null}
            {orderStep === 3 ? (
                <div className="manual-order-mobile-dock__actions manual-order-mobile-dock__actions--confirm">
                    <button
                        type="button"
                        className="manual-order-steps-nav__btn manual-order-steps-nav__btn--back"
                        onClick={goPrevStep}
                    >
                        Atrás
                    </button>
                    {canCancelOrder ? (
                        <button
                            type="button"
                            className="manual-order-steps-nav__btn manual-order-steps-nav__btn--back manual-order-checkout-cancel"
                            onClick={handleCancelOrder}
                            disabled={loading}
                        >
                            Cancelar
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="manual-order-confirm-btn manual-order-mobile-dock__confirm"
                        onClick={submitOrder}
                        disabled={loading || !isFormValid()}
                    >
                        {loading ? 'PROCESANDO...' : (isEditMode ? 'GUARDAR' : 'CONFIRMAR')}
                    </button>
                </div>
            ) : null}
        </div>
    ) : null;

    const sidebarSection = (
        <div className="manual-order-sidebar">
            {orderStep === 1 ? (
                <>
                    <OrderSummary {...orderSummaryProps} />
                    <div className="manual-order-footer">
                        {showEditSaveOnFooter ? (
                            <p className="manual-order-footer-edit-hint" role="status">
                                Puedes guardar aquí sin pasar por los otros pasos.
                            </p>
                        ) : null}
                        {wizardNavButtons}
                    </div>
                </>
            ) : (
                <div className="manual-order-checkout-stage">
                    <div className="manual-order-checkout-col manual-order-checkout-col--client">
                        <div className="manual-order-client-stage">
                            {clientSection}
                            {noteSection}
                        </div>
                    </div>
                    <div className="manual-order-checkout-col manual-order-checkout-col--summary">
                        <OrderSummary {...orderSummaryProps} />
                    </div>
                    <div className="manual-order-checkout-col manual-order-checkout-col--payment">
                        <PaymentDetails {...paymentDetailsProps} />
                    </div>
                </div>
            )}
        </div>
    );

    const modalUi = (
        <div className="manual-order-overlay" onClick={onClose}>
            <div
                className={`manual-order-container manual-order-wizard manual-order-step-${orderStep}${isCompactNav ? ' manual-order--mobile' : ''}`}
                onClick={e => e.stopPropagation()}
            >
                {/* ÁREA INVISIBLE PARA GESTOS */}
                <div
                    className="manual-order-drag-zone"
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                />

                {/* BOTÓN CERRAR FLOTANTE */}
                <button type="button" onClick={onClose} className="manual-order-floating-close" title="Cerrar (Esc)">
                    <X size={24} />
                </button>

                <div
                    className={`manual-order-steps-progress${isEditMode ? ' manual-order-steps-progress--editable' : ''}`}
                    aria-label={`Paso ${orderStep} de ${wizardStepCount}`}
                >
                    {stepLabels.map((label, idx) => {
                        const n = idx + 1;
                        const isActive = orderStep === n;
                        const isDone = orderStep > n;
                        const itemClassName = `manual-order-steps-progress__item ${isActive ? 'is-active' : ''} ${isDone ? 'is-done' : ''}${isEditMode ? ' manual-order-steps-progress__item--clickable' : ''}`;

                        if (isEditMode) {
                            return (
                                <button
                                    key={label}
                                    type="button"
                                    className={itemClassName}
                                    onClick={() => setOrderStep(n)}
                                    aria-current={isActive ? 'step' : undefined}
                                    aria-label={`Ir a ${label}`}
                                >
                                    <span className="manual-order-steps-progress__dot">
                                        {isDone ? <CheckCircle2 size={14} /> : n}
                                    </span>
                                    <span className="manual-order-steps-progress__label">{label}</span>
                                </button>
                            );
                        }

                        return (
                            <div key={label} className={itemClassName}>
                                <span className="manual-order-steps-progress__dot">
                                    {isDone ? <CheckCircle2 size={14} /> : n}
                                </span>
                                <span className="manual-order-steps-progress__label">{label}</span>
                            </div>
                        );
                    })}
                </div>

                {isCompactNav ? (
                    <div className="manual-order-mobile-scene">
                        {orderStep === 1 ? (
                            <div className="manual-order-stage manual-order-mobile-stage--catalog">
                                {catalogBlock}
                            </div>
                        ) : null}
                        {orderStep === 2 ? (
                            <div className="manual-order-mobile-panel manual-order-mobile-panel--client">
                                {clientSection}
                                {noteSection}
                            </div>
                        ) : null}
                        {orderStep === 3 ? (
                            <div className="manual-order-mobile-panel manual-order-mobile-panel--payment">
                                <OrderSummary {...orderSummaryProps} />
                                <PaymentDetails {...paymentDetailsMobileProps} />
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <div className="manual-order-body">
                        <div className="manual-order-stage">
                            {catalogBlock}
                        </div>
                        {sidebarSection}
                    </div>
                )}

                {mobileDock}
            </div>
        </div>
    );

    if (typeof document === 'undefined') return null;
    return createPortal(
        <div className="manual-order-portal-scope">{modalUi}</div>,
        document.body,
    );
};

export default ManualOrderModal;
