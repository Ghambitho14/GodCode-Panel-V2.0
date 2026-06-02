import { vi } from "vitest";

type QueryResult = { data: unknown; error: unknown; count?: number };

export function createMockSupabaseClient(handlers: {
	from?: (table: string) => Record<string, unknown>;
	auth?: Record<string, unknown>;
} = {}) {
	const chain = (table: string) => {
		const custom = handlers.from?.(table);
		if (custom) return custom;
		return {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
		};
	};

	return {
		from: vi.fn((table: string) => chain(table)),
		auth: {
			signInWithPassword: vi.fn(),
			refreshSession: vi.fn(),
			setSession: vi.fn(),
			signOut: vi.fn(),
			...handlers.auth,
		},
	};
}

export type MockSupabase = ReturnType<typeof createMockSupabaseClient>;

export function mockQueryResult(result: QueryResult) {
	const terminal = vi.fn().mockResolvedValue(result);
	const chain = {
		select: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		maybeSingle: terminal,
	};
	(chain as { then?: unknown }).then = (resolve: (v: QueryResult) => void) =>
		Promise.resolve(result).then(resolve);
	return chain;
}
