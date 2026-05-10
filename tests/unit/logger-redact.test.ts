import { Writable } from "node:stream";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { redactLoggerOptions } from "../../src/utils/logger.js";

function captureLogger() {
	const lines: string[] = [];
	const stream = new Writable({
		write(chunk, _enc, cb) {
			lines.push(chunk.toString());
			cb();
		},
	});
	const log = pino({ ...redactLoggerOptions, level: "debug" }, stream);
	return { log, lines };
}

describe("logger redaction — structured fields (pino.redact)", () => {
	it("replaces `token` field value with [REDACTED]", () => {
		const { log, lines } = captureLogger();
		log.info({ token: "ghp_0123456789abcdefghijklmnopqrstuvwxyz01" }, "hello");
		const payload = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
		expect(payload.token).toBe("[REDACTED]");
	});

	it("redacts common credential field names (password, apiKey, authorization)", () => {
		const { log, lines } = captureLogger();
		log.info(
			{
				password: "hunter2",
				apiKey: "sk-abc",
				authorization: "Bearer xxx",
			},
			"login",
		);
		const payload = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
		expect(payload.password).toBe("[REDACTED]");
		expect(payload.apiKey).toBe("[REDACTED]");
		expect(payload.authorization).toBe("[REDACTED]");
	});

	it("redacts nested credential fields via wildcard path", () => {
		const { log, lines } = captureLogger();
		log.info({ req: { headers: { authorization: "Bearer xxx" } } }, "req");
		const payload = JSON.parse(lines[0] ?? "{}") as {
			req: { headers: { authorization: string } };
		};
		expect(payload.req.headers.authorization).toBe("[REDACTED]");
	});

	it("leaves non-secret fields untouched", () => {
		const { log, lines } = captureLogger();
		log.info({ userId: 42, method: "POST", path: "/invoices" }, "req");
		const payload = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
		expect(payload.userId).toBe(42);
		expect(payload.method).toBe("POST");
		expect(payload.path).toBe("/invoices");
	});
});

describe("logger redaction — free-string messages (logMethod hook)", () => {
	it("scrubs GitHub tokens embedded in a message string", () => {
		const { log, lines } = captureLogger();
		log.info("calling GitHub with ghp_0123456789abcdefghijklmnopqrstuvwxyz01 now");
		const payload = JSON.parse(lines[0] ?? "{}") as { msg: string };
		expect(payload.msg).not.toMatch(/ghp_[A-Za-z0-9_]{36}/);
		expect(payload.msg).toContain("[REDACTED:github_token]");
	});

	it("scrubs AWS keys in a message string", () => {
		const { log, lines } = captureLogger();
		log.info("aws candidate: AKIAABCDEFGHIJKLMNOP");
		const payload = JSON.parse(lines[0] ?? "{}") as { msg: string };
		expect(payload.msg).not.toContain("AKIAABCDEFGHIJKLMNOP");
		expect(payload.msg).toContain("[REDACTED:aws_access_key]");
	});

	it("scrubs postgres connection strings", () => {
		const { log, lines } = captureLogger();
		log.info("connecting to postgres://u:p@h:5432/db");
		const payload = JSON.parse(lines[0] ?? "{}") as { msg: string };
		expect(payload.msg).not.toContain("postgres://u:p@h");
		expect(payload.msg).toContain("[REDACTED:connection_string]");
	});

	it("leaves clean messages unchanged", () => {
		const { log, lines } = captureLogger();
		log.info("starting worker at tier=semantic");
		const payload = JSON.parse(lines[0] ?? "{}") as { msg: string };
		expect(payload.msg).toBe("starting worker at tier=semantic");
	});

	it("redacts strings in mixed-arity calls (object + message with secret)", () => {
		const { log, lines } = captureLogger();
		log.info({ step: 1 }, "saw token ghp_0123456789abcdefghijklmnopqrstuvwxyz01");
		const payload = JSON.parse(lines[0] ?? "{}") as { msg: string; step: number };
		expect(payload.step).toBe(1);
		expect(payload.msg).toContain("[REDACTED:github_token]");
		expect(payload.msg).not.toMatch(/ghp_[A-Za-z0-9_]{36}/);
	});
});

afterEach(() => {
	// No shared state; captureLogger instantiates a fresh pino per test.
});
