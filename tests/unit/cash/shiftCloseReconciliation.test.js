import { describe, expect, it } from "vitest";
import {
	diffCounted,
	getExpectedByMethod,
} from "@/modules/cash/utils/shiftCloseReconciliation";

describe("shiftCloseReconciliation", () => {
	it("diffCounted match within tolerance", () => {
		expect(diffCounted(100, 100.005)).toEqual({ diff: 0, status: "match" });
	});

	it("diffCounted surplus and shortage", () => {
		expect(diffCounted(100, 110).status).toBe("surplus");
		expect(diffCounted(100, 90).status).toBe("shortage");
	});

	it("getExpectedByMethod uses shift expected_balance", () => {
		expect(
			getExpectedByMethod({ card: 500, online: 200 }, { expected_balance: 1000 }),
		).toEqual({ cash: 1000, card: 500, online: 200 });
	});
});
