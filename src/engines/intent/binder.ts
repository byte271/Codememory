/**
 * Intent Binder for Codememory.
 * Follows Rule 03: NEVER write a function without a JSDoc comment explaining intent.
 */
export class IntentBinder {
  /**
   * Binds a generated code block to a memory ID.
   * @param code The generated code block.
   * @param memoryId The unique memory ID.
   * @returns A tagged version of the code (if applicable).
   */
  public bind(code: string, memoryId: string): string {
    // v1: Prepend the memory_id as a comment in the generated code.
    // Escape any `*/` sequences in the code to prevent premature closure of
    // multi-line comments the AI may be writing (e.g. JSDoc, block comments).
    const safeCode = code.replace(/\*\//g, '*\\/');
    return `// memory_id: ${memoryId}\n${safeCode}`;
  }
}
