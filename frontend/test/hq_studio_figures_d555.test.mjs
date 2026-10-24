/**
 * D555 (#1155) — HQ's own figures on the admin Studio overview, the
 * needs-a-decision strip and the HQ-held pages.
 *
 * Every state is rendered: loading, ready, an unreadable lane or figure, and a
 * measured 0 kept apart from "Not recorded".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  glancesFromStudioGlance, hqAccountsView, hqApprovalsView, hqInsightsView, LANE_CONSOLES, NO_QUEUE_CONSOLES,
  orderNeedsDecision,
} from '../src/pages/admin/adminStudioOverview.js';
import { AdminStudioOverview, HqAccounts, HqApprovals, HqInsights } from '../src/pages/admin/AdminStudioOverview.jsx';
import { StudioNeedsDecisionView } from '../src/pages/admin/StudioNeedsDecision.jsx';
import { LaneState } from '../src/pages/admin/HeldApprovals.jsx';
import { Figure, laneOf } from '../src/pages/admin/heldFigures.jsx';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => html(el).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const LABEL = 'HQ-held accounts · axal.vc';
const LANES = [
  { key: 'lp', label: 'LP applications', count: null, oldest_age_hours: null, sla: 'unknown', reason: 'This lane\'s store could not be read on this database.' },
  { key: 'kyc', label: 'KYC', count: 4, oldest_age_hours: 96, sla: 'past' },
  { key: 'jobs', label: 'Jobs', count: 1, oldest_age_hours: 5, sla: 'ok' },
  { key: 'events', label: 'Events', count: 0, oldest_age_hours: null, sla: 'ok' },
];
const PAYLOAD = {
  tier: 'hq', branch: null,
  seats: { recorded: false, reason: 'Seat use is a subsidiary figure (U1).' },
  revenue: { recorded: false, reason: 'U1 share' },
  licence: { recorded: false, reason: 'U1 licence' },
  accounts: { recorded: true, label: LABEL, total: 12, by_role: [{ role: 'founder', count: 7 }, { role: 'investor', count: 5 }],
    new_7d: 0, new_30d: 3, deactivated: 1, exploring: 2, trash_projects: 0 },
  approvals: { recorded: true, label: LABEL, lanes: LANES, pending_total: null, unreadable: ['LP applications'],
    no_queue: [{ label: 'Circles', reason: 'Admins create circles and publish them; nobody submits one for review.' }],
    not_applicable: [{ label: 'Content to HQ', reason: 'Not applicable.' }] },
  programme: { recorded: true, zone: 'America/New_York', open_week: null, reason: 'No cohort week is open.' },
  agreements: { recorded: true, window_days: 90, expiring: 0, by_source: {}, undated: { sources: [], reason: '' } },
  templates: { recorded: true, available: true, items: [{ slug: 'msa' }], pushed_at: null },
  insights: { recorded: true, label: LABEL,
    signups_by_week: { available: true, weeks: Array.from({ length: 8 }, (_, i) => ({ week_start: `2026-08-${String(10 + i * 7).padStart(2, '0')}`, count: i, to_date: i === 7 })) },
    active_accounts: { recorded: false, reason: 'No store on this database records a sign-in per account.' },
    ai_spend_month: { available: true, month: '2026-10', usd: 12.5, calls: 40 },
    open_tickets: { available: false, reason: 'The support ticket table could not be read.' },
    benchmark: { recorded: false, reason: 'HQ pushes the territory median and keeps no copy (D148).' } },
};

test('the view models: accounts counts, lanes worst first with consoles, insights each in its own state', () => {
  const a = hqAccountsView(PAYLOAD.accounts);
  assert.equal(a.kind, 'ready');
  assert.match(a.text, /^12 accounts · 7 founder · 5 investor · 0 new this week · 2 exploring$/);
  assert.equal(hqAccountsView({ available: false, reason: 'gone' }).kind, 'unreadable');
  const ap = hqApprovalsView(PAYLOAD.approvals);
  assert.equal(ap.total, null);
  assert.equal(ap.unreadable, 1);
  assert.equal(ap.worst.key, 'kyc', 'the first lane with something pending, as the Worker sorted them');
  assert.match(ap.text, /^1 lane could not be read, so no total · worst: KYC, oldest 4 days$/);
  assert.equal(ap.lanes.find((l) => l.key === 'kyc').to, '/admin?tab=kyc');
  assert.deepEqual(ap.noQueue, [{ label: 'Circles', reason: PAYLOAD.approvals.no_queue[0].reason, to: '/admin/circles' }]);
  assert.match(hqApprovalsView({ ...PAYLOAD.approvals, pending_total: 0, lanes: [] }).text, /^Nothing is waiting$/);
  assert.match(hqApprovalsView({ ...PAYLOAD.approvals, pending_total: 5 }).text, /^5 pending · worst: KYC/);
  const i = hqInsightsView(PAYLOAD.insights);
  assert.deepEqual([i.signups.thisWeek, i.signups.eightWeeks], [7, 28]);
  assert.equal(i.spend.usd, 12.5);
  assert.equal(i.tickets.kind, 'unreadable');
  assert.equal(i.active.kind, 'unrecorded');
  // Every console the overview links is one HeldApprovals links.
  const held = read('frontend/src/pages/admin/HeldApprovals.jsx');
  for (const to of [...Object.values(LANE_CONSOLES), ...Object.values(NO_QUEUE_CONSOLES)]) {
    assert.ok(held.includes(`to="${to}"`), `${to} is not a lane console on HeldApprovals`);
  }
});

test('glancesFromStudioGlance on HQ: an hq block, approvals from it, the median from the benchmark reason', () => {
  const g = glancesFromStudioGlance(PAYLOAD, null);
  assert.ok(g.hq);
  assert.equal(g.approvals.kind, 'ready');
  assert.match(g.approvals.text, /worst: KYC/);
  assert.equal(g.insights.median.kind, 'unrecorded');
  assert.match(g.insights.median.reason, /keeps no copy/);
  const branch = glancesFromStudioGlance({ ...PAYLOAD, tier: 'branch', approvals: { recorded: true, lanes: LANES } }, null);
  assert.equal(branch.hq, null, 'a branch keeps its own path');
});

test('the overview cards draw HQ\'s figures, labelled, with each line linking to its console', () => {
  const t = text(h(AdminStudioOverview, { user: null, glance: PAYLOAD }));
  assert.match(t, /HQ-held accounts · axal\.vc/);
  assert.match(t, /12 active accounts/);
  assert.match(t, /7 Founder/);
  assert.match(t, /0 new this week · 3 in 30 days/, 'a measured 0 is printed as 0');
  assert.match(t, /Exploring 2 · Projects in Trash 0/);
  assert.match(t, /1 deactivated, not counted above/);
  assert.match(t, /No total: a lane could not be read/);
  assert.match(t, /KYC · 4 pending · oldest 4 days · past the window/);
  assert.match(t, /Jobs · 1 pending · oldest 5h/);
  assert.match(t, /LP applications could not be read/);
  assert.doesNotMatch(t, /Events · 0 pending/, 'an empty lane is not listed on the card');
  assert.match(t, /Sign-ups: 7 this week \(to date\) · 28 in 8 weeks/);
  assert.match(t, /AI spend this month: \$12\.50 over 40 calls/);
  assert.match(t, /Tickets could not be read/);
  assert.match(t, /Active accounts: Not recorded/);
  const markup = html(h(AdminStudioOverview, { user: null, glance: PAYLOAD }));
  for (const to of ['/admin?tab=kyc', '/admin/jobs', '/admin/exploring', '/admin/trash', '/admin/lp-applications']) {
    // None of these paths carries an &, so the href is the path as written.
    assert.ok(markup.includes(`href="${to}"`), `${to} is not linked`);
  }
});

test('each HQ block keeps loading, unreadable and not-recorded apart', () => {
  assert.match(text(h(HqAccounts, { view: { kind: 'unreadable', reason: 'The account table could not be read.' } })), /could not be read/);
  assert.match(text(h(HqApprovals, { view: { kind: 'unrecorded', reason: 'not on the glance' } })), /Not recorded/);
  assert.match(text(h(HqInsights, { view: null })), /Reading/);
  const zero = text(h(HqApprovals, { view: hqApprovalsView({ ...PAYLOAD.approvals, pending_total: 0, lanes: [] }) }));
  assert.match(zero, /Nothing is waiting/);
  assert.doesNotMatch(zero, /Not recorded/);
});

test('a failed Exploring or Trash read is Unreadable, not Not recorded', () => {
  const view = hqAccountsView({ ...PAYLOAD.accounts, exploring: null, trash_projects: null });
  const t = text(h(HqAccounts, { view }));
  assert.match(t, /The Exploring lane could not be read\. Its count is not shown as zero\./);
  assert.match(t, /The project table could not be read\. Trash is not shown as zero\./);
  assert.doesNotMatch(t, /not read|Not recorded/);
  assert.doesNotMatch(html(h(HqAccounts, { view })), /<p[^>]*>(?:(?!<\/p>).)*<p/, 'no <p> nested in a <p>');
});

test('the ticket count links to HQ Support only for a Super Admin, whose console it is', () => {
  const insights = { ...PAYLOAD.insights, open_tickets: { available: true, open: 3 } };
  const glance = { ...PAYLOAD, insights };
  const admin = html(h(AdminStudioOverview, { user: { role: 'admin', is_super_admin: 0 }, glance }));
  assert.ok(!admin.includes('href="/admin/hq-support"'), 'an ordinary admin is not sent to a Super-Admin-only console');
  assert.match(text(h(AdminStudioOverview, { user: { role: 'admin', is_super_admin: 0 }, glance })), /Open support tickets: 3/);
  const sa = html(h(AdminStudioOverview, { user: { role: 'admin', is_super_admin: 1 }, glance }));
  assert.ok(sa.includes('href="/admin/hq-support"'), 'a Super Admin opens HQ Support from the count');
  assert.doesNotMatch(html(h(HqInsights, { view: hqInsightsView(PAYLOAD.insights) })), /<p[^>]*>(?:(?!<\/p>).)*<p/, 'no <p> nested in a <p>');
});

test('the needs-a-decision strip: on HQ the Seats tile is Accounts, and Approvals names the worst lane', () => {
  const t = text(h(StudioNeedsDecisionView, { user: null, glance: PAYLOAD }));
  assert.match(t, /Accounts 12 accounts · 7 founder/);
  assert.doesNotMatch(t, /Seats/);
  assert.match(t, /Approvals Unreadable 1 lane could not be read, so no total · worst: KYC/);
  const order = orderNeedsDecision([{ key: 'accounts', glance: hqAccountsView(PAYLOAD.accounts) }, { key: 'approvals', glance: hqApprovalsView(PAYLOAD.approvals) }]);
  assert.equal(order[0].key, 'approvals', 'an unreadable lane ranks the Approvals tile first');
});

test('a held lane\'s State: pending and oldest, 0 pending, Unreadable, No queue, Reading', () => {
  const ready = { status: 'ready', hq: glancesFromStudioGlance(PAYLOAD, null).hq };
  assert.match(text(h(LaneState, { glance: ready, laneKey: 'kyc' })), /^ ?4 pending · oldest 4 days ?$/);
  assert.match(text(h(LaneState, { glance: ready, laneKey: 'events' })), /0 pending/);
  assert.match(text(h(LaneState, { glance: ready, laneKey: 'lp' })), /could not be read/);
  const noQ = html(h(LaneState, { glance: ready, noQueue: 'Circles' }));
  assert.match(noQ, /No queue/);
  assert.match(noQ, /nobody submits one for review/);
  assert.match(text(h(LaneState, { glance: ready, laneKey: 'best_fit' })), /Not recorded/, 'a lane the glance did not carry');
  assert.match(text(h(LaneState, { glance: { status: 'loading', hq: null }, laneKey: 'kyc' })), /Reading/);
  assert.match(text(h(LaneState, { glance: { status: 'unreadable', hq: null }, laneKey: 'kyc' })), /not a claim that the count is zero/);
  assert.equal(laneOf(ready.hq, 'jobs').count, 1);
});

test('a held card\'s figure: a number (0 included), Unreadable, Not recorded, Reading', () => {
  const ready = { status: 'ready' };
  assert.match(text(h(Figure, { state: ready, value: 0, unit: 'projects in Trash' })), /0 projects in Trash/);
  assert.match(text(h(Figure, { state: ready, value: null, reason: 'The project table could not be read.' })), /could not be read/);
  const nr = text(h(Figure, { state: ready, value: undefined, reason: 'no queue' }));
  assert.match(nr, /Not recorded/);
  assert.doesNotMatch(nr, /\b0\b/);
  assert.match(text(h(Figure, { state: { status: 'loading' }, value: 3 })), /Reading/);
  assert.match(text(h(Figure, { state: { status: 'unreadable' }, value: 3 })), /not a claim that the count is zero/);
});

test('the held pages read the glance and no longer say "none counted here"', () => {
  // D893 (#2366): Insights is rebuilt at pages/admin/insights/ and reads the glance through its own model.
  assert.match(read('frontend/src/pages/admin/insights/AdminInsights.jsx'), /api\.adminStudioGlance\(\)/);
  for (const f of ['HeldApprovals', 'HeldAccounts', 'HeldCommunity', 'HeldPrograms']) {
    const src = read(`frontend/src/pages/admin/${f}.jsx`);
    assert.match(src, /useHeldGlance\(\)/, `${f} does not read the glance`);
    assert.doesNotMatch(src, /none counted here/, `${f} still says none counted here`);
  }
  assert.doesNotMatch(read('frontend/src/pages/admin/HeldApprovals.jsx'), /Links to its console/);
  const acc = read('frontend/src/pages/admin/HeldAccounts.jsx');
  for (const id of ['held-accounts-users-count', 'held-accounts-exploring-count', 'held-accounts-trash-count']) assert.ok(acc.includes(id), id);
  assert.ok(read('frontend/src/pages/admin/HeldCommunity.jsx').includes("laneOf(glance.hq, key)"));
  assert.ok(read('frontend/src/pages/admin/HeldPrograms.jsx').includes("laneOf(glance.hq, 'cohort')"));
});
