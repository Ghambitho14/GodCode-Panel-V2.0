/**
 * Resuelve el pedido asociado a un movimiento de caja.
 * @param {Record<string, unknown> | null | undefined} movement
 * @param {Array<Record<string, unknown>>} [ordersList]
 * @returns {Record<string, unknown> | null}
 */
export function getOrderForMovement(movement, ordersList = []) {
    const list = ordersList || [];
    const fromJoin = movement?.orders;
    if (fromJoin?.id) return fromJoin;
    const id = movement?.order_id ?? movement?.orderId;
    if (id != null) {
        const found = list.find((o) => String(o.id) === String(id));
        if (found) return found;
    }
    const desc = String(movement?.description || '');
    const match = desc.match(/#(\d{1,8})/);
    if (!match) return null;
    const num = match[1].replace(/^0+/, '') || '0';
    return (
        list.find((o) => {
            const sid = String(o.id);
            return (
                sid.replace(/^0+/, '') === num ||
                sid.slice(-4).replace(/^0+/, '') === num
            );
        }) ?? null
    );
}

/**
 * @param {Record<string, unknown> | null | undefined} movement
 * @param {Array<Record<string, unknown>>} [ordersList]
 * @returns {boolean}
 */
export function isMovementOrderClickable(movement, ordersList = []) {
    if (!movement) return false;
    const t = movement.type;
    if (t === 'sale' || t === 'cancel') {
        return Boolean(getOrderForMovement(movement, ordersList));
    }
    if (t === 'expense') {
        const oid = movement.order_id ?? movement.orderId;
        if (oid == null || String(oid).trim() === '') return false;
        return Boolean(getOrderForMovement(movement, ordersList));
    }
    return false;
}
