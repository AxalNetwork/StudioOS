/**
 * D512 — Admin Studio's home renders from the studio glance alone.
 *
 * The page no longer makes the four branch reads (`branchHome`, `myLicence`,
 * `branchTemplates`, `branchInsights`) or passes their props. It hands its two
 * Studio sections `user` and `glance` and nothing else.
 *
 * The page itself cannot be imported here: StudioInterview pulls in a JSON
 * manifest the test loader does not load. So the first test pins, in the
 * page's source, that those two props are all it passes; the others render
 * both sections with exactly those props, for a branch admin and an HQ admin,
 * and neither may stall on "Reading…" or need the legacy props.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AdminStudioOverview } from '../src/pages/admin/AdminStudioOverview.jsx';
import { StudioNeedsDecisionView } from '../src/pages/admin/StudioNeedsDecision.jsx';

const HOME = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/pages/admin/AdminStudioHome.jsx'), 'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

const render = (el) => renderToStaticMarkup(createElement(MemoryRouter, null, el));

const branchUser = {
  role: 'admin',
  branch: { code: 'fr', name: 'France', status: 'suspended', territories: ['FR'] },
};
const hqUser = { role: 'admin', branch: null };

const BRANCH_GLANCE = {
  tier: 'branch',
  seats: {
    recorded: true,
    seats_used_by_type: { founder: 1, investor: 0, advisor: 0, partner: 0 },
    seats: { founder: 10, investor: 1, advisor: 1, partner: 1 },
  },
  approvals: { recorded: true, lanes: [{ key: 'kyc', label: 'KYC', count: 0, oldest_age_hours: null, sla: 'ok' }] },
  programme: { recorded: true, open_week: 2, zone: 'America/New_York', week_closes_at: '2026-09-15T04:00:00.000Z', hours_to_close: 40 },
  agreements: { recorded: true, expiring: 0, window_days: 60, undated: { reason: 'Two stores have no end date.' } },
  revenue: { recorded: true, share_bps: 3500, amount_cents: null, reason: 'No amount is totalled here.' },
  licence: {
    recorded: true, revenue_share_bps: 3500, status: 'suspended', suspended_at: '2026-09-03T10:00:00Z',
    kind: 'subsidiary', domain: null, domain_available: false, domain_reason: 'The host register is at HQ.',
    brand_kit_available: false, brand_kit_reason: 'The brand kit stays at HQ.',
  },
  templates: { recorded: true, available: true, items: [{ slug: 'msa' }], pushed_at: '2026-09-01T00:00:00Z' },
  insights: { recorded: true, benchmarks_available: true, benchmarks: [], benchmarks_empty_reason: 'HQ has published no benchmark yet.' },
};

const U1 = 'No account on HQ names the licence it sits under (U1), so the user table on this database is not that count and is not shown as zero.';
const HQ_GLANCE = {
  tier: 'hq',
  branch: null,
  seats: { recorded: false, reason: `Seat use is a subsidiary figure. ${U1}` },
  approvals: { recorded: false, reason: 'The lanes are a subsidiary\'s. No row names a licence (U1).' },
  agreements: { recorded: false, reason: 'Agreements are the subsidiary\'s (U1).' },
  revenue: { recorded: false, reason: 'The share rate is a subsidiary term (U1).' },
  licence: { recorded: false, reason: 'No row names the licence (U1).' },
  programme: {
    recorded: true, zone: 'America/New_York', open_week: 2, week_closes_at: '2026-09-23T04:00:00.000Z',
    hours_to_close: 70, pending_accounts: null, reason: 'Pending accounts are a subsidiary figure (U1).',
  },
  templates: { recorded: true, available: true, items: [{ slug: 'msa' }], pushed_at: null },
  insights: { recorded: true, benchmarks_available: true, benchmarks: [] },
};

/** What the home page renders for its two Studio sections, with the props it passes. */
const page = (props) => render(createElement('div', null,
  createElement(StudioNeedsDecisionView, props),
  createElement(AdminStudioOverview, props)));

test('the home page passes its two Studio sections user and glance, and nothing else', () => {
  assert.match(HOME, /<StudioNeedsDecisionView user=\{user\} glance=\{glance\} \/>/);
  assert.match(HOME, /<AdminStudioOverview user=\{user\} glance=\{glance\} \/>/);
  assert.doesNotMatch(HOME, /useEffect|useState|\bapi\b/, 'the home page reads something of its own again');
});

const stalled = (html) => /data-testid="(studio-decide-reading|admin-studio-reading)"/.test(html);

test('a branch admin with only the glance: the strip and the cards both draw from it', () => {
  const html = page({ user: branchUser, glance: BRANCH_GLANCE });
  assert.ok(!stalled(html), 'a Studio section is still waiting on a read the page no longer makes');
  assert.match(html, /data-testid="studio-needs-decision"/);
  assert.match(html, /data-testid="admin-studio-overview"/);
  assert.match(html, /Founder 1 of 10/, 'the seat figure did not come from the glance');
  assert.match(html, /data-testid="admin-studio-frozen"/, 'the suspended licence did not reach the cards');
  assert.match(html, /Share rate 35%/);
});

test('an HQ admin with only the glance: the subsidiary figures say why they are absent, never zero', () => {
  const html = page({ user: hqUser, glance: HQ_GLANCE });
  assert.ok(!stalled(html), 'a Studio section is still waiting on a read the page no longer makes');
  assert.match(html, /data-testid="studio-needs-decision"/);
  assert.match(html, /data-testid="admin-studio-overview"/);
  assert.match(html, /U1/, 'the server\'s reason for an absent subsidiary figure was not shown');
  assert.doesNotMatch(html, /Founder \d+ of \d+/, 'an HQ admin was shown a subsidiary seat count');
});
