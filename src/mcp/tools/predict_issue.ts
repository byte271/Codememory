import {
  PredictIssueInput,
  PredictIssueOutput,
} from '../../types/index.js';
import { PredictiveGuard } from '../../engines/guard/predictive-guard.js';
import { CrossProjectGraph } from '../../engines/knowledge/cross-project.js';
import { getGuardConfidenceThreshold } from '../../config.js';
import { logger } from '../../utils/logger.js';

/**
 * Tool to predict potential issues before code is written (v0.3.0).
 *
 * The "Proactive Guardrails" feature: when the AI is about to generate
 * code, this tool checks the proposed approach against known failure
 * patterns and returns warnings with suggested alternatives.
 *
 * Strategy:
 *   1. FTS5 search on guard_rules for pattern matches
 *   2. Cross-reference with recent failures in the target file
 *   3. Cross-project rule matching for shared learning
 *
 * Follows Rule 14: Every MCP tool must return structured JSON.
 */
export class PredictIssueTool {
  private guard: PredictiveGuard;
  private crossProject: CrossProjectGraph;

  /**
   * @param guard        Predictive guard engine.
   * @param crossProject Cross-project knowledge graph.
   */
  constructor(guard: PredictiveGuard, crossProject: CrossProjectGraph) {
    this.guard = guard;
    this.crossProject = crossProject;
  }

  /**
   * Executes the predict_issue tool.
   *
   * @param input The proposed code/description to analyze.
   * @returns     Warnings with risk assessment and suggestions.
   */
  public async execute(input: PredictIssueInput): Promise<PredictIssueOutput> {
    try {
      // Resolve project ID if project name provided
      let projectId: string | undefined;
      if (input.project_name) {
        const project = this.crossProject.getProjectByName(input.project_name);
        if (!project) {
          logger.warn('predict_issue: project not found, cross-project rules disabled', {
            projectName: input.project_name,
          });
        }
        projectId = project?.id;
      }

      // Run the predictive guard analysis
      const result = this.guard.predict(
        input.proposed_code,
        input.description,
        input.file_path,
        projectId
      );

      // Enhance warnings with cross-project context
      if (projectId) {
        const threshold = getGuardConfidenceThreshold();
        const crossRules = this.crossProject.getCrossProjectRules(projectId, 5);
        for (const rule of crossRules) {
          // Check if this cross-project rule is already covered
          const alreadyCovered = result.warnings.some(
            (w) => w.error_type === rule.error_type
          );
          if (!alreadyCovered) {
            const confidence = Math.min(0.6, rule.hit_count * 0.1);
            // Only add cross-project rules above the confidence threshold
            if (confidence >= threshold) {
              result.warnings.push({
                rule_id: rule.id,
                error_type: rule.error_type,
                pattern: rule.error_pattern,
                suggestion: `[From project "${rule.project_name}"] ${rule.suggestion}`,
                confidence,
                from_cross_project: true,
              });
            }
          }
        }
        // Recalculate risk_level and match_count to account for cross-project warnings
        result.match_count = result.warnings.length;
        if (result.match_count >= 2 && result.warnings.filter(w => w.confidence >= 0.7).length >= 2) {
          result.risk_level = 'high';
        } else if (result.match_count >= 1 && result.warnings.filter(w => w.confidence >= 0.7).length >= 1) {
          result.risk_level = 'medium';
        } else if (result.match_count >= 3) {
          result.risk_level = 'medium';
        } else if (result.match_count > 0) {
          result.risk_level = 'low';
        }
      }

      return result;
    } catch (error) {
      logger.error('Failed to predict issues', error, {
        input,
        timestamp: Date.now(),
        rule: 'Rule 06 compliance',
      });
      throw error;
    }
  }
}
