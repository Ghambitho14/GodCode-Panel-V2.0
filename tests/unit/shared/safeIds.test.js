import { describe, expect, it } from "vitest";
import {
	filterValidProductIds,
	isValidBranchId,
	isValidProductId,
} from "@/shared/utils/safeIds";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("safeIds", () => {
	it("isValidProductId accepts uuid and numeric", () => {
		expect(isValidProductId(VALID_UUID)).toBe(true);
		expect(isValidProductId("12345")).toBe(true);
	});

	it("isValidProductId rejects invalid", () => {
		expect(isValidProductId("not-valid")).toBe(false);
		expect(isValidProductId("")).toBe(false);
	});

	it("filterValidProductIds filters array", () => {
		expect(filterValidProductIds([VALID_UUID, "bad", "99"])).toEqual([
			VALID_UUID,
			"99",
		]);
	});

	it("isValidBranchId mirrors product rules", () => {
		expect(isValidBranchId(VALID_UUID)).toBe(true);
		expect(isValidBranchId("slug-name")).toBe(false);
	});
});
