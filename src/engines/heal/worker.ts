import { parentPort, workerData } from 'node:worker_threads';

/**
 * Auto-Heal Worker — Background thread for polling unresolved failures.
 *
 * This worker runs in a separate thread and periodically checks the
 * database for unresolved failures that need auto-healing. When it
 * finds one, it sends a message to the main thread to trigger the
 * auto-heal pipeline.
 *
 * The main thread is responsible for the actual database access and
 * patch generation; this worker only handles the polling loop.
 *
 * v0.3.0: Autonomous Self-Repair Loop
 */

const POLL_INTERVAL_MS: number = workerData?.pollIntervalMs ?? 30_000;

/** Whether the worker should continue polling. */
let running = true;

/**
 * Main polling loop — checks for pending tasks and notifies main thread.
 */
async function poll(): Promise<void> {
  while (running) {
    try {
      // Signal the main thread to check for pending tasks
      parentPort?.postMessage({ type: 'check_pending' });
    } catch {
      // Worker communication errors are non-fatal
    }

    // Wait for the next poll interval or until shutdown is received
    await new Promise<void>((resolve) => {
      const onShutdown = (msg: { type: string }) => {
        if (msg.type === 'shutdown') {
          clearTimeout(timeout);
          running = false;
          parentPort?.off('message', onShutdown);
          resolve();
        }
      };
      const timeout = setTimeout(() => {
        parentPort?.off('message', onShutdown);
        resolve();
      }, POLL_INTERVAL_MS);
      parentPort?.on('message', onShutdown);
    });
  }
}

// Start polling
void poll();

// Handle shutdown signal
parentPort?.on('message', (msg: { type: string }) => {
  if (msg.type === 'shutdown') {
    running = false;
  }
});
