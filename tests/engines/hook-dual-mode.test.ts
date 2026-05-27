import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InstrumentationHook } from '../../src/engines/runtime/hook.js';
import { RuntimeObserver } from '../../src/engines/runtime/observer.js';
import { logger } from '../../src/utils/logger.js';

describe('InstrumentationHook ESM/CJS dual mode', () => {
  let observer: RuntimeObserver;
  let hook: InstrumentationHook;

  beforeEach(() => {
    observer = new RuntimeObserver(
      'test-memory-id',
      async () => {},
      async () => {}
    );
    hook = new InstrumentationHook(observer);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detectModuleSystem returns a valid value', () => {
    const mode = InstrumentationHook.detectModuleSystem();
    expect(['cjs', 'esm']).toContain(mode);
  });

  it('startESM does not throw and only logs a warning', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    expect(() => hook.startESM()).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('ESM');
    expect(message).toContain('RuntimeObserver');
  });

  it('start dispatches based on detected module system without throwing', () => {
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    expect(() => hook.start()).not.toThrow();
  });
});
