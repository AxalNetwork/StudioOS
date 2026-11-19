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
import { LabApplyBand, LabHero } from '../src/components/spinout/LabIntro.jsx';
import { numberWord, numberWordCap } from '../src/lib/numberWords.js';
import LAB_PROGRAM from '../src/programs/catalog/spinout-lab.js';
import LAB_CONTENT from '../src/programs/content/spinout-lab.js';
import { LAB_TOOLS } from '../src/lib/spinoutLabArsenal.js';
import { DIMENSIONS } from '../src/lib/scoringViewModel.js';
import { FOUNDER_DIMENSIONS } from '../src/lib/founderDimensions.js';
import { COHORT_WEEKS } from '../src/lib/spinoutLab.js';

const FILES = [
  'frontend/src/pages/SpinoutLabBriefPage.jsx',
  'frontend/src/programs/catalog/spinout-lab.js',
  'frontend/src/programs/content/spinout-lab.js',
  'frontend/src/components/spinout/LabIntro.jsx',
  'frontend/src/lib/spinoutLabArsenal.js',
  'frontend/src/pages/events/PublicEventsPage.jsx',
];
const BANNED = [
  'funded company', 'Average time to incorporation', 'warm introductions', 'Five to ten warm',
  'nine-dimension venture score', 'never typed', 'nothing stores one yet', '83(b)-filed', 'revenue proof',
];
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, '\'').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
// D6966: the brief is the presentation; its words are the map entry and the content module.
const brief = () => JSON.stringify([LAB_PROGRAM, LAB_CONTENT]);
const h = React.createElement;

test('none of the files says a removed line, in code, copy or comment', () => {
  for (const f of FILES) {
    const src = readFileSync(f, 'utf8');
    for (const phrase of BANNED) assert.ok(!src.includes(phrase), `${f} says "${phrase}"`);
  }
});

test('the brief: activities in the headline, no outcome promised, no introduction count', () => {
  const out = brief();
  assert.ok(LAB_PROGRAM.purpose.startsWith(`${numberWordCap(COHORT_WEEKS)} weeks to test demand, build your pitch and prepare for investor conversations.`));
  assert.doesNotMatch(out, /funded|twenty.?ninth|Idea in on the first/i);
  assert.doesNotMatch(out, /leave with a working entity|evidence a buyer will pay/);
  assert.doesNotMatch(out, /nine-dimension venture|venture score \(nine/i, 'the venture score is never nine-dimensional');
  assert.doesNotMatch(out, /warm introductions|Five to ten|5–10|\d+\s*(–|-|to)\s*\d+\s*(warm )?intro/i, 'no introduction count, printed or on screen');
  assert.match(out, /"Introductions","Not promised\."/);
});

test('the content lists: no introduction count, and the advisor line promises no count', () => {
  const support = LAB_CONTENT.sections[2].blocks[0].items[1].block.items;
  assert.deepEqual(support.find(([k]) => k === 'Introductions'), ['Introductions', 'Not promised.']);
  assert.deepEqual(support.find(([k]) => k === 'Advisors'), ['Advisors', 'Matched against your founder profile.']);
  assert.equal(LAB_TOOLS.find((t) => t.id === 'score').blurb, `${numberWordCap(DIMENSIONS.length)} dimensions, each with its confidence.`);
  assert.notEqual(DIMENSIONS.length, FOUNDER_DIMENSIONS.length, 'two models, two counts: neither is forced onto the other');
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
