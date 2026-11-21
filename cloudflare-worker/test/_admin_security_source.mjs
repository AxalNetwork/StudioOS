/**
 * D4708 (#4708) — HQ › Security's Worker source, as one text for the tests that read it.
 *
 * `routes/admin_security.ts` used to hold every read and act of the Security desk; D4708 moved the reads into
 * `services/adminSecurity/` and left the router with the gates and the acts. A test that pins a sentence, a
 * statement or a count in "the Security route" reads this instead of one file, so the pin follows the code
 * wherever it lives in the desk, and still fails if the code leaves the desk. The router comes first, so a
 * handler sliced out of it ends at the router's `export default` as it always did.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const ADMIN_SECURITY_FILES = Object.freeze([
  'cloudflare-worker/src/routes/admin_security.ts',
  'cloudflare-worker/src/services/adminSecurity/overview.ts',
  'cloudflare-worker/src/services/adminSecurity/aiSafety.ts',
  'cloudflare-worker/src/services/adminSecurity/governanceFeed.ts',
  'cloudflare-worker/src/services/adminSecurity/feedQuery.ts',
  'cloudflare-worker/src/services/adminSecurity/feedFormat.ts',
  'cloudflare-worker/src/services/adminSecurity/dataAccess.ts',
]);

/** Every file above, router first, joined by a newline. */
export function readAdminSecurity() {
  return ADMIN_SECURITY_FILES.map((f) => readFileSync(resolve(ROOT, f), 'utf8')).join('\n');
}
