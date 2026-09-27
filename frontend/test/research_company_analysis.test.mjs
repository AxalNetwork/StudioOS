/**
 * D313 — one saved competitor analysis at `/research/companies/:id`, held to
 * canvas 90eb4cf2 at both ends, and `/build/competitors` retired into it.
 *
 * Each element the page claims is asserted twice: the canvas draws it and the
 * page renders it. The readings that decide what a state shows — tiles, the
 * inputs row, the feature grid, the landscape read — run here in Node.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  analysisTiles, featureGrid, inputsRow, landscapeRead, notesWithRead, signalColumns, sourceFetched,
} from '../src/pages/research/companyAnalysisRead.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const CANVAS = read('../../design/canvases/backlog/Pages · Company analysis.dc.html');
const page = read('../src/pages/research/CompanyAnalysis.jsx');
const app = read('../src/App.jsx');
const component = read('../src/components/CompetitorAnalysis.jsx');
const candidate = read('../src/pages/research/CompanyCandidate.jsx');

function bothEnds(drawn, rendered = drawn) {
  assert.ok(CANVAS.includes(drawn), `the canvas no longer draws: ${drawn}`);
  assert.ok(page.includes(rendered), `the page no longer renders: ${rendered}`);
}

test('the page renders every element the canvas draws', () => {
  for (const s of [
    'editable · max 200', 'edited since last run', 'Save', 'Re-run', 'Refresh sources', 'JSON', 'Markdown',
    'Discovering candidates, crawling public sites…',
    'Nothing is listed until the run returns. No names appear while it is working.',
    'Your saved analyses could not be read.',
    'A failed read is not an empty list — nothing here is drawn as 0 until the store answers.',
    'Try again',
    'The analysis pipeline failed. Try again or reduce depth.',
    'A failed run is not an empty landscape. Nothing was discovered, so nothing is listed.',
    'Quick scan', 'Market summary',
    'the run returned no summary, and none is generated to fill the box',
    'Competitors', 'No competitors yet',
    'Add one manually or re-run. The product will not invent a top-10.',
    'Add competitor', 'Crawl site', 'Feature comparison',
    'Gaps &amp; opportunities', 'Suggested wedge', 'Notes', 'Your own conclusions…',
    'ZONEDRAFT', 'Analysis · landscape read', 'Draft', 'Accept', 'Discard',
    'It does not add competitors.',
    'It will not invent a wedge, a price, or a company.',
    'What this page will not do',
    'Nothing here is a relationship, a headcount, or a comparable.',
    'Re-run replaces discovered rows and keeps origin=manual.',
  ]) bothEnds(s, s.replace('Gaps &amp;', 'Gaps &').replace('editable · max 200', 'editable, max 200'));
  // The inputs row, the tiles and the table's columns.
  for (const k of ['Market', 'Customer', 'Geography', 'Depth', 'Known competitors']) {
    assert.ok(CANVAS.includes(`k:'${k}'`), k);
  }
  for (const h of ['Company', 'Category', 'Origin', 'Relevance', 'Sources', 'Summary', 'Remove']) bothEnds(h);
  // The founder scope band, which only the advisor zone drew before.
  bothEnds('These analyses are yours, not a client’s.');
});

test('the model label is not called a recommendation', () => {
  // The canvas repeats the shipped "Recommended next actions"; the voice rule
  // does not let copy call model output a recommendation, on the page or in
  // the in-place panel it replaces.
  assert.ok(CANVAS.includes('Recommended next actions'));
  assert.doesNotMatch(page, /Recommend/);
  assert.doesNotMatch(component, /Recommended next actions/);
  assert.match(page, /Next steps the run listed/);
});

test('three states, three shapes: a failed read, a failed run, a finished run', () => {
  assert.equal(analysisTiles({ status: 'complete', candidates: [] }, { readFailed: true }), null);
  const failed = analysisTiles({ status: 'error', candidates: [{ category: 'direct' }] });
  assert.ok(failed.every((t) => t.nr), 'a failed run drew a count');
  const empty = analysisTiles({ status: 'complete', candidates: [], sources: [] });
  assert.deepEqual(empty.map((t) => t.v), ['0', '0', '0', '0'], 'a finished empty run is a number, 0');
  const full = analysisTiles({
    status: 'complete',
    candidates: [{ category: 'direct' }, { category: 'adjacent' }, { category: 'direct' }],
    sources: [{ status: 200 }, { status: 404 }, { status: 301 }, { status: null }],
  });
  assert.deepEqual(full.map((t) => t.v), ['3', '2', '1', '2']);
  assert.equal(sourceFetched({ status: 500 }), false);
});

test('an input the person did not give is Not recorded, never blank', () => {
  const row = inputsRow({ market: 'Climate', target_customer: '  ', geography: null, depth: 'quick', known_competitors: [] });
  assert.deepEqual(row.map((i) => (i.nr ? `${i.k}:nr` : `${i.k}:${i.v}`)),
    ['Market:Climate', 'Customer:nr', 'Geography:nr', 'Depth:quick', 'Known competitors:nr']);
});

test('the feature grid is features by competitor, and a blank cell is not "no"', () => {
  const grid = featureGrid({ feature_comparison: {
    features: ['Self-serve', 'Scope 3'],
    rows: [{ competitor: 'A', values: ['yes', 'no'] }, { competitor: 'B', values: ['', undefined] }],
  } });
  assert.deepEqual(grid.head, ['A', 'B']);
  assert.deepEqual(grid.rows, [
    { feature: 'Self-serve', cells: ['yes', null] },
    { feature: 'Scope 3', cells: ['no', null] },
  ]);
  assert.equal(featureGrid({ feature_comparison: { features: [], rows: [] } }), null);
  // Rows with no feature heads are no grid either: drawing it would invent the heads.
  assert.equal(featureGrid({ feature_comparison: { features: ['  '], rows: [{ competitor: 'A', values: ['yes'] }] } }), null);
  assert.equal(featureGrid({}), null);
  assert.deepEqual(signalColumns({ pricing_signals: [], activity_signals: [{ competitor: 'A', detail: 'hiring' }] }).map((c) => c.k),
    ['Hiring & content activity']);
});

test('the landscape read restates the page, and Accept appends it to the notes', () => {
  assert.equal(landscapeRead({ candidates: [], output: {} }), null);
  const r = landscapeRead({
    output: { market_summary: 'Three players.' },
    candidates: [{ name: 'A', category: 'direct', summary: 'seat pricing' }, { name: 'B', category: 'adjacent' }],
    sources: [{ kind: 'pricing', status: 200 }, { kind: 'careers', status: 404 }],
  });
  assert.match(r, /^Market: Three players\./);
  assert.match(r, /Direct \(1\): A — seat pricing/);
  assert.match(r, /Adjacent \(1\): B$/m);
  assert.match(r, /Read from their pricing pages\./);
  assert.doesNotMatch(r, /careers/, 'a source that did not come back was restated as read');
  assert.equal(notesWithRead('Mine.', 'X'), 'Mine.\n\nLandscape read:\nX');
  assert.equal(notesWithRead('', 'X'), 'Landscape read:\nX');
  assert.match(page, /notesWithRead\(out\.notes, preview\.trim\(\)\)/);
});

test('a save never sends the candidate set, so a blank relevance is never written as 0', () => {
  // `PATCH /competitors/:id` re-inserts every candidate with
  // `Number(relevance_score) || 0`. The page sends title and output only, and
  // changes a category through the one-company route.
  const saves = [...page.matchAll(/api\.competitors\.save\(id, \{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(saves.length >= 2, 'the saves could not be found');
  for (const body of saves) assert.doesNotMatch(body, /candidates/);
  assert.match(page, /api\.competitors\.candidateUpdate\(id, c\.id, \{ category: e\.target\.value \}\)/);
  assert.match(page, /c\.relevance_score == null \? <Unrecorded \/>/);
});

test('the page is routed for the list’s licences and the list links to it', () => {
  assert.match(app, /path="\/research\/companies\/:id" element=\{guard\(labRoles\(\['admin', 'founder', 'advisor'\]\), <CompanyAnalysis /);
  // The zone's saved list is a link, and it is the branch `linkToDossier`
  // takes — the text of a Link in a dead arm would prove nothing.
  assert.match(component, /linkToDossier \? \(\s*\/\/[^\n]*\n\s*<Link key=\{a\.id\} to=\{`\/research\/companies\/\$\{encodeURIComponent\(a\.id\)\}`\}/);
  assert.match(component, /navigate\(`\/research\/companies\/\$\{encodeURIComponent\(full\.id\)\}`\)/);
  // The candidate page's back-link and its after-remove now land on the analysis.
  assert.equal((candidate.match(/\/research\/companies\/\$\{encodeURIComponent\(analysisId\)\}`/g) || []).length, 2);
});

test('/build/competitors redirects with its ?id=, and stays only where nothing replaces it', () => {
  const at = app.indexOf('path="/build/competitors"');
  const route = app.slice(at, app.indexOf('<Route', at + 10));
  assert.match(route, /get\('id'\)\s*\?\s*`\/research\/companies\/\$\{encodeURIComponent\(new URLSearchParams\(location\.search\)\.get\('id'\)\)\}`\s*:\s*'\/research\/companies'/);
  assert.match(route, /replace/);
  // Partner and investor are not admitted by /research/companies, so a redirect
  // would lock them out of a page they can use today.
  assert.match(route, /effectiveRole === 'partner' \|\| effectiveRole === 'investor'\s*\?\s*founderWorkspace\('research', <CompetitorAnalysisPage \/>\)/);
});

test('no fixture from the canvas reaches the page', () => {
  assert.doesNotMatch(page, /Loomwright|Verdant IO|Helios|Novacraft|an_7f3k|Climate software/);
});
