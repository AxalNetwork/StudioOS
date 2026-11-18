/**
 * #6990 (D6990, X8 of #6976) — the Spin-Out Lab brief and page say what the
 * programme does, never what it promises: no "funded company" outcome, no
 * programme length labelled as a measured average, no introduction count, no
 * engineering notes on a visitor's page, and each scoring model named with its
 * own dimension count, read from the code that defines it.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/spinout_copy_6990.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { BriefDocument } from '../src/pages/SpinoutLabBriefPage.jsx';
import { LabApplyBand, LabHero } from '../src/components/spinout/LabIntro.jsx';
import { DELIVERABLES, SUPPORT, numberWord, numberWordCap } from '../src/lib/spinoutBrief.js';
import { LAB_TOOLS } from '../src/lib/spinoutLabArsenal.js';
import { DIMENSIONS } from '../src/lib/scoringViewModel.js';
import { FOUNDER_DIMENSIONS } from '../src/lib/founderDimensions.js';
import { COHORT_WEEKS } from '../src/lib/spinoutLab.js';

const FILES = [
  'frontend/src/pages/SpinoutLabBriefPage.jsx',
  'frontend/src/lib/spinoutBrief.js',
  'frontend/src/components/spinout/LabIntro.jsx',
  'frontend/src/lib/spinoutLabArsenal.js',
  'frontend/src/pages/events/PublicEventsPage.jsx',
];
const BANNED = [
  'funded company', 'Average time to incorporation', 'warm introductions', 'Five to ten warm',
  'nine-dimension venture score', 'never typed', 'nothing stores one yet', '83(b)-filed', 'revenue proof',
];
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, '\'').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const brief = () => text(renderToStaticMarkup(h(MemoryRouter, null, h(BriefDocument, { brief: null, err: false, stats: [] }))));
const h = React.createElement;

test('none of the five files says a removed line, in code, copy or comment', () => {
  for (const f of FILES) {
    const src = readFileSync(f, 'utf8');
    for (const phrase of BANNED) assert.ok(!src.includes(phrase), `${f} says "${phrase}"`);
  }
});

test('the brief: activities in the headline, both scoring models with their own counts, no introduction count', () => {
  const out = brief();
  assert.ok(out.includes(`${numberWordCap(COHORT_WEEKS)} weeks to test demand, build your pitch and prepare for investor conversations.`));
  assert.doesNotMatch(out, /funded|twenty.?ninth|Idea in on the first/i);
  assert.doesNotMatch(out, /leave with a working entity|evidence a buyer will pay/);
  assert.ok(out.includes(`the founder profile (${numberWord(FOUNDER_DIMENSIONS.length)} dimensions)`), 'the founder profile with its own count');
  assert.ok(out.includes(`the venture score (${numberWord(DIMENSIONS.length)} dimensions)`), 'the venture score with its own count');
  assert.doesNotMatch(out, /nine-dimension venture|venture score \(nine/i, 'the venture score is never nine-dimensional');
  // The Pitch week's "Warm intro prep" is an activity, not a count (week content is #6991's).
  assert.doesNotMatch(out, /warm introductions|Five to ten|5–10|\d+\s*(–|-|to)\s*\d+\s*(warm )?intro/i, 'no introduction count, printed or on screen');
  assert.match(out, /Introductions Not promised/);
});

test('the content lists: no introduction count, and the advisor line counts the model it matches against', () => {
  assert.ok(!DELIVERABLES.some((d) => /introduction/i.test(d)));
  assert.equal(SUPPORT.find((s) => s.k === 'Introductions').v, 'Not promised');
  assert.equal(SUPPORT.find((s) => s.k === 'Advisors').v, `Two, matched against the founder profile's ${numberWord(FOUNDER_DIMENSIONS.length)} dimensions`);
  assert.equal(LAB_TOOLS.find((t) => t.id === 'score').blurb, `${numberWordCap(DIMENSIONS.length)} dimensions, each with its confidence.`);
  assert.notEqual(DIMENSIONS.length, FOUNDER_DIMENSIONS.length, 'two models, two counts: neither is forced onto the other');
});

test('the brief page labels the derived figure as the programme length, never as an average', () => {
  const src = readFileSync('frontend/src/pages/SpinoutLabBriefPage.jsx', 'utf8');
  assert.match(src, /\{ value: `\$\{COHORT_WEEKS \* 7\} days`, label: 'Programme length' \}/);
  assert.ok(src.includes('{numberWordCap(COHORT_WEEKS)} weeks to test demand'), 'the headline\'s week count is read, not typed');
});

const COHORT = { status: 'ok', cohort: { open: true, name: 'November 2026', startLabel: 'November 1, 2026', endLabel: 'November 29, 2026', deadlineLabel: 'October 25, 2026' }, retry() {} };
test('the Lab page: Read the programme brief, the cohort footnote, no engineering notes, and no track in the apply heading', () => {
  const hero = text(renderToStaticMarkup(h(MemoryRouter, null, h(LabHero, { cohort: COHORT, applyHref: '/apply', briefHref: '/spinout-lab/brief' }))));
  assert.match(hero, /Read the programme brief/);
  assert.doesNotMatch(hero, /Download/);
  assert.match(hero, /Dates come from the cohort record\./);
  assert.doesNotMatch(hero, /Delaware time|computed/);
  const band = text(renderToStaticMarkup(h(MemoryRouter, null, h(LabApplyBand, { cohort: COHORT, applyHref: '/apply', briefHref: '/spinout-lab/brief', track: 'fit' }))));
  assert.match(band, /Apply to the November 2026 cohort\./);
  assert.doesNotMatch(band, /track/i);
  assert.match(band, /Read the programme brief/);
  const closed = text(renderToStaticMarkup(h(MemoryRouter, null, h(LabApplyBand, { cohort: { status: 'failed', retry() {} }, applyHref: '/apply', briefHref: '/b', track: 'form' }))));
  assert.match(closed, /Apply to the Spin-Out Lab\./);
  assert.doesNotMatch(closed, /track/i, 'no track when no cohort is named either');
  const intro = readFileSync('frontend/src/components/spinout/LabIntro.jsx', 'utf8');
  assert.ok(!intro.includes('does not exist yet'));
});

test('the events programme card says what the programme is, with its length computed', () => {
  const src = readFileSync('frontend/src/pages/events/PublicEventsPage.jsx', 'utf8');
  assert.ok(src.includes('A {numberWord(COHORT_WEEKS)}-week programme for founders testing an idea or a new product. By application.'));
  assert.equal(`A ${numberWord(COHORT_WEEKS)}-week programme`, 'A four-week programme', 'today\'s cohort is four weeks');
});
