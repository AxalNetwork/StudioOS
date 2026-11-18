/**
 * D7173 (#7173) — Research › Markets › Top-ranked signals, to the D7038 canvas
 * (boards RMS-01 to RMS-08). The tests RMS-08 lists: 82 reads 82%, 0 reads 0%
 * with "no evidence recorded", null reads Not recorded; an empty live store
 * never shows examples; a failed read never says "none"; a URL-less evidence
 * item prints its citation; closing returns focus to the same View evidence.
 *
 * All signals here are made up for the test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { LatestSignals, Confidence, SignalEvidence } from '../src/pages/research/RankedSignals.jsx';
import {
  cardState, confidenceState, dayLabel, evidenceNewestFirst, sourceLink, trackedSectorFor,
} from '../src/pages/research/rankedSignalsRead.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el, at = '/research/markets') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [at] }, el));
const text = (el, at) => html(el, at).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

const ready = (data) => ({ status: 'ready', data, reload: () => {} });
const SECTORS = ready({ items: [{ slug: 'test-storage', name: 'Test storage' }] });

const SIG = (over = {}) => ({
  id: 'sig-a', title: 'Scheduling for test utilities', sector: 'Test storage', country: 'Testland', region: 'Europe',
  updated_at: '2026-11-12T00:00:00Z', confidence_score: 82, evidence_state: 'recorded',
  why_now: 'Backlogs grow faster than the software that schedules them.',
  evidence_items: [
    { id: 'e1', kind: 'news', title: 'Older story without a link', source_key: 'news_rss', observed_at: '2026-11-01T00:00:00Z' },
    { id: 'e2', kind: 'filing', title: 'Newest filing', source_key: 'sec_edgar', url: 'https://filings.example/doc', observed_at: '2026-11-11T00:00:00Z' },
  ],
  ...over,
});
const LIVE = ready({ data_state: 'live', mode: 'founder', total: 14, signals: [
  SIG(),
  SIG({ id: 'sig-b', title: 'Second', confidence_score: 100 }),
  SIG({ id: 'sig-c', title: 'Third', sector: 'Unknown sector', confidence_score: 0, evidence_items: [] }),
] });

// ---- confidence (RMS-03) ---------------------------------------------------

test('confidence: 82 reads 82%, a measured 0 is a value, null and out of range read Not recorded', () => {
  assert.deepEqual(confidenceState({ confidence_score: 82 }), { state: 'value', pct: 82, zero: false });
  assert.deepEqual(confidenceState({ confidence_score: 0 }), { state: 'value', pct: 0, zero: true });
  assert.deepEqual(confidenceState({ confidence_score: null }), { state: 'not_recorded' });
  assert.deepEqual(confidenceState({}), { state: 'not_recorded' });
  const warn = console.warn; console.warn = () => {};
  try {
    assert.deepEqual(confidenceState({ confidence_score: 8200 }), { state: 'not_recorded' }, 'never clamped into view');
    assert.deepEqual(confidenceState({ confidence_score: -3 }), { state: 'not_recorded' });
  } finally { console.warn = warn; }
  assert.deepEqual(confidenceState({ confidence_score: 70, evidence_state: 'unavailable' }), { state: 'unavailable' });

  assert.match(text(h(Confidence, { signal: { confidence_score: 82 } })), /82% confidence/);
  assert.doesNotMatch(text(h(Confidence, { signal: { confidence_score: 82 } })), /8200/);
  assert.match(text(h(Confidence, { signal: { confidence_score: 0 } })), /0% confidence · no evidence recorded/);
  const nr = text(h(Confidence, { signal: { confidence_score: null } }));
  assert.match(nr, /Confidence not recorded/);
  assert.doesNotMatch(nr, /0%/, 'null is never drawn as 0%');
  assert.match(text(h(Confidence, { signal: { confidence_score: null, evidence_state: 'unavailable' } })), /Confidence unavailable/);
});

test('the confidence words never say probability of anything but what it is not', () => {
  const src = read('frontend/src/pages/research/RankedSignals.jsx');
  assert.doesNotMatch(src, /likelihood|chance of/i);
  assert.doesNotMatch(src, /\* 100\)/, 'the 0–100 score is never multiplied again');
});

// ---- the five card states (RMS-04) ---------------------------------------------

test('card states: loading, failed, live-empty, illustrative and live each say their own thing', () => {
  assert.equal(cardState({ status: 'loading', data: null }), 'loading');
  assert.equal(cardState({ status: 'unreadable', data: null }), 'unreadable');
  assert.equal(cardState(ready({ data_state: 'live', signals: [] })), 'empty');
  assert.equal(cardState(ready({ data_state: 'illustrative', signals: [SIG()] })), 'illustrative');
  assert.equal(cardState(LIVE), 'live');

  const loading = text(h(LatestSignals, { sigs: { status: 'loading', data: null } }));
  assert.match(loading, /Loading signals…/);
  assert.doesNotMatch(loading, /\d+ of \d+/, 'never a count while loading');

  const failed = text(h(LatestSignals, { sigs: { status: 'unreadable', data: null, reload: () => {} } }));
  assert.match(failed, /Unavailable Could not load signals\. This is not a sign there are none\. The other Markets panels are unaffected\. Retry/);
  assert.doesNotMatch(failed, /No ranked signals|No signals|Illustrative|Example/);

  const empty = text(h(LatestSignals, { sigs: ready({ data_state: 'live', signals: [], total: 0 }) }));
  assert.match(empty, /None No ranked signals in the live store\. The read worked and nothing is ranked right now\. Examples are not shown in their place\./);
  assert.doesNotMatch(empty, /Retry|Illustrative|View example evidence/);

  const ill = text(h(LatestSignals, { sigs: ready({ data_state: 'illustrative', total: 9, signals: [SIG()] }) }));
  assert.match(ill, /Illustrative examples, not live observations\./);
  assert.match(ill, /Example Scheduling for test utilities/);
  assert.match(ill, /View example evidence/);
  assert.match(ill, /signals · example set · not live/);
  assert.doesNotMatch(ill, /of 9/, 'an example set has no live total');

  const live = text(h(LatestSignals, { sigs: LIVE }));
  assert.match(live, /Top-ranked signals 3 of 14/);
  assert.match(live, /Rank 1 Scheduling for test utilities Test storage · Testland Updated 12 Nov 2026 82% confidence View evidence : Scheduling for test utilities/);
  assert.match(live, /Rank 3 Third .* 0% confidence · no evidence recorded/);
  assert.match(live, /signals · live store · founder ranking/);
  assert.doesNotMatch(live, /Illustrative|Example/);
});

test('View evidence is a dialog trigger named by its signal', () => {
  const markup = html(h(LatestSignals, { sigs: LIVE }));
  assert.match(markup, /aria-haspopup="dialog" aria-expanded="false" data-testid="signal-view-evidence"[^>]*>View evidence<span class="sr-only">: Scheduling for test utilities<\/span>/);
});

// ---- the evidence sheet (RMS-02, RMS-02C) ---------------------------------------

test('?signal= opens the sheet: why now, evidence newest first, link or recorded citation', () => {
  const markup = html(h(LatestSignals, { sigs: LIVE, sectors: SECTORS }), '/research/markets?sort=name:asc&signal=sig-a');
  assert.match(markup, /role="dialog" aria-modal="true" aria-label="Scheduling for test utilities"/);
  assert.match(markup, /aria-expanded="true"/);
  const t = markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(t, /Signal · rank 1 of 14/);
  assert.match(t, /Signal updated 12 Nov 2026 Newest evidence observed 11 Nov 2026/);
  assert.match(t, /· 2 kinds of source agree/);
  assert.match(t, /What confidence measures .* It is not a probability that the market grows or that anyone invests\. A signal backed by only one kind of source cannot score above 55%\./);
  assert.match(t, /Why now Backlogs grow faster/);
  assert.ok(t.indexOf('Newest filing') < t.indexOf('Older story without a link'), 'newest first by observation date');
  assert.match(markup, /href="https:\/\/filings\.example\/doc" target="_blank" rel="noopener noreferrer"/);
  assert.match(t, /Open source filings\.example \(opens in a new tab\)/);
  assert.match(t, /Recorded citation · no URL recorded “Older story without a link”, news_rss, observed 1 Nov 2026\./);
  assert.match(markup, /href="\/research\/markets\/sector\/test-storage"[^>]*>Open sector profile: Test storage →/);
  // Without ?signal= no sheet is drawn.
  assert.doesNotMatch(html(h(LatestSignals, { sigs: LIVE })), /role="dialog"/);
});

test('a live signal with no evidence says None; an unknown sector has no profile link', () => {
  const t = text(h(SignalEvidence, { signal: LIVE.data.signals[2], sectors: SECTORS }));
  assert.match(t, /Newest evidence observed None no evidence recorded/);
  assert.match(t, /No evidence is recorded for this live signal\. Its confidence is 0% for that reason\./);
  assert.match(t, /No sector profile “Unknown sector” is not a tracked sector yet, so there is no profile to open\./);
  assert.doesNotMatch(html(h(SignalEvidence, { signal: LIVE.data.signals[2], sectors: SECTORS })), /\/research\/markets\/sector\//);
});

test('evidence that could not be read is Unavailable with Retry, never "none"', () => {
  const t = text(h(SignalEvidence, { signal: SIG({ evidence_state: 'unavailable', confidence_score: null, evidence_items: [] }), onRetry: () => {} }));
  assert.match(t, /Could not load the evidence for this signal\. This is not a sign it has none\./);
  assert.match(t, /Retry/);
  assert.match(t, /Confidence unavailable/);
  assert.doesNotMatch(t, /No evidence is recorded|0%|Evidence · 0/);
});

test('example evidence never links out, even when the seed carries a URL', () => {
  const markup = html(h(SignalEvidence, { signal: SIG(), illustrative: true }));
  assert.doesNotMatch(markup, /target="_blank"/);
  assert.match(markup.replace(/<[^>]+>/g, ' '), /Example citation · no URL/);
});

test('sector profile: exact name only, or the Worker slug when it names a tracked sector', () => {
  const items = SECTORS.data.items;
  assert.equal(trackedSectorFor({ sector: 'Test storage' }, items)?.slug, 'test-storage');
  assert.equal(trackedSectorFor({ sector: 'test storage' }, items), null, 'a near match is not a destination');
  assert.equal(trackedSectorFor({ sector: 'Test storage software' }, items), null);
  assert.equal(trackedSectorFor({ sector: 'Other', sector_slug: 'test-storage' }, items)?.name, 'Test storage');
});

test('readings: dates, ordering and links', () => {
  assert.equal(dayLabel('2026-11-12T00:00:00Z'), '12 Nov 2026');
  assert.equal(dayLabel('2026-08-01 09:00:00'), '1 Aug 2026');
  assert.equal(dayLabel('not a date'), null);
  assert.deepEqual(evidenceNewestFirst([{ observed_at: '2026-01-01' }, { observed_at: null }, { observed_at: '2026-03-01' }]).map((e) => e.observed_at), ['2026-03-01', '2026-01-01', null]);
  assert.equal(sourceLink('javascript:alert(1)'), null, 'only http(s) is ever a link');
  assert.equal(sourceLink(''), null);
  assert.deepEqual(sourceLink('https://www.example.org/x'), { href: 'https://www.example.org/x', host: 'example.org' });
});

// ---- place and focus (RMS-05, RMS-08B) -----------------------------------------

test('closing returns focus to the same View evidence, and Back closes the sheet', () => {
  const src = read('frontend/src/pages/research/RankedSignals.jsx');
  assert.match(src, /<Sheet [^>]*initialFocus=\{heading\} returnFocusTo=\{opener\}/, 'focus goes to the heading on open and back to the opener on close');
  assert.match(src, /buttons\.current\[openId\]/, 'the opener is the View evidence of the open signal');
  assert.match(src, /next\.set\('signal', id\)/, '?signal= sits beside the directory URL state');
  assert.match(src, /navigate\(-1\)/, 'a sheet opened here closes by stepping back, so Back and ✕ agree');
  const zone = read('frontend/src/pages/research/MarketDirectoryZone.jsx');
  assert.match(zone, /<LatestSignals sigs=\{\{ \.\.\.sigs, reload: reloadSigs \}\} sectors=\{sectors\} \/>/);
});
