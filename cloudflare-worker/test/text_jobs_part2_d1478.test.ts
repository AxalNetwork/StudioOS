/**
 * #3937 (D1478 task 3, part 2): the text jobs on #3934's table, fix 7, and
 * toMarkdown through a metered call.
 *
 *  · `textChoice` walks Default, Alternative, Deeper and fallback, skipping a
 *    model that is not offered, that the plan locks, or whose window cannot hold
 *    the input; the receipt names each one passed over and why;
 *  · done-when: no text job runs a 24K or 32K model on a long input;
 *  · a too-long input is refused before anything is held, naming the model that
 *    reads the most; a named model the job does not list is refused;
 *  · the tasks `TASK_TEXT_JOBS` maps keep their route's first model, and no
 *    model a mapped job or form can reach is new to the router (no new spend);
 *  · fix 7: Prototype's must-have fill runs BU4 (glm-4.7-flash), never the
 *    page's Code row;
 *  · `convertToMarkdown`: one usage row at no charge for a document; an image,
 *    and a paused member, are refused before any call.
 * Synthetic records only; Workers AI is a stub.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/text_jobs_part2_d1478.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { ROUTE, __resetForTest, convertToMarkdown, quoteRun, run, IMAGE_CONVERSION_REFUSED } from '../src/services/aiRouter.ts';
import { AWAITING_SPEND_APPROVAL, TASK_MODEL_MOVES, TASK_TEXT_JOBS, TEXT_KINDS, textChoice, textJob } from '../src/services/ai/textJobs.ts';
import { JOBS } from '../src/services/ai/modelUseCases.ts';
import { modelById } from '../src/services/ai/catalogue.ts';
import { FORM_TEXT_JOBS } from '../src/services/fills/fields.ts';

const ON = { AI_PARTNER_MODELS: 'on' } as any;
const LLAMA70 = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const GLM_FLASH = '@cf/zai-org/glm-4.7-flash';
const short = { switches: ON, tier: 'free' as const, inputTokens: 1_000, outputTokens: 500 };
// Longer than any 24K or 32K window holds, with its output allowance.
const long = { ...short, inputTokens: 33_000 };

test('the ladder: Default first; a locked or unoffered model is passed over and the receipt says why', () => {
  assert.deepEqual(textChoice('BU4', short), { ok: true, model: GLM_FLASH, chain: ['@cf/openai/gpt-oss-20b'], source: 'default', job: 'BU4', skipped: [] });
  // IN5's Alternative (deepseek v4 pro) is on paid plans: a system run (free) never reaches it.
  const in5 = textChoice('IN5', short);
  assert.ok(in5.ok && !in5.chain.includes('@cf/deepseek-ai/deepseek-v4-pro-0813'));
  // A named model the job lists runs first; one it does not list is refused, never swapped.
  assert.equal((textChoice('BU4', { ...short, caller: '@cf/openai/gpt-oss-20b' }) as any).model, '@cf/openai/gpt-oss-20b');
  const kimi = textChoice('BU4', { ...short, caller: '@cf/moonshotai/kimi-k2.7-code' });
  assert.deepEqual([kimi.ok, !kimi.ok && kimi.code], [false, 'model_not_offered'], 'Plan never lists the code model');
  const locked = textChoice('IN5', { ...short, caller: '@cf/deepseek-ai/deepseek-v4-pro-0813' });
  assert.deepEqual([locked.ok, !locked.ok && locked.code], [false, 'plan_locked']);
  assert.deepEqual(textChoice('DK4', short), { ok: false, code: 'press_hidden', job: 'DK4', message: 'This press has no text job.' }, 'a draw job is not a text job');
});

test('done when: no text job runs a 24K or 32K model on a long input; the receipt says the Default was too long', () => {
  const offenders: string[] = [];
  for (const j of JOBS.filter((x) => TEXT_KINDS.has(x.kind))) {
    const c = textChoice(j.id, long);
    if (!c.ok) continue;
    const w = modelById(c.model)?.context_window;
    if (w != null && w <= 32_768) offenders.push(`${j.id} ${c.model} ${w}`);
  }
  assert.deepEqual(offenders, []);
  const va5 = textChoice('VA5', { ...short, inputTokens: 40_000, outputTokens: 1_000 });
  assert.ok(va5.ok);
  assert.notEqual(va5.ok && va5.model, LLAMA70);
  assert.deepEqual(va5.ok && va5.skipped, [{ model: LLAMA70, reason: 'too_long' }]);
});

test('too long for every model: refused before any hold, naming the one that reads the most', async () => {
  const c = textChoice('MI1', { ...short, inputTokens: 400_000 });
  assert.deepEqual([c.ok, !c.ok && c.code, !c.ok && (c as any).longest], [false, 'input_too_long', '@cf/ibm-granite/granite-4.0-h-micro']);
  assert.match((c as any).message, /granite-4\.0-h-micro reads the most/);
  __resetForTest();
  const q = await quoteRun({ AI: {} } as any, { task: 'paraphrase', userId: 0, messages: [{ role: 'user', content: 'x '.repeat(900_000) }] });
  assert.equal(q.ok, false);
  assert.equal((q as any).refusal, 'invalid_input');
  assert.match((q as any).error, /reads the most/);
});

test('mapped tasks keep their route\'s first model unless TASK_MODEL_MOVES names the move; no model a mapped job or form can reach is new to the router', () => {
  // #3937 part 3: a mapped task whose job's Default is another model is named in TASK_MODEL_MOVES, both ends stated.
  for (const [task, job] of Object.entries(TASK_TEXT_JOBS)) {
    const move = TASK_MODEL_MOVES[task];
    if (move) assert.deepEqual([move.from, move.to], [(ROUTE as any)[task].model, textJob(job)!.default], `${task} → ${job}: the move as stated`);
    else assert.equal(textJob(job)!.default, (ROUTE as any)[task].model, `${task} → ${job}`);
  }
  for (const task of Object.keys(TASK_MODEL_MOVES)) assert.ok(TASK_TEXT_JOBS[task], `${task}: a move names a mapped task`);
  const router = readFileSync(new URL('../src/services/aiRouter.ts', import.meta.url), 'utf8');
  const matrix = readFileSync(new URL('../src/services/ai/railMatrix.json', import.meta.url), 'utf8');
  const constants: Record<string, string> = { SMALL_LLAMA: '@cf/meta/llama-3.1-8b-instruct-fp8', MID_LLAMA: LLAMA70 };
  const wired = (id: string) => router.includes(`'${id}'`) || matrix.includes(`"${id}"`) || Object.values(constants).includes(id);
  const reach = new Set<string>();
  for (const job of [...Object.values(TASK_TEXT_JOBS), ...Object.values(FORM_TEXT_JOBS)]) {
    for (const tier of ['free', 'paid'] as const) {
      const c = textChoice(job, { ...short, tier });
      if (c.ok) [c.model, ...c.chain].forEach((m) => reach.add(m));
    }
  }
  assert.deepEqual([...reach].filter((m) => !wired(m)), [], 'every model a job reaches already runs somewhere');
  // The held list is exactly the ladder models of these jobs that nothing runs yet.
  const listed = new Set<string>();
  for (const job of [...Object.values(TASK_TEXT_JOBS), ...Object.values(FORM_TEXT_JOBS)]) {
    const j = textJob(job)!;
    [j.default, j.alternative, j.deeper, j.fallback].forEach((m) => m && listed.add(m));
  }
  assert.deepEqual([...listed].filter((m) => !wired(m) && modelById(m)?.status !== 'beta').sort(), [...AWAITING_SPEND_APPROVAL].sort());
});

function world(reply = 'Proposed.') {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.prepare('INSERT OR IGNORE INTO ai_topup_accounts(user_id, balance_microusd) VALUES (?, ?)').run(4, 5_000_000);
  const calls: string[] = [];
  const AI: any = withGuard({ run: async (model: string) => { calls.push(model); return { response: reply, usage: { prompt_tokens: 50, completion_tokens: 10 } }; } });
  return { f, env: { DB: f.DB, ENVIRONMENT: 'development', AI } as any, calls };
}

test('fix 7: Prototype\'s must-have fill runs BU4 (glm-4.7-flash), never the page\'s Code row', async () => {
  assert.equal(FORM_TEXT_JOBS['must-have'], 'BU4');
  assert.equal(FORM_TEXT_JOBS.feature, 'BU4');
  const w = world();
  try {
    const r = await run(w.env, { task: 'rail_write', userId: 4, textJob: FORM_TEXT_JOBS['must-have'], messages: [{ role: 'user', content: 'Fill the must-have.' }],
      rail: { page: 'Founder · Build · Prototype / MVP', option: 'form:must-have', record: null } });
    assert.equal(r.ok, true, JSON.stringify(r));
    const ran = w.calls.filter((m) => !/llama-guard/.test(m));
    assert.deepEqual(ran, [GLM_FLASH]);
    assert.ok(!ran.some((m) => /kimi|coder/.test(m)));
  } finally { w.f.db.close(); }
  const railRun = readFileSync(new URL('../src/routes/rail_run.ts', import.meta.url), 'utf8');
  assert.match(railRun, /FORM_TEXT_JOBS\[form\] \? \{ textJob: FORM_TEXT_JOBS\[form\] \}/);
});

test('convertToMarkdown: a document is one row at no charge; an image and a paused member are refused before any call', async () => {
  const w = world();
  try {
    const seen: unknown[] = [];
    w.env.AI.toMarkdown = async (docs: unknown) => { seen.push(docs); return [{ name: 'terms.pdf', data: '# Terms\nOne', tokens: 0 }]; };
    const ok = await convertToMarkdown(w.env, { userId: 4, surface: '/raise/cap-table' }, [{ name: 'terms.pdf', blob: new Blob(['%PDF'], { type: 'application/pdf' }) }]);
    assert.deepEqual(ok, { ok: true, documents: [{ name: 'terms.pdf', data: '# Terms\nOne', tokens: 0 }] });
    const rows = w.f.db.prepare("SELECT task, model, surface, user_id, charged_microusd, units_json, est_cost_usd FROM ai_usage_logs WHERE task = 'document_convert'").all() as any[];
    assert.deepEqual(rows.map((r) => [r.task, r.model, r.surface, r.user_id, r.charged_microusd, r.est_cost_usd]), [['document_convert', 'toMarkdown', '/raise/cap-table', 4, 0, 0]]);
    assert.deepEqual(JSON.parse(rows[0].units_json), { documents: 1, bytes: 4 });
    const img = await convertToMarkdown(w.env, { userId: 4 }, [{ name: 'logo.png', blob: new Blob(['x'], { type: 'image/png' }) }]);
    assert.deepEqual(img, { ok: false, refusal: 'model_unpriced', error: IMAGE_CONVERSION_REFUSED });
    w.f.db.exec("CREATE TABLE IF NOT EXISTS member_ai_pauses (user_id INTEGER PRIMARY KEY, reason TEXT NOT NULL, paused_by INTEGER NOT NULL, paused_at TEXT NOT NULL DEFAULT (datetime('now')))");
    w.f.db.prepare('INSERT INTO member_ai_pauses (user_id, reason, paused_by) VALUES (?, ?, ?)').run(4, 'Synthetic pause for this test.', 5);
    const paused = await convertToMarkdown(w.env, { userId: 4 }, [{ name: 'terms.pdf', blob: new Blob(['%PDF'], { type: 'application/pdf' }) }]);
    assert.equal((paused as any).refusal, 'ai_paused');
    assert.equal(seen.length, 1, 'only the first document reached toMarkdown');
  } finally { w.f.db.close(); }
});

test('no toMarkdown call outside the router\'s metered conversion', () => {
  for (const f of ['../src/services/deckExtract.ts', '../src/services/capTableDocumentRead.ts']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(src, /\.toMarkdown\(/, f);
    assert.match(src, /convertToMarkdown\(env,/, f);
  }
});
