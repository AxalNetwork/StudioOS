/**
 * D447 — a branch user can render the glance without the four legacy props,
 * and a failed glance does not forget which tier they are on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { AdminStudioOverview } from '../src/pages/admin/AdminStudioOverview.jsx';
import { StudioNeedsDecisionView } from '../src/pages/admin/StudioNeedsDecision.jsx';
import { UNAVAILABLE, glancesFromStudioGlance, tileUrgency } from '../src/pages/admin/adminStudioOverview.js';

const render = (el) => renderToStaticMarkup(createElement(MemoryRouter, null, el));

const branchUser = {
  role: 'admin',
  branch: { code: 'fr', name: 'France', status: 'suspended', territories: ['FR'] },
};

const glance = {
  tier: 'branch',
  seats: {
    recorded: true,
    seats_used_by_type: { founder: 1, investor: 0, advisor: 0, partner: 0 },
    seats: { founder: 10, investor: 1, advisor: 1, partner: 1 },
  },
  approvals: {
    recorded: true,
    lanes: [{ key: 'kyc', label: 'KYC', count: 0, oldest_age_hours: null, sla: 'ok' }],
  },
  programme: {
    recorded: true,
    open_week: 2,
    zone: 'America/New_York',
    week_closes_at: '2026-09-15T04:00:00.000Z',
    hours_to_close: 40,
  },
  agreements: { recorded: true, expiring: 0, window_days: 60, undated: { reason: 'Two stores have no end date.' } },
  revenue: { recorded: true, share_bps: 3500, amount_cents: null, reason: 'No amount is totalled here.' },
  licence: {
    recorded: true,
    revenue_share_bps: 3500,
    status: 'suspended',
    suspended_at: '2026-09-03T10:00:00Z',
    kind: 'subsidiary',
    domain: null,
    domain_available: false,
    domain_reason: 'The host register is at HQ.',
    brand_kit_available: false,
    brand_kit_reason: 'The brand kit stays at HQ.',
  },
  templates: { recorded: true, available: true, items: [{ slug: 'msa' }], pushed_at: '2026-09-01T00:00:00Z' },
  insights: { recorded: true, benchmarks_available: true, benchmarks: [], benchmarks_empty_reason: 'HQ has published no benchmark yet.' },
};

test('a glance-only render does not throw for a branch user', () => {
  const props = { user: branchUser, glance };
  const strip = render(createElement(StudioNeedsDecisionView, props));
  const cards = render(createElement(AdminStudioOverview, props));
  assert.match(strip, /Founder 1 of 10/);
  assert.match(cards, /admin-studio-frozen/);
  assert.match(cards, /1 of 10/);
  assert.match(cards, /admin-studio-territory/);
});

test('no props does not throw, and the first paint says it is reading', () => {
  const strip = render(createElement(StudioNeedsDecisionView, {}));
  const cards = render(createElement(AdminStudioOverview, {}));
  assert.match(strip, /studio-decide-reading/);
  assert.match(strip, /Reading/);
  assert.match(cards, /admin-studio-reading/);
  assert.doesNotMatch(strip, /studio-decide-off-branch/);
  assert.doesNotMatch(cards, /not on a branch deployment/);
});

test('a failed glance keeps the branch tier, so a suspension still freezes the page', () => {
  const g = glancesFromStudioGlance(UNAVAILABLE, branchUser);
  assert.equal(g.onBranch, true);
  assert.equal(g.tier, 'branch');
  const cards = render(createElement(AdminStudioOverview, { user: branchUser, glance: UNAVAILABLE }));
  assert.match(cards, /admin-studio-frozen/);
  const strip = render(createElement(StudioNeedsDecisionView, { user: branchUser, glance: UNAVAILABLE }));
  assert.match(strip, /Suspended — writes are blocked/);
  assert.doesNotMatch(strip, /studio-decide-off-branch/);
});

test('a failed seat count and a failed share rate are unreadable, and a null hour is not zero', () => {
  const g = glancesFromStudioGlance({
    tier: 'branch',
    seats: { recorded: true, seats_used_by_type: null, seats: { founder: 4 } },
    approvals: { recorded: true, lanes: glance.approvals.lanes },
    programme: { ...glance.programme, hours_to_close: null },
    agreements: glance.agreements,
    revenue: { available: false, reason: 'The licence copy could not be read, so the share rate on it is unknown.' },
    licence: { available: false, reason: 'The table this branch keeps its licence copy in could not be read.' },
    templates: glance.templates,
    insights: { recorded: false, reason: 'HQ pushes the median and keeps no copy.' },
  }, branchUser);
  assert.equal(g.seats.kind, 'unreadable');
  assert.equal(g.programme.hoursToClose, null);
  assert.equal(tileUrgency('programme', g.programme), 3);
  assert.equal(g.insights.share.kind, 'unreadable');
  assert.equal(g.insights.median.kind, 'unrecorded');
  assert.match(g.insights.median.reason, /keeps no copy/);
  assert.ok(g.licenceUnreadable);
  const strip = render(createElement(StudioNeedsDecisionView, {
    user: branchUser,
    glance: {
      tier: 'branch',
      seats: { recorded: true, seats_used_by_type: null },
      approvals: glance.approvals,
      programme: glance.programme,
      agreements: glance.agreements,
      revenue: { available: false, reason: 'The licence copy could not be read, so the share rate on it is unknown.' },
      licence: { recorded: true, revenue_share_bps: 3500, kind: 'subsidiary', domain_available: false, domain_reason: 'hq' },
      templates: glance.templates,
      insights: glance.insights,
    },
  }));
  assert.match(strip, /Share rate could not be read/);
  assert.doesNotMatch(strip, /Share rate not recorded/);
});
