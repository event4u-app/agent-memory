import { logger } from "../utils/logger.js";

/**
 * Access scope defines what a caller can see/modify.
 * V1: Repository-level isolation (single-tenant per repo).
 * V2: Team-level namespaces, role-based access.
 */
export interface AccessScope {
	/** Repository the caller is operating on */
	repository: string;
	/** Caller identity (agent ID, user ID, or "anonymous") */
	callerId: string;
	/** Optional team namespace for multi-team isolation */
	teamNamespace?: string;
}

/**
 * Validate that a caller can access a specific entry's scope.
 * V1: Simple repository match. V2: team namespace + role checks.
 */
export function canAccess(callerScope: AccessScope, entryRepository: string): boolean {
	// Repository-level isolation: caller can only access entries in their repository
	if (callerScope.repository !== entryRepository) {
		logger.debug(
			{
				caller: callerScope.callerId,
				callerRepo: callerScope.repository,
				entryRepo: entryRepository,
			},
			"Access denied: repository mismatch",
		);
		return false;
	}
	return true;
}

/**
 * Validate that a caller can modify (ingest, validate, invalidate, poison) entries in a scope.
 * V1: Same as canAccess. V2: Could require elevated permissions for poison/invalidate.
 */
export function canModify(callerScope: AccessScope, entryRepository: string): boolean {
	return canAccess(callerScope, entryRepository);
}

/**
 * Build an AccessScope from MCP tool arguments.
 * Extracts repository + caller identity from the request context.
 */
export function buildAccessScope(
	repository: string,
	callerId = "agent:mcp",
	teamNamespace?: string,
): AccessScope {
	return { repository, callerId, teamNamespace };
}

/**
 * Filter entries to only those accessible by the caller.
 */
export function filterByScope<T extends { scope: { repository: string } }>(
	entries: T[],
	callerScope: AccessScope,
): T[] {
	return entries.filter((entry) => canAccess(callerScope, entry.scope.repository));
}

/**
 * Validate scope fields on ingestion — reject entries with missing/invalid scope.
 */
export function validateScope(scope: {
	repository: string;
	files: string[];
	symbols: string[];
	modules: string[];
}): { valid: boolean; errors: string[] } {
	const errors: string[] = [];

	if (!scope.repository || scope.repository.trim().length === 0) {
		errors.push("repository is required");
	}

	// Files must be relative paths (no absolute paths, no ..)
	for (const file of scope.files) {
		if (file.startsWith("/") || file.startsWith("\\") || file.includes("..")) {
			errors.push(`Invalid file path: ${file} (must be relative, no ..)`);
		}
	}

	// Symbols must be non-empty strings
	for (const symbol of scope.symbols) {
		if (!symbol || symbol.trim().length === 0) {
			errors.push("Empty symbol name not allowed");
		}
	}

	return { valid: errors.length === 0, errors };
}
