/**
 * D642 (#1435) — the storage read's records, and the two screens'. The
 * mounted `/api/usage` read is never undocumented, and ROUTE_MAP names the
 * component that draws each Usage screen. The storage-area catalogue (which
 * keys exist, and that ROUTE_MAP names each) is the contract in
 * `_storageAreasContract.mjs`, held by storage_areas_contract_5507 (#5507,
 * D5507); this file no longer parses it out of the service's source.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/usage_records_d642.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readRouteMap } from '../../scripts/lib/routeMap.mjs';

const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const index = read('cloudflare-worker/src/index.ts');
const routesReadme = read('cloudflare-worker/src/routes/README.md');
const routeMap = readRouteMap();

const HEADING = '### Usage page and HQ allowances (D642, #1435)';
/** The D642 section of ROUTE_MAP, up to the next heading of any level. */
function d642Section() {
  const at = routeMap.indexOf(HEADING);
  if (at < 0) return null;
  const next = routeMap.slice(at + HEADING.length).search(/\n#{1,3} /);
  return next < 0 ? routeMap.slice(at) : routeMap.slice(at, at + HEADING.length + next);
}

test('/api/usage is mounted, and the routes README lists the mount', () => {
  assert.match(index, /app\.route\('\/api\/usage', usage\);/);
  assert.match(routesReadme, /^\/api\/usage\s+→ usage\.ts\s+\(.*D642\)$/m);
});

test('ROUTE_MAP records the storage read', () => {
  const section = d642Section();
  assert.ok(section, 'the D642 section is missing');
  // The prose names the read and its areas; the table's U1–U6 row reads it.
  const [prose, table = ''] = section.split('| Canvas |');
  assert.match(prose, /`GET \/api\/usage\/storage` \(`usage\.ts`/);
  assert.match(table, /\| `\/account\/usage\/cost` [^\n]*`GET \/api\/usage\/storage`/);
});

test('ROUTE_MAP marks both screens CURRENT, naming the component that draws each', () => {
  const section = d642Section();
  assert.ok(section, 'the D642 section is missing');
  assert.match(section, /\| `\/account\/usage\/cost` \([^\n]*\| `pages\/account\/AccountUsage\.jsx`[^\n]*\| CURRENT \|/);
  assert.match(section, /\| `\/admin\/platform\/allowances` ·[^\n]*\| `pages\/hq\/PlatformAllowancesPage\.jsx`[^\n]*\| CURRENT \|/);
  assert.doesNotMatch(section, /\| NEW \|/, 'no screen is left recorded as unbuilt');
});
