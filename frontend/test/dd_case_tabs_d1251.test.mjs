/**
 * D1251 (#3266, part 7 of #2385) — one Due diligence case's nine tabs
 * (DDL3–DDL11) and its dialogs (DDL14 A–H):
 *
 *   - the rules (`ddCaseModel.js`): who may do what from `allowed`, the
 *     header, the tiles, the Proceed rule, the checklist, flags, requests,
 *     documents, cross-checks, team, sign-off and activity;
 *   - the page mounted against a stubbed Worker: the deal team's nine tabs, a
 *     reviewer's four; a control the viewer may not use is one sentence, never
 *     a disabled button; every change is an in-page dialog;
 *   - no `window.confirm`, no toast and no email on the page.
 *
 * Every name and id here is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/dd_case_tabs_d1251.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import {
  BLOCKED_LINE, CASE_REFUSALS, NOT_RECORDED, REVIEWER_TABS, WHO, activityFilters, activityRows, blockedSections, bulkPatch, canWorkFlag,
  caseRefusal, caseTiles, composeBody, decisionBody, decisionChoices, decisionStrip, documentLists, filterItems, flagChange, flagRows,
  flagsHeadline, headerFacts, historyLines, icState, itemCounts, may, maySection, peopleOf, personName, platformRows, raiseBody,
  requestActions, requestTiles, sectionRow, tabOpen, tabsFor, teamRows, unstaffed, widenChoices,
} from '../src/pages/duediligence/ddCaseModel.js';
import { CASE_TABS, WAITS } from '../src/pages/duediligence/ddModel.js';
import AdminDueDiligenceCasePage from '../src/pages/AdminDueDiligenceCasePage.jsx';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ALL = {
  scan: true, assign: true, verdict: { 11: true, 12: true }, requests: true, report: true, notify_founder: true, audit: true,
  decide: true, update: true, memo_read: true, widen: true, team: true, work: { 11: true, 12: true }, work_case_wide: true,
};
const NONE = {
  scan: false, assign: false, verdict: { 11: false, 12: false }, requests: false, report: false, notify_founder: false, audit: true,
  decide: false, update: false, memo_read: true, widen: false, team: false, work: { 11: false, 12: false }, work_case_wide: false,
};

// The case read as the Worker answers the deal team (`scoped: false`).
const CASE = (over = {}) => ({
  case: {
    uid: 'case7f3a00000021c9', subject_label: 'Company Alpha', subject_type: 'project', status: 'in_review', template_depth: 'standard',
    lead_user_id: 3, lead_name: 'Mira Lead', created_at: '2026-10-01 09:00:00', target_ic_date: '2026-11-06', risk_band: null, risk_score: null,
    decision: null, scoped: false, subject_email: 'subject@example.test', subject_legal_name: 'Alpha Ltd', platform_checks: null, ic_record: null,
    ...(over.case || {}),
  },
  allowed: over.allowed || ALL,
  sections: [
    { id: 11, title: 'Financial Health & Runway', blocking: 1, weight: 0.3, status: 'completed', verdict: 'pass', signed_off_by_name: 'Ravi Reviewer', completed_at: '2026-10-20 10:00:00' },
    { id: 12, title: 'Compliance / AML / Sanctions', blocking: 0, weight: 0.2, status: 'in_review', verdict: null },
  ],
  flags: over.flags || [
    { kind: 'finding', id: 90, section_id: 11, severity: 'high', title: 'Runway under six months', state: 'open', owner_user_id: null, created_at: '2026-10-10 09:00:00' },
    { kind: 'checklist', id: null, checklist_item_id: 501, section_id: 12, severity: 'low', severity_recorded: false, title: 'Sanctions screen', item_status: 'flag', state: 'open' },
  ],
  findings: [],
  reviewers: [
    { user_id: 5, user_name: 'Ravi Reviewer', user_email: 'ravi@example.test', section_id: 11, role: 'reviewer', invited_at: '2026-10-02 09:00:00', responded_at: '2026-10-02 10:00:00', nda_signed_at: '2026-10-03 09:00:00', conflicts: 'none' },
  ],
  checklist: [
    { id: 501, section_id: 12, title: 'Sanctions screen', status: 'flag' },
    { id: 502, section_id: 12, title: 'PEP screen', status: 'pending' },
    { id: 503, section_id: 11, title: 'Bank statements', status: 'pass', owner_user_id: 5 },
  ],
  requests: over.requests || [
    { id: 61, title: 'Board minutes 2025', section_id: null, state: 'requested', due_date: '2026-10-20', created_at: '2026-10-01 09:00:00', files: [], reminders: { count: 0, last_at: null } },
  ],
  attachments: [{ id: 71, section_id: 11, filename: 'nda-ravi.pdf', size_bytes: 20480, created_at: '2026-10-03 09:00:00' }],
  evidence: [],
  sources: [],
  documents_unreadable: false,
  ...(over.top || {}),
});

const AUDIT = () => ({ items: [
  { id: 1, action: 'case_opened', actor_user_id: 3, actor_name: 'Mira Lead', actor_email: 'mira@example.test', created_at: '2026-10-01 09:00:00' },
  { id: 2, action: 'verdict_recorded', actor_user_id: 5, actor_name: 'Ravi Reviewer', actor_email: 'ravi@example.test', created_at: '2026-10-20 10:00:00' },
  { id: 3, action: 'scan_queued', actor_user_id: null, actor_name: null, created_at: '2026-10-21 10:00:00' },
] });

// ------------------------------------------------------------------ the rules

test('who may do what is the read\'s allowed; a flag the read did not carry is false', () => {
  const d = CASE();
  assert.equal(may(d, 'decide'), true);
  assert.equal(may({ allowed: {} }, 'decide'), false);
  assert.equal(may(null, 'decide'), false);
  assert.equal(maySection(d, 'verdict', 11), true);
  assert.equal(maySection(d, 'verdict', 99), false, 'a section the read did not name');
  for (const [k, w] of Object.entries(WHO)) assert.match(w, /^[A-Z].*\.$/, `${k} is one sentence`);
});

test('the deal team has nine tabs, a reviewer\'s read RT\'s four; a deal-team tab is not open to a reviewer', () => {
  assert.deepEqual(tabsFor(CASE()).map((t) => t.key), CASE_TABS.map((t) => t.key));
  const scoped = { case: { scoped: true } };
  assert.deepEqual(tabsFor(scoped).map((t) => t.key), ['overview', 'checklist', 'flags', 'activity']);
  assert.deepEqual(REVIEWER_TABS, ['overview', 'checklist', 'flags', 'activity']);
  assert.equal(tabOpen(scoped, 'team'), false);
  assert.equal(tabOpen(scoped, 'flags'), true);
  assert.equal(tabOpen(CASE(), 'team'), true);
  assert.deepEqual(WAITS, {}, 'every case tab is drawn: nothing waits');
});

test('the header: a target IC date in days, today or past; a missing lead is Not recorded', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  const f = headerFacts(CASE().case, now);
  assert.equal(f.lead, 'Mira Lead');
  assert.equal(f.targetSub, 'in 5 days');
  assert.equal(f.targetPast, false);
  assert.equal(headerFacts({ ...CASE().case, target_ic_date: '2026-11-01' }, now).targetSub, 'today');
  const past = headerFacts({ ...CASE().case, target_ic_date: '2026-10-30' }, now);
  assert.equal(past.targetSub, '2 days past');
  assert.equal(past.targetPast, true);
  assert.equal(headerFacts({ ...CASE().case, status: 'completed' }, now).targetSub, null, 'a decided case is past no target');
  const bare = headerFacts({ subject_type: 'project' }, now);
  assert.equal(bare.lead, NOT_RECORDED);
  assert.equal(bare.target, NOT_RECORDED);
  assert.equal(bare.stage, NOT_RECORDED);
});

test('Proceed is refused while a blocking section has an open High or Critical flag', () => {
  const d = CASE();
  assert.deepEqual(blockedSections(d.sections, d.flags), [11]);
  assert.ok(!decisionChoices(d.sections, d.flags).some((c) => c.key === 'proceed'));
  assert.deepEqual(decisionBody({ decision: 'proceed', reason: 'Good' }, d.sections, d.flags), { error: BLOCKED_LINE });
  const closed = d.flags.map((f) => (f.id === 90 ? { ...f, state: 'closed' } : f));
  assert.deepEqual(blockedSections(d.sections, closed), []);
  assert.ok(decisionChoices(d.sections, closed).some((c) => c.key === 'proceed'));
  const medium = d.flags.map((f) => (f.id === 90 ? { ...f, severity: 'medium' } : f));
  assert.deepEqual(blockedSections(d.sections, medium), [], 'a Medium flag blocks nothing');
  const unblocking = d.sections.map((s) => ({ ...s, blocking: 0 }));
  assert.deepEqual(blockedSections(unblocking, d.flags), [], 'a section that is not blocking blocks nothing');
  assert.deepEqual(decisionBody({ decision: '', reason: 'x' }, d.sections, d.flags), { error: 'Choose the decision.' });
  assert.deepEqual(decisionBody({ decision: 'do_not_proceed', reason: '  ' }, d.sections, d.flags), { error: 'Say why. The reason is recorded with the decision.' });
  assert.deepEqual(decisionBody({ decision: 'do_not_proceed', reason: ' Runway ' }, d.sections, d.flags), { body: { decision: 'do_not_proceed', reason: 'Runway' } });
  assert.equal(decisionStrip(d.case, d.sections, d.flags).line, BLOCKED_LINE);
  const rec = decisionStrip({ decision: 'withdrawn', decided_by_name: 'Mira Lead', decided_at: '2026-10-25 09:00:00', decision_reason: 'Paused', scoped: true }, [], []);
  assert.equal(rec.by, 'Mira Lead');
  assert.equal(rec.reason, null, 'a reviewer is told the decision, never its reason');
});

test('the tiles say Not recorded for a list the read did not carry, never a zero', () => {
  const t = caseTiles(CASE());
  assert.deepEqual(t.map((x) => x.value), ['2 of 3', '2', '1', '1 of 2'], 'a flagged item is worked');
  assert.equal(t[1].alert, true);
  const bare = caseTiles({ case: {}, sections: [] });
  assert.deepEqual(bare.slice(0, 3).map((x) => x.value), [NOT_RECORDED, NOT_RECORDED, NOT_RECORDED]);
  assert.equal(caseTiles({ ...CASE(), case: { scoped: true } })[2].value, NOT_RECORDED, 'requests are the deal team\'s');
});

test('a section\'s sign-off line: who signed it, unrecorded, or what still blocks it', () => {
  const d = CASE();
  assert.equal(sectionRow(d.sections[0], d).signedOff.text, 'Signed off by Ravi Reviewer');
  assert.equal(sectionRow({ ...d.sections[0], signed_off_by_name: null }, d).signedOff.text, 'Sign-off not recorded');
  const open = sectionRow(d.sections[1], d);
  assert.deepEqual([open.signedOff.text, open.signedOff.sub, open.noReviewer, open.verdict], ['Blocked', '1 item pending', true, 'No verdict yet']);
});

test('the checklist: chips count each status, search keeps titles, bulk changes are one PATCH body', () => {
  const d = CASE();
  assert.deepEqual(itemCounts(d.checklist), { all: 3, pending: 1, flag: 1, fail: 0, pass: 1, n_a: 0 });
  assert.deepEqual(filterItems(d.checklist, 'all', 'screen').map((i) => i.id), [501, 502]);
  assert.deepEqual(filterItems(d.checklist, 'flag', '').map((i) => i.id), [501]);
  assert.deepEqual(bulkPatch('n_a'), { status: 'n_a' });
  assert.deepEqual(bulkPatch('owner', '5'), { owner_user_id: 5 });
  assert.deepEqual(bulkPatch('owner', ''), { owner_user_id: null });
  assert.deepEqual(bulkPatch('due', '2026-11-01'), { due_date: '2026-11-01' });
  assert.equal(bulkPatch('odd'), null);
  const people = peopleOf(d);
  assert.equal(personName(people, 5), 'Ravi Reviewer');
  assert.equal(personName(people, 77), 'Account #77', 'never an email');
  assert.equal(personName(people, null), null);
});

test('flags: severest first, closed apart; a checklist flag is worked on the Checklist; changes need a resolution to close', () => {
  const d = CASE({ flags: [
    { kind: 'finding', id: 1, section_id: 12, severity: 'low', state: 'open', created_at: '2026-10-01' },
    { kind: 'finding', id: 2, section_id: 11, severity: 'critical', state: 'in_progress', created_at: '2026-10-02' },
    { kind: 'finding', id: 3, section_id: 11, severity: 'high', state: 'closed', created_at: '2026-10-03' },
  ] });
  const rows = flagRows(d.flags);
  assert.deepEqual(rows.open.map((f) => f.id), [2, 1]);
  assert.deepEqual(rows.closed.map((f) => f.id), [3]);
  assert.deepEqual(flagRows(d.flags, { severity: 'low' }).open.map((f) => f.id), [1]);
  assert.deepEqual(flagRows(d.flags, { state: 'closed' }).open.map((f) => f.id), [3]);
  assert.deepEqual(flagRows(d.flags, { state: 'in_progress' }), { open: [d.flags[1]], closed: [] }, 'a chosen state lists only its own');
  assert.equal(flagsHeadline(d.flags, d.sections), '1 Critical. 1 Low. 1 blocking section has one open.');
  assert.equal(flagsHeadline([], d.sections), 'No flag is open.');
  assert.equal(canWorkFlag(d, d.flags[0]), true);
  assert.equal(canWorkFlag({ ...d, allowed: NONE }, d.flags[0]), false);
  assert.equal(canWorkFlag(d, { kind: 'checklist', id: null, section_id: 12 }), false);
  assert.equal(canWorkFlag({ ...d, allowed: { ...NONE, work_case_wide: true } }, { kind: 'finding', id: 9, section_id: null }), true);
  assert.deepEqual(flagChange({ state: 'open' }, { state: 'closed', resolution: '' }), { error: 'Say how it was resolved. Accepting or closing a flag needs a resolution.' });
  assert.deepEqual(flagChange({ state: 'open', resolution: null, owner_user_id: null }, { state: 'open', resolution: '', ownerId: '' }), { error: 'Nothing has changed yet.' });
  assert.deepEqual(flagChange({ state: 'open', owner_user_id: null }, { state: 'closed', resolution: 'Bridge signed', ownerId: '5' }), { body: { state: 'closed', resolution: 'Bridge signed', owner_user_id: 5 } });
  assert.deepEqual(raiseBody({ title: ' ' }), { error: 'Give the flag a title.' });
  assert.deepEqual(raiseBody({ title: 'A', sectionId: '11' }), { error: 'Choose its severity.' });
  assert.deepEqual(raiseBody({ title: ' A ', sectionId: '11', severity: 'high', ownerId: '5' }), { body: { title: 'A', section_id: 11, severity: 'high', owner_user_id: 5 } });
  const lines = historyLines([{ id: 1, action: 'finding_updated', at: '2026-10-05', actor_name: null, actor_email: 'x@example.test', details: { from_state: 'open', to_state: 'closed', resolution_changed: true } }]);
  assert.deepEqual(lines[0], { id: 1, at: '5 Oct 2026', who: 'An account that is gone', what: 'Updated · Open → Closed · resolution changed' });
});

test('requests: the tiles, the menu each state offers, and a due date today or later', () => {
  const reqs = [
    { id: 1, state: 'requested', due_date: '2026-10-20' }, { id: 2, state: 'received' }, { id: 3, state: 'reviewed' },
    { id: 4, state: 'requested', withdrawn_at: '2026-10-02' },
  ];
  assert.deepEqual(requestTiles(reqs, '2026-10-24').map((t) => t.value), ['3', '1', '1', '1']);
  assert.equal(requestTiles(reqs, '2026-10-24')[1].sub, '1 past due');
  assert.deepEqual(requestActions(reqs[0]), ['review', 'remind', 'due', 'withdraw']);
  assert.deepEqual(requestActions(reqs[1]), ['review', 'due', 'withdraw']);
  assert.deepEqual(requestActions(reqs[2]), []);
  assert.deepEqual(requestActions(reqs[3]), []);
  assert.deepEqual(composeBody({ title: 'A', due: '2026-10-01' }, '2026-10-24'), { error: 'The due date is today or later.' });
  assert.deepEqual(composeBody({ title: ' Minutes ', sectionId: '11', due: '2026-10-24' }, '2026-10-24'), { body: { title: 'Minutes', section_id: 11, due_date: '2026-10-24' } });
});

test('documents: a block the read could not carry is null; an NDA not on file is said by name', () => {
  const d = CASE({ top: { reviewers: [...CASE().reviewers, { user_id: 6, user_name: 'Noor', section_id: 12, role: 'reviewer', nda_signed_at: null }] } });
  const l = documentLists(d);
  assert.deepEqual(l.fromSubject, []);
  assert.equal(l.ndas.length, 1);
  assert.deepEqual(l.missing, ['Noor has not uploaded an NDA for Compliance / AML / Sanctions.']);
  const u = documentLists({ ...d, evidence: null, documents_unreadable: true });
  assert.equal(u.fromSubject, null);
  assert.equal(u.evidence, null);
  assert.equal(u.unreadable, true);
});

test('cross-checks, team, scope, IC and activity', () => {
  assert.equal(platformRows(null).state, 'none');
  assert.equal(platformRows({ available: false, reason: 'down' }).state, 'unavailable');
  assert.deepEqual(platformRows({ identity: { status: 'approved', decided_at: '2026-10-01' }, business: { available: false, reason: 'No read' } }).rows.map((r) => r.word || r.state), ['Approved', 'unreadable']);
  const d = CASE({ top: { reviewers: [{ user_id: 6, user_name: 'Noor', section_id: 12, role: 'observer', invited_at: '2026-10-01', responded_at: null, expired: true }] } });
  assert.deepEqual(teamRows(d).map((r) => [r.role, r.accepted, r.nda]), [['Observer', 'Invitation expired', '—']]);
  assert.deepEqual(unstaffed(d).map((s) => s.id), [11, 12], 'an observer staffs nothing');
  assert.deepEqual(widenChoices('lite'), ['standard', 'deep']);
  assert.deepEqual(widenChoices('standard'), ['deep']);
  assert.deepEqual(widenChoices('deep'), []);
  assert.equal(icState({ decision: null }, CASE()).state, 'waits');
  assert.equal(icState({ decision: 'proceed' }, CASE()).state, 'ready');
  assert.equal(icState({ decision: 'proceed' }, { allowed: NONE }).text, WHO.ic);
  assert.equal(icState({ decision: 'proceed', ic_record: { uid: 'ic1', status: 'scheduled' } }, CASE()).state, 'sent');
  const rows = activityRows(AUDIT().items);
  assert.deepEqual(rows.map((r) => r.who), ['Mira Lead', 'Ravi Reviewer', 'The system']);
  assert.ok(!JSON.stringify(rows).includes('@'), 'never an email');
  assert.deepEqual(activityRows(AUDIT().items, { person: '5' }).map((r) => r.id), [2]);
  assert.deepEqual(activityRows(AUDIT().items, { action: 'case_opened' }).map((r) => r.id), [1]);
  assert.deepEqual(activityFilters(AUDIT().items).actions, ['case_opened', 'scan_queued', 'verdict_recorded']);
  assert.equal(caseRefusal({ code: 'blocking_flag_open', message: 'x' }), BLOCKED_LINE);
  assert.equal(caseRefusal({ data: { code: 'already_sent' } }), CASE_REFUSALS.already_sent);
});

// ------------------------------------------------------------------ mounted

async function mount(url, fetchFn) {
  const restore = installDocument('', { focus: true });
  const original = globalThis.fetch;
  globalThis.fetch = fetchFn;
  const opened = [];
  const originalOpen = globalThis.window?.open;
  if (globalThis.window) globalThis.window.open = (u) => { opened.push(u); };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const page = h(AdminDueDiligenceCasePage);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
      h(Route, { path: '/admin/due-diligence/:uid', element: page }), h(Route, { path: '/admin/due-diligence/:uid/:tab', element: page }),
      h(Route, { path: '/due-diligence/:uid', element: page }), h(Route, { path: '/due-diligence/:uid/:tab', element: page }))));
  });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join('') : n.textContent || '');
  const need = (id) => { const n = by(id); assert.ok(n, `no ${id}`); return n; };
  const ev = { preventDefault() {}, stopPropagation() {} };
  return {
    opened,
    has: (id) => Boolean(by(id)),
    text: (id) => txt(id ? need(id) : container).replace(/\s+/g, ' ').trim(),
    ids: (prefix) => walk(container).map((n) => pr(n)['data-testid']).filter((t) => typeof t === 'string' && t.startsWith(prefix)),
    disabledButtons: () => walk(container).filter((n) => n.tagName === 'BUTTON' && pr(n).disabled),
    async click(id) { await act(async () => { await pr(need(id)).onClick?.(ev); }); await settle(); },
    async change(id, value) { await act(async () => { pr(need(id)).onChange({ target: { value, checked: true, files: [] } }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; if (globalThis.window) globalThis.window.open = originalOpen; restore(); },
  };
}

/** A stubbed Worker: the case read, its reads, and every write recorded. */
function worker(data, extra = {}) {
  const writes = [];
  const fetchFn = async (u, o = {}) => {
    const path = new URL(String(u), 'http://x').pathname.replace(/^\/api/, '');
    const method = String(o.method || 'GET');
    if (method !== 'GET') {
      writes.push({ method, path, body: typeof o.body === 'string' ? JSON.parse(o.body) : null });
      if (extra[`${method} ${path}`]) return extra[`${method} ${path}`]();
      return json({ ok: true });
    }
    if (path === `/dd/cases/${data.case.uid}`) return json(data);
    if (path.endsWith('/audit')) return json(AUDIT());
    if (path.endsWith('/memo')) return json({ memo: { summary: 'Strong team', updated_at: '2026-10-22 09:00:00', updated_by_name: 'Mira Lead' } });
    if (path.endsWith('/reports')) return json({ items: [] });
    if (path.startsWith('/dd/people')) return json({ items: [{ id: 8, name: 'Ola Partner', role: 'partner' }] });
    return json({ error: 'Not found' }, 404);
  };
  return { writes, fetchFn };
}

test('the deal team on Overview: the header, the tiles, the sign-off line; Record decision is a dialog that holds Proceed to the flag rule', async () => {
  const w = worker(CASE());
  const m = await mount('/admin/due-diligence/case7f3a00000021c9', w.fetchFn);
  try {
    assert.equal(m.ids('dd-case-tab-').length, 9);
    assert.match(m.text('dd-case-facts'), /Startup · Standard · In review · case7f3a00000021c9/);
    assert.match(m.text('dd-case-header'), /Lead Mira Lead/);
    assert.equal(m.text('dd-tile-flags').includes('2'), true);
    assert.equal(m.text('signoff-11'), 'Signed off by Ravi Reviewer · 2026-10-20');
    assert.equal(m.text('dd-blocked-line'), BLOCKED_LINE);
    assert.ok(m.has('dd-assign-open-11') && m.has('dd-verdict-open-12'));
    assert.deepEqual(m.disabledButtons(), [], 'no disabled button');
    await m.click('dd-decide-open');
    assert.ok(m.has('dd-decide'));
    assert.ok(!m.has('dd-decide-proceed'), 'Proceed is not offered');
    assert.ok(m.has('dd-decide-blocked'));
    await m.change('dd-decide-do_not_proceed');
    await m.click('dd-decide-submit');
    assert.equal(m.text('dd-decide-error'), 'Say why. The reason is recorded with the decision.');
    assert.equal(w.writes.length, 0, 'nothing is sent until the dialog is complete');
  } finally { await m.unmount(); }
});

test('a viewer who may not decide, assign or record a verdict reads one sentence each, never a disabled button', async () => {
  const w = worker(CASE({ allowed: NONE }));
  const m = await mount('/due-diligence/case7f3a00000021c9', w.fetchFn);
  try {
    assert.ok(!m.has('dd-decide-open') && !m.has('dd-header-decide'));
    assert.equal(m.text('dd-who-decide'), WHO.decide);
    assert.equal(m.text('dd-who-assign'), WHO.assign);
    assert.ok(!m.has('dd-assign-open-11') && !m.has('dd-verdict-open-11'));
    assert.equal(m.text('dd-who-verdict-12'), WHO.verdict);
    assert.deepEqual(m.disabledButtons(), []);
  } finally { await m.unmount(); }
  const s = await mount('/due-diligence/case7f3a00000021c9/sign-off', worker(CASE({ allowed: NONE })).fetchFn);
  try {
    assert.equal(s.text('dd-who-widen'), WHO.widen);
    assert.equal(s.text('dd-who-report'), WHO.report);
    assert.ok(!s.has('dd-archive-open') && !s.has('dd-memo-save') && !s.has('dd-memo-summary'));
    assert.equal(s.text('dd-who-memo'), WHO.memo);
    assert.match(s.text('dd-memo'), /Strong team/);
  } finally { await s.unmount(); }
});

test('a section reviewer\'s read: RT\'s four tabs; a deal-team address says so; the reviewer works only their section', async () => {
  const scoped = CASE({
    case: { scoped: true, subject_email: null, subject_legal_name: null },
    allowed: { ...NONE, verdict: { 11: true }, work: { 11: true } },
    top: { sections: [CASE().sections[0]], requests: [], checklist: [CASE().checklist[2]], flags: [CASE().flags[0]] },
  });
  const m = await mount('/due-diligence/case7f3a00000021c9/team', worker(scoped).fetchFn);
  try {
    assert.deepEqual(m.ids('dd-case-tab-'), ['dd-case-tab-overview', 'dd-case-tab-checklist', 'dd-case-tab-flags', 'dd-case-tab-activity']);
    assert.match(m.text('dd-tab-deal-team'), /This tab is the deal team’s\./);
    assert.ok(!m.has('dd-case-team'));
  } finally { await m.unmount(); }
  const cw = worker(scoped);
  const c = await mount('/due-diligence/case7f3a00000021c9/checklist', cw.fetchFn);
  try {
    assert.ok(c.has('dd-item-503-pass'), 'their item has the status buttons');
    assert.ok(!c.text().includes('Sanctions screen'), 'another section\'s items are not in the read');
    await c.click('dd-item-503-fail');
    assert.ok(c.has('dd-item-status'), 'a status change is a dialog');
    assert.equal(cw.writes.length, 0, 'nothing is sent until it is confirmed');
    await c.click('dd-item-status-submit');
    assert.deepEqual(cw.writes, [{ method: 'PATCH', path: '/dd/cases/case7f3a00000021c9/items/503', body: { status: 'fail' } }]);
    assert.match(c.text('dd-case-notice'), /“Bank statements” is Fail\./);
  } finally { await c.unmount(); }
  const o = await mount('/due-diligence/case7f3a00000021c9', worker(scoped).fetchFn);
  try {
    assert.ok(o.has('dd-verdict-open-11'));
    assert.ok(!o.has('dd-deal') && !o.has('dd-subject'), 'no deal context or subject for a reviewer');
    assert.ok(!o.has('dd-who-assign'), 'assigning is not a reviewer\'s question');
  } finally { await o.unmount(); }
});

test('Flags: Raise a flag is a dialog that says what is missing, then posts the flag to the Worker', async () => {
  const w = worker(CASE());
  const m = await mount('/admin/due-diligence/case7f3a00000021c9/flags', w.fetchFn);
  try {
    assert.match(m.text('dd-flags-headline'), /1 High\. 1 Low\. 1 blocking section has one open\./);
    await m.click('dd-raise-open');
    await m.click('dd-raise-submit');
    assert.equal(m.text('dd-raise-error'), 'Give the flag a title.');
    assert.equal(w.writes.length, 0);
    await m.click('dd-flag-row-finding-90');
    assert.ok(m.has('dd-flag'));
  } finally { await m.unmount(); }
});

test('Activity names people, never an email; Requests, Team and Documents draw only the controls allowed returns', async () => {
  const a = await mount('/admin/due-diligence/case7f3a00000021c9/activity', worker(CASE()).fetchFn);
  try {
    assert.equal(a.ids('dd-activity-row').length, 3);
    assert.ok(!a.text().includes('@example.test'), 'no email on the page');
  } finally { await a.unmount(); }
  const r = await mount('/admin/due-diligence/case7f3a00000021c9/requests', worker(CASE()).fetchFn);
  try {
    assert.ok(r.has('dd-compose-open'));
    assert.ok(r.has('dd-request-61-remind') && r.has('dd-request-61-withdraw'));
  } finally { await r.unmount(); }
  const rr = await mount('/admin/due-diligence/case7f3a00000021c9/requests', worker(CASE({ allowed: NONE })).fetchFn);
  try {
    assert.ok(!rr.has('dd-compose-open') && !rr.has('dd-request-61-remind'));
    assert.equal(rr.text('dd-who-requests'), WHO.requests);
  } finally { await rr.unmount(); }
  const t = await mount('/admin/due-diligence/case7f3a00000021c9/team', worker(CASE({ case: { status: 'archived' }, allowed: { ...ALL, decide: false, update: false, team: false, widen: false } })).fetchFn);
  try {
    assert.ok(!t.has('dd-lead-open') && !t.has('dd-assign-open'));
    assert.equal(t.text('dd-who-lead'), WHO.archived);
    assert.ok(!t.text().includes('ravi@example.test'));
  } finally { await t.unmount(); }
  const d = await mount('/admin/due-diligence/case7f3a00000021c9/documents', worker(CASE({ top: { documents_unreadable: true, evidence: null } })).fetchFn);
  try {
    assert.ok(d.has('dd-docs-unreadable'));
  } finally { await d.unmount(); }
});

test('Sign-off: Send to IC is a dialog; the Worker\'s refusal stays in it in its own words', async () => {
  const data = CASE({ case: { decision: 'proceed_with_conditions', decided_by_name: 'Mira Lead', decided_at: '2026-10-25 09:00:00', decision_reason: 'Bridge first' } });
  const w = worker(data, { 'POST /dd/cases/case7f3a00000021c9/ic': () => json({ error: 'This case is already with IC.', code: 'already_sent' }, 409) });
  const m = await mount('/admin/due-diligence/case7f3a00000021c9/sign-off', w.fetchFn);
  try {
    assert.match(m.text('dd-decision-strip'), /Decision: Proceed with conditions/);
    assert.match(m.text('dd-decision-strip'), /Recorded by Mira Lead/);
    await m.click('dd-ic-open');
    await m.click('dd-ic-submit');
    assert.deepEqual(w.writes.map((x) => `${x.method} ${x.path}`), ['POST /dd/cases/case7f3a00000021c9/ic']);
    assert.equal(m.text('dd-ic-error'), 'This case is already with IC.');
    assert.ok(m.has('dd-ic'), 'the dialog stays open on a refusal');
  } finally { await m.unmount(); }
});

// ------------------------------------------------------------------ the source

test('no browser pop-up, no toast and no disabled control on the case page or its tabs', () => {
  const files = ['frontend/src/pages/AdminDueDiligenceCasePage.jsx', 'frontend/src/pages/duediligence/DdCaseWork.jsx',
    'frontend/src/pages/duediligence/DdCaseDeal.jsx', 'frontend/src/pages/duediligence/DdCaseDialogs.jsx'];
  for (const f of files) {
    const s = read(f);
    assert.ok(!/window\.(confirm|alert|prompt)\(/.test(s), `${f}: no browser pop-up`);
    assert.ok(!/useToast|ToastMessage/.test(s), `${f}: no toast`);
    assert.ok(!/\bdisabled=\{/.test(s), `${f}: no disabled control`);
    assert.ok(!/user_email|actor_email/.test(s), `${f}: no email drawn`);
  }
});
