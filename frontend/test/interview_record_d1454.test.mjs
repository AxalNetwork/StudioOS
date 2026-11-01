/**
 * D1454 (#3710) — the record header for every cycle (IV-D1), facts with their
 * one action (IV-D2), and the interview record on a phone (IV-M1 to M4, M7).
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/interview_record_d1454.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { PHONE_TABS, RATES, headerRow, rateOf, sectionTab, seekTarget, tabOf } from '../src/pages/cycles/recordHeaderModel.js';
import { RecordHeaderProvider, RecordHeaderRow } from '../src/pages/cycles/RecordHeader.jsx';
import { CycleHeader } from '../src/pages/cycles/CycleOverview.jsx';
import { RecordFacts } from '../src/pages/cycles/RecordView.jsx';
import { declaredActions } from '../src/pages/cycles/recordModel.js';
import { TranscriptReview } from '../src/pages/founder/InterviewSessionPage.jsx';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const ACTIONS = [
  { key: 'edit-details', label: 'Edit details', kind: 'form' },
  { key: 'delete', label: 'Delete', kind: 'write', tone: 'danger' },
  { key: 'open-recording', label: 'Open recording', kind: 'write', tone: 'primary' },
];

test('headerRow: the first primary leads, danger actions go behind ⋯, the rest keep the read\'s order; nothing is invented', () => {
  const row = headerRow(ACTIONS);
  assert.equal(row.primary.key, 'open-recording');
  assert.deepEqual(row.secondary.map((a) => a.key), ['edit-details']);
  assert.deepEqual(row.menu.map((a) => a.key), ['delete']);
  // W1's review-findings takes the lead when the read gives it the primary tone.
  const waiting = headerRow([{ key: 'review-findings', label: 'Review findings (3)', kind: 'link', href: '/x', tone: 'primary' }, { ...ACTIONS[2], tone: 'default' }, ACTIONS[1]]);
  assert.equal(waiting.primary.key, 'review-findings');
  assert.deepEqual(waiting.secondary.map((a) => a.key), ['open-recording']);
  assert.deepEqual(headerRow([]), { primary: null, secondary: [], menu: [] });
  assert.deepEqual(headerRow(null), { primary: null, secondary: [], menu: [] });
  assert.equal(headerRow([{ key: 'x' }, { label: 'y' }]).secondary.length, 0, 'an action without a key or label is not drawn');
});

test('IV-D1: the header row draws primary, Ask, Email, the rest, then ⋯, in that order', () => {
  const ask = h('button', { 'data-testid': 'record-ask' }, 'Ask');
  const email = h('a', { href: '/email', 'data-testid': 'email-action' }, 'Email');
  const out = html(h(RecordHeaderProvider, { email, ask }, h(RecordHeaderRow, { actions: ACTIONS, handlers: { onForm() {}, onWrite() {} } })));
  const at = (needle) => out.indexOf(needle);
  for (const n of ['record-header-open-recording', 'record-ask', 'email-action', 'record-header-edit-details', 'record-header-more']) assert.ok(at(n) > 0, n);
  assert.ok(at('record-header-open-recording') < at('record-ask'));
  assert.ok(at('record-ask') < at('email-action'));
  assert.ok(at('email-action') < at('record-header-edit-details'));
  assert.ok(at('record-header-edit-details') < at('record-header-more'));
  assert.doesNotMatch(out, />Delete</, 'Delete is behind ⋯ until it is opened');
  assert.match(out, /class="[^"]*bg-axal-violet text-white[^"]*"[^>]*data-testid="record-header-open-recording"/, 'the primary is the violet button');
  assert.doesNotMatch(out, /class="[^"]*bg-axal-violet[^"]*"[^>]*data-testid="record-header-edit-details"/, 'the others are not');
  assert.match(out, /aria-haspopup="menu"/);
  assert.match(out, /aria-label="More actions"/);
});

test('IV-D1: the record header puts "‹ <Module>" above the eyebrow, no tab says Back, and no tab is the current page', () => {
  const out = html(h(CycleHeader, {
    cycle: 'validate', record: true, active: 'customer-research', moduleName: 'Customer research', title: 'Synthetic interviewee',
    cards: [{ slug: 'problem-discovery', name: 'Problem discovery' }, { slug: 'customer-research', name: 'Customer research' }], search: '?project_id=7',
    slots: { pills: () => {}, actions: () => {} },
  }));
  assert.match(out, /data-testid="record-back"[^>]*>‹ Customer research</);
  assert.ok(out.indexOf('record-back') < out.indexOf('Validate · Customer research'), 'the back link sits above the eyebrow');
  assert.match(out, /href="\/validate\/customer-research\?project_id=7"[^>]*data-testid="record-back"|data-testid="record-back"[^>]*href="\/validate\/customer-research\?project_id=7"/);
  assert.doesNotMatch(out, /Back to/);
  assert.doesNotMatch(out, /aria-current="page"/);
  assert.match(out, /data-testid="record-header-pills"/);
  assert.match(out, /data-testid="record-header-actions"/);
  // A module page (not a record) has no back link and no slots.
  const page = html(h(CycleHeader, { cycle: 'validate', active: 'customer-research', cards: [{ slug: 'customer-research', name: 'Customer research' }] }));
  assert.doesNotMatch(page, /record-back|record-header-actions/);
});

test('IV-D1: the lone Email row is gone; Email and Ask ride in the record header\'s provider', () => {
  const route = read('src/pages/cycles/CycleRoute.jsx');
  assert.doesNotMatch(route, /<div className="flex justify-end">\s*<EmailAction/);
  assert.match(route, /<RecordHeaderProvider[\s\S]*?ask=\{<PageAsk /);
  assert.match(route, /slots=\{\{ pills: pillsSlot, actions: actionsSlot \}\}/);
});

test('IV-D2: a null fact shows its one declared action in place of the reason; an undeclared key or a recorded fact shows none', () => {
  const record = { actions: [{ key: 'judge-fit', label: 'Judge fit', kind: 'form' }] };
  const facts = [
    { label: 'ICP fit', value: null, reason: 'Not judged yet.', action: 'judge-fit' },
    { label: 'Need-to-have', value: null, reason: 'No pain is judged yet.', action: 'judge-need' },
    { label: 'Consent', value: 'Said yes out loud', action: 'judge-fit' },
  ];
  const out = html(h(RecordFacts, { facts, declarations: declaredActions(record), handlers: { onForm() {} } }));
  assert.equal((out.match(/>Judge fit</g) || []).length, 1, 'only on the null fact that names it');
  assert.doesNotMatch(out, /Not judged yet\./, 'the action replaces the reason');
  assert.match(out, /No pain is judged yet\./, 'an undeclared action key keeps the reason');
  assert.match(out, /Said yes out loud/);
  assert.match(out, /auto-rows-fr/, 'one even row');
});

test('IV-M2: four sections in order, ?tab= read safely, and each part placed in its section', () => {
  assert.deepEqual(PHONE_TABS.map((t) => t.label), ['Summary', 'Transcript', 'Findings', 'Notes']);
  assert.equal(tabOf('findings'), 'findings');
  for (const bad of [null, undefined, '', 'FINDINGS', 'toString', '__proto__']) assert.equal(tabOf(bad), 'summary', String(bad));
  assert.equal(sectionTab('transcript'), 'transcript');
  assert.equal(sectionTab('placements'), 'findings');
  assert.equal(sectionTab('cost'), 'summary');
  assert.equal(sectionTab('session'), 'summary');
  assert.equal(sectionTab('fed'), 'notes');
  assert.equal(sectionTab(null, 'From this conversation'), 'notes');
  assert.equal(sectionTab(null, 'Session'), 'summary');
});

test('IV-M3: seekTarget finds the part holding a passage and the offset in it; a missing start plays nothing', () => {
  const parts = [{ seq: 1, start_ms: 0 }, { seq: 2, start_ms: 60_000 }, { seq: 3, start_ms: 120_000 }];
  assert.deepEqual(seekTarget(parts, 0), { index: 0, offsetMs: 0 });
  assert.deepEqual(seekTarget(parts, 59_999), { index: 0, offsetMs: 59_999 });
  assert.deepEqual(seekTarget(parts, 60_000), { index: 1, offsetMs: 0 });
  assert.deepEqual(seekTarget(parts, 252_000), { index: 2, offsetMs: 132_000 });
  assert.equal(seekTarget([{ start_ms: 5_000 }], 1_000), null, 'before the first part');
  assert.equal(seekTarget([{ start_ms: 0 }, { start_ms: null }], 70_000), null, 'a part with no start: nothing is guessed');
  for (const bad of [null, undefined, -1, Number.NaN, 'soon']) assert.equal(seekTarget(parts, bad), null, String(bad));
  assert.equal(seekTarget([], 10), null);
  assert.deepEqual(RATES, [1, 1.5, 2]);
  assert.equal(rateOf('1.5'), 1.5);
  assert.equal(rateOf(3), 1);
});

test('IV-M3: a passage with a start offers "Play from here"; one without does not; a mark is drawn on its passage', () => {
  const segments = [
    { id: 1, source: 'final', start_ms: 9_000, end_ms: 20_000, text: 'Synthetic passage one.' },
    { id: 2, source: 'final', start_ms: null, end_ms: null, text: 'A passage with no start.' },
  ];
  const out = html(h(TranscriptReview, { segments, onAssign() {}, time: true, onPlay() {}, marks: [{ id: 7, offset_ms: 12_000, label: 'pricing' }] }));
  assert.match(out, /data-testid="seg-play-1"/);
  assert.match(out, /aria-label="Play from \[00:00:09\]"/);
  assert.doesNotMatch(out, /seg-play-2/);
  assert.match(out, /data-testid="seg-mark-7"[^>]*>⚑ Marked · pricing/);
  // Without onPlay (the session page), no play control.
  assert.doesNotMatch(html(h(TranscriptReview, { segments, onAssign() {} })), /seg-play-/);
});

test('IV-M1, M4, M7: the phone record leads with its actions, has a sticky section control kept in ?tab=, and two columns from 768px', () => {
  const page = read('src/pages/founder/InterviewReviewPage.jsx');
  assert.match(page, /data-testid="record-phone-head"/);
  assert.match(page, /role="tablist" aria-label="Sections" className="sticky top-0/);
  assert.match(page, /n\.set\('tab', key\)/);
  assert.match(page, /md:grid md:grid-cols-\[minmax\(0,1\.5fr\)_minmax\(0,1fr\)\]/);
  assert.match(page, /'hidden md:block'/, 'from 768px every section shows, in two columns');
  assert.match(page, /max-lg:sticky max-lg:bottom-0/, 'the player is sticky at the foot below 1024px');
  assert.match(page, /min-h-\[44px\] flex-1 rounded-xl/, 'section buttons are 44px targets');
});
