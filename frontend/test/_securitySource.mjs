// D4708 part 3 (#4708) — HQ Security's page source as the source-reading tests read it: the shell and the parts moved out of it.
//
// `SecurityPage.jsx` is the shell (the reads, the session acts, the route's default export); the
// view and its zones moved into `pages/hq/security/` unchanged. A test that pinned a rule by
// reading `SecurityPage.jsx` reads `securityRaw()` instead, so the rule is checked wherever its
// code now lives. The order is fixed: the shell first, then the view, then its zones.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

export const SECURITY_PAGE = 'frontend/src/pages/hq/SecurityPage.jsx';
export const SECURITY_DIR = 'frontend/src/pages/hq/security';
/** The files `SecurityPage.jsx` was split into (D4708 part 3), in the order the page draws them. */
export const SECURITY_PAGE_PARTS = [
  'SecurityConsole.jsx',
  'securityShared.js',
  'SecurityParts.jsx',
  'AccessZones.jsx',
  'PrivacyZones.jsx',
  'TrustZones.jsx',
  'AiSafetyZone.jsx',
  'ResilienceZones.jsx',
];

/** Parts listed above that no longer exist, so the list cannot point at nothing. */
export function missingParts() {
  return SECURITY_PAGE_PARTS.filter((n) => !existsSync(resolve(ROOT, SECURITY_DIR, n)));
}

export const securityFile = (name) => read(`${SECURITY_DIR}/${name}`);

/** The shell and every part it was split into, concatenated in the fixed order. */
export function securityRaw() {
  return [read(SECURITY_PAGE), ...SECURITY_PAGE_PARTS.map(securityFile)].join('\n');
}
