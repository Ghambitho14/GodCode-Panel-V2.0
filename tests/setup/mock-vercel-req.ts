import type { VercelRequest, VercelResponse } from "@vercel/node";

export function mockRequest(
	overrides: Partial<VercelRequest> & {
		method?: string;
		headers?: Record<string, string | string[] | undefined>;
		body?: unknown;
	} = {},
): VercelRequest {
	return {
		method: "GET",
		headers: {},
		body: undefined,
		...overrides,
	} as VercelRequest;
}

export function mockResponse(): VercelResponse & {
	_status: number;
	_headers: Record<string, string | string[]>;
	_json: unknown;
} {
	const headers: Record<string, string | string[]> = {};
	let statusCode = 200;
	let jsonBody: unknown;

	const res = {
		_status: 0,
		_headers: headers,
		_json: undefined as unknown,
		status(code: number) {
			statusCode = code;
			res._status = code;
			return res;
		},
		json(body: unknown) {
			jsonBody = body;
			res._json = body;
			return res;
		},
		setHeader(name: string, value: string | string[]) {
			headers[name] = value;
		},
		get statusCode() {
			return statusCode;
		},
		get body() {
			return jsonBody;
		},
	} as VercelResponse & {
		_status: number;
		_headers: Record<string, string | string[]>;
		_json: unknown;
	};

	return res;
}
