import { useState, useCallback, useMemo } from 'react';

/**
 * Hook especializado en gestionar los ítems agregados al pedido manual,
 * cantidades, precios (con o sin descuento), notas por producto y cálculo del total.
 */
const normalizeItemId = (id) => (id == null ? '' : String(id));

export const useManualOrderCart = (initialItems = []) => {
    const [items, setItems] = useState(initialItems);

    // Obtener precio unitario efectivo considerando si tiene descuento
    const getPrice = useCallback((product) => {
        if (product?.has_discount && product?.discount_price && parseInt(product.discount_price) > 0) {
            return parseInt(product.discount_price);
        }
        return parseInt(product?.price);
    }, []);

    // Calcular total bruto del carrito
    const total = useMemo(() => {
        return Math.round(items.reduce((acc, i) => acc + (getPrice(i) * i.quantity), 0));
    }, [items, getPrice]);

    // Añadir producto al carrito
    const addItem = useCallback((product) => {
        const productId = normalizeItemId(product?.id);
        if (!productId) return;

        setItems(currentItems => {
            const exists = currentItems.find(i => normalizeItemId(i.id) === productId);
            if (exists) {
                if (exists.quantity >= 20) return currentItems;
                return currentItems.map(i => (
                    normalizeItemId(i.id) === productId ? { ...i, quantity: i.quantity + 1 } : i
                ));
            } else {
                return [...currentItems, {
                    id: productId,
                    name: product.name,
                    price: product.price,
                    has_discount: product.has_discount,
                    discount_price: product.discount_price,
                    image_url: product.image_url,
                    description: product.description,
                    quantity: 1,
                    note: '',
                    manual_order_source: product.manual_order_source || null,
                    is_extra: product.manual_order_source === 'extras' || product.is_extra
                }];
            }
        });
    }, []);

    // Actualizar cantidad (+1 o -1)
    const updateQuantity = useCallback((itemId, change) => {
        const key = normalizeItemId(itemId);
        setItems(currentItems => {
            const item = currentItems.find(i => normalizeItemId(i.id) === key);
            if (!item) return currentItems;
            if (change > 0 && item.quantity >= 20) return currentItems;

            if (item.quantity + change < 1) {
                return currentItems.map(i => (normalizeItemId(i.id) === key ? { ...i, quantity: 1 } : i));
            } else {
                return currentItems.map(i => (
                    normalizeItemId(i.id) === key ? { ...i, quantity: i.quantity + change } : i
                ));
            }
        });
    }, []);

    // Eliminar producto del carrito
    const removeItem = useCallback((itemId) => {
        const key = normalizeItemId(itemId);
        setItems(currentItems => currentItems.filter(i => normalizeItemId(i.id) !== key));
    }, []);

    // Guardar una nota/especificación de cocina para un producto específico
    const updateItemNote = useCallback((itemId, note) => {
        const key = normalizeItemId(itemId);
        const next = typeof note === 'string' ? note.slice(0, 140) : '';
        setItems(currentItems => currentItems.map(i => (
            normalizeItemId(i.id) === key ? { ...i, note: next } : i
        )));
    }, []);

    // Reiniciar por completo el carrito
    const resetCart = useCallback(() => {
        setItems([]);
    }, []);

    return {
        items,
        total,
        addItem,
        updateQuantity,
        removeItem,
        updateItemNote,
        resetCart,
        getPrice
    };
};
