/**
 * #4313 part 2 (D4313) — no rail press reads a model from a page row.
 *
 *   1. Every page's kind names a job (RAIL_KIND_JOBS); `railTextJob` gives a
 *      press with no option, or an unregistered option, its page's job, and a
 *      registered option its own job (or none when that job writes no text).
 *   2. The run: a page press is the page job's run through textChoice, with a
 *      text receipt naming the job; a named model is checked against the
 *      page's list (the job's selector) and never chooses by itself.
 *   3. The page-level pick is gone: PUT /rail/pick needs an option, and a
 *      stored page pick is neither read by a run nor by the rail.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/rail_page_jobs_4313.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { railRows, railOptionRows, resolveRail } from '../src/services/ai/railMatrix.ts';
import { RAIL_KIND_JOBS, jobStep } from '../src/services/ai/modelUseCases.ts';
import { TEXT_KINDS, isTextJob, railOptionTextJob } from '../src/services/ai/textJobs.ts';
import { railTextJob } from '../src/services/aiRouter.ts';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('1. every page kind names a job; a text kind\'s job writes text', () => {
  for (const row of railRows()) {
    const ref = RAIL_KIND_JOBS[row.kind];
    assert.ok(ref, `${row.pageKey}: kind ${row.kind} names no job`);
    const step = jobStep(ref.id, ref.step);
    assert.ok(step, `${row.kind}: ${ref.id} step ${ref.step} is not in the plan`);
    if (TEXT_KINDS.has(step!.kind)) assert.ok(isTextJob(ref.id), `${row.kind}: ${ref.id} has no text step`);
  }
});

test('1b. railTextJob: a page press runs its page\'s job; a registered option its own; an unlisted page none', () => {
  const page = railRows().find((r) => r.kind === 'research')!;
  assert.deepEqual(railTextJob(page.pageKey, null), { job: RAIL_KIND_JOBS.research.id, optionRow: null });
  assert.deepEqual(railTextJob(page.pageKey, 'not:registered'), { job: RAIL_KIND_JOBS.research.id, optionRow: null }, 'an unregistered option is the page\'s press');
  const speech = railRows().find((r) => r.kind === 'speech')!;
  assert.equal(railTextJob(speech.pageKey, null)!.job, null, 'a speech page\'s job writes no text: its own path');
  const opt = railOptionRows().find((o) => railOptionTextJob(o.pageKey, o.optionKey))!;
  const got = railTextJob(opt.pageKey, opt.optionKey)!;
  assert.equal(got.job, railOptionTextJob(opt.pageKey, opt.optionKey));
  assert.equal(got.optionRow?.optionKey, opt.optionKey);
  const rec = railOptionRows().find((o) => !railOptionTextJob(o.pageKey, o.optionKey))!;
  assert.equal(railTextJob(rec.pageKey, rec.optionKey)!.job, null, 'an option whose job writes no text keeps its path');
  assert.equal(railTextJob('Nobody · Nowhere', null), null);
  assert.ok(resolveRail(page.pageKey));
});

test('2. the router: every rail text press resolves through textChoice; only an option carries a pick; a page list never chooses', () => {
  const r = src('services/aiRouter.ts');
  assert.match(r, /const textJobId = opts\.textJob \?\? \(railText \? railJob : \(!opts\.model \? TASK_TEXT_JOBS\[opts\.task\] : undefined\)\);/, 'an unlisted page runs the task\'s job');
  assert.match(r, /const optionRow = railText\?\.optionRow \?\? null;/, 'the pick is the option\'s alone');
  assert.match(r, /resolveRailOption\(opts\.rail\.page, opts\.rail\.option \?\? null\) \?\? \(opts\.model \|\| pageJobless \? resolveRail\(opts\.rail\.page\) : null\)/,
    'the page\'s list is read only to check a named model, or on a page whose job writes no text');
  assert.doesNotMatch(r, /pageRowed/, 'the page-row gate is gone');
});

test('3. the routes: a pick needs a registered option; the read no longer falls back to a page pick', () => {
  const ai = src('routes/ai.ts');
  assert.match(ai, /code: 'option_required'/);
  assert.match(ai, /const pick = option && optionRow \? pickFor\(option, active\) : null;/);
  assert.doesNotMatch(ai, /pickFor\('page', row\)/);
  assert.doesNotMatch(ai, /const task = option \?\? 'page';/);
});
