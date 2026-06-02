import { describe, expect, it } from "vitest";
import { isTenantExternalDeliveryAllowed } from "@/lib/company-integration-policy";

describe("company-integration-policy", () => {
	it("allows when settings missing or empty", () => {
		expect(isTenantExternalDeliveryAllowed(null)).toBe(true);
		expect(isTenantExternalDeliveryAllowed({})).toBe(true);
	});

	it("blocks when allowTenantExternalDelivery is false", () => {
		expect(
			isTenantExternalDeliveryAllowed({ allowTenantExternalDelivery: false }),
		).toBe(false);
	});

	it("blocks snake_case key", () => {
		expect(
			isTenantExternalDeliveryAllowed({ allow_tenant_external_delivery: false }),
		).toBe(false);
	});
});
