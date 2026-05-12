import React, { useState, useRef, useEffect, useMemo, useDeferredValue } from 'react';
import {
    X, Search, Plus, User, ShoppingBag, Minus, Trash2,
    CreditCard, CheckCircle2, Store, Receipt, MessageCircle, Printer,
    Upload, FileText, ChefHat, Banknote, CupSoda, Sparkles, MapPin, Truck, Tag,
    Loader2, StickyNote,
} from 'lucide-react';
import { formatCurrency } from '@/shared/utils/formatters';
import {
    computeDeliveryFee,
    effectiveDeliveryPricingMode,
    normalizeDeliverySettings,
} from '@/lib/delivery-settings';
import { buildDeliveryAddressRecord } from '@/shared/utils/orderUtils';
const logo = '/tenant/logo-placeholder.svg';
import { useManualOrder } from '../hooks/useManualOrder';
import { branchSettingsService } from '../services/branchSettingsService';
import { geocodeAddress } from '../services/geocodeService';
import { geocodeToCoords } from '../services/placesService';
import { haversineKm, isValidLatLng } from '@/lib/geo';
import { printOrderTicket } from '@/modules/cash/admin/utils/receiptPrinting';
import AdminIconSlot from './AdminIconSlot';

function branchFlag(map, branchId, defaultOn = true) {
    if (!branchId || !map || typeof map !== 'object') return defaultOn;
    if (Object.prototype.hasOwnProperty.call(map, branchId)) {
        return map[branchId] !== false;
    }
    return defaultOn;
}

function normalizeCartUpsellCatalog(catalog, kind) {
    if (!Array.isArray(catalog)) return [];
    return catalog
        .map((row) => {
            if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
            const id = String(row.id ?? '').trim();
            const name = String(row.name ?? '').trim();
            const price = Number(row.price);
            if (!id || !name || !Number.isFinite(price) || price < 0) return null;
            const category = String(row.category ?? row.catalogCategory ?? row.group ?? '').trim();
            const beverageKind = String(row.beverageKind ?? row.beverage_kind ?? '').trim();
            const imageUrl = String(row.imageUrl ?? row.image_url ?? '').trim();

            if (row.active === false || row.is_active === false || row.enabled === false) return null;

            return {
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
            };
        })
        .filter(Boolean);
}

function groupProductsByCategory(items, categories = []) {
    const sortedCategories = [...(categories || [])]
        .filter((cat) => cat?.is_active !== false)
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    const normalizeId = (value) => (value == null ? '' : String(value).trim());
    const normalizeName = (value) => (typeof value === 'string' ? value.trim() : '');

    const categoryById = new Map(sortedCategories.map((cat) => [normalizeId(cat?.id), cat]));
    const buckets = new Map();
    const uncategorized = [];

    (items || []).forEach((item) => {
        const id =
            normalizeId(item?.category_id) ||
            normalizeId(item?.categoryId) ||
            normalizeId(item?.category?.id);
        const name =
            normalizeName(item?.category_name) ||
            normalizeName(item?.categoryName) ||
            normalizeName(item?.category?.name);

        const knownCategory = id ? categoryById.get(id) : null;
        if (knownCategory) {
            const key = `id:${normalizeId(knownCategory.id)}`;
            if (!buckets.has(key)) {
                buckets.set(key, {
                    id: knownCategory.id,
                    name: knownCategory.name || 'Sin categoría',
                    order: Number(knownCategory.order) || 0,
                    products: [],
                });
            }
            buckets.get(key).products.push(item);
            return;
        }

        if (name) {
            const key = `name:${name.toLowerCase()}`;
            if (!buckets.has(key)) {
                buckets.set(key, {
                    id: key,
                    name,
                    order: 9999,
                    products: [],
                });
            }
            buckets.get(key).products.push(item);
            return;
        }

        uncategorized.push(item);
    });

    const groupedCategories = [...buckets.values()].sort((a, b) => (
        a.order === b.order
            ? String(a.name).localeCompare(String(b.name), 'es')
            : a.order - b.order
    ));

    return { groupedCategories, uncategorized };
}

const ManualOrderModal = ({ isOpen, onClose, products, categories = [], onOrderSaved, showNotify, registerSale, branch, logoUrl, companyName }) => {
    const [branchDeliveryCfg, setBranchDeliveryCfg] = useState(null);

    const {
        manualOrder, loading, rutValid, phoneValid,
        receiptFile, receiptPreview,
        updateClientName, updateCouponCode, couponPreview, updateNote, updatePaymentType, handleRutChange,
        handlePhoneChange, handleFileChange, removeReceipt, addItem, updateQuantity, removeItem,
        updateItemNote,
        updateOrderType, updateDeliveryAddress, updateDeliveryReference, updateDeliveryKm,
        updateDeliveryFee, updateDeliveryNamedAreaId,
        submitOrder, resetOrder, getInputStyle
    } = useManualOrder(showNotify, onOrderSaved, onClose, registerSale, branch, branchDeliveryCfg);
	
	const [showCustomerFields, setShowCustomerFields] = useState(false);
    const [detectingZone, setDetectingZone] = useState(false);
    const [calculatingDistance, setCalculatingDistance] = useState(false);
    // Conjunto de itemIds con el textarea de comentario expandido. Si el item
    // ya trae nota, lo consideramos abierto automaticamente (ver isItemNoteOpen).
    const [openNoteIds, setOpenNoteIds] = useState(() => new Set());
    const isItemNoteOpen = (item) => openNoteIds.has(item.id) || (item.note ?? '').length > 0;
    const toggleItemNote = (itemId) => setOpenNoteIds((prev) => {
        const next = new Set(prev);
        if (next.has(itemId)) next.delete(itemId);
        else next.add(itemId);
        return next;
    });

    const [searchQuery, setSearchQuery] = useState('');
    const [printMenuOpen, setPrintMenuOpen] = useState(false);
    const [showProductImages, setShowProductImages] = useState(false);
    const [isMobileLikeLayout, setIsMobileLikeLayout] = useState(false);
    // Wizard de 3 pasos solo en movil (<=767px): 1) Productos, 2) Cliente+Tipo, 3) Pago+Confirmar.
    const [isStepsMode, setIsStepsMode] = useState(false);
    const [mobileStep, setMobileStep] = useState(1);
    const [cartUpsellCatalogs, setCartUpsellCatalogs] = useState({
        beveragesEnabled: false,
        extrasEnabled: false,
        beverages: [],
        extras: [],
    });
    const printMenuRef = useRef(null);
    const productsSectionRef = useRef(null);
    const beveragesSectionRef = useRef(null);
    const extrasSectionRef = useRef(null);
    // Refs por categoria individual para el sidebar scroll-to. Key = "<variant>:<categoryId>".
    const categoryRefsRef = useRef(new Map());
    const setCategoryRef = (key) => (el) => {
        if (el) categoryRefsRef.current.set(key, el);
        else categoryRefsRef.current.delete(key);
    };
    const scrollToCategory = (key) => {
        const el = categoryRefsRef.current.get(key);
        if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    // Reiniciar modal al abrir para evitar el bug de persistencia
    useEffect(() => {
        if (isOpen) {
            if (typeof resetOrder === 'function') resetOrder();
            setShowCustomerFields(false);
            setMobileStep(1);
        }
    }, [isOpen]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const mq = window.matchMedia('(max-width: 767px)');
        const sync = () => setIsStepsMode(mq.matches);
        sync();
        mq.addEventListener('change', sync);
        return () => mq.removeEventListener('change', sync);
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const mqWidth = window.matchMedia('(max-width: 1024px)');
        const mqCoarse = window.matchMedia('(hover: none) and (pointer: coarse)');

        const syncLayout = () => {
            setIsMobileLikeLayout(mqWidth.matches || mqCoarse.matches);
        };

        syncLayout();
        mqWidth.addEventListener('change', syncLayout);
        mqCoarse.addEventListener('change', syncLayout);
        return () => {
            mqWidth.removeEventListener('change', syncLayout);
            mqCoarse.removeEventListener('change', syncLayout);
        };
    }, []);

    useEffect(() => {
        if (!printMenuOpen) return;
        const onDown = (ev) => {
            const el = printMenuRef.current;
            if (el && !el.contains(ev.target)) setPrintMenuOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [printMenuOpen]);

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

                // `normalizeDeliverySettings` solo lee del JSONB `delivery_settings`,
                // pero `originLat/Lng` vienen aparte (`branches.origin_lat/lng`).
                // Los preservamos para el autocalculo de distancia client-side.
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

    useEffect(() => {
        if (manualOrder.order_type !== 'delivery' || !branchDeliveryCfg) return;
        if (effectiveDeliveryPricingMode(branchDeliveryCfg) !== 'named') return;
        const id = String(manualOrder.delivery_named_area_id ?? '').trim();
        if (!id) return;
        const subtotal = Number(manualOrder.total) || 0;
        const r = computeDeliveryFee(branchDeliveryCfg, 0, subtotal, { namedAreaId: id });
        if (r.fee < 0) return;
        const next = Math.round(r.fee * 100) / 100;
        const cur = Number(manualOrder.delivery_fee) || 0;
        if (Math.abs(next - cur) > 0.005) {
            updateDeliveryFee(String(next));
        }
    }, [
        branchDeliveryCfg,
        manualOrder.order_type,
        manualOrder.delivery_named_area_id,
        manualOrder.total,
        updateDeliveryFee,
    ]);

    useEffect(() => {
        if (manualOrder.order_type !== 'delivery' || !branchDeliveryCfg) return;
        if (effectiveDeliveryPricingMode(branchDeliveryCfg) !== 'distance') return;
        const kmRaw = String(manualOrder.delivery_km ?? '').replace(',', '.').trim();
        const km = kmRaw === '' ? 0 : Number(kmRaw);
        const safeKm = Number.isFinite(km) && km >= 0 ? km : 0;
        const subtotal = Number(manualOrder.total) || 0;
        const r = computeDeliveryFee(branchDeliveryCfg, safeKm, subtotal);
        if (r.fee < 0) return;
        const next = Math.round(r.fee * 100) / 100;
        const cur = Number(manualOrder.delivery_fee) || 0;
        if (Math.abs(next - cur) > 0.005) {
            updateDeliveryFee(String(next));
        }
    }, [
        branchDeliveryCfg,
        manualOrder.order_type,
        manualOrder.delivery_km,
        manualOrder.total,
        updateDeliveryFee,
    ]);

    const showNamedZonePicker =
        Boolean(
            branchDeliveryCfg &&
            manualOrder.order_type === 'delivery' &&
            effectiveDeliveryPricingMode(branchDeliveryCfg) === 'named' &&
            (branchDeliveryCfg.namedAreas?.length ?? 0) > 0,
        );

    /**
     * Modo automatico: la sucursal cobra por zonas pero ademas tiene activado
     * `namedAreaResolution === 'address_matched'`. En ese caso mostramos un input
     * de direccion + boton "Detectar zona" que llama la Edge Function `geocode`.
     * El dropdown de zonas sigue visible debajo como fallback manual si la
     * deteccion falla o el cajero quiere cambiarla.
     */
    const namedAreaAutoMode =
        showNamedZonePicker &&
        String(branchDeliveryCfg?.namedAreaResolution ?? '').toLowerCase() === 'address_matched';

    const showDistancePricing =
        Boolean(
            branchDeliveryCfg &&
            manualOrder.order_type === 'delivery' &&
            effectiveDeliveryPricingMode(branchDeliveryCfg) === 'distance',
        );

    /**
     * Modo automatico para `distance`: la sucursal cobra por km y tiene origen
     * configurado en `branchDeliveryCfg.originLat/originLng`. Si falta el origen,
     * el boton no aparece y el cajero llena `delivery_km` a mano (fallback).
     * Implementacion 100% client-side: Photon (`placesService.geocodeToCoords`)
     * + haversine (`@/lib/geo`). El `useEffect` de distance recalcula la fee
     * automaticamente al cambiar `delivery_km`.
     */
    const distanceAutoMode =
        showDistancePricing &&
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
            showNotify?.('Escribe una direccion para detectar la zona.', 'warning');
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
            showNotify?.('Escribe una direccion para calcular la distancia.', 'warning');
            return;
        }
        if (!isValidLatLng(branchDeliveryCfg?.originLat, branchDeliveryCfg?.originLng)) {
            showNotify?.(
                'Configura ubicacion del local en Settings para autocalcular distancia.',
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

    const manualOrderForTicket = React.useMemo(() => {
        if (manualOrder.order_type !== 'delivery') return manualOrder;
        const nid = String(manualOrder.delivery_named_area_id ?? '').trim();
        const nlab =
            nid && branchDeliveryCfg?.namedAreas?.length
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

    const getEffectivePrice = (product) => {
        const basePrice = Number(product?.price || 0);
        const hasDiscount = Boolean(product?.has_discount) && product?.discount_price != null && Number(product.discount_price) > 0;
        return hasDiscount ? Number(product.discount_price) : basePrice;
    };

    const isProductAvailableForManualOrder = (product) => {
        if (!product) return false;
        if (product.is_active !== true) return false;
        return getEffectivePrice(product) > 0;
    };

    const getQty = (id) => manualOrder.items.find(i => i.id === id)?.quantity || 0;

	// [MEJORA SEGURIDAD] Función de sanitización
	const sanitizeInput = (text) => {
		if (!text) return '';
		return text.replace(/[<>]/g, '').trim(); // Elimina < y > para evitar inyección básica
	};

	// En inputs en vivo (ej: nombre) no hacer trim para permitir espacios al escribir.
	const sanitizeInputLive = (text) => {
		if (text == null || text === '') return '';
		return text.replace(/[<>]/g, '');
	};

	// La nota no debe hacer trim para permitir espacios entre palabras mientras escribes.
	const sanitizeNote = (text) => {
		if (text == null || text === '') return '';
		return text.replace(/[<>]/g, '');
	};

    const ticketOpts = (variant) => ({
        variant,
        branchAddress: branch?.address ?? null,
        orderChannel: 'PDV',
        companyName: companyName ?? null,
    });

    const printManualKitchen = () => {
        printOrderTicket(manualOrderForTicket, branch?.name, logoUrl ?? null, ticketOpts('kitchen'));
        setPrintMenuOpen(false);
    };

    const printManualCaja = () => {
        printOrderTicket(manualOrderForTicket, branch?.name, logoUrl ?? null, ticketOpts('cashier'));
        setPrintMenuOpen(false);
    };

    // --- EFFECT: ESCAPE KEY ---
    React.useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // --- MOBILE GESTURES ---
    const [touchStart, setTouchStart] = useState(null);
    const [touchEnd, setTouchEnd] = useState(null);

    const minSwipeDistance = 50;

    const onTouchStart = (e) => {
        setTouchEnd(null);
        setTouchStart(e.targetTouches[0].clientY);
    };

    const onTouchMove = (e) => setTouchEnd(e.targetTouches[0].clientY);

    const onTouchEnd = () => {
        if (!touchStart || !touchEnd) return;
        const distance = touchStart - touchEnd;
        const isDownSwipe = distance < -minSwipeDistance;
        if (isDownSwipe) {
            onClose();
        }
    };

    const [searchExpanded, setSearchExpanded] = useState(false);
    const searchInputRef = React.useRef(null);

    const toggleSearch = () => {
        setSearchExpanded(!searchExpanded);
        if (!searchExpanded) {
            setTimeout(() => searchInputRef.current?.focus(), 100);
        }
    };

    const handleSearchBlur = () => {
        if (!searchQuery) {
            setSearchExpanded(false);
        }
    };

    // Validaciones por paso (solo aplican en isStepsMode, pero las dejamos genericas).
    const hasCartItems = (manualOrder.items?.length ?? 0) > 0;

    const isCustomerStageValid = () => {
        const hasClientName = manualOrder.client_name && manualOrder.client_name.trim().length >= 3;
        const exactRutLength = manualOrder.client_rut?.trim().length || 0;
        const isRutRequiredAndValid = exactRutLength > 0 && rutValid;
        const isPhoneStrictlyValid = phoneValid === true;
        const namedAreasMode =
            branchDeliveryCfg &&
            manualOrder.order_type === 'delivery' &&
            effectiveDeliveryPricingMode(branchDeliveryCfg) === 'named' &&
            (branchDeliveryCfg.namedAreas?.length ?? 0) > 0;
        const distanceMode =
            branchDeliveryCfg &&
            manualOrder.order_type === 'delivery' &&
            effectiveDeliveryPricingMode(branchDeliveryCfg) === 'distance';
        const hasNamedZoneOk =
            !namedAreasMode || String(manualOrder.delivery_named_area_id ?? '').trim().length > 0;
        const addrOk =
            Boolean(manualOrder.delivery_address && manualOrder.delivery_address.trim().length >= 5);
        const isDeliveryValid =
            manualOrder.order_type !== 'delivery'
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
        return Boolean(hasClientName && isRutRequiredAndValid && isPhoneStrictlyValid && isDeliveryValid);
    };

    const canAdvanceFromStep1 = hasCartItems;
    const canAdvanceFromStep2 = isCustomerStageValid();

    const goNextStep = () => {
        if (mobileStep === 1) {
            if (!canAdvanceFromStep1) {
                showNotify?.('Agrega al menos un producto al carrito.', 'warning');
                return;
            }
            setMobileStep(2);
            if (!manualOrder.client_name || manualOrder.client_name.trim().length < 3) {
                setShowCustomerFields(true);
            }
        } else if (mobileStep === 2) {
            if (!canAdvanceFromStep2) {
                showNotify?.('Completa nombre, RUT, telefono y direccion (si aplica) antes de continuar.', 'warning');
                setShowCustomerFields(true);
                return;
            }
            setMobileStep(3);
        }
    };

    const goPrevStep = () => {
        if (mobileStep > 1) setMobileStep(mobileStep - 1);
    };

    // Validación del formulario
    const isFormValid = () => {
        const hasItems = manualOrder.items && manualOrder.items.length > 0;
        const hasClientName = manualOrder.client_name && manualOrder.client_name.trim().length >= 3;
        const hasPaymentType = !!manualOrder.payment_type;

        const exactRutLength = manualOrder.client_rut?.trim().length || 0;
        const isRutRequiredAndValid = exactRutLength > 0 && rutValid;
        const isPhoneStrictlyValid = phoneValid === true;

        const namedAreasMode =
            branchDeliveryCfg &&
            manualOrder.order_type === 'delivery' &&
            effectiveDeliveryPricingMode(branchDeliveryCfg) === 'named' &&
            (branchDeliveryCfg.namedAreas?.length ?? 0) > 0;
        const distanceMode =
            branchDeliveryCfg &&
            manualOrder.order_type === 'delivery' &&
            effectiveDeliveryPricingMode(branchDeliveryCfg) === 'distance';
        const hasNamedZoneOk =
            !namedAreasMode || String(manualOrder.delivery_named_area_id ?? '').trim().length > 0;
        const addrOk =
            Boolean(manualOrder.delivery_address && manualOrder.delivery_address.trim().length >= 5);
        const isDeliveryValid =
            manualOrder.order_type !== 'delivery'
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

        // Transferencia: comprobante opcional (sin archivo el backend guarda un placeholder).
        return hasItems && hasClientName && hasPaymentType && isRutRequiredAndValid && isPhoneStrictlyValid && isDeliveryValid;
    };

    const orderTypeSection = (
        <div className="manual-order-section" style={{ marginBottom: '16px' }}>
            <div className="manual-order-section-title">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Truck size={14} aria-hidden />
                    TIPO DE PEDIDO
                </div>
            </div>
            <div style={{ 
                display: 'grid', 
                gridTemplateColumns: '1fr 1fr', 
                gap: '8px', 
                marginTop: '8px' 
            }}>
                <button
                    type="button"
                    onClick={() => updateOrderType('pickup')}
                    style={{
                        padding: '10px',
                        borderRadius: '8px',
                        border: '1px solid',
                        borderColor: manualOrder.order_type === 'pickup' ? '#25d366' : 'rgba(255,255,255,0.1)',
                        background: manualOrder.order_type === 'pickup' ? 'rgba(37, 211, 102, 0.1)' : 'rgba(255,255,255,0.03)',
                        color: manualOrder.order_type === 'pickup' ? '#25d366' : '#000000',
                        fontSize: '12px',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                    }}
                >
                    <Store size={16} />
                    LOCAL / RETIRO
                </button>
                <button
                    type="button"
                    onClick={() => updateOrderType('delivery')}
                    style={{
                        padding: '10px',
                        borderRadius: '8px',
                        border: '1px solid',
                        borderColor: manualOrder.order_type === 'delivery' ? '#25d366' : 'rgba(255,255,255,0.1)',
                        background: manualOrder.order_type === 'delivery' ? 'rgba(37, 211, 102, 0.1)' : 'rgba(255,255,255,0.03)',
                        color: manualOrder.order_type === 'delivery' ? '#25d366' : '#000000',
                        fontSize: '12px',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                    }}
                >
                    <Truck size={16} />
                    DELIVERY
                </button>
            </div>

            {manualOrder.order_type === 'delivery' && (
                <div className="animate-fade-in" style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {namedAreaAutoMode ? (
                        <>
                            <div className="manual-order-input-wrapper full-width">
                                <MapPin size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'rgba(0,0,0,0.4)', zIndex: 1 }} />
                                <input
                                    type="text"
                                    placeholder="DIRECCIÓN DE ENTREGA *"
                                    className="manual-order-input"
                                    style={{ paddingLeft: '36px', color: '#000000', fontWeight: '600' }}
                                    value={manualOrder.delivery_address}
                                    onChange={(e) => updateDeliveryAddress(e.target.value)}
                                />
                            </div>
                            <button
                                type="button"
                                onClick={handleDetectZone}
                                disabled={detectingZone || !manualOrder.delivery_address}
                                style={{
                                    alignSelf: 'flex-start',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '8px 14px',
                                    border: '1px solid rgba(0,0,0,0.15)',
                                    borderRadius: '8px',
                                    background: detectingZone ? 'rgba(0,0,0,0.06)' : '#ffffff',
                                    color: '#000000',
                                    fontWeight: 600,
                                    fontSize: '0.85rem',
                                    cursor: detectingZone || !manualOrder.delivery_address ? 'not-allowed' : 'pointer',
                                    opacity: !manualOrder.delivery_address ? 0.55 : 1,
                                }}
                                title="Detecta automaticamente la zona segun la direccion escrita"
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
                            <MapPin size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'rgba(0,0,0,0.4)', zIndex: 1 }} />
                            <select
                                id="manual-order-delivery-zone"
                                aria-label="Zona de entrega"
                                className="manual-order-input"
                                style={{
                                    paddingLeft: '36px',
                                    color: '#000000',
                                    fontWeight: '600',
                                    appearance: 'auto',
                                    cursor: 'pointer',
                                }}
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
                            <MapPin size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'rgba(0,0,0,0.35)', zIndex: 1 }} />
                            <input
                                type="text"
                                placeholder="REFERENCIA: CALLE, NÚMERO U OBSERVACIÓN (OPC.)"
                                className="manual-order-input"
                                style={{ paddingLeft: '36px', color: '#000000', fontWeight: '600' }}
                                value={manualOrder.delivery_reference}
                                onChange={(e) => updateDeliveryReference(e.target.value)}
                            />
                        </div>
                    ) : null}
                    {showDistancePricing ? (
                        <div className="manual-order-input-wrapper full-width">
                            <MapPin size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'rgba(0,0,0,0.35)', zIndex: 1 }} />
                            <input
                                type="text"
                                inputMode="decimal"
                                placeholder="DISTANCIA APROX. (KM) — OPC., MEJORA LA TARIFA"
                                className="manual-order-input"
                                style={{ paddingLeft: '36px', color: '#000000', fontWeight: '600' }}
                                value={manualOrder.delivery_km}
                                onChange={(e) => updateDeliveryKm(e.target.value)}
                            />
                        </div>
                    ) : null}
                    {!showNamedZonePicker ? (
                        <div className="manual-order-input-wrapper full-width">
                            <MapPin size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)' }} />
                            <input
                                type="text"
                                placeholder={
                                    showDistancePricing
                                        ? 'DIRECCIÓN DE ENTREGA *'
                                        : 'DIRECCIÓN DE ENTREGA'
                                }
                                className="manual-order-input"
                                style={{ paddingLeft: '36px', color: '#000000', fontWeight: '600' }}
                                value={manualOrder.delivery_address}
                                onChange={e => updateDeliveryAddress(e.target.value)}
                            />
                        </div>
                    ) : null}
                    {distanceAutoMode ? (
                        <button
                            type="button"
                            onClick={handleCalculateDistance}
                            disabled={calculatingDistance || !manualOrder.delivery_address}
                            style={{
                                alignSelf: 'flex-start',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '8px 14px',
                                border: '1px solid rgba(0,0,0,0.15)',
                                borderRadius: '8px',
                                background: calculatingDistance ? 'rgba(0,0,0,0.06)' : '#ffffff',
                                color: '#000000',
                                fontWeight: 600,
                                fontSize: '0.85rem',
                                cursor: calculatingDistance || !manualOrder.delivery_address ? 'not-allowed' : 'pointer',
                                opacity: !manualOrder.delivery_address ? 0.55 : 1,
                            }}
                            title="Calcula automaticamente la distancia desde el local hasta la direccion escrita"
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
                    {showDistancePricing && !distanceAutoMode ? (
                        <div
                            style={{
                                fontSize: '11px',
                                color: 'rgba(0,0,0,0.55)',
                                fontStyle: 'italic',
                                lineHeight: 1.4,
                            }}
                        >
                            Configura ubicacion del local en Settings → Delivery para autocalcular distancia.
                        </div>
                    ) : null}
                    <div className="manual-order-input-wrapper full-width">
                        <Banknote size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'rgba(0,0,0,0.4)' }} />
                        <input
                            type="number"
                            placeholder={
                                showNamedZonePicker || showDistancePricing
                                    ? 'COSTO ENVÍO (calculado; puedes ajustar)'
                                    : 'COSTO DE ENVÍO (OPCIONAL)'
                            }
                            className="manual-order-input"
                            style={{ paddingLeft: '36px', color: '#000000', fontWeight: '600' }}
                            value={manualOrder.delivery_fee || ''}
                            onChange={e => updateDeliveryFee(e.target.value)}
                        />
                    </div>
                </div>
            )}
        </div>
    );

    const customerSection = (
        <div className="manual-order-section">
            <div className="manual-order-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <User size={14} aria-hidden />
                    DATOS CLIENTE
                </div>
                {!showCustomerFields && (
                    <button 
                        type="button"
                        onClick={() => setShowCustomerFields(true)}
                        style={{ 
                            fontSize: '10px', 
                            background: 'rgba(255,255,255,0.05)', 
                            border: '1px solid rgba(255,255,255,0.1)', 
                            borderRadius: '4px', 
                            padding: '4px 8px', 
                            color: '#111', 
                            cursor: 'pointer',
                            fontWeight: '600'
                        }}
                    >
                        EDITAR
                    </button>
                )}
            </div>

            {!showCustomerFields ? (
                <div 
                    className="manual-order-client-summary-box" 
                    onClick={() => setShowCustomerFields(true)}
                    style={{ 
                        cursor: 'pointer', 
                        padding: '12px', 
                        background: 'rgba(255,255,255,0.03)', 
                        border: '1px solid rgba(255,255,255,0.05)',
                        borderRadius: '8px', 
                        fontSize: '13px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        transition: 'all 0.2s ease',
                        marginTop: '8px'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                >
                    <div style={{ fontWeight: '700', color: '#000000', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {manualOrder.client_name || 'Sin nombre'}
                        {manualOrder.client_name === 'CAJA' && (
                            <span style={{ fontSize: '9px', background: '#25d366', color: 'black', padding: '1px 5px', borderRadius: '4px', fontWeight: '900' }}>DEFAULT</span>
                        )}
                    </div>
                    <div style={{ color: '#333333', opacity: 0.8, fontSize: '11px', letterSpacing: '0.5px', fontWeight: '500' }}>
                        {manualOrder.client_rut} • {manualOrder.client_phone}
                    </div>
                </div>
            ) : (
                <div className="manual-order-form-grid animate-fade-in" style={{ marginTop: '12px' }}>
                    <div className="manual-order-input-wrapper full-width">
                        <input
                            type="text"
                            placeholder="NOMBRE COMPLETO *"
                            className="manual-order-input"
                            value={manualOrder.client_name}
                            onChange={e => updateClientName(sanitizeInputLive(e.target.value))}
                            aria-label="Nombre completo del cliente"
                            style={{ 
                                paddingRight: manualOrder.client_name.length >= 3 ? '40px' : '16px',
                                color: '#000000',
                                fontWeight: '600'
                            }}
                        />
                        {manualOrder.client_name.length >= 3 && (
                            <div className="manual-order-validation-icon">
                                <CheckCircle2 size={18} color="#25d366" />
                            </div>
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
                                color: '#000000',
                                fontWeight: '600'
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
                                color: '#000000',
                                fontWeight: '600'
                            }}
                        />
                        {phoneValid && (
                            <div className="manual-order-validation-icon">
                                <CheckCircle2 size={18} color="#25d366" />
                            </div>
                        )}
                    </div>
                    
                    <button 
                        type="button"
                        onClick={() => setShowCustomerFields(false)}
                        style={{ 
                            gridColumn: '1 / -1',
                            fontSize: '11px',
                            background: 'transparent',
                            border: '1px solid rgba(255,255,255,0.1)',
                            color: 'rgba(255,255,255,0.5)',
                            padding: '8px',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            marginTop: '4px'
                        }}
                    >
                        CERRAR EDICIÓN
                    </button>
                </div>
            )}
        </div>
    );

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
                    style={{ color: '#000000', fontWeight: '600' }}
                    value={manualOrder.note}
                    onChange={e => updateNote(sanitizeNote(e.target.value))}
                    rows={1}
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

    const summarySection = (
        <div className="manual-order-section manual-order-summary-section">
            <div className="manual-order-section-title manual-order-summary-head">
                <div className="manual-order-summary-head-row">
                    <div className="manual-order-summary-head-label">
                        <ShoppingBag size={14} aria-hidden />
                        RESUMEN ORDEN ({manualOrder.items.reduce((acc, i) => acc + i.quantity, 0)})
                    </div>
                    {manualOrder.items.length > 0 && (
                        <div className="manual-order-print-menu" ref={printMenuRef}>
                            <button
                                type="button"
                                onClick={() => setPrintMenuOpen((v) => !v)}
                                className="manual-order-summary-print"
                                title="Imprimir tickets"
                                aria-expanded={printMenuOpen}
                                aria-haspopup="menu"
                                aria-label="Imprimir tickets"
                            >
                                <Printer size={14} aria-hidden />
                            </button>
                            {printMenuOpen ? (
                                <div className="manual-order-print-panel" role="menu">
                                    <button
                                        type="button"
                                        className="manual-order-print-item"
                                        role="menuitem"
                                        onClick={printManualKitchen}
                                    >
                                        <ChefHat size={16} aria-hidden />
                                        Ticket cocina
                                    </button>
                                    <button
                                        type="button"
                                        className="manual-order-print-item"
                                        role="menuitem"
                                        onClick={printManualCaja}
                                    >
                                        <Banknote size={16} aria-hidden />
                                        Ticket caja
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>
            </div>

            <div className="manual-order-cart-body">
                {manualOrder.items.length === 0 ? (
                    <div className="manual-order-cart-empty">
                        <ShoppingBag size={42} strokeWidth={1} className="manual-order-cart-empty-icon" aria-hidden />
                        <div className="manual-order-cart-empty-text">CARRITO VACÍO</div>
                    </div>
                ) : (
                    <div className="manual-order-cart-list">
                        {manualOrder.items.map(item => (
                            <div
                                key={item.id}
                                className="manual-order-cart-item animate-slide-up"
                            >
                                <div className="manual-order-cart-item-accent" aria-hidden />

                                <img
                                    src={item.image_url || logo}
                                    alt={item.name}
                                    className="manual-order-cart-item-thumb"
                                    onError={(e) => { e.target.src = logo }}
                                />

                                <div className="manual-order-cart-item-info">
                                    <div className="manual-order-cart-item-title">
                                        {item.name}
                                    </div>

                                    <div className="manual-order-cart-item-price-block">
                                        {(() => {
                                            const hasDiscount = Boolean(item.has_discount) && item.discount_price != null && Number(item.discount_price) > 0;
                                            const unit = hasDiscount ? Number(item.discount_price) : Number(item.price);
                                            const subtotal = unit * Number(item.quantity || 1);
                                            return (
                                                <div className="manual-order-cart-price-rows">
                                                    {hasDiscount && (
                                                        <div className="manual-order-cart-discount-row">
                                                            <span className="manual-order-cart-badge-oferta">
                                                                Oferta
                                                            </span>
                                                            <span className="manual-order-cart-price-old">
                                                                {formatCurrency(Number(item.price))}
                                                            </span>
                                                        </div>
                                                    )}
                                                    <div className="manual-order-cart-price-main-row">
                                                        <span className="manual-order-cart-price-total">
                                                            {formatCurrency(subtotal)}
                                                        </span>
                                                        <span className="manual-order-cart-price-unit">
                                                            {formatCurrency(unit)} c/u
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>
                                <div className="manual-order-cart-stepper">
                                    <button
                                        type="button"
                                        className="manual-order-cart-step-btn"
                                        onClick={() => updateQuantity(item.id, -1)}
                                        aria-label="Reducir cantidad"
                                    >
                                        <Minus size={14} aria-hidden />
                                    </button>
                                    <span className="manual-order-cart-step-qty">
                                        {item.quantity}
                                    </span>
                                    <button
                                        type="button"
                                        className="manual-order-cart-step-btn"
                                        onClick={() => updateQuantity(item.id, 1)}
                                        aria-label="Aumentar cantidad"
                                    >
                                        <Plus size={14} aria-hidden />
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    className={`manual-order-cart-note-btn${(item.note ?? '').length > 0 ? ' has-note' : ''}`}
                                    onClick={() => toggleItemNote(item.id)}
                                    title={(item.note ?? '').length > 0 ? 'Editar comentario' : 'Agregar comentario para cocina'}
                                    aria-label={(item.note ?? '').length > 0 ? 'Editar comentario' : 'Agregar comentario'}
                                    aria-pressed={isItemNoteOpen(item)}
                                >
                                    <StickyNote size={14} aria-hidden />
                                </button>
                                <button
                                    type="button"
                                    className="manual-order-cart-remove"
                                    onClick={() => removeItem(item.id)}
                                    title="Eliminar ítem"
                                    aria-label="Eliminar ítem"
                                >
                                    <Trash2 size={14} aria-hidden />
                                </button>
                                {isItemNoteOpen(item) ? (
                                    <div className="manual-order-cart-item-note">
                                        <textarea
                                            className="manual-order-cart-item-note-input"
                                            value={item.note ?? ''}
                                            onChange={(e) => updateItemNote(item.id, e.target.value)}
                                            placeholder="Comentario para cocina (ej: sin cebolla, salsa aparte). Max 140."
                                            maxLength={140}
                                            rows={2}
                                            aria-label={`Comentario para ${item.name}`}
                                        />
                                        <span className="manual-order-cart-item-note-counter">
                                            {(item.note ?? '').length}/140
                                        </span>
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );

    const deliveryFeeAmt = manualOrder.order_type === 'delivery' ? (Number(manualOrder.delivery_fee) || 0) : 0;
    const grossItems = manualOrder.total;
    const couponDiscountApplied =
        couponPreview?.variant === 'success' && Number(couponPreview.discount) > 0
            ? Math.min(grossItems, Number(couponPreview.discount))
            : 0;
    const totalToPay = Math.max(0, grossItems - couponDiscountApplied + deliveryFeeAmt);

    const footerSection = (
        <div className="manual-order-footer">
            <div
                style={{
                    marginBottom: '0.65rem',
                    padding: '0.65rem 0.75rem',
                    borderRadius: '10px',
                    border: '1px solid rgba(148,163,184,0.35)',
                    background: 'rgba(248,250,252,0.9)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.4rem',
                }}
            >
                <div style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.04em', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Tag size={13} aria-hidden /> CÓDIGO DE DESCUENTO (OPC.)
                </div>
                <input
                    type="text"
                    className="form-input"
                    autoComplete="off"
                    spellCheck={false}
                    value={manualOrder.coupon_code ?? ''}
                    onChange={(e) => updateCouponCode(e.target.value)}
                    placeholder="Ej. PROMO15"
                    style={{ width: '100%', fontSize: '0.9rem', padding: '0.45rem 0.55rem' }}
                />
                {couponPreview?.loading ? (
                    <span style={{ fontSize: '11px', color: '#64748b' }}>Validando código…</span>
                ) : null}
                {couponPreview?.message ? (
                    <span
                        style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            color: couponPreview.variant === 'error' ? '#b91c1c' : couponPreview.variant === 'success' ? '#15803d' : '#64748b',
                        }}
                    >
                        {couponPreview.message}
                    </span>
                ) : null}
            </div>
            <div className="manual-order-total" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.25rem' }}>
                {couponDiscountApplied > 0 ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b' }}>
                        <span>Artículos</span>
                        <span>{formatCurrency(grossItems)}</span>
                    </div>
                ) : null}
                {couponDiscountApplied > 0 ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 700, color: '#15803d' }}>
                        <span>Descuento (cupón)</span>
                        <span>−{formatCurrency(couponDiscountApplied)}</span>
                    </div>
                ) : null}
                {deliveryFeeAmt > 0 ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b' }}>
                        <span>Delivery</span>
                        <span>{formatCurrency(deliveryFeeAmt)}</span>
                    </div>
                ) : null}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem' }}>
                    <span className="manual-order-total-label">TOTAL A PAGAR</span>
                    <span className="manual-order-total-amount">
                        {formatCurrency(totalToPay)}
                    </span>
                </div>
            </div>

            {/* Métodos de pago */}
            <div className="manual-order-payment-methods">
                <button
                    className={`manual-order-payment-btn ${manualOrder.payment_type === 'tienda' ? 'active' : ''}`}
                    onClick={() => updatePaymentType('tienda')}
                >
                    <Store size={20} />
                    EFECTIVO
                </button>
                <button
                    className={`manual-order-payment-btn ${manualOrder.payment_type === 'tarjeta' ? 'active' : ''}`}
                    onClick={() => updatePaymentType('tarjeta')}
                >
                    <CreditCard size={20} />
                    TARJETA
                </button>
                <button
                    className={`manual-order-payment-btn ${manualOrder.payment_type === 'online' ? 'active' : ''}`}
                    onClick={() => updatePaymentType('online')}
                >
                    <Receipt size={20} />
                    TRANSF.
                </button>
            </div>

            {/* Comprobante de transferencia (opcional): estilo neutro para no leerse como bloqueo */}
            {manualOrder.payment_type === 'online' && (
                <div style={{
                    marginBottom: '12px',
                    padding: '12px',
                    background: 'rgba(148, 163, 184, 0.08)',
                    border: '1px solid rgba(148, 163, 184, 0.28)',
                    borderRadius: '8px',
                    animation: 'fadeIn 0.3s ease'
                }}>
                    <div style={{
                        fontSize: '11px',
                        color: '#64748b',
                        fontWeight: '800',
                        marginBottom: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        textTransform: 'uppercase'
                    }}>
                        <Upload size={14} aria-hidden />
                        Comprobante (opcional)
                    </div>
                    <p style={{
                        margin: '0 0 10px',
                        fontSize: '10px',
                        lineHeight: 1.35,
                        color: '#64748b',
                        fontWeight: 500,
                    }}>
                        Podés confirmar el pedido sin imagen. Si querés, subí el comprobante ahora o después desde la tarjeta del pedido.
                    </p>

                    <label
                        htmlFor="receipt-upload"
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            padding: '16px',
                            background: 'rgba(0, 0, 0, 0.2)',
                            border: '1px dashed rgba(148, 163, 184, 0.45)',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(148, 163, 184, 0.08)';
                            e.currentTarget.style.borderColor = 'rgba(100, 116, 139, 0.65)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(0, 0, 0, 0.2)';
                            e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.45)';
                        }}
                    >
                        <AdminIconSlot Icon={FileText} slotSize="md" tone="accent" />
                        <span style={{ fontSize: '12px', color: 'var(--admin-text-muted, #64748b)', fontWeight: '500' }}>
                            {receiptFile ? receiptFile.name : 'Click para subir imagen'}
                        </span>
                    </label>
                    <input
                        id="receipt-upload"
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                    />

                    {receiptPreview && (
                        <div style={{
                            marginTop: '12px',
                            borderRadius: '6px',
                            overflow: 'hidden',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            position: 'relative'
                        }}>
                            <img
                                src={receiptPreview}
                                alt="Preview"
                                style={{
                                    width: '100%',
                                    height: 'auto',
                                    maxHeight: '150px',
                                    objectFit: 'cover'
                                }}
                            />
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.preventDefault();
                                    removeReceipt();
                                }}
                                style={{
                                    position: 'absolute',
                                    top: '8px',
                                    right: '8px',
                                    background: 'rgba(230, 57, 70, 0.9)',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '4px 8px',
                                    fontSize: '10px',
                                    fontWeight: '700',
                                    cursor: 'pointer',
                                    boxShadow: '0 2px 5px rgba(0,0,0,0.3)'
                                }}
                            >
                                QUITAR
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Botón confirmar */}
            <button
                className="manual-order-confirm-btn"
                onClick={submitOrder}
                disabled={loading || !isFormValid()}
                style={{
                    opacity: loading || !isFormValid() ? 0.5 : 1,
                    cursor: loading || !isFormValid() ? 'not-allowed' : 'pointer'
                }}
            >
                {loading ? (
                    <>
                        <div style={{
                            width: '20px',
                            height: '20px',
                            border: '2px solid rgba(255,255,255,0.3)',
                            borderTop: '2px solid white',
                            borderRadius: '50%',
                            animation: 'spin 0.8s linear infinite'
                        }} />
                        PROCESANDO...
                    </>
                ) : (
                    <>
                        <CheckCircle2 size={20} />
                        CONFIRMAR PEDIDO
                    </>
                )}
            </button>
        </div>
    );

    const renderProductCard = (p, sourceLabel = '', variant = 'products') => {
        const hasDiscount = Boolean(p.has_discount) && p.discount_price != null && Number(p.discount_price) > 0;
        const unitPrice = hasDiscount ? Number(p.discount_price) : Number(p.price);

        const handleAddClick = (e) => {
            e.stopPropagation();
            try { addItem(p); } catch {}
        };

        return (
            <div
                key={p.id}
                className={`manual-order-product-card manual-order-product-card--${variant} ${showProductImages ? '' : 'no-images'}`}
                onClick={() => addItem(p)}
            >
                {sourceLabel ? (
                    <div className="manual-order-product-source-badge">
                        {sourceLabel}
                    </div>
                ) : null}
                {hasDiscount && (
                    <div style={{
                        position: 'absolute', top: '10px', left: '10px',
                        background: 'rgba(230,57,70,0.95)', color: '#fff',
                        fontSize: '10px', fontWeight: '800', padding: '4px 8px',
                        borderRadius: '999px', letterSpacing: '1px',
                        textTransform: 'uppercase', boxShadow: '0 8px 20px rgba(230,57,70,0.25)', zIndex: 2
                    }}>
                        Oferta
                    </div>
                )}
                {showProductImages ? (
                    <div className="manual-order-image-wrapper">
                        <img
                            src={p.image_url || logo} alt={p.name}
                            className={!p.image_url ? 'is-logo' : ''}
                            loading="lazy"
                            decoding="async"
                            onError={(e) => { e.target.onerror = null; e.target.src = logo; e.target.classList.add('is-logo'); }}
                        />
                    </div>
                ) : null}
                <div className="manual-order-card-content">
                    <h3 className="manual-order-card-title" title={p.name}>{p.name}</h3>
                    {p.description && (
                        <p className="manual-order-card-desc" title={p.description}>
                            {p.description}
                        </p>
                    )}
                    <div className="manual-order-card-footer-row">
                        <div className="manual-order-card-price">
                            {hasDiscount ? (
                                <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
                                    <span style={{ fontSize: '11px', opacity: 0.65, textDecoration: 'line-through' }}>
                                        {formatCurrency(Number(p.price))}
                                    </span>
                                    <span style={{ fontSize: '14px', fontWeight: '900', color: '#e63946' }}>
                                        {formatCurrency(unitPrice)}
                                    </span>
                                </div>
                            ) : (
                                formatCurrency(Number(p.price))
                            )}
                        </div>
                        <div className={`manual-order-stepper-container ${getQty(p.id) > 0 ? 'active' : ''}`}>
                            {getQty(p.id) === 0 ? (
                                <button className="manual-order-add-btn" onClick={handleAddClick}>
                                    <Plus size={18} />
                                </button>
                            ) : (
                                <div className="manual-order-stepper animate-fade-in" onClick={(e) => e.stopPropagation()}>
                                    <button className="mo-step-btn minus" onClick={(e) => {
                                        e.stopPropagation();
                                        if (getQty(p.id) === 1) removeItem(p.id);
                                        else updateQuantity(p.id, -1);
                                    }}>
                                        <Minus size={14} />
                                    </button>
                                    <span className="mo-step-count">{getQty(p.id)}</span>
                                    <button className="mo-step-btn plus" onClick={handleAddClick}>
                                        <Plus size={14} />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const deferredSearchQuery = useDeferredValue(searchQuery);
    const query = deferredSearchQuery.trim().toLowerCase();

    const baseProducts = useMemo(() => {
        return (products || []).filter((product) => {
            if (!isProductAvailableForManualOrder(product)) return false;
            const productName = String(product?.name || '').toLowerCase();
            const categoryName = String(product?.category_name || product?.categoryName || product?.category?.name || '').toLowerCase();
            return productName.includes(query) || categoryName.includes(query);
        });
    }, [products, query]);

    const beverageProducts = useMemo(() => {
        if (!cartUpsellCatalogs.beveragesEnabled) return [];
        return cartUpsellCatalogs.beverages.filter((item) => {
            const name = String(item?.name || '').toLowerCase();
            const categoryName = String(item?.category_name || '').toLowerCase();
            const detail = String(item?.description || '').toLowerCase();
            return name.includes(query) || categoryName.includes(query) || detail.includes(query);
        });
    }, [cartUpsellCatalogs.beverages, cartUpsellCatalogs.beveragesEnabled, query]);

    const extraProducts = useMemo(() => {
        if (!cartUpsellCatalogs.extrasEnabled) return [];
        return cartUpsellCatalogs.extras.filter((item) => {
            const name = String(item?.name || '').toLowerCase();
            const categoryName = String(item?.category_name || '').toLowerCase();
            const detail = String(item?.description || '').toLowerCase();
            return name.includes(query) || categoryName.includes(query) || detail.includes(query);
        });
    }, [cartUpsellCatalogs.extras, cartUpsellCatalogs.extrasEnabled, query]);

    const groupedBaseCatalog = useMemo(
        () => (baseProducts.length > 0 ? groupProductsByCategory(baseProducts, categories) : { groupedCategories: [], uncategorized: [] }),
        [baseProducts, categories],
    );

    const groupedBeverageCatalog = useMemo(
        () => (beverageProducts.length > 0 ? groupProductsByCategory(beverageProducts, []) : { groupedCategories: [], uncategorized: [] }),
        [beverageProducts],
    );

    const groupedExtrasCatalog = useMemo(
        () => (extraProducts.length > 0 ? groupProductsByCategory(extraProducts, []) : { groupedCategories: [], uncategorized: [] }),
        [extraProducts],
    );

    const renderCatalogSection = (catalog, sectionTitle, sourceLabel = '', variant = 'products', sectionNote = '') => {
        if (!catalog || (catalog.groupedCategories.length === 0 && catalog.uncategorized.length === 0)) return null;

        const totalCount = catalog.groupedCategories.reduce((sum, cat) => sum + cat.products.length, 0) + catalog.uncategorized.length;

        return (
            <section className={`manual-order-catalog-section manual-order-catalog-section--${variant}`}>
                <header className="manual-order-catalog-section__head">
                    <div className="manual-order-catalog-section__title-wrap">
                        <span className="manual-order-catalog-section__eyebrow">{variant === 'products' ? 'Catálogo principal' : variant === 'beverages' ? 'Upsell sucursal' : 'Complementos'}</span>
                        <h3 className="manual-order-catalog-section__title">{sectionTitle}</h3>
                    </div>
                    <div className="manual-order-catalog-section__meta">
                        <span className="manual-order-catalog-section__count">{totalCount}</span>
                        <span className="manual-order-catalog-section__count-label">{totalCount === 1 ? 'ítem' : 'ítems'}</span>
                    </div>
                </header>
                {sectionNote ? <p className="manual-order-catalog-section__note">{sectionNote}</p> : null}
                {catalog.groupedCategories.map((cat) => (
                    <div
                        key={cat.id}
                        className="manual-order-category-section"
                        ref={setCategoryRef(`${variant}:${cat.id}`)}
                    >
                        <h3 className="manual-order-category-title">{cat.name}</h3>
                        <div className="manual-order-products-grid">
                            {cat.products.map((p) => renderProductCard(p, sourceLabel, variant))}
                        </div>
                    </div>
                ))}
                {catalog.uncategorized.length > 0 && (
                    <div
                        className="manual-order-category-section"
                        ref={setCategoryRef(`${variant}:__uncat__`)}
                    >
                        <h3 className="manual-order-category-title">Otros</h3>
                        <div className="manual-order-products-grid">
                            {catalog.uncategorized.map((p) => renderProductCard(p, sourceLabel, variant))}
                        </div>
                    </div>
                )}
            </section>
        );
    };

    const hasAnyResults = baseProducts.length > 0 || beverageProducts.length > 0 || extraProducts.length > 0;
    const hasProductsSection = baseProducts.length > 0;
    const hasBeveragesSection = cartUpsellCatalogs.beveragesEnabled && beverageProducts.length > 0;
    const hasExtrasSection = cartUpsellCatalogs.extrasEnabled && extraProducts.length > 0;

    const sidebarCategories = useMemo(() => {
        const items = [];
        const pushFromCatalog = (catalog, variant) => {
            catalog.groupedCategories.forEach((cat) => {
                items.push({
                    key: `${variant}:${cat.id}`,
                    name: cat.name,
                    count: cat.products.length,
                    variant,
                });
            });
            if (catalog.uncategorized.length > 0) {
                items.push({
                    key: `${variant}:__uncat__`,
                    name: variant === 'products' ? 'Otros' : variant === 'beverages' ? 'Bebidas' : 'Extras',
                    count: catalog.uncategorized.length,
                    variant,
                });
            }
        };
        if (hasProductsSection) pushFromCatalog(groupedBaseCatalog, 'products');
        if (hasBeveragesSection) pushFromCatalog(groupedBeverageCatalog, 'beverages');
        if (hasExtrasSection) pushFromCatalog(groupedExtrasCatalog, 'extras');
        return items;
    }, [
        groupedBaseCatalog,
        groupedBeverageCatalog,
        groupedExtrasCatalog,
        hasProductsSection,
        hasBeveragesSection,
        hasExtrasSection,
    ]);

    const scrollToSection = (sectionRef) => {
        sectionRef?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    if (!isOpen) return null;

    const cartCount = manualOrder.items.reduce((acc, i) => acc + i.quantity, 0);
    const stepLabels = ['Productos', 'Cliente', 'Pago'];

    return (
        <div className="manual-order-overlay" onClick={onClose}>
            <div
                className={`manual-order-container${isStepsMode ? ` mobile-steps mobile-step-${mobileStep}` : ''}`}
                onClick={e => e.stopPropagation()}
            >
                {/* DRAG HANDLER (Invisible top area for gestures) */}
                <div
                    className="manual-order-drag-zone"
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                />

                {/* FLOATING CLOSE BUTTON */}
                <button
                    onClick={onClose}
                    className="manual-order-floating-close"
                    title="Cerrar (Esc)"
                >
                    <X size={24} />
                </button>

                {/* WIZARD PROGRESS (solo movil) */}
                {isStepsMode ? (
                    <div className="manual-order-steps-progress" aria-label={`Paso ${mobileStep} de 3`}>
                        {stepLabels.map((label, idx) => {
                            const n = idx + 1;
                            const isActive = mobileStep === n;
                            const isDone = mobileStep > n;
                            return (
                                <div
                                    key={label}
                                    className={`manual-order-steps-progress__item${isActive ? ' is-active' : ''}${isDone ? ' is-done' : ''}`}
                                >
                                    <span className="manual-order-steps-progress__dot">{isDone ? <CheckCircle2 size={14} /> : n}</span>
                                    <span className="manual-order-steps-progress__label">{label}</span>
                                </div>
                            );
                        })}
                    </div>
                ) : null}

                {/* CONTENT: 2 COLUMNAS */}
                <div className="manual-order-body">
                    {/* COLUMNA IZQUIERDA: PRODUCTOS */}
                    <div className="manual-order-products">

                        {/* FLOATING SEARCH PILL */}
                        <div
                            className={`manual-order-search-pill ${searchExpanded || searchQuery ? 'expanded' : ''}`}
                            onClick={toggleSearch}
                        >
                            <div className="manual-order-search-icon-wrapper">
                                <Search size={20} />
                            </div>
                            <input
                                ref={searchInputRef}
                                type="text"
                                placeholder="Buscar..."
                                className="manual-order-search-input-pill"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                onBlur={handleSearchBlur}
                                onClick={(e) => e.stopPropagation()}
                            />
                        </div>

                        <label className="manual-order-images-toggle" title="Mostrar/ocultar imágenes de productos">
                            <input
                                type="checkbox"
                                checked={showProductImages}
                                onChange={(e) => setShowProductImages(e.target.checked)}
                            />
                            <span className="manual-order-images-toggle__track" aria-hidden="true">
                                <span className="manual-order-images-toggle__thumb" />
                            </span>
                            <span className="manual-order-images-toggle__label">Mostrar imágenes</span>
                        </label>

                        <div className="manual-order-section-jumprail" aria-label="Navegación rápida del catálogo">
                            <button
                                type="button"
                                className="manual-order-section-jumprail__btn manual-order-section-jumprail__btn--products"
                                onClick={() => scrollToSection(productsSectionRef)}
                                disabled={!hasProductsSection}
                                aria-label="Ir a Productos"
                                title="Productos"
                            >
                                <ShoppingBag size={18} aria-hidden="true" />
                            </button>
                            <button
                                type="button"
                                className="manual-order-section-jumprail__btn manual-order-section-jumprail__btn--beverages"
                                onClick={() => scrollToSection(beveragesSectionRef)}
                                disabled={!hasBeveragesSection}
                                aria-label="Ir a Bebidas"
                                title="Bebidas"
                            >
                                <CupSoda size={18} aria-hidden="true" />
                            </button>
                            <button
                                type="button"
                                className="manual-order-section-jumprail__btn manual-order-section-jumprail__btn--extras"
                                onClick={() => scrollToSection(extrasSectionRef)}
                                disabled={!hasExtrasSection}
                                aria-label="Ir a Extras"
                                title="Extras"
                            >
                                <Sparkles size={18} aria-hidden="true" />
                            </button>
                        </div>

                        {/* Layout: sidebar de categorias + scroll de productos */}
                        <div className="manual-order-catalog-wrap">
                            {sidebarCategories.length > 0 && (
                                <aside
                                    className="manual-order-categories-side"
                                    aria-label="Lista de categorias"
                                >
                                    {sidebarCategories.map((it) => (
                                        <button
                                            key={it.key}
                                            type="button"
                                            className={`manual-order-categories-side__btn manual-order-categories-side__btn--${it.variant}`}
                                            onClick={() => scrollToCategory(it.key)}
                                            title={it.name}
                                        >
                                            <span className="manual-order-categories-side__name">{it.name}</span>
                                            <span className="manual-order-categories-side__count">{it.count}</span>
                                        </button>
                                    ))}
                                </aside>
                            )}
                            <div className="manual-order-categories-scroll">
                                {!hasAnyResults ? (
                                    <div className="manual-order-empty-search" style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
                                        No se encontraron productos
                                    </div>
                                ) : (
                                    <>
                                        <div ref={productsSectionRef}>
                                            {renderCatalogSection(groupedBaseCatalog, 'Productos', '', 'products', 'Producto regular del menú para este pedido manual.')}
                                        </div>
                                        {beverageProducts.length > 0 && (
                                            <div ref={beveragesSectionRef}>
                                                {renderCatalogSection(groupedBeverageCatalog, 'Bebidas', 'Bebida', 'beverages', 'Opciones de bebida activas para esta sucursal.')}
                                            </div>
                                        )}
                                        {extraProducts.length > 0 && (
                                            <div ref={extrasSectionRef}>
                                                {renderCatalogSection(groupedExtrasCatalog, 'Extras', 'Extra', 'extras', 'Complementos opcionales disponibles en carrito.')}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* COLUMNA DERECHA: SIDEBAR Y PANEL LATERAL */}
                    {isMobileLikeLayout ? (
                        <>
                            <div className="manual-order-side-panel">
                                {orderTypeSection}
                                {customerSection}
                                {noteSection}
                            </div>
                            <div className="manual-order-sidebar">
                                {summarySection}
                                {footerSection}
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="manual-order-sidebar">
                                {summarySection}
                                {footerSection}
                            </div>
                            <div className="manual-order-side-panel">
                                {orderTypeSection}
                                {customerSection}
                                {noteSection}
                            </div>
                        </>
                    )}
                </div>

                {/* NAV BAR INFERIOR (solo movil wizard) */}
                {isStepsMode ? (
                    <div className="manual-order-steps-nav">
                        {mobileStep > 1 ? (
                            <button
                                type="button"
                                className="manual-order-steps-nav__btn manual-order-steps-nav__btn--back"
                                onClick={goPrevStep}
                            >
                                Atras
                            </button>
                        ) : (
                            <span className="manual-order-steps-nav__spacer" />
                        )}
                        {mobileStep < 3 ? (
                            <button
                                type="button"
                                className="manual-order-steps-nav__btn manual-order-steps-nav__btn--next"
                                onClick={goNextStep}
                                disabled={mobileStep === 1 ? !canAdvanceFromStep1 : !canAdvanceFromStep2}
                            >
                                {mobileStep === 1 && cartCount > 0
                                    ? `Siguiente (${cartCount} items - ${formatCurrency(totalToPay)})`
                                    : 'Siguiente'}
                            </button>
                        ) : (
                            <span className="manual-order-steps-nav__hint">Confirma el pedido abajo</span>
                        )}
                    </div>
                ) : null}
            </div>
        </div>
    );
};

export default ManualOrderModal;
