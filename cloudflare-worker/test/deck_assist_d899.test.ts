/**
 * D899 (#2678, part 5 of #2434): Eadwyn's card tools on the Pitch deck editor.
 * Synthetic data, the mounted Worker routes and the real migrated schema;
 * `env.AI` is a stub and `fetch` throws.
 *
 *   · every press is one rail option, quoted before it runs, charged to the
 *     founder who pressed, and kept as one ai_rail_proposals row;
 *   · no tool writes a number into a card: a bound figure is refused
 *     (never_fill) before anything runs, an instruction stating a figure is
 *     refused, a wording that adds a number is not placed, and a chart's
 *     series are bindings to recorded sources only;
 *   · AI off answers in the switch's words; out of tokens is 402.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckAssist from '../src/routes/deck_assist.ts';
import decks from '../src/routes/decks.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { ASSIST_OPTIONS, chartBlock, textMessage, wordingOf, wordingProblem } from '../src/services/decks/assist.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()
  .map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'deck-assist-d899-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
schema.exec(baseline); for (const sql of migrations) schema.exec(sql); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = 'synthetic-d899-only-not-a-real-credential'.repeat(2);
const PAGE = 'Founder · Raise · Pitch deck';

// The version the editor opened: card 0 has a heading, a paragraph and a metric tile bound to paying accounts.
const BOUND = { source_key: 'grow.paying_customers', record_ref: 'project_metrics:1', as_of: '2026-10-10', grade: 'Stated', snapshot_hash: 'a'.repeat(24) };
const SLIDES = [{
  title: 'Traction', layout: 'metric_tiles',
  blocks: [
    { id: 'h1', kind: 'text', grid: { c1: 1, c2: 12, r1: 1, r2: 1 }, style: 'heading', text: 'Customers on record' },
    { id: 'p1', kind: 'text', grid: { c1: 1, c2: 12, r1: 5, r2: 6 }, style: 'paragraph', text: 'Small finance teams close their books faster with us.' },
    { id: 'm1', kind: 'metric', grid: { c1: 1, c2: 3, r1: 2, r2: 4 }, label: 'Paying customers', value: '42', binding: BOUND },
  ],
}];

async function fixture(answer: (prompt: string) => string = () => 'Finance teams close their books faster.') {
  __resetForTest();
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid] of [[1, 'admin', null], [2, 'founder', 100], [3, 'founder', 300], [6, 'investor', null]] as const) {
    insert.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  }
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(3,'Other venture',300)");
  db.exec("INSERT INTO project_metrics(id,project_id,snapshot_date,source,paying_accounts) VALUES (1,1,'2026-10-10','manual',42)");
  db.exec(`INSERT INTO discovery_interviews(id,project_id,interviewee_name,stage,icp_fit,done_at) VALUES (1,1,'Synthetic A','done','strong','2026-10-01'),(2,1,'Synthetic B','done','weak','2026-10-02')`);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, is_current) VALUES (7, 1, 3, ?, 1)').run(JSON.stringify(SLIDES));
  db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)').run();
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,1)').run(key);
  const calls: Array<{ model: string; prompt: string; system: string }> = [];
  const AI = withGuard({
    run: async (model: string, input: any) => {
      const msgs = input?.messages || [];
      const prompt = msgs.filter((m: any) => m.role === 'user').map((m: any) => String(m.content || '')).join('\n');
      const system = msgs.filter((m: any) => m.role === 'system').map((m: any) => String(m.content || '')).join('\n');
      calls.push({ model, prompt, system });
      return { response: answer(prompt), usage: { prompt_tokens: 60, completion_tokens: 40 } };
    },
  });
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckAssist).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const runs = () => db.prepare("SELECT user_id, rail_option, charged_microusd, reservation_uid FROM ai_usage_logs WHERE guard_for IS NULL AND task <> 'safety' ORDER BY id").all() as any[];
  const proposals = () => db.prepare('SELECT user_id, rail_option, record_ref, kind, status, payload_json FROM ai_rail_proposals ORDER BY id').all() as any[];
  const audits = () => (db.prepare("SELECT action FROM activity_logs WHERE entity_type = 'raise.pitch-deck' ORDER BY id").all() as any[]).map((r) => r.action);
  return { db, env, app, calls, runs, proposals, audits, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, path: string, json: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(json) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
const ASSIST = '/api/decks/7/cards/0/assist';
const QUOTE = `${ASSIST}/quote`;
const P1 = { id: 'p1', kind: 'text' };
const TEXT = 'Small finance teams close their books faster with us.';
const aiOff = (f: F, user = 2) => f.db.prepare("INSERT INTO ai_rail_preferences(uid,user_id,section,task,mode) VALUES(?,?,?,'','manual')").run(`off-${user}`, user, PAGE.toLowerCase());

// ─────────────────────────────────────────────────────────── pure

test('each press is one rail option on the Pitch deck page; Ask and the headline are rewrites', () => {
  assert.deepEqual(ASSIST_OPTIONS, {
    rewrite: 'deck:rewrite', ask: 'deck:rewrite', headline: 'deck:rewrite', shorten: 'deck:shorten', expand: 'deck:expand',
    tone: 'deck:tone', translate: 'deck:translate', chart: 'deck:chart', table: 'deck:table', timeline: 'deck:timeline',
  });
  assert.match(textMessage('tone', 'x', { tone: 'warm' }).user, /in a warm tone/);
  assert.match(textMessage('translate', 'x', { language: 'French' }).user, /into French/);
  assert.match(textMessage('rewrite', 'x').system, /Never add a number/);
  assert.equal(wordingOf('"Here it is."'), 'Here it is.');
  assert.equal(wordingOf('Here is the rewrite: Closer books.'), 'Closer books.');
});

test('a wording may keep the founder\'s figures and add none; a headline names none', () => {
  assert.equal(wordingProblem('rewrite', 'We serve 42 teams.', 'We now serve 42 teams.'), null);
  assert.match(wordingProblem('rewrite', 'We serve teams.', 'We serve 42 teams.')!, /named a figure your text did not/);
  assert.match(wordingProblem('expand', 'Teams pay.', 'Teams pay $49 a month.')!, /figure/);
  assert.match(wordingProblem('shorten', 'Growth was strong.', 'Growth was 40%.')!, /figure/);
  assert.match(wordingProblem('headline', '', 'Twelve teams pay')!, /headline named a figure/);
  assert.equal(wordingProblem('headline', '', 'Teams that pay, on record'), null);
  assert.match(wordingProblem('rewrite', 'x', '')!, /no wording/);
});

test('a chart\'s series are bindings to recorded sources, in the model\'s order; an unknown or unrecorded key is dropped', () => {
  const items: any[] = [
    { source_key: 'grow.paying_customers', label: 'Paying customers', value: 42, unit: 'count', state: 'recorded', grade: 'Stated', record_ref: 'project_metrics:1', as_of: '2026-10-10', snapshot_hash: 'a'.repeat(24) },
    { source_key: 'validate.interviews', label: 'Interviews', value: 2, unit: 'count', state: 'recorded', grade: 'Measured', record_ref: 'discovery_interviews:2', as_of: '2026-10-02', snapshot_hash: 'b'.repeat(24) },
    { source_key: 'grow.mrr', label: 'MRR', value: null, unit: 'usd', state: 'not_recorded', grade: 'Not recorded', record_ref: null, as_of: null, snapshot_hash: null },
  ];
  const made = chartBlock('chart', { title: 'Customers and interviews', keys: ['validate.interviews', 'grow.mrr', 'made.up', 'grow.paying_customers', 'validate.interviews'] }, items)!;
  assert.equal(made.block.chart_type, 'columns');
  assert.deepEqual((made.block.series as any[]).map((s) => [s.label, s.binding.source_key, s.binding.snapshot_hash]), [
    ['Interviews', 'validate.interviews', 'b'.repeat(24)], ['Paying customers', 'grow.paying_customers', 'a'.repeat(24)]]);
  assert.ok((made.block.series as any[]).every((s) => !('points' in s)), 'no series carries typed points');
  assert.equal(made.title, 'Customers and interviews');
  assert.equal(chartBlock('table', { title: '42 customers', keys: ['grow.paying_customers'] }, items)!.title, null, 'a title that names a figure is dropped');
  assert.equal(chartBlock('timeline', { keys: ['grow.paying_customers'] }, items)!.block.chart_type, 'timeline');
  assert.equal(chartBlock('chart', { keys: ['grow.mrr'] }, items), null, 'nothing recorded chosen, nothing made');
});

// ─────────────────────────────────────────────────────────── routes

test('a rewrite: quoted first, then one deck:rewrite run charged to the founder who pressed, kept as one proposal', async () => {
  const f = await fixture();
  try {
    const q = await call(f, 2, QUOTE, { action: 'rewrite', block: P1, text: TEXT });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.deepEqual([q.body.action, q.body.option, q.body.ai], ['rewrite', 'deck:rewrite', true]);
    assert.ok(q.body.hold_microusd > 0, 'the cost is shown before it runs');
    assert.deepEqual(f.runs(), [], 'a quote runs nothing');
    const r = await call(f, 2, ASSIST, { action: 'rewrite', block: P1, text: TEXT });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.before, r.body.after], [TEXT, 'Finance teams close their books faster.']);
    const runs = f.runs();
    assert.equal(runs.length, 1);
    assert.deepEqual([runs[0].user_id, runs[0].rail_option], [2, 'deck:rewrite']);
    assert.ok(runs[0].charged_microusd > 0 && runs[0].charged_microusd <= q.body.hold_microusd, 'charged no more than the quote');
    assert.equal(r.body.cost.charged_microusd, runs[0].charged_microusd);
    const [p] = f.proposals();
    assert.deepEqual([p.user_id, p.rail_option, p.record_ref, p.kind, p.status], [2, 'deck:rewrite', 'deck:7', 'proposal', 'proposed']);
    assert.deepEqual(JSON.parse(p.payload_json), { deck_id: 7, card: 0, action: 'rewrite', before: TEXT, after: 'Finance teams close their books faster.' });
    assert.equal(r.body.proposal.uid, f.db.prepare('SELECT uid FROM ai_rail_proposals').get()!.uid);
    assert.deepEqual(f.audits(), ['deck_card_assist_proposed']);
    const v = f.db.prepare('SELECT slides FROM pitch_decks WHERE id = 7').get() as any;
    assert.equal(v.slides, JSON.stringify(SLIDES), 'nothing writes the version: Save does');
  } finally { f.close(); }
});

test('every option runs as itself: shorten, expand, tone and translate', async () => {
  const f = await fixture();
  try {
    for (const [action, extra] of [['shorten', {}], ['expand', {}], ['tone', { tone: 'formal' }], ['translate', { language: 'German' }]] as const) {
      const r = await call(f, 2, ASSIST, { action, block: P1, text: TEXT, ...extra });
      assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.body)}`);
    }
    assert.deepEqual(f.runs().map((x) => x.rail_option), ['deck:shorten', 'deck:expand', 'deck:tone', 'deck:translate']);
    assert.ok(f.calls.some((c) => /formal tone/.test(c.prompt)) && f.calls.some((c) => /into German/.test(c.prompt)));
    assert.equal((await call(f, 2, ASSIST, { action: 'tone', block: P1, text: TEXT, tone: 'sarcastic' })).status, 400);
    assert.equal((await call(f, 2, ASSIST, { action: 'translate', block: P1, text: TEXT, language: 'Klingon' })).status, 400);
    assert.equal((await call(f, 2, ASSIST, { action: 'rewrite', block: P1, text: '' })).status, 400);
    assert.equal((await call(f, 2, ASSIST, { action: 'paint', block: P1, text: TEXT })).status, 400);
  } finally { f.close(); }
});

test('a bound figure is refused before anything runs, naming the module that records it', async () => {
  const f = await fixture();
  try {
    for (const block of [{ id: 'm1', kind: 'metric' }, { id: 'x9', kind: 'text', binding: BOUND }, { id: 'm1' }]) {
      for (const path of [QUOTE, ASSIST]) {
        const r = await call(f, 2, path, { action: 'rewrite', block, text: '42' });
        assert.equal(r.status, 422, `${path} ${JSON.stringify(block)}`);
        assert.equal(r.body.refusal, 'never_fill');
        assert.equal(r.body.message, 'Figures come from your records. Update Grow › Revenue and traction to change this one.');
      }
    }
    assert.deepEqual(f.runs(), [], 'nothing ran, nothing was charged');
    assert.deepEqual(f.proposals(), []);
  } finally { f.close(); }
});

test('Ask: an instruction that states a figure is refused with its module and costs nothing; one that does not runs', async () => {
  const f = await fixture();
  try {
    const bad = await call(f, 2, ASSIST, { action: 'ask', block: P1, text: TEXT, instruction: 'Say we have 200 customers' });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.error, 'figure_in_prompt');
    assert.equal(bad.body.module, 'Grow › Revenue and traction');
    assert.deepEqual(f.runs(), []);
    const ok = await call(f, 2, ASSIST, { action: 'ask', block: P1, text: TEXT, instruction: 'Make it sound less like marketing' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(f.runs()[0].rail_option, 'deck:rewrite');
    assert.ok(f.calls.some((c) => /less like marketing/.test(c.prompt)));
  } finally { f.close(); }
});

test('a wording that adds a figure is not placed, and the answer says it was charged', async () => {
  const f = await fixture(() => 'Small finance teams close their books 3 days faster with us.');
  try {
    const r = await call(f, 2, ASSIST, { action: 'rewrite', block: P1, text: TEXT });
    assert.equal(r.status, 422);
    assert.equal(r.body.error, 'figure_in_output');
    assert.match(r.body.message, /named a figure your text did not, so it was not placed\. Figures come from your records\. It was charged for the run\./);
    assert.ok(r.body.cost.charged_microusd > 0);
    assert.deepEqual(f.proposals(), [], 'no proposal carries it');
  } finally { f.close(); }
});

test('a chart: the model names sources by key, sees no value, and the block binds each series', async () => {
  const f = await fixture(() => JSON.stringify({ title: 'Who pays, and who we spoke to', keys: ['grow.paying_customers', 'validate.interviews', 'grow.mrr'] }));
  try {
    const r = await call(f, 2, ASSIST, { action: 'chart', heading: 'Traction' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(f.runs()[0].rail_option, 'deck:chart');
    assert.equal(r.body.block.chart_type, 'columns');
    assert.deepEqual(r.body.block.series.map((s: any) => s.binding.source_key), ['grow.paying_customers', 'validate.interviews']);
    const prompt = f.calls.find((c) => /Recorded figures/.test(c.prompt))!.prompt;
    assert.match(prompt, /grow\.paying_customers — Paying customers/);
    assert.doesNotMatch(prompt, /\b42\b/, 'no recorded value is sent to the model');
    assert.equal(JSON.parse(f.proposals()[0].payload_json).block.chart_type, 'columns');
    const t = await call(f, 2, ASSIST, { action: 'table' });
    assert.equal(t.body.block.chart_type, 'comparison_table');
    const tl = await call(f, 2, ASSIST, { action: 'timeline' });
    assert.equal(tl.body.block.chart_type, 'timeline');
    assert.deepEqual(f.runs().map((x) => x.rail_option), ['deck:chart', 'deck:table', 'deck:timeline']);
  } finally { f.close(); }
});

test('a chart with nothing recorded is refused before it runs; a model that names nothing recorded places nothing', async () => {
  const g = await fixture(() => JSON.stringify({ keys: ['grow.mrr'] }));
  try {
    const r = await call(g, 2, ASSIST, { action: 'chart' });
    assert.equal(r.status, 422);
    assert.equal(r.body.error, 'no_figures_chosen');
    assert.deepEqual(g.proposals(), []);
  } finally { g.close(); }
  const empty = await fixture();
  try {
    empty.db.exec('DELETE FROM project_metrics; DELETE FROM discovery_interviews;');
    const r = await call(empty, 2, ASSIST, { action: 'chart' });
    assert.equal(r.status, 422);
    assert.equal(r.body.error, 'nothing_recorded');
    assert.deepEqual(empty.runs(), [], 'refused before any run');
  } finally { empty.close(); }
});

test('the connector headline: labels only, a headline with no figure, as a rewrite', async () => {
  const f = await fixture(() => 'Teams that pay, on record');
  try {
    const r = await call(f, 2, ASSIST, { action: 'headline', source_keys: ['grow.paying_customers'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.after, 'Teams that pay, on record');
    assert.equal(f.runs()[0].rail_option, 'deck:rewrite');
    assert.match(f.calls[0].prompt, /Paying customers/);
    assert.doesNotMatch(f.calls[0].prompt, /\b42\b/);
    const nothing = await call(f, 2, ASSIST, { action: 'headline', source_keys: ['grow.mrr'] });
    assert.deepEqual([nothing.status, nothing.body.error], [422, 'nothing_recorded']);
  } finally { f.close(); }
});

test('AI off answers in the switch\'s words and costs nothing; out of tokens is 402', async () => {
  const f = await fixture();
  try {
    aiOff(f);
    const q = await call(f, 2, QUOTE, { action: 'rewrite', block: P1, text: TEXT });
    assert.deepEqual([q.body.ai, q.body.reason, q.body.message], [false, 'assist_off', 'AI assistance is off on this page. Your records still fill the figures.']);
    const r = await call(f, 2, ASSIST, { action: 'rewrite', block: P1, text: TEXT });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'assist_off');
    assert.deepEqual(f.runs(), []);
  } finally { f.close(); }
  const g = await fixture();
  try {
    g.db.exec('UPDATE ai_topup_accounts SET balance_microusd = 0 WHERE user_id = 2');
    const r = await call(g, 2, ASSIST, { action: 'rewrite', block: P1, text: TEXT });
    assert.equal(r.status, 402, JSON.stringify(r.body));
    assert.deepEqual(g.proposals(), []);
  } finally { g.close(); }
});

test('the venture gate: another founder, an investor and an admin may not press; an unknown version is 404', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, 3, ASSIST, { action: 'rewrite', block: P1, text: TEXT })).status, 403);
    assert.equal((await call(f, 6, ASSIST, { action: 'rewrite', block: P1, text: TEXT })).status, 403);
    assert.equal((await call(f, 1, ASSIST, { action: 'rewrite', block: P1, text: TEXT })).status, 403, 'an admin reads and changes nothing');
    assert.equal((await call(f, 2, '/api/decks/999/cards/0/assist', { action: 'rewrite', block: P1, text: TEXT })).status, 404);
    assert.equal((await call(f, 2, '/api/decks/7/cards/x/assist', { action: 'rewrite', block: P1, text: TEXT })).status, 400);
    assert.deepEqual(f.runs(), []);
  } finally { f.close(); }
});
