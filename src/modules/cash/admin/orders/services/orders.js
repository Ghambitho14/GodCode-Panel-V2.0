import { supabase, TABLES } from '@/integrations/supabase';
import { uploadImage } from '@/shared/utils/cloudinary';
import {
    computeCouponDiscountAmount,
    fetchActiveCouponByCode,
    normalizeCouponCode,
} from '@/lib/discount-coupon';
import {
    computeDeliveryFee,
    effectiveDeliveryPricingMode,
    extractCartUpsellSettings,
    normalizeDeliverySettings,
    isOrderPaymentAllowedForDelivery,
} from '@/lib/delivery-settings';
import { buildDeliveryAddressRecord, sanitizeOrder, normalizePaymentBreakdown, isMixedPaymentBreakdown } from '@/shared/utils/orderUtils';
import { canOverrideDeliveryFee } from '@/modules/cash/utils/deliveryFeePermissions';
import { buildGoogleMapsDirectionsUrl } from '@/lib/geo';
import { printOrderTicket } from '@/modules/cash/admin/utils/receiptPrinting';
import { normalizeManualPhone } from '@/modules/cash/services/clientService';

function isFiniteLatLng(lat, lng) {
    const a = Number(lat);
    const b = Number(lng);
    return Number.isFinite(a) && Number.isFinite(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180;
}

function resolveNamedAreaLabelFromSettings(settings, namedId) {
    if (!namedId || !settings?.namedAreas?.length) return '';
    const hit = settings.namedAreas.find((a) => a.id === namedId);
    return hit?.name ?? '';
}

function isDeliveryOrderType(raw) {
    const t = String(raw ?? 'pickup').trim().toLowerCase();
    return t === 'delivery' || t === 'envio' || t === 'envío' || t === 'despacho';
}

/** Nota por línea (cocina / ticket); mismo límite que `useManualOrder`. */
function normalizePersistedItemNote(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    return s ? s.slice(0, 140) : null;
}

function isCatalogUpsellItem(item) {
    const source = String(item?.manual_order_source ?? '').toLowerCase();
    return source === 'extras' || source === 'beverages' || Boolean(item?.is_extra);
}

function buildUpsellCatalogMap(deliverySettings) {
    const map = new Map();
    const { cartBeveragesCatalog, cartGlobalExtrasCatalog } =
        extractCartUpsellSettings(deliverySettings);
    for (const row of [
        ...(cartGlobalExtrasCatalog || []),
        ...(cartBeveragesCatalog || []),
    ]) {
        if (!row?.id || row.active === false) continue;
        map.set(String(row.id), row);
    }
    return map;
}

function throwOrderRpcError(error) {
    const rpcMessage = String(error?.message || '').toLowerCase();
    if (rpcMessage.includes('invalid_coupon')) {
        throw new Error('El código de descuento no es válido.');
    }
    if (rpcMessage.includes('coupon_expired')) {
        throw new Error('Este cupón no está vigente.');
    }
    if (rpcMessage.includes('coupon_min_subtotal')) {
        throw new Error('El subtotal del pedido no alcanza el mínimo de este cupón.');
    }
    if (rpcMessage.includes('coupon_wrong_client')) {
        throw new Error('Este cupón solo aplica si el teléfono coincide con el cliente autorizado.');
    }
    if (rpcMessage.includes('coupon_usage_exhausted')) {
        throw new Error('Este cupón ya no tiene usos disponibles.');
    }
    if (rpcMessage.includes('coupon_usage_exhausted_client')) {
        throw new Error('Este cupón ya fue usado con este teléfono.');
    }
    if (rpcMessage.includes('delivery_address_required')) {
        throw new Error('Completa los datos de dirección o zona para el envío.');
    }
    if (rpcMessage.includes('invalid_delivery_fee_override')) {
        throw new Error('No tienes permiso para modificar el costo de envío.');
    }
    if (rpcMessage.includes('invalid_item_price') || rpcMessage.includes('no_items_available')) {
        if (rpcMessage.includes('no_items_available')) {
            throw new Error('Ningún producto del carrito está disponible en esta sucursal en este momento.');
        }
        throw new Error('Hay productos del carrito que no están disponibles para esta sucursal. Actualiza el menú e intenta nuevamente.');
    }
    if (rpcMessage.includes('insufficient_inventory_stock')) {
        throw new Error('Stock insuficiente en inventario para completar el pedido. Revisa recetas y existencias en la sucursal.');
    }
    if (rpcMessage.includes('inventory_branch_missing')) {
        throw new Error('Falta configuración de stock en sucursal para un artículo del pedido. Completa el inventario por local.');
    }
    if (
        rpcMessage.includes('auth_required')
        || rpcMessage.includes('order_edit_not_allowed')
        || rpcMessage.includes('order_not_found_or_not_allowed')
        || String(error?.code) === '42501'
        || rpcMessage.includes('row-level security')
    ) {
        throw new Error('No tienes permisos para editar este pedido.');
    }
    if (
        rpcMessage.includes('duplicate_client_phone')
        || rpcMessage.includes('clients_phone_key')
        || (String(error?.code) === '23505' && rpcMessage.includes('phone'))
    ) {
        throw new Error('Ya existe un cliente con este teléfono. Selecciónalo del listado o elige otro número.');
    }
    if (rpcMessage.includes('client_not_found_or_not_allowed')) {
        throw new Error('El cliente seleccionado no es válido para esta empresa. Vuelve a elegirlo del listado.');
    }
    throw error;
}

function buildDeliveryPayloadForRpc({
    deliveryMode,
    basePayload,
    deliveryLat,
    deliveryLng,
}) {
    if (!deliveryMode) return null;
    let payload = basePayload && typeof basePayload === 'object' ? { ...basePayload } : basePayload;
    if (isFiniteLatLng(deliveryLat, deliveryLng)) {
        const lat = Number(deliveryLat);
        const lng = Number(deliveryLng);
        payload = {
            ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}),
            lat,
            lng,
            maps_url: buildGoogleMapsDirectionsUrl(lat, lng),
        };
    }
    return payload;
}

function resolvePaymentBreakdownForRpc(breakdown, total) {
    if (!breakdown) return null;
    const normalized = normalizePaymentBreakdown(breakdown);
    const breakdownSum = normalized.cash + normalized.card + normalized.online;
    if (
        isMixedPaymentBreakdown(normalized)
        && Math.abs(breakdownSum - Math.round(total)) <= 1
    ) {
        return normalized;
    }
    return null;
}

/**
 * Servicio Senior de Órdenes
 * Encapsula la lógica de negocio de creación de pedidos tanto para 
 * clientes (Web) como para administración (Manual).
 */
export const ordersService = {
    /**
     * Crea un pedido completo vinculándolo a un cliente (o creando uno nuevo)
     */
    async createOrder(orderData, receiptFile = null) {
        try {
            // 0. VALIDACIÓN DE CAJA (REGLA DE NEGOCIO GLOBAL)
            if (!orderData.branch_id) {
                throw new Error("El ID de sucursal es obligatorio para crear un pedido.");
            }

            if (!Array.isArray(orderData.items) || orderData.items.length === 0) {
                throw new Error("El pedido debe contener al menos un producto.");
            }

            // Separar catálogo upsell (extras/bebidas) de productos del menú principal
            const regularItems = [];
            const upsellItems = [];

            for (const item of orderData.items) {
                if (!item?.id) continue;
                if (isCatalogUpsellItem(item)) {
                    upsellItems.push(item);
                } else {
                    regularItems.push(item);
                }
            }

            const { data: branchCfg, error: branchCfgError } = await supabase
                .from(TABLES.branches)
                .select('delivery_settings, payment_methods')
                .eq('id', orderData.branch_id)
                .maybeSingle();

            if (branchCfgError) {
                throw new Error('No se pudo validar la configuración de la sucursal. Intenta nuevamente.');
            }

            const deliverySettings = normalizeDeliverySettings(branchCfg?.delivery_settings);
            const upsellCatalogMap = buildUpsellCatalogMap(branchCfg?.delivery_settings);

            const requestedMap = new Map(
                regularItems
                    .filter((item) => Boolean(item?.id))
                    .map((item) => [String(item.id), {
                        quantity: Math.max(1, Number(item.quantity) || 1),
                        description: item.description ?? null,
                        note: normalizePersistedItemNote(item.note),
                    }])
            );

            const requestedIds = Array.from(requestedMap.keys());
            
            if (requestedIds.length === 0 && upsellItems.length === 0) {
                throw new Error('El pedido debe contener al menos un producto válido.');
            }

            let prices = [];
            let branchRows = [];
            let productsMeta = [];
            let pricesError = null;
            let branchRowsError = null;
            let productsMetaError = null;

            if (requestedIds.length > 0) {
                const [pricesRes, branchRes, productsRes] = await Promise.all([
                    supabase
                        .from(TABLES.product_prices)
                        .select('product_id, price, has_discount, discount_price')
                        .eq('branch_id', orderData.branch_id)
                        .eq('is_active', true)
                        .in('product_id', requestedIds),
                    supabase
                        .from(TABLES.product_branch)
                        .select('product_id')
                        .eq('branch_id', orderData.branch_id)
                        .eq('is_active', true)
                        .in('product_id', requestedIds),
                    supabase
                        .from(TABLES.products)
                        .select('id, name')
                        .eq('is_active', true)
                        .in('id', requestedIds),
                ]);
                prices = pricesRes.data || [];
                pricesError = pricesRes.error;
                branchRows = branchRes.data || [];
                branchRowsError = branchRes.error;
                productsMeta = productsRes.data || [];
                productsMetaError = productsRes.error;
            }

            if (pricesError || branchRowsError || productsMetaError) {
                throw new Error('No se pudo validar los productos de la sucursal. Intenta nuevamente.');
            }

            const pricesByProduct = new Map((prices || []).map((row) => [String(row.product_id), row]));
            const branchActiveIds = new Set((branchRows || []).map((row) => String(row.product_id)));
            const productNames = new Map((productsMeta || []).map((row) => [String(row.id), row.name]));

            const normalizedItems = [];

            for (const productId of requestedIds) {
                if (!branchActiveIds.has(productId)) continue;

                const dbPriceRow = pricesByProduct.get(productId);
                if (!dbPriceRow) continue;

                const basePrice = Number(dbPriceRow.price || 0);
                const discountPrice = Number(dbPriceRow.discount_price || 0);
                const hasDiscount = Boolean(dbPriceRow.has_discount) && discountPrice > 0;
                const effectivePrice = hasDiscount ? discountPrice : basePrice;
                if (!Number.isFinite(effectivePrice) || effectivePrice <= 0) continue;

                const requested = requestedMap.get(productId);
                if (!requested) continue;

                normalizedItems.push({
                    id: productId,
                    name: String(productNames.get(productId) || 'Producto'),
                    quantity: requested.quantity,
                    price: effectivePrice,
                    has_discount: false,
                    discount_price: null,
                    description: requested.description,
                    note: requested.note,
                    manual_order_source: null,
                    is_extra: false,
                });
            }

            // Upsell: validar contra catálogo de sucursal (defensa en profundidad; RPC revalida)
            for (const upsellItem of upsellItems) {
                const catalogRow = upsellCatalogMap.get(String(upsellItem.id));
                if (!catalogRow) {
                    throw new Error('Hay productos del carrito que no están disponibles para esta sucursal. Actualiza el menú e intenta nuevamente.');
                }
                const catalogPrice = Number(catalogRow.price);
                if (!Number.isFinite(catalogPrice) || catalogPrice < 0) {
                    throw new Error('Hay productos del carrito que no están disponibles para esta sucursal. Actualiza el menú e intenta nuevamente.');
                }
                const source = String(upsellItem.manual_order_source ?? '').toLowerCase() || 'extras';
                const isExtra = source === 'extras' || Boolean(upsellItem.is_extra);

                normalizedItems.push({
                    id: String(upsellItem.id),
                    name: String(catalogRow.name || upsellItem.name || 'Extra'),
                    quantity: Math.max(1, Number(upsellItem.quantity) || 1),
                    price: catalogPrice,
                    has_discount: false,
                    discount_price: null,
                    description: upsellItem.description || null,
                    note: normalizePersistedItemNote(upsellItem.note),
                    manual_order_source: source,
                    is_extra: isExtra,
                });
            }

            if (normalizedItems.length === 0 && regularItems.length > 0) {
                throw new Error('Ningún producto del carrito está disponible en esta sucursal en este momento.');
            }
            if (normalizedItems.length === 0) {
                throw new Error('El pedido debe contener al menos un producto válido.');
            }

            const { data: openShift } = await supabase
                .from(TABLES.cash_shifts)
                .select('id')
                .eq('status', 'open')
                .eq('branch_id', orderData.branch_id)
                .maybeSingle();

            if (!openShift) {
                throw new Error("El local no está recibiendo pedidos en este momento (Caja Cerrada). Por favor verifique el horario de atención.");
            }

            const calculatedItemsTotal = normalizedItems.reduce((sum, item) => {
                const price = (item.has_discount && item.discount_price && Number(item.discount_price) > 0) 
                    ? Number(item.discount_price) 
                    : Number(item.price || 0);
                
                const qty = Math.max(1, Number(item.quantity) || 1);
                
                return sum + (price * qty);
            }, 0);

            const deliveryMode = isDeliveryOrderType(orderData.order_type);

            let deliveryFee = 0;
            if (deliveryMode) {
                if (!deliverySettings.enabled) {
                    throw new Error('El delivery no está habilitado para esta sucursal.');
                }
                const namedIdRaw =
                    orderData.delivery_named_area_id ?? orderData.namedAreaId;
                let namedId =
                    typeof namedIdRaw === 'string' && namedIdRaw.trim()
                        ? namedIdRaw.trim()
                        : null;
                const km = Number(orderData.delivery_km);
                const safeKm = Number.isFinite(km) && km >= 0 ? km : 0;
                const priceMode = effectiveDeliveryPricingMode(deliverySettings);

                if (
                    priceMode === 'named' &&
                    deliverySettings.namedAreaResolution === 'address_matched' &&
                    !namedId
                ) {
                    // Geocoding por dirección libre no está disponible en GodCode caja:
                    // requería el endpoint Next /api/delivery-geocode (eliminado).
                    // En Fase 3 se reemplaza por una Edge Function `geocode`.
                    // Hasta entonces, el cajero debe elegir la zona explícitamente
                    // o cambiar el modo de delivery de la sucursal a Tarifa fija / Distancia.
                    throw new Error(
                        'Geocoding por dirección no disponible. Elegí la zona de entrega ' +
                        'desde el selector, o cambiá el modo de delivery de esta sucursal ' +
                        'a Tarifa fija o Distancia en Settings.',
                    );
                }

                const r =
                    priceMode === 'named'
                        ? computeDeliveryFee(deliverySettings, 0, calculatedItemsTotal, {
                              namedAreaId: namedId,
                          })
                        : computeDeliveryFee(deliverySettings, safeKm, calculatedItemsTotal);
                if (r.fee === -1) {
                    throw new Error('La distancia indicada supera el máximo permitido para delivery en esta sucursal.');
                }
                if (r.fee === -2) {
                    throw new Error('El subtotal del pedido no alcanza el mínimo requerido para delivery.');
                }
                if (r.fee === -3) {
                    throw new Error('Debes elegir una zona de entrega.');
                }
                if (r.fee === -4) {
                    throw new Error('La zona de entrega seleccionada no es válida.');
                }
                deliveryFee = r.fee;

                const callerRole = orderData.caller_role ?? orderData.user_role ?? null;
                if (
                    canOverrideDeliveryFee(callerRole)
                    && typeof orderData.manual_delivery_fee === 'number'
                    && orderData.manual_delivery_fee >= 0
                ) {
                    deliveryFee = orderData.manual_delivery_fee;
                }

                const branchPm = branchCfg?.payment_methods;
                if (
                    !isOrderPaymentAllowedForDelivery(
                        orderData,
                        Array.isArray(branchPm) ? branchPm : [],
                        deliverySettings,
                    )
                ) {
                    throw new Error(
                        'El método de pago no está permitido para delivery en esta sucursal.',
                    );
                }
            }

            const itemsSubtotal = Math.round(calculatedItemsTotal * 100) / 100;
            const normCoupon = normalizeCouponCode(orderData.coupon_code);
            let couponDisc = 0;
            let pCouponCode = null;
            if (normCoupon) {
                pCouponCode = normCoupon;
                if (!orderData.company_id) {
                    throw new Error('Falta empresa para validar el cupón.');
                }
                const couponRow = await fetchActiveCouponByCode(
                    supabase,
                    String(orderData.company_id),
                    normCoupon,
                    TABLES.discount_coupons,
                );
                if (couponRow) {
                    couponDisc = computeCouponDiscountAmount(itemsSubtotal, couponRow);
                }
            }
            const netAfterCoupon = Math.round(Math.max(0, itemsSubtotal - couponDisc) * 100) / 100;
            let totalForRpc = deliveryMode
                ? Math.round((netAfterCoupon + deliveryFee) * 100) / 100
                : netAfterCoupon;

            const namedForAddr = String(
                orderData.delivery_named_area_id ?? orderData.namedAreaId ?? '',
            ).trim();
            const namedLabelForAddr = resolveNamedAreaLabelFromSettings(
                deliverySettings,
                namedForAddr,
            );
            const pDeliveryPayload = buildDeliveryPayloadForRpc({
                deliveryMode,
                basePayload: deliveryMode
                    ? buildDeliveryAddressRecord({
                          rawAddress: orderData.delivery_address,
                          deliveryReference: orderData.delivery_reference,
                          namedAreaId: namedForAddr || null,
                          namedAreaLabel: namedLabelForAddr || null,
                      })
                    : null,
                deliveryLat: orderData.delivery_lat,
                deliveryLng: orderData.delivery_lng,
            });

            // 1. Subida de comprobante (si aplica). Si falla, guardamos el pedido igual.
            let receiptUrl = null;
            let receiptUploadFailed = false;
            if (orderData.payment_type === 'online' && receiptFile) {
                try {
                    receiptUrl = await uploadImage(receiptFile, 'receipts');
                } catch {
                    receiptUploadFailed = true;
                }
            }

            // 2. Preparar datos para la transacción
            const paymentRef = receiptUrl
                || orderData.payment_ref
                || (orderData.payment_type === 'online' ? 'Comprobante pendiente por WhatsApp' : 'Pago Presencial');

            // Agregar info de sucursal a la nota para que el admin sepa
            let finalNote = orderData.note || '';
            if (orderData.branch_name) {
                finalNote = `[Sucursal: ${orderData.branch_name}] \n${finalNote}`.trim();
            }
            if (deliveryMode && deliveryFee > 0) {
                finalNote = `${finalNote}\n[Envío: $${Math.round(deliveryFee).toLocaleString('es-CL')}]`.trim();
            }

            const clientRut = String(orderData.client_rut ?? orderData.client_document ?? '').trim();
            const clientPhone = normalizeManualPhone(
                String(orderData.client_phone ?? '').trim(),
            );
            const selectedClientId = String(
                orderData.selected_client_id ?? orderData.client_id ?? '',
            ).trim() || null;

            // 3. EJECUTAR TRANSACCIÓN ATÓMICA (RPC)
            // Inventario: confirmar en Supabase que esta RPC descuenta product_inventory_recipe.qty_per_sale
            // multiplicado por la cantidad vendida de cada producto; si no, ajustar la función en SQL.
            const { data: newOrder, error: orderError } = await supabase.rpc('create_order_transaction', {
                p_client_name: orderData.client_name,
                p_client_phone: clientPhone,
                p_client_rut: clientRut,
                p_items: normalizedItems,
                p_total: totalForRpc,
                p_payment_type: orderData.payment_type,
                p_payment_ref: paymentRef,
                p_payment_method_specific: orderData.payment_method_specific ?? null,
                p_note: finalNote,
                p_branch_id: orderData.branch_id,
                p_company_id: orderData.company_id || null,
                p_status: orderData.status || 'pending',
                p_order_type: deliveryMode ? 'delivery' : 'pickup',
                p_delivery_address: pDeliveryPayload,
                p_delivery_fee: deliveryMode ? deliveryFee : 0,
                p_coupon_code: pCouponCode,
                p_payment_breakdown: resolvePaymentBreakdownForRpc(orderData.payment_breakdown, totalForRpc),
                p_client_id: selectedClientId,
            });

            if (orderError) {
                throwOrderRpcError(orderError);
            }

            return { order: newOrder, receiptUploadFailed };
        } catch (error) {
            throw error;
        }
    },

    /**
     * Actualiza un pedido existente vía RPC `update_order_transaction`.
     * Precios y totales se revalidan en servidor; preserva campos inmutables del pedido.
     */
    async updateOrder(orderId, patch, options = {}) {
        if (!orderId) throw new Error('orderId requerido');
        if (!patch || typeof patch !== 'object') throw new Error('patch invalido');

        const itemsForOrder = Array.isArray(patch.items) ? patch.items : [];
        if (itemsForOrder.length === 0) {
            throw new Error('El pedido debe contener al menos un producto.');
        }

        const isDelivery = String(patch.order_type ?? '').toLowerCase() === 'delivery';
        const branchSettings = options.branchSettings ?? null;
        const namedId = isDelivery
            ? (String(patch.delivery_named_area_id ?? '').trim() || null)
            : null;
        const namedLabel = isDelivery && namedId
            ? resolveNamedAreaLabelFromSettings(branchSettings, namedId)
            : '';

        const streetLine = isDelivery ? String(patch.delivery_address ?? '').trim() : '';
        let rawForDelivery = patch.delivery_address_base ?? patch.delivery_address;
        if (
            isDelivery &&
            patch.delivery_address_base &&
            typeof patch.delivery_address_base === 'object' &&
            !Array.isArray(patch.delivery_address_base)
        ) {
            rawForDelivery = {
                ...(/** @type {Record<string, unknown>} */ (patch.delivery_address_base)),
                ...(streetLine ? { address: streetLine } : {}),
            };
        }

        const deliveryAddressRecord = isDelivery
            ? buildDeliveryAddressRecord({
                rawAddress: rawForDelivery,
                deliveryReference: patch.delivery_reference,
                namedAreaId: namedId,
                namedAreaLabel: namedLabel || null,
            })
            : null;

        const deliveryFee = isDelivery ? Math.max(0, Number(patch.delivery_fee) || 0) : 0;
        const normCoupon = normalizeCouponCode(patch.coupon_code) || null;

        const paymentBreakdown = Object.prototype.hasOwnProperty.call(patch, 'payment_breakdown')
            ? (patch.payment_breakdown || null)
            : null;

        const { data: updated, error } = await supabase.rpc('update_order_transaction', {
            p_order_id: orderId,
            p_client_name: String(patch.client_name ?? ''),
            p_client_phone: normalizeManualPhone(String(patch.client_phone ?? '')),
            p_client_rut: String(patch.client_rut ?? ''),
            p_items: itemsForOrder,
            p_payment_type: String(patch.payment_type ?? 'tienda'),
            p_note: typeof patch.note === 'string' ? patch.note : '',
            p_order_type: isDelivery ? 'delivery' : 'pickup',
            p_delivery_address: deliveryAddressRecord,
            p_delivery_fee: deliveryFee,
            p_coupon_code: normCoupon,
            p_payment_breakdown: paymentBreakdown,
        });

        if (error) {
            throwOrderRpcError(error);
        }

        // Resync de inventario best-effort (si items cambiaron).
        if (options.itemsChanged) {
            const { error: rpcErr } = await supabase.rpc('admin_resync_order_inventory', {
                p_order_id: orderId,
            });
            if (rpcErr) {
                // RPC todavia no existe o fallo: avisamos pero no rompemos el flujo.
                console.warn('[updateOrder] resync inventario fallo:', rpcErr.message);
                options.showNotify?.(
                    'Pedido guardado, pero el inventario no se resincronizó. Revisalo manualmente.',
                    'warning',
                );
            }
        }

        // Reimpresion automatica de ticket cocina si el pedido ya esta en
        // cocina y cambiaron los items.
        const status = String(updated?.status ?? options.prevStatus ?? '').toLowerCase();
        if (options.itemsChanged && status === 'active') {
            try {
                printOrderTicket(updated, options.branchName ?? null, options.logoUrl ?? null, {
                    variant: 'kitchen',
                    branchAddress: options.branchAddress ?? null,
                });
            } catch (printErr) {
                console.warn('[updateOrder] reimpresion cocina fallo:', printErr);
            }
        }

        return sanitizeOrder(updated);
    },
};

export const createManualOrder = (orderData, receiptFile) => ordersService.createOrder(orderData, receiptFile);
