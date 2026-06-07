import type { VercelRequest } from "@vercel/node";

const WINDOW_SECONDS = 15 * 60;
const LIMIT_PER_IP_EMAIL = 10;
const LIMIT_PER_IP = 50;

type MemoryEntry = { count: number; expiresAt: number };

const memoryStore = new Map<string, MemoryEntry>();

function getClientIp(req: VercelRequest): string {
	const xff = req.headers["x-forwarded-for"];
	if (typeof xff === "string" && xff.trim()) {
		return xff.split(",")[0].trim();
	}
	if (Array.isArray(xff) && xff[0]) {
		return String(xff[0]).split(",")[0].trim();
	}
	const realIp = req.headers["x-real-ip"];
	if (typeof realIp === "string" && realIp.trim()) {
		return realIp.trim();
	}
	return "unknown";
}

function memoryIncrement(key: string, windowSeconds: number): number {
	const now = Date.now();
	const existing = memoryStore.get(key);
	if (!existing || existing.expiresAt <= now) {
		memoryStore.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
		return 1;
	}
	existing.count += 1;
	return existing.count;
}

async function kvIncrement(key: string, windowSeconds: number): Promise<number | null> {
	const baseUrl = String(process.env.KV_REST_API_URL ?? "").replace(/\/$/, "");
	const token = String(process.env.KV_REST_API_TOKEN ?? "").trim();
	if (!baseUrl || !token) return null;

	const incrRes = await fetch(`${baseUrl}/incr/${encodeURIComponent(key)}`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!incrRes.ok) return null;

	const count = Number(await incrRes.text());
	if (!Number.isFinite(count)) return null;

	if (count === 1) {
		await fetch(`${baseUrl}/expire/${encodeURIComponent(key)}/${windowSeconds}`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
		});
	}

	return count;
}

async function incrementCounter(key: string, windowSeconds: number): Promise<number> {
	const kvCount = await kvIncrement(key, windowSeconds);
	if (kvCount != null) return kvCount;
	return memoryIncrement(key, windowSeconds);
}

export interface LoginRateLimitResult {
	allowed: boolean;
	retryAfterSeconds: number;
}

/**
 * Rate limit de login: 10 intentos / 15 min por IP+email y 50 / 15 min por IP.
 * Usa Vercel KV (REST) en prod si hay credenciales; Map en memoria en dev.
 */
export async function checkLoginRateLimit(
	req: VercelRequest,
	email: string,
): Promise<LoginRateLimitResult> {
	const ip = getClientIp(req);
	const normalizedEmail = String(email ?? "").trim().toLowerCase();
	const ipKey = `login:ip:${ip}`;
	const pairKey = `login:pair:${ip}:${normalizedEmail || "unknown"}`;

	const [ipCount, pairCount] = await Promise.all([
		incrementCounter(ipKey, WINDOW_SECONDS),
		incrementCounter(pairKey, WINDOW_SECONDS),
	]);

	if (ipCount > LIMIT_PER_IP || pairCount > LIMIT_PER_IP_EMAIL) {
		return { allowed: false, retryAfterSeconds: WINDOW_SECONDS };
	}
	return { allowed: true, retryAfterSeconds: 0 };
}

/** Expone helpers para tests. */
export const __rateLimitTestUtils = {
	WINDOW_SECONDS,
	LIMIT_PER_IP,
	LIMIT_PER_IP_EMAIL,
	clearMemoryStore: () => memoryStore.clear(),
	memoryIncrement,
};
