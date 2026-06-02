import { describe, expect, it } from "vitest";
import {
	getConvertibleUnitOptions,
	getUnitLabel,
	normalizeUnit,
} from "@/lib/inventory-units";
import { toNativeQty } from "@/lib/recipe-units";

describe("inventory-units", () => {
	it("normalizeUnit maps aliases", () => {
		expect(normalizeUnit("KILO")).toBe("kg");
		expect(normalizeUnit("unidad")).toBe("un");
		expect(normalizeUnit("")).toBe("un");
	});

	it("getUnitLabel returns canonical labels", () => {
		expect(getUnitLabel("kg")).toContain("Kilogramo");
	});

	it("getConvertibleUnitOptions returns family members", () => {
		expect(getConvertibleUnitOptions("kg")).toEqual(["kg", "g"]);
	});
});

describe("recipe-units", () => {
	it("toNativeQty converts g to kg", () => {
		expect(toNativeQty(500, "g", "kg")).toBe(0.5);
	});

	it("toNativeQty converts docena to un", () => {
		expect(toNativeQty(2, "docena", "un")).toBe(24);
	});

	it("toNativeQty returns same qty when units match", () => {
		expect(toNativeQty(3, "un", "un")).toBe(3);
	});
});
