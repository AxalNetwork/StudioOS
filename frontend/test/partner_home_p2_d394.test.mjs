/**
 * D394 — Partner Home P2, built and tested, NOT mounted.
 *
 * Drives the page's own tile and feed helpers with real-shaped payloads and
 * renders the view in each state. The last test pins that nothing mounts it:
 * `/studio` stays `PartnerStudioHome` until the owner signs P2 off, and the
 * day Session 3 mounts it this assertion is the one that changes, on purpose.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/partner_home_p2_d394.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import { homeTiles, homeFeed, PartnerHomeP2View } from '../src/pages/partner/PartnerHomeP2.jsx';

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

const BOARD = {
  due_next_7_days: 3,
  needs_attention: 1,
  unrated_count: 2,
  items: [
    { engagement_id: 1, client: 'Verwood', scope: 'Payments', status: 'accepted', mode: 'embedded', grant: 'Board, KPIs', grant_holder: 'Rin', health: 'at_risk', health_reasons: ['2 milestones overdue'], milestones_due_7d: 2 },
    { engagement_id: 2, client: 'Thornfield', scope: 'Brand', status: 'in_progress', mode: 'project', health: null, health_reasons: [], milestones_due_7d: 1 },
    { engagement_id: 3, client: 'Oldco', status: 'delivered', mode: 'project', health: 'blocked', health_reasons: ['x'], milestones_due_7d: 0 },
    { engagement_id: 4, client: 'Revoked', status: 'accepted', mode: 'embedded', seat_revoked_at: '2026-01-01', grant: 'All', milestones_due_7d: 0 },
  ],
};
const RETAINERS = {
  mrr_cents: 1250000,
  items: [
    { engagement_id: 1, founder_name: 'Verwood', retainer: { renews_at: day(20) } },
    { engagement_id: 2, founder_name: 'Thornfield', retainer: { renews_at: day(90) } },
    { engagement_id: 5, founder_name: 'Nobody', retainer: null },
  ],
};
const CAP_NONE = { over_committed_count: null, cap_note: 'No capacity cap is recorded anywhere in this product.', people: [] };
const CAP_SET = {
  over_committed_count: 1,
  people: [{ user_id: 9, name: 'Rin', total_hours: 46, cap_hours: 40, cap_source: 'person', over_committed: true },
           { user_id: 10, name: 'Sam', total_hours: 10, cap_hours: 40, cap_source: 'firm', over_committed: false }],
};

const tile = (tiles, key) => tiles.find((t) => t.key === key);

test('D394: the five tiles read the three stores, and live means neither closed nor revoked', () => {
  const t = homeTiles({ board: BOARD, retainers: RETAINERS, capacity: CAP_SET });
  assert.deepEqual(t.map((x) => x.label), ['Active engagements', 'Due this week', 'At risk', 'Recurring', 'Over capacity']);
  assert.equal(tile(t, 'active').value, 2, 'delivered and revoked-seat engagements are not active');
  assert.equal(tile(t, 'active').note, '1 embedded, 1 project');
  assert.equal(tile(t, 'due').value, 3);
  assert.equal(tile(t, 'risk').value, 1);
  assert.match(tile(t, 'risk').note, /2 unrated, not counted as fine/);
  assert.equal(tile(t, 'recurring').value, '$12,500', 'cents, not dollars');
  assert.equal(tile(t, 'recurring').note, '1 renewing in 60 days');
  assert.equal(tile(t, 'capacity').value, 1);
});

test('D394: no stated cap is Not recorded with the worker\'s reason, never 0 over', () => {
  const t = homeTiles({ board: BOARD, retainers: { mrr_cents: null, mrr_note: 'No retainer states an amount.', items: [] }, capacity: CAP_NONE });
  assert.equal(tile(t, 'capacity').value, null);
  assert.match(tile(t, 'capacity').reason, /No capacity cap is recorded/);
  assert.equal(tile(t, 'recurring').value, null);
  assert.match(tile(t, 'recurring').reason, /No retainer states an amount/);
});

test('D394: a failed read is unreadable, not empty', () => {
  const t = homeTiles({ board: null, retainers: null, capacity: null });
  assert.ok(t.every((x) => x.unreadable && x.value === null));
});

test('D394: the feed names each line\'s receipt, and a seat reads as recorded by the firm', () => {
  const f = homeFeed({ board: BOARD, retainers: RETAINERS, capacity: CAP_SET });
  const keys = f.map((x) => x.key);
  assert.deepEqual(keys, ['risk-1', 'due-1', 'due-2', 'cap-9', 'renew-1', 'seat-1']);
  assert.ok(f.every((x) => x.receipt && x.to), 'every line has a receipt and a place to act');
  assert.equal(f[0].body, '2 milestones overdue');
  assert.equal(f.find((x) => x.key === 'cap-9').body, '46 h against a cap of 40 h');
  const seat = f.find((x) => x.key === 'seat-1');
  assert.equal(seat.grant, 'Scope recorded by the firm: Board, KPIs');
  assert.ok(!f.some((x) => /granted by/i.test(`${x.grant || ''}${x.title}`)), 'no chip speaks in the founder\'s voice');
  assert.ok(!keys.includes('risk-3') && !keys.includes('seat-4'), 'closed and revoked rows stay off the feed');
  assert.ok(homeFeed({ board: { items: Array.from({ length: 10 }, (_, i) => ({ engagement_id: i, health: 'blocked', status: 'accepted' })) } }).length <= 6);
});

const render = (state) => renderedText(renderToStaticMarkup(
  React.createElement(MemoryRouter, null, React.createElement(PartnerHomeP2View, { state, onRetry: () => {} })),
));

test('D394: the page draws the artboard\'s question, the tiles, the brief band and the feed', () => {
  const t = render({ status: 'ready', reads: { board: BOARD, retainers: RETAINERS, capacity: CAP_SET } });
  assert.match(t, /Where does the firm stand today\?/);
  assert.match(t, /3 milestones due this week · 1 at risk · 1 over capacity/);
  assert.match(t, /Proposal · operating brief/);
  assert.match(t, /Scope recorded by the firm: Board, KPIs/);
  assert.match(t, /Not on this page: messages from a client/);
  assert.doesNotMatch(t, /recommend/i);
});

test('D394: unlinked, preview and failed reads each say what they are', () => {
  assert.match(render({ status: 'unlinked' }), /No partner profile is attached to this sign-in/);
  const p = render({ status: 'preview' });
  assert.match(p, /withheld in role preview/);
  assert.doesNotMatch(p, /could not be read/);
  const bad = render({ status: 'ready', reads: { board: null, retainers: null, capacity: null } });
  assert.match(bad, /Active engagements could not be read/);
  assert.doesNotMatch(bad, /\b0 at risk\b/);
});

test('D394: the brief is the home/brief surface, run on a click and never on mount', () => {
  const src = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/pages/partner/PartnerHomeP2.jsx'), 'utf8'));
  assert.match(src, /<ZoneDraft\s+surface="home\/brief"/);
  assert.doesNotMatch(src, /zoneDraftRun/, 'the page itself never runs a draft');
  const worker = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/research.ts'), 'utf8');
  assert.match(worker, /\n  'home\/brief': \{/);
});

test('D394: P2 is built and not mounted — /studio stays PartnerStudioHome until the owner signs it off', () => {
  const importers = [];
  // Directory entries carry their own type, so nothing is stat-ed and then
  // read (CodeQL's file-system race, raised on the first draft's statSync).
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(jsx?|mjs)$/.test(entry.name) && !p.endsWith('PartnerHomeP2.jsx')
        && /from ['"][^'"]*PartnerHomeP2['"]/.test(readFileSync(p, 'utf8'))) importers.push(p);
    }
  };
  walk(resolve(process.cwd(), 'frontend/src'));
  assert.deepEqual(importers, [], 'P2 was mounted without the owner\'s sign-off');
  assert.match(readFileSync(resolve(process.cwd(), 'frontend/src/pages/Dashboard.jsx'), 'utf8'), /PartnerStudioHome/,
    '/studio still renders the partner studio home');
});
