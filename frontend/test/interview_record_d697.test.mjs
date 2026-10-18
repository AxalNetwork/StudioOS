/**
 * D697 (#1659) — the interview record's pieces that draw no read, shipped
 * before the record itself (S1, 2026-10-17):
 *   - `clock`, `findPassages` and `afterDelete` in `interviewReviewModel.js` (step 10);
 *   - `TranscriptReview`'s optional `time` prop (step 7), which
 *     `/validate/session/:id` does not pass, so that page draws no time;
 *   - `PainSeverity` moved from `FounderValidateWorkspace.jsx` to
 *     `pages/founder/validatePieces.jsx` unchanged (step 8), and FVW importing it.
 *
 * PR 2 (the record) adds tests 7 to 10: the record mounted on its own, over a
 * writer's and a partner's read shaped as #1692's, and inside CycleRoute's
 * record mode, with `fetch` stubbed.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/interview_record_d697.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { afterDelete, clock, findPassages } from '../src/pages/founder/interviewReviewModel.js';
import { TranscriptReview } from '../src/pages/founder/InterviewSessionPage.jsx';
import { PainSeverity } from '../src/pages/founder/validatePieces.jsx';
import { api } from '../src/lib/api.js';
import InterviewRecord from '../src/pages/founder/InterviewReviewPage.jsx';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { recordParts } from '../src/pages/founder/interviewReviewModel.js';
import { PLACEMENTS_ONE_RUN } from './_interview_review_fixtures.mjs';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

const SEGMENTS = [
  { id: 90, source: 'live', start_ms: 0, end_ms: 9000, text: 'live draft about invoices' },
  { id: 91, source: 'final', start_ms: 0, end_ms: 9000, text: 'We use two systems.' },
  { id: 92, source: 'final', start_ms: 9_000, end_ms: 20_000, text: 'We lose a full day every week reconciling them.' },
  { id: 93, source: 'final', start_ms: 3_725_400, end_ms: 3_730_000, text: 'Invoices go out late.' },
  { id: 94, source: 'final', start_ms: null, end_ms: null, text: 'A passage with no recorded start.' },
];

// ---------------------------------------------------------------------------
// Step 10 — the model's rules
// ---------------------------------------------------------------------------

test('10: clock gives a passage\'s start as [hh:mm:ss], and nothing for a start that is absent or unreadable', () => {
  assert.equal(clock(0), '[00:00:00]');
  assert.equal(clock(9_000), '[00:00:09]');
  assert.equal(clock(59_999), '[00:00:59]', 'seconds are floored, never rounded up');
  assert.equal(clock(61_000), '[00:01:01]');
  assert.equal(clock(3_725_400), '[01:02:05]');
  assert.equal(clock(36_000_000), '[10:00:00]');
  assert.equal(clock('9000'), '[00:00:09]', 'a numeric string from the Worker reads as its number');
  for (const absent of [null, undefined, '', 'soon', -1, Number.NaN, Infinity]) {
    assert.equal(clock(absent), null, `${String(absent)} draws no time, never [00:00:00]`);
  }
});

test('10: findPassages keeps the final passages whose words hold the search text, case aside; blank keeps them all', () => {
  const ids = (rows) => rows.map((s) => s.id);
  assert.deepEqual(ids(findPassages(SEGMENTS, '')), [91, 92, 93, 94], 'the final passages, as TranscriptReview draws them');
  assert.deepEqual(ids(findPassages(SEGMENTS, '   ')), [91, 92, 93, 94]);
  assert.deepEqual(ids(findPassages(SEGMENTS, undefined)), [91, 92, 93, 94]);
  assert.deepEqual(ids(findPassages(SEGMENTS, 'INVOICES')), [93], 'case aside; the live draft that also says it is not a passage');
  assert.deepEqual(ids(findPassages(SEGMENTS, ' systems ')), [91], 'the text is trimmed');
  assert.deepEqual(ids(findPassages(SEGMENTS, 'we')), [91, 92]);
  assert.deepEqual(findPassages(SEGMENTS, 'nothing like this'), []);
  // With no final passage yet, the live ones are the transcript.
  const live = [{ id: 1, source: 'live', text: 'Early words' }, { id: 2, source: 'live', text: 'More words' }];
  assert.deepEqual(ids(findPassages(live, 'more')), [2]);
  assert.deepEqual(findPassages(undefined, 'x'), []);
  assert.deepEqual(findPassages(null, ''), []);
});

test('10: afterDelete lands on Customer research for the same venture, and never puts a stray value in the URL', () => {
  assert.equal(afterDelete(7), '/validate/customer-research?project_id=7');
  assert.equal(afterDelete('12'), '/validate/customer-research?project_id=12');
  assert.equal(afterDelete(' 7 '), '/validate/customer-research?project_id=7', 'surrounding space is not part of the id');
  for (const bad of [null, undefined, '', '0', 0, -3, '7&admin=1', '07', 'abc', 1.5, '1e3']) {
    assert.equal(afterDelete(bad), '/validate/customer-research', String(bad));
  }
});

// ---------------------------------------------------------------------------
// Step 7 — TranscriptReview's time
// ---------------------------------------------------------------------------

test('7: with time, each passage starts with its [hh:mm:ss]; a passage with no start draws none', () => {
  const out = html(h(TranscriptReview, { segments: SEGMENTS, intervieweeName: 'Dana Ruiz', onAssign: () => {}, time: true }));
  assert.match(out, /data-testid="seg-time-91"[^>]*>\[00:00:00\]</);
  assert.match(out, /data-testid="seg-time-92"[^>]*>\[00:00:09\]</);
  assert.match(out, /data-testid="seg-time-93"[^>]*>\[01:02:05\]</);
  assert.doesNotMatch(out, /seg-time-94/, 'an absent start is drawn as absent');
  assert.doesNotMatch(out, /seg-time-90/, 'the live draft is not drawn beside the finals');
  assert.match(out, /dark:text-gray-400/);
});

test('7: /validate/session/:id\'s transcript still draws no time', () => {
  const out = html(h(TranscriptReview, { segments: SEGMENTS, intervieweeName: 'Dana Ruiz', onAssign: () => {} }));
  assert.doesNotMatch(out, /seg-time-/);
  assert.doesNotMatch(out, /\[\d\d:\d\d:\d\d\]/);
  assert.match(out, /We lose a full day every week reconciling them\./);
  // The session page's own call passes no `time`.
  const page = read('frontend/src/pages/founder/InterviewSessionPage.jsx');
  const calls = [...page.matchAll(/<TranscriptReview\b[^>]*\/>/g)].map((m) => m[0]);
  assert.equal(calls.length, 1, 'one transcript on the session page');
  assert.doesNotMatch(calls[0], /\btime\b/);
  // The record (PR 2) is the one caller that passes it.
  assert.match(read('frontend/src/pages/founder/InterviewReviewPage.jsx'), /<TranscriptReview\b[^>]*\btime \/>/);
});

// ---------------------------------------------------------------------------
// Step 8 — PainSeverity, moved
// ---------------------------------------------------------------------------

test('8: PainSeverity lives in validatePieces.jsx with its docblock, and the old page that forked it is gone', () => {
  const pieces = read('frontend/src/pages/founder/validatePieces.jsx');
  assert.match(pieces, /export function PainSeverity\(\{ interviewId, pains, onChanged \}\)/);
  assert.match(pieces, /\/\*\*\n \* How severe was this pain, in this conversation\?\n \*\n \* WRITES `interview_pain_severities`/, 'the docblock moved with it');
  assert.match(pieces, /^import \{ api \} from '\.\.\/\.\.\/lib\/api';$/m);
  assert.match(pieces, /`PainSeverity` \("How badly did they need it\?"\) moved here/, 'the file\'s docblock names it');
  // D704 (#1666) deleted FounderValidateWorkspace, so the record is its one home.
  assert.equal(existsSync(resolve(process.cwd(), 'frontend/src/workspaces/founder/FounderValidateWorkspace.jsx')), false);
  assert.match(read('frontend/src/pages/founder/InterviewReviewPage.jsx'), /<PainSeverity\b/, 'the interview record draws it');
});

async function mountSeverity(props) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(PainSeverity, props)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => walk(container).filter((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    all, pr, settle, text: () => text(container).replace(/\s+/g, ' '),
    async press(id, i = 0) { await act(async () => { await pr(all(id)[i]).onClick?.(); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

test('8: PainSeverity behaves as it did on FVW: a press saves, pressing again clears, and a failed save rolls back', async () => {
  const real = api.setInterviewPainSeverity;
  const calls = [];
  let fail = false;
  api.setInterviewPainSeverity = async (id, phrase, severity) => {
    calls.push([id, phrase, severity]);
    if (fail) throw new Error('That judgement was not saved.');
    return { severity };
  };
  let changed = 0;
  const m = await mountSeverity({ interviewId: 41, pains: ['reconciling by hand', { pain: 'late invoices' }, ''], onChanged: () => { changed += 1; } });
  try {
    assert.ok(m.text().includes('How badly did they need it?'));
    assert.equal(m.all('button-pain-severity-need').length, 2, 'one row per phrase; an empty phrase draws none');
    await m.press('button-pain-severity-need', 0);
    assert.deepEqual(calls.at(-1), [41, 'reconciling by hand', 'need']);
    assert.equal(m.pr(m.all('button-pain-severity-need')[0])['aria-pressed'], true);
    assert.equal(changed, 1);
    await m.press('button-pain-severity-need', 0);
    assert.deepEqual(calls.at(-1), [41, 'reconciling by hand', null], 'pressing the current answer clears it');
    await m.press('button-pain-severity-nice', 1);
    assert.deepEqual(calls.at(-1), [41, 'late invoices', 'nice']);
    fail = true;
    await m.press('button-pain-severity-need', 1);
    assert.equal(m.pr(m.all('button-pain-severity-nice')[1])['aria-pressed'], true, 'the failed write rolls the row back');
    assert.equal(m.pr(m.all('button-pain-severity-need')[1])['aria-pressed'], false);
    assert.ok(m.text().includes('That judgement was not saved.'));
  } finally {
    api.setInterviewPainSeverity = real;
    await m.unmount();
  }
});

// ---------------------------------------------------------------------------
// PR 2 — the record (tests 7 to 10)
// ---------------------------------------------------------------------------

const S = (id, status) => ({ id, status, channel: 'in_person', created_at: `2026-10-0${id} 10:00:00`, interview_id: 5 });
const FED = { key: 'fed', title: 'What it fed', gate: 'read', side: true, rows: [{ a: 'Manual reconciliation', b: '1 supports · 0 contradicts' }] };
const WRITER = {
  cycle: 'validate', module: 'customer-research', id: '5', title: 'Rowan Vale', sub: 'Ops lead at Kestrel · 7 Oct · 34 min',
  pills: [{ text: 'Strong fit', tone: 'ok' }, 'Transcribed'],
  facts: [{ label: 'Captured', value: 'Recorded in StudioOS' }, { label: 'Consent', value: 'Said yes out loud' },
    { label: 'ICP fit', value: 'Strong · Segment A' }, { label: 'Need-to-have', value: null, reason: 'No pain is judged yet.' }],
  main: [{ key: 'transcript', title: 'Transcript', gate: 'write', rows: [] }, { key: 'placements', title: 'Eadwyn’s placements', gate: 'write', rows: [] }],
  side: [FED, { key: 'cost', title: 'Cost', gate: 'write', side: true, rows: [] },
    { key: 'session', title: 'Session', gate: 'write', side: true, rows: [{ a: 'Waiting for messages', href: '/validate/session/9' }] }],
  actions: [
    { key: 'edit-details', kind: 'form', label: 'Edit details', tone: 'default', form: { title: 'Edit details', fields: [{ key: 'interviewee_name', label: 'Name', kind: 'T', value: 'Rowan Vale', required: true }, { key: 'interviewee_company', label: 'Company', kind: 'T', value: 'Kestrel' }] } },
    { key: 'delete', kind: 'write', label: 'Delete', tone: 'danger' },
    { key: 'open-recording', kind: 'write', label: 'Open recording', tone: 'primary' },
  ],
  activity: [{ a: 'Interview 5 details edited by Fay Founder', b: '2026-10-08' }], activity_total: 1,
};
// A partner's read (D690 decision 2): no writer-only section, no action.
const PARTNER = { ...WRITER, main: [], side: [FED], actions: [] };

function fakes({ items = [S(9, 'draft'), S(7, 'transcribed'), S(6, 'reviewed')], rows = null, audio = null } = {}) {
  const calls = [];
  const sessions = {
    list: async (id) => { calls.push(['list', id]); return { interview: { id: 5, project_id: 7 }, items }; },
    get: async (id) => { calls.push(['get', id]); return { session: items.find((x) => String(x.id) === String(id)), summary: null, processing: null, segments: SEGMENTS }; },
    receipt: async (id) => { calls.push(['receipt', id]); return { items: [{ kind: 'final', model: `whisper-of-${id}`, cost_microusd: 1000 * id }] }; },
    placements: async (id) => { calls.push(['placements', id]); return PLACEMENTS_ONE_RUN; },
    audio: audio || (async (id) => { calls.push(['audio', id]); return { parts: [] }; }),
    summarise: async () => ({}), setSpeaker: async () => ({}),
  };
  const apiFake = {
    listInterviews: async (pid) => { calls.push(['listInterviews', pid]); return rows ?? { project_id: 7, interviews: [{ id: 5, interviewee_name: 'Rowan Vale', icp_fit: 'strong', quote_consent: true, interviewee_company: 'Kestrel', pains: [] }] }; },
    updateInterviewEvidence: async (id, patch) => { calls.push(['evidence', id, patch]); return {}; },
  };
  const actCalls = [];
  const actFn = async (key, body) => { actCalls.push([key, body]); return { ok: true }; };
  return { calls, sessions, api: apiFake, act: actFn, actCalls };
}

/** A fake DOM with the helpers both harnesses share. */
function dom() {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const n = create(tag); n.querySelector = () => null; n.querySelectorAll = () => []; n.focus = () => {}; n.scrollIntoView = () => {}; n.children = []; n.dataset = {}; return n; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const out = { path: null, search: null };
  function Probe() { const l = useLocation(); out.path = `${l.pathname}${l.search}`; return null; }
  const api_ = {
    container, root, walk, pr, settle, out, Probe,
    by: (id, from = container) => walk(from).find((n) => pr(n)['data-testid'] === id),
    text: (from = container) => text(from).replace(/\s+/g, ' '),
    fiber(name) { for (const n of walk(container)) { const k = Object.keys(n).find((x) => x.startsWith('__reactFiber$')); let f = k && n[k]; while (f) { if (f.type?.name === name) return f; f = f.return; } } return null; },
    // Below 1024px a record's action is a phone row, "<label> ›" (D703 step 7).
    async press(label) { const n = walk(container).find((x) => x.tagName === 'BUTTON' && text(x).replace(/\s+/g, ' ').trim().replace(/ ›$/, '') === label); assert.ok(n, `button ${label}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async click(id) { const n = api_.by(id); assert.ok(n, id); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async change(id, value) { const n = api_.by(id); assert.ok(n, id); await act(async () => { pr(n).onChange({ target: { value } }); }); await settle(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
  return api_;
}

/** The record on its own, its dialogs held by a stand-in for CycleRoute's openDialog. */
async function recordMount(f, read = WRITER, url = '/validate/customer-research/5?project_id=7') {
  const d = dom();
  const opened = [];
  function Host() {
    const [dialog, setDialog] = React.useState(null);
    return h(React.Fragment, null,
      h(InterviewRecord, { read, id: '5', projectId: 7, sessions: f.sessions, api: f.api, act: f.act, reload: () => {}, openDialog: (el, opts) => { opened.push(opts || {}); setDialog(el); } }),
      dialog);
  }
  await act(async () => d.root.render(h(MemoryRouter, { initialEntries: [url] }, h(d.Probe), h(Routes, null,
    h(Route, { path: '/validate/customer-research/:id', element: h(Host) }),
    h(Route, { path: '/validate/customer-research', element: h('p', null, 'Customer research') }),
  ))));
  await d.settle();
  return { ...d, opened };
}

const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: (k) => (/content-type/i.test(k) ? 'application/json' : null) }, json: async () => body, text: async () => JSON.stringify(body), blob: async () => new Blob(['x']) });

/** The record inside CycleRoute's record mode, every request answered by `handler`. */
async function routeMount(handler, { url = '/validate/customer-research/5?project_id=7', phone = false } = {}) {
  const d = dom();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, o = {}) => { requests.push({ url: String(u), options: o }); return handler(String(u), o); };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  if (globalThis.window && globalThis.window !== globalThis) globalThis.window.matchMedia = globalThis.matchMedia;
  await act(async () => d.root.render(h(MemoryRouter, { initialEntries: [url] }, h(d.Probe), h(Routes, null,
    h(Route, { path: '/validate/customer-research/:id', element: h(CycleRoute, { cycle: 'validate', slug: 'customer-research', record: true }) }),
    h(Route, { path: '/validate/customer-research', element: h('p', null, 'Customer research') }),
  ))));
  await d.settle();
  const close = d.close;
  return { ...d, requests, async close() { await close(); Object.assign(globalThis, previous); } };
}
const routeHandler = (read = WRITER, extra = () => null) => (url, o) => extra(url, o)
  ?? (url.includes('/cycles/validate/modules/customer-research/records/5?') ? json(read)
    : url.includes('/founder/validate/interviews/5/sessions') ? json({ interview: { id: 5, project_id: 7 }, items: [S(7, 'transcribed')] })
      : url.includes('/founder/validate/sessions/7/receipt') ? json({ items: [] })
        : url.includes('/founder/validate/sessions/7/placements') ? json(PLACEMENTS_ONE_RUN)
          : url.includes('/founder/validate/sessions/7') ? json({ session: S(7, 'transcribed'), segments: SEGMENTS })
            : url.includes('/progress/discovery/7') ? json({ project_id: 7, interviews: [{ id: 5, interviewee_name: 'Rowan Vale', pains: [] }] })
              : json({}));
const classes = (d) => d.walk(d.container).map((n) => String(d.pr(n).className || '')).join(' ');

test('7: the record renders inside the cycle body with "‹ Back to Customer research", and no max-w-5xl inset or breadcrumb', async () => {
  const m = await routeMount(routeHandler());
  try {
    const body = m.by('cycle-route-body');
    assert.ok(body, 'the cycle body');
    assert.ok(m.by('interview-record', body), 'the record is inside it');
    assert.match(m.text(), /‹ Back to Customer research/);
    assert.doesNotMatch(classes(m), /max-w-5xl/);
    assert.equal(m.by('interview-review-page'), undefined, 'the old page frame is gone');
  } finally { await m.close(); }
});

test('7: a writer\'s record shows the facts (a null one as Not recorded with its reason), the transcript with its switcher, summary, times and Search', async () => {
  const f = fakes();
  const m = await recordMount(f);
  try {
    const facts = m.text(m.by('record-facts'));
    for (const v of ['Recorded in StudioOS', 'Said yes out loud', 'Strong · Segment A', 'Not recorded', 'No pain is judged yet.']) assert.ok(facts.includes(v), v);
    assert.ok(m.text().includes('Strong fit'), 'a pill');
    assert.deepEqual(f.calls.filter((c) => c[0] === 'get'), [['get', 7]], 'the newest reviewable session, not the draft');
    assert.ok(m.by('session-switcher'));
    assert.ok(m.by('summary-none'));
    const transcript = m.text(m.by('record-transcript'));
    assert.match(transcript, /\[00:00:09\]/);
    assert.match(transcript, /\[01:02:05\]/);
    const before = f.calls.length;
    await m.change('transcript-search', 'Reconciling');
    const narrowed = m.text(m.by('record-transcript'));
    assert.match(narrowed, /We lose a full day every week reconciling them\./);
    assert.doesNotMatch(narrowed, /We use two systems\./);
    assert.equal(f.calls.length, before, 'Search calls nothing');
    await m.change('transcript-search', 'no such words');
    assert.ok(m.by('transcript-no-match'));
  } finally { await m.close(); }
});

test('7: the placements and Cost show; switching the session re-reads its receipt, and Cost follows', async () => {
  const f = fakes();
  const m = await recordMount(f);
  try {
    assert.ok(m.by('placement-1'), 'ReviewStep draws the proposed findings');
    assert.match(m.text(m.by('record-cost')), /final · whisper-of-7/);
    await m.change('session-switcher', '6');
    assert.equal(m.out.path, '/validate/customer-research/5?project_id=7&session=6');
    assert.deepEqual(f.calls.filter((c) => c[0] === 'receipt').at(-1), ['receipt', 6]);
    const cost = m.text(m.by('record-cost'));
    assert.match(cost, /whisper-of-6/);
    assert.doesNotMatch(cost, /whisper-of-7/);
  } finally { await m.close(); }
});

test('7: What it fed, Session, Activity and the four tools show; Record a session opens the lightbox for this interview', async () => {
  const f = fakes();
  const m = await recordMount(f);
  try {
    const all = m.text();
    assert.match(all, /What it fed/); assert.match(all, /Manual reconciliation/);
    assert.match(all, /Waiting for messages/);
    assert.match(all, /Interview 5 details edited by Fay Founder/);
    const tools = m.by('interview-tools');
    assert.ok(tools, 'the tools');
    assert.ok(m.by('interview-evidence', tools), 'Evidence');
    assert.ok(m.fiber('InterviewRecording'), 'Recording');
    const link = m.by('link-record-session');
    assert.equal(m.pr(link).href, '/validate/record?interview=5&project_id=7');
    const fiberKey = Object.keys(link).find((k) => k.startsWith('__reactFiber$'));
    let lf = link[fiberKey];
    while (lf && lf.type?.displayName !== 'Link' && lf.type?.name !== 'Link' && !(lf.memoizedProps && 'to' in lf.memoizedProps)) lf = lf.return;
    assert.deepEqual(lf.memoizedProps.state, { under: '/validate/customer-research/5?project_id=7' }, 'Back returns to the record');
    assert.deepEqual(f.calls.find((c) => c[0] === 'listInterviews'), ['listInterviews', 7], 'the row is read fresh, for its venture');
  } finally { await m.close(); }
});

test('8: Edit details opens FormLightbox as a page through openDialog and saves only the name and the company', async () => {
  const f = fakes();
  const m = await recordMount(f);
  try {
    await m.press('Edit details');
    assert.deepEqual(m.opened.at(-1), { page: true });
    const form = m.fiber('FormLightbox');
    await act(async () => { await form.memoizedProps.onSubmit({ interviewee_name: 'Rowan V.', interviewee_company: '' }); });
    assert.deepEqual(f.actCalls, [['edit-details', { interviewee_name: 'Rowan V.', interviewee_company: '' }]]);
  } finally { await m.close(); }
});

test('8: at 1024px and up Edit details and Delete\'s confirm render after the size container; below it the form is the body\'s only child', async () => {
  const desktop = await routeMount(routeHandler());
  try {
    await desktop.press('Edit details');
    const body = desktop.by('cycle-route-body');
    const form = desktop.by('cycle-form');
    assert.ok(form, 'the form');
    assert.equal(desktop.walk(body.parentNode).includes(form), false, 'not inside the size container');
    await desktop.press('Cancel');
    await desktop.press('Delete');
    const confirm = desktop.by('delete-interview-confirm');
    assert.ok(confirm);
    assert.equal(desktop.walk(body.parentNode).includes(confirm), false, 'the confirm too');
    // Confirm: the record's delete action, then Customer research for the venture.
    await desktop.click('button-confirm-delete');
    assert.ok(desktop.requests.some((r) => r.options.method === 'POST' && r.url.endsWith('/api/cycles/validate/modules/customer-research/records/5/actions/delete?project=7')));
    assert.equal(desktop.out.path, '/validate/customer-research?project_id=7');
  } finally { await desktop.close(); }
  const phone = await routeMount(routeHandler(), { phone: true });
  try {
    await phone.press('Edit details');
    const body = phone.by('cycle-route-body');
    // Below 1024px FormLightbox is a page (pageBelow="lg"): its <form> sits in the body.
    assert.ok(phone.fiber('FormLightbox'), 'the form is open');
    assert.ok(phone.walk(body).some((n) => n.tagName === 'FORM'), 'the form is inside the body');
    assert.match(phone.text(body), /Edit details.*Name.*Company.*Save/);
    assert.equal(phone.by('interview-record', body), undefined, 'and is its only content: the record is not drawn beside it');
  } finally { await phone.close(); }
});

test('8: Open recording fetches each part once as a blob and plays them in seq order; an expired part asks again; a replay fetches nothing; a 404 prints its sentence', async () => {
  const later = new Date(Date.now() + 120_000).toISOString();
  const earlier = new Date(Date.now() - 1000).toISOString();
  const answers = [
    { parts: [{ seq: 1, url: '/api/files/dl/b', mime: 'audio/webm', start_ms: 60000, expires_at: later }, { seq: 0, url: '/api/files/dl/a', mime: 'audio/webm', start_ms: 0, expires_at: later }] },
  ];
  const audioCalls = [];
  const f = fakes({ audio: async (id) => { audioCalls.push(id); return answers.shift() || { parts: [] }; } });
  const fetched = [];
  const previous = { fetch: globalThis.fetch, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  let n = 0;
  globalThis.fetch = async (u) => { fetched.push(String(u)); return { ok: true, blob: async () => new Blob([String(u)]) }; };
  URL.createObjectURL = () => `blob:${n++}`;
  URL.revokeObjectURL = () => {};
  const m = await recordMount(f);
  try {
    await m.press('Open recording');
    assert.deepEqual(audioCalls, [7], 'the chosen session');
    assert.deepEqual(fetched, ['/api/files/dl/a', '/api/files/dl/b'], 'each part once, in seq order');
    const player = m.by('record-player');
    assert.equal(player.src, 'blob:0');
    await act(async () => { player.onended(); });
    assert.equal(player.src, 'blob:1', 'then the next part');
    await m.press('Open recording');
    assert.deepEqual(audioCalls, [7], 'a replay asks for no URL');
    assert.equal(fetched.length, 2, 'and fetches nothing');
    assert.equal(player.src, 'blob:0');
  } finally { await m.close(); }
  // An expired URL: the route is asked again, and the fresh URL is fetched.
  const answers2 = [
    { parts: [{ seq: 0, url: '/api/files/dl/old', expires_at: earlier }] },
    { parts: [{ seq: 0, url: '/api/files/dl/fresh', expires_at: later }] },
  ];
  const calls2 = [];
  const f2 = fakes({ audio: async (id) => { calls2.push(id); return answers2.shift(); } });
  fetched.length = 0;
  const m2 = await recordMount(f2);
  try {
    await m2.press('Open recording');
    assert.deepEqual(calls2, [7, 7]);
    assert.deepEqual(fetched, ['/api/files/dl/fresh'], 'the expired URL is never fetched');
  } finally { await m2.close(); }
  const f3 = fakes({ audio: async () => { const e = new Error('This session has no recorded audio.'); e.status = 404; throw e; } });
  const m3 = await recordMount(f3);
  try {
    await m3.press('Open recording');
    assert.match(m3.text(m3.by('record-audio-error')), /This session has no recorded audio\./);
  } finally { await m3.close(); Object.assign(globalThis, { fetch: previous.fetch }); URL.createObjectURL = previous.create; URL.revokeObjectURL = previous.revoke; }
});

test('9: a partner\'s read draws no transcript, placements, cost, session, tool or action, keeps the facts and What it fed, and calls no session route', async () => {
  const f = fakes();
  const m = await recordMount(f, PARTNER);
  try {
    const all = m.text();
    for (const absent of ['record-transcript', 'interview-review-findings', 'record-cost', 'interview-tools']) assert.equal(m.by(absent), undefined, absent);
    assert.doesNotMatch(all, /Waiting for messages|Edit details|Open recording|Delete/);
    assert.match(m.text(m.by('record-facts')), /Recorded in StudioOS/);
    assert.match(all, /Manual reconciliation/);
    assert.deepEqual(f.calls, [], 'no call to the session routes and none to listInterviews');
  } finally { await m.close(); }
  const parts = recordParts(PARTNER);
  assert.equal(parts.sessions, false);
  assert.equal(parts.tools, false);
  assert.equal(recordParts(WRITER).placements.title, 'Eadwyn’s placements', 'found by key or title');
  assert.equal(recordParts({ main: [{ key: 'x', title: 'Eadwyn\'s placements' }] }).placements.key, 'x');
});

test('10: a record the read answers 404 shows "Record not found." and calls no session route', async () => {
  const m = await routeMount(routeHandler(WRITER, (url) => (url.includes('/records/5?') ? json({ detail: 'Record not found.' }, 404) : null)));
  try {
    assert.match(m.text(), /Record not found\./);
    assert.equal(m.requests.some((r) => r.url.includes('/founder/validate/')), false);
    assert.equal(m.requests.some((r) => r.url.includes('/progress/discovery/')), false);
  } finally { await m.close(); }
});

test('10: an id missing from the venture\'s interviews draws no tool control and sends no write; a ?session= of another interview falls back', async () => {
  const f = fakes({ rows: { project_id: 7, interviews: [{ id: 99, interviewee_name: 'Someone else' }] } });
  const m = await recordMount(f, WRITER, '/validate/customer-research/5?project_id=7&session=44');
  try {
    assert.match(m.text(m.by('interview-tools')), /This interview could not be read\./);
    assert.equal(m.by('interview-evidence'), undefined);
    assert.equal(m.by('link-record-session'), undefined);
    assert.equal(f.calls.some((c) => c[0] === 'evidence'), false);
    assert.deepEqual(f.calls.filter((c) => c[0] === 'get'), [['get', 7]], '?session=44 is not this interview\'s: the newest reviewable one');
  } finally { await m.close(); }
});

