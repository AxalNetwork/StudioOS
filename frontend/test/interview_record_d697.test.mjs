/**
 * D697 (#1659) — the interview record's pieces that draw no read, shipped
 * before the record itself (S1, 2026-10-17):
 *   - `clock`, `findPassages` and `afterDelete` in `interviewReviewModel.js` (step 10);
 *   - `TranscriptReview`'s optional `time` prop (step 7), which
 *     `/validate/session/:id` does not pass, so that page draws no time;
 *   - `PainSeverity` moved from `FounderValidateWorkspace.jsx` to
 *     `pages/founder/validatePieces.jsx` unchanged (step 8), and FVW importing it.
 *
 * The record (PR 2) extends this file with tests 7 to 10.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/interview_record_d697.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { afterDelete, clock, findPassages } from '../src/pages/founder/interviewReviewModel.js';
import { TranscriptReview } from '../src/pages/founder/InterviewSessionPage.jsx';
import { PainSeverity } from '../src/pages/founder/validatePieces.jsx';
import { api } from '../src/lib/api.js';

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
  // And the review page, which #1659's PR 2 turns into the record, does not pass it yet either.
  assert.doesNotMatch(read('frontend/src/pages/founder/InterviewReviewPage.jsx'), /<TranscriptReview\b[^>]*\btime\b/);
});

// ---------------------------------------------------------------------------
// Step 8 — PainSeverity, moved
// ---------------------------------------------------------------------------

test('8: PainSeverity lives in validatePieces.jsx with its docblock, and FVW imports it rather than defining it', () => {
  const pieces = read('frontend/src/pages/founder/validatePieces.jsx');
  const fvw = read('frontend/src/workspaces/founder/FounderValidateWorkspace.jsx');
  assert.match(pieces, /export function PainSeverity\(\{ interviewId, pains, onChanged \}\)/);
  assert.match(pieces, /\/\*\*\n \* How severe was this pain, in this conversation\?\n \*\n \* WRITES `interview_pain_severities`/, 'the docblock moved with it');
  assert.match(pieces, /^import \{ api \} from '\.\.\/\.\.\/lib\/api';$/m);
  assert.match(pieces, /`PainSeverity` \("How badly did they need it\?"\) moved here/, 'the file\'s docblock names it');
  assert.doesNotMatch(fvw, /function PainSeverity\b/, 'not forked: FVW no longer defines it');
  assert.doesNotMatch(fvw, /How severe was this pain/);
  assert.match(fvw, /import \{[^}]*\bPainSeverity\b[^}]*\} from '\.\.\/\.\.\/pages\/founder\/validatePieces';/);
  assert.match(fvw, /<PainSeverity\b/, 'FVW still draws it until #1666 deletes the page');
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
