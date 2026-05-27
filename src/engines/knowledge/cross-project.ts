import { DatabaseManager } from '../../store/database.js';
import {
  Project,
  CrossProjectResult,
  CrossProjectSearchOutput,
  FailureRecord,
  Resolution,
} from '../../types/index.js';
import { hash } from '../../utils/hash.js';
import { logger } from '../../utils/logger.js';
import { IntentSearchEngine } from '../intent/search.js';

/**
 * Cross-Project Knowledge Graph Engine (v0.3.0).
 *
 * Breaks down project silos to enable shared learning. Memory is no
 * longer confined to a single repository — Codememory automatically
 * applies lessons learned in Project A to Project B.
 *
 * Key capabilities:
 *   - Register projects with their root paths
 *   - Search across all projects for similar failures/patterns
 *   - Extract guard rules from resolved failures for cross-project use
 *
 * Result: If you stumbled on a Prisma API pitfall in Project A, your
 * AI assistant will automatically steer clear when writing code for
 * Project B.
 *
 * Follows Rule 02: SQLite only — the knowledge graph lives in the
 * same local database.
 * Follows Rule 03: every function has a JSDoc comment.
 */
export class CrossProjectGraph {
  private manager: DatabaseManager;
  private searchEngine: IntentSearchEngine;

  /**
   * @param manager DatabaseManager for queries and persistence.
   */
  constructor(manager: DatabaseManager) {
    this.manager = manager;
    this.searchEngine = new IntentSearchEngine(manager);
  }

  /**
   * Registers (or retrieves) a project by name and path.
   *
   * Idempotent: if a project with the same root_path already exists,
   * returns the existing record. This makes it safe to call on every
   * capture_intent without creating duplicates.
   *
   * @param name     Human-readable project name.
   * @param rootPath Absolute path to the project root.
   * @returns        The project record.
   */
  public registerProject(name: string, rootPath: string): Project {
    // Check existing
    const existing = this.manager.prepare(
      'SELECT * FROM projects WHERE root_path = ?'
    ).get(rootPath) as Project | undefined;

    if (existing) {
      // Update name if it changed
      if (existing.name !== name) {
        this.manager.prepare(
          'UPDATE projects SET name = ? WHERE id = ?'
        ).run(name, existing.id);
        existing.name = name;
      }
      return existing;
    }

    const id = hash.generateMemoryId(`project:${rootPath}`);
    const now = Date.now();

    this.manager.prepare(`
      INSERT INTO projects (id, name, root_path, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, name, rootPath, now);

    logger.info('Registered project', { id, name, rootPath });
    return { id, name, root_path: rootPath, created_at: now };
  }

  /**
   * Finds a project by its root path.
   *
   * @param rootPath Absolute path to search for.
   * @returns        The project or undefined.
   */
  public getProjectByPath(rootPath: string): Project | undefined {
    return this.manager.prepare(
      'SELECT * FROM projects WHERE root_path = ?'
    ).get(rootPath) as Project | undefined;
  }

  /**
   * Finds a project by its name (case-insensitive).
   *
   * @param name Project name to search for.
   * @returns    The project or undefined.
   */
  public getProjectByName(name: string): Project | undefined {
    return this.manager.prepare(
      'SELECT * FROM projects WHERE LOWER(name) = LOWER(?)'
    ).get(name) as Project | undefined;
  }

  /**
   * Finds a project by ID.
   *
   * @param id The project ID.
   * @returns  The project or undefined.
   */
  public getProjectById(id: string): Project | undefined {
    return this.manager.prepare(
      'SELECT * FROM projects WHERE id = ?'
    ).get(id) as Project | undefined;
  }

  /**
   * Associates an intent with a project for cross-project tracking.
   *
   * @param intentId  The intent to associate.
   * @param projectId The project to associate with.
   */
  public associateIntentWithProject(intentId: string, projectId: string): void {
    this.manager.prepare(
      'UPDATE intent_records SET project_id = ? WHERE id = ?'
    ).run(projectId, intentId);
  }

  /**
   * Cross-project search: finds failures and resolutions in OTHER
   * projects that match the given query.
   *
   * This is the core "shared learning" feature — when the AI is about
   * to work on something, it can check if similar work failed in
   * another project and learn from those mistakes.
   *
   * @param query   Search description (error pattern, library name, etc.).
   * @param limit   Max results per project (default 5).
   * @returns       Matched results across projects.
   */
  public searchAcrossProjects(
    query: string,
    limit = 5
  ): CrossProjectSearchOutput {
    const safeLimit = Math.max(1, Math.min(20, Math.floor(limit)));

    // ── 1. FTS5 search across all intents ──────────────────────────────
    const searchResults = this.searchEngine.search(query, safeLimit * 3);

    // ── 2. Group results by project ─────────────────────────────────────
    const projectMap = new Map<string, CrossProjectResult[]>();

    for (const result of searchResults) {
      const projectId = result.record.project_id;
      if (!projectId) continue;

      const project = this.getProjectById(projectId);
      if (!project) continue;

      // Get associated failures for this intent
      const failures = this.getFailuresForIntent(result.record.id);
      const failure = failures[0] ?? null;

      // Get resolution if failure was resolved
      let resolution: Resolution | null = null;
      if (failure) {
        resolution = this.getResolutionForFailure(failure.id);
      }

      if (!projectMap.has(projectId)) {
        projectMap.set(projectId, []);
      }

      projectMap.get(projectId)!.push({
        project,
        intent: result.record,
        failure,
        resolution,
        match_context: result.snippet,
      });
    }

    // ── 3. Flatten and sort by relevance ────────────────────────────────
    const results: CrossProjectResult[] = [];
    const matchedProjects: string[] = [];

    for (const [projectId, entries] of projectMap) {
      matchedProjects.push(projectId);
      results.push(...entries.slice(0, safeLimit));
    }

    return {
      results: results.slice(0, safeLimit * 2),
      total: results.length,
      matched_projects: matchedProjects,
    };
  }

  /**
   * Lists all registered projects.
   *
   * @returns Array of known projects.
   */
  public listProjects(): Project[] {
    return this.manager.prepare(
      'SELECT * FROM projects ORDER BY created_at DESC'
    ).all() as Project[];
  }

  /**
   * Gets cross-project guard rules — patterns learned in other projects
   * that may apply to the current project.
   *
   * @param currentProjectId The project to exclude (we want rules from OTHER projects).
   * @param limit            Max rules to return.
   * @returns                Guard rules from other projects.
   */
  public getCrossProjectRules(
    currentProjectId: string,
    limit = 10
  ): Array<{
    id: string;
    error_pattern: string;
    error_type: string;
    suggestion: string;
    project_name: string;
    hit_count: number;
  }> {
    return this.manager.prepare(`
      SELECT
        g.id, g.error_pattern, g.error_type,
        g.suggestion, g.hit_count,
        p.name AS project_name
      FROM guard_rules g
      JOIN projects p ON g.project_id = p.id
      WHERE g.project_id IS NOT NULL
        AND g.project_id != ?
      ORDER BY g.hit_count DESC
      LIMIT ?
    `).all(currentProjectId, limit) as Array<{
      id: string;
      error_pattern: string;
      error_type: string;
      suggestion: string;
      project_name: string;
      hit_count: number;
    }>;
  }

  /**
   * Gets failures for a specific intent.
   */
  private getFailuresForIntent(intentId: string): FailureRecord[] {
    return this.manager.prepare(
      'SELECT * FROM failures WHERE intent_id = ? ORDER BY failed_at DESC LIMIT 3'
    ).all(intentId) as FailureRecord[];
  }

  /**
   * Gets the latest resolution for a failure.
   */
  private getResolutionForFailure(failureId: string): Resolution | null {
    return this.manager.prepare(
      'SELECT * FROM resolutions WHERE failure_id = ? ORDER BY resolved_at DESC LIMIT 1'
    ).get(failureId) as Resolution | undefined ?? null;
  }
}
