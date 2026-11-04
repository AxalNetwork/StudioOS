// #3792 (D1547) — the Grid runbook stays true to the code.
//
// documentation/operations/DECK_GRID.md tells an operator which routes, tables,
// states and limits to use. Each claim below pairs a phrase the runbook prints
// with the source line that makes it true, so either side changing alone fails
// here: a route renamed, a state added, a TTL changed, a limit moved.
//
// It also holds the page to its own honesty rule: while no staging Worker is
// live, no procedure may say it was tested on staging.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/deck_grid_runbook_3792.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_SLICES, SLICE_MS as QUEUE_SLICE_MS } from '../src/services/decks/queueRuntime.ts';
import { HOLD_TTL_MS } from '../src/services/aiBudget.ts';
import { REQUIRED_MODELS } from '../src/services/ai/modelPolicy.ts';

const RUNBOOK = readFileSync('documentation/operations/DECK_GRID.md', 'utf8');
const src = (p: string) => readFileSync(`cloudflare-worker/src/${p}`, 'utf8');
const sql = (p: string) => readFileSync(`cloudflare-worker/sql/migrations/${p}`, 'utf8');
const has = (text: string, needle: string | RegExp, why: string) =>
  assert.ok(typeof needle === 'string' ? text.includes(needle) : needle.test(text), why);

/** [what the runbook prints, the file that makes it true, what that file must contain]. */
const CLAIMS: Array<[string, string, string | RegExp]> = [
  // 1. Switch off a model
  ['`/api/admin/ai/element-models`', 'routes/admin_ai_element_models.ts', "path: '/api/admin/ai/element-models'"],
  ['`PUT /api/admin/ai/element-models`', 'routes/admin_ai_element_models.ts', "r.put('/'"],
  ['`ai_model_policy_set`', 'routes/admin_ai_element_models.ts', "'ai_model_policy_set'"],
  ['`model_not_offered`', 'services/featureFlags.ts', /model_not_offered|modelsOffFor/],
  ['`reason_required`', 'services/ai/modelPolicy.ts', "'reason_required'"],
  ['409 `model_required`', 'services/ai/modelPolicy.ts', "'model_required'"],
  // 2. Refund a batch
  ['`POST /api/ai-budget/reviews/:uid/refund`', 'routes/ai_budget.ts', "for (const action of ['charge','refund'] as const) r.post(`/reviews/:uid/${action}`"],
  ['`POST /api/ai-budget/members/:userId/adjustments`', 'routes/ai_budget.ts', "r.post('/members/:userId/adjustments'"],
  // D4373 (#4373): the batch refund, its ledger key and its audit action.
  ['`POST /api/ai-budget/deck-batches/:uid/refund`', 'routes/ai_budget.ts', "r.post('/deck-batches/:uid/refund'"],
  ["`source_ref = 'adj:deck-refund:<batch uid>:<seq>'`", 'services/decks/batchRefund.ts', "REFUND_REF_PREFIX = 'adj:deck-refund:'"],
  ['`deck_batch_refund`', 'services/decks/batchRefund.ts', "'deck_batch_refund'"],
  ["`operation = 'deck.generate'`", 'services/decks/genRuntime.ts', "'deck.generate'"],
  ['`deck-batch:<key>`', 'services/decks/genRuntime.ts', 'deck-batch:'],
  ['`releaseExpired`', 'services/aiBudget.ts', 'releaseExpired'],
  // 3. Unstick a batch
  ['`POST /api/decks/areas/batches/:uid/cancel`', 'routes/deck_batches.ts', 'deckBatches.post(`/areas/batches/:uid${UID}/cancel`'],
  ['`not_your_run`', 'routes/deck_batches.ts', 'not_your_run'],
  ['`deck_gen_slice`', 'services/decks/queueRuntime.ts', "export const DECK_GEN_JOB = 'deck_gen_slice'"],
  ['`[deck-gen-queue] slice cap reached`', 'services/decks/queueRuntime.ts', "'[deck-gen-queue] slice cap reached'"],
  ['10-minute slices', 'durable-objects/deck-gen-room.ts', 'export const SLICE_MS = 10 * 60_000;'],
  ['`POST /api/infra/dlq/:id/retry?source=cf|d1`', 'routes/infra.ts', "infra.post('/dlq/:id/retry'"],
  ['`GET /api/infra/dlq`', 'routes/infra.ts', "infra.get('/dlq'"],
  ['`settleAiReservation`', 'services/aiBudget.ts', 'settleAiReservation'],
  // 4. Purge an image
  ['`GET /api/decks/images/:uid/file`', 'routes/deck_images.ts', "/images/:uid"],
  ['`cache-control: public, max-age=31536000, immutable`', 'routes/deck_images.ts', "'public, max-age=31536000, immutable'"],
  ['`POST /api/decks/images/:uid/discard`', 'routes/deck_images.ts', "deckImages.post('/images/:uid/discard'"],
  ['409 `image_kept`', 'routes/deck_images.ts', "code: 'image_kept'"],
  ['`DELETE /api/decks/:id/logos/:key`', 'routes/deck_venture_elements.ts', "r.delete('/:id{[0-9]+}/logos/:key'"],
  ['`sweepDeckImages`', 'models/jobs.ts', 'sweepDeckImages'],
];

test('#3792: every route, code and name the runbook prints is still in the code', () => {
  for (const [said, file, needle] of CLAIMS) {
    has(RUNBOOK, said, `the runbook no longer says ${said}`);
    has(src(file), needle, `${file} no longer backs the runbook's ${said}`);
  }
});

test('#3792: the batch, step and hold states the runbook lists are the schema\'s', () => {
  const batches = sql('716_deck_area_batches.sql');
  const states = /state\s+TEXT\s+NOT NULL DEFAULT 'queued' CHECK \(state IN \(([^)]+)\)\)/.exec(batches)![1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(states, ['queued', 'running', 'cancelling', 'done', 'cancelled', 'failed']);
  for (const s of states) has(RUNBOOK, `\`${s}\``, `the runbook names the batch state ${s}`);
  // The stuck query and the hand fix use exactly the active set the one-run-per-deck index uses.
  has(batches, "WHERE state IN ('queued', 'running', 'cancelling')", 'the one-active-run index');
  has(RUNBOOK, "b.state IN ('queued', 'running', 'cancelling')", 'the stuck query uses the index\'s active set');
  has(RUNBOOK, "state IN ('queued', 'running', 'cancelling');", 'the hand fix only touches an active run');
  // Columns the SQL reads exist (an earlier draft used one that does not).
  for (const col of ['quote_microusd', 'reservation_uid', 'charged_microusd', 'started_at', 'settled_at', 'created_at']) has(batches, new RegExp(`\\b${col}\\b`), col);
  assert.doesNotMatch(RUNBOOK, /ended_at/, 'deck_area_batches has no ended_at');
  // A tombstone takes only the two reasons the schema allows, and the runbook inserts one of them.
  const tomb = sql('722_deck_r2_tombstones.sql');
  has(tomb, "reason IN ('discarded', 'unkept_proposal')", 'tombstone reasons');
  has(RUNBOOK, "INSERT INTO deck_r2_tombstones (key, project_id, bytes, reason)", 'the tombstone insert names the columns');
  has(tomb, 'CREATE VIEW IF NOT EXISTS deck_images_named', 'deck_images_named is a view');
});

test('#3792: the limits the runbook quotes are the code\'s', () => {
  assert.equal(HOLD_TTL_MS, 300_000);
  has(RUNBOOK, 'five-minute TTL', 'the hold TTL');
  assert.equal(MAX_SLICES, 500);
  has(RUNBOOK, 'up to 500 slices', 'the queue slice cap');
  assert.equal(QUEUE_SLICE_MS, 5 * 60_000);
  has(RUNBOOK, '5-minute slice', 'the queue slice');
  assert.deepEqual([...REQUIRED_MODELS], ['@cf/meta/llama-guard-3-8b']);
  has(RUNBOOK, '`@cf/meta/llama-guard-3-8b`', 'the model that cannot be switched off');
  const toml = readFileSync('wrangler.toml', 'utf8');
  has(toml, /max_retries\s*=\s*3\s*\ndead_letter_queue\s*=\s*"studioos-job-queue-dlq"/, 'three tries, then the DLQ');
  has(RUNBOOK, 'fails three times goes to `studioos-job-queue-dlq`', 'the runbook says three tries');
});

test('#3792: no procedure claims a staging run while no staging Worker is live', () => {
  const toml = readFileSync('wrangler.toml', 'utf8');
  const placeholder = /REPLACE_WITH_PREVIEW_D1_ID/.test(toml);
  if (placeholder) {
    assert.doesNotMatch(RUNBOOK.replace(/\*\*none is marked "tested on staging"\*\*/, ''), /tested on staging/i,
      'the preview env still has placeholder ids: nothing on this page can have been tested on staging');
    for (const row of RUNBOOK.split('\n').filter((l) => /^\| [1-4] \|/.test(l))) assert.match(row, /Not on staging/, row);
  }
});
