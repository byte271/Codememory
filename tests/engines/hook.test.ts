import { describe, it, expect, beforeEach } from 'vitest';
import { InstrumentationHook } from '../../src/engines/runtime/hook.js';
import { RuntimeObserver } from '../../src/engines/runtime/observer.js';

describe('InstrumentationHook', () => {
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

  it('should instrument an object with functions in place', () => {
    const original = {
      add: (a: number, b: number) => a + b,
      value: 42
    };

    const addBefore = original.add;
    const instrumented = hook.instrument('test-module', original);

    expect(instrumented).toBe(original);
    expect(instrumented.value).toBe(42);
    expect(typeof instrumented.add).toBe('function');
    expect(instrumented.add).not.toBe(addBefore);
  });

  it('should instrument a direct function export', () => {
    const original = (a: number, b: number) => a + b;
    
    const instrumented = hook.instrument('test-module', original);
    
    expect(typeof instrumented).toBe('function');
    expect(instrumented).not.toBe(original);
  });

  it('should not instrument non-objects', () => {
    expect(hook.instrument('test', 42)).toBe(42);
    expect(hook.instrument('test', 'hello')).toBe('hello');
    expect(hook.instrument('test', null)).toBe(null);
  });
});
