/**
 * D1252 (#3267, part 8 of #2385) — Due diligence's reviewer and subject views:
 *
 *   - My reviews (DDL12a) on both bases, a table above md and cards below;
 *   - the reviewer's banner and steps (DDL12b): the NDA, conflicts, the
 *     checklist; a deal team's read draws none of it;
 *   - the subject's requests (DDL15): due dates, late only while waiting, and
 *     an answer by a file from their own data room; never the case;
 *   - the "Diligence" sidebar row only for a partner, investor or advisor who
 *     leads or reviews a case (#2385 owner question 1);
 *   - 44px targets on a phone (DDL18).
 *
 * Every name and id here is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/dd_reviewer_views_d1252.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import {
  answerBody, dueOf, fileChoices, fmtDay, myReviewRows, myReviewsView, requestChips, reviewerView, shortId,
} from '../src/pages/duediligence/ddReviewModel.js';
import { DILIGENCE_ROW, SIDEBAR_GROUPS, withDiligenceRow } from '../src/sidebarConfig.js';
import { resetDiligenceInvolvement, useDiligenceInvolvement } from '../src/pages/duediligence/useDiligenceInvolvement.js';
import DdMyReviews from '../src/pages/duediligence/DdMyReviews.jsx';
import DdReviewerPanel from '../src/pages/duediligence/DdReviewer.jsx';
import DueDiligenceRequestsPage from '../src/pages/DueDiligenceRequestsPage.jsx';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const REVIEWS = () => ({ items: [
  { case_uid: 'case7f3a00000021c9', subject_label: 'Company Alpha', subject_type: 'project', case_status: 'in_review', section_id: 11, section_title: 'Financial Health & Runway', verdict: null, role: 'reviewer', invited_at: '2026-10-16 09:00:00', responded_at: '2026-10-16 10:00:00', nda_signed_at: '2026-10-17 09:00:00', conflicts: null, invite_expired: false, items_pending: 4 },
  { case_uid: 'case9c40', subject_label: 'Company Gamma', subject_type: 'project', case_status: 'open', section_id: 12, section_title: 'Compliance / AML / Sanctions', verdict: 'warn', role: 'observer', invited_at: '2026-11-02 09:00:00', responded_at: null, nda_signed_at: null, conflicts: 'none', invite_expired: true, items_pending: null },
] });

// The case read as the Worker answers a section reviewer (`scoped: true`): only their section.
const SCOPED = (over = {}) => ({
  case: { uid: 'case7f3a00000021c9', subject_label: 'Company Alpha', subject_type: 'project', scoped: true, subject_email: null, subject_legal_name: null },
  sections: [{ id: 11, title: 'Financial Health & Runway', verdict: null }],
  reviewers: [
    { user_id: 5, section_id: 11, role: 'reviewer', nda_signed_at: '2026-10-17 09:00:00', conflicts: null },
  ],
  checklist: [
    { section_id: 11, status: 'pending' }, { section_id: 11, status: 'pending' }, { section_id: 11, status: 'pass' },
  ],
  ...over,
});

const REQUESTS = () => ({ items: [
  { id: 61, title: 'Board minutes 2025', details: 'All meetings.', state: 'requested', due_date: '2026-10-20', created_at: '2026-10-01 09:00:00', responded_at: null, response_note: null, response_url: null, subject_type: 'project', subject_label: 'Roomco', project_uid: 'p-room', file_names: [] },
  { id: 62, title: 'IP assignment', details: null, state: 'received', due_date: '2026-10-01', created_at: '2026-09-20 09:00:00', responded_at: '2026-09-25 09:00:00', response_note: 'Attached', response_url: null, subject_type: 'project', subject_label: 'Roomco', project_uid: 'p-room', file_names: ['Assignment.pdf'] },
  { id: 63, title: 'Your references', details: null, state: 'requested', due_date: null, created_at: '2026-10-02 09:00:00', subject_type: 'founder', subject_label: 'Ada', project_uid: null, file_names: [] },
] });

async function mount(el, { url = '/', fetchFn } = {}) {
  const restore = installDocument('', { focus: true });
  const original = globalThis.fetch;
  if (fetchFn) globalThis.fetch = fetchFn;
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: '*', element: el })))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join('') : n.textContent || '');
  const need = (id) => { const n = by(id); assert.ok(n, `no ${id}`); return n; };
  const ev = { preventDefault() {}, stopPropagation() {} };
  return {
    has: (id) => Boolean(by(id)), props: (id) => pr(need(id)), text: (id) => txt(id ? need(id) : container).replace(/\s+/g, ' ').trim(),
    async click(id) { await act(async () => { await pr(need(id)).onClick?.(ev); }); await settle(); },
    async change(id, value, files) { await act(async () => { pr(need(id)).onChange({ target: { value, files, checked: true } }); }); await settle(); },
    async submit(id) { await act(async () => { await pr(need(id)).onSubmit?.(ev); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; restore(); },
  };
}

// ------------------------------------------------------------------ the model

test('dates are written out; a case id is short; a non-date is null', () => {
  assert.equal(fmtDay('2026-10-21'), '21 Oct 2026');
  assert.equal(fmtDay('2026-10-21 09:00:00'), '21 Oct 2026');
  assert.equal(fmtDay(null), null);
  assert.equal(fmtDay('soon'), null);
  assert.equal(shortId('case7f3a00000021c9'), 'case…21c9');
  assert.equal(shortId('case9c40'), 'case9c40');
});

test('My reviews: each section on the caller\'s base, its NDA, items pending (never 0 for a gap), verdict, observer and an expired invitation', () => {
  const rows = myReviewRows(REVIEWS().items, '/due-diligence');
  assert.equal(rows[0].href, '/due-diligence/case7f3a00000021c9/overview?section=11');
  assert.deepEqual([rows[0].nda, rows[0].pending, rows[0].verdict, rows[0].invited], ['On file', 4, 'No verdict yet', '16 Oct 2026']);
  assert.deepEqual([rows[1].nda, rows[1].pending, rows[1].verdict, rows[1].observer, rows[1].expired], ['NDA missing', null, 'Warn', true, true]);
  assert.equal(myReviewRows(REVIEWS().items, '/admin/due-diligence')[0].href, '/admin/due-diligence/case7f3a00000021c9/overview?section=11');
  assert.equal(myReviewsView({ status: 'ready', data: { items: [] } }, '/due-diligence').status, 'empty');
  assert.equal(myReviewsView({ status: 'ready', data: {} }, '/due-diligence').status, 'unreadable', 'no items is never "none"');
  assert.equal(myReviewsView({ status: 'loading' }).status, 'loading');
});

test('the reviewer\'s view: only on a scoped read, with the banner and the three steps; the current step is the first not done', () => {
  assert.equal(reviewerView({ ...SCOPED(), case: { ...SCOPED().case, scoped: false } }, 5), null, 'the deal team draws none of it');
  const v = reviewerView(SCOPED(), 5);
  assert.equal(v.banner, 'You’re reviewing Financial Health & Runway as an invited expert. You see your section only.');
  const [c] = v.cards;
  assert.deepEqual(c.steps.map((s) => [s.key, s.done]), [['nda', true], ['conflicts', false], ['work', false]]);
  assert.equal(c.steps[0].sub, 'Signed 17 Oct 2026');
  assert.equal(c.steps[1].sub, 'Tell the case lead about any interest in Company Alpha.');
  assert.equal(c.steps[2].sub, '2 of 3 items still pending');
  assert.equal(c.current, 'conflicts');
  assert.equal(v.hidden, 'Legal name and email: hidden from section reviewers.');
  assert.equal(reviewerView(SCOPED(), 99).cards.length, 0, 'another person\'s row is not this viewer\'s step');
  const noNda = reviewerView(SCOPED({ reviewers: [{ user_id: 5, section_id: 11, role: 'reviewer', nda_signed_at: null, conflicts: 'none' }] }), 5);
  assert.equal(noNda.cards[0].current, 'nda', 'the NDA step comes first');
  const obs = reviewerView(SCOPED({ reviewers: [{ user_id: 5, section_id: 11, role: 'observer', nda_signed_at: '2026-10-17', conflicts: 'none' }] }), 5);
  assert.match(obs.banner, /as an observer/);
  assert.equal(obs.cards[0].steps[2].title, 'Read the section', 'an observer never works the checklist');
  const decided = reviewerView(SCOPED({ sections: [{ id: 11, title: 'Financial Health & Runway', verdict: 'pass' }], reviewers: [{ user_id: 5, section_id: 11, role: 'reviewer', nda_signed_at: '2026-10-17', conflicts: 'declared' }] }), 5);
  assert.equal(decided.cards[0].current, null);
  assert.equal(decided.cards[0].steps[2].sub, 'Verdict recorded: Pass');
});

test('a request\'s due date: late only while it waits on the subject and the day has passed; no due date is never late', () => {
  const [r61, r62, r63] = REQUESTS().items;
  assert.deepEqual(dueOf(r61, '2026-10-24'), { text: 'Due 20 Oct 2026', late: '4 days late' });
  assert.deepEqual(dueOf(r61, '2026-10-21'), { text: 'Due 20 Oct 2026', late: '1 day late' });
  assert.deepEqual(dueOf(r61, '2026-10-20'), { text: 'Due 20 Oct 2026', late: null }, 'due today is not late');
  assert.deepEqual(dueOf(r62, '2026-10-24'), { text: 'Due 1 Oct 2026', late: null }, 'an answered request is not late');
  assert.deepEqual(dueOf(r63, '2026-10-24'), { text: 'No due date', late: null });
  assert.deepEqual(requestChips(REQUESTS().items).map((c) => [c.label, c.n]), [['Waiting on you', 2], ['Sent', 1], ['Reviewed', 0]]);
});

test('the answer: a note, a link, a data-room file, or any of them; a link is http(s)', () => {
  assert.deepEqual(answerBody({}), { error: 'Write an answer, paste a link or pick a file.' });
  assert.deepEqual(answerBody({ url: 'ftp://x' }), { error: 'A link starts with https:// or http://.' });
  assert.deepEqual(answerBody({ fileUid: 'f-deck' }), { body: { file_uid: 'f-deck' } });
  assert.deepEqual(answerBody({ note: ' Here ', url: 'https://x.test/a' }), { body: { response_note: 'Here', response_url: 'https://x.test/a' } });
  assert.deepEqual(fileChoices({ files: [{ uid: 'b', name: 'Burn.pdf' }, { uid: 'a', name: 'Assignment.pdf' }, { name: 'no uid' }] }).map((f) => f.uid), ['a', 'b']);
  assert.deepEqual(fileChoices({}), []);
});

// ------------------------------------------------------------------ the sidebar row (owner question 1)

test('"Diligence" is added only for a partner, investor or advisor who leads or reviews a case, after Research, never twice', () => {
  for (const role of ['partner', 'investor', 'advisor']) {
    const groups = SIDEBAR_GROUPS[role];
    assert.ok(!groups.some((g) => g.items.some((i) => i.to === '/due-diligence')), `${role} has no row of its own`);
    const out = withDiligenceRow(groups, role, true);
    const items = out.flatMap((g) => g.items);
    const at = items.findIndex((i) => i.to === '/due-diligence');
    assert.ok(at > 0, role);
    assert.equal(items[at - 1].label, 'Research', `${role}: after Research`);
    assert.equal(items[at].label, 'Diligence');
    assert.equal(withDiligenceRow(out, role, true).flatMap((g) => g.items).filter((i) => i.to === '/due-diligence').length, 1, 'never twice');
    assert.equal(withDiligenceRow(groups, role, false), groups, `${role} not on a case: no row`);
    assert.equal(withDiligenceRow(groups, role, undefined), groups, 'unread is no row');
  }
  for (const role of ['founder', 'admin', 'super_admin']) {
    const groups = SIDEBAR_GROUPS[role] || [];
    assert.equal(withDiligenceRow(groups, role, true), groups, `${role} never gets the row`);
  }
  assert.deepEqual(DILIGENCE_ROW.match, ['/due-diligence']);
});

function Probe({ user, role, load, out }) { out.value = useDiligenceInvolvement(user, role, load); return null; }

test('the row\'s read: one case on the caller\'s list is a yes; a failed read is no row; a founder or an admin makes no read', async () => {
  resetDiligenceInvolvement();
  const calls = [];
  const yes = { value: null };
  let m = await mount(h(Probe, { user: { id: 3 }, role: 'investor', load: async () => { calls.push('investor'); return { items: [{ uid: 'c' }], total: 1 }; }, out: yes }));
  assert.equal(yes.value, true);
  await m.unmount();
  const no = { value: null };
  m = await mount(h(Probe, { user: { id: 4 }, role: 'advisor', load: async () => { calls.push('advisor'); return { items: [], total: 0 }; }, out: no }));
  assert.equal(no.value, false);
  await m.unmount();
  const failed = { value: null };
  m = await mount(h(Probe, { user: { id: 6 }, role: 'partner', load: async () => { calls.push('partner'); throw new Error('down'); }, out: failed }));
  assert.equal(failed.value, false, 'a failed read draws no row');
  await m.unmount();
  for (const role of ['founder', 'admin']) {
    const out = { value: null };
    m = await mount(h(Probe, { user: { id: 7 }, role, load: async () => { calls.push(role); return { total: 1 }; }, out }));
    assert.equal(out.value, false);
    await m.unmount();
  }
  assert.deepEqual(calls, ['investor', 'advisor', 'partner'], 'no read for a founder or an admin');
  const again = { value: null };
  m = await mount(h(Probe, { user: { id: 3 }, role: 'investor', load: async () => { calls.push('again'); return { total: 1 }; }, out: again }));
  assert.equal(again.value, true);
  assert.ok(!calls.includes('again'), 'read once per account');
  await m.unmount();
  assert.ok(read('frontend/src/App.jsx').includes("const sidebarGroups = withDiligenceRow(getSidebarGroups(activeRole || 'founder', primaryPersonaId, user, hqView), shellRole, ddInvolved);"));
});

// ------------------------------------------------------------------ rendered

test('My reviews mounted: the table and the phone cards, each opening the section on the member base; Open section is 44px on a phone', async () => {
  const m = await mount(h(DdMyReviews, { load: async () => REVIEWS() }), { url: '/due-diligence/my-reviews' });
  try {
    const key = 'case7f3a00000021c9:11';
    assert.match(m.text(`dd-my-review-${key}`), /Company Alpha\s*case…21c9\s*Financial Health & Runway\s*16 Oct 2026\s*On file\s*4 pending\s*No verdict yet\s*Open section/);
    assert.match(m.text('dd-my-review-case9c40:12'), /Observer.*Invitation expired\. Ask the case lead to resend it\..*NDA missing.*Not recorded.*Warn/);
    assert.equal(m.props(`dd-my-review-open-${key}`).href, '/due-diligence/case7f3a00000021c9/overview?section=11');
    assert.match(m.props('dd-my-reviews-cards').className, /\bmd:hidden\b/);
    assert.match(m.props(`dd-my-review-card-open-${key}`).className, /\bmin-h-\[44px\]/);
    assert.doesNotMatch(m.text(), /\/admin\//);
  } finally { await m.unmount(); }
  const bad = await mount(h(DdMyReviews, { load: async () => { throw new Error('down'); } }), { url: '/due-diligence/my-reviews' });
  try { assert.match(bad.text('dd-my-reviews-unreadable'), /This is not a claim that you have none\./); } finally { await bad.unmount(); }
  const none = await mount(h(DdMyReviews, { load: async () => ({ items: [] }) }), { url: '/admin/due-diligence/my-reviews' });
  try { assert.ok(none.has('dd-my-reviews-empty')); } finally { await none.unmount(); }
});

test('the reviewer\'s panel mounted: the banner and the steps; Declare conflicts needs words for a declaration and posts to the Worker', async () => {
  const posts = [];
  const fetchFn = async (u, o = {}) => { if (String(o.method || 'GET') === 'POST') posts.push({ path: new URL(String(u), 'http://x').pathname, body: o.body ? JSON.parse(o.body) : null }); return json({ ok: true }); };
  let reloaded = 0;
  const m = await mount(h(DdReviewerPanel, { data: SCOPED(), uid: 'case7f3a00000021c9', base: '/due-diligence', viewerId: 5, onChanged: () => { reloaded += 1; } }), { url: '/due-diligence/case7f3a00000021c9', fetchFn });
  try {
    assert.equal(m.text('dd-reviewer-banner'), 'You’re reviewing Financial Health & Runway as an invited expert. You see your section only.');
    assert.match(m.text('dd-reviewer-step-11-nda'), /Sign the NDA.*Signed 17 Oct 2026/);
    assert.ok(!m.has('dd-reviewer-nda-open-11'), 'a signed NDA has no upload');
    assert.equal(m.props('dd-reviewer-work-11').href, '/due-diligence/case7f3a00000021c9/overview?section=11');
    assert.match(m.text('dd-reviewer-subject'), /Company Alpha.*hidden from section reviewers/);
    await m.click('dd-reviewer-conflicts-open-11');
    await m.change('dd-reviewer-conflicts-declared', 'declared');
    await m.click('dd-reviewer-conflicts-submit');
    assert.equal(m.text('dd-reviewer-conflicts-error'), 'Say what the interest is. The case lead reads it.');
    assert.deepEqual(posts, [], 'nothing sent without words');
    await m.change('dd-reviewer-conflicts-note', 'I hold 1% of a competitor');
    await m.click('dd-reviewer-conflicts-submit');
    assert.deepEqual(posts, [{ path: '/api/dd/cases/case7f3a00000021c9/sections/11/conflicts', body: { declared: true, note: 'I hold 1% of a competitor' } }]);
    assert.equal(m.text('dd-reviewer-done'), 'Your declaration is recorded. The case lead is told.');
    assert.equal(reloaded, 1, 'the case is read again');
  } finally { await m.unmount(); }
  const team = await mount(h(DdReviewerPanel, { data: { ...SCOPED(), case: { ...SCOPED().case, scoped: false } }, uid: 'x', base: '/admin/due-diligence', viewerId: 5 }), { url: '/' });
  try { assert.ok(!team.has('dd-reviewer'), 'the deal team sees no reviewer panel'); } finally { await team.unmount(); }
  const noNda = await mount(h(DdReviewerPanel, { data: SCOPED({ reviewers: [{ user_id: 5, section_id: 11, role: 'reviewer', nda_signed_at: null, conflicts: null }] }), uid: 'case7f3a00000021c9', base: '/due-diligence', viewerId: 5 }), { url: '/', fetchFn });
  try {
    assert.match(noNda.props('dd-reviewer-nda-open-11').className, /\bmin-h-\[44px\].*\bw-full\b/, 'full width and 44px on a phone');
    await noNda.click('dd-reviewer-nda-open-11');
    await noNda.click('dd-reviewer-nda-submit');
    assert.equal(noNda.text('dd-reviewer-nda-error'), 'Choose your signed NDA, a PDF up to 10 MB.');
  } finally { await noNda.unmount(); }
});

test('the subject\'s requests mounted: due and late, the chips, an answer by a file from their own room, and never the case', async () => {
  const sent = [];
  const rooms = [];
  const m = await mount(h(DueDiligenceRequestsPage, {
    load: async () => REQUESTS(),
    respond: async (id, body) => { sent.push([id, body]); return { ok: true }; },
    readRoom: async (uid) => { rooms.push(uid); return { files: [{ uid: 'f-deck', name: 'Contracts.pdf' }, { uid: 'f-burn', name: 'Burn 2026.pdf' }] }; },
    today: '2026-10-24',
  }), { url: '/due-diligence/requests' });
  try {
    assert.equal(m.text('dd-request-due-61'), 'Due 20 Oct 2026 · 4 days late');
    assert.equal(m.text('dd-request-due-62'), 'Due 1 Oct 2026');
    assert.equal(m.text('dd-request-due-63'), 'No due date');
    assert.match(m.text('dd-request-answer-62'), /You answered on 25 Sep 2026.*File: Assignment\.pdf/);
    await m.click('dd-requests-chip-received');
    assert.ok(!m.has('dd-request-61') && m.has('dd-request-62'), 'the chip filters');
    await m.click('dd-requests-chip-received');
    assert.ok(m.has('dd-request-61'), 'pressed again, every request');
    await m.click('dd-request-open-61');
    await m.submit('dd-request-form-61');
    assert.equal(m.text('dd-request-error-61'), 'Write an answer, paste a link or pick a file.');
    assert.deepEqual(sent, []);
    await m.click('dd-request-pick-61');
    assert.deepEqual(rooms, ['p-room'], 'their own venture\'s room');
    assert.equal(m.props('dd-request-files-layer')['data-phone'], 'sheet');
    assert.match(m.text('dd-request-files'), /Burn 2026\.pdf.*Contracts\.pdf/);
    await m.change('dd-request-file-pick-f-deck', 'f-deck');
    await m.click('dd-request-files-use');
    assert.ok(!m.has('dd-request-files'), 'the sheet closes');
    assert.match(m.text('dd-request-picked-61'), /Contracts\.pdf/);
    await m.change('dd-request-note-61', 'Minutes attached');
    await m.submit('dd-request-form-61');
    assert.deepEqual(sent, [[61, { response_note: 'Minutes attached', file_uid: 'f-deck' }]]);
    assert.equal(m.text('dd-requests-notice'), 'Your answer is sent. The team sees it on the case.');
    assert.doesNotMatch(m.text(), /case[_-]?uid|risk|score|finding/i, 'nothing of the case reaches the subject');
    assert.match(m.props('dd-request-open-62').className, /\bmin-h-\[44px\]/, '44px on a phone');
  } finally { await m.unmount(); }
});

test('a request not made of a startup has no room to pick from, and a failed read says so', async () => {
  const m = await mount(h(DueDiligenceRequestsPage, { load: async () => REQUESTS(), respond: async () => ({}), readRoom: async () => ({ files: [] }), today: '2026-10-24' }), { url: '/due-diligence/requests' });
  try {
    await m.click('dd-request-open-63');
    assert.equal(m.text('dd-request-no-room-63'), 'A data-room file answers a request made of a startup. Paste a link instead.');
    assert.ok(!m.has('dd-request-pick-63'));
    await m.click('dd-request-open-61');
    await m.click('dd-request-pick-61');
    assert.ok(m.has('dd-request-files-empty'), 'an empty room says so');
  } finally { await m.unmount(); }
  const bad = await mount(h(DueDiligenceRequestsPage, { load: async () => { throw new Error('down'); } }), { url: '/due-diligence/requests' });
  try { assert.match(bad.text('dd-requests-unreadable'), /This is not a claim that you have none\./); } finally { await bad.unmount(); }
});
