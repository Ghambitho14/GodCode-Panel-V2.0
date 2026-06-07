import { beforeEach, describe, expect, it } from "vitest";
import { checkLoginRateLimit, __rateLimitTestUtils } from "../../../api/_lib/rate-limit";
import { mockRequest } from "../../setup/mock-vercel-req";

describe("api/_lib/rate-limit", () => {
	beforeEach(() => {
		__rateLimitTestUtils.clearMemoryStore();
		process.env.KV_REST_API_URL = "";
		process.env.KV_REST_API_TOKEN = "";
	});

	it("allows requests under the per IP+email limit", async () => {
		const req = mockRequest({ headers: { "x-forwarded-for": "1.2.3.4" } });
		for (let i = 0; i < __rateLimitTestUtils.LIMIT_PER_IP_EMAIL; i += 1) {
			const result = await checkLoginRateLimit(req, "user@test.com");
			expect(result.allowed).toBe(true);
		}
	});

	it("blocks the next attempt for the same IP+email pair", async () => {
		const req = mockRequest({ headers: { "x-forwarded-for": "9.9.9.9" } });
		for (let i = 0; i < __rateLimitTestUtils.LIMIT_PER_IP_EMAIL; i += 1) {
			await checkLoginRateLimit(req, "blocked@test.com");
		}
		const blocked = await checkLoginRateLimit(req, "blocked@test.com");
		expect(blocked.allowed).toBe(false);
		expect(blocked.retryAfterSeconds).toBe(__rateLimitTestUtils.WINDOW_SECONDS);
	});
});
