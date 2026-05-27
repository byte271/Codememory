# Changelog

All notable changes to Codememory are documented in this file.

---

## [v0.3.5] — 2026-05-27 — The "Neural Link" Update

### 🚀 Major Features

- **📡 LAN Relay — Zero-Config Team Intelligence**: Codememory instances on the same local network automatically discover each other via mDNS (Multicast DNS). When a teammate fixes a bug or refactors a complex module, their repair brief becomes instantly available to your AI agent. Peer-to-peer sync with no servers and no setup — just enable and discover.
- **🔒 Privacy-First P2P Architecture**: All data transmitted between peers is encrypted with AES-256-GCM using a pre-shared pairing key. Code intents, execution traces, and repair briefs never leave your local network. End-to-end encryption ensures only peers with the pairing key can read messages.
- **🛡️ Collective Guardrails — One-Fix-for-All**: When one developer identifies a dangerous pattern and creates a guard rule, that rule is instantly broadcast to the entire team. Every teammate's AI agent now warns about this pattern before generating code — instant team immunity.
- **🧠 Hive Mind Dashboard**: The Behavioral Time Machine dashboard now includes a team view with connected peers list, shared briefs feed, and a contribution heatmap showing which modules generate the most shared wisdom.

### New CLI Commands

- **`codememory relay start`**: Enable LAN discovery and start sharing experience with your team.
- **`codememory relay pair`**: Display your pairing key for team setup.
- **`codememory peers`**: List all active Codememory instances on your local network.
- **`codememory sync --force`**: Manually pull the latest collective wisdom from peers.

### New MCP Tools (14 total, up from 11)

- **`relay_status`**: Check LAN relay status — connected peers, shared briefs count, pairing key fingerprint.
- **`share_brief`**: Share a repair brief with the entire team via the encrypted LAN relay.
- **`broadcast_rule`**: Broadcast a guard rule to all peers for collective immunity.

### Database

- **Migration 005**: Added `peer_nodes`, `shared_briefs`, and `relay_config` tables for distributed team memory.

### Configuration (env vars)

- `CODEMEMORY_RELAY_ENABLED` — enable LAN relay and team sharing (default: false, opt-in)
- `CODEMEMORY_RELAY_PORT` — relay WebSocket port (default: 4211)
- `CODEMEMORY_RELAY_PAIRING_KEY` — pre-shared encryption key (auto-generated on first run)

### Technical Details

- **Service Discovery**: Integrated `multicast-dns` for zero-config peer location via `_codememory._tcp` service type.
- **Relay Protocol**: Custom lightweight P2P protocol built on encrypted WebSockets (AES-256-GCM).
- **Handshake**: Pairing key fingerprint exchange for mutual verification — mismatched keys close the connection.
- **Heartbeat**: Ping/pong every 15 seconds to detect dead peers.
- **Reconnection**: Exponential backoff up to 60 seconds for resilience.

### 🛡️ Bug Fixes & Stability (Rounds 7-8)

#### Critical
- **#40** `IntentSearchEngine.search()` FTS5 queries now SELECT `i.project_id` — cross-project search was broken because `project_id` was never retrieved from `intent_records`, causing all results to return `null` and the cross-project knowledge graph to be inert.
- **#41** `RepairProvenance.findSimilarFixes()` queries now SELECT `i.project_id` — same root cause as #40; provenance `mapRow` hardcoded `project_id: null`, silently dropping project context from proven fix results.

#### Medium
- **#42** `PredictiveGuard.searchGuardRules()` changed silent `catch {}` to log a warning via `logger.warn` — FTS5 parse errors on unusual search patterns were silently swallowed (Rule 06 violation).
- **#43** `RecordRuntimeTool.safeJsonStringify()` changed silent `catch` to log a warning via `logger.warn` — JSON.stringify failures on circular or non-serializable objects were silently discarded.

#### Low
- **#44** Heal worker poll loop changed silent `catch {}` to post an error message back to the main thread via `parentPort.postMessage` — communication errors in the background worker were invisible.
- **#45** `AutoHealEngine.startWorker()` now handles `error` type messages from the worker thread — worker error reports were silently dropped because the main thread only processed `check_pending` messages.
- **#46** `RepairAssembler.formatCallChain()` changed silent `catch {}` to log a warning via `logger.warn` — malformed `call_chain` JSON in the database was silently ignored instead of surfacing for investigation.

---

## [v0.3.0] — 2026-05-27

### 🚀 Major Features

- **🤖 Autonomous Self-Healing (Auto-Repair Loop)**: When a runtime error is captured, Codememory automatically generates a repair brief from historical memory, produces a comment-annotated patch from proven fixes, and marks the failure for resolution. A background worker thread polls for unresolved failures and triggers auto-heal tasks on a configurable interval.
- **🛡️ Proactive Guardrails (Predictive Safety Barriers)**: Before AI generates code, the guard engine checks the proposed approach against known failure patterns using FTS5 full-text search on `guard_rules`. Returns warnings with confidence levels and suggested alternatives — transforming post-mortem repair into preemptive prevention.
- **🔗 Cross-Project Knowledge Graph**: Projects are now explicitly registered with the `projects` table. Intents can link to projects, and `cross_project_search` finds failures and proven fixes across all repositories. Guard rules learned in Project A automatically apply to Project B.
- **⏱️ Behavioral Time Machine (Web Dashboard)**: An embedded Express server (zero-dependency, single-file HTML) serves a dark-themed dashboard on `localhost:4210`. Visualizes the full "life trajectory" of code: error rate trends, fix effectiveness, chronological event timeline with filtering tabs.

### Database

- **Migration 004**: Added `projects`, `auto_heal_tasks`, `guard_rules`, `guard_predictions` tables, and `guard_rules_fts` virtual table. Added `project_id` column to `intent_records`.

### New MCP Tools

- **`auto_heal_trigger`**: Queues and executes an auto-heal task for a specific failure, returning the generated patch.
- **`auto_heal_status`**: Checks the status of an auto-heal task (pending/running/completed/failed) with failure context.
- **`predict_issue`**: Runs guard analysis on proposed code before it's written. Returns warnings with risk level and cross-project context.
- **`cross_project_search`**: Searches failures and resolutions across all registered projects for shared learnings.

### CLI

- **`codememory dashboard`**: Starts the Behavioral Time Machine web UI standalone.
- **`codememory heal`**: Manually triggers auto-healing for unresolved failures.
- **`codememory` (default)**: Now starts auto-heal worker and optional dashboard alongside the MCP server.

### Configuration (env vars)

- `CODEMEMORY_AUTOHEAL_ENABLED` — enable/disable background auto-heal worker (default: true)
- `CODEMEMORY_AUTOHEAL_POLL_MS` — worker polling interval in ms (default: 30000)
- `CODEMEMORY_AUTOHEAL_MAX_CONCURRENT` — max concurrent heal tasks (default: 3)
- `CODEMEMORY_DASHBOARD_ENABLED` — enable the web UI (default: false, opt-in)
- `CODEMEMORY_DASHBOARD_PORT` — dashboard port (default: 4210)
- `CODEMEMORY_GUARD_CONFIDENCE_THRESHOLD` — minimum confidence to surface warnings (default: 0.3)

### 🛡️ Bug Fixes & Stability

#### Critical
- **#1** Worker auto-heal loop now properly processes pending tasks: message handler responds to `check_pending` with `executeTask` error handling (#1, #7, #24).
- **#2** Tasks are atomically marked `running` via `UPDATE ... RETURNING *` to prevent double-processing (#8).
- **#3** `capture_intent` now registers projects and sets `project_id` on intents — the cross-project knowledge graph is no longer inert (#2, #14).
- **#4** `predict_issue` now logs a warning when a project name isn't found instead of silently disabling cross-project rules (#3).
- **#5** `auto_heal_trigger` returns the actual task status instead of hardcoded `'queued'` (#13).

#### High
- **#6** Resolution events in the dashboard timeline now JOIN to get `file_path` from `intent_records` (#4).
- **#7** Worker script path resolution now uses `existsSync` with CJS/ESM/src fallbacks and graceful degradation (#5).
- **#8** Dashboard `refreshInterval` is cleared on server shutdown to prevent timer leaks (#6).
- **#9** `log_resolution` now triggers `guard.learnFromResolution` so resolved failures create reusable guard rules (#15, #20).
- **#10** `CrossProjectGraph.getProjectById` is now a public method (#16).
- **#11** Server now uses config functions (`isAutoHealEnabled`, `isDashboardEnabled`, `getDashboardPort`) instead of inline env reads (#17).

#### Medium
- **#12** `DatabaseManager.prepare` now has LRU statement cache eviction after 100 entries to prevent unbounded memory growth (#9).
- **#13** `BehaviorTimelineAggregator.computeTrends` uses batched SQL GROUP BY instead of day-by-day iteration, with a 90-day cap (#19).
- **#14** Guard FTS5 queries validate input before MATCH to prevent parse errors on unusual characters (#10).

#### Low
- **#15** `codememory heal` CLI now actually triggers auto-heal execution instead of just listing failures (#21).
- **#16** Dashboard health endpoint simplified: `Request<never, never, never, never>` → `Request` (#23).
- **#17** Non-null assertions removed from `auto-heal.ts` queueTask and executeTask — replaced with explicit null checks (#7, #24).
- **#18** `getAutoHealPollMs()` wired into `auto-heal.ts` worker instead of reading `process.env` directly (#17).
- **#19** `getAutoHealMaxConcurrent()` wired into `auto-heal.ts` worker handler instead of hardcoded `5`.
- **#20** `getGuardConfidenceThreshold()` wired into `predictive-guard.ts` to filter low-confidence warnings; risk level now computed from filtered results.
- **#21** `resolveWorkerPath()` error message builds path list conditionally instead of showing empty CJS path.
- **#22** `AutoHealTriggerOutput.status` type widened from `'queued'` to `AutoHealTask['status']` to match actual return values.
- **#23** `handleDashboard()` in `bin.ts` now uses `getDashboardPort()` from config instead of reading `process.env` directly.
- **#24** Worker.ts shutdown handler now properly resolves the promise on `shutdown` message — fixes a hung worker thread on graceful shutdown.
- **#25** Worker.ts listener leak fixed: normal poll timeout now removes the `onShutdown` listener to prevent accumulation across poll iterations.
- **#26** `computeTrends()` SQL now uses parameterized `dayMs` instead of string interpolation.
- **#27** `tests/cli/init.test.ts` version check now reads from `package.json` instead of hardcoded `0.2.1`.
- **#28** `auto-heal.ts executeTask` now checks for `running` status in addition to `completed`/`failed` — prevents race condition when `auto_heal_trigger` and background worker concurrently process the same task.
- **#29** `auto-heal.ts executeTask` error handler uses `error instanceof Error ? error.message : String(error)` instead of bare `String(error)` — prevents `[object Object]` in `error_log` column.
- **#30** `auto_heal_trigger.ts` replaced hardcoded `estimated_ms: 5000` with actual measured execution time via `Date.now() - startedAt`.
- **#31** `predictive-guard.ts predict()` log now shows `totalBeforeFilter` (warnings before threshold filtering) instead of redundant `filteredCount` (same as `warningCount` after filtering).
- **#32** `web/server.ts` — DashboardServer constructor used direct `process.env` read for port fallback instead of `getDashboardPort()` from config. Replaced with `getDashboardPort()` import.
- **#33** `log_resolution.ts` — Guard learning catch block used `String(err)` which could produce `[object Object]` in logs. Now uses `err instanceof Error ? err.message : String(err)`.
- **#34** `bin.ts` — `handleHeal` CLI error output used `String(err)`. Fixed to `err instanceof Error ? err.message : String(err)`.
- **#35** `predict_issue.ts` — Cross-project rules bypassed the guard confidence threshold filter, allowing low-confidence cross-project warnings to surface. Now filtered by `getGuardConfidenceThreshold()`.
- **#36** `predict_issue.ts` — Cross-project rules only consulted when local guard patterns already fired (`result.warnings.length > 0` gate). Removed gate so cross-project knowledge always enriches predictions.
- **#37** `predict_issue.ts` — `risk_level` and `match_count` didn't account for cross-project warnings, causing misleading output (e.g., `risk_level: 'none'` alongside active warnings). Now recalculated after cross-project enrichment.
- **#38** `bin.ts` — ESLint `no-var-requires` was suppressed with wrong rule name (`@typescript-eslint/no-require-imports` instead of `@typescript-eslint/no-var-requires`), causing a lint warning on the `require('../package.json')` call. Fixed the disable comment rule name.
- **#39** `predictive-guard.ts` — `extractPattern()` used `let cleaned` where `cleaned` is never reassigned. Changed to `const` (ESLint `prefer-const`).

---

## [v0.2.1] — 2026-05-26

### 🚀 Features

- **Multi-provider support**: Codememory now supports Claude Code, Cursor, OpenAI Codex, and Windsurf out of the box. Use `codememory init --provider cursor` (or `codex`, `windsurf`) to scaffold provider-specific MCP configs. Defaults to `claude`.
- **FTS5 natural-language search**: `query_memory` now supports full-text search across all captured intents (prompts and generated code). Use `query: "email validation"` to find matching intents ranked by relevance with highlighted snippets.
- **True FTS5 pagination totals**: When no `status`/`since` post-filters are active, `query_memory` returns the true FTS5 match count (not just the slice length), enabling accurate pagination UIs.
- **FTS5 post-filtering with fetch window**: When `status`/`since` filters are active, FTS5 fetches a larger window (limit × 5) so the caller still gets ~limit results after client-side filtering.
- **Idempotent capture**: `capture_intent` returns `duplicate: true` when re-capturing the same intent (same file + prompt + generated code), avoiding duplicate database rows.
- **E2E integration test suite**: 17 comprehensive tests covering all 7 MCP tools through the full pipeline, including idempotent capture, 3-generation lineage chains, FTS5 search, error paths, and input validation.

### 🛡️ Stability & Security (49 bugs fixed across 10 audit rounds, plus 5 test-coverage edge-case additions)

#### FTS5 Post-Filtering & API Cleanup (Round 9)
- **#52** FTS5 post-filtering now fetches a larger window (`limit × 5`, capped at 250) when `status`/`since` filters are active, preventing silently reduced result counts.
- **#53** Removed unused `_timestamp` parameter from `generateMemoryId()` — the function is now purely content-addressable. Caller updated.
- **#54** `down()` migration functions intentionally retained (not automated), documented for potential future rollback use.
- **#55** Removed `examples` from npm `files` array — examples import internal APIs (`../../src/...`) unavailable in the published package.

#### CI Hardening & Code Quality (Round 8)
- **#50** Added `pnpm run check:brand` to CI workflow — the legacy name "engram" check now actually runs on PRs, not just locally.
- **#51** Refactored `buildCountParams()` in `intent-filtered.ts` — eliminated fragile `buildParams({limit: 1})` + `params.pop()` hack. Extracted shared `computeFlags()` method.

#### npm Packaging & Lint Hygiene (Round 7)
- **#48** `generateMemoryId()` no longer includes `Date.now()` in hash — same input now always produces the same ID. This was the root cause of `duplicate: true` never being returned (timestamps changed between calls).
- **#49** FTS5 `snippet()` column index changed from `2` to `-1` — the `intent_fts` virtual table has only 2 columns (index 0 and 1), so `2` was out of range. `-1` auto-selects the best-matching column.

#### E2E Test Suite & Edge Cases (Round 6)
- **#43** Added `--force` flag test coverage for `codememory init` CLI.
- **#44** Added cross-file parent intent validation test — prevents lineage poisoning across files.
- **#45** Added snapshot-belongs-to-intent validation test — ensures `log_failure` rejects snapshots from a different intent.
- **#46** Added duplicate resolution rejection test — ensures resolving an already-resolved failure fails.
- **#47** Added input size validation tests for all 7 MCP tools (DoS guard coverage).

#### Security: Injection, Validation & Poisoning (Round 5)
- **#30** All user-originated strings truncated before interpolation into AI prompts — prevents prompt injection via crafted proven fixes.
- **#31** Input size limits added to every MCP tool field — prevents DoS via multi-megabyte payloads.
- **#32** Documented no-authorization design limitation in `log_resolution` JSDoc.
- **#33** `SENSITIVE_KEYS` now uses word-boundary regex instead of `.includes()` — no more false-positive redaction of `tokenizer`, `author`, `public_key`, etc.
- **#34** `formatToolError` truncates non-CodememoryError messages to 256 chars — prevents SQLite schema/file-path leakage.
- **#35** `call_chain` array capped at 50 elements × 256 chars each in `log_failure`.
- **#36** FTS5 operator strip confirmed correct with `\b` word boundaries.
- **#37** Parent intent `file_path` must match child's `file_path` in `capture_intent` — prevents cross-file lineage poisoning.
- **#38** Documented shared-database/no-auth design for single-user workflows in server JSDoc.
- **#39** `CaptureIntentOutput` now includes `duplicate: boolean` flag for idempotent captures.
- **#40** `*/` sequences in generated code escaped to `*\/` — prevents multi-line comment injection in `binder.ts`.
- **#41** Sanitizer breadth caps: max 1000 array elements, 500 object keys.
- **#42** All truncation limits use named constants; stack traces and error messages truncated before AI context.

#### Concurrency & WAL Mode (Round 4)
- **#20** Added `busy_timeout = 5000` — concurrent writes now retry instead of failing with `SQLITE_BUSY`.
- **#21** Changed `synchronous = NORMAL` → `FULL` — no committed data lost on power failure.
- **#22** `markReplaced()` now conditional (`WHERE status = 'active'`) — prevents two concurrent `capture_intent` calls from creating two active children for one parent.
- **#23** Provenance `record()` UPDATE now conditional (`WHERE repair_status = 'unresolved'`) — atomic TOCTOU check prevents two intents from resolving the same failure.
- **#24** `insertSnapshot` + `pruneSnapshots` wrapped in `db.transaction()` for atomicity.
- **#25** `RuntimeObserver` now retries with exponential backoff (3 attempts) on `SQLITE_BUSY` / `SQLITE_BUSY_SNAPSHOT`.
- **#26** Documented non-atomic snapshot+failure recording limitation in observer JSDoc.
- **#27** `database.close()` now rethrows after logging checkpoint errors.
- **#28** Set explicit `wal_autocheckpoint = 1000` to prevent unbounded WAL growth.
- **#29** Changed `wal_checkpoint(FULL)` → `RESTART` on close (won't hang on active readers).

#### Edge Cases & Transactions (Round 3)
- **#7** Atomic `INSERT OR REPLACE` on snapshot write — no stale rows left on re-capture.
- **#8** `IntentQueries.getById` and `getByHash` now validate results before casting — no runtime crash on corrupt DB.
- **#9** `IntentQueries.markReplaced` returns boolean so callers can detect no-op.
- **#10** `LogResolutionTool` verifies `fixing_intent_id` and `failure_id` existence before recording provenance.
- **#11** `RecordRuntimeTool` validates `memory_id` exists before inserting snapshot.
- **#12** `GetCodeLineageTool` returns empty lineage instead of throwing on unknown `memory_id`.
- **#13** `LogFailureTool` skips duplicate failure recording (same `memory_id` + `error_message` within cooldown window).

#### Medium Bugs (Round 2)
- **#2** Foreign key cascades (`ON DELETE CASCADE`) on all child tables — deleting an intent properly cleans up snapshots, failures, and resolutions.
- **#3** `query_memory` date filtering uses ISO timestamp comparison instead of Unix epoch math.
- **#4** `runtime_snapshots` `file_path` column populated in migration — not left NULL on upgrade.
- **#5** `get_repair_brief` no longer returns resolved failures under "recent failures."
- **#6** `log_resolution` checks `repair_status` before marking resolved (idempotent).

#### Critical & High Bugs (Round 1)
- **#1** Missing `NOT NULL` constraints on core columns — schema hardened.
- Repository initialized with foundational Codememory v0.2.0 codebase.
