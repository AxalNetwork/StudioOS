/**
 * D757 §2.5, §2.7 and §2.12 (#1927) — the session page's summary and
 * suggestions, for every source: the digest for a writer and for a reader,
 * Keep and Edit with the quote rule, the suggestions under all seven Validate
 * modules with their source lines, Accept all with a mixed outcome, the
 * engine's state in the Worker's words, and the Record finish line. Fixture
 * people are synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/session_digest_ui_d757.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { renderedText } from './_renderedText.mjs';
import { installDocument } from './_contracts_dom.mjs';
import {
  BUDGET_TAIL, VALIDATE_MODULES, VERDICT_NOTE, acceptAllOutcome, digestEdit, digestState, editDraft, engineState,
  groupBySlug, heardIn, hms, isThread, lineFor, messageTime, sourceBadge, spansOf,
} from '../src/pages/founder/sessionDigestModel.js';
import { DigestView, EngineLine } from '../src/pages/founder/SessionSummary.jsx';
import { ModuleSuggestions } from '../src/pages/founder/InterviewReview.jsx';
import { REVIEW_INITIAL, makeReviewActions } from '../src/pages/founder/InterviewSessionPage.jsx';
import { createRecorder, finishLine, pendingSuggestions } from '../src/lib/activeRecording.js';
import { memoryQueue } from '../src/lib/interviewCapture.js';
import { liveRedirect } from '../src/pages/founder/RecordLivePage.jsx';
import { ADD_TOKENS_PATH } from '../src/lib/aiTokens.js';

const html = (el) => renderToStaticMarkup(el);
const txt = (el) => renderedText(html(el));

// A recorded call: final lines with times, one live line the page never cites.
const SEGMENTS = [
  { id: 90, source: 'live', start_ms: 0, end_ms: 4000, speaker_label: 'Speaker ?', text: 'live words' },
  { id: 11, source: 'final', start_ms: 0, end_ms: 4000, speaker_label: 'Me', text: 'How do you reconcile invoices today?' },
  { id: 12, source: 'final', start_ms: 4000, end_ms: 751000, speaker_label: 'Dana', text: 'By hand, every Friday.' },
  { id: 13, source: 'final', start_ms: 751000, end_ms: 760000, speaker_label: 'Dana', text: 'We looked at Ledgerly.' },
];
// A chat thread: lines with no time, each with the moment it arrived.
const CHAT = [
  { id: 21, source: 'final', start_ms: null, end_ms: null, speaker_label: 'Me', text: 'How do you close the month?', created_at: '2026-10-18 09:00:00' },
  { id: 22, source: 'final', start_ms: null, end_ms: null, speaker_label: 'Dana', text: 'Spreadsheets, late at night.', created_at: '2026-10-19 10:05:12' },
];

const DIGEST = {
  kept: false, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', overview: [
    { text: 'Dana reconciles by hand every Friday.', cite: { from: 4000, to: 751000 } },
    { text: 'They tried Ledgerly.', cite: { from: 751000, to: 760000 } },
  ],
  key_quotes: [{ quote: 'By hand, every Friday.', speaker: 'Dana', start_ms: 754000, segment_id: 12 }],
  decisions: [{ text: 'Send a pilot proposal.', cite: { from: 751000, to: 760000 } }],
  next_steps: [{ text: 'Email the pilot terms', who: 'me', cite: null }],
  sections: { pain_points: [{ proposal_id: 5, kind: 'pain_severity', status: 'pending', payload: { phrase: 'Reconcile by hand' }, quote: 'By hand, every Friday.' }], jobs_to_be_done: [], objections: [], willingness_to_pay: [], competitors: [] },
};

const place = (id, slug, extra = {}) => ({ id, kind: 'timing', slug, status: 'pending', payload: { when: 'soon' }, can_accept: true, cite: { from: 4000, to: 751000, quote: 'By hand, every Friday.' }, ...extra });
const READ = {
  runs: [
    { run_id: 'old', model: 'm', source: 'studioos', placements: [place(1, 'demand-signals')] },
    { run_id: 'new', model: 'm', source: 'studioos', placements: [
      place(2, 'problem-discovery', { kind: 'pain_severity', payload: { phrase: 'Reconcile by hand', severity: 'severe' } }),
      place(3, 'customer-research'), place(4, 'ideal-customer-profile'), place(5, 'market-intelligence'),
      place(6, 'demand-signals'), place(7, 'demand-signals', { status: 'accepted' }), place(8, 'demand-signals'),
      place(9, 'experiments'),
    ] },
  ],
};

// ── each engine state, in the Worker's words ────────────────────────────────

test('each engine state reads as a word and the Worker\'s own sentence; a budget refusal offers Add tokens', () => {
  const budget = `You've used today's AI allowance.${BUDGET_TAIL}`;
  const cases = [
    ['queued', null, 'Waiting to summarise'],
    ['running', null, 'Summarising and finding suggestions'],
    ['done', 'Axal suggested what it heard.', 'Summary drafted'],
    ['refused', budget, 'Not summarised'],
    ['refused', 'This transcript is too long to summarise in one go.', 'Not summarised'],
    ['skipped', 'Manual mode is on for Validate, so Axal did not summarise or structure this. Use Summarise and Structure on the session.', 'Not summarised'],
  ];
  for (const [status, note, word] of cases) {
    const e = engineState({ digest_status: status, digest_note: note });
    assert.equal(e.word, word, status);
    assert.equal(e.note, note, status);
    assert.equal(e.busy, status === 'queued' || status === 'running', status);
    const out = txt(React.createElement(EngineLine, { session: { digest_status: status, digest_note: note } }));
    assert.ok(out.startsWith(word), out);
    if (note) assert.ok(out.includes(note), 'the sentence is the Worker\'s, as written');
  }
  assert.equal(engineState({ digest_status: 'refused', digest_note: budget }).addTokens, ADD_TOKENS_PATH);
  assert.match(html(React.createElement(EngineLine, { session: { digest_status: 'refused', digest_note: budget } })), new RegExp(`href="${ADD_TOKENS_PATH}"[^>]*data-testid="link-engine-add-tokens"`));
  for (const note of [cases[4][1], null]) assert.equal(engineState({ digest_status: 'refused', digest_note: note }).addTokens, null, 'only the allowance offers Add tokens');
  assert.equal(engineState({ digest_status: 'done', digest_note: budget }).addTokens, null, 'and only on a refusal');
  for (const s of [null, undefined, 'unknown']) assert.equal(engineState({ digest_status: s }), null);
  assert.equal(html(React.createElement(EngineLine, { session: {} })), '');
  // The tail is the engine's own: the two cannot part.
  const engine = readFileSync('cloudflare-worker/src/services/validateEngine.ts', 'utf8');
  assert.ok(engine.includes(`budgetTail: '${BUDGET_TAIL}'`), 'BUDGET_TAIL is NOTES.budgetTail');
});

// ── each digest state, for a writer and for a reader ────────────────────────

test('a writer sees the draft with Keep and Edit; a reader sees only a kept digest, never a draft', () => {
  assert.deepEqual(digestState(null, { writer: true }), { kind: 'none' });
  assert.deepEqual(digestState(DIGEST, { writer: false }), { kind: 'none' });
  assert.deepEqual(digestState(DIGEST, { writer: true }), { kind: 'draft', label: 'Draft · written by @cf/meta/llama-3.3-70b-instruct-fp8-fast', canEdit: true });
  assert.deepEqual(digestState({ ...DIGEST, kept: true }, { writer: false }), { kind: 'kept', label: 'Kept summary', canEdit: false });
  assert.equal(digestState({ ...DIGEST, model: null }, { writer: true }).label, 'Draft · written by a model not recorded');

  const draft = html(React.createElement(DigestView, { digest: DIGEST, writer: true, segments: SEGMENTS, session: { channel: 'video' } }));
  assert.match(draft, /data-kind="draft"/);
  assert.match(draft, /Draft · written by @cf\/meta\/llama-3\.3-70b-instruct-fp8-fast/);
  assert.match(draft, /data-testid="button-digest-keep"/);
  assert.match(draft, /data-testid="button-digest-edit"/);
  assert.match(draft, /data-testid="source-badge">Video</);
  assert.equal(html(React.createElement(DigestView, { digest: DIGEST, writer: false, segments: SEGMENTS })), '', 'a reader is never shown a draft');
  const kept = html(React.createElement(DigestView, { digest: { ...DIGEST, kept: true }, writer: false, segments: SEGMENTS }));
  assert.match(kept, /data-kind="kept"/);
  assert.doesNotMatch(kept, /button-digest-keep|button-digest-edit/, 'a kept digest has nothing to keep');
  assert.equal(html(React.createElement(DigestView, { digest: null, writer: true })), '');
});

test('the digest links each sentence to its passage, and each key quote has its speaker and time chips', () => {
  const out = html(React.createElement(DigestView, { digest: DIGEST, writer: true, segments: SEGMENTS }));
  assert.deepEqual([...out.matchAll(/href="#seg-(\d+)"[^>]*data-testid="digest-cite"/g)].map((m) => m[1]), ['12', '13', '13'], 'overview twice, the decision once: final lines only');
  assert.match(out, /data-testid="digest-quote-speaker">Dana</);
  assert.match(out, /href="#seg-12"[^>]*data-testid="digest-quote-time">00:12:34</);
  const text = renderedText(out);
  for (const s of ['Decisions', 'Send a pilot proposal.', 'Next steps', 'Email the pilot terms', '· You', 'Pain points', 'Reconcile by hand']) assert.ok(text.includes(s), s);
  // A cite the transcript does not hold stays text: no dead link.
  const lost = html(React.createElement(DigestView, { digest: { ...DIGEST, overview: [{ text: 'x', cite: { from: 9e6, to: 9e6 + 1 } }], decisions: [] }, writer: true, segments: SEGMENTS }));
  assert.match(lost, /data-testid="digest-cite-text"/);
  assert.doesNotMatch(lost, /data-testid="digest-cite"/);
});

// ── Keep, Edit and the quote rule ───────────────────────────────────────────

test('Edit rewords or removes a sentence or a step, and removes a quote but never rewrites one', () => {
  const draft = editDraft(DIGEST);
  draft.overview[0].text = '  Dana reconciles by hand, every Friday afternoon.  ';
  draft.overview[1].removed = true;
  draft.next_steps[0].who = 'them';
  assert.deepEqual(digestEdit(DIGEST, draft), {
    overview: [{ index: 0, text: 'Dana reconciles by hand, every Friday afternoon.' }],
    next_steps: [{ index: 0, text: 'Email the pilot terms', who: 'them' }],
    key_quotes: ['By hand, every Friday.'],
  });
  // A quote rewritten in the draft is not sent at all: only the digest's own words are.
  const rewritten = editDraft(DIGEST);
  rewritten.key_quotes[0].quote = 'By hand, every single Friday.';
  assert.deepEqual(digestEdit(DIGEST, rewritten).key_quotes, []);
  const removed = editDraft(DIGEST);
  removed.key_quotes[0].removed = true;
  assert.deepEqual(digestEdit(DIGEST, removed).key_quotes, []);
  const none = editDraft(DIGEST);
  for (const o of none.overview) o.removed = true;
  assert.equal(digestEdit(DIGEST, none), null, 'at least one overview sentence stays');
  const blank = editDraft(DIGEST);
  for (const o of blank.overview) o.text = '   ';
  assert.equal(digestEdit(DIGEST, blank), null);
});

async function mount(element) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const click = async (id) => { const n = byId(id); assert.ok(n, id); await act(async () => { await props(n).onClick({ preventDefault() {} }); }); };
  const done = async () => { await act(async () => root.unmount()); restore(); };
  return { container, byId, click, done, props };
}

test('Keep keeps the draft; Edit removes a quote and saves, and an empty overview is refused before anything is sent', async () => {
  const kept = []; const edits = [];
  const m = await mount(React.createElement(DigestView, { digest: DIGEST, writer: true, segments: SEGMENTS, onKeep: () => kept.push(1), onEdit: (e) => { edits.push(e); return true; } }));
  try {
    await m.click('button-digest-keep');
    assert.equal(kept.length, 1);
    await m.click('button-digest-edit');
    assert.ok(m.byId('digest-edit'));
    assert.equal(m.byId('edit-quote-0').tagName, 'SPAN', 'a quote is shown, never an input');
    await m.click('edit-quote-remove-0');
    await m.click('button-digest-save');
    assert.deepEqual(edits, [{ overview: [{ index: 0, text: DIGEST.overview[0].text }, { index: 1, text: DIGEST.overview[1].text }], next_steps: [{ index: 0, text: 'Email the pilot terms', who: 'me' }], key_quotes: [] }]);
    assert.equal(m.byId('digest-edit'), undefined, 'saved, the editor closes');
    await m.click('button-digest-edit');
    await m.click('edit-overview-remove-0');
    await m.click('edit-overview-remove-1');
    await m.click('button-digest-save');
    assert.equal(edits.length, 1, 'nothing sent');
    assert.equal(m.byId('digest-edit-error').textContent, 'Keep at least one overview sentence.');
  } finally { await m.done(); }
});

// ── the suggestions, grouped across all seven modules, with source links ───

test('the suggestions are grouped under all seven modules, from the latest run, each linked to its line', () => {
  const groups = groupBySlug(READ);
  assert.deepEqual(groups.map((g) => g.slug), VALIDATE_MODULES.map(([s]) => s), 'all seven, in the canvas\'s order');
  assert.deepEqual(groups.map((g) => g.placements.map((p) => p.id)), [[2], [3], [4], [5], [6, 7, 8], [9], []], 'the older run\'s placement is not listed');
  assert.deepEqual(groups.map((g) => g.pending), [1, 1, 1, 1, 2, 1, 0]);
  // A placement with no slug the page knows is listed under Other, never dropped.
  const odd = groupBySlug({ runs: [{ run_id: 'r', placements: [place(1, null)] }] });
  assert.deepEqual([odd.length, odd.at(-1).slug, odd.at(-1).placements.map((p) => p.id)], [8, 'other', [1]]);

  const out = html(React.createElement(ModuleSuggestions, { read: READ, segments: SEGMENTS, interviewee: 'Dana Example', onAcceptAll: () => {} }));
  for (const [slug] of VALIDATE_MODULES) assert.match(out, new RegExp(`data-testid="suggestions-${slug}"`), slug);
  assert.ok(renderedText(out).includes(VERDICT_NOTE), 'Verdict says nothing is suggested there');
  assert.match(out, /href="#seg-12"[^>]*data-testid="placement-heard-6">Heard in Dana Example · 00:00:04 · Dana</);
  assert.match(out, /data-testid="button-accept-all-demand-signals"/, 'two to review');
  assert.doesNotMatch(out, /button-accept-all-(problem-discovery|experiments|verdict)/, 'one or none: Accept is enough');
  assert.match(renderedText(out), /Accept all for Demand and urgency signals/);
});

test('a chat\'s line is found by its place in the thread and says when it arrived', () => {
  const spans = spansOf(CHAT);
  assert.deepEqual(spans.map((s) => [s.start, s.end, s.segment.id]), [[0, 1000, 21], [1000, 2000, 22]], 'as toSegments spans them');
  assert.equal(lineFor(spans, { from: 1000, to: 2000 }).id, 22);
  // A live line never stands in for the final one it overlaps.
  assert.equal(lineFor(spansOf(SEGMENTS), { from: 0, to: 4000 }).id, 11);
  assert.deepEqual(heardIn({ cite: { from: 1000, to: 2000 }, spans, name: 'Dana Example', thread: true }), { text: 'Heard in Dana Example · 19 Oct 10:05 · Dana', href: '#seg-22' });
  assert.deepEqual(heardIn({ cite: { from: 9e6, to: 9e6 + 5 }, spans, name: '' }), { text: 'Heard in this interview', href: null }, 'no line, no link');
  // A blank line takes its place in the count, as the Worker's does.
  const gap = spansOf([CHAT[0], { id: 30, source: 'final', start_ms: null, text: ' ' }, CHAT[1]]);
  assert.deepEqual(gap.map((s) => [s.start, s.segment.id]), [[0, 21], [2000, 22]]);
  assert.equal(messageTime('garbage'), null);
  assert.equal(hms(754000), '00:12:34');
  assert.equal(hms(null), null);
  for (const [s, t] of [[{ submitted_via: 'whatsapp' }, true], [{ submitted_via: 'telegram' }, true], [{ channel: 'text' }, true], [{ submitted_via: 'zoom', channel: 'video' }, false], [{ channel: 'in_person' }, false]]) {
    assert.equal(isThread(s), t, JSON.stringify(s));
  }
});

test('each source has its badge', () => {
  const cases = [
    [{ channel: 'in_person' }, 'In person'], [{ channel: 'video' }, 'Video'], [{ channel: 'phone' }, 'Phone'], [{ channel: 'text' }, 'Text chat'],
    [{ channel: 'video', submitted_via: 'zoom' }, 'Zoom'], [{ channel: 'video', submitted_via: 'google_meet' }, 'Google Meet'],
    [{ channel: 'text', submitted_via: 'whatsapp' }, 'WhatsApp'], [{ channel: 'text', submitted_via: 'telegram' }, 'Telegram'],
    [{ channel: 'text', submitted_via: 'client-1', submitted_via_name: 'An assistant' }, 'Assistant'], [{}, null],
  ];
  for (const [session, word] of cases) assert.equal(sourceBadge(session), word, JSON.stringify(session));
});

// ── Accept all, with a mixed outcome ────────────────────────────────────────

test('Accept all runs the module\'s route and shows each outcome, a refusal in the Worker\'s sentence', async () => {
  let st = { ...REVIEW_INITIAL };
  const calls = [];
  const result = { results: [{ id: 6, ok: true }, { id: 8, ok: false, error: 'writer_refused', detail: 'That is not a valid value for this finding' }], accepted: 1, remaining: 2 };
  const api = {
    acceptAll: async (id, slug) => { calls.push(['acceptAll', id, slug]); return result; },
    placements: async () => { calls.push(['placements']); return READ; },
  };
  const actions = makeReviewActions({ api, sessionId: 7, set: (fn) => { st = fn(st); } });
  await actions.acceptAll('demand-signals');
  assert.deepEqual(calls, [['acceptAll', 7, 'demand-signals'], ['placements']], 'then the placements are read again');
  assert.deepEqual(st.acceptAll['demand-signals'], { busy: false, result, error: null });
  assert.deepEqual(acceptAllOutcome(result), {
    text: '1 accepted · 1 still to review · 2 more waiting: accept all again',
    refused: [{ id: 8, text: 'That is not a valid value for this finding' }], accepted: 1, remaining: 2,
  });
  const out = html(React.createElement(ModuleSuggestions, { read: READ, segments: SEGMENTS, acceptAll: st.acceptAll, onAcceptAll: () => {} }));
  assert.match(out, /data-testid="accept-all-outcome-demand-signals"/);
  assert.match(out, /data-testid="accept-all-refused-8">That is not a valid value for this finding</);
  // A refused call is kept as the Worker said it.
  const failing = { acceptAll: async () => { throw Object.assign(new Error('Forbidden'), { data: { detail: 'Session not found' } }); }, placements: async () => READ };
  let st2 = { ...REVIEW_INITIAL };
  await makeReviewActions({ api: failing, sessionId: 7, set: (fn) => { st2 = fn(st2); } }).acceptAll('experiments');
  assert.equal(st2.acceptAll.experiments.error.data.detail, 'Session not found');
  assert.match(html(React.createElement(ModuleSuggestions, { read: READ, segments: SEGMENTS, acceptAll: st2.acceptAll })), /data-testid="accept-all-error-experiments">Session not found</);
  // The button calls Accept all with the module's slug.
  const seen = [];
  const m = await mount(React.createElement(ModuleSuggestions, { read: READ, segments: SEGMENTS, onAcceptAll: (slug) => seen.push(slug) }));
  try { await m.click('button-accept-all-demand-signals'); } finally { await m.done(); }
  assert.deepEqual(seen, ['demand-signals']);
});

test('with no suggestions, Find suggestions runs a forced structure with no model', async () => {
  const seen = [];
  const m = await mount(React.createElement(ModuleSuggestions, { read: { runs: [] }, segments: SEGMENTS, onStructure: (...a) => seen.push(a) }));
  try { await m.click('button-find-suggestions'); } finally { await m.done(); }
  assert.deepEqual(seen, [[]]);
  const page = readFileSync('frontend/src/pages/founder/InterviewSessionPage.jsx', 'utf8');
  assert.match(page, /canSummarise=\{!engine\?\.busy\}/, 'Summarise is offered unless the engine is at work');
  assert.match(page, /onSummarise=\{summarise\}/);
});

// ── the Record finish line ──────────────────────────────────────────────────

test('a recording ends on "Summary drafted · n suggestions to review", linking to the session', async () => {
  const ready = (finish) => ({ phase: 'ready', session: { id: 7, project_id: 3 }, finish });
  assert.deepEqual(finishLine(ready({ drafted: true, suggestions: 4 })), { text: 'Summary drafted · 4 suggestions to review', href: '/validate/session/7' });
  assert.equal(finishLine(ready({ drafted: true, suggestions: 1 })).text, 'Summary drafted · 1 suggestion to review');
  assert.equal(finishLine(ready({ drafted: true, suggestions: null })).text, 'Summary drafted', 'a count that could not be read is left out');
  for (const st of [ready(null), { ...ready({ drafted: true, suggestions: 2 }), phase: 'stopping' }, { phase: 'ready', session: null, finish: { drafted: true } }]) assert.equal(finishLine(st), null);
  assert.equal(liveRedirect(ready({ drafted: true, suggestions: 2 }), '7'), '/validate/session/7');
  assert.equal(liveRedirect(ready(null), '7'), '/validate/customer-research?project_id=3', 'with no summary, D694\'s ending');
  assert.equal(pendingSuggestions(READ), 7, 'the latest run\'s pending ones');
  assert.equal(pendingSuggestions(null), null);

  // The recorder reads the count once processing is done and a summary is drafted.
  const reads = [];
  const api = {
    get: async () => ({ session: { id: 7, status: 'transcribed', project_id: 3, digest_status: 'done' }, processing: { stage: 'done' }, digest: DIGEST }),
    placements: async (id) => { reads.push(id); return READ; },
  };
  const r = createRecorder({ api, browser: {}, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()), wait: async () => {} });
  assert.equal(await r.follow({ session: { id: 7, status: 'transcribed', project_id: 3 }, processing: { stage: 'placing' } }), 'done');
  assert.deepEqual(reads, [7]);
  assert.deepEqual(finishLine(r.getSnapshot()), { text: 'Summary drafted · 7 suggestions to review', href: '/validate/session/7' });
  // No summary: no count is read, and the ending is D694's.
  const bare = createRecorder({ api: { ...api, get: async () => ({ session: { id: 7, status: 'transcribed', project_id: 3 }, processing: { stage: 'done' }, digest: null }) }, browser: {}, queue: memoryQueue(), wait: async () => {} });
  await bare.follow({ session: { id: 7, status: 'transcribed', project_id: 3 }, processing: { stage: 'placing' } });
  assert.equal(finishLine(bare.getSnapshot()), null);
  assert.deepEqual(reads, [7]);
  const pill = readFileSync('frontend/src/pages/founder/RecordingPill.jsx', 'utf8');
  assert.match(pill, /\{finish \? finish\.text : 'Ready · see it in Interviews'\}/);
});
