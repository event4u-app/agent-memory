/**
 * Ingress-Pfad-Inventar (roadmap IV4).
 *
 * Declarative source of truth for every function that accepts external
 * text (MCP args, CLI input, external file) and is therefore an
 * ingress path for secret-safety purposes. Every listed function must
 * call the named guard symbol on its unsanitised input; every call
 * site of the guards must be referenced here. Bi-directional drift
 * is enforced by `scripts/check-ingress-guards.ts`.
 *
 * When adding a new ingress path:
 *   1. Call `enforceNoSecrets` (service/handler layer) or
 *      `secureEmbeddingInput` (embedding boundary) first, before any
 *      DB write, outbound HTTP call, or derived text.
 *   2. Add an entry here with the file path, function name, and the
 *      guard symbol used.
 *   3. Add a canary matrix entry in the IV3 contract test.
 *
 * Deleting an entry without also removing the corresponding guard
 * call (or vice versa) fails `npm run check:ingress-guards`.
 */

export type IngressGuardSymbol = "enforceNoSecrets" | "secureEmbeddingInput";

export interface IngressPath {
	/** Path relative to repo root, UNIX slashes. */
	readonly file: string;
	/**
	 * Function or method name, for humans. The drift check does not
	 * parse the AST for this identifier — it only verifies that the
	 * file contains a call to `guard`. The name is used in CI output
	 * and in the IV3 matrix mapping.
	 */
	readonly symbol: string;
	/** Ingress surface label, used by audit events + IV3 matrix. */
	readonly surface:
		| "mcp_propose"
		| "mcp_observe"
		| "mcp_observe_failure"
		| "cli_propose"
		| "embedding_retrieve";
	/** Guard function the ingress MUST call in its body. */
	readonly guard: IngressGuardSymbol;
	/** One-line rationale for the file:line audit trail. */
	readonly rationale: string;
}

export const INGRESS_INVENTORY: readonly IngressPath[] = [
	{
		file: "src/trust/promotion.service.ts",
		symbol: "PromotionService.propose",
		surface: "mcp_propose",
		guard: "enforceNoSecrets",
		rationale:
			"Service-layer gate for MCP memory_propose AND CLI `memory propose` — belt-and-suspenders behind both entry points.",
	},
	{
		file: "src/mcp/tool-handlers.ts",
		symbol: "handleObserve",
		surface: "mcp_observe",
		guard: "enforceNoSecrets",
		rationale:
			"memory_observe accepts free-form agent output; reject-by-default prevents silent redaction of SECRET_DETECTED hits.",
	},
	{
		file: "src/mcp/tool-handlers.ts",
		symbol: "handleObserveFailure",
		surface: "mcp_observe_failure",
		guard: "enforceNoSecrets",
		rationale:
			"memory_observe_failure accepts stderr/stack traces — a well-known leak vector for tokens pasted into error messages.",
	},
	{
		file: "src/embedding/fallback-chain.ts",
		symbol: "EmbeddingFallbackChain.embed",
		surface: "embedding_retrieve",
		guard: "secureEmbeddingInput",
		rationale:
			"Every outbound provider call funnels through this method — retrieval queries bypass PromotionService.propose and would otherwise miss the guard.",
	},
] as const;

/**
 * Files that are allowed to contain a guard-symbol reference without
 * being an ingress path: the guard definitions themselves, barrel
 * re-exports, and the inventory itself.
 */
export const GUARD_DEFINITION_FILES: ReadonlySet<string> = new Set([
	"src/security/secret-guard.ts",
	"src/embedding/boundary.ts",
	"src/security/ingress-inventory.ts",
]);
