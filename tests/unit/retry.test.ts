import { describe, expect, it, vi } from "vitest";
import { withRetry } from "../../src/infra/retry.js";

describe("withRetry", () => {
	it("returns result on first success", async () => {
		const fn = vi.fn().mockResolvedValue("ok");
		const result = await withRetry(fn, { attempts: 3, baseDelayMs: 1 });
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("retries transient failures up to `attempts`", async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error("t1"))
			.mockRejectedValueOnce(new Error("t2"))
			.mockResolvedValue("recovered");
		const result = await withRetry(fn, {
			attempts: 3,
			baseDelayMs: 1,
			jitter: false,
		});
		expect(result).toBe("recovered");
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it("throws last error after exhausting attempts", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("permanent"));
		await expect(
			withRetry(fn, { attempts: 2, baseDelayMs: 1, jitter: false }),
		).rejects.toThrow("permanent");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("stops retrying when shouldRetry returns false", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("4xx"));
		await expect(
			withRetry(fn, {
				attempts: 5,
				baseDelayMs: 1,
				shouldRetry: () => false,
			}),
		).rejects.toThrow("4xx");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("invokes onRetry callback per retry", async () => {
		const onRetry = vi.fn();
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error("a"))
			.mockResolvedValue("ok");
		await withRetry(fn, {
			attempts: 3,
			baseDelayMs: 1,
			onRetry,
			jitter: false,
		});
		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
	});
});
