/**
 * Fails CI if legacy product name appears in shipped source/docs.
 * Scans src, tests, examples, README, and templates — not this script file.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_ROOTS = ['src', 'tests', 'examples', 'README.md', 'assets', 'scripts/package-source.ps1'];
const FORBIDDEN = /engram/i;
const EXT = /\.(ts|md|json|ps1|yml|mjs|cjs|js)$/i;

const violations = [];

/**
 * Recursively scans files under a path for forbidden branding.
 * @param {string} target Absolute or relative path.
 */
function scan(target) {
  const abs = path.resolve(ROOT, target);
  if (!fs.existsSync(abs)) return;
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    if (path.basename(abs) === 'node_modules') return;
    for (const entry of fs.readdirSync(abs)) {
      scan(path.join(target, entry));
    }
    return;
  }
  const base = path.basename(abs);
  if (base === 'check-brand.js') return;
  if (!EXT.test(abs) && base !== 'README.md') return;
  const text = fs.readFileSync(abs, 'utf8');
  if (FORBIDDEN.test(text)) {
    violations.push(path.relative(ROOT, abs));
  }
}

for (const root of SCAN_ROOTS) {
  scan(root);
}

if (violations.length > 0) {
  console.error('Legacy name found in project files:');
  for (const file of violations) {
    console.error(`  - ${file}`);
  }
  process.exit(1);
}

console.log('check:brand OK — no legacy name in source or docs');
