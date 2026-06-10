import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.fn();

vi.mock("@/integrations/supabase", () => ({
	supabase: {
		from: (...args) => fromMock(...args),
	},
	TABLES: {
		client_addresses: "client_addresses",
	},
}));

import {
	normalizeManualPhone,
	normalizePhoneForSearch,
	mapAddressToFormFields,
	fetchClientAddresses,
	formatSavedAddressLabel,
} from "@/modules/cash/services/clientService";

function chainableQuery(result = { data: [], error: null }) {
	const chain = {
		select: vi.fn(() => chain),
		eq: vi.fn(() => chain),
		order: vi.fn(() => chain),
		then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
	};
	return chain;
}

describe("clientService", () => {
	beforeEach(() => {
		fromMock.mockReset();
	});

	it("normalizeManualPhone formats Chile mobile consistently", () => {
		expect(normalizeManualPhone("+56912345678")).toBe("+56 9 1234 5678");
		expect(normalizeManualPhone("912345678")).toBe("+56 9 1234 5678");
		expect(normalizeManualPhone("+56 9 1234 5678")).toBe("+56 9 1234 5678");
	});

	it("normalizePhoneForSearch strips non-digits", () => {
		expect(normalizePhoneForSearch("+56 9 1234 5678")).toBe("56912345678");
	});

	it("mapAddressToFormFields maps DB row to form fields", () => {
		expect(
			mapAddressToFormFields({
				address_line: "Av. Principal 100",
				reference: "Depto 4B",
				named_area_id: "zone-1",
				delivery_km: 3.5,
			}),
		).toEqual({
			delivery_address: "Av. Principal 100",
			delivery_reference: "Depto 4B",
			delivery_named_area_id: "zone-1",
			delivery_km: "3.5",
		});
	});

	it("formatSavedAddressLabel prefers reference then line", () => {
		expect(
			formatSavedAddressLabel({
				reference: "Casa",
				address_line: "Calle 1",
			}),
		).toBe("Casa · Calle 1");
	});

	it("fetchClientAddresses queries client_addresses ordered by last_used_at", async () => {
		const rows = [{ id: "a1", address_line: "Calle 1" }];
		fromMock.mockReturnValue(chainableQuery({ data: rows, error: null }));

		const result = await fetchClientAddresses("client-1");

		expect(fromMock).toHaveBeenCalledWith("client_addresses");
		expect(result).toEqual(rows);
	});

	it("fetchClientAddresses returns empty array without client id", async () => {
		const result = await fetchClientAddresses("");
		expect(result).toEqual([]);
		expect(fromMock).not.toHaveBeenCalled();
	});
});
