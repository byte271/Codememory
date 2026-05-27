import { describe, it, expect, vi } from 'vitest';
import { RuntimeObserver } from '../../src/engines/runtime/observer.js';

describe('RuntimeObserver', () => {
  it('should observe function execution and record results', async () => {
    const onRecord = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn().mockResolvedValue(undefined);
    const observer = new RuntimeObserver('test-memory-id', onRecord, onFailure);

    const add = (a: number, b: number) => a + b;
    const observedAdd = observer.observe(add, 'add');

    const result = observedAdd(2, 3);
    expect(result).toBe(5);

    // recordSuccess is fire-and-forget — wait for the microtask queue to flush
    await vi.waitFor(() => {
      expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({
        memory_id: 'test-memory-id',
        function_name: 'add',
        file_path: 'unknown',
        success: true,
      }));
    });
  });

  it('should include a custom file_path when provided', async () => {
    const onRecord = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn().mockResolvedValue(undefined);
    const observer = new RuntimeObserver(
      'test-memory-id',
      onRecord,
      onFailure,
      'src/math.ts'
    );
    const add = (a: number, b: number) => a + b;
    observer.observe(add, 'add')(1, 2);
    await vi.waitFor(() => {
      expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({
        file_path: 'src/math.ts',
      }));
    });
  });

  it('should handle errors and log failures', async () => {
    const onRecord = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn().mockResolvedValue(undefined);
    const observer = new RuntimeObserver('test-memory-id', onRecord, onFailure);

    const fail = () => { throw new Error('Boom'); };
    const observedFail = observer.observe(fail, 'fail');

    // Sync functions throw synchronously through the Proxy — use toThrow, not rejects.toThrow
    expect(() => observedFail()).toThrow('Boom');

    await vi.waitFor(() => {
      expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
      }));
      expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
        error_message: 'Boom',
        error_type: 'Error',
      }));
    });
  });

  it('should pass snapshot_id from onRecord into onFailure', async () => {
    const onRecord = vi.fn().mockResolvedValue({ snapshot_id: 'snap-abc' });
    const onFailure = vi.fn().mockResolvedValue(undefined);
    const observer = new RuntimeObserver('test-memory-id', onRecord, onFailure);

    const fail = () => { throw new Error('Boom'); };
    expect(() => observer.observe(fail, 'fail')()).toThrow('Boom');

    await vi.waitFor(() => {
      expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
        snapshot_id: 'snap-abc',
      }));
    });
  });

  it('should handle async functions', async () => {
    const onRecord = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn().mockResolvedValue(undefined);
    const observer = new RuntimeObserver('test-memory-id', onRecord, onFailure);

    const asyncAdd = async (a: number, b: number) => {
      return new Promise<number>(resolve => setTimeout(() => resolve(a + b), 10));
    };
    const observedAsyncAdd = observer.observe(asyncAdd, 'asyncAdd');

    const result = await observedAsyncAdd(10, 20);
    expect(result).toBe(30);

    await vi.waitFor(() => {
      expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({
        function_name: 'asyncAdd',
        return_value: 30,
        success: true,
      }));
    });
  });
});
