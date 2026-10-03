/**
 * D505 — the partner sidebar stops naming the retired `/partner/operations/*`
 * routes (D395 redirects): each `match` points at the successor, the
 * full-bleed list drops the six retired entries, and the comments say so.
 *
 * What fails quietly here, and so what this file pins:
 *
 *   - A `match` entry for an address that never renders. A bookmark to it
 *     redirects and the successor lights its own row, so the entry does
 *     nothing — dead code wearing a route's name — and the next reader takes
 *     it for a live route.
 *   - A successor that is not where D395 sent the retired address, or that
 *     is not a mounted route at all.
 *   - A full-bleed entry for a redirect: harmless today, and a false claim
 *     that the path renders a body.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/partner_sidebar_d505.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { SIDEBAR_GROUPS, PARTNER_FULL_BLEED } from '../src/sidebarConfig.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const SIDEBAR = read('frontend/src/sidebarConfig.js');
const SIDEBAR_CODE = codeOnly(SIDEBAR);
const APP = codeOnly(read('frontend/src/App.jsx'));
const partnerRows = () => SIDEBAR_GROUPS.partner.flatMap((g) => g.items);

// D395's own mapping, retired address → successor, and the row that owns each.
const SUCCESSOR = {
  '/partner/operations': ['/company-settings', 'Delivery'],
  '/partner/operations/overview': ['/company-settings', 'Delivery'],
  '/partner/operations/capabilities': ['/offers/catalog', 'Offers'],
  '/partner/operations/portfolio': ['/delivery/health', 'Delivery'],
  '/partner/operations/engagements': ['/pipeline/proposals', 'Pipeline'],
  '/partner/operations/performance': ['/pipeline/analytics', 'Pipeline'],
};

test('no partner row and no full-bleed entry names a retired address', () => {
  for (const row of partnerRows()) {
    for (const p of [row.to, ...(row.match || [])]) {
      assert.ok(!p.startsWith('/partner/operations'), `${row.label} still names ${p}`);
    }
  }
  assert.deepEqual(PARTNER_FULL_BLEED.filter((p) => p.startsWith('/partner/operations')), [], 'the full-bleed list still carries a redirect');
  // The code of the partner block, comments stripped, carries no such string.
  const block = SIDEBAR_CODE.slice(SIDEBAR_CODE.indexOf('\n  partner: ['), SIDEBAR_CODE.indexOf('\n  investor: ['));
  assert.ok(block.length > 200, 'the partner block was found');
  assert.doesNotMatch(block, /partner\/operations/);
});

test('each successor sits in the row D395 assigned, and each retired address redirects to it in App.jsx', () => {
  const byLabel = Object.fromEntries(partnerRows().map((r) => [r.label, r]));
  for (const [retired, [successor, label]] of Object.entries(SUCCESSOR)) {
    const row = byLabel[label];
    assert.ok(row, `no partner row labelled ${label}`);
    assert.ok((row.match || []).includes(successor), `${label} does not match ${successor} (for ${retired})`);
    assert.match(APP, new RegExp(`<Route path="${retired.replace(/\//g, '\\/')}" element=\\{<Navigate to="${successor.replace(/\//g, '\\/')}" replace \\/>\\} \\/>`),
      `${retired} is not a redirect to ${successor}`);
    assert.match(APP, new RegExp(`<Route path="${successor.replace(/\//g, '\\/')}"`), `${successor} is not a mounted route`);
  }
  // Nothing invented: every partner `match` entry is a mounted route or a
  // prefix some mounted route starts with.
  const mounted = [...APP.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);
  for (const row of partnerRows()) {
    for (const p of row.match || []) {
      assert.ok(mounted.some((m) => m === p || m.startsWith(`${p}/`)), `${row.label} matches ${p}, which no route mounts`);
    }
  }
});

test('the full-bleed list still covers every partner workspace route, has no duplicates, and keeps the centred page out', () => {
  const prefixes = partnerRows().filter((r) => r.match).map((r) => r.to);
  for (const p of prefixes) assert.ok(PARTNER_FULL_BLEED.includes(p), `${p} left the full-bleed list`);
  for (const p of ['/pipeline/proposals', '/pipeline/analytics', '/delivery/health', '/offers/catalog']) {
    assert.ok(PARTNER_FULL_BLEED.includes(p), `${p} is a successor that owns a full-bleed body and is not listed`);
  }
  assert.ok(!PARTNER_FULL_BLEED.includes('/company-settings'), 'Firm Settings is a centred page by design');
  assert.deepEqual(PARTNER_FULL_BLEED.filter((p, i, a) => a.indexOf(p) !== i), []);
});

test('the comments say what D395 made true', () => {
  const block = SIDEBAR.slice(SIDEBAR.indexOf('// ── Partner / Operator'), SIDEBAR.indexOf('\n  investor: ['));
  assert.doesNotMatch(block, /tabbed by\s*\/\/\s*PartnerOperationsWorkspace/, 'Delivery is no longer the operations subtree');
  assert.doesNotMatch(block, /engagements` can sit under Pipeline while/, 'the collision example named a retired address');
  assert.match(block, /Delivery → the \/delivery\/\* zones \(board, health\); the retired\s*\/\/\s*\/partner\/operations tabs redirect into them \(D395\)/);
  assert.match(block, /named\s*\/\/\s*nowhere in this file/);
  const bleed = SIDEBAR.slice(SIDEBAR.indexOf('export const PARTNER_FULL_BLEED'), SIDEBAR.indexOf("'/needs', '/services', '/perks', '/partner/insights',"));
  assert.match(bleed, /left this list with D505/);
});
