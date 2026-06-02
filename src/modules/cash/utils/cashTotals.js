import {
	isManualLocalExpense,
	isCashWithdrawal,
	isOperatingLocalExpense,
	isOrderLinkedExpense,
} from './cashMovementKinds';

export const EMPTY_SHIFT_TOTALS = {
	cash: 0,
	card: 0,
	online: 0,
	expenses: 0,
	manualExpenses: 0,
	manualExpenseCount: 0,
	cashWithdrawals: 0,
	cashWithdrawalCount: 0,
	operatingExpenses: 0,
	operatingExpenseCount: 0,
	refundExpenses: 0,
	refundExpenseCount: 0,
	income: 0,
	deliveryCollected: 0,
	deliveryRefunded: 0,
	deliveryPaidToCourier: 0,
};

function applyPaymentMethodDelta(acc, paymentMethod, delta) {
	if (paymentMethod === 'cash') acc.cash += delta;
	else if (paymentMethod === 'card') acc.card += delta;
	else if (paymentMethod === 'online') acc.online += delta;
}

/**
 * Totales del turno. cash/card/online reflejan solo cobros de pedidos (ventas − devoluciones),
 * sin retiros ni gastos operativos manuales.
 * @param {Array<Record<string, unknown>>} movementsData
 */
export function computeShiftTotals(movementsData = []) {
	return movementsData.reduce((acc, m) => {
		if (m.type === 'cancel') return acc;
		const amount = Number(m.amount) || 0;
		const order = m?.orders ?? null;
		const deliveryFee = Number(order?.delivery_fee) || 0;
		const desc = String(m?.description || '').toLowerCase();
		const isCourierPayout =
			m.type === 'expense' &&
			!order &&
			(desc.includes('delivery') || desc.includes('repartidor') || desc.includes('conductor'));

		if (m.type === 'expense') {
			acc.expenses += amount;
			if (isManualLocalExpense(m)) {
				acc.manualExpenses += amount;
				acc.manualExpenseCount += 1;
				if (isCashWithdrawal(m)) {
					acc.cashWithdrawals += amount;
					acc.cashWithdrawalCount += 1;
				} else if (isOperatingLocalExpense(m)) {
					acc.operatingExpenses += amount;
					acc.operatingExpenseCount += 1;
				}
			} else {
				acc.refundExpenses += amount;
				acc.refundExpenseCount += 1;
			}
			if (isOrderLinkedExpense(m)) {
				applyPaymentMethodDelta(acc, m.payment_method, -amount);
			}

			if (deliveryFee > 0) {
				acc.deliveryRefunded += deliveryFee;
			}
			if (isCourierPayout) {
				acc.deliveryPaidToCourier += amount;
			}
			const refundOrderId = m.order_id ?? m.orderId;
			if (refundOrderId != null && String(refundOrderId).trim() !== '') {
				acc.income -= amount;
			}
		} else {
			if (m.type === 'sale') {
				applyPaymentMethodDelta(acc, m.payment_method, amount);
			}
			acc.income += amount;

			if (m.type === 'sale' && deliveryFee > 0) {
				acc.deliveryCollected += deliveryFee;
			}
		}
		return acc;
	}, { ...EMPTY_SHIFT_TOTALS });
}
