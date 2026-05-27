#!/usr/bin/env node
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodememoryServer } from './mcp/server.js';
import { logger } from './utils/logger.js';
import { runInit, resolveTemplateDir } from './cli/init.js';

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
  targetDir: string
): void {
  const rel = (p: string) => path.relative(targetDir, p) || p;
  if (created.length > 0) {
    console.log(`codememory init: created ${created.length} file(s):`);
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
  console.log('  1. Open this project in Claude Code.');
  console.log('  2. Claude Code auto-loads .mcp.json and starts Codememory via stdio.');
  console.log('  3. Reference CODEMEMORY.md from your CLAUDE.md (or paste it in)');
  console.log('     so the agent knows when to call which Codememory tool.');
}

/**
 * Handle the `init` subcommand. Generates `.mcp.json` and `CODEMEMORY.md`
 * in the user's current working directory.
 */
function handleInit(argv: string[]): void {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`codememory init - Scaffold Codememory into the current project.

Usage:
  codememory init             Create .mcp.json and CODEMEMORY.md (skip existing).
  codememory init --force     Overwrite existing .mcp.json and CODEMEMORY.md.
  codememory init --help      Show this message.
`);
    return;
  }
  const force = argv.includes('--force') || argv.includes('-f');
  const targetDir = process.cwd();
  const templateDir = resolveTemplateDir(getBinDir());
  const result = runInit({ targetDir, templateDir, force });
  printInitResult(result.created, result.skipped, result.targetDir);
}

/**
 * Print top-level CLI help.
 */
function printHelp(): void {
  console.log(`codememory - Runtime Behavior Memory for AI-generated code

Usage:
  codememory                Run the Codememory MCP server (stdio).
  codememory init           Scaffold .mcp.json and CODEMEMORY.md in the current dir.
  codememory init --force   Overwrite existing .mcp.json / CODEMEMORY.md.
  codememory --help         Show this message.
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
    await server.run();
  } catch (error) {
    logger.error('codememory CLI failed', error);
    process.exit(1);
  }
}

run();
