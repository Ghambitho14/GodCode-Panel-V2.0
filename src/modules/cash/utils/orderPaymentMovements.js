import {
	getOrderPaymentBreakdown,
} from '@/shared/utils/orderUtils';

const METHODS = ['cash', 'card', 'online'];
const AMOUNT_TOLERANCE = 5;

function roundAmount(value) {
	return Math.round(Number(value) || 0);
}

function sumByType(movements, type) {
	return (movements || []).reduce((acc, m) => {
		if (m?.type !== type) return acc;
		return acc + roundAmount(m.amount);
	}, 0);
}

function sumSalesByMethod(movements) {
	const totals = { cash: 0, card: 0, online: 0 };
	for (const m of movements || []) {
		if (m?.type !== 'sale') continue;
		const method = m.payment_method;
		if (method === 'cash' || method === 'card' || method === 'online') {
			totals[method] += roundAmount(m.amount);
		}
	}
	return totals;
}

function sumRefundsByMethod(movements) {
	const totals = { cash: 0, card: 0, online: 0 };
	for (const m of movements || []) {
		if (m?.type !== 'expense') continue;
		const method = m.payment_method;
		if (method === 'cash' || method === 'card' || method === 'online') {
			totals[method] += roundAmount(m.amount);
		}
	}
	return totals;
}

function hasRegisteredSale(movements, paymentMethod, expectedAmount) {
	const sales = (movements || []).filter(
		(m) => m?.type === 'sale' && m.payment_method === paymentMethod,
	);
	if (sales.length === 0) return false;
	const registered = sales.reduce((acc, m) => acc + roundAmount(m.amount), 0);
	return Math.abs(registered - expectedAmount) <= AMOUNT_TOLERANCE;
}

/**
 * Ventas pendientes de registrar para un pedido según desglose y movimientos existentes.
 * @param {Record<string, unknown>} order
 * @param {Array<{ type?: string; amount?: number; payment_method?: string | null }>} existingMovements
 * @returns {Array<{ type: 'sale'; amount: number; payment_method: 'cash' | 'card' | 'online' }>}
 */
export function planSaleMovements(order, existingMovements = []) {
	const breakdown = getOrderPaymentBreakdown(order);
	const activeMethods = METHODS.filter((method) => breakdown[method] > 0);

	if (activeMethods.length === 0) return [];

	if (activeMethods.length === 1) {
		const saleAmount = roundAmount(order?.total);
		if (saleAmount <= 0) return [];

		const paymentMethod = activeMethods[0];
		if (hasRegisteredSale(existingMovements, paymentMethod, saleAmount)) {
			return [];
		}

		const currentNet = sumByType(existingMovements, 'sale') - sumByType(existingMovements, 'expense');
		if (Math.abs(currentNet - saleAmount) <= AMOUNT_TOLERANCE) {
			return [];
		}

		return [{ type: 'sale', amount: saleAmount, payment_method: paymentMethod }];
	}

	return activeMethods
		.filter((method) => !hasRegisteredSale(existingMovements, method, breakdown[method]))
		.map((method) => ({
			type: 'sale',
			amount: breakdown[method],
			payment_method: method,
		}))
		.filter((movement) => movement.amount > 0);
}

/**
 * Devoluciones pendientes por método según ventas ya registradas.
 * @param {Record<string, unknown>} order
 * @param {Array<{ type?: string; amount?: number; payment_method?: string | null }>} existingMovements
 * @returns {Array<{ type: 'expense'; amount: number; payment_method: 'cash' | 'card' | 'online' }>}
 */
export function planRefundMovements(_order, existingMovements = []) {
	const salesByMethod = sumSalesByMethod(existingMovements);
	const refundsByMethod = sumRefundsByMethod(existingMovements);

	const pending = METHODS.map((method) => ({
		payment_method: method,
		amount: salesByMethod[method] - refundsByMethod[method],
	}))
		.filter((row) => row.amount > AMOUNT_TOLERANCE);

	return pending.map((row) => ({
		type: 'expense',
		amount: row.amount,
		payment_method: row.payment_method,
	}));
}
