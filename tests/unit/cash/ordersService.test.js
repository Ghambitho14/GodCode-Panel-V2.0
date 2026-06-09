import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/integrations/supabase', () => ({
	supabase: {
		rpc: (...args) => rpcMock(...args),
		from: (...args) => fromMock(...args),
	},
	TABLES: {
		product_prices: 'product_prices',
		product_branch: 'product_branch',
		products: 'products',
		cash_shifts: 'cash_shifts',
		branches: 'branches',
		discount_coupons: 'discount_coupons',
	},
}));

vi.mock('@/shared/utils/cloudinary', () => ({
	uploadImage: vi.fn(),
}));

vi.mock('@/lib/discount-coupon', () => ({
	normalizeCouponCode: (code) => (code ? String(code).trim().toUpperCase() : ''),
	fetchActiveCouponByCode: vi.fn().mockResolvedValue(null),
	computeCouponDiscountAmount: vi.fn().mockReturnValue(0),
}));

vi.mock('@/modules/cash/admin/utils/receiptPrinting', () => ({
	printOrderTicket: vi.fn(),
}));

import { ordersService } from '@/modules/cash/admin/orders/services/orders';

function chainableQuery(result = { data: null, error: null }) {
	const chain = {
		select: vi.fn(() => chain),
		eq: vi.fn(() => chain),
		in: vi.fn(() => chain),
		maybeSingle: vi.fn().mockResolvedValue(result),
		single: vi.fn().mockResolvedValue(result),
		update: vi.fn(() => chain),
		then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
	};
	return chain;
}

const BRANCH_ID = '4d6a5d86-1f07-455f-a419-aeb24b041c26';
const PRODUCT_ID = '4add7479-87b2-4b1f-ae0d-50ef81bd6c9a';

const NAMED_DELIVERY_SETTINGS = {
	enabled: true,
	deliveryPricingStrategy: 'named',
	namedAreas: [{ id: 'zone-1', name: 'Centro', feeFlat: 3500, active: true }],
};

function setupCreateOrderMocks(branchDeliverySettings = {}) {
	fromMock.mockImplementation((table) => {
		if (table === 'cash_shifts') {
			return chainableQuery({ data: { id: 'shift-1' }, error: null });
		}
		if (table === 'branches') {
			return chainableQuery({
				data: { delivery_settings: branchDeliverySettings, payment_methods: [] },
				error: null,
			});
		}
		if (table === 'product_prices') {
			return chainableQuery({
				data: [{ product_id: PRODUCT_ID, price: 7500, has_discount: false, discount_price: null }],
				error: null,
			});
		}
		if (table === 'product_branch') {
			return chainableQuery({ data: [{ product_id: PRODUCT_ID }], error: null });
		}
		if (table === 'products') {
			return chainableQuery({ data: [{ id: PRODUCT_ID, name: 'Pizza' }], error: null });
		}
		return chainableQuery();
	});
}

describe('ordersService security refactor', () => {
	beforeEach(() => {
		rpcMock.mockReset();
		fromMock.mockReset();
	});

	it('updateOrder uses update_order_transaction RPC, not direct UPDATE', async () => {
		rpcMock.mockResolvedValueOnce({
			data: { id: 42, total: 7500, items: [], status: 'pending' },
			error: null,
		});

		await ordersService.updateOrder(42, {
			client_name: 'Ana',
			client_phone: '+56911111111',
			client_rut: '',
			order_type: 'pickup',
			items: [{ id: PRODUCT_ID, name: 'Pizza', price: 7500, quantity: 1 }],
			payment_type: 'tienda',
			note: '',
		});

		expect(rpcMock).toHaveBeenCalledWith(
			'update_order_transaction',
			expect.objectContaining({
				p_order_id: 42,
				p_items: expect.any(Array),
			}),
		);

		for (const [, result] of fromMock.mock.results.entries()) {
			expect(result?.value?.update).not.toHaveBeenCalled();
		}
	});

	it('createOrder does not run post-create UPDATE on orders', async () => {
		setupCreateOrderMocks();
		rpcMock.mockResolvedValueOnce({
			data: { id: 99, total: 7500 },
			error: null,
		});

		await ordersService.createOrder({
			branch_id: BRANCH_ID,
			company_id: 'company-1',
			client_name: 'Ana',
			client_phone: '+56911111111',
			payment_type: 'tienda',
			order_type: 'pickup',
			items: [{ id: PRODUCT_ID, name: 'Pizza', price: 7500, quantity: 1 }],
		});

		expect(rpcMock).toHaveBeenCalledWith(
			'create_order_transaction',
			expect.objectContaining({
				p_items: expect.any(Array),
				p_payment_breakdown: null,
			}),
		);

		for (const result of fromMock.mock.results) {
			expect(result?.value?.update).not.toHaveBeenCalled();
		}
	});

	it('cashier cannot override manual_delivery_fee on create (uses catalog fee)', async () => {
		setupCreateOrderMocks(NAMED_DELIVERY_SETTINGS);
		rpcMock.mockResolvedValueOnce({
			data: { id: 100, total: 11000 },
			error: null,
		});

		await ordersService.createOrder({
			branch_id: BRANCH_ID,
			company_id: 'company-1',
			client_name: 'Ana',
			client_phone: '+56911111111',
			client_rut: '11.111.111-1',
			payment_type: 'tienda',
			order_type: 'delivery',
			delivery_named_area_id: 'zone-1',
			delivery_address: 'Calle 1',
			manual_delivery_fee: 0,
			caller_role: 'cashier',
			items: [{ id: PRODUCT_ID, name: 'Pizza', price: 7500, quantity: 1 }],
		});

		expect(rpcMock).toHaveBeenCalledWith(
			'create_order_transaction',
			expect.objectContaining({
				p_delivery_fee: 3500,
			}),
		);
	});

	it('admin can override manual_delivery_fee on create', async () => {
		setupCreateOrderMocks(NAMED_DELIVERY_SETTINGS);
		rpcMock.mockResolvedValueOnce({
			data: { id: 101, total: 7500 },
			error: null,
		});

		await ordersService.createOrder({
			branch_id: BRANCH_ID,
			company_id: 'company-1',
			client_name: 'Ana',
			client_phone: '+56911111111',
			client_rut: '11.111.111-1',
			payment_type: 'tienda',
			order_type: 'delivery',
			delivery_named_area_id: 'zone-1',
			delivery_address: 'Calle 1',
			manual_delivery_fee: 0,
			caller_role: 'admin',
			items: [{ id: PRODUCT_ID, name: 'Pizza', price: 7500, quantity: 1 }],
		});

		expect(rpcMock).toHaveBeenCalledWith(
			'create_order_transaction',
			expect.objectContaining({
				p_delivery_fee: 0,
			}),
		);
	});

	it('maps invalid_delivery_fee_override RPC error to UX message', async () => {
		rpcMock.mockResolvedValueOnce({
			data: null,
			error: { message: 'invalid_delivery_fee_override' },
		});

		await expect(
			ordersService.updateOrder(1, {
				client_name: 'Ana',
				client_phone: '+56911111111',
				client_rut: '',
				order_type: 'pickup',
				items: [{ id: PRODUCT_ID, name: 'Pizza', price: 7500, quantity: 1 }],
				payment_type: 'tienda',
				note: '',
			}),
		).rejects.toThrow('No tienes permiso para modificar el costo de envío.');
	});

	it('createOrder accepts upsell beverages from branch cart catalog', async () => {
		setupCreateOrderMocks({
			cartBeveragesCatalog: [
				{ id: 'bebida-test', name: 'Agua mineral', price: 1000, active: true },
			],
		});
		rpcMock.mockResolvedValueOnce({
			data: { id: 102, total: 8500 },
			error: null,
		});

		await ordersService.createOrder({
			branch_id: BRANCH_ID,
			company_id: 'company-1',
			client_name: 'Ana',
			client_phone: '+56911111111',
			client_rut: '11.111.111-1',
			payment_type: 'tienda',
			order_type: 'pickup',
			items: [
				{ id: PRODUCT_ID, name: 'Pizza', price: 7500, quantity: 1 },
				{
					id: 'bebida-test',
					name: 'Agua mineral',
					price: 1000,
					quantity: 1,
					manual_order_source: 'beverages',
				},
			],
		});

		expect(rpcMock).toHaveBeenCalledWith(
			'create_order_transaction',
			expect.objectContaining({
				p_items: expect.arrayContaining([
					expect.objectContaining({
						id: PRODUCT_ID,
						name: 'Pizza',
						quantity: 1,
					}),
					expect.objectContaining({
						id: 'bebida-test',
						name: 'Agua mineral',
						price: 1000,
						quantity: 1,
						manual_order_source: 'beverages',
						is_extra: false,
					}),
				]),
			}),
		);
	});

	it('createOrder rejects upsell beverages missing from branch cart catalog', async () => {
		setupCreateOrderMocks({
			cartBeveragesCatalog: [
				{ id: 'bebida-test', name: 'Agua mineral', price: 1000, active: true },
			],
		});

		await expect(
			ordersService.createOrder({
				branch_id: BRANCH_ID,
				company_id: 'company-1',
				client_name: 'Ana',
				client_phone: '+56911111111',
				client_rut: '11.111.111-1',
				payment_type: 'tienda',
				order_type: 'pickup',
				items: [
					{ id: PRODUCT_ID, name: 'Pizza', price: 7500, quantity: 1 },
					{
						id: 'bebida-desconocida',
						name: 'Bebida fantasma',
						price: 500,
						quantity: 1,
						manual_order_source: 'beverages',
					},
				],
			}),
		).rejects.toThrow(
			'Hay productos del carrito que no están disponibles para esta sucursal. Actualiza el menú e intenta nuevamente.',
		);

		expect(rpcMock).not.toHaveBeenCalled();
	});

	it('maps invalid_item_price RPC error to UX message on update', async () => {
		rpcMock.mockResolvedValueOnce({
			data: null,
			error: { message: 'invalid_item_price' },
		});

		await expect(
			ordersService.updateOrder(1, {
				client_name: 'Ana',
				client_phone: '+56911111111',
				client_rut: '',
				order_type: 'pickup',
				items: [{ id: PRODUCT_ID, name: 'Pizza', price: 1, quantity: 1 }],
				payment_type: 'tienda',
				note: '',
			}),
		).rejects.toThrow(
			'Hay productos del carrito que no están disponibles para esta sucursal. Actualiza el menú e intenta nuevamente.',
		);
	});
});
