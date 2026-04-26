// A4 · runtime-trust — MCP over HTTP/SSE.
//
// Unit tests hit the request handler directly (no socket, no DB) to
// cover auth + routing. A single round-trip through a bound socket
// validates the listener wiring without opening a real SSE stream.

import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSseHandler, startMcpSseServer } from "../../src/mcp/sse-server.js";

interface CapturedResponse {
	status: number;
	headers: Record<string, string>;
	body: unknown;
}

function mockReq(opts: {
	url: string;
	method: string;
	token?: string;
	rawAuth?: string;
}): IncomingMessage {
	const headers: Record<string, string> = { host: "localhost" };
	if (opts.rawAuth !== undefined) headers.authorization = opts.rawAuth;
	else if (opts.token) headers.authorization = `Bearer ${opts.token}`;
	return { url: opts.url, method: opts.method, headers } as unknown as IncomingMessage;
}

function mockRes(): { res: ServerResponse; captured: CapturedResponse } {
	const captured: CapturedResponse = { status: 200, headers: {}, body: undefined };
	const res = {
		statusCode: 200,
		writableEnded: false,
		setHeader(name: string, value: string) {
			captured.headers[name.toLowerCase()] = value;
		},
		end(chunk?: string) {
			this.writableEnded = true;
			captured.status = this.statusCode;
			if (!chunk) return;
			const ct = captured.headers["content-type"] ?? "";
			captured.body = ct.startsWith("application/json") ? JSON.parse(chunk) : chunk;
		},
	} as unknown as ServerResponse;
	return { res, captured };
}

const TOKEN = "secret-token-xyz";

function buildNoopServer() {
	// Minimal stand-in: the handler only needs `.connect(transport)`.
	return {
		server: {
			connect: vi.fn(async () => {}),
			close: vi.fn(async () => {}),
		} as unknown as import("@modelcontextprotocol/sdk/server/index.js").Server,
		close: async () => {},
	};
}

describe("buildSseHandler — auth", () => {
	it("rejects with 401 when Authorization header is missing", async () => {
		const { handler } = buildSseHandler({ token: TOKEN, buildServer: buildNoopServer });
		const { res, captured } = mockRes();
		await handler(mockReq({ url: "/sse", method: "GET" }), res);
		expect(captured.status).toBe(401);
		expect((captured.body as { error: string }).error).toBe("unauthorized");
	});

	it("rejects with 401 when Authorization has no Bearer prefix", async () => {
		const { handler } = buildSseHandler({ token: TOKEN, buildServer: buildNoopServer });
		const { res, captured } = mockRes();
		await handler(mockReq({ url: "/sse", method: "GET", rawAuth: "Basic abc" }), res);
		expect(captured.status).toBe(401);
	});

	it("rejects with 401 when Bearer token is empty", async () => {
		const { handler } = buildSseHandler({ token: TOKEN, buildServer: buildNoopServer });
		const { res, captured } = mockRes();
		await handler(mockReq({ url: "/sse", method: "GET", rawAuth: "Bearer " }), res);
		expect(captured.status).toBe(401);
	});

	it("rejects with 403 when Bearer token does not match", async () => {
		const { handler } = buildSseHandler({ token: TOKEN, buildServer: buildNoopServer });
		const { res, captured } = mockRes();
		await handler(mockReq({ url: "/sse", method: "GET", token: "wrong" }), res);
		expect(captured.status).toBe(403);
		expect((captured.body as { error: string }).error).toBe("forbidden");
	});

	it("rejects /message POST with 401 when token is missing", async () => {
		const { handler } = buildSseHandler({ token: TOKEN, buildServer: buildNoopServer });
		const { res, captured } = mockRes();
		await handler(mockReq({ url: "/message?sessionId=abc", method: "POST" }), res);
		expect(captured.status).toBe(401);
	});
});

describe("buildSseHandler — routing", () => {
	it("404 on unknown path", async () => {
		const { handler } = buildSseHandler({ token: TOKEN, buildServer: buildNoopServer });
		const { res, captured } = mockRes();
		await handler(mockReq({ url: "/does-not-exist", method: "GET", token: TOKEN }), res);
		expect(captured.status).toBe(404);
		expect((captured.body as { error: string }).error).toBe("not_found");
	});

	it("400 on POST /message without sessionId", async () => {
		const { handler } = buildSseHandler({ token: TOKEN, buildServer: buildNoopServer });
		const { res, captured } = mockRes();
		await handler(mockReq({ url: "/message", method: "POST", token: TOKEN }), res);
		expect(captured.status).toBe(400);
		expect((captured.body as { error: string }).error).toBe("missing sessionId");
	});

	it("404 on POST /message with unknown sessionId", async () => {
		const { handler } = buildSseHandler({ token: TOKEN, buildServer: buildNoopServer });
		const { res, captured } = mockRes();
		await handler(mockReq({ url: "/message?sessionId=ghost", method: "POST", token: TOKEN }), res);
		expect(captured.status).toBe(404);
		expect((captured.body as { error: string }).error).toBe("session not found");
	});
});

describe("buildSseHandler — construction", () => {
	it("throws when token is empty", () => {
		expect(() => buildSseHandler({ token: "", buildServer: buildNoopServer })).toThrow();
		expect(() => buildSseHandler({ token: "   ", buildServer: buildNoopServer })).toThrow();
	});
});

describe("startMcpSseServer — listener round-trip", () => {
	let handle: Awaited<ReturnType<typeof startMcpSseServer>> | undefined;

	afterEach(async () => {
		if (handle) {
			await handle.close();
			handle = undefined;
		}
	});

	it("binds on a free port, rejects unauth requests, and closes cleanly", async () => {
		handle = await startMcpSseServer({
			port: 0,
			host: "127.0.0.1",
			token: TOKEN,
			buildServer: buildNoopServer,
		});
		expect(handle.port).toBeGreaterThan(0);
		const noAuth = await fetch(`http://127.0.0.1:${handle.port}/sse`);
		expect(noAuth.status).toBe(401);
		const badAuth = await fetch(`http://127.0.0.1:${handle.port}/sse`, {
			headers: { authorization: "Bearer nope" },
		});
		expect(badAuth.status).toBe(403);
		const unknown = await fetch(`http://127.0.0.1:${handle.port}/nope`);
		expect(unknown.status).toBe(404);
		expect(handle.sessionCount()).toBe(0);
	});

	it("refuses to start without a token", async () => {
		await expect(
			startMcpSseServer({ port: 0, host: "127.0.0.1", token: "", buildServer: buildNoopServer }),
		).rejects.toThrow(/MEMORY_MCP_AUTH_TOKEN/);
	});
});
