#!/usr/bin/env node
/**
 * Diagnóstico y reparación: pedidos cancelados con venta en caja sin devolución.
 *
 * Uso (dry-run por defecto):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/repair-cancelled-order-cash.mjs --company-id=<uuid>
 *
 * Aplicar devoluciones:
 *   ... node scripts/repair-cancelled-order-cash.mjs --company-id=<uuid> --apply
 *
 * Opciones:
 *   --from=YYYY-MM-DD   --to=YYYY-MM-DD   filtro created_at de orders
 *   --order-ids=id1,id2  solo esos pedidos (cualquier status cancelado)
 */

import { createClient } from '@supabase/supabase-js';

const NET_TOLERANCE = 5;

function parseArgs(argv) {
	const out = { apply: false, companyId: null, from: null, to: null, orderIds: null };
	for (const arg of argv.slice(2)) {
		if (arg === '--apply') out.apply = true;
		else if (arg.startsWith('--company-id=')) out.companyId = arg.slice('--company-id='.length).trim();
		else if (arg.startsWith('--from=')) out.from = arg.slice('--from='.length).trim();
		else if (arg.startsWith('--to=')) out.to = arg.slice('--to='.length).trim();
		else if (arg.startsWith('--order-ids=')) {
			out.orderIds = arg.slice('--order-ids='.length).split(',').map((s) => s.trim()).filter(Boolean);
		}
	}
	return out;
}

function paymentMethodForOrder(order, shiftMovements) {
	const sale = (shiftMovements || []).find((m) => m.type === 'sale');
	const fromSale = sale?.payment_method;
	if (fromSale === 'cash' || fromSale === 'card' || fromSale === 'online') {
		return fromSale;
	}
	const pt = String(order.payment_type ?? '').toLowerCase();
	if (pt === 'online' || pt === 'transferencia') return 'online';
	if (pt === 'tarjeta' || pt === 'card') return 'card';
	return 'cash';
}

function netForMovements(movements) {
	return (movements || []).reduce(
		(acc, m) => acc + (m.type === 'sale' ? Number(m.amount) || 0 : -(Number(m.amount) || 0)),
		0,
	);
}

async function main() {
	const { apply, companyId, from, to, orderIds } = parseArgs(process.argv);
	const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

	if (!url || !key) {
		console.error('Faltan SUPABASE_URL (o VITE_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY.');
		process.exit(1);
	}
	if (!companyId) {
		console.error('Requerido: --company-id=<uuid>');
		process.exit(1);
	}

	const supabase = createClient(url, key, { auth: { persistSession: false } });

	let ordersQuery = supabase
		.from('orders')
		.select('id, status, total, client_name, payment_type, branch_id, created_at')
		.eq('company_id', companyId)
		.eq('status', 'cancelled');

	if (orderIds?.length) {
		ordersQuery = ordersQuery.in('id', orderIds);
	} else {
		if (from) ordersQuery = ordersQuery.gte('created_at', `${from}T00:00:00.000Z`);
		if (to) ordersQuery = ordersQuery.lte('created_at', `${to}T23:59:59.999Z`);
	}

	const { data: orders, error: ordersErr } = await ordersQuery.order('created_at', { ascending: false });
	if (ordersErr) {
		console.error('Error cargando pedidos:', ordersErr.message);
		process.exit(1);
	}

	if (!orders?.length) {
		console.log('No hay pedidos cancelados en el criterio indicado.');
		return;
	}

	const orderIdList = orders.map((o) => o.id);
	const { data: allMovements, error: movErr } = await supabase
		.from('cash_movements')
		.select('id, shift_id, order_id, type, amount, payment_method, created_at')
		.in('order_id', orderIdList);

	if (movErr) {
		console.error('Error cargando movimientos:', movErr.message);
		process.exit(1);
	}

	const movementsByOrder = new Map();
	for (const m of allMovements || []) {
		const oid = m.order_id;
		if (!movementsByOrder.has(oid)) movementsByOrder.set(oid, []);
		movementsByOrder.get(oid).push(m);
	}

	const affected = [];

	for (const order of orders) {
		const movements = movementsByOrder.get(order.id) || [];
		if (!movements.some((m) => m.type === 'sale')) continue;

		const byShift = new Map();
		for (const m of movements) {
			const sid = m.shift_id;
			if (!byShift.has(sid)) byShift.set(sid, []);
			byShift.get(sid).push(m);
		}

		for (const [shiftId, shiftMovements] of byShift) {
			const net = netForMovements(shiftMovements);
			if (net <= NET_TOLERANCE) continue;

			const refundAmount = Math.round(net);
			affected.push({
				orderId: order.id,
				shiftId,
				clientName: order.client_name,
				createdAt: order.created_at,
				net,
				refundAmount,
				paymentMethod: paymentMethodForOrder(order, shiftMovements),
			});
		}
	}

	if (!affected.length) {
		console.log('No se encontraron pedidos cancelados con venta sin devolución (neto >', NET_TOLERANCE, ').');
		return;
	}

	console.log(`Modo: ${apply ? 'APPLY' : 'DRY-RUN'}`);
	console.log(`Pedidos a reparar (${affected.length} fila(s) turno/pedido):\n`);
	console.log(JSON.stringify(affected, null, 2));

	if (!apply) {
		console.log('\nEjecuta con --apply para registrar las devoluciones vía cash_add_movement.');
		return;
	}

	let ok = 0;
	let fail = 0;

	for (const row of affected) {
		const order = orders.find((o) => o.id === row.orderId);
		const desc = `Devolución reparación #${String(row.orderId).slice(-4)} - ${order?.client_name ?? 'Cliente'}`;
		const { error } = await supabase.rpc('cash_add_movement', {
			p_shift_id: row.shiftId,
			p_type: 'expense',
			p_amount: row.refundAmount,
			p_description: desc,
			p_payment_method: row.paymentMethod,
			p_order_id: row.orderId,
		});

		if (error) {
			console.error(`FAIL order=${row.orderId} shift=${row.shiftId}:`, error.message);
			fail += 1;
		} else {
			console.log(`OK order=${row.orderId} shift=${row.shiftId} amount=${row.refundAmount}`);
			ok += 1;
		}
	}

	console.log(`\nListo: ${ok} aplicados, ${fail} fallidos.`);
	if (fail > 0) process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
