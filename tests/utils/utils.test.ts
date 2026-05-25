import { describe, it, expect } from 'vitest';
import { sanitizer } from '../../src/utils/sanitizer.js';
import { hash } from '../../src/utils/hash.js';
import { SnapshotBuilder } from '../../src/engines/runtime/snapshot.js';
import { IntentExtractor } from '../../src/engines/intent/extractor.js';
import { IntentBinder } from '../../src/engines/intent/binder.js';
import { RepairFormatter } from '../../src/engines/repair/formatter.js';

describe('Utilities & Builders', () => {
  describe('Sanitizer', () => {
    it('should redact sensitive keys', () => {
      const input = { password: '123', token: 'abc', safe: 'xyz' };
      const output = sanitizer.sanitize(input);
      expect(output.password).toBe('[REDACTED]');
      expect(output.token).toBe('[REDACTED]');
      expect(output.safe).toBe('xyz');
    });

    it('should redact nested keys', () => {
      const input = { user: { secret: '123' } };
      const output = sanitizer.sanitize(input);
      expect((output.user as Record<string, unknown>).secret).toBe('[REDACTED]');
    });

    it('should not redact unrelated keys containing "key" as substring', () => {
      const input = { monkey: 'king', api_key: 'secret', safe: 'ok' };
      const output = sanitizer.sanitize(input) as Record<string, unknown>;
      expect(output.monkey).toBe('king');
      expect(output.api_key).toBe('[REDACTED]');
      expect(output.safe).toBe('ok');
    });
  });

  describe('Hash', () => {
    it('should generate consistent hashes', () => {
      const h1 = hash.generateMemoryId('content', 123);
      const h2 = hash.generateMemoryId('content', 123);
      expect(h1).toBe(h2);
      expect(h1).toHaveLength(64);
    });

    it('should generate unique IDs for rapid successive calls', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 200; i++) {
        ids.add(hash.generateUniqueId('same-prefix'));
      }
      expect(ids.size).toBe(200);
    });
  });

  describe('SnapshotBuilder', () => {
    it('should build a valid snapshot', () => {
      const builder = new SnapshotBuilder();
      const snapshot = builder.build({
        intent_id: 'intent-1',
        function_name: 'testFn',
        file_path: 'file.ts',
        arguments: JSON.stringify([1, 2]),
        return_value: '3',
        duration_ms: 100,
        success: 1
      });
      expect(snapshot.intent_id).toBe('intent-1');
      expect(snapshot.function_name).toBe('testFn');
      expect(snapshot.success).toBe(1);
    });
  });

  describe('IntentExtractor', () => {
    it('should extract intent from prompt', () => {
      const extractor = new IntentExtractor();
      const intent = extractor.extract('  Write a fib function  ');
      expect(intent).toBe('Write a fib function');
    });
  });

  describe('IntentBinder', () => {
    it('should bind memory_id to code', () => {
      const binder = new IntentBinder();
      const bound = binder.bind('const x = 1;', 'mem-123');
      expect(bound).toContain('// memory_id: mem-123');
    });
  });

  describe('RepairFormatter', () => {
    it('should format a repair brief', () => {
      const formatter = new RepairFormatter();
      const brief = formatter.format({ intent: 'intent' });
      expect(brief).toContain('"intent": "intent"');
    });
  });
});
