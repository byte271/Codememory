import { RuntimeObserver } from '../../src/engines/runtime/observer.js';
import { logger } from '../../src/utils/logger.js';

/**
 * Example: Explicit Runtime Observation
 * This script demonstrates how to wrap a function to record its behavior.
 */
async function example() {
  const observer = new RuntimeObserver(
    'memory-123',
    async (data) => console.log('RECORDED:', data.function_name, 'Success:', data.success),
    async (data) => console.log('FAILURE LOGGED:', data.error_message)
  );

  const add = (a: number, b: number) => {
    if (a < 0) throw new Error('No negatives!');
    return a + b;
  };

  const observedAdd = observer.observe(add, 'add');

  console.log('--- Case 1: Success ---');
  observedAdd(5, 10);

  console.log('\n--- Case 2: Failure ---');
  try {
    observedAdd(-1, 10);
  } catch (e) {
    // Error is caught by observer and re-thrown
  }
}

example().catch(console.error);
