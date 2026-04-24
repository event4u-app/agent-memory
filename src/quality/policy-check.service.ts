// C2 · runtime-trust — policy engine.
//
// `memory policy check` evaluates the `policies:` block of
// `.agent-memory.yml` (C1) against the current memory state. Exits 0 on
// pass, 1 on violation, 2 on runtime error. The JSON envelope
// (`policy-check-v1`) is validated by tests/contract/policy-check-contract.
//
// Policies v1 (roadmap C2):
//   - fail_on_contradicted_critical
//   - fail_on_invalidated_adr
//   - min_trust_for_type.architecture_decision
//   - block_on_poisoned_referenced
//
// Filtering: when `repository` is set in `.agent-memory.yml`, all queries
// scope to that repository. Otherwise the check is global (CI-wide pools
// that host multiple repositories stay opt-in).

import type { ProjectConfig } from "../config/project-config.js";
import type { PolicyFetchers } from "./policy-check-fetchers.js";

export const POLICY_CHECK_CONTRACT_VERSION = "policy-check-v1";

export type PolicyName =
	| "fail_on_contradicted_critical"
	| "fail_on_invalidated_adr"
	| "min_trust_for_type.architecture_decision"
	| "block_on_poisoned_referenced";

export interface PolicyViolation {
	policy: PolicyName;
	severity: "error";
	entry_id: string;
	entry_type: string;
	entry_title: string;
	trust_status: string;
	trust_score: number;
	message: string;
}

export interface PolicyCheckReport {
	contract_version: typeof POLICY_CHECK_CONTRACT_VERSION;
	status: "pass" | "fail";
	repository: string | null;
	policies_evaluated: PolicyName[];
	summary: {
		violations: number;
		policies_failed: number;
	};
	violations: PolicyViolation[];
}

export type PolicyInput = NonNullable<ProjectConfig["policies"]>;

export interface EntryRow {
	id: string;
	type: string;
	title: string;
	trust_status: string;
	trust_score: number;
	impact_level: string;
}

function emptyReport(repository: string | null): PolicyCheckReport {
	return {
		contract_version: POLICY_CHECK_CONTRACT_VERSION,
		status: "pass",
		repository,
		policies_evaluated: [],
		summary: { violations: 0, policies_failed: 0 },
		violations: [],
	};
}

function toViolation(row: EntryRow, policy: PolicyName, message: string): PolicyViolation {
	return {
		policy,
		severity: "error",
		entry_id: row.id,
		entry_type: row.type,
		entry_title: row.title,
		trust_status: row.trust_status,
		trust_score: Number(row.trust_score),
		message,
	};
}

export interface RunPolicyCheckArgs {
	fetchers: PolicyFetchers;
	policies: PolicyInput;
	repository: string | null;
}

/**
 * Evaluate the configured policies against the current memory state.
 * Disabled policies (`false` / unset) are not listed in
 * `policies_evaluated`; that keeps the JSON envelope honest about what
 * actually ran vs. what was silently skipped.
 *
 * Data access is injected via `PolicyFetchers` so the pure logic is
 * unit-testable without a live Postgres connection.
 */
export async function runPolicyCheck(args: RunPolicyCheckArgs): Promise<PolicyCheckReport> {
	const { fetchers, policies, repository } = args;
	const report = emptyReport(repository);
	const failedPolicies = new Set<PolicyName>();

	if (policies.fail_on_contradicted_critical === true) {
		report.policies_evaluated.push("fail_on_contradicted_critical");
		const rows = await fetchers.fetchContradictedCritical(repository);
		for (const r of rows) {
			report.violations.push(
				toViolation(
					r,
					"fail_on_contradicted_critical",
					`Critical entry has an unresolved contradiction (trust ${Number(r.trust_score).toFixed(2)}).`,
				),
			);
			failedPolicies.add("fail_on_contradicted_critical");
		}
	}

	if (policies.fail_on_invalidated_adr === true) {
		report.policies_evaluated.push("fail_on_invalidated_adr");
		const rows = await fetchers.fetchInvalidatedAdr(repository);
		for (const r of rows) {
			report.violations.push(
				toViolation(
					r,
					"fail_on_invalidated_adr",
					"Architecture decision is invalidated — promote a superseding entry or re-validate.",
				),
			);
			failedPolicies.add("fail_on_invalidated_adr");
		}
	}

	const minAdr = policies.min_trust_for_type?.architecture_decision;
	if (typeof minAdr === "number") {
		report.policies_evaluated.push("min_trust_for_type.architecture_decision");
		const rows = await fetchers.fetchLowTrustAdr(repository, minAdr);
		for (const r of rows) {
			report.violations.push(
				toViolation(
					r,
					"min_trust_for_type.architecture_decision",
					`ADR trust ${Number(r.trust_score).toFixed(2)} < threshold ${minAdr.toFixed(2)}.`,
				),
			);
			failedPolicies.add("min_trust_for_type.architecture_decision");
		}
	}

	if (policies.block_on_poisoned_referenced === true) {
		report.policies_evaluated.push("block_on_poisoned_referenced");
		const rows = await fetchers.fetchPoisoned(repository);
		for (const r of rows) {
			report.violations.push(
				toViolation(
					r,
					"block_on_poisoned_referenced",
					"Poisoned entry still present — rollback callers or archive the entry.",
				),
			);
			failedPolicies.add("block_on_poisoned_referenced");
		}
	}

	report.summary.violations = report.violations.length;
	report.summary.policies_failed = failedPolicies.size;
	report.status = report.violations.length > 0 ? "fail" : "pass";
	return report;
}
