/**
 * D443 — the strip and the cards read the glance, and HQ's per-subsidiary
 * figures stay Not recorded.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { AdminStudioOverview } from '../src/pages/admin/AdminStudioOverview.jsx';
import { StudioNeedsDecisionView } from '../src/pages/admin/StudioNeedsDecision.jsx';
import { contractsGlance, glancesFromStudioGlance } from '../src/pages/admin/adminStudioOverview.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const render = (el) => renderToStaticMarkup(createElement(MemoryRouter, null, el));

const U1 = 'No account on HQ names the licence it sits under (U1), so the user table on this database is not that count and is not shown as zero.';

const HQ = {
  tier: 'hq',
  branch: null,
  seats: { recorded: false, reason: `Seat use is a subsidiary figure. ${U1}` },
  approvals: { recorded: false, reason: 'The lanes are a subsidiary\'s. No row names a licence (U1).' },
  agreements: { recorded: false, reason: 'Agreements are the subsidiary\'s (U1).' },
  revenue: { recorded: false, reason: 'The share rate is a subsidiary term (U1).' },
  licence: { recorded: false, reason: 'No row names the licence (U1).' },
  programme: {
    recorded: true,
    zone: 'America/New_York',
    open_week: 2,
    week_closes_at: '2026-09-23T04:00:00.000Z',
    hours_to_close: 70,
    pending_accounts: null,
    reason: 'Pending accounts are a subsidiary figure (U1).',
  },
  templates: {
    recorded: true,
    available: true,
    items: [{ slug: 'msa' }],
    pushed_at: null,
  },
  insights: {
    recorded: true,
    benchmarks_available: true,
    benchmarks: [],
  },
};

test('an empty master library uses the server\'s empty reason, not the pushed-copy sentence', () => {
  const empty = contractsGlance({ available: true, items: [], empty_reason: 'The master library was read and it holds no active template.' });
  assert.equal(empty.kind, 'unrecorded');
  assert.match(empty.reason, /master library/);
  assert.doesNotMatch(empty.reason, /pushed a library/);
});

test('HQ\'s glance leaves the four subsidiary figures unrecorded and shows the clock and the library', () => {
  const g = glancesFromStudioGlance(HQ);
  assert.equal(g.onBranch, false);
  assert.equal(g.tier, 'hq');
  assert.equal(g.seats.kind, 'unrecorded');
  assert.match(g.seats.reason, /U1/);
  assert.match(g.seats.reason, /not shown as zero/);
  assert.equal(g.approvals.kind, 'unrecorded');
  assert.equal(g.contracts.agreements.kind, 'unrecorded');
  assert.equal(g.insights.share.kind, 'unrecorded');
  assert.match(g.insights.share.reason, /U1/);
  assert.match(g.programme.text, /Week 2 gate closes/);
  assert.match(g.contracts.text, /1 HQ template ready to instantiate/);
  assert.equal(g.lic, null);
  assert.match(g.licenceAbsence, /U1/);
});

test('the strip and the cards render that HQ glance, and neither links under /branch/', () => {
  const props = { user: { role: 'admin' }, glance: HQ };
  const strip = render(createElement(StudioNeedsDecisionView, props));
  const cards = render(createElement(AdminStudioOverview, props));
  assert.doesNotMatch(strip, /studio-decide-off-branch/);
  assert.match(strip, /data-testid="studio-decide-seats"/);
  assert.match(strip, /U1/);
  assert.match(strip, /HQ-held/);
  assert.match(strip, /href="\/admin\/held\/accounts"/);
  assert.doesNotMatch(strip, /href="\/branch\//);
  assert.match(cards, /admin-studio-hq/);
  assert.match(cards, /1 HQ template/);
  assert.match(cards, /U1/);
  assert.doesNotMatch(cards, /href="\/branch\//);
  assert.match(cards, /Hostname not read/);
  assert.match(cards, /title="[^"]*U1[^"]*"/);
});

test('the loader lives in the overview module, and the home page is not the caller', () => {
  const js = read('frontend/src/pages/admin/adminStudioOverview.js');
  const decide = read('frontend/src/pages/admin/StudioNeedsDecision.jsx');
  const overview = read('frontend/src/pages/admin/AdminStudioOverview.jsx');
  assert.match(js, /adminStudioGlance/);
  assert.match(decide, /loadStudioGlance\(/);
  assert.match(overview, /loadStudioGlance\(/);
  assert.match(decide, /glancesFromStudioGlance\(/);
  assert.match(overview, /glancesFromStudioGlance\(/);
});
