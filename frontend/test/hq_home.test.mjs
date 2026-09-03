/**
 * HQ · Home (canvas H1) — the page that must not invent a number.
 *
 * The canvas's headline figures are per-subsidiary accounts, month-to-date
 * revenue, queue backlog and seat utilisation. None is computable: no account
 * names the licence it belongs to (UNRESOLVED_ITEMS U1). The page renders
 * what the ledger holds and says "Not recorded" for the rest, and the tenant
 * switcher narrows the loaded payload without asking the server for a scope
 * the server does not have. These pin that shape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const PAGE = codeOnly(read('frontend/src/pages/hq/HqHomePage.jsx'));
const ROUTE = codeOnly(read('cloudflare-worker/src/routes/admin_hq.ts'));
const APP = read('frontend/src/App.jsx');

test('the HQ Home row points at /hq, and /hq is HQ-only', () => {
  const home = (SIDEBAR_GROUPS.super_admin || []).flatMap((g) => g.items || []).find((r) => r.label === 'Home');
  assert.equal(home?.to, '/hq');
  const line = APP.split('\n').find((l) => l.includes('path="/hq"'));
  assert.ok(line, '/hq must be registered');
  assert.match(line, /hqOnly\(/, 'an admin without the elevation gets the notice, not the overview');
});

test('the page reads one endpoint and never sends a tenant to the server', () => {
  // The switcher narrows client-side. A scoped request here would be the
  // half-applied scope U1 warns about: this page changes, nothing else does.
  const calls = [...PAGE.matchAll(/api\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(calls)], ['hqOverview']);
  assert.match(read('frontend/src/lib/api.js'), /hqOverview: \(\) => request\('\/admin\/hq\/overview'\)/);
  assert.match(PAGE, /Narrowed to \{selected\.brand_name\} on this page only/);
});

test('every per-subsidiary figure renders Not recorded, and nothing renders an invented zero', () => {
  // The four per-card facts the canvas shows that the store cannot hold.
  for (const label of ['Accounts', 'MTD · backlog']) {
    assert.match(PAGE, new RegExp(`${label.replace(/[.·]/g, '.')}[\\s\\S]{0,120}<Unrecorded />`), `${label} per licence must be Not recorded`);
  }
  // A tile renders Not recorded for any null value, so MTD revenue — which
  // has no source at all — is passed as null rather than as a number.
  assert.match(PAGE, /label="MTD revenue" value=\{null\}/);
  assert.match(PAGE, /\{value \?\? <Unrecorded \/>\}/, 'a null tile value must render Not recorded');
  assert.match(PAGE, /utilised: <Unrecorded \/>/);
  // The formatter refuses to default: a missing figure is null, never "0".
  assert.match(PAGE, /const num = \(v\) => \(v === null \|\| v === undefined \|\| !Number\.isFinite\(Number\(v\)\) \? null/);
  // `|| 0` is how a missing field becomes a confident zero. The page has no
  // business defaulting any figure: a figure it has is real, one it lacks is
  // Not recorded.
  assert.doesNotMatch(PAGE, /\|\|\s*0\b/, 'no `|| 0` — absent is not zero');
  assert.doesNotMatch(PAGE, /\?\?\s*0\b/, 'no `?? 0` either');
});

test('a failed request is unreadable, not an empty platform', () => {
  assert.match(PAGE, /const UNAVAILABLE = Symbol\('unavailable'\)/);
  assert.match(PAGE, /could not be read\. This is not a claim that none exist\./);
  assert.match(PAGE, /No licences have been issued yet\. The ledger is empty, which is a different fact/);
});

test('the overview endpoint is super-admin only and carries the shared honesty block', () => {
  assert.doesNotMatch(ROUTE, /\brequireAdmin\b/);
  assert.match(ROUTE, /await requireSuperAdmin\(c\)/);
  assert.match(ROUTE, /\.\.\.DERIVED_UNAVAILABLE/, 'the same wording GET /licence/mine sends, not a second phrasing');
  assert.match(read('cloudflare-worker/src/routes/licence.ts'), /export const DERIVED_UNAVAILABLE/);
  assert.match(ROUTE, /escalations_available: false/);
  // The queue is platform-wide; an unreadable table is reported, not zeroed.
  assert.match(ROUTE, /queue = \{ available: false, reason:/);
});

test('the overview is mounted before the /api/admin catch-all', () => {
  const src = read('cloudflare-worker/src/index.ts');
  const mount = src.indexOf("app.route('/api/admin/hq', adminHq)");
  const catchAll = src.indexOf("app.route('/api/admin', admin)");
  assert.ok(mount > -1 && mount < catchAll);
});

test('the rail names what is not connected instead of implying it is', () => {
  assert.match(PAGE, /role="super_admin"/);
  assert.match(PAGE, /\['Per-subsidiary accounts, revenue and queue depth', 'No account names its licence yet \(U1\)\.'\]/);
  assert.match(PAGE, /\['Escalations', 'No subsidiary-to-HQ escalation exists on the platform\.'\]/);
});

/* ────────────────────────────────────────────────────────────────────────────
 * Two shapes an apex audit caught on 2026-09-03, pinned for every HQ page.
 * ──────────────────────────────────────────────────────────────────────────── */

test('every HQ rail passes [title, detail] pairs, the shape WorkerRail destructures', () => {
  // ui/WorkerRail.jsx: `unavailable.map(([title, detail]) => …)`. A bare
  // string destructures to its first two characters and renders as "A" / "c".
  const dir = 'frontend/src/pages/hq';
  const pages = readdirSync(dir).filter((f) => f.endsWith('.jsx'));
  assert.ok(pages.length > 0);
  for (const f of pages) {
    const src = codeOnly(read(`${dir}/${f}`));
    const m = /unavailable=\{\[([\s\S]*?)\]\}/.exec(src);
    if (!m) continue;
    const entries = m[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
    assert.ok(entries.length > 0, `${f}: the rail lists what is unavailable`);
    for (const e of entries) {
      assert.ok(e.startsWith('['), `${f}: rail entry is a [title, detail] pair, not a string: ${e.slice(0, 50)}`);
    }
  }
});

test('the Suspended tile never reads as fine while the overview is unreadable', () => {
  // 'none' is a fact about the ledger. When the read failed, the tile says
  // so, in the neutral tone, instead of a green 'none'.
  const src = codeOnly(read('frontend/src/pages/hq/HqHomePage.jsx'));
  const tile = src.slice(src.indexOf('label="Suspended"'), src.indexOf('label="Suspended"') + 700);
  assert.match(tile, /note=\{!ready \? 'unreadable' :/, 'the note names the unreadable read first');
  assert.match(tile, /tone=\{!ready \? 'text-axal-ink' :/, 'and takes no colour from a count it does not have');
});

