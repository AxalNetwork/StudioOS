/**
 * The `/deals` root board reads the deal record honestly.
 *
 * TWO DEFECTS LIVED HERE. The pipeline section's Stage cell read `row.stage`,
 * a column no deal row has (`deals` carries a CHECKed `status`, and the
 * bucket's five stages are a translation of it — see `lib/dealFlow.js`), so
 * every Stage cell on the board read "Not recorded". And the section's summary
 * counted every row as a "live deal", passed ones included — a passed deal is
 * at no stage and is not live (`dealStage` returns null for one).
 *
 * Both are pinned as BEHAVIOUR: the registry is a pure module, so its `rows`
 * and `summary` are driven with fixture rows here rather than asserted as
 * source text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { boardFor } from '../src/workspaces/boards/index.js';
import { DEAL_STAGE_LABEL, dealStage } from '../src/lib/dealFlow.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
// The registries take `api` as an argument precisely so this file can load
// them; the board's sources are not called by these tests.
const STUB = new Proxy({}, { get: () => () => Promise.resolve({}) });

const board = boardFor('investor', '/deals', STUB);
const pipeline = board.sections.find((s) => s.slug === 'pipeline');

const FIXTURE = [
  { id: 1, project_name: 'Alpha', project_sector: 'robotics', status: 'applied', target_raise: 500000, days_in_stage: 3 },
  { id: 2, project_name: 'Beta', project_sector: 'climate', status: 'active', capital_committed: 250000, amount: 1000000, days_in_stage: 41 },
  // A passed deal: at no stage, not live, and not on this board.
  { id: 3, project_name: 'Gamma', project_sector: 'fintech', status: 'rejected', pass_reason: 'early', days_in_stage: 12 },
];

test('the pipeline Stage cell is the translated status, never a `stage` column', () => {
  const src = read('frontend/src/workspaces/boards/investorDeals.js');
  assert.ok(!/\brow\.stage\b/.test(src), 'the board reads row.stage again — no deal row has one');
  assert.match(src, /dealStage\(row\)/, 'the Stage cell must come from dealStage, the zone’s own vocabulary');

  const rows = pipeline.rows(FIXTURE);
  const alpha = rows.find((r) => r[0] === 'Alpha');
  const beta = rows.find((r) => r[0] === 'Beta');
  assert.equal(alpha[2], DEAL_STAGE_LABEL[dealStage(FIXTURE[0])]);
  assert.equal(beta[2], DEAL_STAGE_LABEL[dealStage(FIXTURE[1])]);
  assert.equal(alpha[2], 'Sourced', 'applied translates to Sourced');
  assert.equal(beta[2], 'Commit', 'active with committed capital translates to Commit');
});

test('a passed deal is neither listed nor counted as live', () => {
  const rows = pipeline.rows(FIXTURE);
  assert.ok(!rows.some((r) => r[0] === 'Gamma'), 'a passed deal is on the pipeline board');
  assert.equal(rows.length, 2);
  assert.equal(pipeline.summary(FIXTURE), '2 live deals',
    'the summary must count only live deals — a passed one is not live');
  // And a board holding only passed deals states a real zero — the payload
  // loaded, so this is a count, not an absence.
  assert.equal(pipeline.summary([FIXTURE[2]]), '0 live deals',
    'a loaded board with no live deal states the zero rather than counting the pass');
});
