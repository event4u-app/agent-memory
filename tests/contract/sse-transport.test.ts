// A4 · runtime-trust — full MCP client ↔ server roundtrip over SSE.
//
// Uses a real Server instance with a minimal tool registered, so the
// whole transport stack (SSE GET /sse stream + POST /message dispatch
// + bearer auth enforcement) is exercised end-to-end. No Postgres
// touched — the tool returns a static payload.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { startMcpSseServer } from "../../src/mcp/sse-server.js";

function buildTestServer() {
	const server = new Server(
		{ name: "agent-memory-test", version: "0.0.0" },
		{ capabilities: { tools: {} } },
	);
	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: [
			{
				name: "memory_ping",
				description: "contract-test echo",
				inputSchema: { type: "object", properties: {} },
			},
		],
	}));
	server.setRequestHandler(CallToolRequestSchema, async () => ({
		content: [{ type: "text", text: "pong" }],
	}));
	return { server, close: async () => server.close() };
}

const TOKEN = "contract-test-token";

describe("MCP over SSE — contract roundtrip", () => {
	let handle: Awaited<ReturnType<typeof startMcpSseServer>> | undefined;
	let client: Client | undefined;

	afterEach(async () => {
		if (client) {
			await client.close().catch(() => {});
			client = undefined;
		}
		if (handle) {
			await handle.close();
			handle = undefined;
		}
	});

	it("connects, lists tools, and invokes memory_ping through the SSE stream", async () => {
		handle = await startMcpSseServer({
			port: 0,
			host: "127.0.0.1",
			token: TOKEN,
			buildServer: buildTestServer,
		});

		const transport = new SSEClientTransport(new URL(`http://127.0.0.1:${handle.port}/sse`), {
			// EventSource needs the Bearer header on the GET /sse request.
			eventSourceInit: {
				fetch: (url, init) =>
					fetch(url, {
						...init,
						headers: { ...(init?.headers ?? {}), authorization: `Bearer ${TOKEN}` },
					}),
			},
			// POST /message requests go through requestInit.
			requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
		});

		client = new Client({ name: "sse-contract-client", version: "0.0.0" });
		await client.connect(transport);

		const tools = await client.listTools();
		expect(tools.tools.map((t) => t.name)).toContain("memory_ping");

		const result = await client.callTool({ name: "memory_ping", arguments: {} });
		const content = result.content as Array<{ type: string; text: string }>;
		expect(content[0]?.text).toBe("pong");

		expect(handle.sessionCount()).toBe(1);
	}, 15000);

	it("rejects the initial GET /sse when the bearer token is wrong", async () => {
		handle = await startMcpSseServer({
			port: 0,
			host: "127.0.0.1",
			token: TOKEN,
			buildServer: buildTestServer,
		});

		// Straight fetch — we don't need an SSE client just to check auth.
		const res = await fetch(`http://127.0.0.1:${handle.port}/sse`, {
			headers: { authorization: "Bearer nope" },
		});
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("forbidden");
		expect(handle.sessionCount()).toBe(0);
	});
});
