/**
 * D685 §5.10 and §5.11 (#1589) — the interview review at
 * `/validate/interviews/:id`: which session opens, the switcher, the summary
 * with its cited passages, the findings' accept / edit / discard round trip,
 * Edit details that never saves over the fields it does not show, the Delete
 * confirm, and the rows that link here.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/interview_review_d685.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import { PLACEMENTS_ONE_RUN } from './_interview_review_fixtures.mjs';
import { REVIEWABLE, citeTarget, pickSession, sessionLabel, statusWord, whoLine } from '../src/pages/founder/interviewReviewModel.js';
import SessionSummary from '../src/pages/founder/SessionSummary.jsx';
import InterviewReviewPage, { detailsPayload } from '../src/pages/founder/InterviewReviewPage.jsx';
import { StructureReceipt } from '../src/pages/founder/InterviewReview.jsx';
import { RECORDS } from '../src/pages/cycles/adapters/validate.js';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const tag = (out, id) => new RegExp(`<[a-z]+[^>]*data-testid="${id}"[^>]*>`).exec(out)?.[0] ?? '';

const S = (id, status, extra = {}) => ({ id, status, channel: 'in_person', created_at: `2026-10-0${id} 10:00:00`, interview_id: 41, ...extra });
const SEGMENTS = [
  { id: 90, source: 'live', start_ms: 0, end_ms: 9000, text: 'live draft' },
  { id: 91, source: 'final', start_ms: 0, end_ms: 9000, text: 'We use two systems.' },
  { id: 92, source: 'final', start_ms: 9000, end_ms: 20000, text: 'We lose a full day every week reconciling them.' },
];
const SUMMARY = {
  text: 'They reconcile two systems by hand. It costs a day a week.',
  sentences: [
    { text: 'They reconcile two systems by hand.', cites: [{ from: 0, to: 8000, quote: 'We use two systems.' }] },
    { text: 'It costs a day a week.', cites: [{ from: 12000, to: 19500, quote: 'We lose a full day' }, { from: 50000, to: 60000, quote: 'gone' }] },
  ],
  model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', summarised_at: '2026-10-13 18:00:00',
};

test('the review opens on the session ?session= names, else the newest with a transcript, else the newest', () => {
  const items = [S(9, 'draft'), S(8, 'recording'), S(7, 'transcribed'), S(6, 'reviewed')];
  assert.equal(pickSession(items).id, 7, 'not the empty draft on top');
  assert.equal(pickSession(items, '6').id, 6);
  assert.equal(pickSession(items, 6).id, 6);
  assert.equal(pickSession(items, '99').id, 7, 'another interview\'s session is ignored');
  assert.equal(pickSession([S(3, 'draft'), S(2, 'stopped')]).id, 3, 'nothing reviewable: the newest');
  assert.equal(pickSession([]), null);
  assert.equal(pickSession(undefined), null);
  assert.deepEqual([...REVIEWABLE].sort(), ['reviewed', 'structured', 'transcribed']);
});

test('the switcher names each session by date, how it was held, and where it stands; a missing part says so', () => {
  assert.equal(sessionLabel(S(7, 'structured', { call_label: 'Video call · Zoom' })), '2026-10-07 · Video call · Zoom · Findings proposed');
  assert.equal(sessionLabel(S(7, 'transcribed', { channel: 'phone' })), '2026-10-07 · Audio call · Transcribed');
  assert.equal(sessionLabel({ status: 'odd' }), 'Date not recorded · Channel not recorded · odd', 'an unknown status is shown as written');
  assert.equal(statusWord(null), 'Not recorded');
  assert.deepEqual(whoLine({ interviewee_name: ' Dana ', interviewee_company: '' }), { name: 'Dana', company: 'Not recorded' });
  assert.deepEqual(whoLine(null), { name: 'Name not recorded', company: 'Not recorded' });
});

test('a citation points at the first final passage its span overlaps; none, or a broken span, links nowhere', () => {
  assert.equal(citeTarget(SEGMENTS, { from: 12000, to: 19500 }), 'seg-92');
  assert.equal(citeTarget(SEGMENTS, { from: 0, to: 8000 }), 'seg-91', 'the final passage, never the live draft');
  assert.equal(citeTarget(SEGMENTS, { from: 8000, to: 10000 }), 'seg-91', 'an overlap of two takes the first');
  assert.equal(citeTarget(SEGMENTS, { from: 50000, to: 60000 }), null);
  assert.equal(citeTarget(SEGMENTS, { from: 10, to: 10 }), null);
  assert.equal(citeTarget(SEGMENTS, { from: 'a', to: 3 }), null);
  assert.equal(citeTarget(null, { from: 0, to: 5 }), null);
});

test('the summary: each sentence links to the passages it cites, the model is named, and none reads "Not recorded"', () => {
  const out = html(h(SessionSummary, { summary: SUMMARY, segments: SEGMENTS }));
  assert.equal((out.match(/data-testid="summary-sentence"/g) || []).length, 2);
  assert.match(out, /<a href="#seg-91" title="We use two systems\."[^>]*data-testid="summary-cite"[^>]*>0:00–0:08<\/a>/);
  assert.match(out, /<a href="#seg-92"[^>]*>0:12–0:19<\/a>/);
  assert.match(tag(out, 'summary-cite-text'), /title="gone"/, 'a span outside the transcript keeps its label, with no dead link');
  assert.ok(renderedText(out).includes('Written by @cf/meta/llama-3.3-70b-instruct-fp8-fast · 2026-10-13 18:00'));
  assert.doesNotMatch(html(h(SessionSummary, { summary: SUMMARY, segments: SEGMENTS, canSummarise: true })), /button-summarise/, 'a summary is there: nothing to offer, even where Summarise is allowed');
  const none = html(h(SessionSummary, { summary: null, segments: SEGMENTS }));
  assert.match(none, /data-testid="summary-none">Not recorded</);
  assert.doesNotMatch(none, /summary-model|button-summarise/);
  assert.match(html(h(SessionSummary, { summary: null, canSummarise: true })), /data-testid="button-summarise"/, 'Manual mode, or a refusal: Summarise');
  assert.match(html(h(SessionSummary, { summary: { ...SUMMARY, model: null } })), /Written by a model not recorded/);
  assert.match(tag(html(h(SessionSummary, { summary: null, error: 'Your daily AI allowance is spent.' })), 'summary-error'), /role="alert"/);
  assert.match(out, /dark:bg-gray-950/);
});

test('the receipt lists the summary\'s lines beside structuring\'s', () => {
  const out = html(h(StructureReceipt, { items: [
    { kind: 'summarised', model: 'm1', cost_microusd: 1200, created_at: 't1' },
    { kind: 're_summarised', model: 'm2', cost_microusd: 0, outcome: 'refused', refusal: 'budget_user_day', created_at: 't2' },
    { kind: 'final', model: 'whisper', cost_microusd: 9 },
  ] }));
  assert.ok(renderedText(out).includes('Summarised · m1'));
  assert.ok(renderedText(out).includes('Re-summarised · m2 · refused (budget_user_day)'));
  assert.doesNotMatch(out, /whisper/, 'transcription stays out of this list');
});

// ── The page, through the stub DOM ─────────────────────────────────────────

function fakes({ items = [S(9, 'draft'), S(7, 'transcribed')], detail = {}, listFails = false, rows = null } = {}) {
  const calls = [];
  const sessions = {
    list: async (id) => { calls.push(['list', id]); if (listFails) throw new Error('500'); return { interview: { id: 41, project_id: 3, interviewee_name: 'Dana Ruiz', interviewee_company: 'Acme', stage: 'done' }, items }; },
    get: async (id) => { calls.push(['get', id]); return { session: items.find((s) => String(s.id) === String(id)), summary: null, processing: null, segments: SEGMENTS, ...detail }; },
    receipt: async () => ({ items: [] }),
    placements: async (id) => { calls.push(['placements', id]); return PLACEMENTS_ONE_RUN; },
    accept: async (pid, payload) => { calls.push(['accept', pid, payload ?? null]); return { ok: true }; },
    discard: async (pid) => { calls.push(['discard', pid]); return { ok: true }; },
    summarise: async (id) => { calls.push(['summarise', id]); return { ok: true }; },
    setSpeaker: async () => ({}),
  };
  const api = {
    listInterviews: async (pid) => { calls.push(['listInterviews', pid]); return rows ?? { project_id: 3, interviews: [{ id: 41, interviewee_name: 'Dana Ruiz', interviewee_role: 'Ops lead', interview_date: '2026-10-07', notes: 'Kept notes', hypotheses: [4], pains: ['reconciling'], interviewee_company: 'Acme' }] }; },
    updateInterview: async (id, body) => { calls.push(['updateInterview', id, body]); return {}; },
    deleteInterview: async (id) => { calls.push(['deleteInterview', id]); return {}; },
  };
  return { calls, sessions, api };
}

async function mount(f, url = '/validate/interviews/41') {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  let path = null;
  function Probe() { const l = useLocation(); path = `${l.pathname}${l.search}`; return null; }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [url] }, h(Probe),
      h(Routes, null,
        h(Route, { path: '/validate/interviews/:id', element: h(InterviewReviewPage, { sessions: f.sessions, api: f.api }) }),
        h(Route, { path: '/validate/interviews', element: h('p', null, 'log') }))));
  });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    by, pr, settle, path: () => path, text: () => text(container).replace(/\s+/g, ' '),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async type(id, value) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { pr(n).onChange({ target: { value } }); }); },
    async submit(id) { await act(async () => { await pr(by(id)).onSubmit({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

test('the page: the interview from the Worker, the newest reviewable session, its findings mounted, and a switcher', async () => {
  const f = fakes({ items: [S(9, 'draft'), S(7, 'transcribed'), S(6, 'reviewed')] });
  const m = await mount(f);
  try {
    assert.ok(m.text().includes('Dana Ruiz · Acme'));
    assert.ok(m.text().includes('Held · 3 sessions'));
    assert.deepEqual(f.calls.filter((c) => c[0] === 'get'), [['get', 7]], 'opened on the transcribed one, not the draft');
    assert.ok(f.calls.some((c) => c[0] === 'placements' && c[1] === 7), 'the findings are D658\'s placements');
    assert.ok(m.by('placement-1'), 'a proposed finding is drawn');
    assert.ok(m.by('session-switcher'));
    assert.ok(m.by('summary-none'), 'no summary: "Not recorded"');
    assert.ok(m.by('button-summarise'), 'a transcript and no summary: Summarise');
    await act(async () => { m.pr(m.by('session-switcher')).onChange({ target: { value: '6' } }); });
    await m.settle();
    assert.equal(m.path(), '/validate/interviews/41?session=6');
    assert.deepEqual(f.calls.filter((c) => c[0] === 'get').at(-1), ['get', 6]);
  } finally { await m.unmount(); }
});

test('accept, edit then accept, and discard each call D658\'s POST and read the placements again', async () => {
  const f = fakes();
  const m = await mount(f);
  try {
    const reads = () => f.calls.filter((c) => c[0] === 'placements').length;
    const before = reads();
    await m.click('placement-accept-1');
    assert.deepEqual(f.calls.filter((c) => c[0] === 'accept')[0], ['accept', 1, null]);
    assert.equal(reads(), before + 1, 're-read after accepting');
    await m.click('placement-edit-toggle-2');
    await m.type('placement-edit-2', '{"fit":"partial","reason":"Edited."}');
    await m.click('placement-accept-2');
    assert.deepEqual(f.calls.filter((c) => c[0] === 'accept')[1], ['accept', 2, { fit: 'partial', reason: 'Edited.' }], 'the edit is what is accepted');
    await m.click('placement-discard-5');
    assert.deepEqual(f.calls.filter((c) => c[0] === 'discard'), [['discard', 5]]);
    assert.equal(reads(), before + 3);
  } finally { await m.unmount(); }
});

test('Summarise asks the Worker and reads the session again; a refusal is printed in its words', async () => {
  const f = fakes();
  const m = await mount(f);
  try {
    await m.click('button-summarise');
    assert.deepEqual(f.calls.filter((c) => c[0] === 'summarise'), [['summarise', 7]]);
    assert.equal(f.calls.filter((c) => c[0] === 'get').length, 2, 'the summary is read back');
  } finally { await m.unmount(); }
  const f2 = fakes();
  f2.sessions.summarise = async () => { throw new Error('Your daily AI allowance is spent.'); };
  const m2 = await mount(f2);
  try {
    await m2.click('button-summarise');
    assert.ok(m2.text().includes('Your daily AI allowance is spent.'));
  } finally { await m2.unmount(); }
  const f3 = fakes({ detail: { processing: { stage: 'summarising' } } });
  const m3 = await mount(f3);
  try { assert.equal(m3.by('button-summarise'), undefined, 'not while the job writes it'); } finally { await m3.unmount(); }
});

test('a session with nothing to review links to its own page; an interview with no session says so; an unreadable one too', async () => {
  const m = await mount(fakes({ items: [S(9, 'draft')] }));
  try {
    assert.ok(m.text().includes('This session is not started: nothing to review yet.'));
    assert.equal(m.pr(m.by('link-open-session')).href, '/validate/session/9');
    assert.equal(m.by('session-switcher'), undefined, 'one session: no switcher');
  } finally { await m.unmount(); }
  const m2 = await mount(fakes({ items: [] }));
  try { assert.ok(m2.by('interview-no-sessions')); } finally { await m2.unmount(); }
  const m3 = await mount(fakes({ listFails: true }));
  try { assert.ok(m3.text().includes('Unreadable: this interview could not be read.')); } finally { await m3.unmount(); }
});

test('Edit details sends the whole row back with only the name and company changed; an unreadable row is never saved over', async () => {
  assert.deepEqual(detailsPayload({ interviewee_role: 'Ops lead', interview_date: '2026-10-07', notes: 'n', hypotheses: [4], pains: ['p'] }, { name: ' Dana R ', company: '' }), {
    interviewee_name: 'Dana R', interviewee_role: 'Ops lead', interview_date: '2026-10-07', notes: 'n', hypotheses: [4], pains: ['p'], interviewee_company: null,
  });
  const f = fakes();
  const m = await mount(f);
  try {
    await m.click('button-edit-details');
    await m.type('edit-name', 'Dana Ruiz-Ortega');
    await m.submit('edit-details');
    const put = f.calls.find((c) => c[0] === 'updateInterview');
    assert.deepEqual(f.calls.find((c) => c[0] === 'listInterviews'), ['listInterviews', 3], 'the row is read fresh first');
    assert.equal(put[1], 41);
    assert.deepEqual(put[2], { interviewee_name: 'Dana Ruiz-Ortega', interviewee_role: 'Ops lead', interview_date: '2026-10-07', notes: 'Kept notes', hypotheses: [4], pains: ['reconciling'], interviewee_company: 'Acme' },
      'notes, hypotheses, pains and role are sent as they are, never blanked');
    assert.equal(m.by('edit-details'), undefined, 'saved: the form closes');
  } finally { await m.unmount(); }
  const f2 = fakes({ rows: { project_id: 3, interviews: [] } });
  const m2 = await mount(f2);
  try {
    await m2.click('button-edit-details');
    await m2.submit('edit-details');
    assert.equal(f2.calls.some((c) => c[0] === 'updateInterview'), false);
    assert.ok(m2.text().includes('This interview could not be read, so nothing was saved.'));
  } finally { await m2.unmount(); }
});

test('Delete confirms what goes with it, Cancel keeps it, and Delete the interview removes it and returns to the log', async () => {
  const f = fakes();
  const m = await mount(f);
  try {
    await m.click('button-delete-interview');
    const dlg = m.by('delete-interview-confirm');
    assert.equal(m.pr(dlg).role, 'alertdialog');
    assert.equal(m.pr(dlg)['aria-modal'], 'true');
    assert.ok(m.text().includes('Delete the interview with Dana Ruiz?'));
    assert.ok(m.text().includes('Its recordings, transcripts and summaries go too, with any findings still waiting for review. Findings you already accepted stay in their Validate modules.'));
    await m.click('button-cancel-delete');
    assert.equal(m.by('delete-interview-confirm'), undefined);
    assert.equal(f.calls.some((c) => c[0] === 'deleteInterview'), false);
    await m.click('button-delete-interview');
    await m.click('button-confirm-delete');
    assert.deepEqual(f.calls.filter((c) => c[0] === 'deleteInterview'), [['deleteInterview', 41]]);
    assert.equal(m.path(), '/validate/interviews');
  } finally { await m.unmount(); }
  const f2 = fakes();
  f2.api.deleteInterview = async () => { throw new Error('Project not found'); };
  const m2 = await mount(f2);
  try {
    await m2.click('button-delete-interview');
    await m2.click('button-confirm-delete');
    assert.ok(m2.text().includes('Project not found'));
    assert.equal(m2.path(), '/validate/interviews/41', 'a refusal keeps the page');
  } finally { await m2.unmount(); }
});

test('the route, and the rows that link to it: Customer research and the interview log', () => {
  const row = RECORDS['customer-research'].row({ id: 41, interviewee: 'Dana Ruiz', company: 'Acme' });
  assert.deepEqual(row.cells.interviewee, { text: 'Dana Ruiz', href: '/validate/interviews/41' });
  assert.equal(RECORDS['customer-research'].row({ id: 41, interviewee: null }).cells.interviewee, null, 'no name: "Not recorded", not a link');
  assert.equal(RECORDS['customer-research'].row({ id: 'x', interviewee: 'Dana' }).cells.interviewee, 'Dana', 'no numeric id: plain text');
  const ws = readFileSync('frontend/src/workspaces/founder/FounderValidateWorkspace.jsx', 'utf8');
  assert.match(ws, /<Link to=\{`\/validate\/interviews\/\$\{encodeURIComponent\(r\.id\)\}`\}[^>]*data-testid=\{`interview-row-link-\$\{r\.id\}`\}>/);
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  assert.match(app, /<Route path="\/validate\/interviews\/:id" element=\{guard\(labRoles\(\['admin', 'founder'\]\), <InterviewReviewPage \/>\)\} \/>/);
  assert.match(app, /<Route path="\/validate\/session\/:id" /, 'the per-session deep link stays');
  const page = readFileSync('frontend/src/pages/founder/InterviewReviewPage.jsx', 'utf8');
  assert.doesNotMatch(page, /<Link[^>]*\/placements\//, 'no placement action is a link');
});
