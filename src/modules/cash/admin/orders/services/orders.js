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
    normalizeDeliverySettings,
    isOrderPaymentAllowedForDelivery,
} from '@/lib/delivery-settings';
import { buildDeliveryAddressRecord } from '@/shared/utils/orderUtils';
import { buildGoogleMapsDirectionsUrl } from '@/lib/geo';
import { printOrderTicket } from '@/modules/cash/admin/utils/receiptPrinting';

function isFiniteLatLng(lat, lng) {
    const a = Number(lat);
    const b = Number(lng);
    return Number.isFinite(a) && Number.isFinite(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180;
}

function extractOrderId(newOrder) {
    if (newOrder == null) return null;
    if (typeof newOrder === 'string') return newOrder;
    if (Array.isArray(newOrder) && newOrder.length > 0) {
        return extractOrderId(newOrder[0]);
    }
    if (typeof newOrder === 'object') {
        const id = newOrder.id ?? newOrder.order_id;
        return id != null ? String(id) : null;
    }
    return null;
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

            // Separar extras de productos normales
            const regularItems = [];
            const extraItems = [];
            
            for (const item of orderData.items) {
                if (!item?.id) continue;
                const isExtra = item.manual_order_source === 'extras' || Boolean(item.is_extra);
                if (isExtra) {
                    extraItems.push(item);
                } else {
                    regularItems.push(item);
                }
            }

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
            
            if (requestedIds.length === 0 && extraItems.length === 0) {
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

            // Agregar extras sin validar contra BD (vienen del catálogo de carrito)
            for (const extraItem of extraItems) {
                const extraPrice = Number(extraItem.price) || 0;
                if (!Number.isFinite(extraPrice) || extraPrice <= 0) continue;
                
                normalizedItems.push({
                    id: String(extraItem.id),
                    name: String(extraItem.name || 'Extra'),
                    quantity: Math.max(1, Number(extraItem.quantity) || 1),
                    price: extraPrice,
                    has_discount: Boolean(extraItem.has_discount) && Number(extraItem.discount_price) > 0,
                    discount_price: Boolean(extraItem.has_discount) && Number(extraItem.discount_price) > 0 ? Number(extraItem.discount_price) : null,
                    description: extraItem.description || null,
                    note: normalizePersistedItemNote(extraItem.note),
                    manual_order_source: 'extras',
                    is_extra: true,
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

            const { data: branchCfg, error: branchCfgError } = await supabase
                .from(TABLES.branches)
                .select('delivery_settings, payment_methods')
                .eq('id', orderData.branch_id)
                .maybeSingle();

            if (branchCfgError) {
                throw new Error('No se pudo validar la configuración de la sucursal. Intenta nuevamente.');
            }

            const deliverySettings = normalizeDeliverySettings(branchCfg?.delivery_settings);
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

                // Soporte para cobro de envío manual (ej: desde panel admin)
                if (typeof orderData.manual_delivery_fee === 'number' && orderData.manual_delivery_fee >= 0) {
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
            const pDeliveryPayload = deliveryMode
                ? buildDeliveryAddressRecord({
                      rawAddress: orderData.delivery_address,
                      deliveryReference: orderData.delivery_reference,
                      namedAreaId: namedForAddr || null,
                      namedAreaLabel: namedLabelForAddr || null,
                  })
                : null;

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

            // 3. EJECUTAR TRANSACCIÓN ATÓMICA (RPC)
            // Inventario: confirmar en Supabase que esta RPC descuenta product_inventory_recipe.qty_per_sale
            // multiplicado por la cantidad vendida de cada producto; si no, ajustar la función en SQL.
            const { data: newOrder, error: orderError } = await supabase.rpc('create_order_transaction', {
                p_client_name: orderData.client_name,
                p_client_phone: orderData.client_phone,
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
            });

            if (orderError) {
                const rpcMessage = String(orderError.message || '').toLowerCase();
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
                if (
                    rpcMessage.includes('invalid_item_price') ||
                    rpcMessage.includes('delivery_address_required')
                ) {
                    if (rpcMessage.includes('delivery_address_required')) {
                        throw new Error('Completa los datos de dirección o zona para el envío.');
                    }
                    throw new Error('Hay productos del carrito que no están disponibles para esta sucursal. Actualiza el menú e intenta nuevamente.');
                }
                if (rpcMessage.includes('no_items_available')) {
                    throw new Error('Ningún producto del carrito está disponible en esta sucursal en este momento.');
                }
                if (rpcMessage.includes('insufficient_inventory_stock')) {
                    throw new Error('Stock insuficiente en inventario para completar el pedido. Revisa recetas y existencias en la sucursal.');
                }
                if (rpcMessage.includes('inventory_branch_missing')) {
                    throw new Error('Falta configuración de stock en sucursal para un insumo del pedido. Completa el inventario por local.');
                }
                throw orderError;
            }

            // La RPC `create_order_transaction` ya setea: channel, total, delivery_fee,
            // delivery_address y handoff_code. En algunos despliegues la RPC reconstruye
            // `items` jsonb sin campos extra (p. ej. `note` por línea). Reescribimos `items`
            // y `note` con lo ya validado en cliente para que cocina/caja vean las notas.
            const orderId = extractOrderId(newOrder);
            let persistedOrder = newOrder;
            if (orderId) {
                const postCreatePatch = {
                    items: normalizedItems,
                    note: finalNote,
                };
                if (
                    deliveryMode &&
                    isFiniteLatLng(orderData.delivery_lat, orderData.delivery_lng)
                ) {
                    const lat = Number(orderData.delivery_lat);
                    const lng = Number(orderData.delivery_lng);
                    postCreatePatch.delivery_address = {
                        ...(pDeliveryPayload && typeof pDeliveryPayload === 'object' ? pDeliveryPayload : {}),
                        lat,
                        lng,
                        maps_url: buildGoogleMapsDirectionsUrl(lat, lng),
                    };
                }
                const { data: patchedRow, error: postCreateError } = await supabase
                    .from(TABLES.orders)
                    .update(postCreatePatch)
                    .eq('id', orderId)
                    .select()
                    .maybeSingle();
                if (postCreateError) {
                    console.warn('createOrder: post-create sync (items/note/address) failed', postCreateError);
                } else if (patchedRow) {
                    persistedOrder = patchedRow;
                }
            }

            return { order: persistedOrder, receiptUploadFailed };
        } catch (error) {
            throw error;
        }
    },

    /**
     * Actualiza un pedido existente (UPDATE directo via RLS).
     *
     * No usa RPC `create_order_transaction` porque ese flujo asume creacion
     * + descuento de inventario. Para edicion preservamos handoff_code,
     * order_number, created_at, created_by, paid_status, status, branch_id
     * y company_id; el caller llena el resto.
     *
     * Reglas operativas:
     * - Recalcula `total` client-side con la misma logica que createOrder.
     * - Si `itemsChanged === true` y existe el RPC `admin_resync_order_inventory`,
     *   intenta llamarlo best-effort para mantener stock consistente.
     * - Si `status === 'active'` y items cambiaron, reimprime ticket cocina.
     * - Si `total` cambio respecto a `prevTotal` y el pedido ya estaba en
     *   `active`/`completed`/`picked_up`, avisamos al cajero con `showNotify`
     *   para que ajuste la caja manualmente (en esta version no hay ajuste
     *   automatico de la venta registrada).
     */
    async updateOrder(orderId, patch, options = {}) {
        if (!orderId) throw new Error('orderId requerido');
        if (!patch || typeof patch !== 'object') throw new Error('patch invalido');

        const itemsForOrder = Array.isArray(patch.items) ? patch.items : [];
        if (itemsForOrder.length === 0) {
            throw new Error('El pedido debe contener al menos un producto.');
        }

        // Recalcular subtotal client-side (mismas reglas que createOrder).
        const itemsSubtotal = itemsForOrder.reduce((sum, item) => {
            const price =
                item.has_discount && item.discount_price && Number(item.discount_price) > 0
                    ? Number(item.discount_price)
                    : Number(item.price || 0);
            const qty = Math.max(1, Number(item.quantity) || 1);
            return sum + price * qty;
        }, 0);

        const isDelivery = String(patch.order_type ?? '').toLowerCase() === 'delivery';

        // Resolver label de zona para el JSONB delivery_address (consistencia
        // con createOrder y con `manualOrderForTicket` del modal).
        const branchSettings = options.branchSettings ?? null;
        const namedId = isDelivery
            ? (String(patch.delivery_named_area_id ?? '').trim() || null)
            : null;
        const namedLabel = isDelivery && namedId
            ? resolveNamedAreaLabelFromSettings(branchSettings, namedId)
            : '';

        const deliveryAddressRecord = isDelivery
            ? buildDeliveryAddressRecord({
                rawAddress: patch.delivery_address,
                deliveryReference: patch.delivery_reference,
                namedAreaId: namedId,
                namedAreaLabel: namedLabel || null,
            })
            : null;

        const deliveryFee = isDelivery ? Math.max(0, Number(patch.delivery_fee) || 0) : 0;
        const totalRounded = Math.round((itemsSubtotal + deliveryFee) * 100) / 100;

        // Note (preservar prefijos legibles que setea createOrder cuando aplique).
        // En esta version mantenemos el texto plano que escribe el cajero; los
        // prefijos [Sucursal: ...] / [Envío: ...] se gestionan al crear.
        // orders.order_type es sale|refund (check orders_order_type_check).
        // Pickup/delivery va en channel; no sobrescribir order_type al editar.
        const updatePayload = {
            client_name: String(patch.client_name ?? ''),
            client_phone: String(patch.client_phone ?? ''),
            client_rut: String(patch.client_rut ?? ''),
            items: itemsForOrder,
            total: totalRounded,
            payment_type: String(patch.payment_type ?? 'tienda'),
            note: typeof patch.note === 'string' ? patch.note : '',
            channel: isDelivery ? 'delivery' : 'pickup',
            delivery_address: deliveryAddressRecord,
            delivery_fee: deliveryFee,
        };

        const { data: updated, error } = await supabase
            .from(TABLES.orders)
            .update(updatePayload)
            .eq('id', orderId)
            .select('*')
            .single();

        if (error) {
            // RLS bloquea cuando el rol no es ceo/cashier para esta company.
            if (String(error.code) === '42501' || String(error.message ?? '').toLowerCase().includes('row-level security')) {
                throw new Error('No tienes permisos para editar este pedido.');
            }
            throw error;
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

        // Warning de caja: si el total cambio y el pedido ya estaba en una
        // etapa con venta registrada (active / completed / picked_up), avisamos
        // al cajero para ajuste manual. Mantener en sync con la logica de
        // `cashSystem.registerSale` (se registra al pasar a `active`).
        const prevTotal = Number(options.prevTotal);
        if (
            Number.isFinite(prevTotal) &&
            Math.abs(prevTotal - totalRounded) > 0.5 &&
            ['active', 'completed', 'picked_up'].includes(status)
        ) {
            options.showNotify?.(
                `El total cambió de $${Math.round(prevTotal).toLocaleString('es-CL')} a $${Math.round(totalRounded).toLocaleString('es-CL')}. Ajusta la caja manualmente.`,
                'warning',
            );
        }

        return updated;
    },
};

export const createManualOrder = (orderData, receiptFile) => ordersService.createOrder(orderData, receiptFile);
