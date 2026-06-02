import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleRefreshFromCookie } from "../../../api/_lib/refresh";
import { mockRequest, mockResponse } from "../../setup/mock-vercel-req";

vi.mock("../../../api/_lib/supabase.js", () => ({
	createServerSupabaseClient: vi.fn(),
}));

import { createServerSupabaseClient } from "../../../api/_lib/supabase.js";

describe("api/_lib/refresh", () => {
	beforeEach(() => {
		vi.mocked(createServerSupabaseClient).mockReset();
	});

	it("returns 401 when cookie missing", async () => {
		const res = mockResponse();
		await handleRefreshFromCookie(mockRequest(), res);
		expect(res._status).toBe(401);
	});

	it("returns session on successful refresh", async () => {
		vi.mocked(createServerSupabaseClient).mockReturnValue({
			auth: {
				refreshSession: vi.fn().mockResolvedValue({
					data: {
						session: {
							access_token: "new-at",
							refresh_token: "new-rt",
							expires_at: 999,
						},
						user: { id: "u1", email: "test@test.com" },
					},
					error: null,
				}),
			},
		} as ReturnType<typeof createServerSupabaseClient>);

		const res = mockResponse();
		await handleRefreshFromCookie(
			mockRequest({ headers: { cookie: "gc_rt=old-token" } }),
			res,
		);
		expect(res._status).toBe(200);
		expect(res._json).toMatchObject({ access_token: "new-at" });
		expect(String(res._headers["Set-Cookie"])).toContain("gc_rt=new-rt");
	});

	it("clears cookie and 401 on refresh failure", async () => {
		vi.mocked(createServerSupabaseClient).mockReturnValue({
			auth: {
				refreshSession: vi.fn().mockResolvedValue({
					data: { session: null },
					error: { message: "expired" },
				}),
			},
		} as ReturnType<typeof createServerSupabaseClient>);

		const res = mockResponse();
		await handleRefreshFromCookie(
			mockRequest({ headers: { cookie: "gc_rt=bad" } }),
			res,
		);
		expect(res._status).toBe(401);
		expect(String(res._headers["Set-Cookie"])).toContain("Max-Age=0");
	});
});
