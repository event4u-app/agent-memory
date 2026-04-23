// A1 · runtime-trust — /health and /ready handler contract.
//
// The handler is exercised with mocked deps so the suite stays hermetic.
// A single socket-bind round-trip is added at the end to catch regressions
// in the listener wiring without requiring a live Postgres connection.

import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { parseServePort } from "../../src/cli/index.js";
import { buildHttpHandler, startServeHttp } from "../../src/cli/serve-http.js";

interface CapturedResponse {
	status: number;
	headers: Record<string, string>;
	body: unknown;
}

function mockReq(url: string, method = "GET"): IncomingMessage {
	return { url, method } as unknown as IncomingMessage;
}

function mockRes(): { res: ServerResponse; captured: CapturedResponse } {
	const captured: CapturedResponse = { status: 200, headers: {}, body: undefined };
	const res = {
		statusCode: 200,
		headersSent: false,
		setHeader(name: string, value: string) {
			captured.headers[name.toLowerCase()] = value;
		},
		end(chunk?: string) {
			captured.status = this.statusCode;
			if (chunk) captured.body = JSON.parse(chunk);
		},
	} as unknown as ServerResponse;
	return { res, captured };
}

describe("parseServePort", () => {
	it("returns null for unset, empty, blank, or invalid values", () => {
		expect(parseServePort(undefined)).toBeNull();
		expect(parseServePort("")).toBeNull();
		expect(parseServePort("   ")).toBeNull();
		expect(parseServePort("abc")).toBeNull();
		expect(parseServePort("0")).toBeNull();
		expect(parseServePort("-1")).toBeNull();
		expect(parseServePort("70000")).toBeNull();
	});

	it("parses valid ports and strips whitespace", () => {
		expect(parseServePort("7077")).toBe(7077);
		expect(parseServePort("  8080 ")).toBe(8080);
		expect(parseServePort("1")).toBe(1);
		expect(parseServePort("65535")).toBe(65535);
	});
});

describe("buildHttpHandler — GET /health", () => {
	it("200 + healthy envelope when db is reachable", async () => {
		const handler = buildHttpHandler({
			checkHealth: async () => ({ ok: true, latencyMs: 5 }),
			listPending: async () => [],
		});
		const { res, captured } = mockRes();
		await handler(mockReq("/health"), res);
		expect(captured.status).toBe(200);
		expect(captured.headers["content-type"]).toBe("application/json");
		const body = captured.body as { status: string; latency_ms: number; contract_version: string };
		expect(body.status).toBe("ok");
		expect(body.contract_version).toBeTruthy();
		expect(body.latency_ms).toBe(5);
	});

	it("503 + error envelope when db is down", async () => {
		const handler = buildHttpHandler({
			checkHealth: async () => ({ ok: false, latencyMs: 42 }),
			listPending: async () => [],
		});
		const { res, captured } = mockRes();
		await handler(mockReq("/health"), res);
		expect(captured.status).toBe(503);
		const body = captured.body as { status: string };
		expect(body.status).toBe("error");
	});
});

describe("buildHttpHandler — GET /ready", () => {
	it("200 when migrations are up-to-date AND db reachable", async () => {
		const handler = buildHttpHandler({
			checkHealth: async () => ({ ok: true, latencyMs: 3 }),
			listPending: async () => [],
		});
		const { res, captured } = mockRes();
		await handler(mockReq("/ready"), res);
		expect(captured.status).toBe(200);
		const body = captured.body as { ready: boolean; db: string; migrations: string };
		expect(body.ready).toBe(true);
		expect(body.db).toBe("ok");
		expect(body.migrations).toBe("up-to-date");
	});

	it("503 with pending list when migrations are missing", async () => {
		const handler = buildHttpHandler({
			checkHealth: async () => ({ ok: true, latencyMs: 3 }),
			listPending: async () => ["005_pending"],
		});
		const { res, captured } = mockRes();
		await handler(mockReq("/ready"), res);
		expect(captured.status).toBe(503);
		const body = captured.body as { ready: boolean; pending: string[] };
		expect(body.ready).toBe(false);
		expect(body.pending).toEqual(["005_pending"]);
	});

	it("503 when db probe fails even if migrations are up-to-date", async () => {
		const handler = buildHttpHandler({
			checkHealth: async () => ({ ok: false, latencyMs: 100 }),
			listPending: async () => [],
		});
		const { res, captured } = mockRes();
		await handler(mockReq("/ready"), res);
		expect(captured.status).toBe(503);
	});
});

describe("buildHttpHandler — routing", () => {
	const deps = {
		checkHealth: async () => ({ ok: true, latencyMs: 1 }),
		listPending: async () => [] as string[],
	};

	it("404 on unknown path", async () => {
		const handler = buildHttpHandler(deps);
		const { res, captured } = mockRes();
		await handler(mockReq("/metrics"), res);
		expect(captured.status).toBe(404);
	});

	it("405 on non-GET method", async () => {
		const handler = buildHttpHandler(deps);
		const { res, captured } = mockRes();
		await handler(mockReq("/health", "POST"), res);
		expect(captured.status).toBe(405);
	});
});

describe("startServeHttp listener round-trip", () => {
	it("binds, serves /health, and closes cleanly", async () => {
		const handle = await startServeHttp({
			port: 0,
			host: "127.0.0.1",
			checkHealth: async () => ({ ok: true, latencyMs: 1 }),
			listPending: async () => [],
		});
		try {
			const response = await fetch(`http://127.0.0.1:${handle.port}/health`);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { status: string };
			expect(body.status).toBe("ok");
		} finally {
			await handle.close();
		}
	});
});
