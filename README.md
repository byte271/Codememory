<p align="center">
  <img src="assets/Codememory-logo.png" alt="Codememory logo" width="200" />
</p>

# Codememory

> AI wrote your code. Now it knows what happened.

<p align="center">
  <video src="assets/Codememory-promo.mp4" controls width="720">
    Your browser does not support embedded video.
    <a href="assets/Codememory-promo.mp4">Download the Codememory promo video</a>.
  </video>
</p>

AI-generated code breaks. The agent doesn't remember why it wrote what it
wrote, what the function actually did at runtime, or what fixed the bug
last time the same shape of failure showed up. So you and the agent end
up in a loop — generate, break, guess, regenerate. Codememory is the memory
layer that breaks the loop. It records *behavioral* memory of your code:
the intent behind each generation, what executed at runtime, where it
failed, and what fix worked. The next time the agent touches that code,
it gets a repair brief instead of a blank slate.

## Why Codememory beats agentmemory

|                                              | agentmemory          | Codememory                                      |
| -------------------------------------------- | -------------------- | ----------------------------------------------- |
| Stores                                       | Conversation history | Code behavior history                           |
| Knows why code broke                         | ✗                    | ✓                                               |
| Runtime awareness                            | ✗                    | ✓                                               |
| Repair brief                                 | ✗                    | ✓ — intent + code + trace + fix approach        |
| Works without changes to your workflow       | ✓                    | ✓                                               |

## How it works

When the agent writes code, Codememory captures the **intent** (the prompt,
the file, a content hash) via an MCP tool call. At runtime an
**observer** records what each instrumented function actually did —
inputs, outputs, errors, stack traces — and links those traces back to
the originating intent. When something fails or the agent revisits the
same code, Codememory returns a **repair brief** that fuses intent +
runtime + failure + a suggested fix approach so the next edit is
informed instead of speculative.

Codememory goes beyond passive memory — it actively **guards** against
reintroducing known bugs (proactive guardrails), **auto-heals** failures
by generating patches from historical memory (autonomous self-repair),
and **cross-references** learnings from all your projects (cross-project
knowledge graph). A built-in web **dashboard** visualizes the full
lifecycle of your code: error trends, fix effectiveness, and a
chronological event timeline.

## Setup (60 seconds)

> [!NOTE]
> Due to an npm publishing issue, the npm package version `0.2.2` is equivalent to the project release `0.2.1`.
>
> We encountered an issue with the previous npm release and had to republish the package under a new version number. We apologize for the confusion.

```bash
npm install -g @opvoid/codememory
codememory init
```

Then add to your project's agent rules file:

```
# Claude Code: add to CLAUDE.md
# Cursor / Windsurf: add to .cursorrules or .windsurfrules
# Codex: add to CODEX.md

@include CODEMEMORY.md
```

That's it. Your AI agent will automatically capture intent when it writes
code and fetch repair briefs before fixing bugs.

## What `codememory init` creates

- `.mcp.json` — registers Codememory as an MCP server for your provider (Claude Code, Cursor, Codex, or Windsurf).
- `CODEMEMORY.md` — rules that tell the AI agent when to call which tool:
  all 11 MCP tools covering capture, runtime, failure, resolution,
  query, repair, lineage, auto-heal, guardrails, and cross-project search.

Existing files are preserved by default. Pass `--force` to overwrite.

## CLI commands

| Command | What it does |
|---------|-------------|
| `codememory init` | Scaffold `.mcp.json` + `CODEMEMORY.md` for your provider |
| `codememory init --provider cursor` | Scaffold for Cursor, Codex, or Windsurf instead of Claude Code |
| `codememory init --force` | Overwrite existing config and rules files |
| `codememory` | Start the MCP server (with auto-heal worker + optional dashboard) |
| `codememory dashboard` | Start the Behavioral Time Machine web UI standalone |
| `codememory heal` | Manually trigger auto-healing for all unresolved failures |
| `codememory --version` | Print the version |
| `codememory --help` | Print available commands |

## Configuration

All configuration is via environment variables. None are required —
everything has sensible defaults.

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEMEMORY_AUTOHEAL_ENABLED` | `true` | Enable background auto-heal worker |
| `CODEMEMORY_AUTOHEAL_POLL_MS` | `30000` | Worker polling interval in milliseconds |
| `CODEMEMORY_AUTOHEAL_MAX_CONCURRENT` | `3` | Max concurrent auto-heal tasks |
| `CODEMEMORY_DASHBOARD_ENABLED` | `false` | Enable the web dashboard (opt-in) |
| `CODEMEMORY_DASHBOARD_PORT` | `4210` | Dashboard HTTP port |
| `CODEMEMORY_GUARD_CONFIDENCE_THRESHOLD` | `0.3` | Minimum confidence to surface guard warnings |
| `CODEMEMORY_MAX_SNAPSHOTS_PER_INTENT` | `100` | Max runtime snapshots retained per intent |
| `LOG_LEVEL` | `info` | Log verbosity (trace/debug/info/warn/error) |

## CJS vs ESM

**CJS projects:** automatic instrumentation via a `Module._load`
require hook. Call `hook.start()` and local `require(...)` calls are
auto-instrumented.

**ESM projects:** Node does not expose a comparable hook, so use the
manual observer API:

```typescript
import { RuntimeObserver } from '@opvoid/codememory'
const observed = observer.observe(yourFunction, 'functionName')
```

## The MCP tools (all 11)

| Tool | Purpose |
|------|---------|
| `capture_intent` | Record the intent behind generated code (returns a stable `memory_id`). Idempotent — re-capturing the same intent returns `duplicate: true`. |
| `record_runtime` | Record an observed function execution (args, return value, duration). |
| `log_failure` | Record an error tied to a `memory_id`. Validates snapshots belong to the intent. |
| `log_resolution` | Link a resolved failure to the fixing intent (provenance). |
| `query_memory` | Search intents via **FTS5 natural-language search** (keyword/semantic) or filtered query (file_path, status, since). Returns true pagination totals. |
| `get_repair_brief` | Assemble a structured repair context: intent + runtime traces + failures + **proven fixes** from similar past errors. |
| `get_code_lineage` | Trace the full generational history of code (parent → child → grandchild chains). |
| `auto_heal_trigger` | **v0.3** — Trigger autonomous self-repair for a logged failure; generates a patch from historical memory. |
| `auto_heal_status` | **v0.3** — Check the status of an auto-heal task (pending/running/completed/failed). |
| `predict_issue` | **v0.3** — Proactive guardrails: check proposed code BEFORE writing to prevent re-introducing known bugs. |
| `cross_project_search` | **v0.3** — Search failures and proven fixes across ALL your Codememory projects. |

## The repair brief

When something breaks, instead of asking the AI to guess, Codememory gives it:

- The original **intent** behind the code (prompt, file, content hash).
- What the code **actually did** at runtime (inputs, outputs, side effects).
- The exact **failure point** and stack trace.
- **Proven fixes** from similar past errors (same error type, previously resolved).
- A suggested **fix approach** chosen by error type and prior outcomes.

That brief is fetched through one MCP tool call, before any edit, so the
agent stops re-deriving context that was already paid for once.

## Autonomous self-healing

When a failure is logged, Codememory's **auto-heal worker** (background
thread) polls for unresolved failures and automatically generates repair
patches from historical memory. Each patch is a comment-annotated diff
built from proven fixes that resolved the same shape of failure before.

The agent can trigger healing explicitly via `auto_heal_trigger` or let
the background worker handle it. Either way, `auto_heal_status` reports
the task state and the generated patch when ready.

## Proactive guardrails

Before AI writes a single line, `predict_issue` checks the proposed
approach against all known failure patterns — both in the current project
and across any other project sharing the Codememory database. It returns
warnings with confidence levels and risk assessment. This flips the script
from post-mortem bug-fixing to preemptive bug-prevention.

Guard rules are learned automatically: when a failure is resolved, the
resolution's approach and context are distilled into a reusable rule that
fires on any future code matching the same pattern.

## Cross-project knowledge graph

Codememory explicitly models your projects (`projects` table). Intents
link to their parent project. When you call `cross_project_search`, it
finds failures and proven fixes across every project you've registered —
meaning a bug you fixed once in one repo never needs to be rediscovered
in another. Guard rules learned in Project A automatically apply to
Project B.

## Behavioral Time Machine (dashboard)

```bash
codememory dashboard
```

A zero-dependency, single-file HTML dashboard served on `localhost:4210`
visualizes the full lifecycle of your code:

- **Error rate trends** — 90-day rolling window with moving averages
- **Fix effectiveness** — which fix approaches succeed most often
- **Event timeline** — chronological view with filtering tabs (intents,
  failures, resolutions, runtime snapshots)
- Dark-themed, auto-refreshing, no external CDN dependencies

All data is local. Nothing leaves your machine.

## Media

| Asset | Path |
| ----- | ---- |
| Logo | [`assets/Codememory-logo.png`](assets/Codememory-logo.png) |
| Promo video | [`assets/Codememory-promo.mp4`](assets/Codememory-promo.mp4) |

## Examples

See [`examples/`](./examples/) for `basic-capture`, `repair-brief`, and
`runtime-observer`. These are reference implementations for local
development — they import from `src/` and are not shipped in the npm package.

## Development

```bash
pnpm install
pnpm run ci          # typecheck + lint + test + build
```

### Public source archive

To produce a clean ZIP suitable for public distribution (no `node_modules`,
build output, or local databases):

```bash
pwsh -File scripts/package-source.ps1
```

Output: [`release/codememory-source.zip`](release/codememory-source.zip)

## License

MIT — byte271
