import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  runInit,
  resolveTemplateDir,
  MCP_CONFIG_FILENAME,
  RULES_FILENAME,
} from '../../src/cli/init.js';
import { parseProvider } from '../../src/bin.js';

/**
 * Tests for the `codememory init` command. We exercise the pure {@link runInit}
 * function against a fresh temp directory each test so we never touch the
 * real workspace. Templates are read from the in-repo `src/templates`
 * directory — this also doubles as a sanity check that those templates
 * actually ship with the package.
 */
describe('codememory init', () => {
  const SRC_TEMPLATE_DIR = path.resolve(__dirname, '../../src/templates');
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codememory-init-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .mcp.json and CODEMEMORY.md in an empty target directory', () => {
    const result = runInit({ targetDir: tmpDir, templateDir: SRC_TEMPLATE_DIR });

    expect(result.created).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    expect(result.provider).toBe('claude');

    const mcpPath = path.join(tmpDir, MCP_CONFIG_FILENAME);
    const rulesPath = path.join(tmpDir, RULES_FILENAME);
    expect(fs.existsSync(mcpPath)).toBe(true);
    expect(fs.existsSync(rulesPath)).toBe(true);
  });

  it('v0.2.1: creates .cursor/mcp.json for the cursor provider', () => {
    const result = runInit({
      targetDir: tmpDir,
      templateDir: SRC_TEMPLATE_DIR,
      provider: 'cursor',
    });

    expect(result.provider).toBe('cursor');
    expect(result.created).toHaveLength(2);

    // MCP config goes in .cursor/ subdirectory.
    const mcpPath = path.join(tmpDir, '.cursor', MCP_CONFIG_FILENAME);
    expect(fs.existsSync(mcpPath)).toBe(true);

    // Rules file still goes in the project root.
    const rulesPath = path.join(tmpDir, RULES_FILENAME);
    expect(fs.existsSync(rulesPath)).toBe(true);
  });

  it('v0.2.1: writes MCP config to .codex/ for codex provider', () => {
    const result = runInit({
      targetDir: tmpDir,
      templateDir: SRC_TEMPLATE_DIR,
      provider: 'codex',
    });

    expect(result.provider).toBe('codex');
    const mcpPath = path.join(tmpDir, '.codex', MCP_CONFIG_FILENAME);
    expect(fs.existsSync(mcpPath)).toBe(true);
  });

  it('v0.2.1: writes MCP config to .windsurf/ for windsurf provider', () => {
    const result = runInit({
      targetDir: tmpDir,
      templateDir: SRC_TEMPLATE_DIR,
      provider: 'windsurf',
    });

    expect(result.provider).toBe('windsurf');
    const mcpPath = path.join(tmpDir, '.windsurf', MCP_CONFIG_FILENAME);
    expect(fs.existsSync(mcpPath)).toBe(true);
  });

  it('writes a valid MCP config that registers the codememory server', () => {
    runInit({ targetDir: tmpDir, templateDir: SRC_TEMPLATE_DIR });

    const raw = fs.readFileSync(path.join(tmpDir, MCP_CONFIG_FILENAME), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers.codememory).toBeDefined();
    expect(parsed.mcpServers.codememory.command).toBe('npx');
    expect(parsed.mcpServers.codememory.args).toContain('@opvoid/codememory@0.2.1');
  });

  it('writes CODEMEMORY.md with all tool names and clear trigger rules', () => {
    runInit({ targetDir: tmpDir, templateDir: SRC_TEMPLATE_DIR });

    const rules = fs.readFileSync(path.join(tmpDir, RULES_FILENAME), 'utf8');
    expect(rules).toContain('capture_intent');
    expect(rules).toContain('record_runtime');
    expect(rules).toContain('log_failure');
    expect(rules).toContain('query_memory');
    expect(rules).toContain('get_repair_brief');
    expect(rules.toLowerCase()).toMatch(/before|after|when/);
    expect(rules).toMatch(/MUST|must/);
  });

  it('skips existing files by default and reports them in `skipped`', () => {
    const mcpPath = path.join(tmpDir, MCP_CONFIG_FILENAME);
    const rulesPath = path.join(tmpDir, RULES_FILENAME);
    fs.writeFileSync(mcpPath, '{"existing":true}');
    fs.writeFileSync(rulesPath, '# existing');

    const result = runInit({ targetDir: tmpDir, templateDir: SRC_TEMPLATE_DIR });

    expect(result.created).toHaveLength(0);
    expect(result.skipped).toEqual(
      expect.arrayContaining([mcpPath, rulesPath])
    );
    expect(fs.readFileSync(mcpPath, 'utf8')).toBe('{"existing":true}');
    expect(fs.readFileSync(rulesPath, 'utf8')).toBe('# existing');
  });

  it('overwrites existing files when `force: true`', () => {
    const mcpPath = path.join(tmpDir, MCP_CONFIG_FILENAME);
    fs.writeFileSync(mcpPath, '{"existing":true}');

    const result = runInit({
      targetDir: tmpDir,
      templateDir: SRC_TEMPLATE_DIR,
      force: true,
    });

    expect(result.created).toContain(mcpPath);
    const rewritten = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    expect(rewritten.mcpServers.codememory).toBeDefined();
  });

  it('throws if the target directory does not exist', () => {
    const missing = path.join(tmpDir, 'does-not-exist');
    expect(() =>
      runInit({ targetDir: missing, templateDir: SRC_TEMPLATE_DIR })
    ).toThrow(/does not exist/);
  });

  it('throws a clear error if the template dir is missing required files', () => {
    const emptyTpl = fs.mkdtempSync(path.join(os.tmpdir(), 'codememory-tpl-'));
    try {
      expect(() =>
        runInit({ targetDir: tmpDir, templateDir: emptyTpl })
      ).toThrow(/template not found/);
    } finally {
      fs.rmSync(emptyTpl, { recursive: true, force: true });
    }
  });

  describe('resolveTemplateDir', () => {
    it('finds templates under <binDir>/../src/templates during dev', () => {
      const binDir = path.resolve(__dirname, '../../src/cli');
      const resolved = resolveTemplateDir(binDir);
      expect(fs.existsSync(path.join(resolved, 'mcp-config.json'))).toBe(true);
      expect(fs.existsSync(path.join(resolved, 'codememory-rules.md'))).toBe(true);
    });

    it('throws if no template dir candidate contains the templates', () => {
      const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'codememory-bin-'));
      try {
        expect(() => resolveTemplateDir(isolated)).toThrow(/templates/);
      } finally {
        fs.rmSync(isolated, { recursive: true, force: true });
      }
    });
  });

  describe('parseProvider', () => {
    it('returns claude when no --provider flag is present', () => {
      expect(parseProvider([])).toBe('claude');
      expect(parseProvider(['--force'])).toBe('claude');
      expect(parseProvider(['--help'])).toBe('claude');
    });

    it('returns the provider from --provider <value> form', () => {
      expect(parseProvider(['--provider', 'cursor'])).toBe('cursor');
      expect(parseProvider(['--provider', 'codex'])).toBe('codex');
      expect(parseProvider(['--provider', 'windsurf'])).toBe('windsurf');
    });

    it('returns the provider from --provider=<value> form', () => {
      expect(parseProvider(['--provider=cursor'])).toBe('cursor');
      expect(parseProvider(['--provider=codex'])).toBe('codex');
      expect(parseProvider(['--force', '--provider=windsurf'])).toBe('windsurf');
    });

    it('throws on unknown provider', () => {
      expect(() => parseProvider(['--provider', 'vscode']))
        .toThrow(/Unknown provider/);
      expect(() => parseProvider(['--provider=unknown']))
        .toThrow(/Unknown provider/);
    });

    it('throws when --provider has no value', () => {
      expect(() => parseProvider(['--provider']))
        .toThrow(/requires a value/);
      expect(() => parseProvider(['--provider', '--force']))
        .toThrow(/requires a value/);
    });
  });
});
