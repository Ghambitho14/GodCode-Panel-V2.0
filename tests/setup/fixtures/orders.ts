/** Sample order payloads for unit/integration tests. */

export const sampleOrderItems = [
	{ name: "Pizza", price: 5000, quantity: 2 },
	{ name: "Bebida", price: 1500, quantity: 1 },
];

export const sampleRawOrder = {
	id: "ord-1",
	client_name: "Cliente Test",
	client_phone: "+56912345678",
	total: 11500,
	items: JSON.stringify(sampleOrderItems),
	payment_type: "tienda",
	status: "pending",
};
