/**
 * The Deals zones can be searched, and their chips carry honest counts.
 *
 * WHY THIS EXISTS. `/deals/*` and the legacy `/pipeline/*` trio were two
 * complete implementations of investor deal-flow over two different backends.
 * The product call (D118) was that they are the same job, so `/deals/*` wins —
 * but the legacy trio had two things the zones did not, and redirecting before
 * porting them would have replaced a working view with a poorer one:
 *
 *   1. free-text search. Absent from all four zones: `SearchInput` had zero
 *      importers under `pages/investor/deals/`.
 *   2. counts on the chip row. The zones' chips came from `ZoneToolbar` + the
 *      zone-filter builder and carried no figures.
 *
 * WHAT THE SECOND ONE TURNED OUT TO BE. Counts were never missing from the
 * MECHANISM — `zoneFilterBuilder`'s `withCount` has always substituted `{n}`
 * from a page-supplied `counts` map, and has always DROPPED the clause rather
 * than printing a figure it was not given. The zones simply never used it. So
 * this is a wiring change, not a component, and the honesty rule it inherits is
 * the one already written there.
 *
 * THE PROPERTY THIS GUARDS, and it is the one a careless edit breaks: search
 * must narrow WHAT THE CHIP CHOSE, never the raw list. A search reading
 * `scoredRows` directly still looks right on screen and silently ignores the
 * chip — `investor_deals_id2.test.mjs` pins that for Screening specifically;
 * this file pins the shape across the zones.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INVESTOR_ZONE_FILTERS } from '../src/workspaces/investorZoneFilters.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ZONE = (n) => read(`frontend/src/pages/investor/deals/${n}.jsx`);

/** The three zones that list rows. `CommitZone` is excluded on purpose — below. */
const SEARCHABLE = [
  { file: 'PipelineZone', testid: 'pipeline-search' },
  { file: 'ScreeningZone', testid: 'screening-search' },
  { file: 'ClosingZone', testid: 'closing-search' },
];

test('every row-listing Deals zone offers a search, from the shared input', () => {
  for (const { file, testid } of SEARCHABLE) {
    const z = ZONE(file);
    assert.match(z, /import \{ SearchInput \} from '\.\.\/\.\.\/advisor\/network\/kit'/,
      `${file} must reuse the shared SearchInput, not hand-roll one`);
    assert.ok(z.includes(`data-testid="${testid}"`), `${file} renders no search control`);
    // NOT the testid alone, which is on the WRAPPER: deleting the control
    // leaves an empty div carrying it, and that mutation escaped the first
    // version of this assertion. Pin the element AND its binding — a
    // SearchInput not wired to this page's state is a box that does nothing.
    assert.match(z, /<SearchInput\s+value=\{query\}\s+onChange=\{setQuery\}/,
      `${file}'s search control is gone or is not bound to its own query state`);
    assert.match(z, /const \[query, setQuery\] = useState\(''\)/, `${file} has no query state`);
  }
});

test('search narrows what the chip chose, never the raw list', () => {
  // The failure this is written for: `visible` built from the unfiltered
  // source. It renders plausibly and quietly discards the chip.
  for (const { file } of SEARCHABLE) {
    const z = ZONE(file);
    const at = z.indexOf('const visible = useMemo(');
    assert.ok(at > 0, `${file} has no visible memo to check`);
    const body = z.slice(at, z.indexOf('}, [', at));
    assert.match(body, /\b(chipped|rows)\b/,
      `${file}: search reads past the chip instead of narrowing what it chose`);
    assert.doesNotMatch(body, /\b(all|live|scoredRows|flagRows)\b\s*\./,
      `${file}: search reaches for a raw list, so the chip selects nothing`);
  }
});

test('a count is only ever claimed where the page supplies one', () => {
  // `withCount` drops a `{n}` it was not given rather than printing a zero, so
  // a label may carry `{n}` only where the page actually passes that key —
  // otherwise the chip silently loses its figure and nobody notices.
  const supplied = {
    'deals/pipeline': ['all', 'unassigned', 'stale', 'passed'],
    'deals/screening': ['scored', 'flags'],
    'deals/closing': ['close', 'documents'],
  };
  for (const [zone, keys] of Object.entries(supplied)) {
    const rows = INVESTOR_ZONE_FILTERS[zone];
    assert.ok(Array.isArray(rows), `${zone} is gone from the filter table`);
    const withN = rows.filter((r) => String(r.label || '').includes('{n}')).map((r) => r.key);
    assert.deepEqual(withN.sort(), [...keys].sort(),
      `${zone}: the labels carrying {n} and the keys the page counts have drifted apart`);
    // An `unbuilt` chip must never carry one: a figure beside a refusal reads
    // as a number the store holds.
    for (const r of rows) {
      if (!r.unbuilt) continue;
      assert.ok(!String(r.label || r.canvas).includes('{n}'),
        `${zone}: ${r.canvas} is unbuilt and claims a count`);
    }
  }
});

test('each page passes the counts its labels promise', () => {
  const pages = {
    PipelineZone: ['all:', 'unassigned:', 'stale:', 'passed:'],
    ScreeningZone: ['scored:', 'flags:'],
    ClosingZone: ['close:', 'documents:'],
  };
  for (const [file, keys] of Object.entries(pages)) {
    const z = ZONE(file);
    const at = z.indexOf('counts: {');
    assert.ok(at > 0, `${file} passes no counts, so every {n} is dropped`);
    const block = z.slice(at, z.indexOf('}', at));
    for (const k of keys) {
      assert.ok(block.includes(k), `${file} promises a count for ${k} and passes none`);
    }
    // `.length` on a loaded list, never a literal. A typed-in figure is the
    // thing the whole drop-the-clause rule exists to prevent.
    assert.doesNotMatch(block, /:\s*\d+/, `${file} hardcodes a count instead of measuring one`);
  }
});

test('CommitZone is left out on purpose, and the reason is written down', () => {
  // It is a ROOM — one deal's vote plus a decisions history — not a filterable
  // list of commit-stage deals. The legacy PipelineCommitPage WAS that list,
  // and its replacement is PipelineZone's stage chips, because `DEAL_STAGES`
  // already carries `commit` and `dealStage()` already assigns it. Forcing a
  // room into a table would be the wrong port, so assert the two facts that
  // make the substitution true rather than quietly skipping the zone.
  const flow = read('frontend/src/lib/dealFlow.js');
  assert.match(flow, /\{ id: 'commit', label: 'Commit' \}/,
    'the commit stage is gone, so PipelineZone can no longer stand in for the legacy commit list');
  assert.match(flow, /return Number\(deal\?\.capital_committed\) > 0 \? 'commit'/,
    'nothing assigns the commit stage any more');
  const commit = ZONE('CommitZone');
  assert.ok(!commit.includes('data-testid="commit-search"'),
    'CommitZone grew a search — if it became a list, this test is the thing to revisit');
});
