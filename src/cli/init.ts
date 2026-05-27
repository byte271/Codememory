import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';

// ── v0.2.1: Multi-provider support ──────────────────────────────────────────

/** Supported AI coding providers. */
export type Provider = 'claude' | 'cursor' | 'codex' | 'windsurf';

/** Per-provider configuration for MCP config file placement. */
export interface ProviderConfig {
  /** Subdirectory under the project root for the MCP config ('' = root). */
  mcpConfigSubdir: string;
  /** The rules file Codememory users should @include from. */
  hostRulesFilename: string;
  /** Human-readable label for CLI output. */
  label: string;
}

/** v0.2.1: Known provider configurations. */
export const PROVIDERS: Record<Provider, ProviderConfig> = {
  claude: {
    mcpConfigSubdir: '',
    hostRulesFilename: 'CLAUDE.md',
    label: 'Claude Code',
  },
  cursor: {
    mcpConfigSubdir: '.cursor',
    hostRulesFilename: '.cursorrules',
    label: 'Cursor',
  },
  codex: {
    mcpConfigSubdir: '.codex',
    hostRulesFilename: 'CODEX.md',
    label: 'OpenAI Codex',
  },
  windsurf: {
    mcpConfigSubdir: '.windsurf',
    hostRulesFilename: '.windsurfrules',
    label: 'Windsurf',
  },
};

/**
 * Result of running `codememory init` — describes which files were created,
 * which already existed (and were skipped), and the resolved target paths.
 * Returned as a structured object so tests and callers can assert behavior
 * without parsing console output. Follows Rule 14 in spirit (structured
 * results, not free-form text).
 */
export interface InitResult {
  created: string[];
  skipped: string[];
  targetDir: string;
  mcpConfigPath: string;
  rulesPath: string;
  provider: Provider;
}

/**
 * Options accepted by {@link runInit}. `targetDir` and `templateDir` are
 * injected so the function is easily unit-testable (no reliance on
 * __dirname or process.cwd resolution at call sites).
 *
 * @property targetDir   Directory the user is initializing — usually their
 *                       project root (process.cwd()).
 * @property templateDir Directory containing `mcp-config.json` and
 *                       `codememory-rules.md` source templates.
 * @property force       When true, overwrite existing files instead of
 *                       skipping. Defaults to false.
 * @property provider    v0.2.1: Target AI coding provider. Defaults to 'claude'.
 */
export interface InitOptions {
  targetDir: string;
  templateDir: string;
  force?: boolean;
  provider?: Provider;
}

/**
 * The MCP config filename (same across all providers).
 */
export const MCP_CONFIG_FILENAME = '.mcp.json';

/**
 * The rules filename Codememory writes into the user's project.
 * Designed to be @include'd from the provider-specific rules file.
 */
export const RULES_FILENAME = 'CODEMEMORY.md';

/**
 * Names of the source template files inside {@link InitOptions.templateDir}.
 */
export const MCP_CONFIG_TEMPLATE = 'mcp-config.json';
export const RULES_TEMPLATE = 'codememory-rules.md';

/**
 * Copy a single template file to a destination, honoring the `force` flag.
 * Returns true if the file was written, false if it already existed and
 * was preserved. Logs every action (Rule 06: no silent operations).
 */
function copyTemplate(
  templatePath: string,
  destPath: string,
  force: boolean
): boolean {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Codememory template not found: ${templatePath}`);
  }
  if (fs.existsSync(destPath) && !force) {
    logger.info(`codememory init: skipped existing file ${destPath}`);
    return false;
  }
  const contents = fs.readFileSync(templatePath, 'utf8');
  fs.writeFileSync(destPath, contents, 'utf8');
  logger.info(`codememory init: wrote ${destPath}`);
  return true;
}

/**
 * Run `codememory init` against a target directory.
 *
 * v0.2.1: Supports multiple AI coding providers via {@link InitOptions.provider}.
 *
 * Generates two files in the target project:
 *   - Provider-specific MCP config (e.g. `.mcp.json` for Claude, `.cursor/mcp.json` for Cursor).
 *   - `CODEMEMORY.md`  — instructions for the AI agent describing when to
 *                    call which Codememory tool. Designed to be @include'd
 *                    from the provider's host rules file (e.g. CLAUDE.md).
 *
 * Existing files are preserved unless {@link InitOptions.force} is true.
 *
 * Pure I/O — no process.exit, no console.log. Returns a structured
 * {@link InitResult} so the CLI wrapper (or a test) can format output.
 */
export function runInit(options: InitOptions): InitResult {
  const { targetDir, templateDir, force = false, provider = 'claude' } = options;
  const providerConfig = PROVIDERS[provider];

  if (!fs.existsSync(targetDir)) {
    throw new Error(`Target directory does not exist: ${targetDir}`);
  }
  if (!fs.statSync(targetDir).isDirectory()) {
    throw new Error(`Target path is not a directory: ${targetDir}`);
  }

  // Resolve the MCP config path (may be in a provider subdirectory).
  const mcpConfigDir = providerConfig.mcpConfigSubdir
    ? path.join(targetDir, providerConfig.mcpConfigSubdir)
    : targetDir;
  if (providerConfig.mcpConfigSubdir && !fs.existsSync(mcpConfigDir)) {
    fs.mkdirSync(mcpConfigDir, { recursive: true });
  }

  const mcpConfigPath = path.join(mcpConfigDir, MCP_CONFIG_FILENAME);
  const rulesPath = path.join(targetDir, RULES_FILENAME);

  const wroteMcp = copyTemplate(
    path.join(templateDir, MCP_CONFIG_TEMPLATE),
    mcpConfigPath,
    force
  );
  const wroteRules = copyTemplate(
    path.join(templateDir, RULES_TEMPLATE),
    rulesPath,
    force
  );

  const created: string[] = [];
  const skipped: string[] = [];
  (wroteMcp ? created : skipped).push(mcpConfigPath);
  (wroteRules ? created : skipped).push(rulesPath);

  return { created, skipped, targetDir, mcpConfigPath, rulesPath, provider };
}

/**
 * Resolve the templates directory shipped with this package. Tries the
 * built layout first (`<bin-dir>/templates`, populated by the postbuild
 * copy step) and falls back to the source layout used during `vitest` /
 * `tsx` runs (`<bin-dir>/../src/templates` and `<bin-dir>/../templates`).
 *
 * Throws if no candidate is found — the package is malformed.
 */
export function resolveTemplateDir(binDir: string): string {
  const candidates = [
    path.join(binDir, 'templates'),
    path.join(binDir, '..', 'templates'),
    path.join(binDir, '..', 'src', 'templates'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, MCP_CONFIG_TEMPLATE))) {
      return candidate;
    }
  }
  throw new Error(
    `Could not locate Codememory templates. Looked in:\n  ${candidates.join('\n  ')}`
  );
}
