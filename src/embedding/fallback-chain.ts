/**
 * Orchestrates a chain of embedding providers with circuit-breaker protection
 * and retry-with-backoff per provider. Falls through to the next provider on
 * persistent failure. If all fail, returns [] (vector search skipped).
 */

import { config } from "../config.js";
import { CircuitBreaker, CircuitOpenError, withRetry } from "../infra/index.js";
import { recordEmbeddingFallback } from "../observability/metrics.js";
import { logger } from "../utils/logger.js";
import { secureEmbeddingInput } from "./boundary.js";
import type { EmbeddingProvider, EmbeddingProviderName, EmbeddingResult } from "./types.js";

export interface FallbackChainOptions {
	retryAttempts?: number;
	retryBaseDelayMs?: number;
	circuitFailureThreshold?: number;
	circuitCooldownMs?: number;
}

export class EmbeddingFallbackChain {
	private readonly breakers = new Map<EmbeddingProviderName, CircuitBreaker>();

	constructor(
		private readonly providers: EmbeddingProvider[],
		private readonly opts: FallbackChainOptions = {},
	) {
		for (const p of providers) {
			this.breakers.set(
				p.name,
				new CircuitBreaker({
					name: `embedding:${p.name}`,
					failureThreshold: opts.circuitFailureThreshold ?? 3,
					cooldownMs: opts.circuitCooldownMs ?? 30_000,
				}),
			);
		}
	}

	get primary(): EmbeddingProvider | undefined {
		return this.providers[0];
	}

	/**
	 * Try each provider until one succeeds. Inactive providers (bm25-only)
	 * short-circuit to an empty vector and stop the chain.
	 *
	 * Applies the secret-ingress boundary once up-front: `reject` throws
	 * `SecretViolationError` before any provider sees the text; `redact`
	 * scrubs the text and logs an audit warning.
	 */
	async embed(text: string): Promise<EmbeddingResult> {
		const safeText = secureEmbeddingInput(text, config.security.secretPolicy);
		for (let i = 0; i < this.providers.length; i++) {
			const provider = this.providers[i]!;
			if (!provider.isActive) {
				return { vector: [], provider: provider.name };
			}
			const breaker = this.breakers.get(provider.name);
			if (!breaker) continue;
			try {
				const vector = await breaker.execute(() =>
					withRetry(() => provider.embed(safeText), {
						attempts: this.opts.retryAttempts ?? 3,
						baseDelayMs: this.opts.retryBaseDelayMs ?? 100,
						name: `embedding:${provider.name}`,
					}),
				);
				return { vector, provider: provider.name };
			} catch (err) {
				const next = this.providers[i + 1]?.name ?? "none";
				recordEmbeddingFallback(provider.name, next);
				if (err instanceof CircuitOpenError) {
					logger.debug({ provider: provider.name }, "Circuit open — skipping provider");
				} else {
					logger.warn(
						{ provider: provider.name, err: (err as Error)?.message },
						"Embedding provider failed — trying next in chain",
					);
				}
			}
		}
		logger.warn({}, "All embedding providers failed — vector search will be skipped");
		return { vector: [], provider: "bm25-only" };
	}

	/** For tests. */
	resetAllBreakers(): void {
		for (const b of this.breakers.values()) b.reset();
	}
}
