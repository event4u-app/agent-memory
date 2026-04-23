import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isMainModule } from "../../src/utils/is-main-module.js";

/**
 * Regression test for the Docker symlink bug where
 * `process.argv[1] === fileURLToPath(import.meta.url)` returned false
 * for `/usr/local/bin/memory` → `/app/dist/cli/index.js`, so the CLI
 * exited 0 without parsing argv.
 */
describe("isMainModule", () => {
	let workdir: string;
	let realScript: string;
	let symlinkScript: string;
	const originalArgv = process.argv;

	beforeEach(() => {
		workdir = mkdtempSync(join(tmpdir(), "is-main-module-"));
		realScript = join(workdir, "entry.mjs");
		symlinkScript = join(workdir, "entry-link");
		writeFileSync(realScript, "// placeholder\n");
		symlinkSync(realScript, symlinkScript);
	});

	afterEach(() => {
		process.argv = originalArgv;
		rmSync(workdir, { recursive: true, force: true });
	});

	it("returns true when argv[1] matches the module path directly", () => {
		process.argv = ["/usr/local/bin/node", realScript];
		expect(isMainModule(pathToFileURL(realScript).href)).toBe(true);
	});

	it("returns true when argv[1] is a symlink that resolves to the module", () => {
		process.argv = ["/usr/local/bin/node", symlinkScript];
		expect(isMainModule(pathToFileURL(realScript).href)).toBe(true);
	});

	it("returns false when argv[1] points to an unrelated file", () => {
		const other = join(workdir, "other.mjs");
		writeFileSync(other, "// unrelated\n");
		process.argv = ["/usr/local/bin/node", other];
		expect(isMainModule(pathToFileURL(realScript).href)).toBe(false);
	});

	it("returns false when argv[1] is undefined", () => {
		process.argv = ["/usr/local/bin/node"];
		expect(isMainModule(pathToFileURL(realScript).href)).toBe(false);
	});

	it("returns false when argv[1] references a non-existent path", () => {
		process.argv = ["/usr/local/bin/node", join(workdir, "does-not-exist.mjs")];
		expect(isMainModule(pathToFileURL(realScript).href)).toBe(false);
	});
});
