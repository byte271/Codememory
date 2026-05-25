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

- `.mcp.json` — registers Codememory as a Claude Code MCP server (auto-discovered).
- `CODEMEMORY.md` — rules that tell Claude Code when to call which tool
  (`capture_intent`, `record_runtime`, `log_failure`, `query_memory`,
  `get_repair_brief`).

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

## The repair brief

When something breaks, instead of asking the AI to guess, Codememory gives it:

- The original **intent** behind the code (prompt, file, content hash).
- What the code **actually did** at runtime (inputs, outputs, side effects).
- The exact **failure point** and stack trace.
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
`runtime-observer`.

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
