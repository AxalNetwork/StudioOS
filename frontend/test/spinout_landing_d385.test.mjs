/**
 * D385 — the Spin-Out Lab landing revision, against
 * `design/canvases/integrated/Spin-Out Lab · Landing.dc.html`.
 *
 * Two things this revision does, and one it names without doing:
 *  - the cohort is named from the cohort record (`/brief`), as the canvas's
 *    "Apply to {cohort.name}" and "Read from the cohort record" say, so the
 *    landing, the Programme Brief and the apply form print one name;
 *  - the hero draws no seat count, which the canvas's caption settles;
 *  - the per-track gates stay as each surface draws them, and both surfaces
 *    print the same sentence saying the call is open.
 *
 * The hero and the apply band are RENDERED (react-dom/server) from the three
 * states the read can be in.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/spinout_landing_d385.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { cohortRecordFromBrief } from '../src/lib/spinoutLab.js';
import { GATES_DECISION, TRACK_GATES } from '../src/lib/spinoutBrief.js';
import { DEFAULT_TRACK } from '../src/lib/spinoutLabArsenal.js';
import { LabHero, LabApplyBand, applyLabelFor } from '../src/components/spinout/LabIntro.jsx';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const CANVAS = read('../../design/canvases/integrated/Spin-Out Lab · Landing.dc.html');
const INTRO = codeOnly(read('../src/components/spinout/LabIntro.jsx'));
const BRIEF = codeOnly(read('../src/pages/SpinoutLabBriefPage.jsx'));
const PAGE = codeOnly(read('../src/pages/SpinoutLabPage.jsx'));
const MARKETING = codeOnly(read('../src/pages/SpinoutLabMarketingPage.jsx'));

const BRIEF_BODY = {
  cohort: {
    name: 'November 2026',
    start_date: '2026-11-01T04:00:00.000Z',
    end_date: '2026-11-29T05:00:00.000Z',
    close_at: '2026-10-26T03:59:59.000Z',
    places: 25,
  },
  applications_open: true,
};
const OK = { status: 'ok', cohort: cohortRecordFromBrief(BRIEF_BODY), retry: () => {} };
const LOADING = { status: 'loading', cohort: null, retry: () => {} };
const FAILED = { status: 'error', cohort: null, retry: () => {} };

const wrap = (el) => renderToStaticMarkup(React.createElement(MemoryRouter, null, el));
const hero = (cohort) => wrap(React.createElement(LabHero, { surface: 'public', cohort, applyHref: '/register', briefHref: '/spinout-lab/brief' }));
const band = (cohort, track = 'form') => wrap(React.createElement(LabApplyBand, { cohort, applyHref: '/register', briefHref: '/spinout-lab/brief', track }));
const cell = (html, id) => {
  const at = html.indexOf(`data-testid="hero-${id}"`);
  assert.ok(at > 0, `the ${id} row is gone`);
  return renderedText(html.slice(html.indexOf('>', at) + 1, html.indexOf('</dd>', at)));
};

// ---------------------------------------------------------------------------
// The cohort, from the cohort record.
// ---------------------------------------------------------------------------

test('the canvas still names the cohort from the record and draws no seat count', () => {
  assert.ok(CANVAS.includes("cohortName:'{cohort.name}'"));
  assert.ok(CANVAS.includes('Read from the cohort record.'));
  assert.ok(CANVAS.includes('No seat count, no track record'));
});

test('the record is read from /brief’s cohort, dates in Delaware time', () => {
  const c = cohortRecordFromBrief(BRIEF_BODY);
  assert.equal(c.name, 'November 2026');
  assert.equal(c.startLabel, 'November 1, 2026');
  assert.equal(c.endLabel, 'November 29, 2026');
  assert.equal(c.deadlineLabel, 'October 25, 2026', 'the deadline is 23:59 Delaware time on the 25th');
  assert.equal(c.open, true);
  assert.equal(cohortRecordFromBrief({ cohort: { ...BRIEF_BODY.cohort, name: null }, applications_open: false }).open, false);
  assert.equal(cohortRecordFromBrief({}), null, 'a body without a cohort was read as one');
});

test('the hero names the cohort the server names, and every date it holds', () => {
  const html = hero(OK);
  assert.equal(cell(html, 'cohort'), 'November 2026');
  assert.equal(cell(html, 'starts'), 'November 1, 2026');
  assert.equal(cell(html, 'ends'), 'November 29, 2026');
  assert.equal(cell(html, 'applications-close'), 'October 25, 2026');
  assert.match(renderedText(html), /Apply to the November 2026 cohort →/);
  assert.match(renderedText(html), /Read from the cohort record\./);
});

test('still reading, a failed read and an absent value are three different sentences', () => {
  assert.equal(cell(hero(LOADING), 'cohort'), 'Reading…');
  const failed = hero(FAILED);
  assert.equal(cell(failed, 'cohort'), 'Could not be read');
  assert.match(failed, /data-testid="hero-cohort-retry"/);
  assert.match(renderedText(hero(LOADING)), /Apply to the next cohort →/, 'a button named a cohort nobody has read');
  const noEnd = { ...OK, cohort: { ...OK.cohort, endLabel: null } };
  assert.equal(cell(hero(noEnd), 'ends'), 'Not recorded');
});

test('the hero draws no seat count', () => {
  assert.doesNotMatch(renderedText(hero(OK)), /places|seats|spots/i);
  const heroSrc = INTRO.slice(INTRO.indexOf('export function LabHero'), INTRO.indexOf('export function LabTracks'));
  assert.doesNotMatch(heroSrc, /places/, 'the hero reads the place count');
});

test('the apply band names the cohort and the track, and the deadline it read', () => {
  const out = renderedText(band(OK, 'fit'));
  assert.match(out, /Apply to the November 2026 cohort on the Find fit track\./);
  assert.match(out, /Applications close October 25, 2026 — seven days/);
  assert.match(renderedText(band(FAILED)), /Apply on the Form track\./);
  assert.equal(applyLabelFor(OK), 'Apply to the November 2026 cohort');
});

test('no landing surface prints the client calendar’s cohort number any more', () => {
  for (const [label, src] of [['LabIntro', INTRO], ['SpinoutLabPage', PAGE], ['marketing page', MARKETING]]) {
    assert.doesNotMatch(src, /cohortNum/, `${label} still prints "Cohort N" from the client calendar`);
    assert.doesNotMatch(src, /openCohortCopy\(/, `${label} still computes the cohort on the client`);
  }
  assert.match(MARKETING, /const cohort = useCohortRecord\(\);/);
  assert.match(PAGE, /const cohort = useCohortRecord\(\);/);
});

// ---------------------------------------------------------------------------
// The open product call: per-track gates.
// ---------------------------------------------------------------------------

test('both surfaces print the one sentence that says the gates call is open', () => {
  assert.match(BRIEF, /\{GATES_DECISION\.brief\}/);
  assert.match(INTRO, /\{GATES_DECISION\.intro\}/);
  for (const k of ['brief', 'intro']) assert.match(GATES_DECISION[k], /still to be decided/);
});

test('neither surface has quietly taken a side while the call is open', () => {
  // The brief still prints each track's gates, and the intro still renders
  // the one enforced set with no track prop. When the owner decides, this
  // test is the one to change, together with the sentence above.
  assert.match(BRIEF, /TRACK_GATES\[t\.id\]/);
  assert.equal(Object.keys(TRACK_GATES).length, 3);
  const sig = INTRO.slice(INTRO.indexOf('export function LabGates'));
  assert.ok(!sig.slice(sig.indexOf('('), sig.indexOf(')') + 1).includes('track'));
});

test('the public default track stays Form; the canvas’s reason for Find fit is the signed-in case', () => {
  // The canvas defaults to Find fit "because the signed-in member has a
  // company". A logged-out visitor has not said so; the signed-in page already
  // opens on Find fit when the application said the company is incorporated.
  assert.ok(CANVAS.includes("state = { track:'fit', jur:'de' }"));
  assert.equal(DEFAULT_TRACK, 'form');
  assert.match(PAGE, /appliedIncorporated \? 'fit' : DEFAULT_TRACK/);
});
