import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	REFRESH_COOKIE,
	clearRefreshCookie,
	jsonSession,
	methodGuard,
	passesCsrfCheck,
	readRefreshCookie,
	setRefreshCookie,
} from "../../../api/_lib/http";
import { mockRequest, mockResponse } from "../../setup/mock-vercel-req";

describe("api/_lib/http", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv, NODE_ENV: "development" };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("readRefreshCookie parses cookie header", () => {
		const req = mockRequest({
			headers: { cookie: `${REFRESH_COOKIE}=abc%20123; other=x` },
		});
		expect(readRefreshCookie(req)).toBe("abc 123");
	});

	it("readRefreshCookie returns null when missing", () => {
		expect(readRefreshCookie(mockRequest())).toBeNull();
	});

	it("setRefreshCookie sets HttpOnly cookie without Secure in dev", () => {
		const res = mockResponse();
		setRefreshCookie(res, "token-value");
		const setCookie = res._headers["Set-Cookie"] as string;
		expect(setCookie).toContain(`${REFRESH_COOKIE}=token-value`);
		expect(setCookie).toContain("HttpOnly");
		expect(setCookie).not.toContain("Secure");
	});

	it("setRefreshCookie adds Secure in production", () => {
		process.env.NODE_ENV = "production";
		const res = mockResponse();
		setRefreshCookie(res, "tok");
		expect(String(res._headers["Set-Cookie"])).toContain("Secure");
	});

	it("clearRefreshCookie sets Max-Age=0", () => {
		const res = mockResponse();
		clearRefreshCookie(res);
		expect(String(res._headers["Set-Cookie"])).toContain("Max-Age=0");
	});

	it("passesCsrfCheck requires X-GC-Auth and matching origin", () => {
		expect(
			passesCsrfCheck(
				mockRequest({
					headers: {
						"x-gc-auth": "1",
						origin: "http://localhost:5173",
						host: "localhost:5173",
					},
				}),
			),
		).toBe(true);
		expect(
			passesCsrfCheck(
				mockRequest({
					headers: {
						origin: "http://localhost:5173",
						host: "localhost:5173",
					},
				}),
			),
		).toBe(false);
	});

	it("passesCsrfCheck rejects missing origin on POST (M2)", () => {
		expect(
			passesCsrfCheck(mockRequest({ headers: { "x-gc-auth": "1", host: "x" } })),
		).toBe(false);
	});

	it("methodGuard blocks wrong method", () => {
		const res = mockResponse();
		const ok = methodGuard(mockRequest({ method: "GET" }), res, "POST");
		expect(ok).toBe(false);
		expect(res._status).toBe(405);
	});

	it("jsonSession returns session payload", () => {
		const res = mockResponse();
		jsonSession(res, {
			access_token: "at",
			expires_at: 123,
			user: { id: "u1", email: "a@b.com" },
		});
		expect(res._status).toBe(200);
		expect(res._json).toMatchObject({
			access_token: "at",
			user: { id: "u1", email: "a@b.com" },
		});
	});
});
