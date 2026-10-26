/**
 * D937 (#2374) and D936 (#2375) — the Spin-Out Lab's admin page at
 * /admin/programs/spinout-lab, under the shared admin page header: the address
 * and its three old doors, the header and its tab counts, and the Overview
 * blocks whose reads exist, each drawn truthfully.
 *
 * Three layers:
 *   - the pure model (`labModel.js`) on fixtures worked out by hand;
 *   - the page mounted on a stubbed `fetch`, so every read goes through the
 *     real client to a URL, and each one can fail alone;
 *   - the source: the routes, the redirects, the rail and the reads the page
 *     must never make.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_lab_d937.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  LAB_PATH, LAB_PREVIEW_PATH, MOVED_NOTICES, NOT_YET,
  buildNeeds, buildTiles, cohortWord, movedTarget, pageFailed, poolOf, tabOf,
} from '../src/pages/admin/lab/labModel.js';
import AdminLab from '../src/pages/admin/lab/AdminLab.jsx';
import LabRedirect from '../src/pages/admin/lab/LabRedirect.jsx';
import LabPreviewRedirect from '../src/pages/admin/lab/LabPreviewRedirect.jsx';
import LabSettings from '../src/pages/admin/lab/LabSettings.jsx';
import AdminPageHeader, { HeaderTab } from '../src/ui/AdminPageHeader.jsx';
import { NO_RAIL_ROUTES } from '../src/lib/railPages.js';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { legacyContractsTarget } from '../src/pages/admin/LegacyContractsRedirect.jsx';
import { overviewFixture } from './_lab_overview_fixture.mjs';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const NOW = Date.parse('2026-10-24T12:00:00Z');
const ok = (data) => ({ status: 'ready', data });
const bad = { status: 'error', data: null };

// ---------------------------------------------------------------- fixtures
//
// Production's calendar on 2026-10-24: August and September finished, October
// running, November and December open. Times are D1's zone-less UTC stamps.

const win = (y, m, d) => [1, 2, 3, 4].map((w) => ({
  week_number: w,
  unlock_at: `${y}-${m}-${String(d + (w - 1) * 7).padStart(2, '0')} 04:00:00`,
  deadline_at: `${y}-${m}-${String(d + w * 7).padStart(2, '0')} 04:00:00`,
}));
const TIMELINE = { cycles: [
  { id: 263768, year: 2026, month: 12, status: 'scheduled', start_at: '2026-12-01 05:00:00', end_at: '2026-12-29 05:00:00', windows: [], participant_count: 0, status_counts: [] },
  { id: 127923, year: 2026, month: 11, status: 'scheduled', start_at: '2026-11-01 04:00:00', end_at: '2026-11-29 05:00:00', windows: [], participant_count: 0, status_counts: [] },
  { id: 5, year: 2026, month: 10, status: 'active', start_at: '2026-10-01 04:00:00', end_at: '2026-10-29 04:00:00', windows: win('2026', '10', 1), participant_count: 22, status_counts: [] },
  { id: 2, year: 2026, month: 9, status: 'completed', start_at: '2026-09-01 04:00:00', end_at: '2026-09-29 04:00:00', windows: win('2026', '09', 1), participant_count: 18, status_counts: [] },
], server_time: '2026-10-24T12:00:00.000Z' };
const APPLICATIONS = { settings: { min: 1, max: 25 }, settings_unreadable: false, cycles: [
  { id: 263768, year: 2026, month: 12, status: 'scheduled', app_status: 'open', start_at: '2026-12-01 05:00:00', applications_open_at: '2026-11-01 04:00:00', applications_close_at: '2026-11-25 04:59:59', applicant_counts: { pending: 1 }, applicants: [] },
  { id: 127923, year: 2026, month: 11, status: 'scheduled', app_status: 'open', start_at: '2026-11-01 04:00:00', applications_open_at: '2026-10-01 04:00:00', applications_close_at: '2026-10-26 03:59:59', applicant_counts: { approved: 9, pending: 7, waitlisted: 3, rejected: 5 }, applicants: [] },
  { id: 5, year: 2026, month: 10, status: 'active', app_status: 'active', start_at: '2026-10-01 04:00:00', applications_open_at: '2026-09-01 04:00:00', applications_close_at: '2026-09-25 03:59:59', applicant_counts: { activated: 22, rejected: 4 }, applicants: [] },
  { id: 2, year: 2026, month: 9, status: 'completed', app_status: 'active', start_at: '2026-09-01 04:00:00', applications_open_at: '2026-08-01 04:00:00', applications_close_at: '2026-08-26 03:59:59', applicant_counts: { activated: 18 }, applicants: [] },
] };
const GLANCE = { approvals: { lanes: [{ key: 'cohort', count: 7, oldest_age_hours: 80 }, { key: 'lp', count: 2 }] } };
const REVIEW = { at_risk: [{ user_id: 1 }, { user_id: 2 }], review: [{ status: 'grace' }, { status: 'failed' }] };
const HOSTS = { status: 'pending', items: [], counts: { pending: 2, approved: 9, declined: 1, withdrawn: 0, removed: 1 } };
const CERTS = { certificates: [{ status: 'issued' }, { status: 'issued' }, { status: 'issued' }, { status: 'revoked' }], awaiting: [{ user_id: 8 }, { user_id: 9 }], eligible_total: 6, unavailable: {} };
const ALL = { glance: ok(GLANCE), applications: ok(APPLICATIONS), timeline: ok(TIMELINE), review: ok(REVIEW), hosts: ok(HOSTS), certificates: ok(CERTS) };
const tile = (tiles, key) => tiles.find((t) => t.key === key);

// ---------------------------------------------------------------- the model

test('the four tiles read the glance lane, the next cohort against its places, the running cohort and the graduates', () => {
  const tiles = buildTiles(ALL, NOW);
  assert.deepEqual(tiles.map((t) => t.key), ['waiting', 'next', 'lab', 'graduated']);
  const w = tile(tiles, 'waiting');
  assert.equal(w.value, '7');
  assert.equal(w.sub, 'oldest 3 days · Nov 2026 closes 25 Oct 23:59 ET');
  assert.equal(w.overdue, true, '80 hours is past the shared 72-hour band');
  assert.equal(tile(tiles, 'next').value, 'Nov 2026');
  assert.equal(tile(tiles, 'next').sub, '9 approved of 25 places · minimum 1 met');
  assert.equal(tile(tiles, 'lab').value, '22');
  assert.equal(tile(tiles, 'lab').sub, 'in the Oct 2026 cohort · Week 4, day 24 of 28');
  assert.equal(tile(tiles, 'graduated').value, '6');
  assert.equal(tile(tiles, 'graduated').sub, '3 certificates issued');
});

test('a tile whose read failed says so, never a zero', () => {
  const tiles = buildTiles({ glance: bad, applications: bad, timeline: bad, certificates: bad }, NOW);
  for (const t of tiles) {
    assert.equal(t.state, 'unreadable', t.key);
    assert.equal(t.value, undefined, t.key);
    assert.ok(t.reason.length > 20, t.key);
  }
  // A failed cohort lane is a missing count, not 0.
  const lane = buildTiles({ ...ALL, glance: ok({ approvals: { lanes: [{ key: 'cohort', count: null }] } }) }, NOW);
  assert.equal(tile(lane, 'waiting').state, 'unreadable');
  // A graduate list that could not be read keeps the Worker's own reason.
  const certs = buildTiles({ ...ALL, certificates: ok({ ...CERTS, eligible_total: null, unavailable: { awaiting: 'The graduate list could not be read, so who is still waiting for a certificate is unknown.' } }) }, NOW);
  assert.match(tile(certs, 'graduated').reason, /who is still waiting/);
  // Loading is loading.
  assert.ok(buildTiles({}, NOW).every((t) => t.state === 'loading'));
});

test('no cohort is judged against a minimum that could not be read', () => {
  const t = tile(buildTiles({ ...ALL, applications: ok({ ...APPLICATIONS, settings: null }) }, NOW), 'next');
  assert.equal(t.sub, '9 approved. Minimum and places could not be read, so no cohort is judged against them.');
  const below = tile(buildTiles({ ...ALL, applications: ok({ ...APPLICATIONS, settings: { min: 12, max: 25 } }) }, NOW), 'next');
  assert.match(below.sub, /minimum 12 not met/);
});

test('the cohort words are the canvas\'s, read from the Worker\'s two columns', () => {
  assert.equal(cohortWord({ status: 'completed' }), 'Finished');
  assert.equal(cohortWord({ status: 'active', app_status: 'active' }), 'Running');
  assert.equal(cohortWord({ status: 'scheduled', app_status: 'open' }), 'Open for applications');
  assert.equal(cohortWord({ status: 'scheduled', app_status: 'reviewing' }), 'In review');
  assert.equal(cohortWord({ status: 'scheduled', app_status: 'postponed', year: 2026, month: 12 }), 'Moved to Jan 2027');
  assert.equal(cohortWord({ status: 'scheduled', app_status: 'something-new' }), 'Not recorded');
  assert.deepEqual(poolOf(APPLICATIONS.cycles[1]), { applied: 24, approved: 9, waitlisted: 3, waiting: 7, declined: 5 });
});

test('Needs you lists each readable queue holding something, and names each queue it could not read', () => {
  const n = buildNeeds(ALL);
  assert.deepEqual(n.rows.map((r) => [r.key, r.text, r.tab]), [
    ['applications', '7 applications waiting.', '/applications'],
    ['at-risk', '2 founders at risk this week.', '/cohorts'],
    ['grace', '1 founder in grace.', '/cohorts'],
    ['hosts', '2 office-hours hosts waiting.', '/hosts'],
    ['certificates', '2 graduates have no certificate.', '/graduation'],
  ]);
  assert.deepEqual(n.unread, []);
  const failed = buildNeeds({ ...ALL, hosts: bad, review: bad });
  assert.deepEqual(failed.unread, ['Founders at risk and in grace', 'Office-hours hosts']);
  assert.equal(failed.rows.length, 2);
  assert.equal(buildNeeds({ ...ALL, hosts: { status: 'loading' } }).state, 'loading');
  const clear = buildNeeds({ glance: ok({ approvals: { lanes: [{ key: 'cohort', count: 0 }] } }), review: ok({ at_risk: [], review: [] }), hosts: ok({ counts: { pending: 0 } }), certificates: ok({ awaiting: [] }) });
  assert.deepEqual([clear.rows, clear.unread], [[], []]);
});

test('the page fails as a whole only when every read failed', () => {
  assert.equal(pageFailed(ALL), false);
  assert.equal(pageFailed({ ...ALL, glance: bad }), false);
  assert.equal(pageFailed({ glance: bad, applications: bad, timeline: bad, review: bad, hosts: bad, certificates: bad }), true);
});

test('each address opens its tab, and an old address keeps its query and hash', () => {
  assert.equal(tabOf(LAB_PATH), 'overview');
  assert.equal(tabOf(`${LAB_PATH}/`), 'overview');
  assert.equal(tabOf(`${LAB_PATH}/graduation`), 'graduation');
  assert.equal(tabOf(`${LAB_PATH}/nope`), null);
  assert.deepEqual(movedTarget(LAB_PATH, '?x=1&tab=lab-applications', '#top', 'spinout-lab'),
    { pathname: LAB_PATH, search: '?x=1&moved=spinout-lab', hash: '#top' });
  assert.equal(legacyContractsTarget('?tab=lab-applications'), '/admin/programs/spinout-lab/applications?moved=lab-applications');
});

// ---------------------------------------------------------------- the header (D936)

async function render(el, url = '/admin/x') {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, el)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  return {
    text: () => textOf(container),
    textOf,
    nodes: () => walk(container),
    props,
    byTestId: (id) => walk(container).find((n) => props(n)?.['data-testid'] === id),
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

test('the header: crumb, title, a count is a number, a dash with its reason, a dot that says waiting, or a loading bar', async () => {
  const v = await render(h(AdminPageHeader, {
    crumb: { label: 'Community', to: '/admin/community', current: 'Partner invitations' },
    title: 'Partner invitations',
    line: 'Bring operating partners in.',
    scope: true,
    notice: { text: 'Partner invitations has a new address. Update your bookmark.', onDismiss() {} },
    tabs: h(React.Fragment, null,
      h(HeaderTab, { to: '/admin/x', count: { kind: 'dot' } }, 'Overview'),
      h(HeaderTab, { to: '/admin/x/a', count: { kind: 'num', value: '18' } }, 'Invitations'),
      h(HeaderTab, { to: '/admin/x/b', count: { kind: 'dash', tip: 'Not recorded: no referral source is linked yet.' } }, 'Referrals'),
      h(HeaderTab, { to: '/admin/x/c', count: { kind: 'load' } }, 'Deals')),
  }));
  try {
    const t = v.text();
    assert.match(t, /Community.*›.*Partner invitations/s);
    assert.match(t, /Overview.*waiting.*Invitations18.*Referrals—.*Deals/s);
    assert.doesNotMatch(t, /Referrals0|Deals0/, 'a missing count is never a zero');
    const dash = v.nodes().find((n) => v.props(n)?.title === 'Not recorded: no referral source is linked yet.');
    assert.ok(dash, 'the dash carries its reason');
    const status = v.nodes().find((n) => v.props(n)?.role === 'status');
    assert.ok(status, 'the moved notice is a status message');
    assert.equal(v.props(status)['aria-live'], 'polite');
    assert.ok(v.byTestId('admin-page-scope'));
    const nav = v.nodes().find((n) => v.props(n)?.['aria-label'] === 'Partner invitations' && n.tagName === 'NAV');
    assert.ok(nav, 'the tab bar is a nav named for the page');
  } finally { await v.unmount(); }
  const bare = await render(h(AdminPageHeader, { title: 'Studio', line: 'The overview.' }));
  try {
    assert.ok(!bare.byTestId('admin-page-tabs'), 'a page with no tabs draws no tab bar');
    assert.ok(!bare.byTestId('admin-page-crumb'), 'a section overview has no crumb');
    assert.ok(!bare.byTestId('admin-page-moved'));
  } finally { await bare.unmount(); }
});

// ---------------------------------------------------------------- the page, mounted

/** A stubbed Worker. `fail` names reads that answer 503. */
function worker(fail = []) {
  const seen = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    seen.push(u.pathname + u.search);
    const p = u.pathname;
    const down = (name) => fail.includes(name);
    if (p === '/api/admin/studio/glance') return down('glance') ? json({ detail: 'down' }, 503) : json({ tier: 'hq', approvals: { label: 'HQ', lanes: [{ key: 'cohort', label: 'Cohort applications', count: 7, oldest_age_hours: 80 }], pending_total: 7 } });
    if (p === '/api/admin/cohort/applications') return down('applications') ? json({ detail: 'down' }, 503) : json(APPLICATIONS);
    if (p === '/api/admin/cohort/timeline') return down('timeline') ? json({ detail: 'down' }, 503) : json(TIMELINE);
    if (p === '/api/admin/cohort/overview') return down('overview') ? json({ detail: 'down' }, 503) : json(overviewFixture());
    if (p === '/api/admin/cohort/review') return down('review') ? json({ detail: 'down' }, 503) : json(REVIEW);
    if (p === '/api/admin/lab-hosts') return down('hosts') ? json({ detail: 'down' }, 503) : json(HOSTS);
    if (p === '/api/spinout-lab/certificates') return down('certificates') ? json({ detail: 'down' }, 503) : json(CERTS);
    if (p === '/api/admin/cohort/participants') return down('people') ? json({ error: 'lab_participants_unreadable' }, 503) : json({ available: true, items: [], total: 0, standing: { everyone: 22, needs_decision: 7, on_track: 15, at_risk: 3, grace: 2, failed: 2, graduated: 0, not_in_cohort: 0 } });
    if (p === '/api/admin/spinout-participants') return json({ participants: [], catalog: [] });
    if (p === '/api/admin/spinout-applications') return json({ applications: [] });
    return json({});
  };
  return seen;
}

async function mount(url, fail) {
  const original = globalThis.fetch;
  // The fixtures are production's calendar on 2026-10-24 ("Week 4, day 24 of
  // 28"), so the page reads that day, not the machine's.
  const realNow = Date.now;
  Date.now = () => NOW;
  const seen = worker(fail);
  const v = await render(h(AdminLab), url);
  for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return {
    ...v,
    seen,
    of: (id) => { const n = v.byTestId(id); assert.ok(n, `no ${id}`); return v.textOf(n); },
    has: (id) => Boolean(v.byTestId(id)),
    async unmount() { await v.unmount(); globalThis.fetch = original; Date.now = realNow; },
  };
}

test('mounted Overview: each block from its own read, the header\'s counts, and no Guard H read', async (t) => {
  // The fixture's cohort windows are dated from NOW and the page reads the clock for "Week 4, day 24", so the
  // clock is NOW: on the real one the day moved on with the calendar (day 25 on 2026-10-25).
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const m = await mount(LAB_PATH);
  try {
    assert.match(m.of('lab-header'), /Programs.*Spin-Out Lab.*Live.*HQ-held/s);
    assert.match(m.of('lab-tab-applications'), /Applications7/);
    assert.match(m.of('lab-tab-hosts'), /Hosts2/);
    assert.match(m.of('lab-tab-participants'), /Participants22/, 'D949: counted from the participants read, which says when it fails');
    assert.match(m.of('lab-tile-waiting'), /7.*oldest 3 days.*Overdue.*Review/s);
    assert.match(m.of('lab-tile-next'), /Nov 2026.*9 approved of 25 places · minimum 1 met/s);
    assert.match(m.of('lab-tile-lab'), /22.*Week 4, day 24 of 28/s);
    assert.match(m.of('lab-tile-graduated'), /6.*3 certificates issued/s);
    assert.match(m.of('lab-calendar'), /Oct 2026.*Running/s);
    assert.match(m.of('lab-needs'), /7 applications waiting.*2 founders at risk.*1 founder in grace.*2 office-hours hosts.*2 graduates have no certificate/s);
    for (const id of ['by-cohort', 'weeks', 'funnel', 'per-week']) assert.doesNotMatch(m.of(`lab-${id}`), new RegExp(NOT_YET), `${id} is drawn now (D947)`);
    assert.ok(!m.has('admin-page-moved'), 'no notice without ?moved=');
    const paths = [...new Set(m.seen.map((s) => s.split('?')[0]))].sort();
    assert.deepEqual(paths, ['/api/admin/cohort/applications', '/api/admin/cohort/overview', '/api/admin/cohort/participants', '/api/admin/cohort/review', '/api/admin/cohort/timeline', '/api/admin/lab-hosts', '/api/admin/studio/glance', '/api/spinout-lab/certificates']);
  } finally { await m.unmount(); }
});

test('mounted: one read failing costs only its blocks, and every read failing says nothing is a zero', async () => {
  const one = await mount(LAB_PATH, ['applications']);
  try {
    assert.match(one.of('lab-tile-next'), /Unreadable.*not the same as none/s);
    assert.match(one.of('lab-tile-lab'), /22/, 'another block stopped answering');
    assert.match(one.of('lab-calendar'), /Oct 2026/, 'the calendar is its own read');
    assert.ok(!one.has('lab-unreadable'));
  } finally { await one.unmount(); }
  const all = await mount(LAB_PATH, ['glance', 'applications', 'overview', 'people', 'timeline', 'review', 'hosts', 'certificates']);
  try {
    assert.match(all.of('lab-unreadable'), /Nothing here is a zero/);
    assert.match(all.of('lab-tab-applications'), /Applications—/);
    assert.match(all.of('lab-tab-participants'), /Participants—/, 'a failed participants read is a dash, never 0');
    assert.ok(all.has('lab-tab-graduation'), 'the tabs still open their consoles');
  } finally { await all.unmount(); }
});

test('mounted: the moved notice shows the sentence for the old address it came from', async () => {
  for (const [key, text] of Object.entries(MOVED_NOTICES)) {
    const m = await mount(`${LAB_PATH}/applications?moved=${key}`);
    try { assert.equal(m.of('admin-page-moved').includes(text), true, key); } finally { await m.unmount(); }
  }
  const odd = await mount(`${LAB_PATH}?moved=something-else`);
  try { assert.ok(!odd.has('admin-page-moved'), 'an unknown key shows nothing'); } finally { await odd.unmount(); }
});

test('mounted Participants (D949): the tab draws D946\'s read, not the console, and makes no Guard H read', async () => {
  const m = await mount(`${LAB_PATH}/participants`);
  try {
    assert.ok(m.has('lab-participants'), 'the Participants tab is drawn');
    assert.ok(!m.has('admin-spinout-lab-participants'), 'the old console section is not mounted');
    assert.doesNotMatch(m.text(), /cannot yet tell an empty Lab from a failed read/, 'Guard H\'s line is gone');
    assert.ok(!m.seen.some((s) => /spinout-participants|spinout-applications/.test(s)), 'Guard H: the reads that hide failure are not made');
    assert.ok(!m.seen.some((s) => /cohort\/(applications|review)$/.test(s.split('?')[0])), 'no Overview block is read');
  } finally { await m.unmount(); }
});

test('both old addresses keep their query and hash and add the moved key', async () => {
  for (const [from, el, to] of [
    ['/admin/spinout-lab?x=1#top', LabRedirect, LAB_PATH],
    ['/admin/spinout-lab/preview?x=1#top', LabPreviewRedirect, LAB_PREVIEW_PATH],
  ]) {
    const restore = installDocument();
    let landed = null;
    function Spy() { const l = useLocation(); landed = `${l.pathname}${l.search}${l.hash}`; return null; }
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(h(MemoryRouter, { initialEntries: [from] },
        h(Routes, null,
          h(Route, { path: from.split('?')[0], element: h(el) }),
          h(Route, { path: to, element: h(Spy) }))));
    });
    await act(async () => root.unmount());
    restore();
    assert.equal(landed, `${to}?x=1&moved=spinout-lab#top`);
  }
});

// ---------------------------------------------------------------- Settings: the branch Admin's grant (D1280)
//
// The block reads D984's `GET /api/licence/mine/programs` for the caller's own
// licence. The rows are what `studioPrograms` answers on production's shape.

const LAB_ROW = (standing, grant) => ({ program_key: 'spinout-lab', name: 'Spin-Out Lab', group: 'Founders', standing,
  word: { in_force: 'In force', paused: 'Paused', not_recorded: 'Not recorded', switched_off: 'Not offered' }[standing],
  line: { in_force: 'Your studio runs this program on the terms below.', paused: 'HQ paused this program. Nothing new starts until HQ resumes it.', not_recorded: 'HQ has not recorded a grant for this program yet.', switched_off: 'HQ does not grant this program at the moment.' }[standing],
  grant });
const GRANT = { uid: 'g1', program_key: 'spinout-lab', state: 'granted', in_force: true, waiting_on: [], effective_end: '2027-10-31',
  terms: { starts_on: '2026-11-01', ends_with_licence: 1, capacity_cap: 30, capacity_uncapped: 0, cohorts_per_year: 6, hq_approves_each_cohort: null },
  schedule: { status: 'signed', contract_uid: 'c1', signed_at: '2026-10-02T10:00:00Z' }, note: null, paused_at: null, ended_at: null, set_at: '2026-10-01T09:00:00Z' };
const PROGRAMS = (rows) => ({ linked: true, source: 'hq', as_of: null, age_seconds: null, licence: { uid: 'lic-1', brand_name: 'Synthetic studio' }, programs: rows, reason: null });

async function settings(answer) {
  const original = globalThis.fetch;
  const seen = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  let calls = 0;
  globalThis.fetch = async (url) => {
    const p = new URL(String(url), 'http://x').pathname;
    seen.push(p);
    if (p === '/api/admin/cohort/settings') return json({ settings: { min: 1, max: 25 } });
    if (p === '/api/licence/mine/programs') { calls += 1; const a = typeof answer === 'function' ? answer(calls) : answer; return a instanceof Response ? a : json(a); }
    return json({});
  };
  const v = await render(h(LabSettings));
  const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await flush();
  return {
    ...v, seen, flush,
    of: (id) => { const n = v.byTestId(id); assert.ok(n, `no ${id}`); return v.textOf(n); },
    has: (id) => Boolean(v.byTestId(id)),
    links: () => v.nodes().filter((n) => n.tagName === 'A').map((n) => [v.textOf(n), v.props(n)?.href ?? v.props(n)?.to]),
    async unmount() { await v.unmount(); globalThis.fetch = original; },
  };
}

test('Settings, D1280: an Admin with a grant reads its state, period and cohort terms in the Programs tab\'s words', async () => {
  const m = await settings(PROGRAMS([LAB_ROW('in_force', GRANT), LAB_ROW('not_recorded', null)].map((r, i) => (i ? { ...r, program_key: 'learning' } : r))));
  try {
    const block = m.of('lab-studio-grant');
    assert.match(block, /Grant: In force · Your studio runs this program on the terms below\./);
    assert.match(block, /Period1 Nov 2026 → 31 Oct 2027/);
    assert.match(block, /CapacityUp to 30/);
    assert.match(block, /Cohorts6 cohorts a year/);
    assert.match(block, /ApprovalNot recorded.*HQ has not entered this term\./s, 'a term nobody set is Not recorded, never Off');
    assert.doesNotMatch(m.of('lab-grant-terms'), /#2775|Not read here yet/, 'the wait text that named the gap is gone');
    assert.ok(m.seen.includes('/api/licence/mine/programs'));
    assert.ok(!m.seen.some((p) => p.startsWith('/api/admin/program-grants')), 'an Admin never reads HQ\'s grid');
    assert.ok(m.links().some(([t, to]) => t === 'Open Licences › Programs' && to === '/admin/my-licence/programs'));
  } finally { await m.unmount(); }
});

test('Settings, D1280: with no grant the Admin is told so and sent to request it; HQ-held and no-copy say why', async () => {
  for (const row of [LAB_ROW('not_recorded', null), LAB_ROW('switched_off', null)]) {
    const m = await settings(PROGRAMS([row]));
    try {
      assert.match(m.of('lab-studio-grant-none'), /Your studio does not hold Spin-Out Lab/);
      assert.ok(!m.has('lab-studio-grant'), 'no terms are drawn for a grant that does not exist');
      assert.ok(m.links().some(([t, to]) => t === 'Request it on Licences › Programs' && to === '/admin/my-licence/programs'), row.standing);
    } finally { await m.unmount(); }
  }
  const missing = await settings(PROGRAMS([]));
  try { assert.match(missing.of('lab-studio-grant-none'), /does not hold Spin-Out Lab/); } finally { await missing.unmount(); }
  const hq = await settings({ linked: false, source: 'hq', as_of: null, age_seconds: null, licence: null, programs: [LAB_ROW('not_recorded', null)], reason: 'Your account is not linked to a licence. On HQ-held accounts, HQ runs every program.' });
  try { assert.match(hq.of('lab-studio-grant-unlinked'), /HQ runs every program/); assert.ok(!hq.has('lab-studio-grant-none')); } finally { await hq.unmount(); }
  const copy = await settings({ linked: true, source: 'copy', as_of: null, age_seconds: null, licence: null, programs: null, reason: 'HQ has not sent this branch its programs yet.' });
  try { assert.match(copy.of('lab-studio-grant-no-copy'), /HQ has not sent this branch its programs yet/); assert.ok(!copy.has('lab-studio-grant-none'), 'no copy is not the same as no grant'); } finally { await copy.unmount(); }
});

test('Settings, D1280: a failed or incomplete read is Unreadable with Try again, never "no grant", and Try again reads again', async () => {
  const down = new Response(JSON.stringify({ error: 'licence_programs_unreadable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  const m = await settings((n) => (n === 1 ? down : PROGRAMS([LAB_ROW('in_force', GRANT)])));
  try {
    assert.match(m.of('lab-studio-grant-unreadable'), /Unreadable.*not the same as none.*Try again/s);
    assert.ok(!m.has('lab-studio-grant-none') && !m.has('lab-studio-grant'));
    const retry = m.nodes().find((n) => n.tagName === 'BUTTON' && m.textOf(n) === 'Try again');
    await act(async () => m.props(retry).onClick());
    await m.flush();
    assert.match(m.of('lab-studio-grant'), /In force/);
  } finally { await m.unmount(); }
  for (const body of [{ linked: true, programs: 'nine' }, { programs: [] }, { linked: true, programs: null }]) {
    const odd = await settings(body);
    try { assert.ok(odd.has('lab-studio-grant-unreadable'), `${JSON.stringify(body)} is not drawn as none`); } finally { await odd.unmount(); }
  }
});

// ---------------------------------------------------------------- the source

test('the routes, the redirects, the row, the rail and the reads the page must never make', () => {
  const app = read('frontend/src/App.jsx');
  for (const sub of ['', '/applications', '/cohorts', '/participants', '/hosts', '/formation', '/graduation']) {
    assert.ok(app.includes(`<Route path="/admin/programs/spinout-lab${sub}" element={guard(['admin'], <AdminLab onImpersonate={handleImpersonate} />)} />`), sub || 'overview');
  }
  assert.ok(app.includes(`<Route path="/admin/programs/spinout-lab/preview" element={guard(['admin'], <AdminSpinoutJourneyPreview />)} />`));
  assert.ok(app.includes('<Route path="/admin/spinout-lab" element={<LabRedirect />} />'));
  assert.ok(app.includes('<Route path="/admin/spinout-lab/preview" element={<LabPreviewRedirect />} />'));
  assert.doesNotMatch(app, /<AdminSpinoutLab standalone/, 'the old console is mounted at an address again');
  // #2375: /admin/spinout-lab is kept for good; sent cohort notices carry it.
  assert.match(read('cloudflare-worker/src/services/redirectRoutes.ts'), /\{ path: '\/admin\/spinout-lab', keep: true \}/);
  // No rail: D317 keeps Eadwyn out of the Lab, at every tab.
  assert.ok(NO_RAIL_ROUTES.some((n) => n.route === LAB_PATH && n.prefix && n.roles.includes('admin')));
  // D953: Programs now owns the whole subtree, including every Lab tab.
  const rows = SIDEBAR_GROUPS.admin.flatMap((g) => g.items || []);
  for (const sub of ['', '/applications', '/cohorts', '/participants', '/hosts', '/formation', '/graduation', '/preview']) {
    const path = `${LAB_PATH}${sub}`;
    const lit = rows.filter((r) => r.to === path || (r.match || []).some((m) => path === m || path.startsWith(`${m}/`)));
    assert.deepEqual(lit.map((r) => r.label), ['Programs'], path);
  }
  const page = read('frontend/src/pages/admin/lab/AdminLab.jsx');
  // Guard H: neither read that hides its failures feeds a figure here.
  assert.doesNotMatch(page + read('frontend/src/pages/admin/lab/labModel.js').replace(/\/\*\*[\s\S]*?\*\//g, ''), /adminSpinoutApplications|adminSpinoutParticipants|spinout-applications|spinout-participants/);
  // Applications is the cycle queue, the door that decides with a reason.
  assert.match(page, /applications: \['cycles'\]/);
  assert.doesNotMatch(page, /WorkerRail|RailFrame|AdminBoardFrame/, 'the Lab drew a rail');
});
