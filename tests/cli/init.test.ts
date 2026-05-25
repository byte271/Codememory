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

    const mcpPath = path.join(tmpDir, MCP_CONFIG_FILENAME);
    const rulesPath = path.join(tmpDir, RULES_FILENAME);
    expect(fs.existsSync(mcpPath)).toBe(true);
    expect(fs.existsSync(rulesPath)).toBe(true);
  });

  it('writes a valid MCP config that registers the codememory server', () => {
    runInit({ targetDir: tmpDir, templateDir: SRC_TEMPLATE_DIR });

    const raw = fs.readFileSync(path.join(tmpDir, MCP_CONFIG_FILENAME), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers.codememory).toBeDefined();
    expect(parsed.mcpServers.codememory.command).toBe('npx');
    expect(parsed.mcpServers.codememory.args).toContain('@opvoid/codememory');
  });

  it('writes CODEMEMORY.md with all five tool names and clear trigger rules', () => {
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
});
