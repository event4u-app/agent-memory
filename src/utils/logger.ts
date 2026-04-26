import pino, { type LoggerOptions } from "pino";
import { config } from "../config.js";
import { redactSecretsInText } from "../security/secret-guard.js";

/**
 * Field names that commonly carry credentials. Pino's wildcard `redact` does a
 * fast structural match on these paths and replaces the value with `[REDACTED]`.
 * Free-string redaction (e.g. a token pasted into a log message) is handled by
 * the `logMethod` hook below.
 */
const SECRET_FIELD_PATHS: string[] = [
	"password",
	"passwd",
	"pwd",
	"token",
	"accessToken",
	"refreshToken",
	"apiKey",
	"api_key",
	"secret",
	"authorization",
	"auth",
	"cookie",
	"setCookie",
	"*.password",
	"*.passwd",
	"*.pwd",
	"*.token",
	"*.accessToken",
	"*.refreshToken",
	"*.apiKey",
	"*.api_key",
	"*.secret",
	"*.authorization",
	"*.auth",
	"*.cookie",
	"*.setCookie",
	"headers.authorization",
	"headers.cookie",
	"req.headers.authorization",
	"req.headers.cookie",
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
	if (v === null || typeof v !== "object") return false;
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
}

/**
 * Scrub free-string secrets from a single log argument.
 *
 * - Top-level strings pass through `redactSecretsInText`.
 * - Plain objects and arrays are deep-walked and string leaves are scrubbed,
 *   producing a fresh structure so caller-owned objects are never mutated.
 *   This closes the gap where a secret sits in an unknown structured field
 *   (e.g. `{ embeddingText: "<token>" }`) that the path-based `redact`
 *   configuration does not enumerate.
 * - Everything else (Error, Buffer, class instances, primitives) is returned
 *   as-is so pino's own serializers keep their semantics.
 *
 * Depth is capped defensively; log payloads deeper than that are rare and
 * the cap prevents pathological cycles from blowing the stack.
 */
function redactArg(arg: unknown, depth = 0): unknown {
	if (typeof arg === "string") return redactSecretsInText(arg);
	if (depth > 6) return arg;
	if (Array.isArray(arg)) return arg.map((v) => redactArg(v, depth + 1));
	if (!isPlainObject(arg)) return arg;
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(arg)) {
		out[k] = redactArg(v, depth + 1);
	}
	return out;
}

/**
 * Redaction-aware pino options. Exported (without the pretty transport) so
 * tests can construct isolated loggers bound to capture streams without
 * duplicating the redact config.
 */
export const redactLoggerOptions: LoggerOptions = {
	level: config.log.level,
	redact: { paths: SECRET_FIELD_PATHS, censor: "[REDACTED]" },
	hooks: {
		// Scrub free-string arguments (message + any trailing format strings).
		// Structured-field redaction is handled by pino's native `redact` above.
		logMethod(inputArgs, method) {
			for (let i = 0; i < inputArgs.length; i++) {
				inputArgs[i] = redactArg(inputArgs[i]);
			}
			return method.apply(this, inputArgs as Parameters<typeof method>);
		},
	},
};

const loggerOptions: LoggerOptions = {
	...redactLoggerOptions,
	transport:
		config.log.format === "pretty"
			? { target: "pino-pretty", options: { colorize: true, destination: 2 } }
			: undefined,
};

// Write logs to stderr so CLI stdout remains clean for machine-readable output
// (e.g. `memory status` → `present|absent|misconfigured`).
export const logger = pino(
	loggerOptions,
	config.log.format === "pretty" ? undefined : pino.destination(2),
);
