#!/usr/bin/env node
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodememoryServer } from './mcp/server.js';
import { logger } from './utils/logger.js';
import { runInit, resolveTemplateDir, PROVIDERS, Provider } from './cli/init.js';

/**
 * Resolve the directory of this binary at runtime, working under both
 * CJS (`__dirname` is defined) and ESM (`import.meta.url`) builds tsup
 * emits. Used to locate the bundled `templates/` folder.
 */
function getBinDir(): string {
  if (typeof __dirname !== 'undefined') {
    return __dirname;
  }
  // ESM fallback. `import.meta.url` exists in ESM only; we must use eval()
  // here because the source is compiled to CJS by tsup, which would choke on
  // bare `import.meta.url` syntax at parse time. The eval defers parsing to
  // runtime, where `import.meta.url` is only evaluated in the ESM code path.
  // eslint-disable-next-line no-eval
  const url: string = eval('import.meta.url') as string;
  return path.dirname(fileURLToPath(url));
}

/**
 * Print human-readable output for `codememory init`. The underlying
 * {@link runInit} returns structured data; this wrapper turns that into
 * a friendly console message. Kept intentionally tiny so tests can
 * exercise {@link runInit} directly without stubbing stdout.
 */
function printInitResult(
  created: string[],
  skipped: string[],
  targetDir: string,
  provider: Provider
): void {
  const rel = (p: string) => path.relative(targetDir, p) || p;
  const cfg = PROVIDERS[provider];
  if (created.length > 0) {
    console.log(`codememory init: created ${created.length} file(s) for ${cfg.label}:`);
    for (const f of created) console.log(`  + ${rel(f)}`);
  }
  if (skipped.length > 0) {
    console.log(
      `codememory init: skipped ${skipped.length} existing file(s) (use --force to overwrite):`
    );
    for (const f of skipped) console.log(`  - ${rel(f)}`);
  }
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Open this project in ${cfg.label}.`);
  console.log('  2. The provider auto-loads the MCP config and starts Codememory via stdio.');
  console.log(`  3. @include CODEMEMORY.md from your ${cfg.hostRulesFilename} (or paste it in)`);
  console.log('     so the agent knows when to call which Codememory tool.');
}

/**
 * Parse the --provider flag from CLI args. Validates against known providers.
 */
export function parseProvider(argv: string[]): Provider {
  // Support both `--provider cursor` and `--provider=cursor` forms.
  let value: string | undefined;
  let found = false;

  const idx = argv.indexOf('--provider');
  if (idx !== -1) {
    found = true;
    value = argv[idx + 1];
  } else {
    // Check for --provider=<value> form.
    const eqArg = argv.find((a) => a.startsWith('--provider='));
    if (eqArg) {
      found = true;
      value = eqArg.slice('--provider='.length);
    }
  }

  if (!found) return 'claude';

  if (!value || value.startsWith('-')) {
    throw new Error(
      `--provider requires a value. Supported: ${Object.keys(PROVIDERS).join(', ')}`
    );
  }
  if (!(value in PROVIDERS)) {
    throw new Error(
      `Unknown provider "${value}". Supported: ${Object.keys(PROVIDERS).join(', ')}`
    );
  }
  return value as Provider;
}

/**
 * Handle the `init` subcommand. Generates provider-specific MCP config
 * and `CODEMEMORY.md` in the user's current working directory.
 */
function handleInit(argv: string[]): void {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`codememory init - Scaffold Codememory into the current project.

Usage:
  codememory init                   Create config + rules for Claude Code (default).
  codememory init --provider <p>    Target a specific provider (cursor, codex, windsurf).
  codememory init --force           Overwrite existing files.
  codememory init --help            Show this message.

Supported providers: ${Object.keys(PROVIDERS).join(', ')}
`);
    return;
  }
  const force = argv.includes('--force') || argv.includes('-f');
  const provider = parseProvider(argv);
  const targetDir = process.cwd();
  const templateDir = resolveTemplateDir(getBinDir());
  const result = runInit({ targetDir, templateDir, force, provider });
  printInitResult(result.created, result.skipped, result.targetDir, result.provider);
}

/**
 * Print top-level CLI help.
 */
function printHelp(): void {
  console.log(`codememory - Runtime Behavior Memory for AI-generated code

Usage:
  codememory                          Run the Codememory MCP server (stdio).
  codememory init                     Scaffold config + rules (default: Claude Code).
  codememory init --provider cursor   Scaffold for Cursor, Codex, Windsurf, etc.
  codememory init --force             Overwrite existing files.
  codememory --help                   Show this message.
`);
}

/**
 * CLI entry point. Dispatches on the first positional argument:
 *   - `init`            -> scaffold project files
 *   - `--help` / `-h`   -> print help
 *   - (none)            -> start the MCP server (default)
 *
 * Follows Rule 06: every failure path is logged with full context before exit.
 */
async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  try {
    if (cmd === 'init') {
      handleInit(argv.slice(1));
      return;
    }
    if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
      printHelp();
      return;
    }

    const server = new CodememoryServer();

    // Graceful shutdown on SIGINT (Ctrl+C) and SIGTERM.
    const shutdown = async () => {
      await server.shutdown();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    await server.run();
  } catch (error) {
    logger.error('codememory CLI failed', error);
    process.exit(1);
  }
}

run();
