# GitHub Actions integration

## What

Uses `@event4u/agent-memory` as a **CLI tool** inside GitHub Actions
workflows. No MCP, no stdio — this is the "call `memory` from a bash
step" path. Covers the three realistic CI touchpoints:

| Call | Use case in CI |
|---|---|
| `memory health` | Pre-flight gate: fail fast if the backend or the secret is wrong. |
| `memory retrieve` | Pull prior context before an agent/step does work. |
| `memory ingest` | Capture a finding — test failure root-cause, incident notes — into memory at the end of a run. |

## When to use

- You already have an agent-memory backend reachable from GitHub
  (self-hosted sidecar, managed Postgres, cloud Postgres with the
  pgvector extension). CI passes `DATABASE_URL` as a secret.
- You want CI-discovered knowledge to feed into the same memory store
  your editor agents read from, or vice versa.
- Multi-repo setups writing into one backend — this is what the
  `--repository` flag on `memory ingest` is for.

Do **not** use this pattern to stand up a throwaway Postgres per CI
run and call it "memory". Each run would start with zero state, which
defeats the point — memory is explicitly state _across_ runs.

## Copy-paste

Copy [`ci-agent.example.yml`](ci-agent.example.yml) into
`.github/workflows/` in your repo. Set the repository (or
organization) secret `AGENT_MEMORY_DATABASE_URL` to your Postgres
connection string.

Trigger manually: **Actions → Example — agent-memory in CI → Run
workflow**. Supply a topic to recall; optionally a finding to ingest
at the end.

### Notable design choices in the template

- **`memory health` runs first**, before any work. A wrong secret or
  an unreachable backend should fail the job in ~2 seconds, not after
  a 15-minute build.
- **`ingest` is guarded by `if: inputs.finding != ''`** so the
  workflow stays idempotent — running it for retrieval only does not
  pollute memory with empty entries.
- **`--repository ${{ github.repository }}`** tags the entry with the
  source repo so multi-repo backends can disambiguate findings.
- **`--created-by "github-actions/${{ github.workflow }}"`** writes
  a stable actor string, helpful for later provenance queries.

## Smoke check

[`smoke.sh`](smoke.sh) is a **static** check — it never runs the
example workflow (that would require a hosted Postgres). It validates:

1. `ci-agent.example.yml` exists and is non-empty.
2. It declares a `jobs:` block and checks out the repo with
   `actions/checkout`.
3. It invokes the `memory` CLI at least once.
4. **Every `memory <subcommand>` referenced in the file is a real CLI
   command** — discovered by grepping the snippet and running
   `memory <cmd> --help` against each. This is the real value: a
   rename or deletion of a CLI command breaks this smoke _before_ a
   stale copy-paste reaches a user.

Run locally after `npm run build`:

```bash
MEMORY_BIN="node $(pwd)/dist/cli/index.js" \
  bash examples/integrations/github-actions/smoke.sh
```

Exit 0 = template references real commands. CI runs this in
[`.github/workflows/integrations.yml`](../../../.github/workflows/integrations.yml)
on every PR touching this folder.

## What the smoke does NOT test

- Running the example workflow end-to-end — requires a hosted Postgres
  reachable from GitHub-hosted runners, which is deployment-specific.
- GitHub-Actions-native YAML validity. `actionlint` catches more
  (step-expression syntax, reusable-workflow contracts, etc.) but is
  too heavy a dep for an integration smoke. A genuinely malformed
  workflow will fail the first time GitHub loads it; this smoke
  catches the more common regression — a broken CLI reference after
  an internal rename.
- Correctness of the `DATABASE_URL` secret or `pgvector` being
  installed on the target Postgres. Those live in
  [`docs/consumer-setup-generic.md`](../../../docs/consumer-setup-generic.md).
