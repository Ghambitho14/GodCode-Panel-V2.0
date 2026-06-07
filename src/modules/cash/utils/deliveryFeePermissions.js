/** Roles que pueden override manual del costo de envío (A2). */
const OVERRIDE_DELIVERY_FEE_ROLES = new Set(['owner', 'admin', 'ceo']);

export function canOverrideDeliveryFee(role) {
	const r = String(role ?? '').toLowerCase();
	return OVERRIDE_DELIVERY_FEE_ROLES.has(r);
}
