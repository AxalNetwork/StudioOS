/**
 * D246 — Studio's two strips under the chat, and the sentinel all three share.
 *
 * THE DEFECT THIS FILE EXISTS FOR. AdminStudioHome and AdminStudioOverview
 * each declared `Symbol('unavailable')`; two calls are two symbols, so the
 * overview's failure branches could never be taken and an unreadable store
 * rendered the "not recorded" sentence meant for a store that does not exist.
 * No test had ever passed a failure in. These do.
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
import { StudioPostureView } from '../src/pages/admin/StudioPosture.jsx';
import { StudioNeedsDecisionView } from '../src/pages/admin/StudioNeedsDecision.jsx';
import {
  UNAVAILABLE,
  approvalsGlance,
  orderNeedsDecision,
  studioGlances,
} from '../src/pages/admin/adminStudioOverview.js';
import { AMBER_AT } from '../src/pages/branch/BranchAccounts.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const STUDIO_FILES = [
  'frontend/src/pages/admin/AdminStudioHome.jsx',
  'frontend/src/pages/admin/AdminStudioOverview.jsx',
  'frontend/src/pages/admin/adminStudioOverview.js',
  'frontend/src/pages/admin/StudioPosture.jsx',
  'frontend/src/pages/admin/StudioNeedsDecision.jsx',
];
const POSTURE = read('frontend/src/pages/admin/StudioPosture.jsx');
const DECIDE = read('frontend/src/pages/admin/StudioNeedsDecision.jsx');

const render = (el) => renderToStaticMarkup(createElement(MemoryRouter, null, el));
const USER = {
  role: 'admin',
  branch: { code: 'fr', name: 'Axal VC France', territories: ['FR', 'BE', 'LU'], status: 'active' },
};

// ---------------------------------------------------------------- sentinel

test('exactly one Symbol("unavailable") across the Studio files, and every file imports it', () => {
  // Count the CALL, not the phrase: the explanatory comment names it too.
  const decls = STUDIO_FILES.flatMap((f) => (read(f).match(/=\s*Symbol\(\s*['"]unavailable['"]\s*\)/g) || []).map(() => f));
  assert.deepEqual(decls, ['frontend/src/pages/admin/adminStudioOverview.js'],
    'a Studio file declares its own sentinel again, so its === checks can never match');
  for (const f of ['AdminStudioHome.jsx', 'StudioPosture.jsx']) {
    assert.match(read(`frontend/src/pages/admin/${f}`), /import\s*\{[^}]*\bUNAVAILABLE\b[^}]*\}\s*from\s*'\.\/adminStudioOverview'/,
      `${f} does not take the shared sentinel`);
  }
});

test('the overview renders Unreadable, not the not-recorded sentences, for every failed read', () => {
  const html = render(createElement(AdminStudioOverview, {
    user: USER, home: UNAVAILABLE, licence: UNAVAILABLE, templates: UNAVAILABLE, insights: UNAVAILABLE,
  }));
  for (const what of ['Seats', 'The queues', 'The programme clock', 'The template library', 'Agreements',
    'The share rate', 'The benchmark copy']) {
    assert.ok(html.includes(`${what} could not be read`), `${what}: the failure branch was not reached`);
  }
  for (const lie of [
    'Seat use is not recorded on this copy',
    'The share rate is not recorded on the licence copy.',
    'HQ has not published a median',
    'The template library did not include a list.',
    'The template library did not answer.',
  ]) {
    assert.ok(!html.includes(lie), `a failed read rendered as an absence: "${lie}"`);
  }
  assert.ok((html.match(/role="alert"/g) || []).length >= 7, 'each failure is an Unreadable');
});

// ---------------------------------------------------------------- S1b

const field = (id, section, label, state, value = null, extra = {}) => ({ id, section, label, state, value, ...extra });
const POSTURE_OK = {
  available: true,
  bank_size: 11,
  recorded: 3,
  fields: [
    field('admin.preferences.digest_freq', 'PREFS', 'Digest', 'not_recorded'),
    field('admin.preferences.alert_channel', 'PREFS', 'Alert channel', 'skipped'),
    field('admin.preferences.timezone', 'PREFS', 'Timezone', 'not_recorded'),
    field('admin.oversight.review_cadence', 'OVERSIGHT', 'Review cadence', 'recorded', 'Monthly'),
    field('admin.oversight.portfolio_focus', 'OVERSIGHT', 'Metrics named', 'recorded', null,
      { value_reason: 'The chat recorded a reply, but its store holds no value for it.' }),
    field('admin.oversight.risk_tolerance', 'OVERSIGHT', 'Risk tolerance', 'recorded', 'Balanced'),
    field('admin.oversight.escalation_threshold', 'OVERSIGHT', 'Escalation condition', 'not_recorded'),
    field('admin.operations.intake_priority', 'OPERATIONS', 'Intake priority', 'not_recorded'),
    field('admin.operations.onboarding_sla', 'OPERATIONS', 'Onboarding turnaround', 'not_recorded'),
    field('admin.governance.data_retention_pref', 'GOVERNANCE', 'Inactive record retention', 'not_recorded'),
    field('admin.governance.access_review_cadence', 'GOVERNANCE', 'Access-review cadence', 'not_recorded'),
  ],
};

test('the posture header is the server\'s count over the bank, not the values on screen', () => {
  const html = render(createElement(StudioPostureView, { posture: POSTURE_OK }));
  // Two values are on screen (Monthly, Balanced); three are recorded.
  assert.match(html, /3 of 11 admin-bank questions recorded/);
  const other = render(createElement(StudioPostureView, { posture: { ...POSTURE_OK, recorded: 5, bank_size: 12 } }));
  assert.match(other, /5 of 12 admin-bank questions recorded/, 'the header typed its numbers');
});

test('a recorded field shows its value, a skipped one says so, an unanswered one points at the chat', () => {
  const html = render(createElement(StudioPostureView, { posture: POSTURE_OK }));
  assert.match(html, /Monthly/);
  assert.match(html, /Balanced/, 'the risk-tolerance chip is missing');
  const skipped = html.slice(html.indexOf('Alert channel'));
  assert.match(skipped, /^Alert channel<\/dt><dd><span data-state="skipped"[^>]*>Skipped in the chat/);
  assert.equal((html.match(/data-state="not_recorded"/g) || []).length, 7);
  assert.equal((html.match(/data-state="skipped"/g) || []).length, 1);
  assert.match(html, /Not recorded/);
  assert.match(html, /href="#studio-chat"[^>]*>Continue in the chat ↑/);
  assert.match(html, /Answered, value not stored/);
  assert.match(html, /href="\/account"[^>]*>Settings →/);
  assert.doesNotMatch(html, /\d\s*%|<progress|role="progressbar"|<svg/, 'the posture grew a percentage, a bar or a chart');
});

test('a failed posture read is one Unreadable with a retry, not eleven Not recorded rows', () => {
  for (const posture of [UNAVAILABLE, { available: false, bank_size: 11, reason: 'The posture answers could not be read.' }]) {
    const html = render(createElement(StudioPostureView, { posture, onRetry: () => {} }));
    assert.equal((html.match(/role="alert"/g) || []).length, 1);
    assert.match(html, /Retry/);
    assert.doesNotMatch(html, /Not recorded|data-state=/);
  }
});

// ---------------------------------------------------------------- S1c

const lane = (label, count, age, sla) => ({ key: label, label, count, oldest_age_hours: age, sla });
const HOME = {
  queue_pressure: [lane('KYC', 1, 150, 'past'), lane('Cohort', 0, null, 'ok')],
  programme: { open_week: 2, zone: 'America/New_York', week_closes_at: '2026-09-23T04:00:00.000Z', hours_to_close: 70 },
  agreements: { window_days: 60, expiring: 0, undated: { sources: [], reason: 'r' } },
  revenue: { share_bps: 3500 },
};
const LICENCE = {
  licence: {
    seats: { founder: 50, investor: 10, advisor: 5, partner: 10 },
    seats_used_by_type: { founder: 45, investor: 1, advisor: 0, partner: 2 },
    revenue_share_bps: 3500,
    status: 'active',
  },
};
const TEMPLATES = { available: true, items: [{ slug: 'a' }, { slug: 'b' }], pushed_at: '2026-09-22T07:12:00Z' };

test('the order is computed: unreadable, past the window, due soon or AMBER_AT, then sidebar order', () => {
  const tight = { kind: 'ready', lines: { tiles: [{ type: 'founder', used: Math.ceil(50 * AMBER_AT), licensed: 50, state: 'tight', missing: false }], tightestType: 'founder' } };
  const quiet = { kind: 'ready', text: '2 HQ templates ready to instantiate' };
  const past = approvalsGlance([lane('KYC', 1, 150, 'past')]);
  const order = (tiles) => orderNeedsDecision(tiles).map((t) => t.key);

  assert.deepEqual(order([
    { key: 'seats', glance: tight },
    { key: 'approvals', glance: past },
    { key: 'programme', glance: { kind: 'ready', text: 'w', hoursToClose: 70 } },
    { key: 'contracts', glance: quiet },
  ]), ['approvals', 'seats', 'programme', 'contracts']);

  // An unreadable tile goes above a past-SLA one, even the last in sidebar order.
  assert.deepEqual(order([
    { key: 'seats', glance: tight },
    { key: 'approvals', glance: past },
    { key: 'programme', glance: { kind: 'ready', text: 'w', hoursToClose: 70 } },
    { key: 'contracts', glance: { kind: 'unreadable', reason: 'x' } },
  ]), ['contracts', 'approvals', 'seats', 'programme']);

  // All quiet: sidebar order.
  assert.deepEqual(order([
    { key: 'contracts', glance: quiet },
    { key: 'programme', glance: { kind: 'ready', text: 'w', hoursToClose: 70 } },
    { key: 'approvals', glance: approvalsGlance([lane('KYC', 0, null, 'ok')]) },
    { key: 'seats', glance: { kind: 'ready', lines: { tiles: [{ type: 'founder', used: 1, licensed: 50, state: 'ok', missing: false }], tightestType: null } } },
  ]), ['seats', 'approvals', 'programme', 'contracts']);

  // A deadline inside 24 hours ranks with the due-soon band, above a quiet seat.
  assert.deepEqual(order([
    { key: 'seats', glance: { kind: 'ready', lines: { tiles: [{ type: 'founder', used: 1, licensed: 50, state: 'ok', missing: false }], tightestType: null } } },
    { key: 'programme', glance: { kind: 'ready', text: 'w', hoursToClose: 12 } },
  ]), ['programme', 'seats']);
});

test('the rendered strip is in computed order, and each tile shows its card\'s own figure', () => {
  const props = { user: USER, home: HOME, licence: LICENCE, templates: TEMPLATES, insights: { benchmarks: [] } };
  const html = render(createElement(StudioNeedsDecisionView, props));
  const at = (k) => html.indexOf(`data-testid="studio-decide-${k}"`);
  assert.ok(at('approvals') < at('seats') && at('seats') < at('programme') && at('programme') < at('contracts'),
    'the strip did not render worst first');

  const g = studioGlances(props);
  const overview = render(createElement(AdminStudioOverview, props));
  // The approvals tile and the approvals card print the same sentence.
  assert.ok(html.includes(g.approvals.text) && overview.includes(g.approvals.text));
  assert.ok(html.includes(g.contracts.text) && overview.includes(g.contracts.text));
  // Seats: the tile's type and count are the card's tightest line.
  assert.match(html, /Founder 45 of 50/);
  assert.match(overview, /Founder<\/span> <span class="tabular-nums">45 of 50<\/span>/);
  // The share rate is a chip that links to Insights, and a rate — never an amount.
  assert.match(html, /href="\/branch\/insights"[^>]*>Share rate 35% · Insights →/);
  assert.doesNotMatch(html, /[€$£]/);
});

test('a suspended licence keeps every tile readable and says on each that writes are blocked', () => {
  const user = { ...USER, branch: { ...USER.branch, status: 'suspended' } };
  const licence = { licence: { ...LICENCE.licence, status: 'suspended', suspended_at: '2026-09-03T10:00:00Z' } };
  const html = render(createElement(StudioNeedsDecisionView, { user, home: HOME, licence, templates: TEMPLATES, insights: {} }));
  assert.equal((html.match(/Suspended — writes are blocked/g) || []).length, 4);
  assert.match(html, /Founder 45 of 50/, 'a frozen tile hid its figure');
  assert.match(html, /frozen since 3 Sep/, 'the date is not the licence\'s suspended_at');
  const undated = render(createElement(StudioNeedsDecisionView, {
    user, home: HOME, licence: { licence: { ...licence.licence, suspended_at: null } }, templates: TEMPLATES, insights: {},
  }));
  assert.doesNotMatch(undated, /frozen since/, 'a date was invented for a suspension that has none');
});

test('off a branch the strip says so once, not four empty tiles', () => {
  const html = render(createElement(StudioNeedsDecisionView, { user: { role: 'admin' }, home: null, licence: null, templates: null, insights: null }));
  assert.match(html, /studio-decide-off-branch/);
  assert.doesNotMatch(html, /studio-decide-(seats|approvals|programme|contracts)/);
});

test('neither strip is a form, a currency, a second assistant or a second read', () => {
  for (const [name, src] of [['StudioPosture', POSTURE], ['StudioNeedsDecision', DECIDE]]) {
    assert.ok(!/<input\b|<form\b/.test(src), `${name} grew a form`);
    assert.ok(!/[€$]\s?\d|\$\{?[0-9]/.test(src.replace(/\$\{[a-zA-Z]/g, '')), `${name} typed a currency`);
    assert.ok(!src.includes('WorkerRail'), `${name} mounts a second assistant`);
  }
  assert.doesNotMatch(DECIDE, /\bapi\./, 'the needs-a-decision strip makes a read of its own');
  assert.match(DECIDE, /studioGlances\(/, 'the strip stopped reading the overview\'s own figures');
  assert.doesNotMatch(DECIDE, /approvalsGlance|contractsGlance|programmeGlance|accountLines\(/,
    'the strip computes a figure with a helper of its own instead of the overview\'s');
  assert.doesNotMatch(read('frontend/src/pages/admin/AdminStudioOverview.jsx'), /adminPosture/,
    'the posture read moved into the overview, whose voice scan counts identifiers');
});
