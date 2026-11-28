/**
 * D6225 (#6225) — questions about a sent report, on both sides, against a
 * stubbed `fetch`: the investor's reader (CompanyReports' `ReportReader`) ends
 * with "Your questions" and its composer in place of "A report carries no asks
 * to reply to.", each figure row asks about that figure, and Withdraw is
 * reviewed in the page; the founders' sent report (`ReportPage`) draws the
 * Questions section with Reply, a failed reply keeps its text, and a read-only
 * reader gets no Reply. Every name and figure is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/report_questions_6225.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { ReportReader } from '../src/pages/investor/CompanyReports.jsx';
import ReportPage from '../src/pages/cycles/reporting/ReportPage.jsx';
import { reportQuestionsApi } from '../src/lib/api/reportQuestions.js';
import { aboutLine, countsLine, counter, figureChip, questionPill, sendable } from '../src/pages/cycles/reporting/questionsModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

/* ------------------------------------------------------------------ fixtures */

const UID = 'c'.repeat(32);
const fig = (key, label, value) => ({ key, label, module: 'revenue-and-traction', unit: 'count', value, source: { word: 'Connector', provider: 'stripe', computed: false }, as_of: '2026-09-30', typed: false, left_out: false, left_out_reason: null, included: true });
const REPORT = {
  ok: true, view: 'reader', uid: UID, kind: 'report', status: 'sent', period: { label: '2026-Q3', start: '2026-07-01', end: '2026-09-30' },
  title: 'Q3 report', body: null, highlights: [], lowlights: [], figures: [fig('customers', 'Customers', 214)], meets: [], revision: 1,
  correction_reason: null, corrected_by: null, documents: [], sent_at: '2026-11-02T10:00:00Z',
};
const Q_OPEN = { uid: 'q'.repeat(32), figure_key: 'customers', body: 'How many are on annual plans?', asked_at: '2026-11-10T09:00:00Z', state: 'read', read_at: '2026-11-11T09:00:00Z', withdrawn_at: null, answer: null };
const Q_DONE = { uid: 'd'.repeat(32), figure_key: null, body: 'Will Q4 include gross margin?', asked_at: '2026-11-09T09:00:00Z', state: 'answered', read_at: '2026-11-09T12:00:00Z', withdrawn_at: null, answer: { body: 'Yes, in the Q4 report.', by: 'Mia Founder', at: '2026-11-10T09:00:00Z' } };
const LIST = (over = {}) => ({ ok: true, report_uid: UID, view: 'asker', can_ask: true, can_reply: false, write_refusal: null, limits: { question: 600, reply: 1200 }, questions: [Q_OPEN, Q_DONE], ...over });
const QPATH = `/report-questions/reports/${UID}`;

/* ------------------------------------------------------------------ harness */

async function mount(element, routes, { url = '/', path = '*' } = {}) {
  const restore = installDocument();
  const prev = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u, opts = {}) => {
    const p = String(u).replace(/^.*\/api/, '');
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    asked.push({ path: p, method, body });
    const hit = routes[`${method} ${p}`] ?? routes[p];
    const out = typeof hit === 'function' ? await hit(p, body) : hit;
    if (out && out.__status) return response({ error: out.error, message: out.message }, out.__status);
    return response(out ?? {});
  };
  localStorage.setItem('user', JSON.stringify({ id: 6, role: 'investor', name: 'Ivy' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = async () => { for (let i = 0; i < 16; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path, element })))));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, by, has: (id) => !!by(id), props: (id) => pr(by(id)),
    at: (id) => walk(document.body).indexOf(by(id)),
    text: (id) => txt(by(id)).replace(/\s+/g, ' ').trim(),
    all: () => txt(document.body).replace(/\s+/g, ' '),
    writes: () => asked.filter((a) => a.method !== 'GET').map((a) => [a.method, a.path, a.body]),
    click: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { await pr(n).onClick({ preventDefault() {} }); }); await flush(); },
    type: async (id, value) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onChange({ target: { value } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = prev; localStorage.removeItem('user'); restore(); },
  };
}
const reader = (routes) => mount(h(ReportReader, { uid: UID, company: 'Fixture Robotics', onClose: () => {} }), { [`/reporting/reports/${UID}`]: REPORT, ...routes });

/* ------------------------------------------------------------------ the model */

test('the model: each side’s pill words, the about line, counts without zeros, live-only figure chips, the counter and what may be sent', () => {
  assert.equal(questionPill({ state: 'sent' }).text, 'Sent · not yet read');
  assert.equal(questionPill({ state: 'read', read_at: '2026-11-11T09:00:00Z' }).text, 'Read 11 Nov');
  assert.equal(questionPill({ state: 'sent' }, 'team').text, 'Unread');
  assert.equal(questionPill({ state: 'read' }, 'team').text, 'Open');
  assert.equal(questionPill(Q_DONE, 'team').text, 'Answered 10 Nov');
  assert.equal(questionPill({ state: 'withdrawn', withdrawn_at: '2026-11-06T00:00:00Z' }).text, 'Withdrawn 6 Nov');
  assert.equal(aboutLine({ figure_key: null }), 'The whole report');
  assert.equal(aboutLine({ figure_key: 'mrr' }, { mrr: { label: 'MRR', value: '$48,200' } }, 'Q3 2026'), 'MRR · Q3 2026 · $48,200');
  assert.equal(aboutLine({ figure_key: 'gm' }, { gm: { label: 'Gross margin', value: null } }), 'Gross margin · Not recorded');
  assert.equal(countsLine([{ state: 'sent' }, { state: 'read' }, { state: 'answered' }, { state: 'read' }]), '1 unread · 2 open · 1 answered');
  assert.equal(figureChip([{ figure_key: 'mrr', state: 'read' }, { figure_key: 'mrr', state: 'withdrawn' }], 'mrr'), '1 question');
  assert.equal(figureChip([{ figure_key: 'mrr', state: 'withdrawn' }], 'mrr'), null);
  assert.equal(counter('x'.repeat(1200), 1200), '1,200 / 1,200');
  assert.equal(sendable('  hi  ', 600), 'hi');
  assert.equal(sendable('   ', 600), null);
  assert.equal(sendable('x'.repeat(601), 600), null);
});

test('the client module calls the mounted Worker paths, and api.js is not edited for it', async () => {
  const calls = [];
  const restore = installDocument();
  const prev = globalThis.fetch;
  globalThis.fetch = async (u, opts = {}) => { calls.push([opts.method || 'GET', String(u).replace(/^.*\/api/, ''), opts.body ? JSON.parse(opts.body) : undefined]); return response({ ok: true }); };
  try {
    await reportQuestionsApi.list(UID);
    await reportQuestionsApi.ask(UID, 'Why?', 'mrr');
    await reportQuestionsApi.ask(UID, 'Whole?');
    await reportQuestionsApi.reply('q1', 'Because.');
    await reportQuestionsApi.withdraw('q1');
  } finally { globalThis.fetch = prev; restore(); }
  assert.deepEqual(calls, [
    ['GET', QPATH, undefined],
    ['POST', QPATH, { body: 'Why?', figure_key: 'mrr' }],
    ['POST', QPATH, { body: 'Whole?' }],
    ['POST', '/report-questions/questions/q1/reply', { body: 'Because.' }],
    ['POST', '/report-questions/questions/q1/withdraw', {}],
  ]);
  const route = readFileSync(new URL('../../cloudflare-worker/src/routes/report_questions.ts', import.meta.url), 'utf8');
  for (const p of ["r.get('/reports/:uid'", "r.post('/reports/:uid'", "r.post('/questions/:uid/reply'", "r.post('/questions/:uid/withdraw'", "path: '/api/report-questions'"]) assert.ok(route.includes(p), p);
  assert.ok(!readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8').includes('report-questions'));
});

/* ------------------------------------------------------------------ the investor */

test('the reader: the old “no asks” sentence is gone; Your questions shows the thread, the answer and a figure’s live count', async () => {
  const p = await reader({ [QPATH]: LIST() });
  try {
    assert.ok(!p.all().includes('carries no asks'), 'the placeholder sentence is gone');
    assert.match(p.text('company-reader-questions'), /Your questions · 2/);
    assert.match(p.text(`question-${Q_OPEN.uid}`), /About: Customers · Q3 2026 · 214/);
    assert.equal(p.text(`question-pill-${Q_OPEN.uid}`), '● Read 11 Nov');
    assert.match(p.text(`question-answer-${Q_DONE.uid}`), /Mia Founder · founder · 10 Nov 2026 Yes, in the Q4 report\./);
    assert.equal(p.text('company-reader-figure-chip-customers'), '1 question');
    assert.ok(p.has(`question-withdraw-${Q_OPEN.uid}`), 'an open question can be withdrawn');
    assert.ok(!p.has(`question-withdraw-${Q_DONE.uid}`), 'an answered one cannot');
  } finally { await p.close(); }
});

test('the reader: none yet, then asking about a figure posts it with the figure, and a refused send keeps the text', async () => {
  let refuse = true;
  const p = await reader({
    [QPATH]: LIST({ questions: [] }),
    [`POST ${QPATH}`]: (_path, body) => (refuse
      ? { __status: 400, error: 'invalid_question', message: 'Write a question of 1 to 600 characters.' }
      : { ok: true, question: { ...Q_OPEN, uid: 'n'.repeat(32), state: 'sent', read_at: null, body: body.body } }),
  });
  try {
    assert.match(p.text('questions-none'), /You have not asked about this report\./);
    await p.click('company-reader-ask-customers');
    assert.equal(p.text('question-composer-about'), 'Customers · Q3 2026 · 214');
    assert.equal(p.props('question-composer-send').disabled, true, 'nothing to send yet');
    await p.type('question-composer-text', 'Annual plans?');
    assert.equal(p.text('question-composer-count'), '13 / 600');
    await p.click('question-composer-send');
    assert.match(p.text('question-composer-error'), /Not sent\. Write a question of 1 to 600 characters\./);
    assert.equal(p.props('question-composer-text').value, 'Annual plans?', 'the text is kept');
    refuse = false;
    await p.click('question-composer-send');
    assert.deepEqual(p.writes().at(-1), ['POST', QPATH, { body: 'Annual plans?', figure_key: 'customers' }]);
    assert.ok(!p.has('question-composer'), 'the composer closes on success');
    assert.equal(p.text(`question-pill-${'n'.repeat(32)}`), '◷ Sent · not yet read');
  } finally { await p.close(); }
});

test('the reader: Withdraw is reviewed in the page before it is sent', async () => {
  const p = await reader({
    [QPATH]: LIST(),
    [`POST /report-questions/questions/${Q_OPEN.uid}/withdraw`]: { ok: true, question: { ...Q_OPEN, state: 'withdrawn', withdrawn_at: '2026-11-14T09:00:00Z' } },
  });
  try {
    await p.click(`question-withdraw-${Q_OPEN.uid}`);
    assert.deepEqual(p.writes(), [], 'opening the review sends nothing');
    assert.match(p.text(`question-withdraw-review-${Q_OPEN.uid}`), /The founders can no longer reply to it\./);
    await p.click(`question-withdraw-confirm-${Q_OPEN.uid}`);
    assert.deepEqual(p.writes(), [['POST', `/report-questions/questions/${Q_OPEN.uid}/withdraw`, {}]]);
    assert.equal(p.text(`question-pill-${Q_OPEN.uid}`), '– Withdrawn 14 Nov');
    assert.match(p.text('question-withdrawn-note'), /Withdrawn\. Fixture Robotics’s founders see it as withdrawn\./);
  } finally { await p.close(); }
});

test('the reader in a support session: no ask, no withdraw, and the Worker’s sentence', async () => {
  const p = await reader({ [QPATH]: LIST({ can_ask: false, write_refusal: 'A support session cannot ask or answer a question.' }) });
  try {
    assert.ok(!p.has('question-ask-whole'));
    assert.ok(!p.has('company-reader-ask-customers'));
    assert.ok(!p.has(`question-withdraw-${Q_OPEN.uid}`));
    assert.equal(p.text('questions-write-refusal'), 'A support session cannot ask or answer a question.');
  } finally { await p.close(); }
});

test('the reader: a failed questions read is Unreadable, never “none”', async () => {
  const p = await reader({ [QPATH]: { __status: 503, error: 'questions_unreadable', message: 'Unreadable.' } });
  try {
    assert.ok(!p.has('questions-none'));
    assert.match(p.text('company-reader-questions'), /This is not a claim that nobody asked/);
  } finally { await p.close(); }
});

/* ------------------------------------------------------------------ the founders */

const TEAM_REPORT = { ...REPORT, view: 'team', recipients: [], figures: [fig('customers', 'Customers', 214)], include_team: false, figures_sha256: 'x' };
const founderPage = (routes, report = TEAM_REPORT) => mount(h(ReportPage, { uid: UID, projectId: 7 }), { [`/reporting/reports/${UID}`]: report, ...routes },
  { url: `/grow/reporting/${UID}`, path: '/grow/reporting/:id' });
const UNREAD = { ...Q_OPEN, uid: 'u'.repeat(32), state: 'sent', read_at: null, asker: { name: 'Ivy Alpha' } };

test('the founders’ sent report: Questions above the frozen report, Unread and Answered, and Reply sends once', async () => {
  const p = await founderPage({
    [QPATH]: LIST({ view: 'team', can_ask: false, can_reply: true, questions: [UNREAD, { ...Q_DONE, asker: { name: 'Ben Beta' } }] }),
    [`POST /report-questions/questions/${UNREAD.uid}/reply`]: (_p, body) => ({ ok: true, question: { ...UNREAD, state: 'answered', answer: { body: body.body, by: 'Mia Founder', at: '2026-11-15T09:00:00Z' } } }),
  });
  try {
    assert.equal(p.text('questions-counts'), '1 unread · 1 answered');
    assert.match(p.text(`founder-question-${UNREAD.uid}`), /^Ivy Alpha/);
    assert.equal(p.text(`founder-question-pill-${UNREAD.uid}`), '● Unread');
    assert.ok(!p.has(`founder-question-reply-${Q_DONE.uid}`), 'an answered question has no Reply');
    await p.click(`founder-question-reply-${UNREAD.uid}`);
    assert.ok(!p.has(`founder-question-reply-${UNREAD.uid}`), 'the card’s Reply is hidden while the box is open');
    await p.type(`founder-reply-${UNREAD.uid}-text`, 'Most are annual.');
    await p.click(`founder-reply-${UNREAD.uid}-send`);
    assert.deepEqual(p.writes(), [['POST', `/report-questions/questions/${UNREAD.uid}/reply`, { body: 'Most are annual.' }]]);
    assert.equal(p.text(`founder-question-pill-${UNREAD.uid}`), '✓ Answered 15 Nov');
    assert.match(p.text(`founder-question-answer-${UNREAD.uid}`), /Most are annual\./);
    // The Questions section sits above the report as frozen.
    assert.ok(p.at('reporting-frozen-revenue-and-traction') > 0, 'the frozen report is drawn');
    assert.ok(p.at('reporting-questions') < p.at('reporting-frozen-revenue-and-traction'), 'Questions sit above the report as frozen');
  } finally { await p.close(); }
});

test('the founders: a refused reply keeps its text and redraws the question as it now is', async () => {
  let listed = 0;
  const p = await founderPage({
    [QPATH]: () => { listed += 1; return LIST({ view: 'team', can_reply: true, can_ask: false, questions: [listed > 1 ? { ...UNREAD, state: 'withdrawn', withdrawn_at: '2026-11-14T09:00:00Z' } : UNREAD] }); },
    [`POST /report-questions/questions/${UNREAD.uid}/reply`]: { __status: 409, error: 'question_withdrawn', message: 'The investor withdrew this question, so it was not answered.' },
  });
  try {
    await p.click(`founder-question-reply-${UNREAD.uid}`);
    await p.type(`founder-reply-${UNREAD.uid}-text`, 'Too late?');
    await p.click(`founder-reply-${UNREAD.uid}-send`);
    assert.match(p.text(`founder-reply-${UNREAD.uid}-error`), /The investor withdrew this question/);
    assert.equal(p.props(`founder-reply-${UNREAD.uid}-text`).value, 'Too late?');
    assert.equal(p.text(`founder-question-pill-${UNREAD.uid}`), '– Withdrawn 14 Nov');
  } finally { await p.close(); }
});

test('the founders: none asked, and a read-only reader (admin or advisor) gets the cards and no Reply', async () => {
  const none = await founderPage({ [QPATH]: LIST({ view: 'team', can_reply: true, can_ask: false, questions: [] }) });
  try {
    assert.match(none.text('questions-none'), /No investor has asked about this report\./);
  } finally { await none.close(); }
  const ro = await founderPage({ [QPATH]: LIST({ view: 'read_only', can_reply: false, can_ask: false, write_refusal: 'Only the company’s founders answer a question. This view is read only.', questions: [UNREAD] }) },
    { ...REPORT, view: 'reader', read_only: true });
  try {
    assert.match(ro.text('questions-read-only'), /Read only\. Only the founders reply\./);
    assert.ok(ro.has(`founder-question-${UNREAD.uid}`));
    assert.ok(!ro.has(`founder-question-reply-${UNREAD.uid}`));
  } finally { await ro.close(); }
});
