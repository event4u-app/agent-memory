// HTTP surface for `memory serve` — A1 in agents/roadmaps/runtime-trust.md.
//
// Opt-in via MEMORY_HTTP_PORT. When the variable is empty, the supervisor
// stays socket-free (current pre-A1 behavior). When set, two read-only
// endpoints are published next to the supervisor loop:
//
//   GET /health  — same shape as `memory health` (HealthResponseV1).
//   GET /ready   — 200 iff migrations up-to-date AND db reachable.
//
// Handler is exported separately from the listener so tests exercise the
// request/response pipe without binding a TCP socket.

import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
	BACKEND_FEATURES,
	CONTRACT_VERSION,
	type HealthResponseV1,
} from "../retrieval/contract.js";

const BACKEND_VERSION = "0.1.0";

export interface ServeHttpDeps {
	checkHealth: () => Promise<{ ok: boolean; latencyMs: number }>;
	listPending: () => Promise<string[]>;
}

export interface ServeHttpOptions extends ServeHttpDeps {
	port: number;
	host?: string;
}

export interface ServeHttpHandle {
	server: Server;
	port: number;
	close: () => Promise<void>;
}

export interface ReadyResponse {
	ready: boolean;
	db: "ok" | "error";
	migrations: "up-to-date" | "pending";
	pending?: string[];
	latency_ms: number;
}

export function buildHttpHandler(deps: ServeHttpDeps) {
	return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
		const url = (req.url ?? "").split("?")[0];
		if (req.method !== "GET") {
			writeJson(res, 405, { error: "method not allowed" });
			return;
		}
		if (url === "/health") {
			await handleHealth(res, deps);
			return;
		}
		if (url === "/ready") {
			await handleReady(res, deps);
			return;
		}
		writeJson(res, 404, { error: "not found" });
	};
}

export async function startServeHttp(opts: ServeHttpOptions): Promise<ServeHttpHandle> {
	const handler = buildHttpHandler(opts);
	const server = http.createServer((req, res) => {
		handler(req, res).catch(() => {
			if (!res.headersSent) writeJson(res, 500, { error: "internal error" });
			else res.end();
		});
	});
	await new Promise<void>((resolve, reject) => {
		const onError = (err: unknown) => {
			server.removeListener("listening", onListening);
			reject(err);
		};
		const onListening = () => {
			server.removeListener("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(opts.port, opts.host ?? "0.0.0.0");
	});
	const address = server.address();
	const boundPort =
		address && typeof address === "object" && "port" in address ? address.port : opts.port;
	return {
		server,
		port: boundPort,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			}),
	};
}

async function handleHealth(res: ServerResponse, deps: ServeHttpDeps): Promise<void> {
	const start = Date.now();
	let ok = false;
	let latency = 0;
	try {
		const r = await deps.checkHealth();
		ok = r.ok;
		latency = r.latencyMs;
	} catch {
		latency = Date.now() - start;
	}
	const envelope: HealthResponseV1 = {
		contract_version: CONTRACT_VERSION,
		status: ok ? "ok" : "error",
		backend_version: BACKEND_VERSION,
		features: [...BACKEND_FEATURES],
		latency_ms: latency,
	};
	writeJson(res, ok ? 200 : 503, envelope);
}

async function handleReady(res: ServerResponse, deps: ServeHttpDeps): Promise<void> {
	const start = Date.now();
	let pending: string[] = [];
	let migrationsOk = false;
	let dbOk = false;
	try {
		pending = await deps.listPending();
		migrationsOk = pending.length === 0;
	} catch {
		migrationsOk = false;
	}
	try {
		const r = await deps.checkHealth();
		dbOk = r.ok;
	} catch {
		dbOk = false;
	}
	const ready = migrationsOk && dbOk;
	const body: ReadyResponse = {
		ready,
		db: dbOk ? "ok" : "error",
		migrations: migrationsOk ? "up-to-date" : "pending",
		latency_ms: Date.now() - start,
		...(pending.length > 0 ? { pending } : {}),
	};
	writeJson(res, ready ? 200 : 503, body);
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
	res.statusCode = status;
	res.setHeader("content-type", "application/json");
	res.end(JSON.stringify(body));
}
