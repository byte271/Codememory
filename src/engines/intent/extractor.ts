/**
 * Intent Extractor for Codememory.
 * Follows Rule 03: NEVER write a function without a JSDoc comment explaining intent.
 */
export class IntentExtractor {
  /**
   * Extracts the core intent from a developer's prompt.
   * Uses basic pattern matching to strip common AI prefixes.
   * @param prompt The original developer request.
   * @returns The extracted intent string.
   */
  public extract(prompt: string): string {
    let intent = prompt.trim();
    
    // Strip common AI conversational prefixes
    const prefixes = [
      /^can you (please )?/i,
      /^write a (function|script|module) to /i,
      /^create a /i,
      /^implement /i
    ];

    for (const prefix of prefixes) {
      intent = intent.replace(prefix, '');
    }

    // Capitalize first letter
    return intent.charAt(0).toUpperCase() + intent.slice(1);
  }
}
