/**
 * D312 — the fund dossier against canvas c0834993's FS4d, at both ends.
 *
 * Each element the page claims is asserted twice: FS4d draws it, and the page
 * renders it. The checklist and the Last-updated reading run here in Node, so
 * a row that starts counting a storeless fact as a gap fails on its value.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NO_STORE, gapCount, missingChecklist, updatedAgo } from '../src/pages/research/fundDossierRead.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const CANVAS = read('../../design/canvases/integrated/Pages · Funds and fund research.dc.html');
// FS4d alone: from its marker to the next artboard's.
const FS4D = CANVAS.slice(CANVAS.indexOf("id:'fs4d'"), CANVAS.indexOf("id:'fs3d'"));
const page = read('../src/pages/research/FundDossier.jsx');
const helpers = read('../src/pages/research/fundDossierRead.js');
const list = read('../src/pages/research/FundsZone.jsx');

function bothEnds(drawn, rendered = drawn, where = page) {
  assert.ok(FS4D.includes(drawn), `FS4d no longer draws: ${drawn}`);
  assert.ok(where.includes(rendered), `the dossier no longer renders: ${rendered}`);
}

test('the slice is FS4d and nothing else', () => {
  assert.ok(FS4D.length > 2000, 'FS4d could not be found in the canvas');
  assert.ok(!FS4D.includes("id:'fs3d'"));
});

test('the dossier renders every element FS4d draws', () => {
  bothEnds("label:'Last updated'", 'k="Last updated"');
  bothEnds("note:'by you'", "'by you'");
  bothEnds('Public size, if you recorded it');
  bothEnds('What they have funded');
  bothEnds("aiLabel:'Proposal · pre-meeting brief'", 'label="Proposal · pre-meeting brief"');
  bothEnds("aiAccept:'Write into the note'", 'accept="Write into the note"');
  // The checklist rows the canvas draws, by their words; the helper holds them.
  for (const row of ['Thesis quoted', 'Cheque range complete', 'Stage assessed', 'Path assessed',
    'At least one sourced investment', 'Public size', 'Partner who will be in the room']) {
    bothEnds(row, row, helpers);
  }
  assert.match(FS4D, /What\\u2019s missing for a Thursday meeting/);
  assert.match(page, /What’s missing before a meeting/);
});

test('a storeless row is Not recorded with its reason, never a gap', () => {
  const full = {
    thesis: 't', cheque_min_cents: 1, cheque_max_cents: 2, stage_fit: 'right', path: 'warm',
    source_url: 'https://x.test', status: 'researching',
  };
  const rows = missingChecklist(full);
  assert.equal(gapCount(rows), 0, 'a fund with every column recorded still showed gaps');
  for (const key of ['investments', 'size', 'partner']) {
    const r = rows.find((x) => x.key === key);
    assert.equal(r.done, null, `${key} was counted as done or as a gap`);
    assert.equal(r.sub, NO_STORE[key]);
  }
  assert.ok(!rows.some((r) => r.key === 'pass'), 'a live fund was asked for a pass reason');
});

test('each derived row reads its own column, and a half cheque is a gap', () => {
  const bare = { status: 'passed' };
  const rows = missingChecklist(bare);
  assert.deepEqual(rows.filter((r) => r.done === false).map((r) => r.key),
    ['thesis', 'cheque', 'stage', 'path', 'source', 'pass']);
  assert.equal(gapCount(rows), 6);
  const half = missingChecklist({ cheque_min_cents: 100, status: 'researching' }).find((r) => r.key === 'cheque');
  assert.equal(half.done, false);
  assert.equal(half.sub, 'only one end is recorded');
  // A zero is a recorded end, not a missing one.
  assert.equal(missingChecklist({ cheque_min_cents: 0, cheque_max_cents: 0 }).find((r) => r.key === 'cheque').done, true);
});

test('Last updated reads the row’s stamp, and a missing stamp is Not recorded', () => {
  const now = new Date('2026-09-27T12:00:00Z');
  assert.equal(updatedAgo('2026-09-24T09:00:00.000Z', now), '3 days ago');
  assert.equal(updatedAgo('2026-09-27 08:00:00', now), 'today');
  assert.equal(updatedAgo('2026-09-26T08:00:00Z', now), 'yesterday');
  assert.equal(updatedAgo(null, now), null);
  assert.equal(updatedAgo('not a date', now), null);
  assert.match(page, /nr=\{!updated\}/);
});

test('the list no longer promises fit scores', () => {
  assert.doesNotMatch(list, /fit scores/);
});
