import { DatabaseManager } from '../../store/database.js';
import {
  GuardRule,
  PredictIssueOutput,
  GuardWarning,
  FailureRecord,
} from '../../types/index.js';
import { IntentSearchEngine } from '../intent/search.js';
import { hash } from '../../utils/hash.js';
import { logger } from '../../utils/logger.js';
import { getGuardConfidenceThreshold } from '../../config.js';

/**
 * Predictive Guard Engine — Proactive Safety Barriers (v0.3.0).
 *
 * Leverages historical failure patterns to stop the AI *before* it
 * writes a bug. When the AI is about to generate a block of code,
 * the guard engine checks the proposed approach against known failure
 * patterns and returns warnings with suggested alternatives.
 *
 * Strategy (v0.3, no cloud embeddings):
 *   1. FTS5 full-text search on guard_rules for pattern matching
 *   2. Cross-reference with recent failures from the same file/project
 *   3. Keyword-based semantic similarity as a proxy for embeddings
 *
 * The result transforms "post-mortem repair" into "preemptive prevention"
 * — giving the AI agent the intuition of experience.
 *
 * Follows Rule 02: SQLite only, no cloud embeddings.
 * Follows Rule 03: every function has a JSDoc comment.
 */
export class PredictiveGuard {
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
   * Predicts potential issues before code is written.
   *
   * Searches guard_rules (learned failure patterns) and recent failures
   * for patterns matching the proposed code/description. Returns warnings
   * with confidence levels and suggested alternatives.
   *
   * @param proposedCode  The code the AI is about to generate (optional).
   * @param description   Natural language description of the task.
   * @param filePath      Target file for context-aware matching.
   * @param projectId     Project ID for cross-project rule matching.
   * @returns             Warnings with risk assessment.
   */
  public predict(
    proposedCode: string | undefined,
    description: string | undefined,
    filePath: string | undefined,
    projectId: string | undefined
  ): PredictIssueOutput {
    const warnings: GuardWarning[] = [];
    const searchText = [description, proposedCode]
      .filter(Boolean)
      .join(' ')
      .slice(0, 1000);

    if (!searchText.trim()) {
      return { warnings: [], risk_level: 'none', match_count: 0 };
    }

    // ── 1. Search guard_rules FTS for pattern matches ──────────────────
    const ruleMatches = this.searchGuardRules(searchText, projectId);

    for (const rule of ruleMatches) {
      const confidence = this.calculateConfidence(rule, searchText);
      warnings.push({
        rule_id: rule.id,
        error_type: rule.error_type,
        pattern: rule.error_pattern,
        suggestion: rule.suggestion,
        confidence,
        from_cross_project: projectId ? rule.project_id !== projectId : false,
      });
    }

    // ── 2. Cross-reference with recent failures in the same file ────────
    if (filePath) {
      const recentFailures = this.getRecentFailuresForFile(filePath);
      for (const failure of recentFailures) {
        const existingWarning = warnings.find(
          (w) => w.error_type === failure.error_type
        );
        if (!existingWarning) {
          warnings.push({
            rule_id: `failure-${failure.id}`,
            error_type: failure.error_type,
            pattern: failure.error_message.slice(0, 200),
            suggestion: `This file had a recent ${failure.error_type}. Review the stack trace before proceeding.`,
            confidence: 0.7,
            from_cross_project: false,
          });
        }
      }
    }

    // ── 3. Semantic similarity via FTS5 on intent descriptions ─────────
    const similarIntents = this.searchEngine.search(searchText, 3, filePath);
    for (const result of similarIntents) {
      const failures = this.getFailuresForIntent(result.record.id);
      for (const failure of failures) {
        const existingWarning = warnings.find(
          (w) => w.error_type === failure.error_type
        );
        if (!existingWarning) {
          warnings.push({
            rule_id: `similar-intent-${result.record.id}`,
            error_type: failure.error_type,
            pattern: `Similar code in "${result.record.file_path}" caused: ${failure.error_message.slice(0, 100)}`,
            suggestion: `Consider a different approach. Previous "${result.record.prompt.slice(0, 80)}" failed with ${failure.error_type}.`,
            confidence: 0.5,
            from_cross_project: false,
          });
        }
      }
    }

    // ── 4. Filter by minimum confidence threshold ───────────────────
    const threshold = getGuardConfidenceThreshold();
    const filtered = warnings.filter((w) => w.confidence >= threshold);

    // ── 5. Compute overall risk level from filtered warnings ───────────
    const highCount = filtered.filter((w) => w.confidence >= 0.7).length;
    const totalCount = filtered.length;

    let riskLevel: PredictIssueOutput['risk_level'] = 'none';
    if (highCount >= 2) riskLevel = 'high';
    else if (highCount >= 1 || totalCount >= 3) riskLevel = 'medium';
    else if (totalCount > 0) riskLevel = 'low';

    logger.info('Predictive guard analysis complete', {
      riskLevel,
      warningCount: totalCount,
      totalBeforeFilter: warnings.length,
      threshold,
      searchText: searchText.slice(0, 100),
    });

    return {
      warnings: filtered.slice(0, 5), // Top 5 warnings
      risk_level: riskLevel,
      match_count: filtered.length,
    };
  }

  /**
   * Learns a new guard rule from a resolved failure.
   *
   * When a failure is resolved, this method extracts the error pattern
   * and stores it as a reusable guard rule for future predictions.
   * Over time, the guard rule database grows organically from
   * real-world failures, making predictions increasingly accurate.
   *
   * @param failure    The resolved failure record.
   * @param approach   How the failure was fixed.
   * @param projectId  The project where this failure occurred.
   * @returns          The created guard rule ID.
   */
  public learnFromResolution(
    failure: FailureRecord,
    approach: string,
    projectId: string | null
  ): string {
    // Check for existing similar rule to avoid duplicates
    const existing = this.findMatchingRule(failure.error_type, failure.error_message);
    if (existing) {
      // Increment hit count — this pattern is recurring
      this.manager.prepare(
        'UPDATE guard_rules SET hit_count = hit_count + 1 WHERE id = ?'
      ).run(existing.id);
      return existing.id;
    }

    const ruleId = hash.generateUniqueId(`guard-${failure.error_type}`);
    const now = Date.now();

    // Extract a concise error pattern from the full message
    const pattern = this.extractPattern(failure.error_message);
    const suggestion = this.generateSuggestion(failure.error_type, approach);

    this.manager.prepare(`
      INSERT INTO guard_rules (id, error_pattern, error_type, suggestion, file_pattern, project_id, hit_count, created_at)
      VALUES (?, ?, ?, ?, '', ?, 1, ?)
    `).run(ruleId, pattern, failure.error_type, suggestion, projectId, now);

    logger.info('Learned new guard rule', {
      ruleId,
      errorType: failure.error_type,
      pattern: pattern.slice(0, 80),
    });

    return ruleId;
  }

  /**
   * Records a guard prediction for analytics.
   *
   * When the guard was triggered before code generation, this logs
   * whether the prediction turned out to be accurate (was the warning
   * heeded or did the same error occur?).
   *
   * @param intentId    The intent that triggered the guard check.
   * @param ruleId      The matching guard rule.
   * @param confidence  Prediction confidence.
   * @returns           The prediction log ID.
   */
  public recordPrediction(
    intentId: string,
    ruleId: string,
    confidence: number
  ): string {
    const predictionId = hash.generateUniqueId(`pred-${intentId}-${ruleId}`);
    this.manager.prepare(`
      INSERT INTO guard_predictions (id, intent_id, rule_id, confidence, was_accurate, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(predictionId, intentId, ruleId, confidence, Date.now());
    return predictionId;
  }

  /**
   * Marks a guard prediction as accurate or inaccurate after the fact.
   *
   * @param predictionId The prediction to update.
   * @param wasAccurate  Whether the warning was correct.
   */
  public updatePredictionAccuracy(
    predictionId: string,
    wasAccurate: boolean
  ): void {
    this.manager.prepare(
      'UPDATE guard_predictions SET was_accurate = ? WHERE id = ?'
    ).run(wasAccurate ? 1 : 0, predictionId);
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * Searches guard_rules FTS index for matching patterns.
   */
  private searchGuardRules(searchText: string, projectId: string | undefined): GuardRule[] {
    // Escape FTS5 special characters
    const escaped = searchText
      .replace(/["*()^~:]/g, ' ')
      .replace(/\b(AND|OR|NOT|NEAR)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!escaped) return [];

    const terms = escaped.split(' ').filter(t => t.length > 1);
    if (terms.length === 0) return [];

    const ftsQuery = terms.map(t => `"${t}"`).join(' OR ');

    try {
      let rows: GuardRule[];
      if (projectId) {
        rows = this.manager.prepare(`
          SELECT g.* FROM guard_rules g
          JOIN guard_rules_fts f ON g.rowid = f.rowid
          WHERE guard_rules_fts MATCH ?
            AND (g.project_id IS NULL OR g.project_id = ?)
          ORDER BY g.hit_count DESC
          LIMIT 10
        `).all(ftsQuery, projectId) as GuardRule[];
      } else {
        rows = this.manager.prepare(`
          SELECT g.* FROM guard_rules g
          JOIN guard_rules_fts f ON g.rowid = f.rowid
          WHERE guard_rules_fts MATCH ?
          ORDER BY g.hit_count DESC
          LIMIT 10
        `).all(ftsQuery) as GuardRule[];
      }
      return rows;
    } catch {
      // FTS5 parse errors on unusual input — fall back to exact error_type match
      return [];
    }
  }

  /**
   * Finds an existing guard rule matching the given error.
   */
  private findMatchingRule(errorType: string, errorMessage: string): GuardRule | undefined {
    // First try exact error_type match
    const exactMatch = this.manager.prepare(
      'SELECT * FROM guard_rules WHERE error_type = ? ORDER BY hit_count DESC LIMIT 1'
    ).get(errorType) as GuardRule | undefined;

    if (exactMatch) return exactMatch;

    // Try substring match on error_pattern
    const keyword = this.extractKeywords(errorMessage)[0];
    if (keyword) {
      return this.manager.prepare(
        'SELECT * FROM guard_rules WHERE error_pattern LIKE ? ORDER BY hit_count DESC LIMIT 1'
      ).get(`%${keyword}%`) as GuardRule | undefined;
    }

    return undefined;
  }

  /**
   * Extracts a concise pattern from an error message.
   */
  private extractPattern(errorMessage: string): string {
    // Remove file paths and line numbers
    const cleaned = errorMessage
      .replace(/\(.*?:\d+:\d+\)/g, '')
      .replace(/at .*$/gm, '')
      .trim();

    // Truncate to a reasonable pattern length
    return cleaned.slice(0, 300);
  }

  /**
   * Generates a human-readable suggestion from error type and fix approach.
   */
  private generateSuggestion(errorType: string, approach: string): string {
    if (approach) return approach;

    const suggestions: Record<string, string> = {
      ReferenceError: 'Verify all variables are declared and imports are present before use.',
      TypeError: 'Add null/undefined guards before property access. Consider using optional chaining.',
      SyntaxError: 'Check for missing brackets, parentheses, or invalid syntax.',
      RangeError: 'Validate input ranges and add recursion depth limits.',
      EvalError: 'Avoid using eval(). Consider safer alternatives.',
      URIError: 'Ensure URI parameters are properly encoded.',
    };

    return suggestions[errorType] ?? `Review the error context and apply appropriate fix for ${errorType}.`;
  }

  /**
   * Extracts significant keywords from text for pattern matching.
   */
  private extractKeywords(text: string): string[] {
    const noise = new Set([
      'the', 'a', 'an', 'is', 'at', 'of', 'to', 'in', 'and', 'or', 'not',
      'for', 'on', 'with', 'was', 'it', 'be', 'has', 'have', 'that',
      'cannot', 'read', 'properties', 'undefined', 'null', 'error',
    ]);
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter(w => w.length > 2 && !noise.has(w))
      .slice(0, 5);
  }

  /**
   * Calculates confidence for a guard rule match.
   *
   * Higher confidence when:
   *   - The rule has been hit many times (recurring pattern)
   *   - The error_type matches exactly
   *   - The text contains multiple matching keywords
   *
   * @param rule       The matching guard rule.
   * @param searchText The text being analyzed.
   * @returns          Confidence score 0.0–1.0.
   */
  private calculateConfidence(rule: GuardRule, searchText: string): number {
    let confidence = 0.3; // Base confidence

    // Hit count weight (max +0.3)
    confidence += Math.min(rule.hit_count * 0.05, 0.3);

    // Keyword overlap (max +0.2)
    const ruleKeywords = this.extractKeywords(rule.error_pattern);
    const searchKeywords = this.extractKeywords(searchText);
    const overlap = ruleKeywords.filter((k) => searchKeywords.includes(k)).length;
    confidence += Math.min(overlap * 0.1, 0.2);

    // File pattern match bonus
    if (rule.file_pattern && searchText.includes(rule.file_pattern)) {
      confidence += 0.2;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * Gets recent unresolved failures for a file path.
   */
  private getRecentFailuresForFile(filePath: string): FailureRecord[] {
    return this.manager.prepare(`
      SELECT f.* FROM failures f
      JOIN intent_records i ON f.intent_id = i.id
      WHERE i.file_path = ? AND f.repair_status = 'unresolved'
      ORDER BY f.failed_at DESC
      LIMIT 5
    `).all(filePath) as FailureRecord[];
  }

  /**
   * Gets failures associated with an intent.
   */
  private getFailuresForIntent(intentId: string): FailureRecord[] {
    return this.manager.prepare(
      'SELECT * FROM failures WHERE intent_id = ? ORDER BY failed_at DESC LIMIT 3'
    ).all(intentId) as FailureRecord[];
  }
}
