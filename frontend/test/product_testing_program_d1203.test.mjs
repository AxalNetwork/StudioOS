// D1203 (#3153, part 8 of #2382) — one program complete (TST5, TST6) and the
// Applicants tab (TST8): the lifecycle stepper and four stats, the details and
// a partner's review lines, the applicants table with its answers, filters,
// search, sort, Tester badge and the withdrawn hidden until asked, a partner's
// list read only, Activity from D1197's history read, and every application
// across programs with its scope switch and status chips. Never an email.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/product_testing_program_d1203.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { ProductTestingHqPage } from '../src/pages/admin/ConsolePages.jsx';
import {
  answersOf, applicantsView, applicationRow, eventLine, miniStats, programmeFacts, rangeLine, reviewLines, statusChips,
  stepsFoot, stepsFor, whenLine,
} from '../src/pages/admin/productTesting/programModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const SUPER = { id: 1, role: 'admin', is_super_admin: 1, name: 'Super', email: 's@example.com' };

const ALPHA = {
  uid: 'alpha', status: 'open', owner_kind: 'hq', owner_name: 'Axal VC', product_name: 'Data room alpha', places: 20, picked_count: 12, applicant_count: 4,
  summary: 'A guided setup for a first data room.', tester_tasks: 'Share a sample room.', time_needed: '2 hours a week',
  eligible_roles: ['founder', 'investor'], questions: ['Have you shared a data room before?', 'Which device will you test on?'],
  opens_at: '2026-09-01', closes_at: '2026-10-15', testing_starts: '2026-10-16', testing_ends: '2026-10-30', updated_at: '2026-10-20 09:00:00',
};
const BETA = {
  uid: 'beta', status: 'open', owner_kind: 'partner', owner_name: 'Partner Firm A', product_name: 'Product beta', places: 10, picked_count: 5, applicant_count: 2,
  eligible_roles: ['founder'], questions: ['What do you use today?'], opens_at: '2026-10-10', closes_at: '2026-11-10', testing_starts: '2099-11-12', testing_ends: null, updated_at: '2026-10-10 09:00:00',
};
const ev = (id, action, at, extra = {}) => ({ id, action, at, actor: { name: 'Hana Q' }, application_uid: null, applicant_name: null, detail: null, ...extra });
const ALPHA_EVENTS = [
  ev(6, 'picked', '2026-09-20 09:30:00', { applicant_name: 'Ada Example' }),
  ev(5, 'withdrawn_by_hq', '2026-09-18 10:00:00', { applicant_name: 'Wes Gone', detail: { reason: 'Asked to leave the program.' } }),
  ev(4, 'applied', '2026-09-02 14:31:00', { actor: { name: 'Ada Example' }, applicant_name: 'Ada Example' }),
  ev(3, 'opened', '2026-09-01 08:00:00'),
  ev(2, 'edited', '2026-08-26 08:00:00', { actor: null }),
  ev(1, 'created', '2026-08-25 10:12:00'),
];
const BETA_EVENTS = [
  ev(13, 'opened', '2026-10-10 09:00:00'),
  ev(12, 'approved', '2026-10-04 09:00:00', { actor: { name: 'Admin Name' } }),
  ev(11, 'submitted', '2026-10-02 09:00:00', { actor: { name: 'Pat Partner' } }),
  ev(10, 'created', '2026-09-28 09:00:00', { actor: { name: 'Pat Partner' } }),
];
const ap = (uid, name, role, status, extra = {}) => ({
  uid, name, role, status, tester: false, answers: ['Yes, twice.', 'A laptop'], availability: 'Evenings', consented: true,
  applied_at: '2026-09-02 14:31:00', updated_at: '2026-09-02 14:31:00', ...extra,
});
const ALPHA_APPLICANTS = {
  programme: ALPHA, can_decide: true, tester_pool_readable: true,
  items: [
    ap('a1', 'Ada Example', 'founder', 'picked', { tester: true, applied_at: '2026-09-02 14:31:00' }),
    ap('a2', 'Finn Mock', 'founder', 'applied', { applied_at: '2026-10-14 16:20:00', consented: false, availability: null }),
    ap('a3', 'Ivy Lee', 'investor', 'applied', { applied_at: '2026-10-12 10:41:00', answers: ['No'] }),
    ap('a4', 'Gus Demo', 'investor', 'declined', { applied_at: '2026-10-09 08:58:00', tester: null }),
  ],
};
const BETA_APPLICANTS = { programme: BETA, can_decide: false, tester_pool_readable: true, items: [ap('b1', 'Ben Sample', 'founder', 'applied'), ap('b2', 'Chloé Place', 'founder', 'picked', { tester: true })] };
const WITHDRAWN = { applications: { available: true, page: 1, page_size: 100, total: 1, counts: { applied: 2, picked: 1, declined: 1, withdrawn: 1 },
  items: [{ uid: 'w1', name: 'Wes Gone', role: 'founder', status: 'withdrawn', consented: true, in_pool: false, applied_at: '2026-09-05 09:00:00', programme: { uid: 'alpha', product_name: ALPHA.product_name, owner_kind: 'hq', owner_name: null } }] } };
const appl = (uid, name, prog, status, extra = {}) => ({
  uid, name, role: 'founder', status, consented: true, in_pool: false, answers: [], availability: null, applied_at: '2026-10-14 16:20:00',
  programme: { uid: prog.uid, product_name: prog.product_name, owner_kind: prog.owner_kind, owner_name: prog.owner_kind === 'hq' ? null : prog.owner_name }, ...extra,
});
const APPLICATIONS = { applications: { available: true, page: 1, page_size: 25, total: 3, sort: 'applied', scope: 'open', counts: { applied: 27, picked: 19, declined: 2, withdrawn: 2 },
  items: [appl('x1', 'Finn Mock', ALPHA, 'applied', { in_pool: true }), appl('x2', 'Ben Sample', BETA, 'applied'), appl('x3', 'Ada Example', ALPHA, 'picked')] } };
const OVERVIEW = { mail_reach: { available: true, programmes: [{ uid: 'alpha', product_name: ALPHA.product_name, status: 'open', picked: 12, consented: 11, emails_on: 10, reachable: 10 }] } };

function handler(over = {}) {
  return (path) => {
    if (path in over) return over[path];
    for (const [k, v] of Object.entries(over)) if (k.endsWith('*') && path.startsWith(k.slice(0, -1))) return v;
    if (path.startsWith('/admin/testing/programmes/alpha/events')) return response({ programme: ALPHA, events: { available: true, page: 1, page_size: 100, total: ALPHA_EVENTS.length, items: ALPHA_EVENTS } });
    if (path.startsWith('/admin/testing/programmes/beta/events')) return response({ programme: BETA, events: { available: true, page: 1, page_size: 100, total: BETA_EVENTS.length, items: BETA_EVENTS } });
    if (path === '/admin/testing/programmes/alpha/applicants') return response(ALPHA_APPLICANTS);
    if (path === '/admin/testing/programmes/beta/applicants') return response(BETA_APPLICANTS);
    if (path.startsWith('/admin/testing/programmes')) return response({ items: [ALPHA, BETA] });
    if (path.startsWith('/admin/testing/applications?') && path.includes('status=withdrawn')) return response(WITHDRAWN);
    if (path.startsWith('/admin/testing/applications')) return response(APPLICATIONS);
    if (path.startsWith('/admin/testing/overview')) return response(OVERVIEW);
    if (path.startsWith('/admin/product-testers')) return response({ rows: [], page: 1, page_size: 25, matching: 0, totals: { applied: 0, active: 0, paused: 0, declined: 0, removed: 0, total: 0 } });
    return response({});
  };
}

async function mounted(url, over = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  const handle = handler(over);
  globalThis.fetch = async (u) => {
    const path = String(u).replace(/^.*\/api/, '');
    requests.push(path);
    return handle(path);
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(SUPER));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(ProductTestingHqPage)))));
  const settle = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const all = (id) => walk(container).filter((n) => pr(n)['data-testid'] === id);
  const by = (id) => all(id)[0];
  return {
    requests, by, all, pr,
    ids: () => walk(container).map((n) => pr(n)['data-testid']).filter(Boolean),
    // A missing node fails, rather than matching against the whole page.
    text: (id) => { if (id) assert.ok(by(id), `no node ${id}`); return txt(id ? by(id) : container).replace(/\s+/g, ' ').trim(); },
    async press(id) { assert.ok(by(id), `no node ${id}`); await act(async () => { pr(by(id)).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async change(id, value) { assert.ok(by(id), `no node ${id}`); await act(async () => { pr(by(id)).onChange?.({ target: { value } }); }); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the stepper: each step done, now or next, dated from the history; a gap says "Date not recorded"', () => {
  const steps = stepsFor(ALPHA, ALPHA_EVENTS);
  assert.deepEqual(steps.map((s) => [s.label, s.state, s.note]), [
    ['Draft', 'done', '25 Aug 2026'], ['Open', 'now', '1 Sep 2026'], ['Testing', 'next', 'Dates say 16 Oct 2026'], ['Closed', 'next', null],
  ]);
  assert.deepEqual(stepsFor(BETA, BETA_EVENTS).map((s) => s.label), ['Draft', 'Waiting for HQ', 'Approved', 'Open', 'Testing', 'Closed'], 'a partner\'s passes HQ\'s review');
  assert.equal(stepsFor(BETA, [])[1].note, 'Date not recorded', 'a done step with no event is not dated');
  const sentBack = stepsFor({ ...BETA, status: 'rejected' }, [ev(1, 'submitted', '2026-10-02 09:00:00'), ev(2, 'rejected', '2026-10-03 09:00:00')]);
  assert.deepEqual([sentBack[1].state, sentBack[1].note], ['now', 'Sent back · 3 Oct 2026']);
  assert.equal(stepsFoot(ALPHA, Date.parse('2026-10-20T00:00:00Z')), 'Its dates say testing began on 16 Oct 2026. It stays Open until someone moves it to Testing.');
  assert.equal(stepsFoot(ALPHA, Date.parse('2026-10-01T00:00:00Z')), null, 'not before its dates');
  assert.equal(stepsFoot({ ...ALPHA, status: 'testing' }, Date.parse('2026-10-20T00:00:00Z')), null);
  assert.deepEqual(reviewLines(BETA, BETA_EVENTS), ['Sent 2 Oct 2026 by Pat Partner.', 'Approved 4 Oct 2026 by Admin Name.', 'Opened 10 Oct 2026.']);
  assert.deepEqual(reviewLines(ALPHA, ALPHA_EVENTS), [], 'HQ\'s own has no review');
});

test('the four stats: places, applicants with the withdrawn apart, agreed to email, Mail reach; a failed read says so', () => {
  const s = miniStats(ALPHA, { applicants: ALPHA_APPLICANTS, withdrawn: 1, reach: OVERVIEW.mail_reach });
  assert.deepEqual(s.map((x) => [x.label, x.value, x.sub]), [
    ['Places filled', '12 of 20', '8 places left'],
    ['Applicants', '4', '1 withdrawn, not counted'],
    ['Agreed to email', '3', 'of 4 applicants'],
    ['Reachable by Mail', '10 of 12', 'picked testers'],
  ]);
  const blind = miniStats({ ...ALPHA, places: 0 }, { applicants: null, withdrawn: null, reach: null });
  assert.deepEqual(blind.map((x) => x.value), ['Not recorded', 'Unreadable', 'Unreadable', 'Unreadable'], 'never a zero for a read that failed');
  assert.equal(blind[1].sub, 'Withdrawn could not be read');
  assert.equal(miniStats(BETA, { applicants: BETA_APPLICANTS, withdrawn: 0, reach: OVERVIEW.mail_reach })[3].value, 'Not recorded', 'a program not in the reach block is not 0');
  assert.deepEqual(programmeFacts(ALPHA).map((f) => f.k), ['Summary', 'What testers do', 'Time needed', 'Who can apply', 'Screening questions', 'Places', 'Applications', 'Testing']);
  assert.equal(programmeFacts(BETA).find((f) => f.k === 'Testing').v, '12 Nov 2099 – Not recorded');
});

test('Activity in words: who did what to whom; an account that is gone is named so', () => {
  assert.deepEqual(ALPHA_EVENTS.map(eventLine), [
    'Hana Q picked Ada Example',
    'Hana Q withdrew Wes Gone’s application: Asked to leave the program.',
    'Ada Example applied',
    'Opened by Hana Q',
    'Edited by An account no longer here',
    'Created by Hana Q',
  ]);
  assert.equal(eventLine(ev(9, 'testing_started', 'x')), 'Moved to testing by Hana Q');
  assert.equal(eventLine(ev(9, 'rejected', 'x', { detail: { note: 'Say what to install.' } })), 'Sent back by Hana Q: Say what to install.');
  assert.equal(whenLine('2026-10-14 16:20:00'), '14 Oct 2026, 16:20');
  assert.equal(whenLine(null), 'Not recorded');
});

test('the applicants view: filters, search from two characters, three sorts, and the badge unknown when the pool was not read', () => {
  const all = applicantsView(ALPHA_APPLICANTS.items);
  assert.deepEqual(all.rows.map((r) => r.name), ['Finn Mock', 'Ivy Lee', 'Gus Demo', 'Ada Example'], 'newest first');
  assert.deepEqual(applicantsView(ALPHA_APPLICANTS.items, { sort: 'oldest' }).rows.map((r) => r.name)[0], 'Ada Example');
  assert.deepEqual(applicantsView(ALPHA_APPLICANTS.items, { sort: 'name' }).rows.map((r) => r.name), ['Ada Example', 'Finn Mock', 'Gus Demo', 'Ivy Lee']);
  assert.deepEqual(applicantsView(ALPHA_APPLICANTS.items, { status: 'applied' }).rows.map((r) => r.name), ['Finn Mock', 'Ivy Lee']);
  assert.deepEqual(applicantsView(ALPHA_APPLICANTS.items, { role: 'investor' }).rows.map((r) => r.name), ['Ivy Lee', 'Gus Demo']);
  assert.deepEqual(applicantsView(ALPHA_APPLICANTS.items, { consented: 'no' }).rows.map((r) => r.name), ['Finn Mock']);
  assert.deepEqual(applicantsView(ALPHA_APPLICANTS.items, { q: 'iv' }).rows.map((r) => r.name), ['Ivy Lee']);
  const one = applicantsView(ALPHA_APPLICANTS.items, { q: 'i' });
  assert.equal(one.rows.length, 4, 'one character searches nothing');
  assert.equal(one.tooShort, true);
  assert.deepEqual(all.rows.map((r) => r.tester), ['no', 'no', 'unknown', 'yes']);
  assert.equal(all.rows[0].availability, 'Not given');
  assert.deepEqual(answersOf(ALPHA.questions, ['No']), [{ q: ALPHA.questions[0], a: 'No' }, { q: ALPHA.questions[1], a: 'No answer recorded' }]);
});

test('TST8\'s chips, rows and range: All leaves the withdrawn out; Axal VC\'s own says so', () => {
  assert.deepEqual(statusChips(APPLICATIONS.applications.counts).map((c) => [c.label, c.count]), [
    ['All', 48], ['Applied', 27], ['Picked', 19], ['Not this time', 2], ['Withdrawn · not in All', 2],
  ]);
  assert.deepEqual(statusChips(null).map((c) => c.count), [null, null, null, null, null], 'no counts read is no number');
  const [a, b] = APPLICATIONS.applications.items.map(applicationRow);
  assert.deepEqual([a.owner, a.hq, a.tester, b.owner, b.hq], ['Axal VC', true, true, 'Partner Firm A', false]);
  assert.equal(rangeLine(1, 25, 48, 25), '1–25 of 48');
  assert.equal(rangeLine(2, 25, 48, 23), '26–48 of 48');
  assert.equal(rangeLine(1, 25, 0, 0), '0 of 0');
});

/* ------------------------------------------------------------------ *
 * The page, mounted
 * ------------------------------------------------------------------ */

test('HQ\'s own program: the stepper, the four stats, the details and recent activity, from their reads', async () => {
  const v = await mounted('/admin/platform/product-testing/programs/alpha');
  try {
    assert.equal(v.pr(v.by('testing-step-open'))['data-state'], 'now');
    assert.equal(v.pr(v.by('testing-step-draft'))['data-state'], 'done');
    assert.match(v.text('testing-step-draft'), /25 Aug 2026/);
    assert.match(v.text('testing-step-testing'), /Dates say 16 Oct 2026/);
    assert.equal(v.text('testing-stat-places-value'), '12 of 20');
    assert.equal(v.text('testing-stat-applicants-value'), '4');
    assert.match(v.text('testing-stat-applicants'), /1 withdrawn, not counted/);
    assert.equal(v.text('testing-stat-reach-value'), '10 of 12');
    assert.match(v.text('testing-program-details'), /Screening questions 1\. Have you shared a data room before\?/);
    assert.ok(!v.by('testing-program-review'), 'HQ\'s own has no review card');
    assert.match(v.text('testing-program-recent'), /Hana Q picked Ada Example/);
    assert.ok(v.requests.some((u) => u.startsWith('/admin/testing/programmes/alpha/events?page=1&page_size=100')));
    assert.ok(!/@example\.(com|test)/.test(v.text()), 'no email anywhere');
  } finally { await v.close(); }
});

test('HQ\'s own applicants: the badge, the answers, filters, Pick and Decline, and the withdrawn hidden until asked', async () => {
  const v = await mounted('/admin/platform/product-testing/programs/alpha?tab=applicants');
  try {
    assert.equal(v.all('testing-applicant-row').length, 4);
    assert.equal(v.all('testing-tester-badge').length, 1, 'only the pool member; an unread badge is no badge');
    assert.ok(v.by('testing-pick-a2') && v.by('testing-decline-a2'), 'HQ decides its own');
    assert.ok(!v.by('testing-pick-a1'), 'a picked applicant is not picked again');
    assert.ok(v.by('testing-withdraw-a1'));
    assert.ok(!v.by('testing-answers-a3'));
    await v.press('testing-applicant-open-a3');
    assert.match(v.text('testing-answers-a3'), /Question 1 Have you shared a data room before\? No Question 2 Which device will you test on\? No answer recorded/);
    await v.change('testing-applicant-filters-status', 'applied');
    assert.equal(v.all('testing-applicant-row').length, 2);
    await v.change('testing-applicant-filters-q', 'fi');
    assert.equal(v.all('testing-applicant-row').length, 1);
    assert.equal(v.text('testing-withdrawn-count'), '1');
    assert.ok(!v.by('testing-withdrawn-list'), 'the withdrawn are hidden until asked');
    await v.press('testing-withdrawn-toggle');
    assert.match(v.text('testing-withdrawn-list'), /Wes Gone/);
    assert.ok(v.requests.some((u) => u.startsWith('/admin/testing/applications?') && u.includes('programme=alpha') && u.includes('status=withdrawn')));
    await v.press('testing-pick-a2');
    assert.ok(v.ids().some((id) => /testing-dialog|lightbox/.test(id)), 'Pick opens its dialog, never a browser pop-up');
    assert.ok(!/@example\.(com|test)/.test(v.text()), 'no email anywhere');
  } finally { await v.close(); }
});

test('a partner\'s program: the review lines, and its applicants read only with the canvas\'s line', async () => {
  let v = await mounted('/admin/platform/product-testing/programs/beta');
  try {
    assert.match(v.text('testing-program-review'), /Sent 2 Oct 2026 by Pat Partner\. Approved 4 Oct 2026 by Admin Name\. Opened 10 Oct 2026\./);
    assert.match(v.text('testing-stat-applicants'), /read only for HQ/);
  } finally { await v.close(); }
  v = await mounted('/admin/platform/product-testing/programs/beta?tab=applicants');
  try {
    assert.equal(v.all('testing-applicant-row').length, 2);
    assert.match(v.text('testing-applicants-line'), /Partner Firm A picks its testers\. HQ can read this list, not change it\./);
    assert.ok(!v.ids().some((id) => /^testing-(pick|decline|withdraw)-/.test(id)), 'no Pick, Decline or Withdraw on a partner\'s list');
    assert.equal(v.all('testing-tester-badge').length, 1);
    assert.ok(!/@example\.(com|test)/.test(v.text()));
  } finally { await v.close(); }
});

test('Activity reads the history, in words, newest first; a failed read says so', async () => {
  let v = await mounted('/admin/platform/product-testing/programs/alpha?tab=activity');
  try {
    assert.equal(v.all('testing-activity-row').length, 6);
    assert.match(v.text('testing-activity-table'), /20 Sep 2026, 09:30 Hana Q picked Ada Example/);
    assert.match(v.text('testing-activity-range'), /1–6 of 6/);
  } finally { await v.close(); }
  v = await mounted('/admin/platform/product-testing/programs/alpha?tab=activity', { '/admin/testing/programmes/alpha/events*': response({ detail: 'down' }, 503) });
  try {
    assert.ok(v.by('testing-activity-unreadable'));
    assert.ok(!v.by('testing-activity-none'), 'a failed read is never "nothing recorded"');
  } finally { await v.close(); }
  // An answer that says its block is not available is not an empty history either.
  v = await mounted('/admin/platform/product-testing/programs/alpha?tab=activity', { '/admin/testing/programmes/alpha/events*': response({ programme: ALPHA, events: { available: false, reason: 'not_readable' } }) });
  try {
    assert.ok(v.by('testing-activity-unreadable'));
    assert.ok(!v.by('testing-activity-none'));
  } finally { await v.close(); }
  v = await mounted('/admin/platform/product-testing/programs/alpha', { '/admin/testing/programmes/alpha/events*': response({ detail: 'down' }, 503) });
  try {
    assert.ok(v.by('testing-program-steps-unreadable'));
    assert.equal(v.text('testing-stat-places-value'), '12 of 20', 'one failed read costs one block');
  } finally { await v.close(); }
  v = await mounted('/admin/platform/product-testing/programs/alpha?tab=applicants', { '/admin/testing/programmes/alpha/applicants': response({ detail: 'down' }, 503) });
  try {
    assert.ok(v.by('testing-program-applicants-unreadable'));
  } finally { await v.close(); }
});

test('the Applicants tab: open programs first, the chips\' counts, the filters sent to the read, Pick only on Axal VC\'s own', async () => {
  const v = await mounted('/admin/platform/product-testing/applicants');
  try {
    const first = v.requests.find((u) => u.startsWith('/admin/testing/applications?'));
    assert.ok(first.includes('scope=open') && first.includes('page_size=25'));
    assert.equal(v.text('testing-status-chip-all'), 'All 48');
    assert.equal(v.text('testing-status-chip-withdrawn'), 'Withdrawn · not in All 2');
    assert.equal(v.all('testing-application-row').length, 3);
    assert.equal(v.all('testing-tester-badge').length, 1);
    assert.ok(v.by('testing-app-pick-x1'), 'Axal VC\'s own: Pick');
    assert.ok(!v.by('testing-app-pick-x2') && !v.by('testing-app-decline-x2'), 'a partner\'s: no Pick or Decline');
    assert.ok(v.by('testing-app-withdraw-x2'), 'Withdraw for the member on any program');
    await v.press('testing-scope-all');
    assert.ok(v.requests.some((u) => u.startsWith('/admin/testing/applications?') && u.includes('scope=all')));
    await v.press('testing-status-chip-picked');
    await v.change('testing-applications-owner', 'partner');
    await v.change('testing-applications-tester', 'yes');
    await v.change('testing-applications-q', 'fi');
    const last = v.requests.filter((u) => u.startsWith('/admin/testing/applications?')).at(-1);
    for (const part of ['status=picked', 'owner=partner', 'tester=yes', 'q=fi', 'scope=all']) assert.ok(last.includes(part), part);
    await v.change('testing-applications-q', 'f');
    assert.ok(!v.requests.filter((u) => u.startsWith('/admin/testing/applications?')).at(-1).includes('q='), 'one character searches nothing');
    assert.ok(!/@example\.(com|test)/.test(v.text()));
  } finally { await v.close(); }
  const w = await mounted('/admin/platform/product-testing/applicants', { '/admin/testing/applications*': response({ detail: 'down' }, 503) });
  try {
    assert.ok(w.by('testing-applications-unreadable'));
    assert.ok(!w.by('testing-applications-none'));
  } finally { await w.close(); }
});

test('the source: sub-tabs stay ?tab=, no email field drawn, no browser pop-up', () => {
  const src = readFileSync('frontend/src/pages/admin/productTesting/ProductTestingTabs.jsx', 'utf8');
  assert.doesNotMatch(src, /\b(window\.)?(alert|confirm|prompt)\(/);
  assert.doesNotMatch(src, /\.email\b|member_email/);
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  assert.doesNotMatch(app, /product-testing\/programs\/:uid\/(applicants|activity)/, 'D1203 keeps ?tab=');
});
