/**
 * Repair Brief Formatter for Codememory.
 * Follows Rule 03: NEVER write a function without a JSDoc comment explaining intent.
 */
export class RepairFormatter {
  /**
   * Formats repair data into a human-readable and AI-optimized string.
   * @param data The data to format.
   * @returns A formatted string.
   */
  public format(data: Record<string, unknown>): string {
    return JSON.stringify(data, null, 2);
  }

  /**
   * Specifically formats for AI consumption.
   * @param context The repair context string.
   * @param errorType Optional error type to suggest fix approach.
   * @returns The AI-optimized brief.
   */
  public formatForAI(context: string, errorType?: string): string {
    let approach = '';
    if (errorType) {
      approach = `\n\n### SUGGESTED FIX APPROACH\n`;
      if (errorType.includes('ReferenceError')) {
        approach += `- Check for missing imports or undefined variables.\n`;
      } else if (errorType.includes('TypeError')) {
        approach += `- Check for null/undefined access or incorrect type usage.\n`;
      } else if (errorType.includes('RangeError')) {
        approach += `- Check for infinite recursion or invalid array lengths.\n`;
      } else {
        approach += `- Review the stack trace and execution history to identify the root cause.\n`;
      }
    }

    return `### SYSTEM INSTRUCTION: FIX THIS CODE\n\n${context}${approach}\n\nOptimized for immediate repair.`;
  }
}
