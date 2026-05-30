export type FetchJsonOptions = {
	/** @default true */
	parseJson?: boolean;
	retries?: number;
	retryDelayMs?: number;
};

export async function fetchJsonWithRetry(
	input: RequestInfo | URL,
	init?: RequestInit,
	options?: FetchJsonOptions,
): Promise<Response> {
	const retries = options?.retries ?? 0;
	const delay = options?.retryDelayMs ?? 400;
	let lastErr: unknown;
	for (let attempt = 0; attempt <= retries; attempt += 1) {
		try {
			const res = await fetch(input, init);
			return res;
		} catch (e) {
			lastErr = e;
			if (attempt < retries) {
				await new Promise((r) => setTimeout(r, delay * (attempt + 1)));
			}
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
