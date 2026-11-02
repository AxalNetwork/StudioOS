/**
 * D1546 (#3790, deck v2 B14) — the compliance lines on the reader pages and
 * the editor's Confidential switch (pd3):
 *
 *   - the mirror's words are the Worker's, so the one rule reads the same;
 *   - a reader page uses the read's `compliance` when it comes, else the mirror;
 *   - a projected chart keeps BlockGrid's own note, never a second footnote;
 *   - Confidential is on by default; the switch turns it off and back, and a
 *     theme picked afterwards keeps it off;
 *   - the print page (PDF, PowerPoint) and Present draw `CardCompliance`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_compliance_d1546.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CONFIDENTIAL, FLS_FOOTNOTE, ROUND_TERMS_NOTE, cardLines, chromeOf, keepSettings, settingsOf, withConfidential,
} from '../src/pages/raise/pitch/complianceModel.js';
import CardCompliance from '../src/pages/raise/pitch/CardCompliance.jsx';
import { StudioPrintCard } from '../src/pages/raise/pitch/PrintExtras.jsx';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const TODAY = '2026-11-01';
const grid = { c1: 1, c2: 6, r1: 2, r2: 3 };
const metric = (source_key, grade) => ({ id: 'm1', kind: 'metric', grid, label: 'Figure', value: '$3M', binding: { source_key, grade } });
const PROJECTED = { title: 'Financials', blocks: [metric('raise.projection_revenue_12m', 'Projected')] };
const TERMS = { title: 'Round', blocks: [metric('raise.pre_money', 'Stated')] };
const CHART = { title: 'Revenue', blocks: [{ id: 'c1', kind: 'chart', grid, chart_type: 'line', series: [{ label: 'R', points: [{ x: '2026-10', y: 1 }, { x: '2027-02', y: 2 }] }] }] };

test('the mirror speaks the Worker’s words (one rule, two places, held equal here)', () => {
  const worker = read('../../cloudflare-worker/src/services/decks/compliance.ts') + read('../../cloudflare-worker/src/services/decks/recordSources.ts');
  for (const w of [FLS_FOOTNOTE, ROUND_TERMS_NOTE, CONFIDENTIAL]) assert.ok(worker.includes(`'${w}'`), w);
});

test('the mirror: projection and proposed round terms, on by default; a flag off is honoured', () => {
  assert.deepEqual(cardLines(PROJECTED, null, TODAY), [FLS_FOOTNOTE]);
  assert.deepEqual(cardLines(TERMS, null, TODAY), [ROUND_TERMS_NOTE]);
  assert.deepEqual(cardLines({ blocks: [metric('raise.pre_money', 'Reviewed')] }, null, TODAY), [], 'counsel approved');
  assert.deepEqual(cardLines({ blocks: [metric('grow.arr', 'Measured')] }, null, TODAY), []);
  assert.deepEqual(cardLines(PROJECTED, { compliance_fls: false }, TODAY), []);
  assert.deepEqual(settingsOf(null), { compliance_fls: true, confidential: true });
});

test('chromeOf: the read’s answer first, else the mirror; a projected chart keeps BlockGrid’s note only', () => {
  const given = { slides: [PROJECTED, TERMS], compliance: { confidential: false, footnotes: [['Worker line.'], []] } };
  assert.deepEqual(chromeOf(given, 0, TODAY), { confidential: false, lines: ['Worker line.'] });
  assert.deepEqual(chromeOf({ slides: [PROJECTED, TERMS], theme: null }, 1, TODAY), { confidential: true, lines: [ROUND_TERMS_NOTE] });
  assert.deepEqual(chromeOf({ slides: [CHART], theme: null }, 0, TODAY), { confidential: true, lines: [] }, 'BlockGrid draws PROJECTION_NOTE under the chart');
  assert.deepEqual(chromeOf({ slides: [CHART], compliance: { confidential: true, footnotes: [[FLS_FOOTNOTE]] } }, 0, TODAY).lines, []);
});

test('the switch: Confidential off writes `confidential: false`; back on drops it, and the brand default is null again', () => {
  assert.deepEqual(withConfidential(null, false), { kind: 'brand', background: null, confidential: false });
  assert.equal(withConfidential({ kind: 'brand', background: null, confidential: false }, true), null);
  assert.deepEqual(withConfidential({ kind: 'neutral_dark', background: null, confidential: false }, true), { kind: 'neutral_dark', background: null });
  assert.deepEqual(withConfidential({ kind: 'brand', background: null, aspect: '4:3' }, false), { kind: 'brand', background: null, aspect: '4:3', confidential: false });
  // A theme picked afterwards keeps the setting.
  assert.deepEqual(keepSettings({ kind: 'neutral_dark', background: null }, { kind: 'brand', background: null, confidential: false }), { kind: 'neutral_dark', background: null, confidential: false });
  assert.deepEqual(keepSettings(null, { kind: 'brand', background: null, confidential: false }), { kind: 'brand', background: null, confidential: false });
  assert.deepEqual(keepSettings({ kind: 'neutral_dark', background: null }, null), { kind: 'neutral_dark', background: null });
});

test('CardCompliance draws the lines and Confidential, and nothing when there is nothing', () => {
  const html = renderToStaticMarkup(React.createElement(CardCompliance, { chrome: { confidential: true, lines: [ROUND_TERMS_NOTE] }, testId: 't' }));
  assert.match(html, /Proposed, subject to counsel/);
  assert.match(html, /data-testid="t-confidential">Confidential</);
  assert.equal(renderToStaticMarkup(React.createElement(CardCompliance, { chrome: { confidential: false, lines: [] } })), '');
  assert.equal(renderToStaticMarkup(React.createElement(CardCompliance, { chrome: null })), '');
});

test('the print page (PDF and PowerPoint photograph it) draws each card’s chrome; Present and the Theme sheet are wired', () => {
  const card = renderToStaticMarkup(React.createElement(StudioPrintCard, { slide: TERMS, index: 2, chrome: { confidential: true, lines: [ROUND_TERMS_NOTE] } }));
  assert.match(card, /data-testid="print-compliance-2"/);
  assert.match(card, /Proposed, subject to counsel/);
  assert.match(read('../src/pages/PitchDeckPrintPage.jsx'), /<StudioPrintCard key=\{i\} slide=\{s\} index=\{i\} aspect=\{deck\.theme\?\.aspect\} chrome=\{chromeOf\(deck, i\)\} theme=\{deck\.theme\} \/>/, "D1571: and the deck's language");
  assert.equal((read('../src/pages/raise/pitch/PitchPresent.jsx').match(/chrome=\{chromeOf\(deck, i\)\}/g) || []).length, 2);
  const sheet = read('../src/pages/raise/pitch/DeckSheets.jsx');
  assert.match(sheet, /checked=\{settingsOf\(theme\)\.confidential\}/);
  assert.match(sheet, /onTheme\(withConfidential\(theme, e\.target\.checked\)\)/);
});
