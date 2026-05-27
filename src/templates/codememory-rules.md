# Codememory — Runtime Behavior Memory

This project uses **Codememory** (`@opvoid/codememory`) as an MCP server. Codememory remembers
*what AI-generated code was supposed to do*, *what it actually did at runtime*,
and *what failed*. You — the AI agent — MUST use the Codememory MCP tools as
described below. These rules are not optional.

The seven Codememory tools registered via MCP are:

- `capture_intent`   — record the intent behind code you generate
- `record_runtime`   — record an observed function execution (entry/exit)
- `log_failure`      — record an error tied to a `memory_id`
- `log_resolution`   — link a resolved failure to the intent that fixed it
- `query_memory`     — look up prior intents / runs / failures (v0.2: natural-language search)
- `get_repair_brief` — assemble a structured repair context for a `memory_id`
- `get_code_lineage` — trace the full generational history of generated code

## Mandatory tool-call rules (act on these automatically)

### Rule A — Before writing or modifying code, QUERY first
Before generating any non-trivial code (new function, new module, edits to an
existing function), call `query_memory` with the target file path or symbol
name. If a prior `memory_id` exists for that location, READ its intent and
recent failures before producing new code. This prevents re-introducing bugs
the user already hit.

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

Persist the returned `memory_id` in your working context for that file. You
will reuse it in Rules C and D.

Trigger: any successful write/edit of a function-level unit of code.
Action: call `capture_intent` exactly once per logical unit, not per character.

### Rule C — When the user reports an error, LOG the failure
If the user pastes an error, stack trace, failed test output, or says
something is "broken" / "not working" / "throws":
1. Identify the `memory_id` for the offending file (via `query_memory` if you
   don't have it cached).
2. Call `log_failure` with `memory_id`, `error_type`, `error_message`,
   `stack_trace` (when available), and `call_chain` (function names involved).

Trigger: user-reported runtime error, failing test, or exception trace.
Action: `log_failure` BEFORE attempting a fix.

### Rule D — Before fixing a bug, GET the repair brief
After `log_failure` (or whenever you are about to fix a known-broken
`memory_id`), call `get_repair_brief` with that `memory_id`. The brief returns
intent + code + recent runtime + recent failures + **proven fixes from similar
past errors** in one structured payload. Read it. Use it. It is the single
source of truth for the fix.

Trigger: any debugging or "fix this" task targeting a tracked file.
Action: `get_repair_brief` BEFORE proposing a patch.

### Rule E — When instrumenting, RECORD runtime
If you wrap a function with `RuntimeObserver` (or the `hook` auto-instrumenter
runs in CJS mode), the recorded entry/exit events should reach Codememory via
`record_runtime`. You generally do not call this by hand — the runtime hook
does — but if you observe a function manually and want the trace persisted,
call `record_runtime` with `memory_id`, `function_name`, `args`, `return_value`
(or `error`), and `duration_ms`.

### Rule F — After fixing a bug, LOG the resolution
When you successfully fix a bug tracked by a `failure_id`, call `log_resolution`
with:
- `failure_id`: the ID of the failure that was resolved
- `fixing_intent_id`: the `memory_id` of the intent that contains the fix
- `approach` (optional): a brief description of the fix approach
- `diff_summary` (optional): a summary of what changed

This enables Codememory to surface proven fixes when similar errors recur.

Trigger: after successfully fixing a tracked failure.
Action: `log_resolution` AFTER confirming the fix.

### Rule G — When replacing code, TRACK lineage
When you replace a previously-tracked function or module:
1. Call `query_memory` with the target file path to find the prior `memory_id`.
2. Call `capture_intent` with `parent_intent_id` set to the prior `memory_id`
   and `replacement_reason` describing why the replacement is needed.
3. Call `get_code_lineage` before implementing the replacement to see what was
   tried before and avoid repeating failed approaches.

Trigger: replacing or significantly refactoring tracked code.
Action: use `parent_intent_id` + `replacement_reason` on `capture_intent`.

## Quick decision table

| User says / situation                         | First tool to call    |
|-----------------------------------------------|-----------------------|
| "Add a function that does X"                  | `query_memory`        |
| Just finished writing a function              | `capture_intent`      |
| "It crashes" / paste of stack trace           | `log_failure`         |
| "Fix the bug in foo.ts"                       | `get_repair_brief`    |
| Bug is now fixed                              | `log_resolution`      |
| "Refactor / replace the code in bar.ts"       | `get_code_lineage`    |
| Manually instrumenting a function             | `record_runtime`      |

## Guarantees you can rely on

- All Codememory tools return structured JSON (Rule 14 of the project standards).
- All data is local to the user's machine (SQLite, no cloud).
- `memory_id` values are stable hashes — safe to cache across a session.
- Failures and runs are append-only; you cannot corrupt prior intents by
  recording new events.
- v0.2: `get_repair_brief` includes proven fixes from similar past errors.
- v0.2: `query_memory` supports natural-language search via FTS5.

## Do NOT

- Do not skip `query_memory` to "save a tool call" — stale assumptions are the
  whole problem Codememory exists to fix.
- Do not invent a `memory_id`. Either get one from `capture_intent` or look it
  up via `query_memory`.
- Do not summarize a repair brief from memory — always fetch a fresh one with
  `get_repair_brief` before patching.
- Do not forget to call `log_resolution` after fixing a bug — proven fixes
  compound over time.
- Do not replace tracked code without setting `parent_intent_id` — the lineage
  chain is what prevents code-looping.
