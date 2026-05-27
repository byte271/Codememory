#!/usr/bin/env node
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodememoryServer } from './mcp/server.js';
import { DashboardServer } from './web/server.js';
import { DatabaseManager } from './store/database.js';
import { AutoHealEngine } from './engines/heal/auto-heal.js';
import { IntentQueries } from './store/queries/intent.js';
import { RuntimeQueries } from './store/queries/runtime.js';
import { RepairAssembler } from './engines/repair/assembler.js';
import { RepairProvenance } from './engines/repair/provenance.js';
import { logger } from './utils/logger.js';
import { runInit, resolveTemplateDir, PROVIDERS, Provider } from './cli/init.js';
import { getDashboardPort } from './config.js';

/**
 * Resolve the directory of this binary at runtime, working under both
 * CJS (`__dirname` is defined) and ESM (`import.meta.url`) builds tsup
 * emits. Used to locate the bundled `templates/` folder.
 */
function getBinDir(): string {
  if (typeof __dirname !== 'undefined') {
    return __dirname;
  }
  // eslint-disable-next-line no-eval
  const url: string = eval('import.meta.url') as string;
  return path.dirname(fileURLToPath(url));
}

/**
 * Print human-readable output for `codememory init`.
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
 * Parse the --provider flag from CLI args.
 */
export function parseProvider(argv: string[]): Provider {
  let value: string | undefined;
  let found = false;

  const idx = argv.indexOf('--provider');
  if (idx !== -1) {
    found = true;
    value = argv[idx + 1];
  } else {
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
 * Handle the `init` subcommand.
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
 * Handle the `dashboard` subcommand — starts the web UI standalone.
 */
function handleDashboard(): void {
  const port = getDashboardPort();
  const dbManager = new DatabaseManager();
  const dashboard = new DashboardServer(dbManager, port);
  dashboard.start();

  console.log('');
  console.log('🧠 Codememory Behavioral Time Machine');
  console.log(`   Dashboard running at http://127.0.0.1:${port}`);
  console.log('');
  console.log('Press Ctrl+C to stop.');

  const shutdown = async () => {
    await dashboard.stop();
    dbManager.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Handle the `heal` subcommand — triggers auto-heal for unresolved failures.
 */
async function handleHeal(): Promise<void> {
  const dbManager = new DatabaseManager();
  const failures = dbManager.prepare(
    "SELECT * FROM failures WHERE repair_status = 'unresolved' ORDER BY failed_at ASC LIMIT 10"
  ).all() as Array<{ id: string; error_type: string; error_message: string }>;

  if (failures.length === 0) {
    console.log('No unresolved failures found. Everything is clean! ✨');
    dbManager.close();
    return;
  }

  console.log(`Found ${failures.length} unresolved failure(s):`);
  for (const f of failures) {
    console.log(`  - ${f.id}: ${f.error_type}: ${f.error_message.slice(0, 80)}`);
  }
  console.log('');

  // v0.3: Actually trigger auto-heal for these failures
  const intentQueries = new IntentQueries(dbManager);
  const runtimeQueries = new RuntimeQueries(dbManager);
  const provenance = new RepairProvenance(dbManager);
  const assembler = new RepairAssembler(intentQueries, runtimeQueries, provenance);
  const engine = new AutoHealEngine(dbManager, intentQueries, runtimeQueries, assembler);

  console.log('Initiating auto-healing...');
  for (const f of failures) {
    try {
      const task = engine.queueTask(f.id);
      const completed = await engine.executeTask(task.id);
      console.log(`  - ${f.id}: ${completed.status} — ${completed.status === 'completed' ? '✓' : '✗'}`);
    } catch (err) {
      console.error(`  - ${f.id}: error — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log('');
  console.log('Run the MCP server for continuous background auto-healing:');
  console.log('  codememory');
  dbManager.close();
}

/**
 * Print top-level CLI help.
 */
function printHelp(): void {
  console.log(`codememory v0.3.0 — Runtime Behavior Memory for AI-generated code

Usage:
  codememory                              Run the MCP server (stdio).
  codememory init                         Scaffold config + rules (default: Claude Code).
  codememory init --provider cursor       Scaffold for Cursor, Codex, Windsurf, etc.
  codememory init --force                 Overwrite existing files.
  codememory dashboard                    Start the Behavioral Time Machine web UI.
  codememory heal                         List unresolved failures for auto-healing.
  codememory --help                       Show this message.

v0.3.0 Features:
  🤖 Autonomous Self-Healing         Auto-generate patches from failures
  🛡️ Proactive Guardrails            Predict issues before code is written
  🔗 Cross-Project Knowledge Graph   Share learnings across projects
  ⏱️ Behavioral Time Machine         Visual timeline of code evolution
`);
}

/**
 * CLI entry point. Dispatches on the first positional argument:
 *   - `init`            -> scaffold project files
 *   - `dashboard`       -> start the visual timeline UI
 *   - `heal`            -> list unresolved failures
 *   - `--help` / `-h`   -> print help
 *   - (none)            -> start the MCP server (default)
 */
async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  try {
    if (cmd === 'init') {
      handleInit(argv.slice(1));
      return;
    }
    if (cmd === 'dashboard') {
      handleDashboard();
      return;
    }
    if (cmd === 'heal') {
      await handleHeal();
      return;
    }
    if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pkg = require('../package.json') as { version: string };
      console.log(pkg.version);
      return;
    }
    if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
      printHelp();
      return;
    }

    const server = new CodememoryServer();

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
