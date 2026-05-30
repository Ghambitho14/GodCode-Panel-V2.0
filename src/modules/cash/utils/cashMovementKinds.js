/** @typedef {'operating' | 'cash_withdrawal'} ExpenseKind */

export const EXPENSE_KIND_OPERATING = 'operating';
export const EXPENSE_KIND_CASH_WITHDRAWAL = 'cash_withdrawal';

/**
 * Egreso manual sin pedido (retiros de caja + gastos operativos del local).
 * @param {Record<string, unknown> | null | undefined} m
 * @returns {boolean}
 */
export function isManualLocalExpense(m) {
	if (!m || m.type !== 'expense') return false;
	const oid = m.order_id ?? m.orderId;
	if (oid == null) return true;
	return String(oid).trim() === '';
}

/**
 * @param {Record<string, unknown> | null | undefined} m
 * @returns {string | null}
 */
export function getExpenseKind(m) {
	if (!isManualLocalExpense(m)) return null;
	const k = m.expense_kind ?? m.expenseKind;
	if (k == null || String(k).trim() === '') return null;
	return String(k).trim();
}

/**
 * Retiro de efectivo registrado por cajero en Caja.
 * @param {Record<string, unknown> | null | undefined} m
 * @returns {boolean}
 */
export function isCashWithdrawal(m) {
	return getExpenseKind(m) === EXPENSE_KIND_CASH_WITHDRAWAL;
}

/**
 * Gasto operativo del local (mercadería, arriendo, sueldo, etc.).
 * Filas legacy sin expense_kind se tratan como operativas.
 * @param {Record<string, unknown> | null | undefined} m
 * @returns {boolean}
 */
export function isOperatingLocalExpense(m) {
	if (!isManualLocalExpense(m)) return false;
	const k = getExpenseKind(m);
	return k === EXPENSE_KIND_OPERATING || k == null;
}

/**
 * Egreso ligado a pedido (p. ej. devolución registrada en caja).
 * @param {Record<string, unknown> | null | undefined} m
 * @returns {boolean}
 */
export function isOrderLinkedExpense(m) {
	return Boolean(m && m.type === 'expense' && !isManualLocalExpense(m));
}

/**
 * Etiqueta UI para devolución de pedido en caja.
 * @param {Record<string, unknown> | null | undefined} m
 * @returns {string}
 */
export function labelForOrderRefund(m) {
	if (!isOrderLinkedExpense(m)) return '—';
	return 'Devolución pedido';
}

/**
 * Etiqueta UI para tipo de egreso manual.
 * @param {Record<string, unknown> | null | undefined} m
 * @returns {string}
 */
export function labelForManualExpenseKind(m) {
	if (isOrderLinkedExpense(m)) return labelForOrderRefund(m);
	if (!isManualLocalExpense(m)) return '—';
	if (isCashWithdrawal(m)) return 'Retiro caja';
	if (isOperatingLocalExpense(m)) return 'Gasto operativo';
	return 'Sin clasificar';
}
