# Security Policy

`@event4u/agent-memory` handles database credentials, ingests user code
and prose via its privacy filter, and exposes an MCP surface that agents
can write to. We take reports of security issues in any of those paths
seriously.

## Supported versions

Security fixes are backported to the current minor line. Older minor
lines are best-effort only.

| Version | Supported               | Notes                                |
|---------|-------------------------|--------------------------------------|
| `1.1.x` | ✅ active                | Current line — all fixes land here   |
| `1.0.x` | ⚠️ critical fixes only   | Tagged `1.0.0` 2026-04-22; upgrade to `1.1.x` recommended |
| `0.x`   | ❌ unsupported           | Pre-tag, no guarantees               |

"Supported" means: a confirmed fix ships as a patch release within a
reasonable window after triage, and the `CHANGELOG.md` entry is marked
`[SECURITY]`. It does **not** mean a time-bound SLA.

## Reporting a vulnerability

**Please do not open public issues for security reports.**

Preferred channel — **GitHub private vulnerability reporting**:

1. Open <https://github.com/event4u-app/agent-memory/security/advisories/new>.
2. Describe the issue, the affected version(s), and a minimal
   reproducer if available.
3. We acknowledge within **3 business days**. A triage verdict
   (accepted / needs-more-info / not-a-vulnerability) follows within
   **7 business days**.

Fallback if GitHub advisories are unreachable: open a minimal public
issue titled `security: private report requested — do not publish
details` and we will invite you to a private advisory thread before
anything sensitive is posted.

Please avoid sending exploit details to the general `issues/` tracker
or via the `author` field in `package.json`; those channels are not
monitored for security traffic.

## What is in scope

Confirmed vulnerabilities in the shipping artefacts of this repository:

- The MCP server (`memory mcp`), its 23 tools, and the authorisation
  model between caller and tool handler.
- The CLI (`memory …` / `dist/cli/index.js`), including
  `memory doctor`, `memory migrate`, `memory serve`.
- The retrieval contract (`contract_version: 1`) — any response that
  leaks data a caller should not have been able to see.
- The privacy filter (`src/ingestion/privacy-filter.ts`) — any input
  that bypasses secret redaction, PII stripping, `.env`-line detection,
  or the `<private>…</private>` tag guard.
- The Docker image (`ghcr.io/event4u-app/agent-memory`) and its
  entrypoint (`docker-entrypoint.sh`) — container-escape, privilege
  escalation inside the container, or credentials leaking into image
  layers.
- Database migration logic (`src/db/migrations/`) — anything that
  corrupts or deletes consumer data on a supported upgrade path.

## What is out of scope

- Theoretical DoS against a single local Postgres instance running in
  the consumer's own network. `agent-memory` is not a public service.
- Issues that require an attacker to already control the host, the
  Docker socket, or the Postgres credentials — the trust boundary
  starts **inside** that perimeter.
- Findings against `@event4u/agent-config` symlinks hydrated by
  `postinstall` — report those to the `agent-config` repository.
- Quality-of-result problems in the trust scoring, retrieval ranking,
  or contradiction detection. Those are functional issues, not
  security issues.

## Handling guarantees

What the package **does** by default:

- **Privacy filter** applies before embedding creation and before
  storage. It redacts API keys, AWS keys, JWTs, connection strings,
  PEM private keys, GitHub / npm tokens, high-entropy strings, emails,
  phone numbers, `.env`-style lines, and `<private>…</private>` blocks.
  Source: `src/ingestion/privacy-filter.ts`.
- **Log redaction** — `DATABASE_URL` credentials are masked in the
  `"Database connected"` log line (`postgresql://***@host:port/db`).
- **Quarantine** — every proposed memory enters `trust_status =
  quarantined` and is hidden from `retrieve()` until it passes the
  promotion gate. Retrieval never serves quarantined entries to the
  agent.
- **Access scopes** — entries carry an `access_scope` field
  (`src/security/access-scopes.ts`); retrieval enforces scope before
  surfacing results.

What the package **does not** guarantee:

- End-to-end encryption of data at rest. Protecting the Postgres
  volume and `DATABASE_URL` is the consumer's responsibility.
- Protection against a malicious caller with direct SQL access. Any
  actor who can reach Postgres bypasses the retrieval layer entirely.
- Detection of every possible secret format. The regex + entropy
  filter is deliberately strict but not exhaustive; treat the filter
  as defence-in-depth, not as a gate you can rely on alone.
- Safety of user-supplied embedding providers. If you configure a
  third-party embedding API, its provider terms apply.

## Disclosure policy

- Coordinated disclosure is preferred.
- Once a fix is tagged and published, the advisory is made public with
  a CVE (if assigned), credit to the reporter (unless anonymity is
  requested), and a `[SECURITY]` entry in `CHANGELOG.md`.
- We do not guarantee a bug bounty. Credit in release notes and the
  advisory is our baseline acknowledgement.

## Reporter safe harbour

Researchers acting in good faith under this policy:

- Will not be pursued or threatened with legal action for accessing
  or reporting vulnerabilities against the shipping artefacts.
- Must not exfiltrate data beyond what is necessary to demonstrate
  the issue, nor disrupt services of other consumers.
- Should give us a reasonable window to fix before public disclosure.
  "Reasonable" starts at **90 days** from acknowledgement; longer if
  the issue requires a coordinated ecosystem change.
