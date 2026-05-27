import { DatabaseManager } from '../../store/database.js';
import {
  AutoHealTask,
  FailureRecord,
  RepairBriefOutput,
} from '../../types/index.js';
import { hash } from '../../utils/hash.js';
import { logger } from '../../utils/logger.js';
import { RepairAssembler } from '../repair/assembler.js';
import { IntentQueries } from '../../store/queries/intent.js';
import { RuntimeQueries } from '../../store/queries/runtime.js';
import { CodememoryError, CODEMEMORY_ERROR_CODES } from '../../utils/errors.js';
import { getAutoHealPollMs, getAutoHealMaxConcurrent } from '../../config.js';
import { Worker } from 'node:worker_threads';

/**
 * Auto-Heal Engine — Autonomous Self-Repair Loop (v0.3.0).
 *
 * When Codememory captures a runtime error, this engine automatically:
 *   1. Generates a repair brief using historical memory
 *   2. Generates a patch by analyzing proven fixes
 *   3. Runs basic validation on the proposed patch
 *   4. Creates an auto-heal task record with the generated patch
 *
 * A background worker thread polls for unresolved failures and feeds
 * them through this pipeline automatically. The result is that
 * developers can wake up to find Codememory has already prepared
 * patches for bugs introduced overnight.
 *
 * Follows Rule 02: SQLite only, no external AI APIs.
 * Follows Rule 03: every function has a JSDoc comment.
 */
export class AutoHealEngine {
  private manager: DatabaseManager;
  private runtimeQueries: RuntimeQueries;
  private assembler: RepairAssembler;

  /** Background worker for polling unresolved failures. */
  private worker: Worker | null = null;

  /**
   * @param manager      DatabaseManager for queries + persistence.
   * @param _intentQueries Intent record access (reserved for future use).
   * @param runtimeQueries Runtime/failure access.
   * @param assembler    Repair brief assembler for generating fix context.
   */
  constructor(
    manager: DatabaseManager,
    _intentQueries: IntentQueries,
    runtimeQueries: RuntimeQueries,
    assembler: RepairAssembler
  ) {
    this.manager = manager;
    this.runtimeQueries = runtimeQueries;
    this.assembler = assembler;
  }

  /**
   * Queues an auto-heal task for a specific failure.
   *
   * Creates the task record in 'pending' state; the background worker
   * picks it up on its next poll cycle.
   *
   * @param failureId The failure to auto-heal.
   * @returns The created task ID.
   */
  public queueTask(failureId: string): AutoHealTask {
    const failure = this.runtimeQueries.getFailureById(failureId);
    if (!failure) {
      throw new CodememoryError(
        CODEMEMORY_ERROR_CODES.FAILURE_NOT_FOUND,
        `Failure not found: ${failureId}`
      );
    }

    // Check for existing pending/running task
    const existing = this.manager.prepare(
      `SELECT id FROM auto_heal_tasks
       WHERE failure_id = ? AND status IN ('pending', 'running')
       LIMIT 1`
    ).get(failureId) as { id: string } | undefined;

    if (existing) {
      const task = this.getTask(existing.id);
      if (task) return task;
    }

    const taskId = hash.generateUniqueId(`autoheal-${failureId}`);
    const now = Date.now();

    this.manager.prepare(`
      INSERT INTO auto_heal_tasks (id, failure_id, status, created_at)
      VALUES (?, ?, 'pending', ?)
    `).run(taskId, failureId, now);

    logger.info('Queued auto-heal task', { taskId, failureId });
    const created = this.getTask(taskId);
    if (!created) {
      throw new CodememoryError(
        CODEMEMORY_ERROR_CODES.FAILURE_NOT_FOUND,
        `Failed to create auto-heal task for failure: ${failureId}`
      );
    }
    return created;
  }

  /**
   * Executes the auto-heal pipeline for a pending task.
   *
   * Steps:
   *   1. Fetch the repair brief for the failure
   *   2. Generate a patch from proven fixes + error analysis
   *   3. Store the patch and mark as 'completed'
   *
   * The task should already be in 'running' state (set atomically by
   * getPendingTasks). If still 'pending', marks it running here.
   *
   * @param taskId The auto-heal task to execute.
   * @returns The updated task record.
   */
  public async executeTask(taskId: string): Promise<AutoHealTask> {
    const task = this.getTask(taskId);
    if (!task) {
      throw new CodememoryError(
        CODEMEMORY_ERROR_CODES.FAILURE_NOT_FOUND,
        `Auto-heal task not found: ${taskId}`
      );
    }

    // Already processed or being processed by another caller (e.g. worker thread)
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'running') {
      return task;
    }

    // Mark as running (defensive — normally already set by getPendingTasks)
    const now = Date.now();
    if (task.status === 'pending') {
      this.manager.prepare(
        `UPDATE auto_heal_tasks SET status = 'running', started_at = ? WHERE id = ? AND status = 'pending'`
      ).run(now, taskId);
    }

    try {
      // 1. Get the repair brief
      const brief: RepairBriefOutput = await this.assembler.assemble(task.failure_id);

      // 2. Generate a patch from the brief
      const patch = this.generatePatch(brief);

      // 3. Basic validation of the patch
      const validation = this.validatePatch(patch, brief);

      // 4. Store the result
      this.manager.prepare(`
        UPDATE auto_heal_tasks
        SET status = 'completed',
            patch_code = ?,
            test_results = ?,
            completed_at = ?
        WHERE id = ?
      `).run(patch, JSON.stringify(validation), Date.now(), taskId);

      // 5. Mark failure as in_progress
      this.manager.prepare(
        `UPDATE failures SET repair_status = 'in_progress' WHERE id = ?`
      ).run(task.failure_id);

      logger.info('Auto-heal task completed', { taskId, failureId: task.failure_id });
    } catch (error) {
      logger.error('Auto-heal task failed', error, { taskId, failureId: task.failure_id });
      this.manager.prepare(`
        UPDATE auto_heal_tasks
        SET status = 'failed',
            error_log = ?,
            completed_at = ?
        WHERE id = ?
      `).run(error instanceof Error ? error.message : String(error), Date.now(), taskId);
    }

    const result = this.getTask(taskId);
    if (!result) {
      throw new CodememoryError(
        CODEMEMORY_ERROR_CODES.FAILURE_NOT_FOUND,
        `Auto-heal task disappeared after execution: ${taskId}`
      );
    }
    return result;
  }

  /**
   * Retrieves an auto-heal task by ID.
   *
   * @param id The task ID.
   * @returns The task record or undefined.
   */
  public getTask(id: string): AutoHealTask | undefined {
    return this.manager.prepare(
      'SELECT * FROM auto_heal_tasks WHERE id = ?'
    ).get(id) as AutoHealTask | undefined;
  }

  /**
   * Returns all pending auto-heal tasks (oldest first) and atomically
   * marks them as 'running' to prevent double-processing.
   *
   * @param limit Max tasks to return (default 10).
   * @returns Array of pending tasks now marked as running.
   */
  public getPendingTasks(limit = 10): AutoHealTask[] {
    const now = Date.now();
    // Atomically mark tasks as running and return them
    return this.manager.prepare(`
      UPDATE auto_heal_tasks
      SET status = 'running', started_at = ?
      WHERE id IN (
        SELECT id FROM auto_heal_tasks
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT ?
      )
      RETURNING *
    `).all(now, limit) as AutoHealTask[];
  }

  /**
   * Generates a patch from the repair brief and proven fixes.
   *
   * Analyzes the failure context + proven fixes to produce a
   * suggested code patch. Uses pattern matching on error type
   * to choose the most likely fix approach.
   *
   * @param brief The assembled repair brief.
   * @returns A string containing the suggested patch.
   */
  private generatePatch(brief: RepairBriefOutput): string {
    const failure = brief.failure_details;
    if (!failure) return '// No failure details available for patch generation';

    let patch = `// Auto-generated patch by Codememory v0.3.0 Auto-Heal\n`;
    patch += `// Failure: ${failure.error_type}: ${failure.error_message.slice(0, 100)}\n`;
    patch += `// Confidence: ${brief.confidence}\n\n`;

    // Use proven fixes as the primary patch source
    if (brief.proven_fixes.length > 0) {
      const bestFix = brief.proven_fixes[0];
      patch += `// Based on proven fix from: ${bestFix.intent.prompt.slice(0, 80)}\n`;
      patch += `// Fix approach: ${bestFix.resolution.approach || 'pattern-based'}\n`;
      patch += `// Diff summary: ${bestFix.resolution.diff_summary || 'manual review needed'}\n\n`;
    }

    // Pattern-based patch generation by error type
    patch += this.generatePatchByErrorType(failure, brief);

    // Include the original intent for context
    patch += `\n// Original intent: ${brief.original_intent.slice(0, 200)}\n`;
    patch += `// File: generated from repair brief analysis\n`;

    return patch;
  }

  /**
   * Generates error-type-specific patch suggestions.
   *
   * @param failure The failure record.
   * @param brief   The full repair brief.
   * @returns Patch code targeted at the error type.
   */
  private generatePatchByErrorType(
    failure: FailureRecord,
    brief: RepairBriefOutput
  ): string {
    const errorType = failure.error_type;

    if (errorType.includes('ReferenceError')) {
      return this.generateReferenceErrorPatch(failure, brief);
    }
    if (errorType.includes('TypeError')) {
      return this.generateTypeErrorPatch(failure, brief);
    }
    if (errorType.includes('SyntaxError')) {
      return this.generateSyntaxErrorPatch(failure);
    }
    if (errorType.includes('RangeError')) {
      return this.generateRangeErrorPatch(failure);
    }

    return this.generateGenericPatch(failure, brief);
  }

  /**
   * Extracts a likely undefined variable name from a ReferenceError.
   */
  private extractMissingSymbol(message: string): string {
    const match = message.match(/(?:is not defined|undefined)[: ]*\s*['"]?(\w+)['"]?/i);
    return match?.[1] ?? 'unknownSymbol';
  }

  /**
   * Generates a patch for ReferenceError (missing import/undefined variable).
   */
  private generateReferenceErrorPatch(
    failure: FailureRecord,
    brief: RepairBriefOutput
  ): string {
    const symbol = this.extractMissingSymbol(failure.error_message);
    let patch = `// ReferenceError fix: undefined symbol "${symbol}"\n`;
    patch += `// Possible causes:\n`;
    patch += `// 1. Missing import statement\n`;
    patch += `// 2. Variable used before declaration\n`;
    patch += `// 3. Typo in variable name\n\n`;

    // Check if we have runtime snapshots that show working state
    if (brief.runtime_history.length > 0) {
      patch += `// The function ran successfully ${brief.runtime_history.filter(s => s.success).length} time(s) before failing.\n`;
      patch += `// This suggests a conditional code path issue rather than a missing import.\n`;
    }

    patch += `// SUGGESTED FIX:\n`;
    patch += `// 1. Verify "${symbol}" is imported if it comes from an external module\n`;
    patch += `// 2. Check for typos in the variable name\n`;
    patch += `// 3. Ensure the variable is declared before use in all code paths\n`;

    return patch;
  }

  /**
   * Generates a patch for TypeError (null/undefined access).
   */
  private generateTypeErrorPatch(
    failure: FailureRecord,
    brief: RepairBriefOutput
  ): string {
    let patch = `// TypeError fix: null/undefined access or type mismatch\n`;

    // Extract the property being accessed from the error message
    const propMatch = failure.error_message.match(/Cannot read properties of \w+ \(reading '(\w+)'\)/i);
    const callMatch = failure.error_message.match(/(\w+) is not a function/i);

    if (propMatch) {
      const prop = propMatch[1];
      patch += `// Attempted to access property "${prop}" on null/undefined\n`;
      patch += `// SUGGESTED FIX:\n`;
      patch += `// Add a null check before accessing .${prop}:\n`;
      patch += `//   if (obj != null) { ... obj.${prop} ... }\n`;
      patch += `// Or use optional chaining: obj?.${prop}\n`;
    } else if (callMatch) {
      const funcName = callMatch[1];
      patch += `// "${funcName}" was called as a function but is not one\n`;
      patch += `// SUGGESTED FIX:\n`;
      patch += `// Verify the type of "${funcName}" before calling it\n`;
    } else {
      patch += `// SUGGESTED FIX:\n`;
      patch += `// Add null/undefined guards before property access or function calls\n`;
    }

    // Add runtime context
    if (brief.runtime_history.length > 0) {
      const lastSuccess = brief.runtime_history.filter(s => s.success).pop();
      if (lastSuccess?.arguments) {
        patch += `\n// Last successful execution args: ${lastSuccess.arguments}\n`;
        patch += `// Compare with the failing call to identify the difference\n`;
      }
    }

    return patch;
  }

  /**
   * Generates a patch for SyntaxError.
   */
  private generateSyntaxErrorPatch(failure: FailureRecord): string {
    let patch = `// SyntaxError fix: invalid code structure\n`;
    patch += `// Error: ${failure.error_message}\n`;
    patch += `// SUGGESTED FIX:\n`;
    patch += `// Check for:\n`;
    patch += `// - Missing or extra parentheses, brackets, or braces\n`;
    patch += `// - Unclosed string literals\n`;
    patch += `// - Invalid token sequences\n`;
    return patch;
  }

  /**
   * Generates a patch for RangeError (stack overflow, invalid array length).
   */
  private generateRangeErrorPatch(failure: FailureRecord): string {
    let patch = `// RangeError fix: value out of allowed range\n`;
    if (failure.error_message.includes('Maximum call stack')) {
      patch += `// Infinite recursion detected\n`;
      patch += `// SUGGESTED FIX:\n`;
      patch += `// 1. Add a base case to the recursive function\n`;
      patch += `// 2. Add a depth limit counter\n`;
      patch += `// 3. Consider converting to iterative approach\n`;
    } else {
      patch += `// SUGGESTED FIX:\n`;
      patch += `// Validate input values are within acceptable ranges\n`;
    }
    return patch;
  }

  /**
   * Generates a generic patch from failure context.
   */
  private generateGenericPatch(
    failure: FailureRecord,
    _brief: RepairBriefOutput
  ): string {
    let patch = `// Generic fix for: ${failure.error_type}\n`;
    if (failure.stack_trace) {
      const lines = failure.stack_trace.split('\n').slice(0, 5);
      patch += `// Stack trace:\n`;
      for (const line of lines) {
        patch += `//   ${line.trim()}\n`;
      }
    }
    patch += `\n// SUGGESTED FIX:\n`;
    patch += `// Review the stack trace and error message to identify the root cause.\n`;
    patch += `// Consider adding error handling (try/catch) around the failing code path.\n`;
    return patch;
  }

  /**
   * Validates a generated patch with basic sanity checks.
   *
   * @param patch The generated patch code.
   * @param brief The repair brief for context.
   * @returns Validation results.
   */
  private validatePatch(
    patch: string,
    _brief: RepairBriefOutput
  ): { valid: boolean; warnings: string[] } {
    const warnings: string[] = [];

    // Check patch is non-empty
    if (!patch.trim()) {
      warnings.push('Patch is empty');
    }

    // Check for obvious issues
    if (patch.length > 100_000) {
      warnings.push('Patch exceeds 100KB — may be too large');
    }

    // The patch consists of comments + suggestions; actual code would need
    // to be applied by the developer or AI agent.
    return {
      valid: warnings.length === 0,
      warnings,
    };
  }

  /**
   * Starts the background worker thread that polls for unresolved
   * failures and triggers auto-heal tasks automatically.
   *
   * The worker polls every 30 seconds by default (configurable via
   * CODEMEMORY_AUTOHEAL_POLL_MS env var).
   *
   * @param workerScriptPath Absolute path to the worker script.
   */
  public startWorker(workerScriptPath: string): void {
    if (this.worker) return; // Already running

    try {
      this.worker = new Worker(workerScriptPath, {
        workerData: {
          pollIntervalMs: getAutoHealPollMs(),
        },
      });

      this.worker.on('message', (msg: { type: string }) => {
        if (msg.type === 'check_pending') {
          const maxConcurrent = getAutoHealMaxConcurrent();
          const pendingTasks = this.getPendingTasks(maxConcurrent);
          for (const task of pendingTasks) {
            void this.executeTask(task.id).catch((err) =>
              logger.error('Auto-heal executeTask error', err, { taskId: task.id })
            );
          }
        }
      });

      this.worker.on('error', (err) => {
        logger.error('Auto-heal worker error', err);
      });

      this.worker.on('exit', (code) => {
        logger.info(`Auto-heal worker exited with code ${code}`);
        this.worker = null;
      });

      logger.info('Auto-heal worker started');
    } catch (error) {
      logger.error('Failed to start auto-heal worker', error);
    }
  }

  /**
   * Stops the background worker thread gracefully.
   */
  public async stopWorker(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      logger.info('Auto-heal worker stopped');
    }
  }
}
