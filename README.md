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

## Setup (60 seconds)

> [!NOTE]
> Due to an npm publishing issue, the npm package version `0.2.2` is equivalent to the project release `0.2.1`.
>
> We encountered an issue with the previous npm release and had to republish the package under a new version number. We apologize for the confusion.

```bash
npm install -g @opvoid/codememory
codememory init
```

Then add to your project's `CLAUDE.md`:

```
@include CODEMEMORY.md
```

That's it. Claude Code will automatically capture intent when it writes
code and fetch repair briefs before fixing bugs.

## What `codememory init` creates

- `.mcp.json` — registers Codememory as an MCP server for your provider (Claude Code, Cursor, Codex, or Windsurf).
- `CODEMEMORY.md` — rules that tell the AI agent when to call which tool:
  `capture_intent`, `record_runtime`, `log_failure`, `log_resolution`,
  `query_memory`, `get_repair_brief`, and `get_code_lineage`.

Existing files are preserved by default. Pass `--force` to overwrite.

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

## The MCP tools (all 7)

| Tool | Purpose |
|------|---------|
| `capture_intent` | Record the intent behind generated code (returns a stable `memory_id`). Idempotent — re-capturing the same intent returns `duplicate: true`. |
| `record_runtime` | Record an observed function execution (args, return value, duration). |
| `log_failure` | Record an error tied to a `memory_id`. Validates snapshots belong to the intent. |
| `log_resolution` | Link a resolved failure to the fixing intent (provenance). |
| `query_memory` | Search intents via **FTS5 natural-language search** (keyword/semantic) or filtered query (file_path, status, since). Returns true pagination totals. |
| `get_repair_brief` | Assemble a structured repair context: intent + runtime traces + failures + **proven fixes** from similar past errors. |
| `get_code_lineage` | Trace the full generational history of code (parent → child → grandchild chains). |

## The repair brief

When something breaks, instead of asking the AI to guess, Codememory gives it:

- The original **intent** behind the code (prompt, file, content hash).
- What the code **actually did** at runtime (inputs, outputs, side effects).
- The exact **failure point** and stack trace.
- **Proven fixes** from similar past errors (same error type, previously resolved).
- A suggested **fix approach** chosen by error type and prior outcomes.

That brief is fetched through one MCP tool call, before any edit, so the
agent stops re-deriving context that was already paid for once.

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
