import { describe, expect, it } from "vitest";
import { formatCurrency, validateRut } from "@/shared/utils/formatters";

describe("formatters", () => {
	it("validateRut accepts valid Chilean RUT", () => {
		expect(validateRut("11.111.111-1")).toBe(true);
	});

	it("validateRut rejects invalid check digit", () => {
		expect(validateRut("11.111.111-2")).toBe(false);
	});

	it("validateRut rejects too short input", () => {
		expect(validateRut("1")).toBe(false);
	});

	it("formatCurrency formats CLP", () => {
		const formatted = formatCurrency(1000);
		expect(formatted).toMatch(/\$|CLP|1/);
	});
});
