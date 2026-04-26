# Roadmap — Runtime + Trust

**Branch:** `feat/improve-user-setup` (umgewidmet — Branch-Name wird beim
nächsten Cleanup gerade gezogen; hat historisch keine Bedeutung mehr)
**Vorgänger:** `1.1.0` (Setup-Ära abgeschlossen, siehe
[`archive/improve-system.md`](archive/improve-system.md))

## Leitfrage

> Warum sollte ein Team jemals wieder ohne `agent-memory` arbeiten wollen?

`1.1.0` hat das Produkt konsumierbar gemacht. Diese Roadmap macht es
unvermeidlich. Der Hebel ist nicht mehr „bessere Doku" — er ist
**Runtime-Reife + sichtbarer Trust-Layer + Team-Surface**. Die Roadmap
ist bewusst versions-neutral; welcher Tag welche Tasks trägt,
entscheidet der Release-Prozess.

## 0 · Close `1.1.0` out (Pre-flight, nicht Teil dieser Roadmap)

Drei Punkte aus dem externen Release-Review, die vor dem Start von
Phase A erledigt sein müssen — alle sind User-Aktionen, keine Dev-Arbeit:

1. **GitHub-Release-Body befüllen** mit dem Inhalt aus
   [`agents/drafts/release-notes-1.1.0.md`](../drafts/release-notes-1.1.0.md).
   Der aktuelle Body ist der auto-generierte PR-Einzeiler — das ist
   für ein 68-Datei-Release unwürdig.
2. **Scope-Sprung `1.0.1` → `1.1.0` dokumentieren** (2 Sätze im
   Release-Body). Semver-korrekt (neue CLI-Subcommands, neue
   programmatische Exports, neues Runtime-Verhalten), aber
   undokumentiert bedeutet: `^1.0.0`-pinner bekommen auch reine
   Doc-Fixes nicht ohne Minor-Hub.
3. **PR #4 mergen** (`docs(roadmap): archive improve-system`) — CI
   grün, nur User-Aktion ausstehend.

Zwei Verify-Nachholarbeiten (nicht blockierend, aber vor dem Start
dieser Roadmap sollte Klarheit herrschen):

- **P3-1 nachweisen** — existiert `memory migrate` als eigenes
  CLI-Subcommand in `src/cli/index.ts`? (Dateiliste belegt es nicht.)
  Sichtprüfung: `grep -n "\.command(\"migrate\")" src/cli/index.ts`.
- **P3-3 nachweisen** — ruft `docker-entrypoint.sh` die Migrationen
  idempotent auf? Sichtprüfung: `cat docker-entrypoint.sh`, einmal
  `docker compose up` auf frischer DB + einmal auf migrierter DB —
  zweites darf nicht fehlschlagen.

## Guiding principles

1. **Keine Setup-Politur mehr.** Das Fundament steht. Jede Änderung,
   die primär „das Onboarding-Dokument hübscher macht", gehört nicht
   in diese Roadmap.
2. **Trust ist das Differenzierungsmerkmal.** Nicht MCP, nicht CLI,
   nicht Postgres — austauschbare Primitive. Was nur `agent-memory`
   hat, ist `trust_score` + Decay + Invalidation + Promotion. Jedes
   Feature muss diesen Layer sichtbarer, nachvollziehbarer oder
   team-fähiger machen.
3. **Runtime-Surface muss sich wie Infrastruktur anfühlen.** Kein
   „Tool, das man händisch aufruft" — ein Dienst, den Operatoren
   überwachen, Teams konfigurieren, CI konsultiert.
4. **Jeder Task beantwortet eine der drei Fragen.** Macht es den
   Trust-Layer sichtbarer? Macht es das Produkt team-fähiger? Macht
   es das Produkt schwerer zu ersetzen? Kein dritter Grund zählt für
   diese Roadmap.

## Priority legend

- **[Must]** — blockiert den nächsten Tag, der diese Phase berührt.
  Ohne: kein Release.
- **[Should]** — im Zyklus wenn Kapazität, sonst erster Kandidat für
  den folgenden Patch.
- **[Could]** — bewusst verschoben. Hier geführt, damit Scope nicht
  in Phase C/D rutscht.
- **[Explicitly NOT]** — Negativ-Scope. Der Abschnitt „Explicitly NOT"
  zählt auf, was mehrfach vorgeschlagen wird, aber absichtlich nicht
  passiert.

Nichts wird gedroppt. Priority steuert **Reihenfolge**, nicht
Ownership. Welches Tag welche Tasks trägt, entscheidet der
Release-Prozess anhand der Release-Gates weiter unten.

## Phase-Übersicht

| Phase | Thema | Tasks |
|---|---|---|
| A | Runtime Excellence | 4 |
| B | Trust as a Feature | 4 |
| C | Team Adoption | 4 |
| D | Ecosystem Lock-In | 5 |

Phasen laufen **nicht strikt sequenziell**. A3 (CLI-Split) und B4
(Audit-Schema) sind Vorarbeiten und gehen zuerst; danach können A/B
parallel fahren. C und D setzen auf dem Ergebnis auf.

---

## Phase A — Runtime Excellence

Ziel: die Runtime-Surface so komplettieren, dass das Produkt sich nicht
mehr „gerade so lang genug am Leben hält, um CLI-Calls zu bedienen"
anfühlt. Grundlage ist der in `1.1.0` gelandete Supervisor-Loop
(`memory serve`, [ADR-0002](../adrs/0002-memory-serve-surface.md)) —
darauf baut alles hier auf.

### A1 · Runtime-Surface komplettieren · [Must] · ✅ shipped

> ✅ Shipped — HTTP `/health` + `/ready` (`028ff8a`), `memory migrate up|status`
> (`ce8b8cc`), `memory init` (`7268b26`), `memory doctor --fix` (`02c3f9a`).
> 669+ tests green; E2E-Smoke der Done-Kriterien in Commit-Messages dokumentiert.
> `memory migrate down` bewusst zurückgestellt — niemand hat `down`-Migrationen
> heute, daher würde der Command nur einen "not-implemented"-Fehler emittieren.
> Rollback-Werkzeug wandert in einen eigenen Task, sobald erster echter
> Rollback-Bedarf entsteht.

- **Warum:** `memory serve` ist ein Supervisor-Loop mit Auto-Migrate
  (1.1.0) — technisch ausreichend, emotional noch Tool-artig. Ein
  Operator, der das Ding in k8s oder hinter einen Load-Balancer
  stellen will, erwartet HTTP-Endpoints und nicht `docker exec memory
  health`.
- **Scope:**
  - HTTP `/health` (JSON, gleiches Schema wie CLI `memory health`)
    und `/ready` (200 iff letzte Migration applied UND DB-Pool
    erreichbar) in `memory serve`. Port über `MEMORY_HTTP_PORT`
    (Default `7077`, off wenn Variable leer).
  - `memory init` — One-command bootstrap, schreibt
    `docker-compose.agent-memory.yml`, `.env.agent-memory`
    (aus `.env.example`) und einen `.gitignore`-Eintrag. Idempotent.
    Interaktiv (`--yes` für CI). Kein MCP-Config-Installer hier —
    das ist D2.
  - `memory migrate up|down|status` — `up` ist der heutige
    Default, `down <n>` rollt zurück, `status` listet pending vs.
    applied. `db:migrate` und `db:migrate:rollback` npm-Scripts
    bleiben als Delegatoren.
  - `memory doctor --fix` — die Checks, die heute passiv melden
    (missing-migration, fehlendes pgvector-Extension), bekommen
    optionale Auto-Repair-Aktion. Rot bleibt rot wenn Fix nicht
    möglich (z. B. DB nicht erreichbar).
- **Done:**
  - `curl localhost:7077/health` und `/ready` liefern JSON, Schema
    stimmt mit `memory health` überein.
  - `rm -rf /tmp/x && cd /tmp/x && memory init --yes` → es
    existieren `docker-compose.agent-memory.yml`, `.env.agent-memory`,
    `.gitignore` enthält den Marker.
  - `memory migrate status` druckt applied/pending-Liste als JSON.
  - `memory doctor --fix` repariert eine bewusst kaputtgemachte
    Installation (keine Migration applied) und endet mit exit 0.

### A2 · SLO + Instrumentierung · [Must] · ✅ shipped

> ✅ Shipped — `src/observability/metrics.ts` exportiert die vier
> Pflicht-Metriken; `/metrics` ist in `memory serve` hinter
> `MEMORY_METRICS_ENABLED=true` + `MEMORY_HTTP_PORT` freigeschaltet.
> `docs/operations.md` dokumentiert SLO-Tabelle + Messmethode,
> `docs/operations/grafana-dashboard.json` liefert das Startdashboard.
> Instrumentiert sind `RetrievalEngine.retrieve()` (Histogramm),
> `EmbeddingFallbackChain.embed()` (Fallback-Hops mit `from`/`to`),
> `MemoryEntryRepository.transitionStatus()` (Trust-Transitionen, deckt
> Poison-Cascade mit ab). `db_pool_saturation` ist als Gauge verdrahtet;
> Sampling durch den Supervisor folgt sobald `postgres.js` einen
> stabilen Pool-API freigibt. 685 Tests grün (+11).

- **Warum:** Sobald `memory retrieve` in CI-Policies (C2) oder
  PR-Checks (C3) in den kritischen Pfad kommt, brauchen Operatoren
  Latenz-Zusagen. „Keine Aussage" ist bei einem Tool akzeptabel, bei
  Infrastruktur nicht.
- **Scope:**
  - Dokumentiertes SLO in `docs/operations.md` (neu): P50 < 50 ms,
    P95 < 200 ms, P99 < 500 ms für `retrieve` (bei < 10k validated
    entries, BM25-only). Bei OpenAI-Embedding: P99-Budget
    verdoppelt, dokumentiert.
  - Prometheus-Exporter als optionaler Endpoint in `memory serve`
    (`/metrics`, hinter `MEMORY_METRICS_ENABLED=true`, Default off).
    Pflicht-Metriken: `agent_memory_retrieve_duration_seconds`
    (histogram), `agent_memory_db_pool_saturation`,
    `agent_memory_embedding_fallback_total`,
    `agent_memory_trust_transitions_total{from,to}`.
  - Ein Grafana-Dashboard-JSON in
    `docs/operations/grafana-dashboard.json` als Startpunkt.
- **Done:**
  - `docs/operations.md` enthält SLO-Tabelle + Link zur Messmethode.
  - `curl localhost:7077/metrics` liefert valide Prometheus-Exposition
    mit mindestens den vier Pflicht-Metriken.
  - Dashboard lädt in Grafana 10+, alle Panels haben Daten in der
    E2E-Test-Umgebung.

### A3 · CLI-Split · [Must, Vorarbeit] · ✅ shipped

> ✅ Shipped — `src/cli/index.ts` auf 68 Zeilen geschrumpft (Registry-Loop);
> 18 Commands in `src/cli/commands/*.ts`, geteilter Kontext in
> `src/cli/context.ts`. `docs/cli-reference.md` diff-frei,
> `check:cli-commands` grün, 685+4 Tests grün (neu:
> `tests/unit/cli/registry.test.ts`). Null Verhaltensänderung.

- **Warum:** `src/cli/index.ts` war 928 Zeilen für 18 Commands und
  wuchs im Verlauf dieser Roadmap um mindestens 6 weitere (`explain`,
  `history`, `review`, `export`, `import`). Ohne Split hätte der
  Monolith alles in B und D blockiert — PRs unlesbar, Test-Isolation
  pro Command unmöglich.
- **Scope (umgesetzt):**
  - Verzeichnis `src/cli/commands/` mit einer Datei pro Command.
    Jede exportiert `register(program: Command)`.
  - `src/cli/index.ts` reduziert auf Program-Setup + Registrierungs-Loop.
  - Gemeinsamer Kontext (DB, Repos, Service-Builder, `parseServePort`,
    `probeHealth`) in `src/cli/context.ts` gebündelt. `parseServePort`
    wird aus `index.ts` re-exportiert, damit bestehende Test-Imports
    stabil bleiben.
  - Null Verhaltensänderung. `--help`-Output identisch, alle e2e-Canaries
    grün.
  - `docs/cli-reference.md`-Generator (P4-1) bleibt grün.
- **Done (erreicht):**
  - `src/cli/index.ts` 68 Zeilen (< 100). ✅
  - `npm run docs:cli:check` grün (Output unverändert). ✅
  - Alle 18 Commands haben eigene Datei. ✅
  - `tests/unit/cli/registry.test.ts` validiert Registry-Struktur,
    Modul-Isolation und Sub-Commands (audit/migrate). Per-Command
    Verhaltenstests bleiben wo sie sind (doctor-fix, init, serve-http,
    e2e-Canaries). ✅

### A4 · MCP über HTTP/SSE · [Should] · ✅ shipped

> ✅ Shipped — `src/mcp/sse-server.ts` (GET `/sse` Stream · POST
> `/message` Dispatch · statische Bearer-Auth via
> `MEMORY_MCP_AUTH_TOKEN`), `memory mcp --transport sse [--port
> <n>] [--host <h>]`, `docs/mcp-http.md` mit Client-Configs für
> Claude Desktop (via `mcp-remote`), Cursor, generischer Node-Client.
> `buildMcpServer()` extrahiert, damit stdio und SSE dieselbe
> Tool-Verdrahtung teilen. Tests: 11 Unit-Tests (Auth 401/403,
> Routing, Listener-Roundtrip) + 2 Contract-Tests (full MCP Client
> ↔ Server Roundtrip `listTools` + `callTool` über SSE, plus
> explizite 403-Absicherung).

- **Warum:** Phase C braucht Remote-Zugriff (GitHub-Actions können
  keinen lokalen stdio-Prozess spawnen, Slack-Webhooks erreichen
  kein stdio). MCP-SDK unterstützt SSE-Transport out-of-the-box —
  der Aufwand ist klein, der Blocker-Charakter für C2/C3/C4 groß.
- **Scope:**
  - `memory mcp --transport sse --port <n>` zusätzlich zum
    bestehenden stdio-Transport (Default bleibt stdio). ✅
  - Auth minimal: statisches Bearer-Token aus
    `MEMORY_MCP_AUTH_TOKEN`. Kein mTLS, keine User-DB — das wäre
    Phase-Drift. ✅
  - Dokumentation: `docs/mcp-http.md` mit Beispiel-Client-Config
    für Claude Desktop (SSE), Cursor, generischer MCP-SDK-Client. ✅
- **Done:**
  - `memory mcp --transport sse --port 7078` erreichbar, ein MCP-SDK
    SSE-Client kann Tools auflisten und aufrufen (Contract-Test). ✅
  - Ohne Token: 401. Falscher Token: 403. ✅
  - Contract-Test gegen SSE-Transport beweist Transport-Agnostik —
    derselbe `Server`/`buildMcpServer`-Kern trägt beide Transporte. ✅

---

## Phase B — Trust as a Feature

Ziel: den Trust-Layer von einer internen Berechnung zu einer
sichtbaren, inspizierbaren, auditierbaren Produktoberfläche machen.
Das ist der eigentliche Moat — MCP, CLI und Postgres sind Primitive,
Trust-Scoring + Decay + Promotion + Invalidation ist das, was kein
Vektorstore-Konkurrent hat.

### B4 · Audit-Log-Schema · [Must, Vorarbeit] · ✅ shipped

- **Warum:** `memory history` (B2) und `memory explain` (B1) brauchen
  eine lückenlose Event-Historie pro Entry. Heute gibt es nur den
  aktuellen `trust_score` + einzelne Felder wie `decayed_at`, aber
  kein Event-Log, das „warum sank Score zwischen T1 und T2"
  beantworten kann. Ohne Audit-Log sind B1/B2 Halbwahrheiten.
- **Scope:**
  - Neue Migration: Tabelle `memory_events` mit
    `(id, entry_id, ts, actor, event_type, before jsonb, after jsonb, reason)`.
    Indiziert auf `(entry_id, ts DESC)`.
  - Repository-Schicht: jedes `MemoryEntryRepository.update()`,
    jede Trust-Transition (quarantine→validated, validated→stale,
    etc.), jedes Invalidation-Event, jeder Poison-Cascade schreibt
    ein Event.
  - Retention-Policy: Events folgen derselben Archival-Regel wie
    der zugehörige Entry. Kein separates Purge.
- **Done:**
  - [x] Migration `004_memory_events_trust_extension.ts` deployed
    (IV1 shipped 003 mit `memory_events`; B4 erweitert um
    `before`/`after`/`reason` ohne Tabellen-Rewrite).
  - [x] `TRUST_EVENT_TYPES` union in
    `src/db/repositories/memory-event.repository.ts` — 9 Trust-Events
    (proposed, promoted, quarantined, stale, revived, deprecated,
    superseded, invalidated, archived). Secret-Events bleiben separat.
  - [x] `MemoryEntryRepository` bindet `MemoryEventRepository` (ctor
    + `setEventRepository`) und emittiert auf `create()`,
    `transitionStatus()`, `enforceExpiry()` — Single choke-point statt
    Service-by-Service-Hooks. Fehler im Recorder werden geloggt, aber
    nicht propagiert (Audit-Down darf kein Status-Write killen).
  - [x] `record()` nimmt optional `before` / `after` / `reason` (≤ 512
    chars, server-seitig gekappt); `listByEntry()` + neue
    `countByEntry()` lesen alle B4-Spalten.
  - [x] `memory diagnose --entry <id>` zeigt Event-Count-Breakdown
    pro Entry; human/JSON-Output.
  - [x] 11 neue Unit-Tests (5 in `trust-audit-emission.test.ts`,
    6 in `memory-event.repository.test.ts`) verifizieren:
    Event-Emission auf jeder Transition · before/after passthrough ·
    Reason-Cap · countByEntry-Sortierung · Recorder-Failure-Isolation ·
    Migration-004-Registry + DDL.
  - [x] Full suite: 713 grün · typecheck clean · lint clean ·
    CLI-Docs regeneriert.

### B1 · `memory explain <id>` · [Must] · ✅ shipped

- **Warum:** Ein `trust_score: 0.73` ist heute eine Black-Box-Zahl.
  Für Adoption in Teams muss jeder Score seinen Weg erklären können —
  sonst bleibt der Score ein Glaubensakt, und Glaubensakte werden
  ignoriert.
- **Scope:**
  - Neues CLI-Subcommand `memory explain <id> [--json]`.
  - Output enthält:
    - Score-Breakdown nach Komponenten (Validator-Scores einzeln,
      Recency-Faktor, Usage-Frequency, Provenance-Gewicht).
    - Promotion-History: wann quarantined → validated, welche Gate
      erfüllt, welche nicht.
    - Aktuell anhängende Kontradiktionen (Links auf `memory
      contradictions` aus B3).
    - Decay-Prognose: bei aktueller Nutzung läuft Entry in X Tagen
      in `stale`.
    - „Why not 0.9?" — für jede Komponente, die < max ist, eine
      einzeilige Begründung.
  - Human-Output (Default) + `--json` für Scripting.
  - MCP-Tool `memory_explain` als exakt-gleicher Wrapper.
- **Done:**
  - [x] `src/trust/explain.service.ts` berechnet Score-Breakdown
    (evidence, access-boost, decay, single-evidence-cap), liefert
    Promotion-History aus `memory_events`, Contradictions und
    Decay-Prognose. Zentrale Funktion `explainEntry()` — CLI und
    MCP gehen beide durch diesen Pfad, keine Duplikation.
  - [x] `memory explain <id>` CLI-Subcommand (`src/cli/commands/explain.ts`).
    Human-Output: fünf Abschnitte (Entry · Breakdown · why_not_max
    · History · Contradictions · Decay). `--json` emittiert
    `explain-v1` Envelope.
  - [x] `memory_explain` MCP-Tool (tool-definitions + tool-handlers),
    teilt `explainEntry()` mit der CLI → CLI ≡ MCP bit-genau.
  - [x] JSON-Schema `tests/fixtures/retrieval/explain-v1.schema.json`
    + Golden-Fixture `golden-explain.json` + Contract-Test
    (`tests/contract/explain-contract.test.ts` · 4 assertions:
    golden validiert · live-Output validiert · mit History +
    Contradictions validiert · `additionalProperties: false` greift).
  - [x] 6 Unit-Tests in `tests/unit/explain.service.test.ts` decken
    alle fünf Abschnitte, Single-Evidence-Cap, past-half-life Decay,
    Event-Sortierung, Stale-Flag und Contradiction-Mapping ab.
  - [x] MCP-Tool-Counter 23 → 24 (README, AGENTS.md, no-secret-matrix);
    CLI-Counter 18 → 19 (README, `check:cli-commands`, registry-Test).
  - [x] Full suite: 723 grün · typecheck clean · lint clean ·
    CLI-Docs regeneriert · `docs:cli:check` diff-frei.

### B2 · `memory history <id>` · [Must] · ✅ shipped

- **Warum:** `explain` zeigt den **aktuellen** Zustand. `history`
  zeigt die Entwicklung — wann ist Trust gestiegen/gefallen, wer
  hat was getriggert. Das ist die forensische Oberfläche, die ein
  Team braucht, wenn ein Entry „plötzlich falsch" wirkt.
- **Scope:**
  - Neues CLI-Subcommand `memory history <id> [--json] [--since <ts>]`.
  - Liest `memory_events` (B4), gruppiert nach Tag, ASCII-Timeline.
  - Zeigt für jedes Event: Timestamp, Actor (user/agent/system),
    Event-Type, Before/After-Diff in relevantem Feld.
  - MCP-Tool `memory_history` als Wrapper.
- **Done:**
  - [x] `src/trust/history.service.ts` gruppiert `memory_events`
    in UTC-Tagesbuckets (chronologisch aufsteigend), extrahiert
    status/score-Diffs aus `before`/`after`-JSONB, klassifiziert
    Actor per Präfix (`user:` / `agent:` / `system:` / unknown).
    Zentrale Funktion `buildHistory()` — CLI und MCP teilen sich
    diesen Pfad, keine Duplikation.
  - [x] `memory history <id>` CLI-Subcommand
    (`src/cli/commands/history.ts`). Human-Output: ASCII-Timeline
    pro Tag (`── 2026-01-10 ──` · `HH:MM [kind] event_type actor`
    · Diff-Zeile · Reason). `--json` emittiert `history-v1`-Envelope.
    `--since <ts>` filtert auf `occurred_at >= ts`.
  - [x] `MemoryEventRepository.listByEntry()` akzeptiert
    `{ limit, since }`-Bag zusätzlich zur Legacy-Number-Signatur
    (B1-Caller bleiben unverändert).
  - [x] `memory_history` MCP-Tool teilt `buildHistory()` mit der
    CLI → CLI ≡ MCP bit-genau. `id` required · `since` + `limit`
    optional.
  - [x] JSON-Schema `tests/fixtures/retrieval/history-v1.schema.json`
    + Golden-Fixture `golden-history.json` + Contract-Test
    (`tests/contract/history-contract.test.ts` · 5 assertions:
    golden validiert · live `buildHistory()` validiert ·
    `additionalProperties: false` am Top-Level · `actor_kind`-Enum
    gesperrt · `day`-Pattern `^YYYY-MM-DD$` erzwungen).
  - [x] 8 Unit-Tests in `tests/unit/history.service.test.ts` decken
    Envelope-Shape · Tagesbuckets + aufsteigende Sortierung ·
    Status/Score-Diff-Extraktion · leerer Diff ·
    `classifyActor` · `range.since` passthrough ·
    Nicht-Mutation des Input-Arrays · 1000-Events-Perf (< 100 ms)
    ab.
  - [x] `memory_history` in der no-secret-Output-Matrix
    (skip-begründet: id-basiert, Output leitet sich ausschließlich
    aus `memory_events` ab).
  - [x] MCP-Tool-Counter 24 → 25 (README, AGENTS.md);
    CLI-Counter 19 → 20 (README, `check:cli-commands`, registry-Test);
    CLI-Docs (`docs/cli-reference.md`) für 20 Commands regeneriert.
  - [x] Full suite: 736 grün · typecheck clean · lint clean ·
    `docs:cli:check` diff-frei · `check:cli-commands` grün.

### B3 · Review-Workflows · [Must] · ✅ shipped

- **Warum:** Heute fließt Decay und Invalidation passiv. Niemand
  *schaut sich* die Ergebnisse an, außer beim akuten Retrieval. Ein
  Team braucht einen „Wartungs-Rhythmus" — sonst verrottet der
  Memory-Store wie jedes ungepflegte Wiki.
- **Scope:**
  - `memory review` — interaktiver Modus. Aggregiert offen-stehende
    Fälle: stale-aber-hochwertige Entries (Refresh-Kandidaten),
    Kontradiktionen, poison-Vorschläge. Pro Fall: Accept / Defer /
    Skip. Schreibt Audit-Events.
  - `memory review --weekly [--format json|slack-block-kit]` —
    nicht-interaktiv, maschinenlesbarer Digest. Voraussetzung für
    C4 (Slack-Digest), deshalb hier bereits Format-Parameter.
  - `memory contradictions [--repository X] [--since <ts>]` —
    Drill-down-Command, der aktuell über `memory diagnose` nur
    implizit erreichbar ist.
  - MCP-Tool-Parität: `memory_review`, `memory_contradictions`.
- **Done:**
  - [x] `src/quality/review.service.ts` — reine `buildReviewDigest()`
    emittiert den `review-weekly-v1`-Envelope (summary + cases).
    Case-Kinds: `stale_high_value` · `contradiction` ·
    `poison_candidate`, jeder mit stabilem `case_id`-Präfix
    (`stale:` · `contradiction:` · `poison:`) für den Defer-Filter.
  - [x] `src/quality/review-fetchers.ts` — `fetchStaleHighValue`
    (impact ∈ {high, critical} · trust_status = stale),
    `fetchPoisonCandidates` (trust_score < 0.4 · ≥ 2 Invalidations
    in 30 d), `fetchContradictions` (optional `repository` / `since`)
    teilen SQL zwischen CLI + MCP.
  - [x] `src/quality/review-actions.ts` — `applyReviewAction()`
    persistiert Accept/Defer/Skip als `review_accepted` /
    `review_deferred` / `review_skipped`-Events (auf
    `TRUST_EVENT_TYPES` erweitert). Accept-Defaults: stale → archiviert,
    poison → poisoned, contradiction → keep_both (destruktive
    Strategien bleiben hinter `memory_resolve_contradiction`).
  - [x] `MemoryEventRepository.listCaseIdsByTypeSince()` — filtert
    deferrte Fälle für 7 d (DEFER_WINDOW_MINUTES) aus dem Digest.
  - [x] `memory review` CLI (`src/cli/commands/review.ts`): Default
    = interaktiver Accept/Defer/Skip-Loop über stdin. `--weekly`
    = nicht-interaktiver Digest (`--format json|slack-block-kit`).
  - [x] `memory contradictions` CLI (`src/cli/commands/contradictions.ts`)
    — Drill-down mit `--repository`, `--since`, `--limit`, `--json`.
  - [x] `memory_review` + `memory_contradictions` MCP-Tools teilen
    Fetcher + `buildReviewDigest` mit CLI (`memory_review` liefert
    das Digest; Accept/Defer/Skip bleiben CLI-Only, da MCP kein TTY).
  - [x] `src/quality/review-slack.ts` → Slack-Block-Kit-Payload
    (Header + Summary-Section + eine Section pro Case, unter
    Slack-Cap) — Fundament für C4.
  - [x] JSON-Schema `tests/fixtures/retrieval/review-weekly-v1.schema.json`
    (oneOf über die drei Case-Kinds, `additionalProperties: false`
    auf Envelope + jedem Case) + Golden
    `golden-review-weekly.json`.
  - [x] 6 Unit-Tests (`tests/unit/review.service.test.ts`) decken
    Envelope-Shape · case_id-Präfixe · Defer-Filter +
    `summary.deferred`-Counter · `days_since_validation`-Integer-Runden ·
    leerer Digest · Hint-Qualität ab.
  - [x] 5 Contract-Tests (`tests/contract/review-weekly-contract.test.ts`):
    golden validiert · live `buildReviewDigest` validiert · leerer
    Digest validiert · unknown Top-Level-Field wird abgelehnt ·
    unknown Case-Field wird abgelehnt.
  - [x] `memory_contradictions` in der no-secret-Output-Matrix
    (skip-begründet: filter-basiert, Output leitet sich ausschließlich
    aus `memory_contradictions` ab); `memory_review`-Matrix-Eintrag
    bleibt (admin-op, id-basiert).
  - [x] MCP-Tool-Counter 25 → 26 (README, AGENTS.md);
    CLI-Counter 20 → 22 (README, `check:cli-commands`, registry-Test);
    CLI-Docs (`docs/cli-reference.md`) für 22 Commands regeneriert.
  - [x] Full suite: 747 grün · typecheck clean · lint clean ·
    `docs:cli:check` diff-frei · `check:cli-commands` grün.

---

## Phase C — Team Adoption

Ziel: das Produkt team-native machen. Solo-Agent-Nutzung ist gelöst;
was fehlt, ist die Oberfläche, die `agent-memory` vom „Solo-Gadget"
zum „Team-Artefakt" hebt — projekt-committete Policies, PR-Integration,
wiederkehrende Digests.

### C1 · `.agent-memory.yml` projektlokale Config · [Must] · ✅ shipped

> ✅ Shipped (`5cc8e63`) — `schema/agent-memory-config-v1.schema.json`
> pinnt das Format; `src/config/project-config.ts` lädt und validiert
> YAML beim CLI-Start, `src/config.ts` führt die Präzedenz-Chain
> `CLI-Flag > ENV > YAML > Default` aus. `memory init` schreibt eine
> kommentierte Vorlage, `memory doctor` validiert gegen das Schema und
> fail-fast bei Schema-Verstößen (kein silent-fallback).
> `tests/unit/config-precedence.test.ts` deckt die Chain mit 7 Cases
> ab (Default · YAML-Override · ENV > YAML · Flag > ENV · bad YAML ·
> unbekannte Felder · Repo-Scope). 779 Tests grün.

- **Warum:** Alle team-relevanten Einstellungen (Trust-Thresholds,
  Repository-ID, Policy-Overrides, Decay-Profile) sind heute
  Env-Vars. Env-Vars sind nicht committable und nicht reviewbar —
  ein Team kann seine Governance nicht versionieren. Das ist
  Voraussetzung für C2 (Policies müssen als Diff reviewbar sein).
- **Scope:**
  - Neues Format `.agent-memory.yml` im Projekt-Root, mit
    JSON-Schema (`schema/agent-memory-config-v1.schema.json`).
  - Erkannte Felder (initial): `repository`, `trust.threshold`,
    `retrieval.token_budget`, `embedding.provider`, `decay.profile`,
    `policies.*` (erweiterbar, für C2).
  - Config-Chain (höchste Priorität zuerst): CLI-Flag > ENV > YAML
    > Built-in Default. Heutige ENV-Namen bleiben unverändert.
  - `memory init` (A1) schreibt eine kommentierte Vorlage.
  - `memory doctor` validiert gegen Schema.
- **Done:**
  - `.agent-memory.yml` im Repo-Root wird beim CLI-Start geladen,
    Werte überschreiben Built-in-Default, werden durch ENV/Flag
    überschrieben.
  - Fehlerhafte YAML → klare Fehlermeldung, exit 1 (nicht
    silent-fallback).
  - `npm test` deckt die Präzedenz-Regeln mit ≥ 6 Cases ab.

### C2 · CI Policy-Engine · [Must] · ✅ shipped (in-repo)

> ✅ Shipped in-repo (`5cc8e63`) — `memory policy check [--format
> json|human] [--config <path>]` liefert Exit 0 (pass) / 1 (violations)
> / 2 (config error); `src/quality/policy-check.service.ts` +
> `policy-check-fetchers.ts` trennen SQL von Business-Logik für
> Unit-Tests ohne DB. Vier aktive Policies:
> `fail_on_contradicted_critical`, `fail_on_invalidated_adr`,
> `min_trust_for_type.architecture_decision`,
> `block_on_poisoned_referenced`. Contract pinned via
> `tests/fixtures/retrieval/policy-check-v1.schema.json` +
> `golden-policy-check.json`, 6 Contract- + 5 Unit-Tests (786 grün).
> README-CLI-Count 22 → 23, `docs/cli-reference.md` regeneriert,
> `check:cli-commands` grün.
>
> **Deferred follow-up:** Das separate Action-Repo
> [`event4u-app/agent-memory-action`](https://github.com/event4u-app/agent-memory-action)
> ist **noch nicht angelegt** — braucht explizite User-Permission für
> neues öffentliches Repo. Smoke-Workflow in diesem separaten Repo
> bleibt daher offen. Die CLI-Shape steht und ist vertraglich pinned;
> die Action kann gegen den Golden-Output gebaut werden, ohne diesen
> Code erneut zu berühren.

- **Warum:** „Team-fähig" heißt: Memory-Regeln können einen PR
  blocken. Ohne das ist `agent-memory` bei Reviewern hübsche
  Verzierung, kein Werkzeug. Die Policy-Engine ist der Punkt, an
  dem Trust-Score zu einem Check-Exit-Code wird.
- **Scope:**
  - Neues CLI-Subcommand `memory policy check [--since <ref>]
    [--config .agent-memory.yml]`. Exit 1 bei Policy-Verstoß,
    JSON-Report auf stdout.
  - Policies (Version 1): `fail_on_contradicted_critical`,
    `fail_on_invalidated_adr`, `min_trust_for_type.architecture_decision`,
    `block_on_poisoned_referenced`. Alle als YAML-Feld unter
    `policies:` in `.agent-memory.yml`.
  - Ein separates Repository
    [`event4u-app/agent-memory-action`](https://github.com/event4u-app/agent-memory-action)
    (neues GitHub-Action-Paket) ruft `memory policy check` im
    Container auf, postet strukturierten Check-Run. Policy-Namen +
    Links auf `memory explain` in der Check-Output-Markdown.
  - Drift-Guard: `scripts/check-policy-schema.ts` zur bestehenden
    Drift-Guard-Batterie aus 1.1 hinzugefügt.
- **Done:**
  - `memory policy check` auf einem Repo mit einem bewusst
    invalidierten ADR → exit 1, JSON listet den Entry.
  - `memory policy check` auf sauberem Repo → exit 0.
  - GitHub-Action läuft in einem Smoke-Test-Workflow im neuen
    Action-Repo grün.

### C3 · PR-Review-Integration · [Should] · ✅ shipped (in-repo)

> ✅ Shipped in-repo — `memory invalidate --from-git-diff` liefert
> jetzt den stabilen `invalidate-git-diff-v1`-Envelope
> (`src/invalidation/git-diff-envelope.ts`). Der Orchestrator trackt
> pro Entry `{id, title, action, reason, trigger}`, die CLI wrappt
> das Ergebnis mit `repository` aus `.agent-memory.yml`. Contract
> pinned via
> `tests/fixtures/retrieval/invalidate-git-diff-v1.schema.json` +
> `golden-invalidate-git-diff.json`, 7 Contract-Tests; 786 grün.
>
> **Deferred follow-up:** PR-Comment-Rendering + Idempotenz-Marker
> leben im externen Action-Repo (siehe C2). Diese Roadmap liefert den
> stabilen Input (JSON pro Entry, Contract-Version pinned) — der
> Renderer ist 20 Zeilen TypeScript auf der Action-Seite, sobald das
> Repo existiert.

- **Warum:** Der sichtbarste Team-Moment. Ein PR kommt rein,
  `agent-memory` kommentiert „dieser PR invalidiert 4 Memory-Entries,
  stärkt 2 Architektur-Entscheidungen, widerspricht ADR-018" — das
  ist der Punkt, an dem Teams merken, dass das Tool für sie arbeitet.
- **Scope-Entscheidung (in dieser Task zu treffen, nicht vorab):**
  - **Variante 1 — GitHub-Action** (günstig, stateless): C2-Action
    erweitert um PR-Comment-Rendering. Kein eigener Server.
  - **Variante 2 — GitHub-App** (teurer, mächtiger): eigener Backend-
    Service, reagiert auf Webhook, nutzt `memory` via MCP-HTTP (A4).
    Erlaubt persistente Memory-PR-Links und interaktive Buttons.
  - **Empfehlung:** Variante 1 zuerst, Variante 2 erst evaluieren,
    wenn Nutzerfeedback nach App schreit.
- **Scope:**
  - In der GitHub-Action: `memory invalidate --from-git-diff
    --from-ref <base>` läuft, Ergebnis als PR-Comment gerendert mit
    Deep-Links auf `memory explain`.
  - Idempotenz: bestehender Comment wird bei Re-Run geupdatet,
    nicht dupliziert (GitHub-Comment-ID-Marker).
- **Done:**
  - Smoke-PR in einem Test-Repo erzeugt Comment mit drei Sektionen
    (invalidates / strengthens / contradicts).
  - Zweiter Push überschreibt Comment, dupliziert nicht.

### C4 · Weekly-Digest · [Could] · ✅ shipped

> ✅ Shipped — `examples/weekly-digest/` enthält README + `digest.yml`
> (GitHub-Actions-Cron auf `slackapi/slack-github-action@v1.27.0`,
> ruft `memory review --weekly --format slack-block-kit`, skippt den
> Slack-Step bei leerem Digest via `case_count`-Guard). Output-Shape
> pinned durch `review-weekly-v1` (bereits in B3 geshipt). Keine neue
> Runtime-Komponente, reine Dokumentation + Template — in Übereinstimmung
> mit dem Scope-Versprechen „rein Documentation + Example".

- **Warum:** Adoption-Reminder ohne eigene Infrastruktur. Wenn ein
  Team einmal pro Woche einen Slack-Post sieht mit „3 stale
  entries, 2 contradictions, 1 poison candidate", bleibt das Tool
  präsent. Ohne solchen Push: vergessen in 2 Wochen.
- **Scope:**
  - Output-Format `slack-block-kit` in `memory review --weekly`
    (bereits in B3 vorbereitet).
  - Kein eigener Bot. Dokumentierter Pfad: GitHub-Actions-Cron +
    `slackapi/slack-github-action` pusht das JSON an einen
    Webhook. Template-Workflow in
    [`examples/weekly-digest/`](../../examples/weekly-digest/).
- **Done:**
  - Template-Workflow erzeugt einen Slack-Post, der die drei
    Kategorien aus B3 anzeigt.
  - Keine neue Runtime-Komponente im Hauptpaket — dieser Task ist
    rein „Documentation + Example".

---

## Phase D — Ecosystem Lock-In

Ziel: die Gravitation erhöhen. Ein Tool ohne Ökosystem verliert,
selbst wenn es technisch besser ist. Hier nicht „mehr Doku" — hier
**echte Artefakte**: Export-Import-Paritaet, gepflegte Integrations-
Snippets, lebende Reference-Repos, Migrations-Pfade von Konkurrenten.

### D1 · Datenportabilität · [Must] · ✅ shipped

> ✅ Shipped — `memory export` + `memory import` als JSONL-Stream
> (`src/export/{types,serialize,redaction,export-service,import-service,parse,index}.ts`,
> `src/cli/commands/{export,import}.ts`). Contract + Schema in
> `tests/fixtures/retrieval/{export-v1.schema.json,golden-export.jsonl}`
> mit 9 Contract-Tests (inkl. byte-identischem Roundtrip). III3-Redaction
> läuft als Second-Pass im Export-Pfad, Import verifiziert `redaction.version`
> und re-scannt `applied=false`-Zeilen (belt-and-braces). CLI-Registry-Test
> auf 25 Commands erweitert. 811 tests green.

- **Warum:** „Institutional memory" ohne Export-Pfad ist
  Vendor-Lock-in mit dem falschen Vorzeichen — das Team verliert,
  nicht der Anbieter. Außerdem ist D4 (Migration von Konkurrenten)
  nur möglich, wenn der Import-Pfad existiert. Backup/Restore fällt
  als Beifang ab.
- **Scope:**
  - `memory export [--since <ts>] [--repository <id>]` — schreibt
    JSONL nach stdout. Pro Zeile ein Entry + alle zugehörigen
    Events (B4) + Evidence-Refs. Schema-lockiert in
    `export-v1.schema.json`.
  - `memory import <file>` — liest JSONL, validiert gegen Schema,
    importiert idempotent (Entry-ID als Primary-Key, Update-bei-
    Konflikt optional via `--on-conflict update|skip|fail`,
    Default `fail`).
  - Contract-Test: export eines Entry + re-import in frische DB
    ergibt byte-identischen Re-Export.
  - Doku: `docs/portability.md` mit Use-Cases (Backup, Migration
    zwischen DB-Hosts, Trennung Team-Stände).
- **Done:**
  - Roundtrip-Test grün (export → drop-db → migrate → import →
    re-export → diff leer). _Contract-Test pins byte-identical
    roundtrip on the golden fixture; DB-seeded round-trip läuft
    als Integration-Test gegen lokale DB via `npm test` (mock-repos
    decken den Serialisierungspfad, DB-seeded round-trip ist als
    E2E-Follow-up aufgeschoben)._
  - `memory import` auf JSONL mit manuell korrumpierter Zeile →
    klarer Fehler, kein Partial-State. _`ImportParseError` wirft
    mit Zeilennummer bevor irgendein DB-Write erfolgt; Ajv-Pass
    erfolgt ebenfalls up-front._

### D2 · First-class Integration-Snippets · [Must] · ✅ shipped

> ✅ Shipped — fünf Integrationen in `examples/integrations/` mit
> eigenem `smoke.sh` pro Verzeichnis: `claude-desktop`, `cursor`,
> `github-actions`, `docker-sidecar-laravel`, `docker-sidecar-django`.
> `.github/workflows/integrations.yml` entdeckt Verzeichnisse
> dynamisch via `find … smoke.sh` und fährt pro Integration einen
> Matrix-Job. `docs/integrations.md` ist Ein-Sprung-Stelle.
> Stack-Neutralität bewiesen durch das Laravel (PHP/Symfony-Process)
> + Django (Python/subprocess) Pärchen auf identischem Sidecar-
> Pattern. `vscode-continue` und `gitlab-ci` bleiben Opt-in-
> Folgearbeit, nicht kritischer Pfad.

- **Warum:** Feedback #1 hat klar gemacht: kein Composer-Paket, kein
  Installer — aber **maintained Snippets** sind Pflicht. Ein Team,
  das `agent-memory` mit Claude Desktop, Cursor oder einem
  CI-Runner verdrahten will, soll eine Copy-Paste-Anleitung finden,
  die **getestet** wird und nicht driftet.
- **Scope:**
  - Verzeichnis `examples/integrations/` mit je einer README pro
    Integration: `claude-desktop/`, `cursor/`, `vscode-continue/`,
    `github-actions/`, `gitlab-ci/`, `docker-sidecar-laravel/`,
    `docker-sidecar-django/`.
  - Jede Integration ist ein lauffähiges Beispiel + Smoke-Test in
    CI (mindestens `memory health` über die jeweilige Transport-
    Schicht).
  - `docs/integrations.md` als Index-Seite, linkt auf die
    Unterverzeichnisse. README.md der Hauptrepo linkt nur dort hin,
    nicht auf einzelne Integrationen — vermeidet Drift.
- **Done:**
  - Mindestens fünf der sieben Integrationen existieren und haben
    Smoke-Tests in `.github/workflows/integrations.yml`.
  - `docs/integrations.md` ist die einzige Ein-Sprung-Stelle.
  - Beispiele für PHP/Laravel und Python/Django beweisen
    Stack-Neutralität (Hard Invariant).

### D3 · Reference-Repo `with-agent-memory` · [Should] · ✅ shipped

> ✅ Shipped — Repo `event4u-app/with-agent-memory` published
> ([github.com/event4u-app/with-agent-memory](https://github.com/event4u-app/with-agent-memory),
> initial commit `9420d7a`). Inhalt: `docker-compose.yml` (postgres +
> agent-memory sidecar, default `IMAGE_TAG=:main` damit `docker compose
> up -d` ohne Setup grün läuft), `.agent-memory.yml` als C1-Beispiel,
> `smoke.sh` mit health → propose → promote → retrieve Round-Trip
> (verifiziert end-to-end gegen `:main`, exit 0), `README.md` mit
> 4-Step-Quickstart und Trust-Lifecycle-Erklärung (`filtered=1` ist
> by-design für Fresh-Floor-Entries), und
> `.github/workflows/weekly-drift.yml` als wöchentlicher Canary gegen
> `agent-memory:main`. README-Link aus dem agent-memory-README aktiviert
> (genau eine Stelle, in der "60-second quick-start"-Sektion).

- **Warum:** `examples/with-agent-config/` (aus Feedback #2) ist
  das Gegenstück für `@event4u/agent-config`. Für `agent-memory`
  existiert kein lebendes Reference-Setup. Ein Minimal-Repo, das
  `docker compose up` → funktionales Setup liefert, senkt die
  Evaluation-Hürde radikal.
- **Scope:**
  - Neues Repo `event4u-app/with-agent-memory` (öffentlich).
  - Inhalt: `docker-compose.yml` (postgres + memory-sidecar),
    `.agent-memory.yml` (C1), ein Smoke-Skript, das `memory
    propose` / `memory promote` / `memory retrieve` durchläuft,
    und eine README mit 4-Schritte-Quickstart.
  - CI in diesem Repo prüft wöchentlich gegen `main` von
    `agent-memory` — bricht früh, wenn Contract-Drift eintritt.
- **Done:**
  - `git clone && cd with-agent-memory && docker compose up && ./smoke.sh`
    → exit 0.
  - Wöchentliche CI grün.
  - README-Link aus `agent-memory`-README auf dieses Repo (genau
    eine Stelle, nicht an mehreren Orten).

### D4 · Migrations-Importer · [Could] · ✅ shipped

> ✅ Shipped — `memory import --from mem0-jsonl <file> --repository <id>`
> via Mapper in `src/ingestion/importers/mem0.ts` (pure function, no I/O).
> CLI-Flags `--from`, `--repository`, `--initial-trust` (default `0.5`,
> validated `[0,1]`), `--quarantine` (status-Override). Provenance:
> `promotion_metadata.imported_from = "mem0"`, plus `mem0_id` und
> `mem0_raw` für lossless re-mapping. Default-Status `validated` (mit
> Trust-Score-Cap unterhalb der Retrieval-Schwelle), `--quarantine`-Flag
> als Opt-in für Sicherheits-Skeptiker. Belt-and-braces: Mapper-Output
> läuft durch dieselbe Ajv-Pass gegen `export-v1.schema.json` wie native
> Imports, dann durch `verifyNoSecretLeak()`. Golden-Fixture
> `tests/fixtures/importers/mem0/sample.jsonl` (5 Records: memory/text/
> content-Varianten, mit/ohne metadata, mit/ohne categories), 10 Tests
> in `tests/unit/importers/mem0.test.ts` (Mapping-Invarianten + Schema-
> Kompatibilität + Error-Pfade). Migrations-Doku in
> `docs/migration/mem0.md` mit Mapping-Tabelle, Trust-Policy und
> expliziten "What you lose"-Abschnitt.

- **Warum:** Ein Team, das heute Mem0 / Zep / Chroma-mit-eigener-
  Konvention nutzt, wechselt nicht, wenn es seinen Bestand
  wegwerfen muss. Ein dokumentierter Import-Pfad von **einem**
  Konkurrenten ist der Ice-Breaker.
- **Scope:**
  - `memory import --from <format>` mit Formaten: `agent-memory-v1`
    (native, aus D1), `mem0-jsonl`, `zep-session-export`. Je
    Fremdformat ein Mapper in `src/ingestion/importers/`.
  - Trust-Start-Score konfigurierbar (`--initial-trust 0.5`),
    Provenance wird auf `imported_from:<format>` gesetzt.
  - Doku: `docs/migration/` mit je einer Seite pro Konkurrent
    (Scope-Grenzen explizit: Was wird migriert, was nicht).
- **Done:**
  - Mindestens `mem0-jsonl` funktioniert end-to-end mit Golden-
    Fixture in `tests/integration/importers/`.
  - `memory import --from mem0-jsonl <file>` ergibt Entries mit
    Provenance `imported_from:mem0`.
  - Migrations-Doku nennt Grenzen, keine Marketing-Versprechen.

### D5 · Deprecation-Playbook · [Must] · ✅ shipped

> ✅ Shipped — `docs/deprecation-policy.md` (operational playbook on top of
> ADR-0003), `scripts/check-deprecation-changelog.ts` drift-guard (scans
> `tests/fixtures/retrieval/*-v*.schema.json` + `schema/*.schema.json` for
> `deprecated: true`, requires filename stem in top `## [...]` block of
> `CHANGELOG.md`), cross-linked from `docs/compatibility-matrix.md`, wired
> into `.github/workflows/docs-checks.yml` as the `deprecation-changelog`
> job, regression covered by `tests/unit/check-deprecation-changelog.test.ts`
> (5 tests, clean + missing + stale + older-block scenarios).

- **Warum:** Mit dieser Roadmap kommen mehrere `*-v1.schema.json`
  dazu (explain, history, review-weekly, export, config). Ohne klare
  Deprecation-Regel droht dasselbe Problem wie bei 1.0→1.1: jedes
  Schema-Update ist eine Überraschung. Dieser Punkt verhindert
  technische Schuld, bevor sie entsteht.
- **Scope:**
  - Dokument `docs/deprecation-policy.md`: Semver-Regeln für
    Schema-Changes, Mindest-Support-Zeitraum (2 Minor-Versionen),
    Deprecation-Marker im Schema (`deprecated: true`,
    `removeIn: "2.0"`), CHANGELOG-Template-Eintrag.
  - Contract-Test-Erweiterung: jedes Schema-File, das `deprecated`
    markiert, muss in `CHANGELOG.md` im aktuellen Release-Block
    genannt sein — sonst CI rot.
- **Done:**
  - `docs/deprecation-policy.md` existiert, verlinkt aus
    `docs/contract-stability.md` (aus 1.1).
  - Drift-Guard `scripts/check-deprecation-changelog.ts` im
    `quality`-Job.

---

## Explicitly NOT in scope

Dinge, die in der Analyse oder im Feedback aufgetaucht sind und
bewusst nicht in diese Roadmap gehören — mit einem Satz, warum.

- **Composer-Paket / Native Language-Bindings** — Setup-Ära. Wer
  Sidecar nutzt, kriegt Sprach-Neutralität geschenkt. Erneut
  evaluieren, wenn > 3 Anfragen im Issue-Tracker.
- **MCP-Config-Auto-Installer (`memory mcp-install`)** — ersetzt
  durch D2 (maintained Snippets). Installer driften, Snippets
  werden getestet.
- **README-Verkürzung auf 150 Zeilen** — keine Arbeit an der
  README als Selbstzweck. README folgt den hier entstehenden
  Artefakten (Operations-Doku, Integrations-Index, Reference-Repo),
  nicht umgekehrt.
- **Eigenes Embedding-Modell / Finetuning** — kein Moat. Provider-
  Stubs (Gemini/Voyage) bleiben so lange Stubs, bis ein konkreter
  Nutzer zieht.
- **Web-UI / Dashboard-App** — explizit raus. Das Produkt ist
  CLI + MCP. Observability läuft über Prometheus/Grafana (A2),
  nicht über eine eigene UI-Schicht.
- **Multi-Tenancy / User-Auth in MCP-HTTP** — A4 bleibt bei
  Single-Token-Bearer. Echte Multi-Tenant-Auth ist eine eigene
  Produktentscheidung, keine Drift in diese Roadmap.
- **Telemetrie-Opt-in / Usage-Tracking** — bewusst deferred.
  Zu viele Produktfragen (Datenschutz, Opt-in-Flow,
  Metrik-Auswahl), bevor der konkrete Nutzen klar ist.

---

## Release-Gates (versions-neutral)

Harte Kriterien, die die Tasks dieser Roadmap an konkrete Tags
binden. Die Zuordnung Gate → Tag macht der Release-Prozess, nicht
dieses Dokument.

- **Vor jedem Tag, der eine Phase dieser Roadmap ausliefert:**
  - Close-1.1.0 (Punkt 0) vollständig abgearbeitet (Release-Notes,
    Scope-Begründung, P3-1/P3-3 verifiziert).
  - Alle `[Must]`-Tasks der in diesem Tag ausgelieferten Phasen
    sind `Done` mit ihrem jeweiligen Done-Kriterium.
  - CI im `main` ist grün über alle Jobs (unit, integration,
    contract, drift, quality). Kein `.only`, kein `test.skip`.
  - CHANGELOG-Block vollständig: jeder neue CLI-Command, jedes
    neue MCP-Tool, jedes neue Schema, jede neue ENV-Var
    dokumentiert. CHANGELOG-Guard greift; manuelle Review vor
    dem Tag-Push.
  - Kontrakt-Integrität: alle bestehenden `*-v1.schema.json`
    unverändert. Neue Schemata mit Golden-Fixture + Drift-Guard.
  - Migrations-Pfad dokumentiert — keine neuen Breaking-Defaults.
    `memory migrate up` von einer Installation der Vorgänger-Minor
    endet grün, ohne manuelle Eingriffe.

- **Zusätzlich, sobald B3 ausgeliefert ist:** Dogfooding-Loop aktiv
  — dieses Repo hat `.agent-memory.yml`, einen laufenden
  `memory review --weekly` in CI, Weekly-Digest (sobald C4 da ist)
  postet in einen internen Channel. „Wir eat our own dogfood" ist
  Gate, kein Slogan.

---

## Deferred (nicht in dieser Roadmap, aber nicht vergessen)

Punkte, die bewusst rausgehalten werden, aber auf dem Radar
bleiben. Nicht in `[Should]` verschieben, um Scope-Drift zu
verhindern.

| Punkt | Strategische Einordnung | Grund der Verschiebung |
|---|---|---|
| GitHub-App (C3 Variante 2) | Nach Action-Feedback | Eigener Betrieb, erst nach Variante-1-Feedback. |
| Multi-Tenant-Auth für MCP-HTTP | Eigener Release-Track | Produktentscheidung, nicht nur Tech. |
| Telemetrie-Opt-in | Eigener Release-Track | Produktfragen offen, Nutzen unklar. |
| Migrations-Importer Zep/Chroma | Nach mem0-Beweis | D4 mit mem0 reicht als Ice-Breaker; andere Formate folgen Nachfrage. |
| Weekly-Digest als First-Party-Bot | Nie | Bleibt Doku + Example (C4). |
| Web-UI / Dashboard-App | Nie | Out-of-scope per Strategie. |
| Eigenes Embedding-Training | Nie | Kein Moat, zu teuer, falscher Hebel. |

---

## Cross-links

- [ADR-0001 · Agent-Memory-Architektur](../adrs/0001-agent-memory-architecture.md)
- [ADR-0002 · `memory serve`-Surface](../adrs/0002-memory-serve-surface.md)
  (referenziert aus Phase A)
- [ADR-0003 · Contract Version Bumps](../adrs/0003-contract-version-bumps.md)
  (referenziert aus B/D)
- [Roadmap 1.1 (archiviert)](archive/improve-system.md)
- [`@event4u/agent-config` · Retrieval-Contract](archive/from-agent-config/road-to-retrieval-contract.md)
- [Glossar](../../docs/glossary.md)

---

## Arbeitsprinzipien

Nicht als Regel — als Erinnerung an den Kalibrierungs-Moment nach
dem 1.1-Release.

1. **Kein Feature ohne Kontrakt.** Jedes neue CLI-Output oder
   MCP-Response landet als `*-v1.schema.json` mit Golden-Fixture
   im `tests/fixtures/contracts/`, bevor der Code gemerged wird.
2. **Kein Feature ohne Opt-out.** Neue ENV-Vars haben einen
   Default, der ein bestehendes Setup nicht verändert.
3. **Kein Feature ohne Dogfood.** Dieses Repo benutzt das Feature
   in CI oder lokal, bevor es „done" heißt.
4. **Kein Schema-Bump ohne Deprecation-Pfad.** D5 ist nicht
   kosmetisch — es ist die einzige Versicherung gegen 1.0→1.1-
   Überraschungen.
5. **Sidecar-First.** Jede Integration, die in D2 landet, muss
   unabhängig vom Host-Sprache funktionieren. Wenn ein Integration-
   Snippet nur mit Node funktioniert, gehört er nach `examples/node/`,
   nicht nach `examples/integrations/`.
