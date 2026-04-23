// A4 · runtime-trust — MCP over HTTP/SSE.
//
// Exposes the same MCP server surface (23 tools) over Server-Sent Events
// so remote callers (GitHub Actions, Slack webhooks, Phase-C ingestion
// workers) can reach the backend without stdio. Auth is a static bearer
// token (`MEMORY_MCP_AUTH_TOKEN`) — real multi-tenant auth is out of
// scope for this roadmap (see Non-Goals in runtime-trust.md).
//
// Why SSE and not Streamable HTTP (the SDK's newer transport):
//  - The roadmap explicitly specifies `--transport sse` in the A4
//    done-criteria (public config surface for consumers).
//  - All current MCP clients (Claude Desktop, Cursor, Cline) still
//    support SSE; Streamable HTTP adoption is uneven as of 2026.
//  - A follow-up task can add Streamable HTTP without touching the
//    SSE path — both share `buildMcpServer()`.

import {
	createServer,
	type Server as HttpServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { URL } from "node:url";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { logger } from "../utils/logger.js";
import { buildMcpServer } from "./server.js";

export interface SseServerOptions {
	port: number;
	/** Bearer token required on `/sse` GET and `/message` POST. */
	token: string;
	/** 0.0.0.0 by default — bind to 127.0.0.1 for local-only. */
	host?: string;
	/** Test hook so contract tests can observe every transport close. */
	onSessionEnd?: (sessionId: string) => void;
	/**
	 * Factory for the per-session MCP server. Defaults to `buildMcpServer`.
	 * Injected in tests so auth + routing can be exercised without a live
	 * Postgres connection.
	 */
	buildServer?: () => { server: McpServer; close: () => Promise<void> };
}

export interface SseHandlerOptions {
	token: string;
	onSessionEnd?: (sessionId: string) => void;
	buildServer?: () => { server: McpServer; close: () => Promise<void> };
}

export interface SseServerHandle {
	port: number;
	close: () => Promise<void>;
	/** Number of live SSE sessions — used by tests + /health-hook. */
	sessionCount: () => number;
}

const ENDPOINT_SSE = "/sse";
const ENDPOINT_MESSAGE = "/message";

function checkBearer(req: IncomingMessage, token: string): 200 | 401 | 403 {
	const header = req.headers.authorization;
	if (!header || !header.startsWith("Bearer ")) return 401;
	const presented = header.slice("Bearer ".length).trim();
	if (presented.length === 0) return 401;
	if (presented !== token) return 403;
	return 200;
}

function send(res: ServerResponse, status: number, body: unknown): void {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify(body));
}

/**
 * Builds the low-level HTTP request handler that speaks MCP over SSE.
 * Split from `startMcpSseServer` so unit tests can exercise auth +
 * routing without binding a real socket or requiring Postgres.
 */
export function buildSseHandler(options: SseHandlerOptions): {
	handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
	sessionCount: () => number;
	closeAll: () => Promise<void>;
} {
	const { token, onSessionEnd, buildServer = buildMcpServer } = options;
	if (!token || token.trim().length === 0) {
		throw new Error("token is required");
	}

	const transports = new Map<string, SSEServerTransport>();

	const handler = async (req: IncomingMessage, res: ServerResponse) => {
		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

		if (req.method === "GET" && url.pathname === ENDPOINT_SSE) {
			const auth = checkBearer(req, token);
			if (auth !== 200) {
				send(res, auth, { error: auth === 401 ? "unauthorized" : "forbidden" });
				return;
			}
			const transport = new SSEServerTransport(ENDPOINT_MESSAGE, res);
			const sessionId = transport.sessionId;
			transports.set(sessionId, transport);
			transport.onclose = () => {
				transports.delete(sessionId);
				onSessionEnd?.(sessionId);
			};
			try {
				const { server } = buildServer();
				await server.connect(transport);
				logger.info({ sessionId }, "mcp-sse: client connected");
			} catch (err) {
				logger.error({ err, sessionId }, "mcp-sse: connect failed");
				transports.delete(sessionId);
				if (!res.writableEnded) res.end();
			}
			return;
		}

		if (req.method === "POST" && url.pathname === ENDPOINT_MESSAGE) {
			const auth = checkBearer(req, token);
			if (auth !== 200) {
				send(res, auth, { error: auth === 401 ? "unauthorized" : "forbidden" });
				return;
			}
			const sessionId = url.searchParams.get("sessionId");
			if (!sessionId) {
				send(res, 400, { error: "missing sessionId" });
				return;
			}
			const transport = transports.get(sessionId);
			if (!transport) {
				send(res, 404, { error: "session not found" });
				return;
			}
			try {
				await transport.handlePostMessage(req, res);
			} catch (err) {
				logger.error({ err, sessionId }, "mcp-sse: message dispatch failed");
				if (!res.writableEnded) send(res, 500, { error: "dispatch_failed" });
			}
			return;
		}

		send(res, 404, { error: "not_found" });
	};

	return {
		handler,
		sessionCount: () => transports.size,
		closeAll: async () => {
			for (const t of transports.values()) {
				try {
					await t.close();
				} catch {}
			}
			transports.clear();
		},
	};
}

/**
 * Start an HTTP listener that speaks MCP over SSE. One server instance
 * per session so message routing by sessionId stays straightforward —
 * cost is negligible because the heavy lifting (DB pool) lives in the
 * module-scope `getDb()` cache.
 */
export async function startMcpSseServer(options: SseServerOptions): Promise<SseServerHandle> {
	const { port, token, host = "0.0.0.0", onSessionEnd, buildServer } = options;
	if (!token || token.trim().length === 0) {
		throw new Error("MEMORY_MCP_AUTH_TOKEN is required for --transport sse");
	}

	const { handler, sessionCount, closeAll } = buildSseHandler({
		token,
		onSessionEnd,
		buildServer,
	});

	const http: HttpServer = createServer((req, res) => {
		void handler(req, res);
	});

	await new Promise<void>((resolve, reject) => {
		http.once("error", reject);
		http.listen(port, host, () => {
			http.off("error", reject);
			resolve();
		});
	});

	// `listen` accepts 0 as "any free port"; resolve the real one so the
	// caller (tests especially) gets a stable address back.
	const addr = http.address();
	const resolvedPort = typeof addr === "object" && addr ? addr.port : port;

	return {
		port: resolvedPort,
		sessionCount,
		close: async () => {
			await closeAll();
			await new Promise<void>((resolve) => http.close(() => resolve()));
		},
	};
}
