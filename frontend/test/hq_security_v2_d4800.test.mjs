/**
 * D4800 (#4800, D4803) — Security v2, part 1: the seven-workspace shell with
 * `?tab=` deep links, the shared state vocabulary, and the Overview.
 *
 * Three kinds of check, each reading what a person would see:
 *   - the pure pieces (tab registry, vocabulary, Overview model) with
 *     payloads shaped like `admin_security.ts`'s replies;
 *   - server renders of the page at each `?tab=` (`SecurityConsole` with a
 *     payload, so every workspace draws its real zones);
 *   - one mounted journey in the repo's synthetic document
 *     (`_contracts_dom.mjs`), where the arrow keys move between workspaces
 *     and the URL follows.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import HqSecurityPage, { SecurityConsole } from '../src/pages/hq/SecurityPage.jsx';
import { SECURITY_TABS, tabFromSearch, tabAfterKey, tabHref } from '../src/pages/hq/security/securityTabs.js';
import { SECURITY_STATES, SECURITY_STATE_KEYS, securityState, readFigure, severityOf } from '../src/pages/hq/security/securityStates.js';
import StatusBadge, { ReadValue } from '../src/pages/hq/security/StatusBadge.jsx';
import { buildOverview } from '../src/pages/hq/security/overviewModel.js';
import OverviewWorkspace from '../src/pages/hq/security/OverviewWorkspace.jsx';

const h = React.createElement;
const AT = '2026-11-07T14:30:00.000Z';

// ───────────────────────────────────────────────────────────── fixtures ──

const OVERVIEW = () => ({
  audit: { total: 41, feed: '/api/admin/security/governance' },
  impersonations: { available: true, active: 0, recent: [] },
  sessions: { available: true, active: 2, token_hours: 24 },
  mfa: { admins_total: 2, admins_with_mfa: 0 },
  kyc: { pending: 1, approved: 3, rejected: 0 },
  kyc_not_recorded: [],
  dsr: {
    clock: { rule: 'calendar_month', label: 'One calendar month from receipt, to the end of that UTC day' },
    kinds: [{ kind: 'erasure', recorded: true }, { kind: 'access', recorded: false, reason: 'Only deletion requests are recorded.' }],
    rows: [{ id: 31, email: 'lumen@example.com', name: 'Lumen Founder', role: 'founder', kind: 'erasure', requested_at: '2026-10-20 09:00:00', days_left: 22, prior_requests: 0, last_outcome: null, last_outcome_at: null }],
    by_branch: [{ branch: 'HQ-held', open: 1 }],
    branches: { bound: 0, reason: 'No branch RPC returns a branch\'s erasure requests.' },
    ledger_available: true,
  },
  security_events: { available: true, today: 4, failed_signins_24h: 0, retention_days: 400, not_counted: [] },
  ai_safety: {
    window_days: 7,
    verdicts: { available: true, evaluated: 2, safe_count: 2, unsafe_count: 0, no_verdict_count: 0, safe_rate: 1 },
    enforcement: { available: true, blocked: 0, flagged: 0, rules: [], states: [], unclassified: 0 },
    guard: { available: false, reason: 'Router enforcement is not recorded here.' },
    token_anomalies: { available: true, count: 0, rows: [], accounts_checked: 9, window_hours: 24, baseline_days: 7, no_baseline: 0, how: 'Against each account\'s own average.' },
    not_counted: [],
  },
  sanctions: { available: true, runs_total: 3, last_run_at: '2026-10-30T10:00:00Z', hits_total: 0, unreviewed_hits: 0, how: 'Runs on request.', path: '/trust' },
  backup_dr: {
    backup: { available: true, kind: 'd1', at: '2026-11-07T02:00:00Z', source: 'gha', key: 'd1/x.sql', size_bytes: 4096 },
    drill: { available: true, state: 'last_run_failed', at: '2026-11-01T03:10:00Z', step: 'restore', exit_code: 1, backup_key: 'd1/x.sql', duration_s: 40 },
    not_recorded: [],
  },
});

const SOURCES = () => ['security_events', 'admin_audit_log', 'activity_logs', 'impersonation_sessions', 'licence_events']
  .map((table) => ({ table, available: true, rows: 3 }));

const FEED = (sources = SOURCES()) => ({
  filter: 'all',
  filters: [
    { key: 'all', label: 'All actions' }, { key: 'impersonations', label: 'Impersonations' },
    { key: 'licence_changes', label: 'Licence changes' }, { key: 'suspensions', label: 'Suspensions' },
    { key: 'exports', label: 'Exports' }, { key: 'auth', label: 'Sign-ins and step-ups' },
  ],
  rows: [{ key: 'se:1', at: '2026-11-07 14:12:00', actor: 'Guillaume L.', action: 'gate.totp', tenant: 'HQ', target: null, source: 'security_events', tone: 'alert', outcome: 'refused' }],
  limit: 60,
  more: false,
  sources,
  tenant_available: false,
  tenant_reason: 'Two stores can fill this column.',
  data_access: {
    expiry_minutes: 30,
    impersonations: { available: true, items: [] },
    exports: { available: true, items: [] },
  },
  tenant_view_available: true,
  tenant_view_reason: 'HQ can read one branch at a time.',
});

const SESSIONS = () => ({
  token_hours: 24, total: 2, expiry_minutes: 30,
  rows: [
    { id: 11, user_id: 1, name: 'Sam Super', role: 'admin', user_agent: 'Chrome', ip: '203.0.113.1', created_at: '2026-11-07 08:00:00', last_seen_at: '2026-11-07 14:00:00', is_current: true },
    { id: 12, user_id: 2, name: 'Mo Okafor', role: 'admin', user_agent: 'Firefox', ip: '203.0.113.7', created_at: '2026-11-07 07:00:00', last_seen_at: '2026-11-07 13:58:00', is_current: false },
  ],
  impersonations: { available: true, rows: [] },
});

const ready = (value) => ({ state: 'ready', value, at: AT });
const model = (ov = OVERVIEW(), fd = FEED()) => buildOverview({
  overview: ov === 'unreadable' ? { state: 'unreadable' } : ov === 'loading' ? { state: 'loading' } : ready(ov),
  feed: fd === 'unreadable' ? { state: 'unreadable' } : fd === 'loading' ? { state: 'loading' } : ready(fd),
});

const consoleHtml = (tab, props = {}) => renderToStaticMarkup(
  h(MemoryRouter, { initialEntries: [`/admin/security${tabHref(tab)}`] },
    h(SecurityConsole, {
      tab, onTab: () => {}, data: OVERVIEW(), load: () => {}, feed: FEED(), filter: 'all', setFilter: () => {},
      loadFeed: () => {}, sessionList: SESSIONS(), loadSessions: () => {}, onSessionAct: async () => ({}),
      readAt: { overview: AT, feed: AT }, ...props,
    })),
);
const pageHtml = (search) => renderToStaticMarkup(
  h(MemoryRouter, { initialEntries: [`/admin/security${search}`] }, h(HqSecurityPage)),
);
const between = (html, from, to) => {
  const a = html.indexOf(from);
  assert.ok(a >= 0, `missing ${from}`);
  const b = to ? html.indexOf(to, a) : html.length;
  return html.slice(a, b < 0 ? html.length : b);
};

// ───────────────────────────────────────────────────── the tab registry ──

test('seven workspaces, in the canvas order, and every ?tab= value resolves', () => {
  assert.deepEqual(SECURITY_TABS.map((t) => t.label), ['Overview', 'Events', 'Access', 'Privacy', 'Trust', 'AI Safety', 'Resilience']);
  for (const t of SECURITY_TABS) assert.equal(tabFromSearch(t.key), t.key, `?tab=${t.key} does not open ${t.label}`);
  for (const bad of ['bogus', '', null, undefined, 'sessions', '../events']) {
    assert.equal(tabFromSearch(bad), 'overview', `an unknown tab ${JSON.stringify(bad)} did not fall back to Overview`);
  }
  assert.equal(tabHref('ai-safety'), '?tab=ai-safety');
});

test('the arrow keys wrap, Home and End go to the ends, and other keys are left alone', () => {
  assert.equal(tabAfterKey('overview', 'ArrowRight'), 'events');
  assert.equal(tabAfterKey('events', 'ArrowLeft'), 'overview');
  assert.equal(tabAfterKey('resilience', 'ArrowRight'), 'overview', 'Right does not wrap from the last workspace');
  assert.equal(tabAfterKey('overview', 'ArrowLeft'), 'resilience', 'Left does not wrap from the first workspace');
  assert.equal(tabAfterKey('privacy', 'Home'), 'overview');
  assert.equal(tabAfterKey('privacy', 'End'), 'resilience');
  assert.equal(tabAfterKey('privacy', 'Enter'), null);
  assert.equal(tabAfterKey('privacy', 'a'), null);
});

test('each ?tab= deep link opens its own workspace, and an unknown one opens Overview', () => {
  for (const t of SECURITY_TABS) {
    const html = pageHtml(`?tab=${t.key}`);
    assert.match(html, new RegExp(`data-testid="security-ws-${t.key}"`), `?tab=${t.key} rendered another workspace`);
    const current = [...html.matchAll(/aria-current="page"[^>]*data-testid="security-tab-([\w-]+)"/g)].map((m) => m[1]);
    assert.deepEqual(current, [t.key], `the nav marks ${current} as current under ?tab=${t.key}`);
    // The phone section select names the same workspace.
    assert.match(between(html, 'data-testid="security-section-select"', '</select>'), new RegExp(`<option value="${t.key}" selected="">`));
  }
  for (const search of ['?tab=nope', '', '?tab=']) {
    assert.match(pageHtml(search), /data-testid="security-ws-overview"/, `${search || 'no query'} did not open Overview`);
  }
  // A link per workspace, each a ?tab= route.
  const nav = between(pageHtml(''), 'aria-label="Security workspaces"', '</nav>');
  for (const t of SECURITY_TABS) assert.ok(nav.includes(`href="/admin/security?tab=${t.key}"`), `no link to ${t.key}`);
});

// ─────────────────────────────────── every existing function, still reachable ──

test('every zone the page drew before is still drawn, under its workspace', () => {
  const where = {
    // D4803 — retention and the branch-view note moved behind "How this is measured" (SE03's explanation layer).
    events: ['data-testid="hq-gov-filters"', 'data-testid="hq-gov-feed"', 'data-testid="hq-gov-sources"', 'data-testid="events-how-toggle"', 'data-testid="events-older"'],
    access: ['data-testid="hq-sessions"', 'data-testid="hq-sessions-revoke-selected"', 'data-testid="hq-force-reauth"', 'data-testid="hq-data-access"', '>Admins with MFA<', '>Failed sign-ins<'],
    // D4803 slice 3 — the close moved from the zone's inline buttons into SE06's Record outcome dialog.
    privacy: ['data-testid="hq-dsr"', 'data-testid="dsr-table"', 'data-testid="hq-dsr-groups"', 'data-testid="hq-dsr-branches"', 'data-testid="hq-dsr-kinds-not-recorded"'],
    trust: ['data-testid="hq-sanctions"', '>KYC pending<', '>KYC rejected<'],
    'ai-safety': ['data-testid="hq-ai-safety"', 'data-testid="hq-verdict-breakdown"', 'data-testid="hq-token-anomalies"'],
    resilience: ['data-testid="hq-backup-dr"', 'data-testid="hq-backup-heartbeat"', 'data-testid="hq-restore-drill"'],
  };
  const all = Object.values(where).flat();
  for (const [tab, marks] of Object.entries(where)) {
    const html = consoleHtml(tab);
    for (const m of marks) assert.ok(html.includes(m), `${m} is not reachable under ${tab}`);
    // And each zone lives under ONE workspace, not leaked into every tab.
    for (const m of all.filter((x) => !marks.includes(x) && x.startsWith('data-testid'))) {
      assert.ok(!html.includes(m), `${m} leaked into ${tab}`);
    }
  }
  // The shell keeps the bar, the header links, the rail and Ask on every workspace.
  for (const t of SECURITY_TABS) {
    const html = consoleHtml(t.key);
    for (const m of ['data-testid="hq-security-events-bar"', 'href="/admin/security/obligations"', 'data-testid="security-trust-content-link"', 'data-testid="hq-security-rail"']) {
      assert.ok(html.includes(m), `${m} is missing on ${t.key}`);
    }
  }
  // The Events filters still drive the feed.
  const filters = [...between(consoleHtml('events'), 'data-testid="hq-gov-filters"', '</div>').matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]);
  assert.deepEqual(filters, ['All actions', 'Impersonations', 'Licence changes', 'Suspensions', 'Exports', 'Sign-ins and step-ups']);
});

// ───────────────────────────────────────────────────── the state vocabulary ──

test('thirteen states, each with its own word, shape and description', () => {
  assert.deepEqual(SECURITY_STATE_KEYS, [
    'verified', 'healthy', 'action_required', 'failed', 'pending', 'stale', 'unknown', 'unavailable',
    'not_instrumented', 'unsupported', 'not_applicable', 'measured_zero', 'no_data_yet',
  ]);
  const words = SECURITY_STATE_KEYS.map((k) => SECURITY_STATES[k].word);
  assert.deepEqual(words, ['Verified', 'Healthy', 'Action required', 'Failed', 'Pending', 'Stale', 'Unknown', 'Unavailable',
    'Not instrumented', 'Unsupported', 'Not applicable', 'Measured zero', 'No data yet']);
  assert.ok(!words.includes('Not recorded'), '"Not recorded" is retired');
  for (const k of SECURITY_STATE_KEYS) {
    const html = renderToStaticMarkup(h(StatusBadge, { state: k }));
    const s = securityState(k);
    assert.ok(renderedText(html).includes(s.word), `${k} does not draw its word`);
    assert.match(html, new RegExp(`data-shape="${s.shape}"`), `${k} does not draw its shape`);
    assert.match(html, /<svg aria-hidden="true"/, `${k}'s shape is not hidden from assistive technology`);
    assert.ok(html.includes(`class="sr-only"`) && renderedText(html).includes(s.description), `${k}'s description is not read out`);
    assert.match(html, new RegExp(`data-state="${k}"`));
  }
  // Only states that look alike in greyscale may share a shape: the canvas pairs Verified with Healthy.
  const shapes = SECURITY_STATE_KEYS.map((k) => SECURITY_STATES[k].shape);
  assert.equal(new Set(shapes).size, 12, 'two states lost their distinct shapes');
  assert.throws(() => securityState('green'), /Unknown security state/, 'an unknown state fell back to a real one');
  // A label replaces the word on screen and keeps it for a screen reader.
  const labelled = renderedText(renderToStaticMarkup(h(StatusBadge, { state: 'measured_zero', label: '0 live impersonations' })));
  assert.match(labelled, /0 live impersonations/);
  assert.match(labelled, /Measured zero: Read successfully; the count is 0\./);
  assert.ok(severityOf('failed') < severityOf('action_required') && severityOf('action_required') < severityOf('unavailable'));
});

test('an unreadable value is never 0, and offers Retry', () => {
  for (const v of [null, undefined, '', 'n/a', NaN]) {
    assert.deepEqual(readFigure(v), { state: 'unavailable', text: null }, `${String(v)} became a figure`);
  }
  assert.deepEqual(readFigure(5, { readable: false }), { state: 'unavailable', text: null }, 'a failed read kept its stale figure');
  assert.deepEqual(readFigure(0), { state: 'measured_zero', text: '0' });
  assert.deepEqual(readFigure(1200), { state: null, text: (1200).toLocaleString() });

  const retried = [];
  const unread = renderToStaticMarkup(h(ReadValue, { value: null, what: 'Active sessions', onRetry: () => retried.push(1) }));
  const t = renderedText(unread);
  assert.doesNotMatch(t, /\b0\b/, 'an unreadable value rendered as 0');
  assert.match(t, /Unavailable/);
  assert.match(t, /Active sessions could not be read/);
  assert.match(unread, /<button type="button"[^>]*>Retry<\/button>/, 'an unreadable value offers no Retry');
  assert.equal(renderedText(renderToStaticMarkup(h(ReadValue, { value: 0 }))), '0', 'a measured zero is not drawn');
});

// ───────────────────────────────────────────────────────────── Overview ──

test('Action required comes first: the failed drill, then admin MFA, then the passive rows', () => {
  const html = consoleHtml('overview');
  const order = ['data-testid="security-action-required"', 'data-testid="security-checked-clear"', 'data-testid="security-areas"', 'data-testid="security-overview-sources"']
    .map((m) => html.indexOf(m));
  assert.ok(order.every((n) => n > 0), 'a part of the Overview is missing');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'Action required is not above the passive metrics');
  const ar = between(html, 'data-testid="security-action-required"', 'data-testid="security-checked-clear"');
  const drillAt = ar.indexOf('security-finding-drill-failed');
  const mfaAt = ar.indexOf('security-finding-mfa-gap');
  assert.ok(drillAt > 0 && mfaAt > drillAt, 'the failed drill does not lead, ahead of MFA');
  // Nothing from the old long page sits above the findings.
  const head = html.slice(0, html.indexOf('data-testid="security-action-required"'));
  for (const m of ['hq-gov-feed', 'hq-sessions', 'hq-sanctions', 'hq-ai-safety', 'Was Governance, which described']) {
    assert.ok(!head.includes(m), `${m} sits above Action required`);
  }
});

test('the failed drill names its step, exit code and date, and points at the drill evidence', () => {
  const m = model();
  const f = m.findings.find((x) => x.id === 'drill-failed');
  assert.ok(f, 'a failed restore drill is not a finding');
  assert.equal(f.state, 'failed');
  assert.equal(f.title, 'Restore drill failed');
  assert.match(f.detail, /stopped at the restore step \(exit code 1\)/);
  assert.match(f.detail, /A backup exists but is not verified restorable until a drill passes\./);
  assert.equal(f.when, '2026-11-01 03:10 UTC · 6 days ago');
  assert.deepEqual(f.action, { label: 'Open drill evidence', tab: 'resilience' });
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(OverviewWorkspace, { model: m, onRetry: {} })));
  const row = between(html, 'data-testid="security-finding-drill-failed"', '</li>');
  assert.match(row, /href="\/\?tab=resilience"/, 'the drill finding does not open Resilience');
  assert.match(renderedText(row), /Failed/);

  // Never run is an action too; a pass is not a finding; an unreadable marker is a check that could not run.
  const never = OVERVIEW(); never.backup_dr.drill = { available: true, state: 'never_run', reason: 'No drill-d1.json has been written.' };
  assert.equal(model(never).findings.find((x) => x.id === 'drill-never')?.state, 'action_required');
  const passed = OVERVIEW(); passed.backup_dr.drill = { available: true, state: 'last_run_passed', at: '2026-11-06T03:10:00Z', backup_key: 'd1/x.sql' };
  assert.ok(!model(passed).findings.some((x) => x.id.startsWith('drill')), 'a passing drill was raised as a finding');
  assert.equal(model(passed).areas.find((a) => a.id === 'recovery').state, 'verified');
  // A passing drill with no readable backup evidence is not Verified.
  passed.backup_dr.backup = { available: false, reason: 'No BACKUPS R2 binding on this Worker.' };
  assert.equal(model(passed).areas.find((a) => a.id === 'recovery').state, 'unavailable', 'a pass without backup evidence read Verified');
  const lost = OVERVIEW(); lost.backup_dr.drill = { available: false, state: 'unreadable', reason: 'The BACKUPS R2 binding is not bound.' };
  const u = model(lost).findings.find((x) => x.id === 'drill-unreadable');
  assert.equal(u?.state, 'unavailable');
  assert.match(u.detail, /This is not a pass\./);
  assert.equal(model(lost).areas.find((a) => a.id === 'recovery').state, 'unavailable');
});

test('admin MFA is "x of n" and links to the admins', () => {
  const f = model().findings.find((x) => x.id === 'mfa-gap');
  assert.ok(f, 'admins without MFA are not a finding');
  assert.equal(f.state, 'action_required');
  assert.match(f.detail, /^0 of 2 HQ administrators have a second factor\. 2 accounts can still sign in with a password alone\.$/);
  assert.deepEqual(f.action, { label: 'Review administrators', href: '/admin/hq-team' });
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(OverviewWorkspace, { model: model(), onRetry: {} })));
  assert.match(between(html, 'data-testid="security-finding-mfa-gap"', '</li>'), /href="\/admin\/hq-team"[^>]*>Review administrators</);

  const one = OVERVIEW(); one.mfa = { admins_total: 2, admins_with_mfa: 1 };
  assert.match(model(one).findings.find((x) => x.id === 'mfa-gap').detail, /1 of 2 .* 1 account can still/);
  const all = OVERVIEW(); all.mfa = { admins_total: 2, admins_with_mfa: 2 };
  assert.ok(!model(all).findings.some((x) => x.id === 'mfa-gap'), 'every admin enrolled still raised a finding');
  assert.equal(model(all).clear.find((c) => c.id === 'mfa')?.label, '2 of 2 admins with MFA');
  const none = OVERVIEW(); none.mfa = { admins_total: 0, admins_with_mfa: 0 };
  assert.equal(model(none).areas.find((a) => a.id === 'auth').state, 'not_applicable');
  const blank = OVERVIEW(); blank.mfa = {};
  assert.equal(model(blank).findings.find((x) => x.id === 'mfa-unreadable')?.state, 'unavailable', 'missing MFA figures read as enrolled');
});

test('"Checked and clear" lists measured zeros with what was read, and only checks that ran', () => {
  const m = model();
  assert.deepEqual(m.clear.map((c) => c.id), ['dsr', 'sanctions', 'impersonations', 'refusals', 'anomalies', 'sources']);
  for (const c of m.clear) assert.match(c.evidence, /Read 14:30 UTC/, `${c.id} does not say when it was read`);
  assert.equal(m.clear.find((c) => c.id === 'impersonations').state, 'measured_zero');
  assert.equal(m.clear.find((c) => c.id === 'sources').label, '5 of 5 sources read');
  // An unreadable store is never in the clear row.
  const bad = OVERVIEW();
  bad.impersonations = { available: false, reason: 'The impersonation_sessions table could not be read on this database.' };
  bad.sanctions = { available: false, reason: 'sanctions_screenings could not be read.' };
  const mb = model(bad);
  assert.ok(!mb.clear.some((c) => c.id === 'impersonations' || c.id === 'sanctions'), 'an unreadable store was listed as clear');
  assert.ok(mb.findings.some((f) => f.id === 'impersonations-unreadable') && mb.findings.some((f) => f.id === 'sanctions-unreadable'));
  // A readable store with no figure is not a zero either; a live session is not clear.
  for (const active of [null, undefined, 1]) {
    const o = OVERVIEW(); o.impersonations = { available: true, active, recent: [] };
    assert.ok(!model(o).clear.some((c) => c.id === 'impersonations'), `active=${active} was listed as 0 live impersonations`);
  }
  const se = OVERVIEW(); se.security_events = { available: true, today: 1, failed_signins_24h: null };
  assert.ok(!model(se).clear.some((c) => c.id === 'refusals'), 'a missing refusal count was listed as 0');
  const sc = OVERVIEW(); sc.sessions = { available: true, active: null, token_hours: 24 };
  assert.equal(model(sc).areas.find((a) => a.id === 'sessions').state, 'unavailable', 'a missing session count read as 0 active sessions');
});

test('status by area: eight cells, UTC timestamps, and no score', (t) => {
  const zone = process.env.TZ;
  process.env.TZ = 'Europe/Zurich';
  t.after(() => { if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone; });
  const areas = model().areas;
  assert.deepEqual(areas.map((a) => a.title), ['Authentication', 'Sessions & access', 'Privacy & DSR', 'Trust & sanctions', 'AI safety', 'Backup & recovery', 'Security events', 'Subprocessor notices']);
  const by = Object.fromEntries(areas.map((a) => [a.id, a]));
  assert.equal(by.auth.state, 'action_required');
  assert.equal(by.auth.fact, '0 of 2 admins have MFA');
  assert.equal(by.recovery.state, 'failed');
  assert.equal(by.trust.state, 'measured_zero');
  assert.equal(by.ai.fact, '2 of 2 evaluated outputs judged safe · small sample');
  assert.equal(by.events.fact, '5 of 5 sources · newest 14:12 UTC');
  // D4803 browser pass: delivery is recorded per notice (Trust draws it), so this is never Not instrumented;
  // the Overview does not read it, so it cannot say which way it stands.
  assert.equal(by.subprocessors.state, 'unknown');
  assert.match(by.subprocessors.fact, /Recorded per notice/);
  const html = consoleHtml('overview');
  const cell = renderedText(between(html, 'data-testid="security-area-auth"', '</a>'));
  assert.match(cell, /0 of 2 admins have MFA/, 'an area cell does not draw its fact');
  assert.match(cell, /Read 14:30 UTC/, 'an area cell does not draw its freshness');
  assert.doesNotMatch(renderedText(html), /security score|score of|\d+ ?\/ ?100\b|\d+%/i, 'a score was drawn');
  assert.match(renderedText(html), /No overall score: each area reports its own evidence\./);
});

test('a partial source failure never renders as clear', () => {
  // One ledger store down.
  const src = SOURCES(); src[4] = { table: 'licence_events', available: false, reason: 'The licence event log could not be read.' };
  const m = model(OVERVIEW(), FEED(src));
  const f = m.findings.find((x) => x.id === 'source-licence_events');
  assert.equal(f?.state, 'unavailable', 'a failed source is not raised');
  assert.deepEqual(f.action, { label: 'Retry', retry: 'feed' });
  assert.equal(m.incomplete, true);
  assert.ok(!m.clear.some((c) => c.id === 'sources'), 'a partial read was listed as clear');
  assert.equal(m.areas.find((a) => a.id === 'events').state, 'unavailable', 'Security events read Healthy on 4 of 5');
  assert.equal(m.sources.read, 4);
  // Severity order: the failed drill still leads, the check that could not run comes last,
  // and a check that could not run does not mark a tab as needing action.
  assert.deepEqual(m.findings.map((x) => x.state), ['failed', 'action_required', 'unavailable']);
  assert.equal(m.marks.events, undefined, 'an unreadable source marked Events as needing action');

  const html = renderToStaticMarkup(h(MemoryRouter, null, h(OverviewWorkspace, { model: m, onRetry: { feed: () => {}, overview: () => {} } })));
  const ar = renderedText(between(html, 'data-testid="security-action-required"', 'data-testid="security-checked-clear"'));
  assert.match(ar, /A check could not run, so this list may be incomplete/);
  assert.match(ar, /Licence events could not be read/);
  assert.doesNotMatch(ar, /Nothing needs action/, 'a partial read said nothing is open');
  assert.match(between(html, 'data-testid="security-overview-sources"'), /4 of 5 sources read/);
  assert.match(between(html, 'data-testid="security-overview-sources"', '4 of 5 sources read'), /data-state="unavailable"[^]*$/, 'a partial read drew the Healthy badge');
  assert.doesNotMatch(between(html, 'data-testid="security-overview-sources"', '4 of 5 sources read'), /data-state="healthy"/, 'a partial read drew the Healthy badge');
  assert.match(renderedText(between(html, 'data-testid="security-overview-sources-partial"', '</p>')), /Licence events could not be read; rows from it may be missing\./);

  // The whole overview unreadable: no area is Healthy, and no zero is drawn as clear.
  const down = model('unreadable', FEED());
  assert.ok(down.findings.some((x) => x.id === 'overview-unreadable'));
  assert.ok(down.areas.slice(0, 6).every((a) => a.state === 'unavailable'), 'an area kept a state under a failed overview read');
  assert.deepEqual(down.clear.map((c) => c.id), ['sources'], 'a check that never ran was listed as clear');
  // The ledger unreadable.
  const nofeed = model(OVERVIEW(), 'unreadable');
  assert.ok(nofeed.findings.some((x) => x.id === 'feed-unreadable'));
  assert.equal(nofeed.areas.find((a) => a.id === 'events').state, 'unavailable');
  // Still loading: no claim either way.
  const wait = renderedText(renderToStaticMarkup(h(MemoryRouter, null, h(OverviewWorkspace, { model: model('loading', 'loading'), onRetry: {} }))));
  assert.doesNotMatch(wait, /Nothing needs action/);
  assert.match(wait, /Still reading — nothing is claimed yet/);
});

test('with every check run and nothing open, the Overview says so, and only then', () => {
  const quiet = OVERVIEW();
  quiet.mfa = { admins_total: 2, admins_with_mfa: 2 };
  quiet.backup_dr.drill = { available: true, state: 'last_run_passed', at: '2026-11-06T03:10:00Z', backup_key: 'd1/x.sql' };
  const m = model(quiet);
  assert.deepEqual(m.findings, []);
  const t = renderedText(renderToStaticMarkup(h(MemoryRouter, null, h(OverviewWorkspace, { model: m, onRetry: {} }))));
  assert.match(t, /Nothing needs action\. Every check ran/);
  assert.match(t, /Every check ran/);
});

test('the tab marks carry the worst finding per workspace, read out as words', () => {
  const m = model();
  assert.deepEqual(m.marks, { resilience: { state: 'failed', count: 1 }, access: { state: 'action_required', count: 1 } });
  const html = consoleHtml('overview');
  const mark = between(html, 'data-testid="security-tab-mark-resilience"', '</a>');
  assert.match(mark, /data-state="failed"/);
  assert.match(renderedText(mark), /1 item needs action/);
});

// ──────────────────────────────────────────── a mounted keyboard journey ──

test('mounted: the arrow keys move between workspaces, the URL follows, and focus moves with them', async () => {
  const restore = installDocument('', { focus: true });
  const saved = { o: api.hqSecurityOverview, g: api.hqGovernance, s: api.hqSecuritySessions, fetch: globalThis.fetch };
  api.hqSecurityOverview = async () => OVERVIEW();
  api.hqGovernance = async () => FEED();
  api.hqSecuritySessions = async () => SESSIONS();
  globalThis.fetch = async () => { throw new Error('no network in tests'); };
  let where = null;
  const Spy = () => { where = useLocation(); return null; };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(h(MemoryRouter, { initialEntries: ['/admin/security?tab=overview'] }, h(HqSecurityPage), h(Spy)));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
    const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
    const tabNode = (key) => nodes().find((n) => props(n)?.['data-testid'] === `security-tab-${key}`);
    const ws = () => nodes().map((n) => props(n)?.['data-testid']).find((id) => /^security-ws-/.test(id || ''));

    assert.equal(ws(), 'security-ws-overview');
    await act(async () => { props(tabNode('overview')).onKeyDown({ key: 'ArrowRight', preventDefault() {} }); });
    assert.equal(where.search, '?tab=events', 'ArrowRight did not move to Events');
    assert.equal(ws(), 'security-ws-events');
    assert.equal(document.activeElement, tabNode('events'), 'focus did not move with the arrow');
    await act(async () => { props(tabNode('events')).onKeyDown({ key: 'End', preventDefault() {} }); });
    assert.equal(where.search, '?tab=resilience');
    await act(async () => { props(tabNode('resilience')).onKeyDown({ key: 'ArrowRight', preventDefault() {} }); });
    assert.equal(where.search, '?tab=overview', 'ArrowRight did not wrap to Overview');
    await act(async () => { props(tabNode('overview')).onKeyDown({ key: 'ArrowLeft', preventDefault() {} }); });
    assert.equal(where.search, '?tab=resilience', 'ArrowLeft did not wrap to Resilience');
    // The phone section select drives the same URL.
    const select = nodes().find((n) => props(n)?.['data-testid'] === 'security-section-select');
    await act(async () => { props(select).onChange({ target: { value: 'privacy' } }); });
    assert.equal(where.search, '?tab=privacy');
    assert.equal(ws(), 'security-ws-privacy');
    // The reads answered once and were not repeated by moving between workspaces.
    const text = (n) => (n.nodeType === 3 || !n.childNodes?.length ? n.textContent || '' : n.childNodes.map(text).join(''));
    assert.match(text(container), /Lumen Founder/, 'the Privacy workspace did not draw the read it already had');
    // D4803 browser pass: a key moves from the link that has focus, even when the page has
    // not re-rendered since the last move (the router's transition). This handler was drawn
    // while Privacy was open; pressed on Resilience it must wrap to Overview, not go to Trust.
    const staleResilience = props(tabNode('resilience')).onKeyDown;
    await act(async () => { staleResilience({ key: 'ArrowRight', preventDefault() {} }); });
    assert.equal(where.search, '?tab=overview', 'a key moved from the open workspace rather than the focused link');
  } finally {
    await act(async () => root.unmount());
    api.hqSecurityOverview = saved.o; api.hqGovernance = saved.g; api.hqSecuritySessions = saved.s; globalThis.fetch = saved.fetch;
    restore();
  }
});
