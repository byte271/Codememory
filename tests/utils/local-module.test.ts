import { describe, it, expect } from 'vitest';
import { isLocalModuleRequest } from '../../src/utils/local-module.js';

describe('isLocalModuleRequest', () => {
  it('treats relative paths as local', () => {
    expect(isLocalModuleRequest('./foo.js')).toBe(true);
    expect(isLocalModuleRequest('../bar.js')).toBe(true);
  });

  it('treats posix absolute paths as local', () => {
    expect(isLocalModuleRequest('/home/user/app.js')).toBe(true);
  });

  it('treats Windows absolute paths as local', () => {
    expect(isLocalModuleRequest('C:\\project\\src\\index.js')).toBe(true);
    expect(isLocalModuleRequest('D:/project/src/index.js')).toBe(true);
  });

  it('does not treat bare package names as local', () => {
    expect(isLocalModuleRequest('lodash')).toBe(false);
    expect(isLocalModuleRequest('@scope/pkg')).toBe(false);
  });
});
