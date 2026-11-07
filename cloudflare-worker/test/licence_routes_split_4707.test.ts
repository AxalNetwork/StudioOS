/**
 * #4707 — the licence routes were split by domain WITHOUT changing the API.
 *
 * `routes/admin_licences.ts` was one 2531-line router. It now mounts ten
 * domain routers (`admin_licences_*.ts`) in the order their routes were
 * declared before, and keeps `GET /:uid` last. This pins the composed route
 * table to the pre-split one, method, path and ORDER (Hono matches in
 * registration order, so a reordering is a behaviour change), and pins which
 * domain file owns each route, so a route that drifts into the wrong domain,
 * or a new one added outside its domain's file, is seen here.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_routes_split_4707.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import adminLicences, {
  brandKitPayload, deprovisionLicenceAdmins, enrichContractFromEnvelope, EVENTS_PAGE_MAX, hydrate, unbindBranchAdmins,
} from '../src/routes/admin_licences.ts';

/** The table before the split, in declaration order, with the file that owns each route now. */
const ROUTES: Array<[string, string]> = [
  ['GET /', 'admin_licences_ledger'],
  ['GET /territories', 'admin_licences_ledger'],
  ['GET /summary', 'admin_licences_ledger'],
  ['GET /:uid/requests', 'admin_licences_ledger'],
  ['POST /', 'admin_licences_ledger'],
  ['PUT /:uid/territories', 'admin_licences_terms'],
  ['PUT /:uid/seats', 'admin_licences_terms'],
  ['PATCH /:uid/terms', 'admin_licences_terms'],
  ['GET /:uid/terms', 'admin_licences_terms'],
  ['PUT /:uid/terms', 'admin_licences_terms'],
  ['GET /:uid/activation', 'admin_licences_lifecycle'],
  ['POST /:uid/activate', 'admin_licences_lifecycle'],
  ['POST /:uid/suspend', 'admin_licences_lifecycle'],
  ['POST /:uid/reinstate', 'admin_licences_lifecycle'],
  ['POST /:uid/renew', 'admin_licences_lifecycle'],
  ['POST /:uid/terminate', 'admin_licences_lifecycle'],
  ['GET /:uid/admins', 'admin_licences_admins'],
  ['POST /:uid/admins', 'admin_licences_admins'],
  ['DELETE /:uid/admins/:userId{[0-9]+}', 'admin_licences_admins'],
  ['GET /:uid/notices', 'admin_licences_notices'],
  ['POST /:uid/notices', 'admin_licences_notices'],
  ['POST /:uid/notices/:noticeUid/review', 'admin_licences_notices'],
  ['POST /:uid/domain/detach', 'admin_licences_domain'],
  ['PUT /:uid/brand', 'admin_licences_brand'],
  ['POST /:uid/brand/mark', 'admin_licences_brand'],
  ['DELETE /:uid/brand/mark', 'admin_licences_brand'],
  ['GET /:uid/brand/mark', 'admin_licences_brand'],
  ['GET /:uid/contract', 'admin_licences_contracts'],
  ['POST /:uid/contract', 'admin_licences_contracts'],
  ['POST /:uid/contract/:contractUid/send', 'admin_licences_contracts'],
  ['GET /:uid/fee-invoices', 'admin_licences_fees'],
  ['POST /:uid/fee-invoices', 'admin_licences_fees'],
  ['PATCH /:uid/fee-invoices/:invoiceUid', 'admin_licences_fees'],
  ['GET /:uid/fee-invoices/:invoiceUid/pdf', 'admin_licences_fees'],
  ['GET /:uid/events', 'admin_licences_history'],
  ['GET /:uid', 'admin_licences'],
];

const ROUTES_DIR = resolve(process.cwd(), 'cloudflare-worker/src/routes');

test('the composed router answers exactly the routes it did before the split, in the same order', () => {
  const now = (adminLicences as any).routes.map((x: any) => `${x.method} ${x.path}`);
  assert.deepEqual(now, ROUTES.map(([route]) => route));
  assert.equal(now[now.length - 1], 'GET /:uid', 'GET /:uid must stay last, or it answers for every GET /<word> after it');
});

test('each route is declared in its own domain file, and nowhere else', () => {
  const declared = new Map<string, string[]>();
  for (const f of readdirSync(ROUTES_DIR).filter((n) => /^admin_licences(_\w+)?\.ts$/.test(n))) {
    const src = readFileSync(resolve(ROUTES_DIR, f), 'utf8');
    for (const m of src.matchAll(/^r\.(get|post|put|patch|delete)\('([^']*)'/gm)) {
      const key = `${m[1].toUpperCase()} ${m[2]}`;
      declared.set(key, [...(declared.get(key) || []), f.replace(/\.ts$/, '')]);
    }
  }
  for (const [route, file] of ROUTES) assert.deepEqual(declared.get(route), [file], route);
  assert.equal(declared.size, ROUTES.length, 'a route was added outside this table');
});

test('the root mounts every domain router, each once, in declaration order', () => {
  const root = readFileSync(resolve(ROUTES_DIR, 'admin_licences.ts'), 'utf8');
  const mounted = [...root.matchAll(/^r\.route\('\/', (\w+)\);$/gm)].map((m) => m[1]);
  const files = [...new Set(ROUTES.map(([, f]) => f).filter((f) => f !== 'admin_licences'))];
  const camel = (f: string) => f.replace(/_(.)/g, (_, ch) => ch.toUpperCase());
  assert.deepEqual(mounted, files.map(camel));
  // Every route module beside it is one of them: none is left unmounted.
  const onDisk = readdirSync(ROUTES_DIR).filter((n) => /^admin_licences_\w+\.ts$/.test(n)).map((n) => n.replace(/\.ts$/, '')).sort();
  assert.deepEqual(onDisk, [...files].sort());
});

test('what other modules import from admin_licences.ts is still exported there', () => {
  for (const fn of [brandKitPayload, deprovisionLicenceAdmins, enrichContractFromEnvelope, hydrate, unbindBranchAdmins]) {
    assert.equal(typeof fn, 'function');
  }
  assert.equal(EVENTS_PAGE_MAX, 100);
});
