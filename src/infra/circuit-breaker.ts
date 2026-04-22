/**
 * Generic circuit breaker for external dependencies.
 *
 * States:
 *   closed    — requests pass through; failures counted
 *   open      — requests fail fast; after cooldown → half-open
 *   half-open — one trial request; success → closed, failure → open
 *
 * Use for: embedding APIs, rate-limited third-party calls.
 */

import { logger } from "../utils/logger.js";

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
	/** Consecutive failures to trip the breaker */
	failureThreshold?: number;
	/** Cooldown in ms before attempting half-open */
	cooldownMs?: number;
	/** Optional label for logs */
	name?: string;
}

export class CircuitOpenError extends Error {
	constructor(name: string) {
		super(`Circuit "${name}" is open — failing fast`);
		this.name = "CircuitOpenError";
	}
}

export class CircuitBreaker {
	private state: CircuitState = "closed";
	private failures = 0;
	private openedAt = 0;
	private readonly failureThreshold: number;
	private readonly cooldownMs: number;
	private readonly name: string;

	constructor(opts: CircuitBreakerOptions = {}) {
		this.failureThreshold = opts.failureThreshold ?? 3;
		this.cooldownMs = opts.cooldownMs ?? 30_000;
		this.name = opts.name ?? "anon";
	}

	get currentState(): CircuitState {
		if (
			this.state === "open" &&
			Date.now() - this.openedAt >= this.cooldownMs
		) {
			this.state = "half-open";
			logger.info({ breaker: this.name }, "Circuit transitioned to half-open");
		}
		return this.state;
	}

	async execute<T>(fn: () => Promise<T>): Promise<T> {
		const state = this.currentState;
		if (state === "open") {
			throw new CircuitOpenError(this.name);
		}
		try {
			const result = await fn();
			this.onSuccess();
			return result;
		} catch (err) {
			this.onFailure(err);
			throw err;
		}
	}

	private onSuccess(): void {
		if (this.state === "half-open") {
			logger.info({ breaker: this.name }, "Circuit recovered → closed");
		}
		this.state = "closed";
		this.failures = 0;
	}

	private onFailure(err: unknown): void {
		this.failures++;
		if (this.state === "half-open" || this.failures >= this.failureThreshold) {
			this.state = "open";
			this.openedAt = Date.now();
			logger.warn(
				{
					breaker: this.name,
					failures: this.failures,
					err: (err as Error)?.message,
				},
				"Circuit tripped → open",
			);
		}
	}

	/** For tests. */
	reset(): void {
		this.state = "closed";
		this.failures = 0;
		this.openedAt = 0;
	}
}
