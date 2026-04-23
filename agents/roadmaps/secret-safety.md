# Roadmap — Secret Safety

**Track:** eigenständig. Lebt parallel zu Feature-Roadmaps, hat eigene
Release-Cadence. Tags werden vom User gesetzt, nicht von dieser Roadmap
vorgeschrieben.
**Cross-link:** `runtime-trust.md` verweist in den Release-Gates auf
diesen Track — ein 1.2-Release darf erst getaggt werden, wenn Phase I
hier abgeschlossen ist (siehe § Release-Gates unten).

## Leitsatz

> Sicherheit darf nicht davon abhängen, dass der aufrufende Agent sich
> "erinnert", keine Zugangsdaten zu speichern. Der Memory-Store muss
> die Grenze aktiv ziehen, durchsetzen und beweisbar machen.

Konkret: `agent-memory` darf sich merken, **dass** GitHub-API-Calls
einen Token aus `.env` lesen. Er darf sich **nicht** den Token selbst
merken — weder im Klartext, noch im Embedding, noch im Log, noch im
Export. Wenn ein Agent versucht, ein Secret zu persistieren, gibt
`agent-memory` einen strukturierten Fehler zurück und zwingt den
Agent, die Erinnerung umzuformulieren.

## Warum eigenständig

- **Scope-Schutz:** Secret-Safety ist kein Feature, sondern eine
  Quer­schnitts-Invariante. Sie kreuzt Ingestion, Embedding, Logging,
  Retrieval, Export, Audit — jede Feature-Roadmap würde den Punkt
  verwässern.
- **Ship-Tempo:** Phase I schließt Löcher, die heute existieren. Die
  Roadmap muss unabhängig shippen können, ohne auf einen Feature-
  Release zu warten.
- **Review-Klarheit:** Ein Security-Auditor soll ein einziges File
  lesen können, um den Zustand der Store-Grenze zu verifizieren.

## Arbeitsprinzipien

1. **Reject-by-default bei Detection.** Jeder Ingress-Pfad (propose,
   observe, import, hook) gibt bei erkanntem Secret einen
   strukturierten Fehler zurück — kein stilles Redact, kein "best
   effort". Opt-out ausschließlich über explizite Config, nie Default.
2. **Filter läuft VOR jedem Side-Effect.** Vor DB-Write, vor
   Embedding-Call, vor Log-Output, vor Provider-HTTP-Request. Kein
   "der Filter redigiert gleich nachher".
3. **Defense in depth.** Eine einzige Filter-Zeile darf nicht der
   einzige Schutz sein. Logger-Redaction, Embedding-Boundary-Guard,
   Retrieval-Output-Filter, DB-Scan sind zusätzliche Netze.
4. **Beweisbarkeit per CI.** Jede Schutzschicht bekommt einen
   Drift-Guard + Canary-Test, der in CI aktiv versucht, ein Secret
   durchzuschleusen. Kein Red-Team-Simulakrum — echte Fixtures.
5. **Keine Marketing-Claims.** Die Roadmap verspricht keine
   Compliance-Zertifizierungen (GDPR, HIPAA, SOC2) — sie liefert
   technische Schutzschichten. Compliance-Statements sind eine eigene
   Entscheidung mit eigenem Scope.

## Prioritäts-Legende

- `[Must, Foundation]` — Voraussetzung für andere Tasks dieser
  Roadmap. Zuerst.
- `[Must]` — Blockiert den nächsten Ingress-berührenden Release.
- `[Should]` — Defense-in-Depth-Schicht, idealerweise in derselben
  Release-Welle wie die `Must`-Blöcke.
- `[Could]` — Härtung ohne akute Blocker-Wirkung.

Keine Release-Zahlen hier. Der User entscheidet beim Taggen, was
wann ausgeliefert wird — die Roadmap sortiert nur nach
Abhängigkeits-Ordnung.

---

## 0 · Bekannte Lücken (Audit-Stand)

Dokumentierter Ist-Zustand, auf den die Phasen reagieren. Quelle:
grep-Verifikation im Worktree am Tag dieses Files.

- **L1 — Propose-Pfad ungefiltert.** `memory_propose` (MCP) ruft
  `promotionService.propose()` direkt mit `content` / `summary` auf.
  `memory propose` (CLI) ebenso. Siehe `src/mcp/tool-handlers.ts`
  (case `memory_propose`) und `src/cli/index.ts` (`.command("propose")`).
  Das ist heute der High-Volume-Pfad für Coding-Agents.
- **L2 — Logger ohne Redaction.** `src/utils/logger.ts` konstruiert
  `pino` ohne `redact`-Config. An mehreren Stellen (z. B.
  `src/ingestion/pipeline.ts`) landet Kandidaten-Text in
  `logger.info({ ... })` — bei Log-Level `debug` auch der
  un­ge­filterte Raw-Input.
- **L3 — Embedding-Provider-Boundary nicht erzwungen.** `config.embedding`
  kennt OpenAI / Gemini / Voyage mit API-Keys. Es gibt heute keinen
  Code-Pfad-Guard, der verhindert, dass un­gefilterter Entry-Text an
  einen externen Provider geschickt wird. Nur der Pipeline-Pfad
  filtert vorab.
- **L4 — Retrieval-Output nicht nachgefiltert.** Wenn ein Entry aus
  Zeiten vor dem Filter oder aus einem künftigen Import-Pfad mit einem
  Secret im Text existiert, liefert `retrieve` ihn unverändert aus.
- **L5 — Import-Pfad in Planung.** `runtime-trust.md` D1 plant
  JSONL-Import. Ohne diese Roadmap würde der Import Secrets aus
  Alt-Beständen einspielen.
- **L6 — Keine Reject-Semantik.** Der heutige Filter redigiert still
  mit `[REDACTED:...]`. Es gibt weder ein Error-Schema noch ein
  Audit-Event, das dokumentiert, dass ein Secret erkannt wurde.

---

## Phase I — Universal Ingress Enforcement

> ✅ **Shipped** — I1 (`ebb2cef`), I2 (`468c2d2`), I3 (`e542459`),
> I4 (`8fc00a7`). Full suite 316/316 green.

Ziel: keine Eintrittsstelle zum Memory-Store bleibt ungefiltert. Ein
Secret darf nicht einmal kurzzeitig in der DB, im Embedding-Cache
oder im Log stehen — die Abwehr passiert vor jedem Side-Effect.

### I1 · Propose-Pfad schließen (MCP + CLI) · [Must, Foundation] · ✅ shipped

- **Warum:** Heute die Haupt-Lücke (L1). `memory_propose` und CLI-
  `propose` sind die High-Volume-Ingress-Pfade für Agent-Nutzung.
  Ohne diesen Fix ist jede andere Schutzschicht Kosmetik.
- **Scope:**
  - Zentraler Guard `src/security/secret-guard.ts` (neues Modul) mit
    einer Funktion `enforceNoSecrets(text, context)`. Gibt
    `{ clean: string } | { violation: SecretViolation }` zurück,
    aber **wirft nicht** — Aufrufer entscheidet.
  - Jede Ingress-Funktion — `promotionService.propose()`,
    `memoryEntryRepository.create()`, alle `memory_observe`-artigen
    MCP-Tools, künftiger `memory import` — ruft den Guard an genau
    einer Stelle im Flow auf, **vor** Classification, **vor**
    DB-Write.
  - Default-Verhalten: `SecretViolation` → Aufrufer gibt Error
    zurück. Kein silent redact.
  - Einheitliches Error-Schema (siehe I4) statt Free-Text-Exceptions.
- **Done:**
  - grep `src/` nach `propose|observe|ingest` zeigt für jeden
    Ingress-Pfad einen vorherigen Aufruf von `enforceNoSecrets`.
  - Integrations-Test feuert jedes der sieben Secret-Muster
    (API-Key, AWS, JWT, Connection-String, Private-Key, GitHub-Token,
    npm-Token) je einmal gegen CLI-`propose` und MCP-`memory_propose`
    — beide antworten mit strukturiertem Error, kein Entry in DB.
  - Legacy-Pipeline-Filter (`applyCandidatePrivacyFilter` in
    `pipeline.ts`) wird umgebaut: erst `enforceNoSecrets`, dann
    PII-/Env-/Entropy-Redaction für die zulässigen Klassen.

### I2 · Logger-Redaction · [Must, Foundation] · ✅ shipped

- **Warum:** L2. Selbst mit I1 bleibt das Risiko, dass ein
  un­ge­filterter Raw-Input via `logger.info({ entry })` in stdout
  oder einen Log-Aggregator fließt. `pino` hat eingebaute Redaction —
  wir nutzen sie heute nicht.
- **Scope:**
  - `src/utils/logger.ts` ergänzt `pino({ redact: { paths: [...],
    censor: "[REDACTED:log]" } })`. Pfade mindestens:
    `*.content`, `*.summary`, `*.details`, `*.embeddingText`,
    `*.title`, `*.raw`, `*.apiKey`, `*.token`, `*.password`,
    `*.authorization`, `*.headers.authorization`, `*.url`
    (für DSNs).
  - Zusätzlich: generischer Serializer, der Strings mit Match-auf-
    SECRET_PATTERNS vor dem Emit redigiert — Schutz gegen
    `logger.info("msg with secret")` ohne strukturiertes Feld.
  - `LOG_LEVEL=debug` bleibt gefahrlos nutzbar.
- **Done:**
  - Unit-Test provoziert `logger.info({ entry: { content:
    "GITHUB_TOKEN=ghp_..." } })` und fängt den Output via
    Log-Capture — stdout enthält `[REDACTED:log]` oder
    `[REDACTED:secret]`, nicht den Roh-Token.
  - Unit-Test feuert `logger.info("bearer ghp_...")` als String —
    Output ebenfalls redigiert.
  - Manuell: `LOG_LEVEL=debug npm run mcp:start` und ein
    `memory_propose` mit Test-Token → Log-Stream sauber.

### I3 · Embedding-Call-Boundary · [Must] · ✅ shipped

- **Warum:** L3. Setzt I1 voraus (sonst schützt die Boundary nur den
  Scanner-Pfad). Belt-and-suspenders: selbst wenn irgendwann ein
  neuer Ingress-Pfad I1 vergisst, verhindert die Boundary, dass
  un­ge­filterter Text an OpenAI / Gemini / Voyage ausgeliefert wird.
- **Scope:**
  - Alle Embedding-Provider-Clients (lokal, OpenAI, Gemini, Voyage)
    laufen durch einen einzigen Wrapper `src/embedding/boundary.ts`,
    der vor jedem `embed(text)` `enforceNoSecrets(text, "embedding")`
    aufruft.
  - Verstoß bei Embedding-Call → hartes Throw mit Context
    (welcher Provider, welche Entry-ID wenn verfügbar), plus
    Audit-Event. Dieser Pfad darf werfen, weil er nach der
    Ingress-Phase liegt — wenn hier etwas rutscht, ist das ein Bug,
    nicht User-Input.
  - Einheitlicher Code-Pfad auch für `provider=local` / `bm25-only`
    (Symmetrie, damit der Drift-Guard funktioniert).
- **Done:**
  - Keine Provider-Client-Datei importiert die Low-Level-HTTP-Funktion
    ohne Umweg über `boundary.ts` (CI-Check, siehe IV4).
  - Integrations-Test injiziert ein Secret in einen „hypothetisch
    durchgerutschten" Entry, ruft Embedding-Pfad direkt auf → wirft,
    protokolliert Audit-Event.

### I4 · Reject-by-Default + Error-Schema · [Must, Foundation] · ✅ shipped

- **Warum:** L6. Ohne strukturierten Fehler kann ein Agent nicht
  systematisch reagieren. Die ganze Idee — „zwingt den Agent zum
  Um­for­mulieren" — funktioniert nur, wenn der Fehler maschinen­
  lesbar ist und klar sagt, **was** erkannt wurde.
- **Scope:**
  - JSON-Schema `schemas/secret-violation-v1.schema.json` mit:
    `code` (enum, z. B. `SECRET_DETECTED`, `PII_DETECTED`,
    `ENV_VALUE_DETECTED`), `pattern` (Pattern-Name, nicht
    Regex-Body), `offsetRanges` (Start/End-Indices im Input,
    ohne den Secret-Inhalt selbst), `suggestion` (human-readable:
    „Replace the token value with a reference like
    `${GITHUB_TOKEN}` before proposing.").
  - CLI-Output: Exit-Code 3 („Ingress-Policy-Violation"), stderr
    folgt Schema als JSON bei `--json`, sonst formatierter Text.
  - MCP-Response: MCP-Error mit Code `INGRESS_POLICY_VIOLATION`,
    `data`-Feld trägt das Schema-Objekt.
  - Opt-out: `MEMORY_SECRET_POLICY=redact` (ENV) oder
    `policies.secret_handling: redact` in `.agent-memory.yml`
    (aus `runtime-trust.md` C1). Default bleibt **reject**.
  - Redact-Pfad gibt trotzdem ein Audit-Event aus (siehe IV1), damit
    der Opt-out sichtbar bleibt.
- **Done:**
  - Golden-Fixture `tests/fixtures/contracts/secret-violation-v1/`
    mit mindestens drei Kategorien (API-Key, Connection-String,
    High-Entropy) — jeder Fall verifiziert CLI-Exit-Code,
    stderr-JSON und MCP-Error-Struktur.
  - `MEMORY_SECRET_POLICY=redact` durchgeführter Test zeigt
    Redact-Verhalten + Audit-Event.
  - Docs: `docs/secret-safety.md` erklärt Fehler-Codes und
    Agent-Reaktionsmuster („paraphrase", „use reference", „abort").

---

## Phase II — Detection Quality

Ziel: die Pattern-Batterie härten, damit I1/I3 nicht leer laufen.
Ein Guard, der nur bekannte Muster kennt, skaliert nicht mit der
Realität der Provider-Landschaft.

### II1 · Erweiterte Patterns · [Must] · ✅ shipped

> Delivered on `feat/improve-user-setup`:
> - catalog + refactor + 43 pattern tests — `59a768b`
> - docs generator + CI drift-guard — pending commit

- **Warum:** Heute sieben Pattern-Klassen. Moderne Stacks bringen
  mindestens 15 Provider mit eigenen Token-Formaten. Ohne diese
  Abdeckung ist Reject-by-default Theater.
- **Scope:**
  - Pattern-Katalog in `src/security/secret-patterns.ts` (neu), nach
    Provider benannt, versioniert. Mindestabdeckung:
    - Slack: `xox[baprs]-` Präfixe
    - Stripe: `sk_live_`, `pk_live_`, `rk_live_`, `whsec_`
    - SendGrid: `SG\.`
    - Twilio: `AC[0-9a-f]{32}`, Auth-Token-Format
    - Azure: Storage-Keys, SAS-Tokens, Connection-Strings
    - Google Cloud: Service-Account-JSON (`"type": "service_account"` +
      `"private_key"`), API-Keys (`AIza[0-9A-Za-z_-]{35}`)
    - OpenAI: `sk-proj-`, `sk-`, Organization-IDs
    - Anthropic: `sk-ant-`
    - GitLab: `glpat-`, `gldt-`, Runner-Tokens
    - Bitbucket: App-Passwords, Repository-Access-Tokens
    - Heroku: `HRKU-`, Platform-API-Tokens
    - DigitalOcean: Personal-Access-Tokens
    - Cloudflare: Global-API-Key-Format, API-Tokens
    - SSH-Keys: OpenSSH-Private-Keys (`-----BEGIN OPENSSH PRIVATE KEY-----`)
    - Generische Basic-Auth: `https?://[^:@]+:[^@]+@`
  - Jede Pattern-Definition: `{ name, regex, confidence,
    falsePositiveHints }`. `confidence: "high"` → immer Reject;
    `confidence: "medium"` → Reject außer bei bekannten Allow-List-
    Mustern (siehe II4).
  - Generator-Skript, das aus dem Katalog eine Markdown-Tabelle
    für `docs/secret-safety.md` baut — sonst driftet die Doku.
- **Done:**
  - `tests/unit/security/secret-patterns.test.ts` feuert für jedes
    dokumentierte Pattern ein positives + ein negatives Beispiel.
  - `docs/secret-safety.md` Tabelle ist aus dem Katalog generiert
    (Drift-Guard in CI).

### II2 · Entropy-Heuristik kalibrieren · [Should] · ✅ shipped

- **Warum:** Die heutige Schwelle 4.0 mit Länge ≥ 20 im Quote-Kontext
  ist sinnvoll, aber un­evaluiert. Sie darf weder False-Positives
  produzieren (UUIDs, Hash-Sums) noch echte High-Entropy-Secrets
  durchlassen. Ohne Messung weiß niemand, wo sie steht.
- **Scope:**
  - Corpus-Fixture `tests/fixtures/entropy-corpus/` mit mindestens
    100 echten Non-Secret-Strings (UUIDs, Git-SHAs, Hashes, Base64-
    Binaries kleiner Größe) und 100 synthetischen Secrets.
  - Eval-Skript `scripts/eval-entropy-threshold.ts` druckt
    Precision/Recall-Matrix für mehrere Schwellen (3.5, 4.0, 4.5,
    5.0).
  - Ergebnis-Dokument `docs/security/entropy-calibration.md` mit
    begründeter Schwellen-Wahl.
- **Done:**
  - 108 Non-Secret- und 101 Secret-Samples im Corpus; Eval-Matrix
    in `docs/security/entropy-calibration.md` begründet 4.5 (F1
    0.838, nur 3 FP gegenüber 15 bei 4.0).
  - Threshold + Min-Length zentral in `src/config.ts`
    (`MEMORY_ENTROPY_THRESHOLD`, `MEMORY_ENTROPY_MIN_LENGTH`),
    konsumiert von `secret-guard` und `privacy-filter`.
  - `npm run entropy:eval` / `entropy:eval:check` regenerieren den
    Doc-Block; CI-Drift-Guard analog zu II1 offen (Nightly-Artefakt
    folgt separat, Doc-Diff ist das Minimum-Gate).

### II3 · Canary-Token-Tests · [Must] · ✅ shipped

- **Warum:** Die einzige verlässliche Aussage „unser Guard ist dicht"
  kommt aus einem Test, der aktiv versucht, ein Secret durch­zu­schleu­
  sen. Unit-Tests gegen Pattern-Liste sind notwendig, nicht hinreichend.
- **Scope:**
  - End-to-End-Test `tests/e2e/secret-safety.test.ts` spielt gegen
    eine frisch migrierte Test-DB:
    1. CLI-`propose` mit Canary („ghp_canary_ABCDEF..."),
       erwartet Exit-Code 3, kein Entry.
    2. MCP-`memory_propose` mit Canary, erwartet MCP-Error.
    3. MCP-`memory_observe` mit Canary, ebenfalls Reject.
    4. `memory import` (sobald existent) mit Canary-Zeile,
       erwartet Abbruch mit Partial-State-Abwehr.
    5. Nach jedem Test: `SELECT * FROM memory_entries WHERE ...
       content LIKE '%ghp_canary%'` liefert 0 Zeilen.
    6. Nach jedem Test: Log-Capture enthält keinen Canary-Klartext.
  - Dieselben Canaries laufen im Contract-Test gegen
    Embedding-Boundary (I3) — Provider-Mock verifiziert, dass er
    nie einen Canary-String im Request-Body sieht.
- **Done:**
  - Vollständige Matrix grün.
  - PR-Gate: wenn ein Ingress-Pfad ohne entsprechenden
    Canary-Test hinzugefügt wird, CI rot (IV4 greift).

### II4 · Allow-List für Non-Secrets · [Should] · ✅ shipped

- **Warum:** Fehlalarme erziehen Agents, den Filter zu umgehen.
  Commit-SHAs, UUIDs, Base64-encoded Content-Hashes sind legitim,
  dürfen aber Entropy-Heuristik triggern.
- **Scope:**
  - Allow-List in `src/security/allowlist.ts` mit klar benannten
    Mustern (`GIT_SHA_40`, `UUID_V4`, `SEMVER`, `SRI_HASH` — npm
    integrity / Subresource-Integrity-Format deckt die
    ursprünglich geplante `NPM_PACKAGE_HASH`-Variante ab; `GIT_SHA_7`
    unterschritt die 20-Zeichen-Mindestlänge und wurde gestrichen).
  - Match passiert **nach** Pattern-Detection und ausschließlich
    gegen den residualen `HIGH_ENTROPY_DETECTED`-Treffer: wenn der
    quote-innere String vollständig von einem Allow-List-Pattern
    gedeckt ist, wird dieses einzelne Detection-Item fallen gelassen.
    Catalog-Matches werden nie neutralisiert.
  - Dokumentation in `docs/security/entropy-calibration.md` listet
    jedes Muster mit Begründung; Unit-Tests in
    `tests/unit/allowlist.test.ts` belegen Entropy + Matching +
    Negative-Case pro Eintrag.
- **Done:**
  - Corpus-Regression (`tests/unit/entropy-corpus.test.ts`) grün:
    alle 106 Non-Secrets passieren die Residual-Heuristik bei 4.5;
    FPs im Eval-Matrix von 3 → 0.
  - Strukturell nicht-entscheidbare Fälle (Base64 von kurzem
    ASCII-Plaintext) sind in
    `tests/fixtures/entropy-corpus/residual-fps.txt` dokumentiert
    und werden weiter blockiert — explizite „Known-Limitation"
    statt schmutzigem Allow-Listing.
  - Allow-List-Wiring in `secret-guard.ts` (Ingress-Guard) und
    `privacy-filter.ts` (Storage-Filter) sind identisch; die Mirror-
    Implementierung trägt einen Kommentarverweis zwischen beiden.

---

## Phase III — Defense in Depth

Ziel: zusätzliche Schutzschichten für die Fälle, die Phase I / II
nicht abdecken — Alt-Bestände, Re-Export, seitliche Leak-Kanäle.

### III1 · DB-Legacy-Scan · [Must] · ✅ shipped

- **Warum:** Jedes Setup, das vor dieser Roadmap existierte, kann
  Secrets in alten Entries tragen. Ohne Scan bleibt der Altbestand
  ein stiller Leak-Kanal.
- **Scope:**
  - Neues CLI-Subcommand `memory audit secrets [--fix]`. Iteriert
    über `memory_entries`, wendet den Pattern-Katalog auf
    `title`, `summary`, `details`, `embedding_text` an.
  - Ohne `--fix`: Report mit Entry-IDs, getroffenem Pattern-Namen,
    Kategorie-Confidence. Kein Klartext im Report.
  - Mit `--fix [--mode=redact|archive]`:
    - `redact` schreibt `[REDACTED:secret]` in die betroffenen
      Felder, Audit-Event pro Änderung.
    - `archive` setzt Entry auf `quarantined` + `tombstoned`,
      kein Inhalt wird geändert.
  - Kein automatischer Delete — das ist eine Entscheidung, die ein
    Operator treffen muss.
  - Embedding-Re-Compute nach Redact läuft über die Boundary (I3).
- **Done:**
  - `memory audit secrets` auf einem Setup mit bewusst eingepflanzten
    Entries findet 100 %, Report enthält nichts im Klartext.
  - `memory audit secrets --fix --mode=redact` setzt Felder um,
    schreibt Audit-Events, Retrieval liefert danach den redigierten
    Stand.

### III2 · Retrieval-Output-Filter · [Should] · ✅ shipped

- **Warum:** Selbst mit I1 und III1 bleibt ein Restrisiko — ein Entry,
  der während eines temporären Bugs oder im Upgrade-Window
  hineinrutschte, liefert bei `retrieve` unverändert aus. Ein
  Second-Pass-Filter am Output ist billig und fängt diese Fälle.
- **Scope:**
  - Jede `retrieve`-Antwort (CLI, MCP) läuft durch
    `redactEntriesForRetrieval()` (`src/security/retrieval-redaction.ts`).
    Verstoß: Felder werden durch `[REDACTED:retrieve]` ersetzt, Warning
    am Envelope (`warnings: [{ code: "RETRIEVE_POST_REDACT", entryId,
    patterns[], fields[] }]`). `patterns[]` und `fields[]` sind
    bewusste, dokumentierte Erweiterungen gegenüber dem Minimal-Spec
    (Operator-Triage für III1 und IV1).
  - `handleRetrieveDetails` deckt die zweite Retrieve-Oberfläche des MCP
    gleichwertig ab (flaches Entry-Shape statt Contract-Body).
  - HTTP-`memory serve` existiert bisher nicht; sobald sie kommt,
    importiert sie dasselbe Modul — kein zusätzlicher Code nötig.
  - Audit-Event ist in IV1 eingeplant und konsumiert dieselbe Warning-
    Shape. III1 liest `warnings` im `memory audit secrets`-Report.
  - Performance-Gate: Der Filter isoliert benötigt **42 ms** für 20 000
    saubere Entries (Micro-Bench in
    `tests/unit/retrieval-redaction.perf.test.ts`, Budget 100 ms), CI-
    Schranke bei 500 ms.
- **Done:**
  - E2E: Pro Canary wird ein Entry simuliert direkt in den Repo-Pfad
    eingespeist (`tests/e2e/retrieval-redaction.test.ts`); die
    `memory_retrieve`-Antwort enthält `[REDACTED:retrieve]`,
    `warnings[0].code === "RETRIEVE_POST_REDACT"`, das Canary-Rohwert
    taucht nirgends im Envelope auf.
  - Contract-Test (`tests/contract/retrieval-contract.test.ts`)
    akzeptiert Envelopes mit und ohne `warnings`, weist unbekannte
    Codes zurück. JSON-Schema
    `tests/fixtures/retrieval/retrieval-v1.schema.json` additiv
    erweitert (v1-kompatibel).
  - Perf-Regression-Test hält das 100-ms-Designbudget und das 500-ms-
    CI-Budget ein.

### III3 · Export-Pfad mit Redaction-Metadata · [Must]

- **Warum:** `runtime-trust.md` D1 plant `memory export`. Ohne
  diese Task würde ein Export Redacts verlieren oder, schlimmer,
  un­red­igierte Originale ausliefern.
- **Scope:**
  - Export-Format trägt pro Entry ein Feld
    `redaction: { applied: boolean, patterns: string[], version: "1" }`.
  - Vor jedem Zeilen-Output: Second-Pass-Filter wie in III2.
  - Import (D1) verifiziert `redaction.version`, lehnt ältere
    unbekannte Versionen ab oder setzt Entry in Quarantine.
  - Round-Trip-Test in `runtime-trust.md` D1 erweitert um
    Secret-Canary — Export danach Import ergibt denselben redigierten
    Stand.
- **Done:**
  - Export eines Setups mit einem bewusst eingepflanzten Secret
    (vor III1-Fix) enthält `[REDACTED:secret]`, nicht das Original.
  - Import eines Exports, der `redaction: { applied: false }`
    behauptet, wird abgelehnt, wenn Pattern-Scan neue Secrets findet.

### III4 · Provider-Boundary-Drift-Guard · [Must]

- **Warum:** I3 schützt zur Laufzeit. Der Drift-Guard stellt sicher,
  dass I3 auch in sechs Monaten noch der einzige Pfad zu Providern
  ist — wenn ein Entwickler versehentlich einen zweiten
  HTTP-Call-Pfad einführt, soll CI rot werden.
- **Scope:**
  - AST-basierter Check `scripts/check-embedding-boundary.ts`:
    durchsucht `src/` nach Imports von Provider-SDKs (`openai`,
    `@google/generative-ai`, `voyageai`, `node-fetch`/`undici`
    mit Provider-URLs) außerhalb von `src/embedding/boundary.ts` +
    `src/embedding/providers/*` — jeder Treffer ist ein CI-Fehler.
  - Negative Test-Case: ein PR, der einen direkten Import
    einführt, soll lokal über `npm run lint:security` und in CI
    (`quality`-Job) sofort rot.
- **Done:**
  - Check existiert, `quality`-Job führt ihn aus.
  - Test-Fixture mit bewusstem Regel-Bruch zeigt den Fehlschlag.

---

## Phase IV — Observability + Proof

Ziel: der Schutz ist auditierbar. Ein Operator kann jederzeit
nachweisen, was der Store erkannt hat, was er abgewiesen hat und
dass keine neue Lücke in den Code­pfad gerutscht ist.

### IV1 · Audit-Events für jede Redaction · [Must]

- **Warum:** Ohne Event-Trail kann niemand später rekonstruieren,
  dass ein Agent um 03:17 Uhr einen Token-Leak versucht hat. Das
  ist der Unterschied zwischen „wir haben es verhindert" und „wir
  glauben, wir hätten es verhindert".
- **Scope:**
  - Nutzt die `memory_events`-Tabelle aus `runtime-trust.md` B4
    (oder baut eine eigene, falls B4 später rutscht — Task ist nicht
    davon blockiert).
  - Neue `event_type`-Werte: `secret_rejected`, `secret_redacted`,
    `secret_detected_on_retrieve`, `secret_detected_on_legacy_scan`.
  - Pro Event: Pattern-Name (nicht Regex-Body), Ingress-Pfad
    (`mcp_propose`, `cli_propose`, `retrieve`, `audit_scan`),
    Actor-ID, Timestamp, Entry-ID wenn anwendbar. **Nie** der
    Secret-Inhalt oder ein Hash davon (Hash würde Bruteforce
    ermöglichen).
- **Done:**
  - Jede Reject- und Redact-Aktion in den Integrationstests erzeugt
    genau ein Audit-Event der erwarteten Kategorie.
  - `memory diagnose` zeigt Secret-Event-Count der letzten 24 h.

### IV2 · `memory doctor` Posture-Report · [Should]

- **Warum:** Operatoren wollen eine einzige Antwort auf „sind wir
  dicht?". `memory doctor` existiert bereits als Health-Command —
  er wird um einen Secret-Safety-Abschnitt erweitert.
- **Scope:**
  - `memory doctor` (und `doctor --json`) zeigen:
    - Aktive Pattern-Version (Hash des Katalog-Files).
    - Logger-Redaction aktiv? (Boolean)
    - Embedding-Boundary aktiv + zuletzt erfolgter Drift-Guard-Run.
    - Anzahl der Secret-Events in den letzten 7 Tagen, gruppiert
      nach `event_type`.
    - Ergebnis des letzten `memory audit secrets`-Laufs, wenn
      vorhanden.
  - Kein neuer persistenter State — Report liest aus bestehenden
    Tabellen und Config.
- **Done:**
  - Auf einem sauberen Setup: alle Zeilen grün.
  - Auf einem Setup mit deaktivierter Logger-Redaction:
    rot, exit-Code ≠ 0.

### IV3 · Contract-Golden-Test „no-secret-in-output" · [Must]

- **Warum:** Jede neue MCP-Tool- oder CLI-Response darf nie ein
  un­re­di­giertes Secret enthalten. Ein einzelner Test, der jede
  Response-Oberfläche mit einem Canary-Input füttert und das
  Output scannt, verhindert stille Regressionen.
- **Scope:**
  - Parametrisierter Test in `tests/contract/no-secret-output.test.ts`:
    läuft über alle MCP-Tool-Definitionen + alle CLI-Commands mit
    Output; für jedes Interface wird ein Canary im Input plat­ziert
    (wo sinnvoll: `propose`, `observe`, `retrieve`, `explain`,
    `history`), Response wird gegen den Canary-Regex geprüft.
  - Negative-Path: wenn ein neues Tool / Command hinzu kommt ohne
    Teilnahme an dieser Matrix, scheitert der Test
    („Interface missing from no-secret matrix").
- **Done:**
  - Volle Matrix grün.
  - PR, der ein neues Tool ohne Matrix-Entry hinzufügt, wird rot.

### IV4 · Ingress-Pfad-Inventar als Drift-Guard · [Should]

- **Warum:** Die Wurzel-Schwachstelle von 1.1 war, dass Ingress-Pfade
  implizit bestanden (CLI + MCP), aber nur einige den Filter
  durchliefen. Ein Inventar mit Gate verhindert die Wiederholung.
- **Scope:**
  - Deklaratives File `src/security/ingress-inventory.ts`: Liste
    aller Funktionen / Methoden, die als Ingress-Pfad gelten,
    mit einer Referenz auf den erwarteten Guard-Call.
  - AST-Check `scripts/check-ingress-guards.ts`: jede gelistete
    Funktion muss `enforceNoSecrets` in ihrer Aufruf-Kette haben;
    jede Funktion, die `enforceNoSecrets` benutzt, muss im
    Inventar gelistet sein (Bi-Direktion).
  - Teil des `quality`-Jobs.
- **Done:**
  - Check rot, wenn ein Ingress-Pfad eingeführt wird, der im
    Inventar fehlt.
  - Check rot, wenn ein existierender Ingress-Pfad den Guard-Call
    verliert.

---

## Explicitly NOT in dieser Roadmap

Dinge, die thematisch nahe sind, aber bewusst ausgeklammert werden —
entweder zu groß, zu unreif oder nicht im Moat-Bereich dieses Tools.

- **Binäre / Bild-OCR-Scans** — Secrets in Screenshots oder
  eingebetteten Binaries werden nicht erkannt. `agent-memory`
  speichert Text, nicht Binaries; der Scope bleibt Text.
- **Homomorphe oder Zero-Knowledge-Embeddings** — kein Moat, kein
  reifer Standard, Kosten-Nutzen-Verhältnis für dieses Produkt falsch.
- **PII-Compliance-Zertifizierung (GDPR / HIPAA / SOC2)** — getrennte
  Entscheidung mit eigenem Scope, eigener Auditor-Arbeit, eigenem
  Release-Pfad. Diese Roadmap liefert technische Schichten, keine
  Zertifikats-Claims.
- **Encryption-at-Rest für einzelne Felder** — Postgres-Ebene
  (pgcrypto, Column-Encryption) ist Infrastruktur-Entscheidung
  des Betreibers, nicht dieses Tools. Dokumentation in
  `docs/operations.md` weist darauf hin, kein eigener Feature-Pfad.
- **Per-Team-Secret-Policies** — alle Policies sind heute global
  (pro Installation). Teams-mit-unterschiedlichen-Regeln ist
  2.0-Thema, nicht jetzt.
- **ML-basierte Secret-Detection** — Pattern + Entropy reichen für
  den bekannten Angriffsvektor. ML-Modell erhöht False-Positive-
  Rate und Betriebs­komplexität ohne messbaren Nutzen bei den
  bekannten Fällen.

---

## Release-Gates (versions-neutral)

Keine festen Versions-Zahlen — der User entscheidet, welcher Tag
diese Schranken erreichen muss. Die Roadmap definiert nur, welche
Gates überhaupt existieren und auf welchen Release-Typ sie sich
beziehen.

- **Vor jedem Tag, der einen Ingress-Pfad berührt** (MCP-Tool-Surface,
  CLI-`propose`/`observe`/`import`, neuer Provider-Client):
  - Phase I vollständig (I1, I2, I3, I4).
  - Canary-Test aus II3 grün.
  - IV3 (`no-secret-in-output`) grün.
  - IV4 (Ingress-Inventar) grün.

- **Vor jedem Tag, der Retrieval- oder Export-Surface berührt**
  (neue MCP-Response-Felder, `memory export`, `memory explain`,
  `memory history`):
  - III2 (Retrieval-Output-Filter) muss aktiv sein.
  - III3 (Export-Redaction-Metadata) muss aktiv sein, falls Export
    berührt wird.

- **Vor jedem Tag, der Alt-Daten-Migrations-Pfade öffnet**
  (Upgrade-Dokumentation, Import von Fremdformaten):
  - III1 (DB-Legacy-Scan) dokumentiert im Upgrade-Pfad, CLI-Command
    verfügbar.

- **Quer über alle Tags:**
  - IV1 (Audit-Events) aktiv, sobald die Tabelle existiert.
  - `docs/secret-safety.md` synchron zum Pattern-Katalog (Drift-Guard
    in CI).

Die Zuordnung Gate → konkreter Tag ist Sache des User-Release-
Prozesses. Diese Roadmap macht keine Aussagen über Semver-Stufen
oder Zeitpunkte.

---

## Cross-links

- [`runtime-trust.md`](runtime-trust.md) — Feature-Roadmap,
  referenziert diesen Track in den Release-Gates.
- [ADR-0001 · Agent-Memory-Architektur](../adrs/0001-agent-memory-architecture.md)
- [ADR-0003 · Contract Version Bumps](../adrs/0003-contract-version-bumps.md)
  — das `secret-violation-v1`-Schema fällt unter dieselbe Policy.
- Implementierungs-Anker: `src/ingestion/privacy-filter.ts`,
  `src/mcp/tool-handlers.ts`, `src/cli/index.ts`, `src/utils/logger.ts`.
- [Glossar](../../docs/glossary.md) — Secret, Redaction, Ingress-Pfad,
  Audit-Event.

---

## Arbeitsprinzipien für diesen Track

Eine kurze Erinnerung, die in jedem PR auf diesen Track gilt —
unabhängig davon, welche Feature-Roadmap parallel läuft.

1. **Jede neue Ingress-Oberfläche beginnt im Inventar (IV4).** Keine
   Pull-Requests, die einen neuen Entry-Point einführen, ohne den
   Guard-Call und den Inventar-Eintrag im selben Diff.
2. **Reject ist das Default, Redact ist die Ausnahme.** Jeder
   Redact-Pfad muss per Config explizit eingeschaltet sein — nie
   implizit.
3. **Audit-Events tragen Metadaten, nie Inhalte.** Auch kein Hash
   des Secret-Werts. Pattern-Name + Kontext reichen.
4. **Tests nutzen Canaries, nicht echte Muster.** Fixture-Werte
   folgen dem Schema `<provider>_canary_<random>` und sind
   syntaktisch erkennbar, aber nicht operativ gültig.
5. **Diese Roadmap shipt nicht als Marketing-Feature.** Kein
   „we're secure" in der README. Der Beleg steht in `memory doctor`,
   in den Audit-Events und in den CI-Checks — nicht in Folien.
