import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useReceiptUpload } from "@/modules/cash/hooks/manual-order/useReceiptUpload";

vi.mock("@/shared/utils/cloudinary", () => ({
	validateImageFile: vi.fn((file) => {
		if (file.type === "image/png") return { valid: true };
		return { valid: false, error: "Invalid type" };
	}),
}));

describe("useReceiptUpload", () => {
	it("accepts valid image file", () => {
		const { result } = renderHook(() => useReceiptUpload());
		const file = new File(["x"], "receipt.png", { type: "image/png" });
		act(() =>
			result.current.handleFileChange({
				target: { files: [file], value: "receipt.png" },
			}),
		);
		expect(result.current.receiptFile).toBe(file);
		expect(result.current.receiptPreview).toBeTruthy();
	});

	it("rejects invalid file and calls notify", () => {
		const notify = vi.fn();
		const { result } = renderHook(() => useReceiptUpload(notify));
		const file = new File(["x"], "bad.txt", { type: "text/plain" });
		act(() =>
			result.current.handleFileChange({
				target: { files: [file], value: "bad.txt" },
			}),
		);
		expect(result.current.receiptFile).toBeNull();
		expect(notify).toHaveBeenCalled();
	});

	it("removeReceipt clears state", () => {
		const { result } = renderHook(() => useReceiptUpload());
		const file = new File(["x"], "receipt.png", { type: "image/png" });
		act(() =>
			result.current.handleFileChange({
				target: { files: [file], value: "receipt.png" },
			}),
		);
		act(() => result.current.removeReceipt());
		expect(result.current.receiptFile).toBeNull();
		expect(result.current.receiptPreview).toBeNull();
	});
});
