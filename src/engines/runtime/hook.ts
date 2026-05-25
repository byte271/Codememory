import Module from 'module';
import { logger } from '../../utils/logger.js';
import { isLocalModuleRequest, normalizeModuleLabel } from '../../utils/local-module.js';
import { RuntimeObserver } from './observer.js';

/**
 * Interface for the internal Node.js module loader.
 */
interface NodeModuleLoader {
  _load: (request: string, parent: Module | null, isMain: boolean) => unknown;
}

/**
 * Node.js require hook for auto-instrumentation.
 * Supports both CommonJS (auto via Module._load) and ESM (manual via observer API).
 * Follows Rule 03: NEVER write a function without a JSDoc comment explaining intent.
 * Follows Rule 19: hook.ts MUST always support both CJS and ESM modes.
 */
export class InstrumentationHook {
  private observer: RuntimeObserver;
  private originalLoader: (request: string, parent: Module | null, isMain: boolean) => unknown;

  /**
   * Initializes the hook with a runtime observer.
   * @param observer The observer to use for recording behavior.
   */
  constructor(observer: RuntimeObserver) {
    this.observer = observer;
    const moduleWithLoader = Module as unknown as NodeModuleLoader;
    this.originalLoader = moduleWithLoader._load;
  }

  /**
   * Detects whether the current runtime uses CommonJS or ESM.
   * Returns 'cjs' if CommonJS globals (e.g. __filename) are defined, otherwise 'esm'.
   * @returns The detected module system identifier.
   */
  public static detectModuleSystem(): 'cjs' | 'esm' {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = globalThis as unknown as { __filename?: string };
      if (typeof g.__filename !== 'undefined') return 'cjs';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const maybeRequire = (Module as unknown as { createRequire?: unknown }).createRequire;
      if (typeof maybeRequire === 'function' && typeof g.__filename === 'undefined') {
        return 'esm';
      }
    } catch {
      // ignore
    }
    return 'esm';
  }

  /**
   * CJS mode: monkey-patches Module._load to auto-instrument local file imports.
   * Mutates module.exports in place so require() cache stays consistent.
   */
  public startCJS(): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- required for CJS patch closure
    const self = this;
    const moduleWithLoader = Module as unknown as NodeModuleLoader;

    moduleWithLoader._load = function(request: string, parent: Module | null, isMain: boolean) {
      const exports = self.originalLoader.apply(this, [request, parent, isMain]);

      if (isLocalModuleRequest(request)) {
        return self.instrument(normalizeModuleLabel(request), exports);
      }

      return exports;
    };
    logger.info('[Codememory] Auto-instrumentation hook started (CJS mode)');
  }

  /**
   * ESM mode: cannot auto-instrument via Module._load.
   * Logs a clear warning explaining how to use the manual observer API instead.
   */
  public startESM(): void {
    logger.warn([
      '[Codememory] ESM module system detected.',
      '[Codememory] Automatic instrumentation via Module._load is not available in ESM.',
      '[Codememory] To instrument your ESM project, use the manual observer API:',
      '[Codememory]   import { RuntimeObserver } from "@opvoid/codememory"',
      '[Codememory]   const observed = observer.observe(yourFunction, "functionName")',
    ].join('\n'));
  }

  /**
   * Auto-detects the module system and starts the appropriate instrumentation mode.
   */
  public start(): void {
    const mode = InstrumentationHook.detectModuleSystem();
    logger.info(`[Codememory] Module system detected: ${mode.toUpperCase()}`);
    if (mode === 'cjs') {
      this.startCJS();
    } else {
      this.startESM();
    }
  }

  /**
   * Instruments exports in place so Module._load returns the same object reference
   * that is cached by require().
   *
   * @param moduleName The name of the module to instrument.
   * @param exports The exported members of the module.
   * @returns The same exports reference with functions wrapped.
   */
  public instrument<T>(moduleName: string, exports: T): T {
    try {
      if (typeof exports === 'function') {
        return this.observer.observe(exports as (...args: unknown[]) => unknown, moduleName) as unknown as T;
      }

      if (typeof exports !== 'object' || exports === null) {
        return exports;
      }

      const record = exports as Record<string, unknown>;
      let hasFunctions = false;

      for (const [key, value] of Object.entries(record)) {
        if (typeof value === 'function') {
          record[key] = this.observer.observe(
            value as (...args: unknown[]) => unknown,
            `${moduleName}.${key}`
          );
          hasFunctions = true;
        }
      }

      if (hasFunctions) {
        logger.info(`Auto-instrumented module: ${moduleName}`);
      }

      return exports;
    } catch (error) {
      logger.error(`Failed to instrument module: ${moduleName}`, error, { rule: 'Rule 06' });
      return exports;
    }
  }
}
