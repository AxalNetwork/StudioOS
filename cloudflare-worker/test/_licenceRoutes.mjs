/**
 * #4707 — the HQ licence routes' source, now that they are split by domain.
 *
 * `routes/admin_licences.ts` mounts the domain routers (`admin_licences_*.ts`)
 * in their original order and keeps `GET /:uid`; the shared core (row types,
 * `hydrate`, `logEvent`, the state machine) is `services/licenceLedgerCore.ts`,
 * and the API's contract (statuses, kinds, seats, answer shapes) is
 * `services/licenceContracts.ts`.
 * Tests that read the licence routes as text read this: the root first, then
 * the core, then each domain router, each headed by its path.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ROUTES = 'cloudflare-worker/src/routes';

// The domain routers in MOUNT order, read from the root's imports: that is the
// order the routes were declared in before the split, so "the first X in the
// source" still means what it meant then.
const ROOT_SRC = readFileSync(resolve(root, `${ROUTES}/admin_licences.ts`), 'utf8');
const MOUNTED = [...ROOT_SRC.matchAll(/^import \w+ from '\.\/(admin_licences_\w+)';$/gm)].map((m) => `${ROUTES}/${m[1]}.ts`);
const ON_DISK = readdirSync(resolve(root, ROUTES)).filter((f) => /^admin_licences_\w+\.ts$/.test(f)).map((f) => `${ROUTES}/${f}`);
if (ON_DISK.some((f) => !MOUNTED.includes(f))) {
  throw new Error(`a licence route file is not mounted by admin_licences.ts: ${ON_DISK.filter((f) => !MOUNTED.includes(f)).join(', ')}`);
}

export const LICENCE_ROUTE_FILES = Object.freeze([
  `${ROUTES}/admin_licences.ts`,
  'cloudflare-worker/src/services/licenceLedgerCore.ts',
  'cloudflare-worker/src/services/licenceContracts.ts',
  ...MOUNTED,
]);

/** Every licence route file's source, root first. */
export function licenceRoutesSource() {
  return LICENCE_ROUTE_FILES.map((rel) => `// ── ${rel}\n${readFileSync(resolve(root, rel), 'utf8')}`).join('\n');
}
