# Operations — SLO, metrics, dashboard

`memory serve` is a long-running supervisor. Once `retrieve` sits in
CI-policies or PR-checks, it becomes infrastructure — and infrastructure
needs stated latency budgets, a scrape endpoint, and a starter dashboard.
This page is the contract between the runtime and operators.

## Service-level objectives

| Metric | Target (BM25-only, < 10 k validated entries) | Target (with OpenAI embedding) |
|---|---|---|
| `retrieve` P50 | < 50 ms | < 100 ms |
| `retrieve` P95 | < 200 ms | < 400 ms |
| `retrieve` P99 | < 500 ms | < 1 000 ms |

**Measurement method.** Wall-clock time inside `RetrievalEngine.retrieve()`,
recorded by `agent_memory_retrieve_duration_seconds` on every call. The
histogram lives in `src/observability/metrics.ts` and buckets are chosen
to straddle the P50/P95/P99 targets above so Prometheus can compute
`histogram_quantile` without rolling window surprises.

**SLO scope.** The budget covers the retrieval code path only — it does
**not** include MCP transport, CLI bootstrap, or upstream consumer
overhead. If a consumer reports a slower end-to-end, the first question
is always: does the server-side `retrieve_duration` exceed the P95
target, or is the gap elsewhere?

**Validity window.** Targets assume ≤ 10 000 validated entries and a
hot BM25 index. Beyond that, revisit before declaring regression.
Embedding-enabled targets are doubled because the OpenAI round-trip is
the dominant cost and is network-bound by definition.

## Metrics endpoint

`/metrics` is off by default. Enable it on the supervisor:

```env
# docker-compose.agent-memory.yml (or the equivalent environment)
MEMORY_HTTP_PORT=7077
MEMORY_METRICS_ENABLED=true
```

Then scrape:

```bash
curl http://127.0.0.1:7077/metrics | head -20
```

When either variable is unset, the endpoint returns 404 JSON. That is
deliberate — running the CLI for a one-off `memory retrieve` must never
allocate a metrics registry.

## Mandatory metrics

| Instrument | Name | Labels | Use |
|---|---|---|---|
| Histogram | `agent_memory_retrieve_duration_seconds` | — | Primary SLO signal. |
| Gauge | `agent_memory_db_pool_saturation` | — | Early warning for pool exhaustion (0.0–1.0). |
| Counter | `agent_memory_embedding_fallback_total` | `from`, `to` | Observability for the embedding chain; sudden `to="none"` spikes mean every provider is broken. |
| Counter | `agent_memory_trust_transitions_total` | `from`, `to` | Flow through the trust lifecycle — promotion velocity, poison cascades, archival. |

Default `prom-client` process/Node metrics are also exported under the
`agent_memory_` prefix so there is a single scrape target.

### Minimal Prometheus scrape config

```yaml
scrape_configs:
  - job_name: agent-memory
    metrics_path: /metrics
    static_configs:
      - targets: ["agent-memory:7077"]
```

## Starter dashboard

`docs/operations/grafana-dashboard.json` ships a Grafana 10+ dashboard
with four panels matched to the metrics above:

1. **Retrieve P50 / P95 / P99 (5 m).** `histogram_quantile` over the
   histogram, with horizontal SLO thresholds drawn as annotations.
2. **DB pool saturation.** Single-stat gauge with amber at 0.7 and red
   at 0.9.
3. **Embedding fallbacks.** Stacked counter graph grouped by
   `(from, to)` pair — a healthy service trends flat.
4. **Trust transitions.** Sankey-style stacked counter by transition
   pair — makes poison cascades and promotion rates legible at a glance.

Import it via **Dashboards → New → Import → Upload JSON**. Every panel
targets a Prometheus datasource variable (`${DS_PROMETHEUS}`) so it
adapts to whatever datasource the operator already has wired.

## Dashboard acceptance check

After wiring the datasource on the E2E test environment:

- All four panels must have non-empty series within one scrape
  interval of the first `memory retrieve` call.
- The P99 panel must render a value — not "No data". If it does,
  the supervisor never saw traffic; re-run the retrieve.

## What this file is not

- **Not** a runbook for incident response. When the SLO burns,
  reach for `memory diagnose` and the Grafana dashboard first; a
  runbook lives in the consumer project.
- **Not** a cost model. Embedding calls are the dominant spend, and
  that belongs in the consumer's own observability story.
- **Not** a full metric catalogue. Anything beyond the four roadmap-
  locked instruments is an internal implementation detail and may
  change without a breaking release.
