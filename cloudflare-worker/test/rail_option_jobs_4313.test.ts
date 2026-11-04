/**
 * #4313 (D4313, AI model use cases task 3b): rail presses run their option's job.
 *
 *   · every option `railMatrix.json` registers has a row in RAIL_OPTION_JOBS (the
 *     issue's test: a new option with no job is red here), naming a job the plan has;
 *   · an option whose press writes text maps to a job with a text step;
 *   · an option lists its own job's models, Default first, so the rail offers what
 *     `textChoice` runs and nothing it would pass over;
 *   · the options whose model moves are named, both ends, in OPTION_MODEL_MOVES, and
 *     each move lands on a model a route already runs;
 *   · through run(): a press runs its option's job, not its page's row; the member's
 *     pick for the option is honoured when the job lists it; a named job still wins;
 *   · every routed text job belongs to the recorded model plan.
 *
 * Synthetic records only; Workers AI is a stub.
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/rail_option_jobs_4313.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest, run } from '../src/services/aiRouter.ts';
import {
  AWAITING_SPEND_APPROVAL, OPTION_MODEL_MOVES, RAIL_OPTION_JOBS, RAIL_OPTION_PAGE_JOBS, TASK_TEXT_JOBS,
  railOptionJob, railOptionTextJob, textJob,
} from '../src/services/ai/textJobs.ts';
import { FORM_TEXT_JOBS } from '../src/services/fills/fields.ts';
import { JOBS, RAIL_KIND_JOBS, jobChoices, jobStep } from '../src/services/ai/modelUseCases.ts';
import { railOptionRows } from '../src/services/ai/railMatrix.ts';

const GLM = '@cf/zai-org/glm-4.7-flash';
const LLAMA70 = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
/** The kinds whose presses write text; transcription, image, upload and no-model options keep their own path. */
const writesText = (o: { kind: string; handler: string }) => !['speech', 'image', 'live', 'vision'].includes(o.kind) && !['upload', 'none', 'transcribe'].includes(o.handler)
  && !(o.kind === 'search' && o.handler !== 'draft'); // a re-index runs the index, not a writer
test('every registered rail option has a job the plan has; a text press has a text job', () => {
  const rows = railOptionRows();
  assert.ok(rows.length > 100, 'the matrix\'s options');
  for (const o of rows) {
    const job = railOptionJob(o.pageKey, o.optionKey);
    assert.ok(job, `${o.optionKey} (${o.pageKey}) has no job in RAIL_OPTION_JOBS`);
    assert.ok(jobStep(job!, 0), `${o.optionKey}: ${job} is not a job of the plan`);
    if (writesText(o)) assert.ok(railOptionTextJob(o.pageKey, o.optionKey), `${o.optionKey} writes text, but ${job} has no text step`);
  }
  // No stale row: every key the table names is a registered option.
  const registered = new Set(rows.map((o) => o.optionKey));
  for (const k of [...Object.keys(RAIL_OPTION_JOBS), ...Object.keys(RAIL_OPTION_PAGE_JOBS)]) assert.ok(registered.has(k), `${k} is not a registered option`);
  // The one option two pages use for different work answers per page.
  assert.equal(railOptionJob('Operating Partner · Pipeline · Retainers', 'draft:renewal-risk'), 'GR16');
  assert.equal(railOptionJob('Operating Partner · Delivery · Health', 'draft:renewal-risk'), 'IN13');
  assert.equal(railOptionJob('Founder · Studio', 'no:such-option'), null);
});

test('an option lists its own job\'s models, Default first, so the rail offers what textChoice runs', () => {
  for (const o of railOptionRows()) {
    const id = railOptionTextJob(o.pageKey, o.optionKey);
    if (!id || o.handler === 'none') continue; // a no-model chip (D1596) lists nothing
    const job = textJob(id)!;
    assert.equal(o.models[0]?.id, job.default, `${o.optionKey}: lists ${id}'s Default first`);
    const listed = new Set([...o.models, ...(o.more ?? [])].map((m) => m.id));
    // jobChoices is what textChoice accepts as a pick: the job's own models and its kind's (#3741's All models).
    const accepted = new Set(jobChoices(job));
    for (const m of listed) assert.ok(accepted.has(m), `${o.optionKey}: ${m} is listed but ${id} would pass over it`);
  }
});

test('the moves are named, both ends, and land on models a route already runs', () => {
  // Mutation checked: an option whose job's Default differs from its kind's list, left out of OPTION_MODEL_MOVES.
  const moved: Record<string, { from: string; to: string }> = {};
  for (const o of railOptionRows()) {
    const id = railOptionTextJob(o.pageKey, o.optionKey);
    const ref = RAIL_KIND_JOBS[o.kind];
    const was = ref ? jobStep(ref.id, ref.step)?.default : undefined;
    if (!id || !was || o.handler === 'none') continue;
    const to = textJob(id)!.default;
    if (to !== was) moved[o.optionKey] = { from: was, to };
  }
  assert.deepEqual(moved, { ...OPTION_MODEL_MOVES });
  const router = readFileSync(new URL('../src/services/aiRouter.ts', import.meta.url), 'utf8');
  for (const [k, { to }] of Object.entries(OPTION_MODEL_MOVES)) {
    assert.ok(router.includes(`'${to}'`) || to === LLAMA70, `${k}: ${to} already runs on a route`);
    assert.ok(!AWAITING_SPEND_APPROVAL.has(to), `${k}: ${to} waits on a spend approval`);
  }
});

function world(fail: string[] = []) {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.prepare('INSERT OR IGNORE INTO ai_topup_accounts(user_id, balance_microusd) VALUES (?, ?)').run(4, 5_000_000);
  const calls: string[] = [];
  const AI: any = withGuard({
    run: async (model: string) => {
      calls.push(model);
      if (fail.includes(model)) throw new Error(`${model} 503`);
      return { response: 'Done.', usage: { prompt_tokens: 50, completion_tokens: 10 } };
    },
  });
  return { f, env: { DB: f.DB, ENVIRONMENT: 'development', AI } as any, ran: () => calls.filter((m) => !/llama-guard/.test(m)) };
}
const go = (env: any, rail: any, extra: any = {}) => run(env, { task: 'rail_write', userId: 4, rail, messages: [{ role: 'user', content: 'Go.' }], ...extra });

test('through run(): a press runs its option\'s job, not its page\'s row, and moves down that job\'s ladder', async () => {
  // Mutation checked: the option job dropped from the router (the retro runs its kind's 70B, not BU2's glm).
  const retro = { page: 'Founder · Build · Operating systems', option: 'draft:build/retro', record: null };
  const w = world([GLM]);
  try {
    const r: any = await go(w.env, retro);
    assert.equal(r.ok, true, JSON.stringify(r));
    const bu2 = textJob('BU2')!;
    assert.deepEqual(w.ran().slice(0, 2), [GLM, bu2.alternative], 'BU2\'s Default, then its Alternative');
    assert.equal(r.text?.job ?? 'BU2', 'BU2');
  } finally { w.f.db.close(); }
});

test('through run(): a press too long for every model its job runs is refused before anything runs, naming the longest one', async () => {
  // Mutation checked: the option job dropped from the router (the page row runs the 70B on an input no model can hold).
  const retro = { page: 'Founder · Build · Operating systems', option: 'draft:build/retro', record: null };
  const w = world();
  try {
    const huge = 'word '.repeat(700_000);
    const r: any = await go(w.env, retro, { messages: [{ role: 'user', content: huge }] });
    assert.equal(r.ok, false);
    assert.equal(r.refusal, 'invalid_input', JSON.stringify(r).slice(0, 200));
    assert.match(String(r.error), /too long/);
    assert.deepEqual(w.ran(), [], 'nothing ran, nothing was charged');
  } finally { w.f.db.close(); }
});

test('through run(): the member\'s pick for the option is honoured when the job lists it, a stale one reads as none; a named job still wins', async () => {
  const retro = { page: 'Founder · Build · Operating systems', option: 'draft:build/retro', record: null };
  const bu2 = textJob('BU2')!;
  const listedOther = [bu2.alternative, bu2.deeper, ...bu2.more].find((m) => m && m !== bu2.default)!;
  assert.ok(listedOther, 'BU2 lists another model');
  const pick = (model: string) => {
    const w = world();
    w.f.db.exec("CREATE TABLE IF NOT EXISTS ai_rail_preferences (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, user_id INTEGER, section TEXT, task TEXT, model TEXT, mode TEXT)");
    w.f.db.prepare('INSERT INTO ai_rail_preferences (uid, user_id, section, task, model) VALUES (?, 4, ?, ?, ?)').run('p-1', 'founder · build · operating systems', 'draft:build/retro', model);
    return w;
  };
  const honoured = pick(listedOther);
  try {
    const r: any = await go(honoured.env, retro);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(honoured.ran()[0], listedOther, 'the option\'s pick, a model BU2 lists');
  } finally { honoured.f.db.close(); }
  const stale = pick('@cf/moonshotai/kimi-k2.6');
  try {
    const r: any = await go(stale.env, retro);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(stale.ran()[0], bu2.default, 'a pick the job does not list reads as none');
  } finally { stale.f.db.close(); }
  const named = world();
  try {
    const r: any = await go(named.env, retro, { textJob: 'ST2' });
    assert.equal(r.ok, true);
    assert.equal(named.ran()[0], LLAMA70, 'a job the caller names wins over the option\'s');
  } finally { named.f.db.close(); }
});

test('every routed text job belongs to the recorded model plan', () => {
  const optionJobs = new Set<string>();
  for (const o of railOptionRows()) { const id = railOptionTextJob(o.pageKey, o.optionKey); if (id) optionJobs.add(id); }
  const routed = new Set([...Object.values(TASK_TEXT_JOBS), ...Object.values(FORM_TEXT_JOBS), ...optionJobs]);
  const planned = new Set(JOBS.map((job) => job.id));
  assert.deepEqual([...routed].filter((job) => !planned.has(job)), [], 'routed jobs need a recorded plan entry');
});
