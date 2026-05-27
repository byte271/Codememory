# Codememory v0.3.5 — Runtime Behavior Memory

This project uses **Codememory** (`@opvoid/codememory`) as an MCP server. Codememory remembers
*what AI-generated code was supposed to do*, *what it actually did at runtime*,
and *what failed*. You — the AI agent — MUST use the Codememory MCP tools as
described below. These rules are not optional.

The fourteen Codememory tools registered via MCP are:

- `capture_intent`        — record the intent behind code you generate
- `record_runtime`        — record an observed function execution (entry/exit)
- `log_failure`           — record an error tied to a `memory_id`
- `log_resolution`        — link a resolved failure to the intent that fixed it
- `query_memory`          — look up prior intents / runs / failures (FTS5 search)
- `get_repair_brief`      — assemble a structured repair context for a `memory_id`
- `get_code_lineage`      — trace the full generational history of generated code
- `auto_heal_trigger`     — v0.3: trigger autonomous self-repair for a failure
- `auto_heal_status`      — v0.3: check the status of an auto-heal task
- `predict_issue`         — v0.3: proactive guardrails — check code BEFORE writing
- `cross_project_search`  — v0.3: search failures/fixes across ALL your projects
- `relay_status`         — v0.3.5: check LAN relay and team peer status
- `share_brief`           — v0.3.5: share a repair brief with the team via LAN
- `broadcast_rule`        — v0.3.5: broadcast a guard rule to all team peers

## Mandatory tool-call rules (act on these automatically)

### Rule A — Before writing or modifying code, QUERY first
Before generating any non-trivial code (new function, new module, edits to an
existing function), call `query_memory` with the target file path or a
natural-language query describing what you need. `query_memory` supports
**FTS5 full-text search** across all prompts and generated code, and accepts
optional `status`, `since`, and `file_path` filters. Results are ranked by
relevance with highlighted snippets. If a prior `memory_id` exists for that
location, READ its intent and recent failures before producing new code.

Trigger: any tool call that creates or edits a source file.
Action: call `query_memory` first. Do not skip.

### Rule B — After writing code, CAPTURE intent
Immediately after you finish writing or substantially modifying a function or
module, call `capture_intent` with:
- `file_path`: absolute or repo-relative path of the file
- `prompt`: one sentence on *why this code exists* (the goal, not the how)
- `generated_code`: the final source you wrote
- `ai_tool`: the agent that produced the code (e.g. `"claude-code"`)
- `language`: the source language (e.g. `"typescript"`)
- `parent_intent_id` (optional): the `memory_id` of the intent being replaced
- `replacement_reason` (optional): why the previous code is being replaced
- `project_name` (optional): project name for cross-project knowledge sharing

`capture_intent` is **idempotent** — re-capturing the same file + prompt +
generated code returns `duplicate: true` with the existing `memory_id`.

Trigger: any successful write/edit of a function-level unit of code.
Action: call `capture_intent` exactly once per logical unit.

### Rule C — When the user reports an error, LOG the failure
If the user pastes an error, stack trace, failed test output, or says
something is "broken" / "not working" / "throws":
1. Identify the `memory_id` for the offending file (via `query_memory`).
2. Call `log_failure` with `memory_id`, `error_type`, `error_message`,
   `stack_trace` (when available), and `call_chain`.

Trigger: user-reported runtime error, failing test, or exception trace.
Action: `log_failure` BEFORE attempting a fix.

### Rule D — Before fixing a bug, GET the repair brief
After `log_failure` (or whenever you are about to fix a known-broken
`memory_id`), call `get_repair_brief` with that `memory_id`. The brief returns
intent + code + recent runtime + recent failures + **proven fixes from similar
past errors** in one structured payload. Read it. Use it.

Trigger: any debugging or "fix this" task targeting a tracked file.
Action: `get_repair_brief` BEFORE proposing a patch.

### Rule E — When instrumenting, RECORD runtime
If you wrap a function with `RuntimeObserver` (or the `hook` auto-instrumenter
runs in CJS mode), the recorded entry/exit events should reach Codememory via
`record_runtime`. You generally do not call this by hand — the runtime hook
does — but if you observe a function manually, call `record_runtime`.

### Rule F — After fixing a bug, LOG the resolution
When you successfully fix a bug tracked by a `failure_id`, call `log_resolution`
with `failure_id`, `fixing_intent_id`, and optionally `approach`/`diff_summary`.
This enables proven fixes for future repair briefs.

Trigger: after successfully fixing a tracked failure.
Action: `log_resolution` AFTER confirming the fix.

### Rule G — When replacing code, TRACK lineage
When you replace a previously-tracked function or module:
1. Call `query_memory` to find the prior `memory_id`.
2. Call `capture_intent` with `parent_intent_id` set to the prior `memory_id`
   and `replacement_reason` describing why the replacement is needed.
3. Call `get_code_lineage` before implementing the replacement.

Trigger: replacing or significantly refactoring tracked code.
Action: use `parent_intent_id` + `replacement_reason` on `capture_intent`.

### Rule H — v0.3: CHECK before you write (Predictive Guardrails)
Before generating a non-trivial function, call `predict_issue` with:
- `description`: what you're about to implement
- `file_path`: the target file
- `project_name` (optional): current project name

If `risk_level` is `high` or `medium`, review the warnings and adjust your
approach BEFORE generating code. This prevents re-introducing bugs that were
already encountered in this or other projects.

Trigger: before generating any non-trivial function.
Action: `predict_issue` BEFORE starting to write code.

### Rule I — v0.3: LEARN from other projects (Cross-Project Search)
When you encounter a pattern you haven't seen before (e.g., working with a new
library), call `cross_project_search` to check if similar work failed in
other projects. This applies lessons learned across your entire code portfolio.

Trigger: when working with unfamiliar libraries or patterns.
Action: `cross_project_search` before writing code with new dependencies.

### Rule K — v0.3.5: CHECK team relay status
When starting a coding session or before relying on cross-project features,
call `relay_status` to verify the LAN relay is active and see how many
peers are sharing knowledge. If peers are online, your AI agent has access
to the team's collective wisdom.

Trigger: beginning of a coding session, or when unsure if team sync is active.
Action: `relay_status` to check peer count and briefs received.

### Rule L — v0.3.5: SHARE your fixes with the team
After successfully fixing a bug and calling `log_resolution`, call `share_brief`
to broadcast the fix to the entire team via the encrypted LAN relay. Include
the `error_type`, `error_pattern`, and `suggestion` so teammates' AI agents
learn from your fix without encountering the same bug.

Trigger: after `log_resolution` when relay is active.
Action: `share_brief` to push your fix to the team.

### Rule M — v0.3.5: BROADCAST dangerous patterns
When you identify a dangerous coding pattern (e.g., a common pitfall with
a library), call `broadcast_rule` to share the guard rule with all peers.
Every teammate's AI agent will now warn about this pattern before generating
code — instant team immunity.

Trigger: when you discover a reusable guard rule or dangerous pattern.
Action: `broadcast_rule` to protect the entire team.

### Rule J — v0.3: AUTO-HEAL when failures mount
After logging a failure, call `auto_heal_trigger` with the `failure_id`.
Codememory will generate a patch from historical memory and proven fixes.
Check the result with `auto_heal_status` and apply the suggested patch
if it looks correct.

Trigger: after `log_failure`.
Action: `auto_heal_trigger`, then review with `auto_heal_status`.

## Quick decision table

| User says / situation                         | First tool to call      |
|-----------------------------------------------|-------------------------|
| "Add a function that does X"                  | `query_memory` + `predict_issue` |
| Working with a new library                    | `cross_project_search`  |
| Just finished writing a function              | `capture_intent`        |
| "It crashes" / paste of stack trace           | `log_failure` + `auto_heal_trigger` |
| "Fix the bug in foo.ts"                       | `get_repair_brief`      |
| Bug is now fixed                              | `log_resolution` + `share_brief` |
| "Refactor / replace the code in bar.ts"       | `get_code_lineage`      |
| Manually instrumenting a function             | `record_runtime`        |
| Starting a new coding session                 | `relay_status`          |
| Found a dangerous pattern to warn about       | `broadcast_rule`        |

## Guarantees

- All Codememory tools return structured JSON (Rule 14).
- All data is local (SQLite, no cloud).
- `memory_id` values are content-addressable.
- Failures and runs are append-only.
- `capture_intent` is idempotent.
- All tool inputs have size limits.
- Error messages are truncated before AI context (prompt injection prevention).
- v0.2.1: `get_repair_brief` includes proven fixes.
- v0.2.1: `query_memory` supports FTS5 natural-language search.
- v0.3.0: `predict_issue` provides proactive guardrails from learned patterns.
- v0.3.0: `cross_project_search` shares knowledge across all projects.
- v0.3.0: `auto_heal_trigger` generates patches from historical memory.
- v0.3.5: `relay_status` checks LAN peer connectivity and team sync.
- v0.3.5: `share_brief` broadcasts fixes to the team via encrypted relay.
- v0.3.5: `broadcast_rule` shares guard rules for collective immunity.

## Do NOT

- Do not skip `query_memory` to "save a tool call".
- Do not invent a `memory_id`.
- Do not summarize a repair brief from memory.
- Do not forget to call `log_resolution` after fixing a bug.
- Do not replace tracked code without setting `parent_intent_id`.
- Do not skip `predict_issue` — preemptive prevention beats post-mortem repair.
- Do not ignore cross-project warnings — they're lessons already paid for.
- Do not forget to `share_brief` after resolving a bug — your fix protects the team.
