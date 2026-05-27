import path from 'path';

/**
 * Returns true when a Node require() request targets a local project file
 * (relative or absolute), not a node_modules package name.
 *
 * @param request Module request string passed to Module._load.
 * @returns Whether the request should be auto-instrumented.
 */
export function isLocalModuleRequest(request: string): boolean {
  if (request.startsWith('.') || request.startsWith('/')) {
    return true;
  }
  // Windows drive letter (C:\...) or UNC network path (\\server\share\...).
  if (/^[A-Za-z]:[\\/]/.test(request) || request.startsWith('\\\\')) {
    return true;
  }
  return false;
}

/**
 * Normalizes a module path for use as an instrumentation label.
 *
 * @param request Module request string.
 * @returns Normalized path string.
 */
export function normalizeModuleLabel(request: string): string {
  return path.normalize(request);
}
