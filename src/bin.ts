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
import { getDashboardPort, getRelayPort } from './config.js';
import { RelayEngine } from './engines/relay/engine.js';
import * as os from 'node:os';

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
 * Handle the `relay` subcommands.
 */
function handleRelay(argv: string[]): void {
  const sub = argv[0];

  if (sub === 'pair') {
    // Display the pairing key for team sharing
    const dbManager = new DatabaseManager();
    const row = dbManager.prepare(
      "SELECT value FROM relay_config WHERE key = 'pairing_key'"
    ).get() as { value: string } | undefined;

    if (row?.value) {
      console.log('');
      console.log('🔑 Your Codememory Pairing Key:');
      console.log(`   ${row.value}`);
      console.log('');
      console.log('Share this key with your team members. They should set:');
      console.log('   export CODEMEMORY_RELAY_PAIRING_KEY=<your-key>');
      console.log('');
      console.log('Or run on their machine:');
      console.log('   codememory relay pair --set <your-key>');
      console.log('');
    } else {
      console.log('No pairing key found. Start the relay first with:');
      console.log('  codememory relay start');
    }

    dbManager.close();
    return;
  }

  if (sub === 'start' || !sub) {
    // Start relay in standalone mode
    const port = getRelayPort();
    const hostname = os.hostname();
    const dbManager = new DatabaseManager();

    const relay = new RelayEngine(dbManager, port, hostname, 'unknown', '0.3.5');
    relay.start();

    const fingerprint = relay.getFingerprint();

    console.log('');
    console.log('📡 Codememory Neural Link — LAN Relay');
    console.log(`   Relay active on port ${port}`);
    console.log(`   Hostname: ${hostname}`);
    console.log(`   Fingerprint: ${fingerprint}`);
    console.log('');
    console.log('Run `codememory relay pair` on another terminal to see your pairing key.');
    console.log('Press Ctrl+C to stop.');
    console.log('');

    const shutdown = async () => {
      await relay.stop();
      dbManager.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  console.log(`Unknown relay subcommand: ${sub}`);
  console.log('Usage: codememory relay [start|pair]');
}

/**
 * Handle the `peers` command — lists LAN peers.
 */
function handlePeers(): void {
  const dbManager = new DatabaseManager();
  const peers = dbManager.prepare(
    'SELECT * FROM peer_nodes ORDER BY last_seen_at DESC'
  ).all() as Array<{
    hostname: string;
    address: string;
    port: number;
    is_online: number;
    project_name: string | null;
    last_seen_at: number;
    last_sync_at: number | null;
  }>;

  if (peers.length === 0) {
    console.log('');
    console.log('No peers discovered yet.');
    console.log('');
    console.log('To enable LAN discovery:');
    console.log('  codememory relay start');
    console.log('');
    dbManager.close();
    return;
  }

  const online = peers.filter((p) => p.is_online === 1);
  const offline = peers.filter((p) => p.is_online === 0);

  console.log('');
  console.log(`🧠 Active Codememory instances on your LAN: ${online.length}`);
  console.log('');

  if (online.length > 0) {
    console.log('  Online:');
    for (const p of online) {
      const ago = Math.round((Date.now() - p.last_seen_at) / 1000);
      console.log(`    ● ${p.hostname} — ${p.address}:${p.port} — ${p.project_name ?? 'unknown'} (${ago}s ago)`);
    }
    console.log('');
  }

  if (offline.length > 0) {
    console.log('  Offline (last seen):');
    for (const p of offline) {
      console.log(`    ○ ${p.hostname} — ${p.project_name ?? 'unknown'}`);
    }
    console.log('');
  }

  dbManager.close();
}

/**
 * Handle the `sync` command — manually pulls collective wisdom.
 */
function handleSync(argv: string[]): void {
  const force = argv.includes('--force') || argv.includes('-f');
  const dbManager = new DatabaseManager();

  if (!force) {
    console.log('');
    console.log('Sync requires --force for manual pulls. Auto-sync runs in the background.');
    console.log('');
    console.log('Usage: codememory sync --force');
    console.log('');
    dbManager.close();
    return;
  }

  const port = getRelayPort();
  const hostname = os.hostname();
  const relay = new RelayEngine(dbManager, port, hostname, 'unknown', '0.3.5');
  relay.start();

  // Give discovery time to find peers
  console.log('');
  console.log('🔄 Scanning LAN for peers...');

  let timer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    relay.stop().then(() => {
      dbManager.close();
      process.exit(0);
    });
  };

  // Handle Ctrl+C during the sync window
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  timer = setTimeout(() => {
    const status = relay.getStatus();
    const peers = relay.getPeers();

    console.log('');
    console.log(`   Peers found: ${peers.length}`);
    console.log(`   Briefs received: ${status.briefs_received}`);
    console.log(`   Briefs shared: ${status.briefs_shared}`);
    console.log('');

    if (peers.length > 0) {
      console.log('Collective wisdom synced! Your AI agent now has access to team learnings.');
    } else {
      console.log('No peers found. Make sure teammates are running `codememory relay start`.');
    }
    console.log('');

    relay.stop().finally(() => dbManager.close());
  }, 3000);
}

/**
 * Print top-level CLI help.
 */
function printHelp(): void {
  console.log(`codememory v0.3.5 — Runtime Behavior Memory for AI-generated code

Usage:
  codememory                              Run the MCP server (stdio).
  codememory init                         Scaffold config + rules (default: Claude Code).
  codememory init --provider cursor       Scaffold for Cursor, Codex, Windsurf, etc.
  codememory init --force                 Overwrite existing files.
  codememory dashboard                    Start the Behavioral Time Machine web UI.
  codememory heal                         List unresolved failures for auto-healing.
  codememory relay start                  Enable LAN relay for team intelligence sharing.
  codememory relay pair                   Display your pairing key for team setup.
  codememory peers                        List all active Codememory instances on your LAN.
  codememory sync --force                 Manually pull collective wisdom from peers.
  codememory --help                       Show this message.
  codememory --version                    Print the version.

v0.3.5 Features:
  📡 LAN Relay                        Zero-config team intelligence via LAN
  🔒 Privacy-First P2P                End-to-end encrypted peer sharing
  🛡️ Collective Guardrails            One-fix-for-all rule broadcasting
  🧠 Hive Mind Dashboard              Team-view timeline and contribution heatmap
`);
}

/**
 * CLI entry point. Dispatches on the first positional argument:
 *   - `init`            -> scaffold project files
 *   - `dashboard`       -> start the visual timeline UI
 *   - `heal`            -> list unresolved failures
 *   - `relay`           -> relay subcommands (start, pair)
 *   - `peers`           -> list LAN peers
 *   - `sync`            -> manual sync from peers
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
    if (cmd === 'relay') {
      handleRelay(argv.slice(1));
      return;
    }
    if (cmd === 'peers') {
      handlePeers();
      return;
    }
    if (cmd === 'sync') {
      handleSync(argv.slice(1));
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
