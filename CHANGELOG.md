# Changelog

All notable changes to Codememory are documented in this file.

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
