import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MCP_TOOL_NAMES } from '../../src/mcp/tool-names.js';

/**
 * Guards against MCP tool names drifting from CODEMEMORY.md / README.
 * Agents follow CODEMEMORY.md; the server must expose the same identifiers.
 */
describe('MCP tool names', () => {
  const rulesPath = path.resolve(__dirname, '../../src/templates/codememory-rules.md');
  const rules = fs.readFileSync(rulesPath, 'utf8');

  it('matches every canonical name documented in CODEMEMORY.md', () => {
    for (const name of Object.values(MCP_TOOL_NAMES)) {
      expect(rules).toContain(name);
    }
  });

  it('does not expose legacy memory_* prefixed names in docs', () => {
    expect(rules).not.toContain('memory_capture_intent');
    expect(rules).not.toContain('memory_record_runtime');
  });
});
