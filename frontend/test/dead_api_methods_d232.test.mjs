/**
 * D232 — three `api.js` methods with no caller are gone; their routes stay.
 *
 * `getTicketMapping`, `adminDeleteGithubConfig` and `adminCatalogMode` had no
 * caller in frontend/src. None had a real one waiting: the tickets page reads
 * sync state off the ticket itself (D171), GitHub Sync draws no Remove
 * control, and the catalog mode already rides on `adminCatalogList` and
 * `adminStripeGetConfig`. The worker routes are NOT retired — each is still
 * reachable, and `DELETE /api/admin/github` stays behind D223's holder bar.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const API = codeOnly(raw('frontend/src/lib/api.js'));
const GONE = ['getTicketMapping', 'adminDeleteGithubConfig', 'adminCatalogMode'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

test('the three methods are gone from api.js', () => {
  for (const m of GONE) assert.doesNotMatch(API, new RegExp(`\\b${m}\\s*:`), `api.${m} is back`);
});

test('nothing in frontend/src calls them', () => {
  for (const f of walk(resolve(process.cwd(), 'frontend/src'))) {
    const src = codeOnly(readFileSync(f, 'utf8'));
    for (const m of GONE) assert.doesNotMatch(src, new RegExp(`\\bapi\\.${m}\\b`), `${f} calls api.${m}`);
  }
});

test('the worker routes they called are still there — nothing retires', () => {
  assert.match(raw('cloudflare-worker/src/routes/tickets.ts'), /tickets\.get\('\/:id\{\[0-9\]\+\}\/mapping'/);
  assert.match(raw('cloudflare-worker/src/routes/catalog.ts'), /adminCatalog\.get\('\/mode'/);
  assert.match(raw('cloudflare-worker/src/routes/admin_github.ts'), /r\.delete\('\/', async \(c\) => \{\n\s+const admin = await requireSuperAdminWriteBar\(c\);/);
  // The mode the deleted method fetched is still on the payloads the page reads.
  assert.match(API, /adminCatalogList:/);
  assert.match(API, /adminStripeGetConfig:/);
});
