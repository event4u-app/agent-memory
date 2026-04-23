// A1 · runtime-trust — `memory init` bootstrap contract.
//
// Exercises runInit against a disposable tmpdir to verify the four
// guarantees from the roadmap: idempotence, force-overwrite, gitignore
// marker handling, and the JSON report shape.

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	applyGitignoreBlock,
	DOCKER_COMPOSE_TEMPLATE,
	ENV_TEMPLATE,
	GITIGNORE_MARKER_END,
	GITIGNORE_MARKER_START,
	renderInitSummary,
	runInit,
} from "../../src/cli/init.js";

const tmpRoots: string[] = [];

async function makeTmp(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "memory-init-"));
	tmpRoots.push(dir);
	return dir;
}

afterEach(async () => {
	// Directories are small; leave them behind on failure for inspection.
	tmpRoots.length = 0;
});

describe("runInit", () => {
	it("creates compose, env, and gitignore on a fresh directory", async () => {
		const cwd = await makeTmp();
		const report = await runInit({ cwd });

		expect(report.status).toBe("ok");
		expect(report.cwd).toBe(cwd);
		expect(report.files.map((f) => f.status)).toEqual(["created", "created", "created"]);

		const compose = await readFile(join(cwd, "docker-compose.agent-memory.yml"), "utf8");
		expect(compose).toBe(DOCKER_COMPOSE_TEMPLATE);
		expect(compose).toContain("ghcr.io/event4u-app/agent-memory:latest");

		const env = await readFile(join(cwd, ".env.agent-memory"), "utf8");
		expect(env).toBe(ENV_TEMPLATE);

		const ignore = await readFile(join(cwd, ".gitignore"), "utf8");
		expect(ignore).toContain(GITIGNORE_MARKER_START);
		expect(ignore).toContain(".env.agent-memory");
		expect(ignore).toContain(GITIGNORE_MARKER_END);
	});

	it("is idempotent on a second run (all three files skipped)", async () => {
		const cwd = await makeTmp();
		await runInit({ cwd });
		const second = await runInit({ cwd });

		expect(second.files.map((f) => f.status)).toEqual(["skipped", "skipped", "skipped"]);
		expect(second.files[2].reason).toBe("marker already present");
	});

	it("overwrites existing files when --force is passed", async () => {
		const cwd = await makeTmp();
		await writeFile(join(cwd, "docker-compose.agent-memory.yml"), "stale", "utf8");
		await writeFile(join(cwd, ".env.agent-memory"), "stale", "utf8");

		const report = await runInit({ cwd, force: true });

		expect(report.files[0].status).toBe("created");
		expect(report.files[1].status).toBe("created");

		const compose = await readFile(join(cwd, "docker-compose.agent-memory.yml"), "utf8");
		expect(compose).toBe(DOCKER_COMPOSE_TEMPLATE);
	});

	it("appends the gitignore block without clobbering existing entries", async () => {
		const cwd = await makeTmp();
		await writeFile(join(cwd, ".gitignore"), "node_modules\ndist/\n", "utf8");

		const report = await runInit({ cwd });

		expect(report.files[2]).toEqual({
			path: join(cwd, ".gitignore"),
			status: "updated",
			reason: "marker appended",
		});
		const ignore = await readFile(join(cwd, ".gitignore"), "utf8");
		expect(ignore.startsWith("node_modules\ndist/\n")).toBe(true);
		expect(ignore).toContain(GITIGNORE_MARKER_START);
	});

	it("handles a gitignore that lacks a trailing newline", async () => {
		const cwd = await makeTmp();
		await writeFile(join(cwd, ".gitignore"), "dist/", "utf8");
		await runInit({ cwd });
		const ignore = await readFile(join(cwd, ".gitignore"), "utf8");
		expect(ignore.split("\n")[0]).toBe("dist/");
		expect(ignore).toContain(GITIGNORE_MARKER_START);
	});
});

describe("applyGitignoreBlock", () => {
	it("marks the block as unchanged when the start marker is present", () => {
		const existing = `node_modules\n${GITIGNORE_MARKER_START}\n.env.agent-memory\n${GITIGNORE_MARKER_END}\n`;
		const { content, changed } = applyGitignoreBlock(existing);
		expect(changed).toBe(false);
		expect(content).toBe(existing);
	});

	it("appends a block to an empty file without leading newline", () => {
		const { content, changed } = applyGitignoreBlock("");
		expect(changed).toBe(true);
		expect(content.startsWith(GITIGNORE_MARKER_START)).toBe(true);
	});
});

describe("renderInitSummary", () => {
	it("reports every file with a status glyph", () => {
		const out = renderInitSummary({
			status: "ok",
			cwd: "/tmp/x",
			files: [
				{ path: "/tmp/x/docker-compose.agent-memory.yml", status: "created" },
				{ path: "/tmp/x/.env.agent-memory", status: "skipped", reason: "already exists" },
				{ path: "/tmp/x/.gitignore", status: "updated", reason: "marker appended" },
			],
		});
		expect(out).toContain("+ /tmp/x/docker-compose.agent-memory.yml");
		expect(out).toContain("= /tmp/x/.env.agent-memory (already exists)");
		expect(out).toContain("~ /tmp/x/.gitignore (marker appended)");
	});
});
