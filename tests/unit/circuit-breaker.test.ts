import { describe, expect, it } from "vitest";
import { CircuitBreaker, CircuitOpenError } from "../../src/infra/circuit-breaker.js";

describe("CircuitBreaker", () => {
	it("passes through calls when closed", async () => {
		const breaker = new CircuitBreaker({ name: "t" });
		const result = await breaker.execute(async () => 42);
		expect(result).toBe(42);
		expect(breaker.currentState).toBe("closed");
	});

	it("trips after threshold consecutive failures", async () => {
		const breaker = new CircuitBreaker({ name: "t", failureThreshold: 3 });
		const failing = () => Promise.reject(new Error("boom"));
		for (let i = 0; i < 3; i++) {
			await expect(breaker.execute(failing)).rejects.toThrow("boom");
		}
		expect(breaker.currentState).toBe("open");
	});

	it("fails fast when open (CircuitOpenError)", async () => {
		const breaker = new CircuitBreaker({
			name: "t",
			failureThreshold: 1,
			cooldownMs: 60_000,
		});
		await expect(breaker.execute(() => Promise.reject(new Error("x")))).rejects.toThrow("x");
		await expect(breaker.execute(() => Promise.resolve(1))).rejects.toBeInstanceOf(
			CircuitOpenError,
		);
	});

	it("transitions to half-open after cooldown", async () => {
		const breaker = new CircuitBreaker({
			name: "t",
			failureThreshold: 1,
			cooldownMs: 10,
		});
		await expect(breaker.execute(() => Promise.reject(new Error("x")))).rejects.toThrow();
		await new Promise((r) => setTimeout(r, 15));
		expect(breaker.currentState).toBe("half-open");
	});

	it("recovers to closed on half-open success", async () => {
		const breaker = new CircuitBreaker({
			name: "t",
			failureThreshold: 1,
			cooldownMs: 10,
		});
		await expect(breaker.execute(() => Promise.reject(new Error("x")))).rejects.toThrow();
		await new Promise((r) => setTimeout(r, 15));
		const result = await breaker.execute(async () => "ok");
		expect(result).toBe("ok");
		expect(breaker.currentState).toBe("closed");
	});

	it("re-opens on half-open failure", async () => {
		const breaker = new CircuitBreaker({
			name: "t",
			failureThreshold: 1,
			cooldownMs: 10,
		});
		await expect(breaker.execute(() => Promise.reject(new Error("x")))).rejects.toThrow();
		await new Promise((r) => setTimeout(r, 15));
		await expect(breaker.execute(() => Promise.reject(new Error("y")))).rejects.toThrow("y");
		expect(breaker.currentState).toBe("open");
	});

	it("reset() clears state", async () => {
		const breaker = new CircuitBreaker({ name: "t", failureThreshold: 1 });
		await expect(breaker.execute(() => Promise.reject(new Error("x")))).rejects.toThrow();
		expect(breaker.currentState).toBe("open");
		breaker.reset();
		expect(breaker.currentState).toBe("closed");
	});
});
