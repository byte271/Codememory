import { DatabaseManager } from '../../store/database.js';
import {
  TimelineData,
  TimelineEvent,
  TrendPoint,
  IntentRecord,
  FailureRecord,
  RuntimeSnapshot,
  Resolution,
  AutoHealTask,
} from '../../types/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Behavior Timeline Aggregator (v0.3.0).
 *
 * Aggregates data across all Codememory tables to build a chronological
 * "life trajectory" of the codebase. Goes beyond Git's line-level tracking
 * to visualize *behavioral* evolution: input/output changes, error rate
 * trends, and fix effectiveness over time.
 *
 * The aggregated data is served to the Behavioral Time Machine UI
 * (web dashboard) for interactive exploration.
 *
 * Follows Rule 02: SQLite only, no external time-series databases.
 * Follows Rule 03: every function has a JSDoc comment.
 */
export class BehaviorTimelineAggregator {
  private manager: DatabaseManager;

  /**
   * @param manager DatabaseManager for queries.
   */
  constructor(manager: DatabaseManager) {
    this.manager = manager;
  }

  /**
   * Builds the full behavioral timeline with events and statistics.
   *
   * @param since    Start of the time window (epoch ms). Default: 7 days ago.
   * @param until    End of the time window (epoch ms). Default: now.
   * @param filePath Optional file path filter.
   * @param limit    Max events to return (default 100).
   * @returns        Complete timeline data with stats.
   */
  public buildTimeline(
    since?: number,
    until?: number,
    filePath?: string,
    limit = 100
  ): TimelineData {
    const endTime = until ?? Date.now();
    const startTime = since ?? endTime - 7 * 24 * 60 * 60 * 1000; // 7 days default
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));

    const events = this.collectEvents(startTime, endTime, filePath, safeLimit);
    const stats = this.computeStats(startTime, endTime, filePath);

    logger.info('Built behavioral timeline', {
      eventCount: events.length,
      timeRange: `${new Date(startTime).toISOString()} – ${new Date(endTime).toISOString()}`,
    });

    return { events, stats };
  }

  /**
   * Collects all timeline events from the database within the time window.
   */
  private collectEvents(
    since: number,
    until: number,
    filePath: string | undefined,
    limit: number
  ): TimelineEvent[] {
    const events: TimelineEvent[] = [];

    // ── Intent creation events ────────────────────────────────────────
    const intents = this.queryIntents(since, until, filePath, limit);
    for (const intent of intents) {
      events.push({
        timestamp: intent.created_at,
        type: 'intent_created',
        summary: `Code generated: ${intent.prompt.slice(0, 100)}`,
        file_path: intent.file_path,
        detail: {
          memory_id: intent.id,
          language: intent.language,
          ai_tool: intent.ai_tool,
          status: intent.status,
        },
      });
    }

    // ── Runtime snapshot events (sampled) ─────────────────────────────
    const snapshots = this.querySnapshots(since, until, filePath, Math.floor(limit / 2));
    for (const snap of snapshots) {
      events.push({
        timestamp: snap.recorded_at,
        type: 'runtime_recorded',
        summary: `${snap.function_name}: ${snap.success ? 'SUCCESS' : 'FAILURE'} (${snap.duration_ms}ms)`,
        file_path: snap.file_path,
        detail: {
          snapshot_id: snap.id,
          intent_id: snap.intent_id,
          function_name: snap.function_name,
          success: snap.success === 1,
          duration_ms: snap.duration_ms,
        },
      });
    }

    // ── Failure events ────────────────────────────────────────────────
    const failures = this.queryFailures(since, until, filePath, limit);
    for (const failure of failures) {
      const fp = (failure as FailureRecord & { file_path?: string }).file_path ?? '';
      events.push({
        timestamp: failure.failed_at,
        type: 'failure_logged',
        summary: `${failure.error_type}: ${failure.error_message.slice(0, 100)}`,
        file_path: fp,
        detail: {
          failure_id: failure.id,
          intent_id: failure.intent_id,
          error_type: failure.error_type,
          repair_status: failure.repair_status,
        },
      });
    }

    // ── Resolution events ─────────────────────────────────────────────
    const resolutions = this.queryResolutions(since, until, limit);
    for (const resolution of resolutions) {
      const fp = (resolution as Resolution & { file_path?: string }).file_path ?? '';
      events.push({
        timestamp: resolution.resolved_at,
        type: 'resolution_logged',
        summary: `Bug resolved: ${(resolution.approach ?? '').slice(0, 100)}`,
        file_path: fp,
        detail: {
          resolution_id: resolution.id,
          failure_id: resolution.failure_id,
          fixing_intent_id: resolution.fixing_intent_id,
          approach: resolution.approach,
        },
      });
    }

    // ── Auto-heal events ──────────────────────────────────────────────
    const autoHealTasks = this.queryAutoHealTasks(since, until, limit);
    for (const task of autoHealTasks) {
      const actionTime = task.completed_at ?? task.started_at ?? task.created_at;
      events.push({
        timestamp: actionTime,
        type: 'auto_heal_triggered',
        summary: `Auto-heal: ${task.status}${task.pr_url ? ` (PR: ${task.pr_url})` : ''}`,
        file_path: '',
        detail: {
          task_id: task.id,
          failure_id: task.failure_id,
          status: task.status,
          has_patch: task.patch_code !== null,
          has_pr: task.pr_url !== null,
        },
      });
    }

    // Sort by timestamp descending (newest first)
    events.sort((a, b) => b.timestamp - a.timestamp);

    return events.slice(0, limit);
  }

  /**
   * Computes aggregate statistics for the time window.
   */
  private computeStats(
    since: number,
    until: number,
    filePath: string | undefined
  ): TimelineData['stats'] {
    const fileFilter = filePath ? 'AND i.file_path = ?' : '';
    const params: unknown[] = [since, until];
    if (filePath) params.push(filePath);

    const totalIntents = (
      this.manager.prepare(`
        SELECT COUNT(*) as cnt FROM intent_records i
        WHERE i.created_at BETWEEN ? AND ? ${fileFilter}
      `).get(...params) as { cnt: number }
    ).cnt;

    const totalFailures = (
      this.manager.prepare(`
        SELECT COUNT(*) as cnt FROM failures f
        JOIN intent_records i ON f.intent_id = i.id
        WHERE f.failed_at BETWEEN ? AND ? ${fileFilter}
      `).get(...params) as { cnt: number }
    ).cnt;

    const totalResolutions = (
      this.manager.prepare(`
        SELECT COUNT(*) as cnt FROM resolutions r
        WHERE r.resolved_at BETWEEN ? AND ?
      `).get(since, until) as { cnt: number }
    ).cnt;

    const totalAutoHeals = (
      this.manager.prepare(`
        SELECT COUNT(*) as cnt FROM auto_heal_tasks
        WHERE created_at BETWEEN ? AND ?
      `).get(since, until) as { cnt: number }
    ).cnt;

    const errorRate = totalIntents > 0
      ? Math.round((totalFailures / totalIntents) * 100)
      : 0;

    const fixRate = totalFailures > 0
      ? Math.round((totalResolutions / totalFailures) * 100)
      : 0;

    // Generate trend points (daily buckets)
    const recentTrends = this.computeTrends(since, until, filePath);

    return {
      totalIntents,
      totalFailures,
      totalResolutions,
      totalAutoHeals,
      errorRate,
      fixRate,
      recentTrends,
    };
  }

  /**
   * Computes daily trend data for the time window.
   * Uses a single batched query instead of iterating day-by-day.
   */
  private computeTrends(
    since: number,
    until: number,
    filePath: string | undefined
  ): TrendPoint[] {
    const dayMs = 24 * 60 * 60 * 1000;
    const fileFilter = filePath ? 'AND i.file_path = ?' : '';
    const maxDays = 90; // Cap to prevent unbounded queries
    const cappedUntil = Math.min(until, since + maxDays * dayMs);

    // Query all errors in the range in one shot, bucketed by day
    const errorRows = this.manager.prepare(`
      SELECT CAST(f.failed_at / ? AS INTEGER) AS day_bucket,
             COUNT(*) AS cnt
      FROM failures f
      JOIN intent_records i ON f.intent_id = i.id
      WHERE f.failed_at BETWEEN ? AND ? ${fileFilter}
      GROUP BY day_bucket
      ORDER BY day_bucket
    `).all(dayMs, since, cappedUntil, ...(filePath ? [filePath] : [])) as Array<{ day_bucket: number; cnt: number }>;

    const fixRows = this.manager.prepare(`
      SELECT CAST(r.resolved_at / ? AS INTEGER) AS day_bucket,
             COUNT(*) AS cnt
      FROM resolutions r
      WHERE r.resolved_at BETWEEN ? AND ?
      GROUP BY day_bucket
      ORDER BY day_bucket
    `).all(dayMs, since, cappedUntil) as Array<{ day_bucket: number; cnt: number }>;

    // Build lookup maps
    const errorMap = new Map(errorRows.map(r => [r.day_bucket, r.cnt]));
    const fixMap = new Map(fixRows.map(r => [r.day_bucket, r.cnt]));

    const trends: TrendPoint[] = [];
    for (let dayStart = since; dayStart < cappedUntil; dayStart += dayMs) {
      const bucket = Math.floor(dayStart / dayMs);
      trends.push({
        label: new Date(dayStart).toISOString().slice(0, 10),
        errors: errorMap.get(bucket) ?? 0,
        fixes: fixMap.get(bucket) ?? 0,
      });
    }

    return trends;
  }

  // ── Query helpers ──────────────────────────────────────────────────────

  private queryIntents(
    since: number,
    until: number,
    filePath: string | undefined,
    limit: number
  ): IntentRecord[] {
    if (filePath) {
      return this.manager.prepare(
        `SELECT * FROM intent_records
         WHERE created_at BETWEEN ? AND ? AND file_path = ?
         ORDER BY created_at DESC LIMIT ?`
      ).all(since, until, filePath, limit) as IntentRecord[];
    }
    return this.manager.prepare(
      `SELECT * FROM intent_records
       WHERE created_at BETWEEN ? AND ?
       ORDER BY created_at DESC LIMIT ?`
    ).all(since, until, limit) as IntentRecord[];
  }

  private querySnapshots(
    since: number,
    until: number,
    filePath: string | undefined,
    limit: number
  ): RuntimeSnapshot[] {
    if (filePath) {
      return this.manager.prepare(
        `SELECT * FROM runtime_snapshots
         WHERE recorded_at BETWEEN ? AND ? AND file_path = ?
         ORDER BY recorded_at DESC LIMIT ?`
      ).all(since, until, filePath, limit) as RuntimeSnapshot[];
    }
    return this.manager.prepare(
      `SELECT * FROM runtime_snapshots
       WHERE recorded_at BETWEEN ? AND ?
       ORDER BY recorded_at DESC LIMIT ?`
    ).all(since, until, limit) as RuntimeSnapshot[];
  }

  private queryFailures(
    since: number,
    until: number,
    filePath: string | undefined,
    limit: number
  ): FailureRecord[] {
    if (filePath) {
      return this.manager.prepare(
        `SELECT f.*, i.file_path FROM failures f
         JOIN intent_records i ON f.intent_id = i.id
         WHERE f.failed_at BETWEEN ? AND ? AND i.file_path = ?
         ORDER BY f.failed_at DESC LIMIT ?`
      ).all(since, until, filePath, limit) as FailureRecord[];
    }
    return this.manager.prepare(
      `SELECT f.*, i.file_path FROM failures f
       LEFT JOIN intent_records i ON f.intent_id = i.id
       WHERE f.failed_at BETWEEN ? AND ?
       ORDER BY f.failed_at DESC LIMIT ?`
    ).all(since, until, limit) as FailureRecord[];
  }

  private queryResolutions(
    since: number,
    until: number,
    limit: number
  ): Resolution[] {
    return this.manager.prepare(
      `SELECT r.*, i.file_path FROM resolutions r
       LEFT JOIN failures f ON r.failure_id = f.id
       LEFT JOIN intent_records i ON f.intent_id = i.id
       WHERE r.resolved_at BETWEEN ? AND ?
       ORDER BY r.resolved_at DESC LIMIT ?`
    ).all(since, until, limit) as Resolution[];
  }

  private queryAutoHealTasks(
    since: number,
    until: number,
    limit: number
  ): AutoHealTask[] {
    return this.manager.prepare(
      `SELECT * FROM auto_heal_tasks
       WHERE created_at BETWEEN ? AND ?
       ORDER BY created_at DESC LIMIT ?`
    ).all(since, until, limit) as AutoHealTask[];
  }
}
