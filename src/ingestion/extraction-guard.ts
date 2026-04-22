import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);

export interface GuardCheckResult {
	/** Whether extraction is allowed */
	allowed: boolean;
	/** Individual check results */
	checks: GuardCheck[];
	/** Human-readable reason */
	reason: string;
}

export interface GuardCheck {
	name: string;
	passed: boolean;
	reason: string;
}

export interface ExtractionGuardOptions {
	/** Repository root path */
	root: string;
	/** Test command to run (e.g. "npm test", "php artisan test") */
	testCommand?: string;
	/** Quality check command (e.g. "npx tsc --noEmit") */
	qualityCommand?: string;
	/** Skip all checks (for development/testing) */
	skipChecks?: boolean;
}

/**
 * Post-task extraction guard.
 * Blocks knowledge extraction if:
 * 1. Tests fail (if test command configured)
 * 2. Quality tools report errors (if quality command configured)
 *
 * Safety Rule 6: extraction blocked, not just warned.
 */
export class ExtractionGuard {
	constructor(private readonly options: ExtractionGuardOptions) {}

	async check(): Promise<GuardCheckResult> {
		if (this.options.skipChecks) {
			return {
				allowed: true,
				checks: [],
				reason: "Guard checks skipped (development mode)",
			};
		}

		const checks: GuardCheck[] = [];

		// Check for uncommitted changes (indicates work in progress)
		checks.push(await this.checkGitStatus());

		// Run tests if configured
		if (this.options.testCommand) {
			checks.push(await this.runCommand("tests", this.options.testCommand));
		}

		// Run quality checks if configured
		if (this.options.qualityCommand) {
			checks.push(await this.runCommand("quality", this.options.qualityCommand));
		}

		const failedChecks = checks.filter((c) => !c.passed);
		const allowed = failedChecks.length === 0;

		const result: GuardCheckResult = {
			allowed,
			checks,
			reason: allowed
				? `All ${checks.length} guard checks passed`
				: `Extraction blocked: ${failedChecks.map((c) => c.name).join(", ")} failed`,
		};

		if (!allowed) {
			logger.warn({ failedChecks: failedChecks.map((c) => c.name) }, "Extraction guard blocked");
		}

		return result;
	}

	private async checkGitStatus(): Promise<GuardCheck> {
		try {
			const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
				cwd: this.options.root,
			});
			const hasChanges = stdout.trim().length > 0;
			return {
				name: "git-clean",
				passed: !hasChanges,
				reason: hasChanges
					? "Uncommitted changes detected — commit before extraction"
					: "Working directory clean",
			};
		} catch {
			return {
				name: "git-clean",
				passed: true,
				reason: "Not a git repo (skipped)",
			};
		}
	}

	private async runCommand(name: string, command: string): Promise<GuardCheck> {
		try {
			const [cmd, ...args] = command.split(" ");
			await execFileAsync(cmd!, args, {
				cwd: this.options.root,
				timeout: 120_000, // 2 minute timeout
			});
			return { name, passed: true, reason: `${command} passed` };
		} catch (err: unknown) {
			const code = (err as { code?: number | string })?.code ?? "unknown";
			return {
				name,
				passed: false,
				reason: `${command} failed (exit code ${code})`,
			};
		}
	}
}
