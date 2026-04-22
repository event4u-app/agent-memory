/**
 * Retry with exponential backoff + optional jitter.
 *
 * Default: 3 attempts, 100ms base, ×2 factor, ±20% jitter.
 */

import { logger } from "../utils/logger.js";

export interface RetryOptions {
	attempts?: number;
	baseDelayMs?: number;
	factor?: number;
	jitter?: boolean;
	onRetry?: (attempt: number, err: unknown) => void;
	/** If returns false, stop retrying (e.g. 4xx client errors). */
	shouldRetry?: (err: unknown) => boolean;
	name?: string;
}

export async function withRetry<T>(
	fn: () => Promise<T>,
	opts: RetryOptions = {},
): Promise<T> {
	const attempts = opts.attempts ?? 3;
	const baseDelayMs = opts.baseDelayMs ?? 100;
	const factor = opts.factor ?? 2;
	const jitter = opts.jitter ?? true;
	const shouldRetry = opts.shouldRetry ?? (() => true);
	const name = opts.name ?? "retry";

	let lastErr: unknown;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastErr = err;
			if (attempt === attempts || !shouldRetry(err)) {
				break;
			}
			const delay = computeDelay(attempt, baseDelayMs, factor, jitter);
			opts.onRetry?.(attempt, err);
			logger.debug(
				{ name, attempt, nextDelayMs: delay, err: (err as Error)?.message },
				"Retrying after failure",
			);
			await sleep(delay);
		}
	}
	throw lastErr;
}

function computeDelay(
	attempt: number,
	base: number,
	factor: number,
	jitter: boolean,
): number {
	const exp = base * factor ** (attempt - 1);
	if (!jitter) return exp;
	const jitterFactor = 0.8 + Math.random() * 0.4;
	return Math.round(exp * jitterFactor);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
