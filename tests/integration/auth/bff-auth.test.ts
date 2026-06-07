import { beforeEach, describe, expect, it, vi } from "vitest";
import loginHandler from "../../../api/auth/login";
import logoutHandler from "../../../api/auth/logout";
import refreshHandler from "../../../api/auth/refresh";
import { mockRequest, mockResponse } from "../../setup/mock-vercel-req";

vi.mock("../../../api/_lib/supabase.js", () => ({
	createServerSupabaseClient: vi.fn(),
}));

import { createServerSupabaseClient } from "../../../api/_lib/supabase.js";

describe("BFF auth handlers", () => {
	beforeEach(() => {
		vi.mocked(createServerSupabaseClient).mockReset();
	});

	const csrfHeaders = {
		"x-gc-auth": "1",
		origin: "http://localhost:5173",
		host: "localhost:5173",
	};

	it("login returns 400 without credentials", async () => {
		const res = mockResponse();
		await loginHandler(
			mockRequest({ method: "POST", headers: csrfHeaders, body: {} }),
			res,
		);
		expect(res._status).toBe(400);
	});

	it("login sets cookie on success", async () => {
		vi.mocked(createServerSupabaseClient).mockReturnValue({
			auth: {
				signInWithPassword: vi.fn().mockResolvedValue({
					data: {
						session: {
							access_token: "at",
							refresh_token: "rt",
							expires_at: 1,
						},
						user: { id: "u1", email: "a@b.com" },
					},
					error: null,
				}),
			},
		} as ReturnType<typeof createServerSupabaseClient>);

		const res = mockResponse();
		await loginHandler(
			mockRequest({
				method: "POST",
				headers: csrfHeaders,
				body: { email: "a@b.com", password: "secret" },
			}),
			res,
		);
		expect(res._status).toBe(200);
		expect(String(res._headers["Set-Cookie"])).toContain("gc_rt=rt");
	});

	it("logout requires CSRF", async () => {
		const res = mockResponse();
		await logoutHandler(mockRequest({ method: "POST" }), res);
		expect(res._status).toBe(403);
	});

	it("refresh requires CSRF", async () => {
		const res = mockResponse();
		await refreshHandler(mockRequest({ method: "POST" }), res);
		expect(res._status).toBe(403);
	});
});
