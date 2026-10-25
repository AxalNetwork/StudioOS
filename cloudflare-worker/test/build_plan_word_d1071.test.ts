/**
 * D1071 (#2941, part 8 of #2426): "Word with Eadwyn" — the `draft:build/plan`
 * run, its wording row, Keep wording through D1066's Save, and the run named
 * in `fill_provenance` on Accept.
 *
 * The database is the baseline plus every numbered migration above the
 * cutoff, schema only, as D1066's suite builds it. The real AI router runs
 * with a stubbed model. Every venture, person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_plan_word_d1071.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import planRoutes from '../src/routes/build_plan.ts';
import { preparePlan, readPlan } from '../src/services/buildPlanner.ts';
import { WORD_OPTION, WORD_PAGE, screenWording, wordMaterial } from '../src/services/buildPlanWord.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';

const SECRET = 'build-word-test-secret-0123456789-abcdef'; // synthetic test fixture
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

const FOUNDER = 1, OTHER = 2, ADMIN = 3;

/** The model's answer, by the refs the prompt sent: the feature is i-something, found by its title. */
type Answer = (prompt: string) => unknown;
const refOf = (prompt: string, title: string) => prompt.match(new RegExp(`(i\\d+) · [^\\n]* · rule's title: ${title}\\n`))?.[1];
const GOOD: Answer = (p) => ({
  items: [
    { ref: refOf(p, 'Slow setup'), title: 'Set up in a single sitting', description: 'A guided setup that a new team finishes without help.' },
    { ref: refOf(p, 'Test the price objection'), title: 'Find out whether price stops a pilot', description: 'ignored: a risk takes no description' },
    { ref: 'i99', title: 'An item Eadwyn invented' },
  ],
  brief: { summary: 'A setup tool for small teams who lose weeks getting started.' },
  lovable_prompt: 'Build a clickable prototype of a guided setup for a small team.',
});

async function fixture({ answer = GOOD, balance = 5000000 }: { answer?: Answer; balance?: number } = {}) {
  __resetForTest();
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,spinout_lab_active,is_active) VALUES
    (1,'one@example.test','Founder One','founder',100,0,1),(2,'two@example.test','Founder Two','founder',200,0,1),(3,'admin@example.test','Admin','admin',NULL,0,1);
    INSERT INTO projects(id,name,founder_id,company_id) VALUES(1,'One',100,10),(2,'Two',200,20);
    INSERT INTO pain_groups(id,project_id,title) VALUES(1,1,'Slow setup');
    INSERT INTO pain_group_aliases(project_id,group_id,phrase_norm,display_phrase) VALUES(1,1,'slow setup','Slow setup');
    INSERT INTO hypotheses(id,project_id,code,claim) VALUES(1,1,'H1','Setup in one day'),(2,1,'H2','Self service works');
    INSERT INTO hypothesis_pain_links(id,hypothesis_id,pain_group_id,direction) VALUES(1,1,1,'supports');
    INSERT INTO validation_decisions(id,project_id,decision,state,reasoning) VALUES(1,1,'proceed','given','Private reasoning');
    INSERT INTO validation_decision_evidence(uid,decision_id,kind,ref_id,label,direction) VALUES('de1',1,'interview','pain-1-1','Snapshot','supports');
    INSERT INTO validation_decision_commitments(id,uid,decision_id,project_id,text,owner_user_id,due_date) VALUES(1,'c1',1,1,'Test the pilot',1,'2027-12-31');
    INSERT INTO demand_signals(id,project_id,kind,status,signal_date) VALUES(1,1,'would_pay','confirmed','2026-10-01');`);
  for (let id = 1; id <= 3; id++) {
    db.prepare('INSERT INTO discovery_interviews(id,project_id,interviewee_name,pains_json) VALUES(?,1,?,?)').run(id, 'Wren Example', '["Slow setup"]');
    db.prepare("INSERT INTO interview_pain_severities(interview_id,phrase_norm,severity) VALUES(?,'slow setup','severe')").run(id);
    db.prepare("INSERT INTO interview_findings(uid,project_id,interview_id,module,kind,key_norm,payload_json) VALUES(?,1,?,'demand-signals','objection','price',?)").run('f' + id, id, '{"about":"price"}');
  }
  if (balance) db.exec(`INSERT INTO ai_topup_accounts(user_id, balance_microusd) VALUES (1, ${balance})`);
  const prompts: string[] = [];
  const env = {
    DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development',
    AI: withGuard({ run: async (_model: string, input: any) => {
      const content = String(input?.messages?.at?.(-1)?.content ?? '');
      prompts.push(JSON.stringify(input?.messages ?? input));
      const out = answer(content);
      return { response: typeof out === 'string' ? out : JSON.stringify(out), usage: { prompt_tokens: 40, completion_tokens: 30 } };
    } }),
  } as any;
  return { db, env, prompts };
}

const app = new Hono<any>();
app.route('/api/cycles/build/plan', planRoutes);
const PRESS = { 'X-Rail-Option': encodeURIComponent(WORD_OPTION), 'X-Rail-Page': encodeURIComponent(WORD_PAGE) };

async function call(env: any, user: number | null, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  if (user) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const r = await app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    const raw = await r.text();
    return { status: r.status, body: raw ? JSON.parse(raw) : null };
  } finally { [console.warn, console.error] = saved; }
}
const word = (env: any, who = FOUNDER, extra = PRESS) => call(env, who, 'POST', '/api/cycles/build/plan/word?project=1&scope=venture', {}, extra);
const item = (db: DatabaseSync, kind: string) => db.prepare(`SELECT i.*, q.status, q.payload_json, q.decided_payload_json FROM build_plan_items i
  JOIN ai_rail_proposals q ON q.uid = i.proposal_uid WHERE i.kind = ? ORDER BY i.item_key LIMIT 1`).get(kind) as any;
const count = (db: DatabaseSync, sql: string, ...args: any[]) => Number((db.prepare(sql).get(...args) as any).n);
const planUid = (db: DatabaseSync) => (db.prepare('SELECT uid FROM build_plans WHERE project_id = 1').get() as any).uid as string;

test('a press runs once under draft:build/plan, metered, and stores one wording row on the plan; nothing else is written', async () => {
  const { db, env, prompts } = await fixture();
  try {
    await preparePlan(env, 1, FOUNDER);
    const before = {
      proposals: db.prepare("SELECT uid, status, payload_json, decided_payload_json FROM ai_rail_proposals WHERE kind = 'proposal' ORDER BY id").all(),
      features: count(db, 'SELECT COUNT(*) n FROM mvp_features'), provenance: count(db, 'SELECT COUNT(*) n FROM fill_provenance'),
    };
    const r = await word(env);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const f = item(db, 'feature');
    const risk = item(db, 'risk');
    assert.deepEqual(r.body.wording.items[f.uid], { title: 'Set up in a single sitting', description: 'A guided setup that a new team finishes without help.' });
    assert.deepEqual(r.body.wording.items[risk.uid], { title: 'Find out whether price stops a pilot' }, 'a risk is worded on its title only');
    assert.equal(Object.keys(r.body.wording.items).length, 2, 'an invented ref is dropped: Eadwyn never adds an item');
    assert.equal(r.body.wording.brief.summary, 'A setup tool for small teams who lose weeks getting started.');
    assert.equal(r.body.wording.lovable_prompt, 'Build a clickable prototype of a guided setup for a small team.');
    // One wording row, on the plan, naming its run.
    const rows: any[] = db.prepare("SELECT * FROM ai_rail_proposals WHERE kind = 'draft'").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].record_ref, `build_plan:${planUid(db)}`);
    assert.equal(rows[0].rail_option, WORD_OPTION);
    assert.equal(rows[0].status, 'proposed');
    assert.equal(rows[0].user_id, FOUNDER);
    const usage: any[] = db.prepare('SELECT id, task, rail_option, surface FROM ai_usage_logs WHERE rail_option = ?').all(WORD_OPTION);
    assert.ok(usage.length >= 1, 'metered under its own option');
    const answered = usage.find((u) => u.id === rows[0].usage_log_id);
    assert.ok(answered, 'the row names its run');
    assert.deepEqual([answered.task, answered.surface], ['rail_write', '/build/plan']);
    // Nothing else: the items' proposals, Build and provenance are as they were.
    assert.deepEqual(db.prepare("SELECT uid, status, payload_json, decided_payload_json FROM ai_rail_proposals WHERE kind = 'proposal' ORDER BY id").all(), before.proposals);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM mvp_features'), before.features);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM fill_provenance'), before.provenance);
    // Labels and counts only: no name, quote, reasoning, decision label or date reaches the model.
    const prompt = prompts.find((p) => p.includes('Word this build plan'))!;
    assert.ok(prompt);
    assert.match(prompt, /rule's title: Slow setup/);
    assert.match(prompt, /1 pain group: Slow setup/);
    assert.match(prompt, /3 finding: price objection/);
    assert.match(prompt, /1 decision(?!:)/, 'a decision is counted, never worded');
    for (const never of ['Wren Example', 'Private reasoning', 'Snapshot', 'Recorded Proceed', '2027-12-31', 'example.test']) {
      assert.ok(!prompt.includes(never), `${never} reached the model`);
    }
    // The GET reads it back, as not saved.
    const g = await call(env, FOUNDER, 'GET', '/api/cycles/build/plan/word?project=1&scope=venture');
    assert.equal(g.body.wording.uid, rows[0].uid);
    // A second press replaces the pending wording; it does not stack.
    await word(env);
    assert.deepEqual(db.prepare("SELECT status FROM ai_rail_proposals WHERE kind = 'draft' ORDER BY id").all().map((x: any) => x.status), ['withdrawn', 'proposed']);
  } finally { db.close(); }
});

test('Keep wording is the item\'s Save; Accept lands the worded title and names the run in fill_provenance', async () => {
  const { db, env } = await fixture();
  try {
    await preparePlan(env, 1, FOUNDER);
    const w = (await word(env)).body.wording;
    const f = item(db, 'feature');
    const row: any = db.prepare("SELECT id, uid, usage_log_id FROM ai_rail_proposals WHERE kind = 'draft'").get();
    const keep = await call(env, FOUNDER, 'PATCH', `/api/cycles/build/plan/items/${f.uid}`, { wording: w.uid });
    assert.equal(keep.status, 200, JSON.stringify(keep.body));
    assert.equal(keep.body.status, 'proposed', 'kept wording is saved, not accepted');
    assert.equal(keep.body.payload.title, 'Set up in a single sitting');
    assert.equal(keep.body.payload.description, 'A guided setup that a new team finishes without help.');
    assert.deepEqual(keep.body.payload.wording, { uid: row.uid, usage_log_id: row.usage_log_id });
    assert.equal(count(db, 'SELECT COUNT(*) n FROM mvp_features'), 0, 'Save writes no Build row');
    // The wording row records the keep, and the page no longer offers it.
    assert.equal((db.prepare('SELECT status FROM ai_rail_proposals WHERE id = ?').get(row.id) as any).status, 'accepted');
    const after = (await call(env, FOUNDER, 'GET', '/api/cycles/build/plan/word?project=1&scope=venture')).body.wording;
    assert.equal(after.items[f.uid], undefined);
    // Accept lands it.
    const a = await call(env, FOUNDER, 'POST', `/api/cycles/build/plan/items/${f.uid}/accept`, {});
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.status, 'edited');
    const feature: any = db.prepare('SELECT title, description FROM mvp_features WHERE id = ?').get(Number(a.body.landed_id));
    assert.deepEqual({ ...feature }, { title: 'Set up in a single sitting', description: 'A guided setup that a new team finishes without help.' });
    const prov: any[] = db.prepare('SELECT target_column, ai_usage_log_id, citation_json, proposed_value, written_value, edited FROM fill_provenance WHERE target_table = ? ORDER BY id').all('mvp_features');
    const title = prov.find((p) => p.target_column === 'title');
    assert.equal(title.ai_usage_log_id, row.usage_log_id, 'the kept wording names its run');
    assert.deepEqual(JSON.parse(title.citation_json).wording, { proposal_uid: row.uid, usage_log_id: row.usage_log_id });
    assert.deepEqual([title.proposed_value, title.written_value, title.edited], ['Slow setup', 'Set up in a single sitting', 1]);
    assert.equal(prov.find((p) => p.target_column === 'description').ai_usage_log_id, row.usage_log_id);
    const value = prov.find((p) => p.target_column === 'added_value');
    assert.equal(value.ai_usage_log_id, null, 'a field Eadwyn did not word names no run');
    assert.equal(JSON.parse(value.citation_json).wording, undefined);
  } finally { db.close(); }
});

test('the founder\'s own words over a kept wording make them the founder\'s: no run is named', async () => {
  const { db, env } = await fixture();
  try {
    await preparePlan(env, 1, FOUNDER);
    const w = (await word(env)).body.wording;
    const f = item(db, 'feature');
    await call(env, FOUNDER, 'PATCH', `/api/cycles/build/plan/items/${f.uid}`, { wording: w.uid });
    const typed = await call(env, FOUNDER, 'PATCH', `/api/cycles/build/plan/items/${f.uid}`, { payload: { title: 'Setup the founder typed' } });
    assert.equal(typed.status, 200);
    assert.equal(typed.body.payload.wording, undefined);
    const a = await call(env, FOUNDER, 'POST', `/api/cycles/build/plan/items/${f.uid}/accept`, {});
    assert.equal(a.status, 200);
    const prov: any[] = db.prepare('SELECT ai_usage_log_id FROM fill_provenance WHERE target_table = ?').all('mvp_features');
    assert.ok(prov.every((p) => p.ai_usage_log_id == null));
  } finally { db.close(); }
});

test('discard and keep on the wording row: an item is discarded here and kept only by its Save; the brief and the prompt are kept here', async () => {
  const { db, env } = await fixture();
  try {
    await preparePlan(env, 1, FOUNDER);
    const w = (await word(env)).body.wording;
    const risk = item(db, 'risk');
    const base = `/api/cycles/build/plan/word/${w.uid}`;
    const q = '?project=1&scope=venture';
    const refused = await call(env, FOUNDER, 'POST', `${base}/keep${q}`, { target: risk.uid });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, 'invalid_edit');
    const d = await call(env, FOUNDER, 'POST', `${base}/discard${q}`, { target: risk.uid });
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.equal(d.body.wording.items[risk.uid], undefined);
    assert.equal(JSON.parse(item(db, 'risk').payload_json).title, 'Test the price objection', 'discard leaves the rule\'s title');
    assert.equal(item(db, 'risk').decided_payload_json, null);
    const k = await call(env, FOUNDER, 'POST', `${base}/keep${q}`, { target: 'brief' });
    assert.equal(k.status, 200);
    assert.equal(k.body.wording.brief, null, 'no longer offered');
    assert.equal(k.body.wording.kept.brief.summary, 'A setup tool for small teams who lose weeks getting started.');
    const p = await call(env, FOUNDER, 'POST', `${base}/discard${q}`, { target: 'prompt' });
    assert.equal(p.body.wording.lovable_prompt, null);
    assert.equal(p.body.wording.kept.prompt, null);
    assert.equal((await call(env, FOUNDER, 'POST', `${base}/keep${q}`, { target: 'everything' })).status, 400);
    // A wording uid that is not on this plan, or not the founder's, is refused.
    const f = item(db, 'feature');
    const stranger = await call(env, FOUNDER, 'PATCH', `/api/cycles/build/plan/items/${f.uid}`, { wording: '00000000-0000-4000-8000-000000000000' });
    assert.equal(stranger.status, 400);
    assert.equal(stranger.body.code, 'invalid_edit');
    assert.equal((await call(env, OTHER, 'POST', `${base}/discard${q}`, { target: 'brief' })).status, 404);
    assert.equal((await call(env, OTHER, 'PATCH', `/api/cycles/build/plan/items/${f.uid}`, { wording: w.uid })).status, 404);
  } finally { db.close(); }
});

test('refusals: Manual mode is 403 assist_off and an empty purse 402, each with no run; no plan is 409; an admin or another founder is refused', async () => {
  let f = await fixture();
  try {
    await preparePlan(f.env, 1, FOUNDER);
    f.db.prepare("INSERT INTO ai_rail_preferences (uid, user_id, section, task, mode) VALUES ('pref-1', 1, ?, '', 'manual')").run(WORD_PAGE.toLowerCase());
    const r = await word(f.env);
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'assist_off');
    assert.equal(f.prompts.length, 0, 'Manual mode runs nothing');
    assert.equal(count(f.db, "SELECT COUNT(*) n FROM ai_rail_proposals WHERE kind = 'draft'"), 0);
  } finally { f.db.close(); }
  f = await fixture({ balance: 0 });
  try {
    await preparePlan(f.env, 1, FOUNDER);
    assert.equal((await word(f.env)).status, 402);
    assert.equal(f.prompts.length, 0, 'nothing is run, nothing charged');
  } finally { f.db.close(); }
  f = await fixture();
  try {
    const none = await word(f.env);
    assert.equal(none.status, 409);
    assert.equal(none.body.code, 'no_plan');
    await preparePlan(f.env, 1, FOUNDER);
    assert.equal((await word(f.env, ADMIN)).status, 404, 'an admin reads the plan and never runs on it');
    assert.equal((await word(f.env, OTHER)).status, 404);
    assert.equal((await word(f.env, null)).status, 401);
    assert.equal(f.prompts.length, 0);
  } finally { f.db.close(); }
});

test('no figure, contact or link leaves; all of it dropped is a 422 and stores nothing', async () => {
  let f = await fixture({ answer: (p) => ({
    items: [{ ref: refOf(p, 'Slow setup'), title: 'Ship by 12 Oct', description: 'Costs $400 a month.' }],
    brief: { summary: 'Write to sales@example.test.' }, lovable_prompt: 'See https://example.test for the layout.',
  }) });
  try {
    await preparePlan(f.env, 1, FOUNDER);
    const r = await word(f.env);
    assert.equal(r.status, 422);
    assert.equal(r.body.code, 'nothing_kept');
    assert.equal(r.body.removed, 4);
    assert.equal(count(f.db, "SELECT COUNT(*) n FROM ai_rail_proposals WHERE kind = 'draft'"), 0);
  } finally { f.db.close(); }
  f = await fixture({ answer: () => 'not json at all' });
  try {
    await preparePlan(f.env, 1, FOUNDER);
    assert.equal((await word(f.env)).status, 422);
  } finally { f.db.close(); }
});

test('the material and the screen, alone: pending items only, a door never, a commitment counted', async () => {
  const { db, env } = await fixture();
  try {
    await preparePlan(env, 1, FOUNDER);
    const plan = await readPlan(env, 1, 'venture');
    const m = wordMaterial(plan.modules as any, plan.brief as any)!;
    assert.ok(m.items.length >= 3);
    assert.ok(!m.items.some((i) => i.kind === undefined), 'a door is never sent');
    const pilot = m.items.find((i) => i.title === 'Test the pilot')!;
    assert.deepEqual(pilot.evidence, ['1 commitment'], 'a commitment is counted, never worded');
    // A decided item is not offered for wording.
    const f = item(db, 'feature');
    db.prepare("UPDATE ai_rail_proposals SET status = 'discarded' WHERE uid = ?").run(f.proposal_uid);
    const again = wordMaterial((await readPlan(env, 1, 'venture')).modules as any, null)!;
    assert.ok(!Object.values(again.refs).includes(f.uid));
    // The screen keeps a ref's own fields and drops the rest.
    const s = screenWording({ items: [{ ref: m.items[0].ref, title: '  Plain   words  ' }, { ref: m.items[0].ref, title: 'A second answer for the same ref' }] }, m);
    assert.deepEqual(s.items, { [m.refs[m.items[0].ref]]: { title: 'Plain words' } });
    assert.deepEqual(screenWording('nonsense', m), { items: {}, brief: null, lovable_prompt: null, removed: 0 });
  } finally { db.close(); }
});

test('the source: only the press runs it, and Eadwyn is never called an advisor', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const src = read('cloudflare-worker/src/services/buildPlanWord.ts') + read('cloudflare-worker/src/routes/build_plan.ts');
  assert.doesNotMatch(src, /\b(advisor|advice|recommendation|fiduciary)\b/i);
  // The prompt is built in one route handler; nothing scheduled or prepared calls it.
  const callers = ['cloudflare-worker/src/index.ts', 'cloudflare-worker/src/services/buildPlanner.ts', 'cloudflare-worker/src/services/buildPlanAccept.ts']
    .filter((p) => /wordPrompt\(|storeWording\(/.test(read(p)));
  assert.deepEqual(callers, []);
  assert.equal(read('cloudflare-worker/src/routes/build_plan.ts').match(/wordPrompt\(/g)?.length, 1);
});
