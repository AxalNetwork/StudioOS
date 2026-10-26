/**
 * D1233 (#3241) — KYC part 5: People (KYC1, KYC2, KYC11–KYC16) and one
 * person's case (KYC3–KYC5): the queue on part 1's read with its figures,
 * the viewer inside the page, the decision dialogs, and no browser pop-up.
 *
 * Mounted against the Worker's own shapes (`kycCase.ts` readQueue and
 * readFigures, `kyc.ts` GET /admin/:userId with part 2's screening and HQ
 * blocks, GET /admin/:userId/case) through a stubbed fetch. Every person,
 * email and reason is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/kyc_people_d1233.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import KycConsole from '../src/pages/admin/consoles/KycConsole.jsx';
import { KycPersonCase } from '../src/pages/admin/kyc/KycCase.jsx';
import {
  actionsFor, appliedFilters, approveNeedsNote, chipCount, checkRows, checkSummary, documentRows, emptyLine, eventLine, hqView,
  infoMessage, noticePreview, pageLine, queryParams, refusalWord, screeningView, tiles, waitLead, waitText, weekBars, weekLead,
} from '../src/pages/admin/kyc/peopleModel.js';
import { viewerRefusal } from '../src/pages/admin/kyc/KycViewer.jsx';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const NOW = '2026-10-21T10:42:00Z';
const ME = { id: 2, name: 'Ada Admin', role: 'admin' };

const response = (body, status = 200, type = 'application/json') => ({
  ok: status < 400, status, type: 'basic', redirected: false,
  headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? type : null) },
  json: async () => body, text: async () => JSON.stringify(body), blob: async () => new Blob(['img'], { type }),
});

const ROW = (id, name, extra = {}) => ({
  id, name, email: `${name.split(' ')[0].toLowerCase()}@example.test`, role: 'investor', status: 'pending',
  submitted_at: '2026-10-15 09:12:00', reviewed_at: null, wait_days: 6, id_type: 'passport', country: 'IN', flags: [],
  assignee: null, assigned_at: null, reviewer: null, ...extra,
});
const PEOPLE = () => ({
  rows: [
    ROW(7, 'Dev Testcase', { assignee: { id: 2, name: 'Ada Admin' } }),
    ROW(8, 'Eva Demo', { wait_days: 4, id_type: 'national_id', country: 'ES', flags: ['pep'], role: 'partner' }),
    ROW(9, 'Ben Sample', { status: 'needs_info', wait_days: 0, id_type: 'driver_license', country: 'GB', flags: ['auto_failed'] }),
  ],
  total: 17, page: 1, page_size: 25,
  counts: { not_started: 845, pending: 14, needs_info: 3, approved: 402, rejected: 18, expired: 2 },
});
const FIGURES = () => ({
  weeks: [
    { week_start: '2026-10-19', approved: 5, rejected: 1, needs_info: 1 },
    { week_start: '2026-10-12', approved: 8, rejected: 1, needs_info: 1 },
    { week_start: '2026-09-28', approved: 6, rejected: 2, needs_info: 1 },
  ],
  median_hours_to_decision: 43.2, median_reason: null, decisions_measured: 26,
  wait_bands: { under_1_day: 5, '1_to_3_days': 5, '3_to_7_days': 4, over_7_days: 0, not_recorded: 0 },
});
const CHECKS_PASS = { name_present: true, dob_valid: true, address_present: true, id_type_valid: true, id_number_present: true, document_present: true, age_ok: true };
const RECORD = (extra = {}) => ({
  id: 7, email: 'dev@example.test', name: 'Dev Testcase', role: 'investor', kyc_status: 'pending', kyc_provider: 'mock',
  submitted_at: '2026-10-15 09:12:00', reviewed_at: '2026-10-02 16:20:00', rejection_reason: 'Photo unreadable. They resubmitted.',
  kyc_data: {
    legal_first_name: 'Dev', legal_last_name: 'Testcase', nationality: 'IN', country: 'IN', id_type: 'passport',
    pep_self_disclosed: false, sanctions_acknowledged: true, document_uploaded: false,
    provider_result: { provider: 'mock', result: 'review', checks: CHECKS_PASS, ref_id: 'mock_4821' },
    masked: { date_of_birth: '••/••/19••', id_number: '••••4821', address: '••• Mumbai', phone: '••• 1937' },
  },
  screening: { state: 'clear', id: 41, run_at: '2026-10-15 09:12:30', severity: null, match_count: 0, reviewed: null },
  hq: { state: 'ready', with_hq: false, open: [], decided: [] },
  ...extra,
});
const CASE = (extra = {}) => ({
  user_id: 7, kyc_status: 'pending', assignee: { id: 2, name: 'Ada Admin' }, assigned_at: '2026-10-18 09:30:00',
  events: [
    { id: 3, kind: 'assigned', note: 'user_id=2', at: '2026-10-18 09:30:00', actor: { id: 5, name: 'Sam Second' } },
    { id: 2, kind: 'submitted', note: null, at: '2026-10-15 09:12:00', actor: null },
    { id: 1, kind: 'rejected', note: 'Photo unreadable.', at: '2026-10-02 16:20:00', actor: { id: 5, name: 'Sam Second' } },
  ],
  notes: [{ id: 1, body: 'Asked the member to retake the photo.', at: '2026-10-03 10:00:00', author: { id: 5, name: 'Sam Second' } }],
  documents: [
    { id: 31, kind: 'id_front', content_type: 'image/png', size_bytes: 1258291, created_at: '2026-10-15 09:12:00', removed_at: null },
    { id: 30, kind: 'proof_of_address', content_type: 'application/pdf', size_bytes: 90000, created_at: '2026-10-01 09:00:00', removed_at: '2026-10-02 16:20:00' },
  ],
  ...extra,
});

// ---------------------------------------------------------------- the model

test('the queue: chip counts, the query the Worker reads, applied chips, the page line, the wait never "0 days"', () => {
  const counts = PEOPLE().counts;
  assert.deepEqual(['pending', 'needs_info', 'not_started', 'all'].map((k) => chipCount(counts, k)), [14, 3, 845, 439], 'All is every opened case: Not started is left out, as the Worker does');
  assert.equal(chipCount(null, 'pending'), null, 'no counts read is not a zero');
  assert.deepEqual(queryParams({ status: 'odd', sort: 'decided', country: 'pt', flag: 'pep', id_type: 'visa', assignee: 'me', page: 0, page_size: 7 }),
    { status: 'pending', q: '', id_type: '', country: 'PT', flag: 'pep', assignee: 'me', sort: 'reviewed', dir: 'desc', page: 1, page_size: 25 });
  assert.deepEqual(queryParams({ sort: 'oldest' }).sort + queryParams({ sort: 'oldest' }).dir, 'submittedasc', 'oldest first by default');
  assert.deepEqual(appliedFilters({ flag: 'pep', country: 'es', assignee: 'none' }).map((f) => f.label), ['Country: ES', 'Flags: PEP', 'Assigned: no one']);
  assert.deepEqual([pageLine(17, 1, 10), pageLine(17, 2, 10), pageLine(0, 1, 25), pageLine(undefined, 1, 25)], ['1–10 of 17', '11–17 of 17', '0 of 0', null]);
  assert.deepEqual([waitText({ wait_days: 0 }), waitText({ wait_days: 1 }), waitText({ wait_days: 6 }), waitText({ wait_days: null })], ['Under a day', '1 day', '6 days', null]);
  assert.deepEqual(emptyLine({ status: 'pending' }), { title: 'Nothing is waiting.', line: 'New submissions appear here, oldest first.' });
  assert.equal(emptyLine({ status: 'pending', flag: 'pep' }).title, 'No cases match these filters.');
  assert.equal(emptyLine({ status: 'expired' }).title, 'No one is Expired.');
});

test('the figures: eight weeks with the unrecorded ones dashed, the leads, and tiles that are null rather than zero', () => {
  const bars = weekBars(FIGURES().weeks, NOW);
  assert.equal(bars.length, 8);
  assert.deepEqual([bars[7].week_start, bars[7].current, bars[7].approved], ['2026-10-19', true, 5], 'this week last, read as the Monday the Worker groups by');
  assert.deepEqual([bars[5].week_start, bars[5].recorded, bars[5].approved], ['2026-10-05', false, null], 'a week with no recorded decision is null, never 0');
  assert.equal(weekLead(bars), '26 decisions recorded in eight weeks. 5 weeks have none recorded, drawn dashed. This week so far: 7.');
  assert.equal(waitLead(FIGURES().wait_bands), '14 people are waiting. 9 have waited a day or more, past the one-business-day promise; nobody longer than 7 days.');
  const t = Object.fromEntries(tiles({ counts: PEOPLE().counts, figures: FIGURES(), nowIso: NOW }).map((x) => [x.key, x]));
  assert.deepEqual([t.waiting.value, t.needs_info.value, t.decided.value, t.median.value], [14, 3, 26, '1.8 days'], 'the last four weeks, from the week of 28 Sep');
  assert.equal(t.decided.sub, '19 approved · 4 rejected · 3 asked for information');
  const blind = Object.fromEntries(tiles({ counts: null, figures: { weeks: [], median_hours_to_decision: null, median_reason: 'No decision in the last 90 days has its submission time recorded.' }, nowIso: NOW }).map((x) => [x.key, x]));
  assert.deepEqual([blind.waiting.value, blind.median.value], [null, null]);
  assert.equal(blind.median.sub, 'No decision in the last 90 days has its submission time recorded.');
  assert.match(weekLead(weekBars([], NOW)), /No decision is recorded/);
});

test('an unread screening never reads as clear, and approving without a clear one needs a note', () => {
  const states = [
    [{ state: 'clear', run_at: '2026-10-15 09:00:00' }, true],
    [{ state: 'match', id: 4, match_count: 1, severity: 'medium', reviewed: null }, false],
    [{ state: 'unreadable', reason: 'lists_unavailable' }, false],
    [{ state: 'unreadable', reason: 'read_failed' }, false],
    [{ state: 'not_run' }, false],
    [undefined, false],
  ];
  for (const [s, clear] of states) {
    const v = screeningView(s);
    assert.equal(v.clear, clear, JSON.stringify(s));
    assert.equal(approveNeedsNote(s), !clear);
    if (!clear) {
      assert.doesNotMatch(v.line, /· No match/, 'only a clear run says No match');
      if (s?.state !== 'match') assert.match(v.line, /This is not a claim that there is no match\./);
    }
  }
  assert.equal(screeningView(states[0][0]).line, '15 Oct 2026 · against the OFAC, EU and UK lists · No match');
  assert.equal(screeningView(states[1][0]).line, '1 possible match · medium · not reviewed');
  assert.equal(screeningView(states[1][0]).reviewable, true);
  assert.equal(screeningView({ state: 'match', match_count: 2, reviewed: { by: { name: 'Sam Second' }, at: '2026-10-16 10:00:00', notes: 'Different date of birth.' } }).reviewable, false);
});

test('HQ and the decision bar: what each status allows, and nothing the studio cannot decide', () => {
  const ready = { state: 'ready', with_hq: false, open: [] };
  assert.deepEqual(actionsFor('pending', ready).list, ['info', 'reject', 'approve', 'hq']);
  assert.deepEqual(actionsFor('rejected', ready).list, ['approve', 'hq']);
  assert.deepEqual(actionsFor('approved', ready).list, ['recheck']);
  assert.deepEqual(actionsFor('expired', ready).list, ['recheck']);
  assert.deepEqual(actionsFor('needs_info', ready).list, ['hq']);
  assert.match(actionsFor('needs_info', ready).held, /Waiting on the member/);
  assert.deepEqual(actionsFor('not_started', ready).list, []);
  const held = actionsFor('pending', { state: 'ready', with_hq: true, open: [{ reason: 'pep', raised_at: '2026-10-21 09:00:00' }] });
  assert.deepEqual(held.list, [], 'a case with HQ offers the studio no verdict');
  assert.match(held.held, /With HQ since 21 Oct 2026\. A Super Admin decides/);
  for (const hq of [{ state: 'unreadable' }, undefined]) {
    assert.equal(hqView(hq).withHq, null, 'a failed HQ read is never "not with HQ"');
    assert.deepEqual(actionsFor('pending', hq).list, ['hq'], 'no verdict while HQ cannot be read');
  }
  assert.deepEqual(hqView({ state: 'ready', with_hq: true, open: [{ reason: 'sanctions_match' }, { reason: 'admin' }] }).reasons, ['A possible sanctions match', 'Sent by an admin']);
});

test('the case: the seven checks, the documents, the history, and the member’s words as the Worker sends them', () => {
  const rows = checkRows({ provider_result: { checks: CHECKS_PASS } });
  assert.equal(rows.length, 7);
  assert.equal(checkSummary(rows), 'All 7 passed');
  assert.equal(checkSummary(checkRows({ provider_result: { checks: { ...CHECKS_PASS, age_ok: false, dob_valid: false } } })), '2 failed');
  assert.equal(checkSummary(checkRows({ provider_result: { checks: { provider_stub: true } } })), null, 'a provider stub carries no check: not "passed"');
  const docs = documentRows(CASE().documents, { document_uploaded: true });
  assert.deepEqual(docs.map((d) => [d.key, d.title, d.meta, d.removed]), [
    ['legacy', 'ID document', 'Sent with the form', null],
    ['doc-31', 'ID, front', 'image · 1.2 MB · 15 Oct 2026', null],
    ['doc-30', 'Proof of address', 'PDF · 88 KB · 1 Oct 2026', '2 Oct 2026'],
  ]);
  assert.deepEqual(eventLine(CASE().events[0]), { when: '18 Oct 2026 · 09:30', what: 'Assigned by Sam Second', note: null }, 'an assignment’s note is an id, never shown');
  assert.equal(eventLine(CASE().events[2]).note, 'Photo unreadable.');
  assert.equal(infoMessage(['photo', 'address']), 'A clearer photo of your ID and a proof of address dated in the last 3 months.');
  assert.equal(infoMessage(['other'], 'A bank statement.'), 'A bank statement.');
  assert.equal(infoMessage([]), '');
  // The preview is the Worker's own notice, word for word (kycCase.ts noticeFor).
  const worker = read('cloudflare-worker/src/services/kycCase.ts');
  for (const kind of ['needs_info', 'recheck', 'rejected']) {
    const template = noticePreview(kind, "${said || 'Not recorded'}");
    assert.ok(worker.includes(`body: \`${template}\``), `${kind}: ${template}`);
  }
  assert.equal(refusalWord({ status: 423, code: 'branch_suspended' }), 'A paused studio cannot decide checks. Nothing was changed.');
  assert.equal(refusalWord({ status: 423 }), 'A paused studio cannot decide checks. Nothing was changed.', 'a 423 with no code is the paused studio too');
  assert.equal(refusalWord({ code: 'step_up_required', status: 403 }), 'Your authenticator code was not confirmed, so nothing was decided.');
  assert.equal(viewerRefusal({ code: 'access_required' }).title, 'Your HQ staff sign-in is needed');
  assert.equal(viewerRefusal({ status: 404 }, { rejectedOn: '2 Oct 2026' }).line, 'This document was deleted when the check was rejected on 2 Oct 2026. The decision stays on record.');
});

// ---------------------------------------------------------------- mounted

function handler(over = {}) {
  return (url, options = {}) => {
    const method = options.method || 'GET';
    for (const [k, f] of Object.entries(over)) if (url.includes(k) && (!f.method || f.method === method)) return f.answer(url, options);
    if (url.includes('/api/kyc/admin/people')) return response(PEOPLE());
    if (url.includes('/api/kyc/admin/figures')) return response(FIGURES());
    if (/\/api\/kyc\/admin\/7\/case$/.test(url)) return response(CASE());
    if (/\/api\/kyc\/admin\/7\/documents\/31$/.test(url)) return response(null, 200, 'image/png');
    if (/\/api\/kyc\/admin\/\d+\/assign$/.test(url)) return response({ changed: true });
    if (/\/api\/kyc\/admin\/7\/(approve|reject|needs-info|recheck)$/.test(url)) return response({ kyc_status: 'approved', user_id: 7 });
    if (/\/api\/kyc\/admin\/7$/.test(url)) return response(RECORD());
    return response({});
  };
}

async function mounted(element, { handle = handler() } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, open: globalThis.open, alert: globalThis.alert, confirm: globalThis.confirm };
  const requests = [];
  const popups = [];
  globalThis.fetch = async (u, options = {}) => {
    requests.push({ url: String(u), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null, redirect: options.redirect });
    return handle(String(u), options);
  };
  globalThis.open = (...a) => { popups.push(['open', ...a]); return null; };
  globalThis.alert = (...a) => popups.push(['alert', ...a]);
  globalThis.confirm = (...a) => { popups.push(['confirm', ...a]); return true; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, element)));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props_ = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props_(n)['data-testid'] === id);
  return {
    requests, popups, flush, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props_(byId(id)), all: () => text(container),
    count: (id) => nodes().filter((n) => props_(n)['data-testid'] === id).length,
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onClick({ preventDefault() {} }); }); await flush(); },
    change: async (id, value) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onChange({ target: { value, checked: value } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const writes = (r) => r.requests.filter((q) => q.method !== 'GET');
const path = (q) => q.url.replace(/\?.*/, '');

test('mounted KYC1: the queue from part 1’s read, oldest first, with its figures, its counts, and no write', async () => {
  const r = await mounted(h(KycConsole, { me: ME, nowIso: NOW }));
  try {
    const q = r.requests.find((x) => x.url.includes('/kyc/admin/people'));
    assert.equal(q.url, '/api/kyc/admin/people?status=pending&sort=submitted&dir=asc&page=1&page_size=25');
    assert.ok(r.requests.some((x) => x.url === '/api/kyc/admin/figures'));
    assert.ok(!r.requests.some((x) => /\/kyc\/admin\/queue|\/kyc\/admin\/\d+$/.test(x.url)), 'no older queue read, and no record opened from the list');
    assert.equal(r.textOf('kyc-chip-pending'), 'Waiting14');
    assert.equal(r.textOf('kyc-chip-all'), 'All439');
    assert.match(r.textOf('kyc-tile-median'), /1\.8 days.*Last 90 days/);
    assert.match(r.textOf('kyc-chart-wait-lead'), /14 people are waiting\. 9 have waited a day or more/);
    assert.ok(r.count('kyc-chart-weeks-bars-unrecorded') >= 4, 'weeks with no recorded decision are dashed, never a zero bar');
    assert.equal(r.count('kyc-row'), 3);
    assert.equal(r.textOf('kyc-wait-7'), '6 days');
    assert.equal(r.textOf('kyc-wait-9'), 'Under a day');
    assert.match(r.all(), /Passport.*IN.*National ID.*ES.*Driving licence.*GB/s);
    assert.equal(r.textOf('kyc-flag-pep'), 'PEP');
    assert.match(r.all(), /Ada Admin.*Unassigned/s);
    assert.equal(r.props('kyc-person-8').href, '/admin/kyc/people/8', 'each name opens the case');
    assert.equal(r.textOf('kyc-page-line'), '1–17 of 17');
    assert.deepEqual(writes(r), [], 'reading People writes nothing');
    assert.ok(!r.has('kyc-act-approve') && !/\b(Approve|Reject)(?!d)/.test(r.all()), 'the queue decides nothing');
  } finally { await r.close(); }
});

test('mounted KYC2: a chip, the filters, the sort and a cleared chip each send the Worker’s query', async () => {
  const r = await mounted(h(KycConsole, { me: ME, nowIso: NOW }));
  try {
    await r.click('kyc-chip-all');
    assert.match(r.requests.at(-1).url, /status=all/);
    await r.click('kyc-filters-open');
    assert.ok(r.has('kyc-filters'));
    await r.change('kyc-f-flag-pep', true);
    await r.change('kyc-f-country', 'es');
    await r.click('kyc-filters-apply');
    assert.match(r.requests.at(-1).url, /status=all&country=ES&flag=pep&sort=submitted&dir=asc/);
    assert.equal(r.textOf('kyc-applied-flag').replace(/×.*/, '').trim(), 'Flags: PEP');
    await r.change('kyc-sort', 'name');
    assert.match(r.requests.at(-1).url, /sort=name&dir=asc/);
    await r.click('kyc-applied-flag');
    assert.doesNotMatch(r.requests.at(-1).url, /flag=/);
    assert.deepEqual(writes(r), []);
  } finally { await r.close(); }
});

test('mounted KYC11, KYC13: an empty list says so; a failed chart or list never blanks the other', async () => {
  const empty = await mounted(h(KycConsole, { me: ME, nowIso: NOW }), { handle: handler({ '/kyc/admin/people': { answer: () => response({ ...PEOPLE(), rows: [], total: 0 }) } }) });
  try { assert.match(empty.textOf('kyc-empty'), /Nothing is waiting\.New submissions appear here, oldest first\./); } finally { await empty.close(); }

  const figs = await mounted(h(KycConsole, { me: ME, nowIso: NOW }), { handle: handler({ '/kyc/admin/figures': { answer: () => response({ error: 'down' }, 503) } }) });
  try {
    assert.match(figs.textOf('kyc-chart-weeks-failed'), /Could not be read\.The decisions are still in the table\.Try again/);
    assert.equal(figs.count('kyc-row'), 3, 'the table still answers');
    assert.match(figs.textOf('kyc-tile-median'), /Not recorded/, 'a figure that did not answer is never a zero');
    assert.equal(figs.textOf('kyc-chip-pending'), 'Waiting14', 'the counts come from the queue read');
  } finally { await figs.close(); }

  const list = await mounted(h(KycConsole, { me: ME, nowIso: NOW }), { handle: handler({ '/kyc/admin/people': { answer: () => response({ error: 'down' }, 503) } }) });
  try {
    assert.match(list.all(), /The KYC queue could not be read\. This is not a sign that there are none\./);
    assert.ok(!list.has('kyc-empty'), 'a failed read is never "Nothing is waiting"');
    assert.match(list.textOf('kyc-chart-wait-lead'), /14 people are waiting/, 'the figures still answer');
  } finally { await list.close(); }

  const none = await mounted(h(KycConsole, { me: ME, nowIso: NOW }), { handle: handler({ '/kyc/admin/people': { answer: (u) => response(/flag=/.test(u) ? { ...PEOPLE(), rows: [], total: 0 } : PEOPLE()) } }) });
  try {
    await none.click('kyc-filters-open');
    await none.change('kyc-f-flag-auto_failed', true);
    await none.click('kyc-filters-apply');
    assert.match(none.textOf('kyc-empty'), /No cases match these filters\./);
    assert.ok(none.has('kyc-applied-flag'), 'the chips stay, so the filters can be cleared');
    await none.click('kyc-empty-clear');
    assert.doesNotMatch(none.requests.at(-1).url, /flag=/);
  } finally { await none.close(); }
});

test('mounted bulk bar: two picked people are assigned in the page, one write each, and nothing is approved in bulk', async () => {
  const r = await mounted(h(KycConsole, { me: ME, nowIso: NOW }));
  try {
    await r.change('kyc-pick-7', true);
    assert.match(r.textOf('kyc-bulk'), /^1 selected/, 'one picked row is enough for the bar');
    await r.change('kyc-pick-8', true);
    assert.match(r.textOf('kyc-bulk'), /^2 selectedAssign to…Clear.*no bulk approve/);
    await r.click('kyc-bulk-assign');
    assert.match(r.textOf('kyc-assign'), /Each of the 2 cases will be held by you\. Assigning decides nothing\./);
    assert.deepEqual(writes(r), [], 'opening the dialog changes nothing');
    await r.click('kyc-assign-go');
    assert.deepEqual(writes(r).map((w) => [w.method, path(w), w.body]), [
      ['PATCH', '/api/kyc/admin/7/assign', { assignee_id: 2 }],
      ['PATCH', '/api/kyc/admin/8/assign', { assignee_id: 2 }],
    ]);
    assert.ok(!r.has('kyc-assign'), 'the dialog closes once saved');
    assert.deepEqual(r.popups, []);
  } finally { await r.close(); }
});

test('mounted KYC3: the case from the record and the case read, with the decision bar and no pop-up', async () => {
  const r = await mounted(h(KycPersonCase, { id: '7', me: ME, nowIso: NOW }));
  try {
    assert.ok(r.requests.some((q) => q.url === '/api/kyc/admin/7') && r.requests.some((q) => q.url === '/api/kyc/admin/7/case'));
    assert.equal(r.textOf('kyc-case-status'), 'Waiting');
    assert.match(r.textOf('kyc-case-assignee'), /Assigned: Ada Admin · Reassign/);
    assert.match(r.textOf('kyc-case-rejected'), /Earlier rejection: Photo unreadable/);
    assert.match(r.textOf('kyc-case-facts'), /Legal nameDev Testcase.*Country of residenceIN.*ID typePassport.*Submitted15 Oct 2026 · 09:12.*ProviderTest provider/s);
    assert.match(r.textOf('kyc-case-facts'), /••••4821/, 'sensitive values stay masked until Show');
    assert.match(r.textOf('kyc-doc-doc-31'), /ID, front.*image · 1\.2 MB · 15 Oct 2026/);
    assert.match(r.textOf('kyc-doc-doc-30'), /Deleted on 2 Oct 2026/);
    assert.match(r.textOf('kyc-check-summary'), /All 7 passed · Passed: needs a person to decide\./);
    assert.match(r.textOf('kyc-screening-clear'), /No match/);
    assert.equal(r.textOf('kyc-pep'), 'Politically exposed: they said No');
    assert.equal(r.count('kyc-history-row'), 3);
    assert.match(r.textOf('kyc-case-history'), /Assigned by Sam Second.*Submitted.*Rejected by Sam Second · Photo unreadable\./s);
    assert.doesNotMatch(r.textOf('kyc-case-history'), /user_id=/);
    assert.match(r.textOf('kyc-note'), /Asked the member to retake the photo\./);
    for (const a of ['info', 'reject', 'approve', 'hq']) assert.ok(r.has(`kyc-act-${a}`), a);
    assert.ok(!r.has('kyc-act-recheck'));
    assert.equal(r.textOf('kyc-decision-line'), 'Approving clears them to sign agreements and invest.');
    assert.deepEqual(writes(r), []);
    assert.deepEqual(r.popups, []);
  } finally { await r.close(); }
});

test('mounted KYC5: Approve, Reject and Ask for information write from the dialog; a paused studio is said in it', async () => {
  const r = await mounted(h(KycPersonCase, { id: '7', me: ME, nowIso: NOW }));
  try {
    await r.click('kyc-act-approve');
    assert.match(r.textOf('kyc-approve'), /Approving clears them to sign agreements and invest\. A referrer, if any, is credited\..*Note · optional.*authenticator code/s);
    assert.equal(r.props('kyc-approve-go').disabled, false, 'a clear screening needs no note');
    assert.deepEqual(writes(r), []);
    await r.click('kyc-approve-go');
    assert.deepEqual(writes(r).map((w) => [w.method, path(w), w.body]), [['PATCH', '/api/kyc/admin/7/approve', {}]]);

    await r.click('kyc-act-reject');
    assert.equal(r.props('kyc-reject-go').disabled, true, 'a reason first');
    await r.change('kyc-reject-reason', 'Photo unreadable. The bottom of the page is blurred.');
    await r.click('kyc-reject-go');
    assert.deepEqual(writes(r).at(-1).body, { reason: 'Photo unreadable. The bottom of the page is blurred.' });
    assert.equal(path(writes(r).at(-1)), '/api/kyc/admin/7/reject');

    await r.click('kyc-act-info');
    await r.change('kyc-info-photo', true);
    await r.change('kyc-info-address', true);
    assert.equal(r.textOf('kyc-info-preview'), 'To finish your identity check, Axal compliance asks: A clearer photo of your ID and a proof of address dated in the last 3 months.. Open Identity verification to answer.');
    await r.click('kyc-info-go');
    assert.deepEqual([path(writes(r).at(-1)), writes(r).at(-1).body], ['/api/kyc/admin/7/needs-info', { message: 'A clearer photo of your ID and a proof of address dated in the last 3 months.' }]);
    assert.deepEqual(r.popups, []);
  } finally { await r.close(); }

  const paused = await mounted(h(KycPersonCase, { id: '7', me: ME, nowIso: NOW }), {
    handle: handler({ '/kyc/admin/7/approve': { method: 'PATCH', answer: () => response({ code: 'branch_suspended', detail: 'This branch is suspended.' }, 423) } }),
  });
  try {
    await paused.click('kyc-act-approve');
    await paused.click('kyc-approve-go');
    assert.equal(paused.textOf('kyc-approve-refused'), 'A paused studio cannot decide checks. Nothing was changed.');
    assert.ok(paused.has('kyc-approve'), 'the dialog stays open with the refusal');
    assert.deepEqual(paused.popups, []);
  } finally { await paused.close(); }
});

test('mounted KYC13b, KYC3b: an unreadable screening is never clear and asks for a note; a case with HQ has no verdict', async () => {
  const r = await mounted(h(KycPersonCase, { id: '7', me: ME, nowIso: NOW }), {
    handle: handler({ '/kyc/admin/7': { answer: (u) => (/\/7$/.test(u) ? response(RECORD({ screening: { state: 'unreadable', reason: 'lists_unavailable' } })) : handler()(u)) } }),
  });
  try {
    assert.match(r.textOf('kyc-screening-unreadable'), /Screening could not be read.*This is not a claim that there is no match\./s);
    assert.doesNotMatch(r.textOf('kyc-case-sanctions'), /No match/);
    await r.click('kyc-act-approve');
    assert.match(r.textOf('kyc-approve-screening'), /Approving needs a note saying why\./);
    assert.equal(r.props('kyc-approve-go').disabled, true, 'no approval without a note while screening cannot be read');
    await r.change('kyc-approve-note', 'Lists were down; the member is known to us.');
    await r.click('kyc-approve-go');
    assert.deepEqual(writes(r).at(-1).body, { note: 'Lists were down; the member is known to us.' });
  } finally { await r.close(); }

  const hq = await mounted(h(KycPersonCase, { id: '7', me: ME, nowIso: NOW }), {
    handle: handler({ '/kyc/admin/7': { answer: (u) => (/\/7$/.test(u) ? response(RECORD({
      kyc_data: { ...RECORD().kyc_data, pep_self_disclosed: true },
      hq: { state: 'ready', with_hq: true, open: [{ id: 1, reason: 'pep', raised_at: '2026-10-21 09:00:00' }], decided: [] },
    })) : handler()(u)) } }),
  });
  try {
    for (const a of ['approve', 'reject', 'info', 'hq']) assert.ok(!hq.has(`kyc-act-${a}`), `${a} is HQ's now`);
    assert.match(hq.textOf('kyc-case-hq'), /With HQ since 21 Oct 2026\. A Super Admin decides.*They said yes to politically exposed/);
    assert.equal(hq.textOf('kyc-pep'), 'Politically exposed: they said Yes. This case goes to HQ before approval.');
  } finally { await hq.close(); }

  const blind = await mounted(h(KycPersonCase, { id: '7', me: ME, nowIso: NOW }), {
    handle: handler({ '/kyc/admin/7': { answer: (u) => (/\/7$/.test(u) ? response(RECORD({ hq: { state: 'unreadable' } })) : handler()(u)) } }),
  });
  try {
    assert.ok(!blind.has('kyc-act-approve') && !blind.has('kyc-act-reject'), 'no verdict while HQ cannot be read');
    assert.match(blind.textOf('kyc-decision-line'), /Whether this case is with HQ could not be read/);
  } finally { await blind.close(); }
});

test('mounted KYC4, KYC4b: a document opens in the page through the API, watermarked, never in a new tab', async () => {
  const r = await mounted(h(KycPersonCase, { id: '7', me: ME, nowIso: NOW }));
  try {
    await r.click('kyc-doc-view-doc-31');
    const q = r.requests.find((x) => x.url.includes('/documents/31'));
    assert.equal(q.url, '/api/kyc/admin/7/documents/31');
    assert.equal(q.redirect, 'manual', 'an Access redirect is caught, never followed into the page');
    assert.ok(r.has('kyc-viewer-page'));
    assert.match(r.textOf('kyc-viewer-watermark'), /Viewed by Ada Admin · 21 Oct 2026 · 10:42/);
    assert.equal(r.textOf('kyc-viewer-foot'), 'This view is recorded. Download is not offered.');
    assert.deepEqual(r.popups, [], 'no new tab, no pop-up');
  } finally { await r.close(); }

  const removed = await mounted(h(KycPersonCase, { id: '7', me: ME, nowIso: NOW }));
  try {
    const before = removed.requests.length;
    await removed.click('kyc-doc-view-doc-30');
    assert.ok(removed.has('kyc-viewer-refused-deleted'));
    assert.match(removed.textOf('kyc-viewer'), /This document was deleted when the check was rejected on 2 Oct 2026/);
    assert.equal(removed.requests.length, before, 'a deleted document is never fetched');
  } finally { await removed.close(); }

  const access = await mounted(h(KycPersonCase, { id: '7', me: ME, nowIso: NOW }), {
    handle: handler({ '/documents/31': { answer: () => response({ error: 'cf_access_required' }, 403) } }),
  });
  try {
    await access.click('kyc-doc-view-doc-31');
    assert.match(access.textOf('kyc-viewer-refused-access'), /Your HQ staff sign-in is needed.*Sign in through your company access page, then try again\./);
    assert.ok(access.has('kyc-viewer-retry'));
  } finally { await access.close(); }
});

test('mounted: a failed case read leaves its blocks Unreadable and the record still drawn', async () => {
  const r = await mounted(h(KycPersonCase, { id: '7', me: ME, nowIso: NOW }), { handle: handler({ '/7/case': { answer: () => response({ error: 'down' }, 503) } }) });
  try {
    assert.match(r.textOf('kyc-case-facts'), /Dev Testcase/);
    for (const b of ['kyc-case-documents', 'kyc-case-history', 'kyc-case-notes']) assert.match(r.textOf(b), /could not be read/, b);
    assert.ok(!r.has('kyc-docs-none') && !r.has('kyc-history-none'), 'a failed read is never "nothing on file"');
    assert.match(r.textOf('kyc-case-assignee'), /Assignment could not be read/);
  } finally { await r.close(); }
});

// ---------------------------------------------------------------- guards

const FILES = [
  'frontend/src/pages/admin/consoles/KycConsole.jsx',
  'frontend/src/pages/admin/kyc/KycCase.jsx',
  'frontend/src/pages/admin/kyc/KycDialogs.jsx',
  'frontend/src/pages/admin/kyc/KycViewer.jsx',
  'frontend/src/pages/admin/kyc/KycTabs.jsx',
  'frontend/src/pages/admin/kyc/peopleModel.js',
];

test('no browser pop-up, no new tab and no stored token in the KYC files; every light hover has its dark pair', () => {
  for (const f of FILES) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(src, /\b(alert|confirm|prompt)\s*\(/, `${f}: a browser pop-up`);
    assert.doesNotMatch(src, /window\.open|target="_blank"/, `${f}: a new tab`);
    assert.doesNotMatch(src, /localStorage/, `${f}: a token read from local storage`);
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const cls = m[1] || m[2];
      if (/(^|\s)hover:(bg|text|border)-/.test(cls)) assert.match(cls, /dark:hover:/, `${f}: ${cls}`);
    }
  }
});

test('Approve and Reject keep step-up and the branch gate on the Worker', () => {
  const kyc = read('cloudflare-worker/src/routes/kyc.ts');
  for (const route of ['approve', 'reject', 'needs-info', 'recheck']) {
    const at = kyc.indexOf(`kyc.patch('/admin/:userId/${route}'`);
    assert.ok(at > 0, route);
    const body = kyc.slice(at, kyc.indexOf('\n});', at));
    assert.match(body, /requireBranchNotSuspended\(c\)[\s\S]*requireStepUp\(c\)/, `${route} keeps the branch gate and step-up`);
  }
  const dialogs = read('frontend/src/pages/admin/kyc/KycDialogs.jsx');
  assert.match(dialogs, /kycPeopleApi\.approve\(record\.id/);
  assert.match(dialogs, /api\.kycAdminReject\(record\.id/);
  assert.ok(!/__steppedUp|stepUp\(/.test(dialogs), 'step-up is request()’s, never bypassed by a dialog');
});

test('the wiring: People mounts the queue, the case is KycCase, the viewer reads through the client, and the docs', () => {
  assert.match(read('frontend/src/pages/admin/ConsolePages.jsx'), /<KycTabBody view=\{kycViewOf\(pathname\)\} people=\{<KycConsole \/>\} \/>/);
  assert.match(read('frontend/src/pages/admin/kyc/KycTabs.jsx'), /import \{ KycPersonCase, KycPersonView \} from '\.\/KycCase';/);
  const client = read('frontend/src/lib/api/kycPeople.js');
  assert.match(client, /documentBlob,/);
  assert.match(client, /rawRequestHeaders\('GET'\)/, 'the viewer sends request()’s headers');
  assert.match(client, /redirect: 'manual'/);
  assert.match(read('documentation/architecture/decisions/D1233.md'), /## D1233/);
  assert.match(read('documentation/architecture/ROUTE_MAP.md'), /D1233/);
  assert.match(read('frontend/src/pages/admin/kyc/README.md'), /KycCase\.jsx/);
});
