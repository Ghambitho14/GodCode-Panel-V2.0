import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockRequest, mockResponse } from "../../setup/mock-vercel-req";
import { __rateLimitTestUtils } from "../../../api/_lib/rate-limit";

vi.mock("../../../api/_lib/supabase.js", () => ({
	createServerSupabaseClient: vi.fn(),
}));

import loginHandler from "../../../api/auth/login";
import { createServerSupabaseClient } from "../../../api/_lib/supabase.js";

const csrfHeaders = {
	"x-gc-auth": "1",
	origin: "http://localhost:5173",
	host: "localhost:5173",
};

function mockSignIn(result: {
	data?: { session: { access_token: string; refresh_token: string; expires_at: number }; user: { id: string; email: string } } | null;
	error?: { message: string } | null;
}) {
	vi.mocked(createServerSupabaseClient).mockReturnValue({
		auth: {
			signInWithPassword: vi.fn().mockResolvedValue(result),
		},
	} as ReturnType<typeof createServerSupabaseClient>);
}

describe("api/auth/login", () => {
	beforeEach(() => {
		vi.mocked(createServerSupabaseClient).mockReset();
		__rateLimitTestUtils.clearMemoryStore();
		process.env.KV_REST_API_URL = "";
		process.env.KV_REST_API_TOKEN = "";
	});

	it("returns 403 without X-GC-Auth", async () => {
		const res = mockResponse();
		await loginHandler(
			mockRequest({
				method: "POST",
				headers: { origin: "http://localhost:5173", host: "localhost:5173" },
				body: { email: "a@b.com", password: "secret" },
			}),
			res,
		);
		expect(res._status).toBe(403);
	});

	it("returns 429 after exceeding rate limit", async () => {
		mockSignIn({
			data: null,
			error: { message: "bad" },
		});

		for (let i = 0; i < __rateLimitTestUtils.LIMIT_PER_IP_EMAIL; i += 1) {
			const res = mockResponse();
			await loginHandler(
				mockRequest({
					method: "POST",
					headers: csrfHeaders,
					body: { email: "brute@test.com", password: "wrong" },
				}),
				res,
			);
			expect(res._status).toBe(401);
		}

		const blocked = mockResponse();
		await loginHandler(
			mockRequest({
				method: "POST",
				headers: csrfHeaders,
				body: { email: "brute@test.com", password: "wrong" },
			}),
			blocked,
		);
		expect(blocked._status).toBe(429);
		expect(String(blocked._headers["Retry-After"])).toBe(
			String(__rateLimitTestUtils.WINDOW_SECONDS),
		);
	});

	it("returns session on successful login", async () => {
		mockSignIn({
			data: {
				session: {
					access_token: "at",
					refresh_token: "rt",
					expires_at: 123,
				},
				user: { id: "u1", email: "ok@test.com" },
			},
			error: null,
		});

		const res = mockResponse();
		await loginHandler(
			mockRequest({
				method: "POST",
				headers: csrfHeaders,
				body: { email: "ok@test.com", password: "good" },
			}),
			res,
		);
		expect(res._status).toBe(200);
		expect(res._json).toMatchObject({ access_token: "at" });
		expect(String(res._headers["Set-Cookie"])).toContain("gc_rt=rt");
	});

	it("returns generic 500 on unexpected server error (M8)", async () => {
		vi.mocked(createServerSupabaseClient).mockImplementation(() => {
			throw new Error("supabase internal stack trace");
		});

		const res = mockResponse();
		await loginHandler(
			mockRequest({
				method: "POST",
				headers: csrfHeaders,
				body: { email: "a@b.com", password: "x" },
			}),
			res,
		);
		expect(res._status).toBe(500);
		expect(res._json).toEqual({ error: "Error de servidor." });
	});
});
