import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * True when the current module is being executed as the top-level script
 * (e.g. `node /app/dist/cli/index.js`, `tsx src/cli/index.ts`, or through
 * a symlink such as `/usr/local/bin/memory` → `/app/dist/cli/index.js`).
 *
 * The naive `process.argv[1] === fileURLToPath(import.meta.url)` check
 * breaks under symlinks because argv[1] is the invocation path (the
 * symlink) while import.meta.url is always the resolved file URL. This
 * manifested in the Docker image where `/usr/local/bin/memory` points
 * to `/app/dist/cli/index.js` — the guard silently skipped CLI parsing
 * and every command exited 0 with no output.
 *
 * Resolving argv[1] via realpathSync before comparing fixes the symlink
 * case without regressing the direct-invocation case (a non-symlink
 * resolves to itself).
 */
export function isMainModule(moduleUrl: string): boolean {
	const argvEntry = process.argv[1];
	if (!argvEntry) return false;
	const modulePath = fileURLToPath(moduleUrl);
	if (argvEntry === modulePath) return true;
	try {
		// Resolve symlinks on both sides. argv[1] may be a symlink (the
		// /usr/local/bin/memory case), and modulePath may contain parent
		// symlinks (e.g. /tmp → /private/tmp on macOS) that don't show up
		// in import.meta.url. Comparing realpaths normalizes both.
		return realpathSync(argvEntry) === realpathSync(modulePath);
	} catch {
		// argv[1] may not exist on disk (e.g. tsx intermediate virtual paths
		// in some runtimes). Falling back to `false` is safe: the only
		// consumer of this helper is a guard that skips side-effect code —
		// worst case it doesn't run when we wanted it to, which is
		// recoverable; the opposite (running when imported for introspection)
		// is not.
		return false;
	}
}
