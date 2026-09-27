/**
 * D314 — one benchmark at `/research/benchmarking/:uid`, held to canvas
 * f2eb2046 at both ends: the canvas draws each element and the page renders
 * it. The readings that decide a tracked row from a comparison — tiles, the
 * draft, the editor's patch — run here in Node.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { benchmarkTiles, editorFields, editorPatch, readingDraft } from '../src/pages/research/benchmarkRead.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const CANVAS = read('../../design/canvases/backlog/Pages · Benchmark.dc.html');
const page = read('../src/pages/research/BenchmarkDetail.jsx');
const list = read('../src/pages/research/BenchmarkingZone.jsx');
const app = read('../src/App.jsx');
const api = read('../src/lib/api.js');

function bothEnds(drawn, rendered = drawn) {
  assert.ok(CANVAS.includes(drawn), `the canvas no longer draws: ${drawn}`);
  assert.ok(page.includes(rendered), `the page no longer renders: ${rendered}`);
}

test('the page renders every element the canvas draws', () => {
  for (const s of [
    'Benchmark', 'Ours not recorded', 'vs', 'Tracked, not compared',
    'Read the base before the number.',
    'No peer figure is entered, so there is nothing to compare against. A zero here would be a number the record does not hold.',
    'What the comparison supports', 'No read written yet — the comparison is shown without one.',
    'Peer constituents', 'Name', 'Value', 'As of',
    'The stored sample size is left as it is — a list that disagrees with the figure is a question for you, not something to silently correct.',
    'The product stores n only. Name the constituents or cite a published table. Do not invent funds.',
    'Add a constituent', 'Edit this benchmark', 'Save',
    'A peer figure needs its source and sample size — the schema refuses the row without them.',
    'Leave the peer field blank and the row stays tracked. Fill it and source and sample become required.',
    'ZONEDRAFT', 'Benchmark · what this supports', 'Draft', 'Accept', 'Discard',
    'Accept writes the reading. It does not invent a peer figure.',
    'Enter ours or a sourced peer first.',
    'Where the peer numbers come from',
    'Nowhere but you. This product ships no peer data set and gathers none',
  ]) bothEnds(s);
  // The editor's six fields and the four tiles, by their canvas words.
  for (const f of ['Metric', 'Ours', 'Peer figure', 'Peer source', 'Sample size', 'Measured as of']) {
    assert.ok(CANVAS.includes(`fieldOf('${f}'`), f);
    assert.ok(page.includes(`'${f}'`), f);
  }
  for (const k of ['Ours', 'Peer', 'Sample', 'As of']) assert.ok(CANVAS.includes(`k:'${k}'`), k);
  // The canvas's comparison caption, both halves.
  bothEnds('Neither figure is coloured as better');
  bothEnds('Tracked without a peer. Nothing is coloured, ranked, or compared, because there is nothing to compare it to.');
});

test('a tracked row is Not recorded in every peer tile, never zero', () => {
  const tracked = benchmarkTiles({ metric: 'X', our_value: null, is_comparison: false });
  assert.deepEqual(tracked.map((t) => (t.nr ? `${t.k}:nr` : `${t.k}:${t.v}`)), ['Ours:nr', 'Peer:nr', 'Sample:nr', 'As of:nr']);
  const cmp = benchmarkTiles({ our_value: '1.4x', peer_value: '1.2x', peer_sample_size: 4, peer_as_of: '2026 Q2', is_comparison: true }, { thin: true });
  assert.deepEqual(cmp.map((t) => t.v), ['1.4x', '1.2x', 'n=4', '2026 Q2']);
  assert.equal(cmp.find((t) => t.k === 'Sample').warn, true);
  const wide = benchmarkTiles({ our_value: '1x', peer_value: '1x', peer_sample_size: 400, is_comparison: true }, { thin: false });
  assert.equal(wide.find((t) => t.k === 'Sample').warn, false);
  // Values keep their unit: nothing parses "1.4x".
  assert.doesNotMatch(read('../src/pages/research/benchmarkRead.js'), /parseFloat|Number\(item\.(our|peer)_value/);
});

test('the draft restates the fields and says so on a thin base', () => {
  assert.equal(readingDraft({ is_comparison: false, our_value: null }), null);
  assert.equal(readingDraft({ is_comparison: false, our_value: '45 days' }),
    'Ours reads 45 days, with no peer figure entered, so there is nothing to compare it to.');
  const thin = readingDraft({ is_comparison: true, our_value: '1.4x', peer_value: '1.2x', peer_source: 'Four funds', peer_sample_size: 4, peer_as_of: '2026 Q2' }, { thin: true });
  assert.equal(thin, 'Ours reads 1.4x against a peer of 1.2x from Four funds, n=4, as of 2026 Q2. At that sample the gap is not a market rate: one member moves the median.');
  const noOurs = readingDraft({ is_comparison: true, our_value: null, peer_value: '1.2x', peer_source: 'S', peer_sample_size: 50 });
  assert.match(noOurs, /^Ours is not recorded against a peer of 1\.2x from S, n=50\./);
  assert.match(page, /benchmarkUpdate\(uid, \{ reading: preview\.trim\(\) \}\)/, 'Accept does not write the reading');
});

test('the editor sends a blank as null and a blank sample as null, never 0', () => {
  const f = editorFields({ metric: 'TVPI', our_value: null, peer_sample_size: 4 });
  assert.deepEqual(f, { metric: 'TVPI', our_value: '', peer_value: '', peer_source: '', peer_sample_size: '4', peer_as_of: '' });
  assert.deepEqual(editorPatch({ metric: ' TVPI ', our_value: ' ', peer_value: '', peer_source: 'x', peer_sample_size: '', peer_as_of: '' }), {
    metric: 'TVPI', our_value: null, peer_value: null, peer_source: 'x', peer_sample_size: null, peer_as_of: null,
  });
  assert.equal(editorPatch({ metric: 'm', peer_sample_size: '12' }).peer_sample_size, 12);
});

test('the page is routed for the list’s licences, the list links to it, and it reads through the new methods', () => {
  assert.match(app, /path="\/research\/benchmarking\/:uid" element=\{guard\(labRoles\(\['admin', 'investor'\]\), <BenchmarkDetail /);
  assert.match(list, /to=\{`\/research\/benchmarking\/\$\{encodeURIComponent\(b\.uid\)\}`\}/);
  for (const m of ['benchmarkGet', 'benchmarkUpdate', 'benchmarkConstituentAdd', 'benchmarkConstituentRemove']) {
    assert.ok(api.includes(`${m}: (`), `api.js has no ${m}`);
    assert.ok(page.includes(`api.research.${m}(`), `the page does not call ${m}`);
  }
  // A missing benchmark is its own state, branched on the code.
  assert.match(page, /e\?\.code === 'benchmark_not_found' \? 'missing' : 'unreadable'/);
});

test('a constituent can be added only to a comparison, and the mismatch is the worker’s own sentence', () => {
  const add = page.slice(page.indexOf('{cmp ? ('), page.indexOf('Edit this benchmark'));
  assert.match(add, /Add a constituent/);
  assert.match(add, /A tracked row has no peer set to name members of\./);
  assert.match(page, /\{`\$\{detail\.mismatch_note\} The stored sample size is left as it is/);
  assert.match(page, /detail\.count_mismatch &&/);
});

test('no fixture from the canvas reaches the page', () => {
  for (const src of [page, read('../src/pages/research/benchmarkRead.js')]) {
    assert.doesNotMatch(src, /Thornbury|bm_3k1|bm_5c7|Fund C|Four 2023 vintage funds/);
  }
});
