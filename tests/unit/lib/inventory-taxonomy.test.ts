import { describe, expect, it } from "vitest";
import { parseTagList } from "@/lib/inventory-taxonomy";

describe("inventory-taxonomy", () => {
	it("parseTagList from array", () => {
		expect(parseTagList([" a ", "b"])).toEqual(["a", "b"]);
	});

	it("parseTagList from comma-separated string", () => {
		expect(parseTagList("a, b; c")).toEqual(["a", "b", "c"]);
	});

	it("parseTagList returns empty for invalid", () => {
		expect(parseTagList(null)).toEqual([]);
		expect(parseTagList(42)).toEqual([]);
	});
});
