// D4155 K5 (#4192) — HQ › Decks › Stage norms (HD5, HD5b): the model's rules,
// the client's routes, and the page's controls.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_decks_norms_4192.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NORM_STAGE_OF, NOT_RECORDED, PROJECT_NORMS_NOTE, STAGES, normBody, normDraftArmed, normRangeText, normRetireArmed, normRow,
} from '../src/pages/hq/decks/hqDecksModel.js';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const PAGE = read('pages/hq/decks/HqDecksPage.jsx');
const CLIENT = read('lib/api/hqDeckStageNorms.js');
const NORMS = PAGE.slice(PAGE.indexOf('function NormForm('), PAGE.indexOf('export default function HqDecksPage('));
const REASON = 'Synthetic: the 2026 report moved it.';

test('HD5: each page stage maps to a stage the Worker stores', () => {
  const worker = readFileSync(new URL('../../cloudflare-worker/src/services/decks/stageNorms.ts', import.meta.url), 'utf8');
  const stored = JSON.parse(worker.match(/export const STAGES = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  assert.deepEqual(STAGES.map((s) => NORM_STAGE_OF[s.id]), stored);
});

test('HD5: a row reads the range in the Worker\'s words, and a retired one says who, when and why', () => {
  assert.deepEqual([normRangeText({ low: 100, high: 120, unit: '%' }), normRangeText({ low: 5, high: null, unit: 'logos' }), normRangeText({ low: null, high: 2, unit: 'x' }),
    normRangeText({ low: 3, high: 3, unit: '' }), normRangeText({})], ['100–120%', '5+ logos', 'up to 2x', '3', NOT_RECORDED]);
  const worker = readFileSync(new URL('../../cloudflare-worker/src/services/decks/hqStageNorms.ts', import.meta.url), 'utf8');
  assert.match(worker, /const u = !unit \? '' : \/\^\[%x×\]\/\.test\(unit\) \? unit : ` \$\{unit\}`;/, 'the same unit rule as the Worker');
  const active = normRow({ uid: 'a', metric: 'NRR', range: { low: 100, high: 120, unit: '%' }, source: 'Synthetic report', last_reviewed: '2026-10-01', status: 'active' });
  assert.deepEqual([active.range, active.source, active.reviewed, active.retired, active.retiredLine], ['100–120%', 'Synthetic report', '2026-10-01', false, null]);
  const gone = normRow({ uid: 'b', metric: 'Logo count', range: { low: 5, high: null, unit: 'logos' }, source: 's', last_reviewed: '2026-09-01', status: 'retired',
    retired_by: { uid: 'u-2', name: 'Second Admin' }, retired_reason: 'Not a stage signal', retired_at: '2026-10-02 09:00:00' });
  assert.equal(gone.retiredLine, 'Retired 2026-10-02 by Second Admin · “Not a stage signal”');
  assert.match(normRow({ status: 'retired', retired_by: null }).retiredLine, /by Not recorded/, 'a setter no longer on file is "Not recorded", never guessed');
});

test('HD5b: Add needs a metric, a range with a bound, a source and a reason; Retire needs a reason', () => {
  const ok = { metric: 'NRR', low: '100', high: '120', source: 'Synthetic report', reason: REASON };
  assert.equal(normDraftArmed(ok), true);
  assert.equal(normDraftArmed({ ...ok, source: '  ' }), false, 'no source, no norm');
  assert.equal(normDraftArmed({ ...ok, reason: 'too short' }), false);
  assert.equal(normDraftArmed({ ...ok, metric: '' }), false);
  assert.equal(normDraftArmed({ ...ok, low: '', high: '' }), false, 'a range has a bound');
  assert.equal(normDraftArmed({ ...ok, low: '9', high: '3' }), false);
  assert.equal(normDraftArmed({ ...ok, low: 'many' }), false);
  assert.equal(normDraftArmed({ ...ok, high: '' }), true, 'a low alone ("5+") is a range');
  assert.equal(normRetireArmed({ reason: REASON }), true);
  assert.equal(normRetireArmed({ reason: ' short ' }), false);
  assert.deepEqual(normBody({ stage: 'series_b', metric: ' NRR ', low: '100', high: '', unit: ' % ', source: ' s ', reason: ` ${REASON} ` }),
    { stage: 'series_b_plus', metric: 'NRR', range: { low: 100, high: null, unit: '%' }, source: 's', reason: REASON });
});

test('the client calls only the K5 routes, and every write carries its body', () => {
  assert.match(CLIENT, /const BASE = '\/admin\/deck-stage-norms';/);
  assert.match(CLIENT, /add: \(norm\) => request\(BASE, \{ method: 'POST'/);
  assert.match(CLIENT, /edit: \(uid, changes\) => request\(`\$\{BASE\}\/\$\{enc\(uid\)\}`, \{ method: 'PUT'/);
  assert.match(CLIENT, /retire: \(uid, \{ reason \} = \{\}\) => request\(`\$\{BASE\}\/\$\{enc\(uid\)\}\/retire`, \{ method: 'POST', body: JSON\.stringify\(\{ reason \}\) \}\)/);
  assert.match(CLIENT, /projectNorms: \(projectId\) => request\(`\$\{BASE\}\/projects\/\$\{enc\(projectId\)\}`\)/);
  assert.doesNotMatch(CLIENT, /\/decks\/stage-norms/, 'HQ never writes a venture\'s norms');
});

test('HD5/HD5b on the page: Add, Edit and Retire are live and armed by the rules; a retired norm has no actions; the venture panel is read-only', () => {
  assert.doesNotMatch(NORMS, /notYet\('K5'\)|disabled title=/, 'nothing waits on K5');
  assert.match(NORMS, /disabled=\{busy \|\| !armed\} onClick=\{submit\} data-testid="deck-norm-save"/);
  assert.match(NORMS, /const armed = normDraftArmed\(f\);/);
  assert.match(NORMS, /disabled=\{busy \|\| !normRetireArmed\(\{ reason \}\)\}/);
  assert.match(NORMS, /\{!r\.retired && \(\s*<div className="flex gap-1\.5">/, 'Edit and Retire only on an active norm');
  assert.match(NORMS, /useRead\(\(\) => hqDeckStageNormsApi\.list\(\{ stage: NORM_STAGE_OF\[stage\] \}\), \[stage\]\)/);
  const panel = NORMS.slice(NORMS.indexOf('function ProjectNorms('), NORMS.indexOf('function Norms('));
  assert.match(panel, /\{PROJECT_NORMS_NOTE\}/);
  assert.doesNotMatch(panel, /hqDeckStageNormsApi\.(add|edit|retire)|<button[^>]*>(Edit|Retire|Save)/, 'read only');
  assert.match(PROJECT_NORMS_NOTE, /HQ cannot change them/);
  assert.match(NORMS, /That is not the same as no norms\./);
  assert.doesNotMatch(NORMS, /\.email\b/);
});
