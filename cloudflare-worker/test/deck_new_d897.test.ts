/**
 * D897 (#2677, part 3 of #2434): New deck — audience and round, the outline,
 * the build, and keeping cards one by one. Synthetic data, the mounted Worker
 * routes and the real migrated schema; `env.AI` is a stub and `fetch` throws.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_new_d897.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckNew from '../src/routes/deck_new.ts';
import decks from '../src/routes/decks.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import {
  CARD_CATALOGUE, buildCards, figureRefusal, numberIn, outlineFromBody, outlineFromModel, standardOutline, valueText, wordingFromModel,
} from '../src/services/decks/newDeck.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()
  .map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'deck-new-d897-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
schema.exec(baseline); for (const sql of migrations) schema.exec(sql); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = 'synthetic-d897-only-not-a-real-credential'.repeat(2);
const PAGE = 'Founder · Raise · Pitch deck';

type Stub = { outline?: unknown; cards?: unknown };

async function fixture(stub: Stub = {}) {
  __resetForTest();
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid, tier] of [[1, 'admin', null, 'studio'], [2, 'founder', 100, 'studio'], [3, 'founder', 300, 'free'], [6, 'investor', null, 'studio']] as const) {
    insert.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, tier);
  }
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(3,'Synthetic free venture',300)");
  // What the records hold: three interviews (two strong fits), paying accounts typed in Grow, an active round counsel approved.
  db.exec(`INSERT INTO discovery_interviews(id,project_id,interviewee_name,stage,icp_fit,done_at) VALUES (1,1,'Synthetic A','done','strong','2026-10-01'),(2,1,'Synthetic B','done','strong','2026-10-02'),(3,1,'Synthetic C','done','weak','2026-10-03')`);
  db.exec("INSERT INTO project_metrics(id,project_id,snapshot_date,source,paying_accounts) VALUES (1,1,'2026-10-10','manual',42)");
  db.exec("INSERT INTO raise_rounds(id,uid,project_id,name,target_amount,close_date,status) VALUES (1,'round-synthetic-1',1,'Synthetic seed',1500000,'2026-12-15','active')");
  db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)').run();
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,1)').run(key);
  const calls: Array<{ model: string; prompt: string }> = [];
  const AI = withGuard({
    run: async (model: string, input: any) => {
      const prompt = (input?.messages || []).map((m: any) => (typeof m?.content === 'string' ? m.content : '')).join('\n');
      calls.push({ model, prompt });
      const response = /^Plan a /m.test(prompt) ? JSON.stringify(stub.outline ?? { rows: [] }) : JSON.stringify(stub.cards ?? { cards: [] });
      return { response, usage: { prompt_tokens: 60, completion_tokens: 40 } };
    },
  });
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckNew).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const runs = () => db.prepare("SELECT rail_option, charged_microusd, reservation_uid FROM ai_usage_logs WHERE guard_for IS NULL AND task <> 'safety' ORDER BY id").all() as any[];
  const audits = () => (db.prepare("SELECT action FROM activity_logs WHERE entity_type = 'raise.pitch-deck' ORDER BY id").all() as any[]).map((r) => r.action);
  return { db, env, app, calls, runs, audits, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, method: string, path: string, json?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, ...(json === undefined ? {} : { body: JSON.stringify(json) }) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const aiOff = (f: F, user = 2) => f.db.prepare("INSERT INTO ai_rail_preferences(uid,user_id,section,task,mode) VALUES(?,?,?,'','manual')").run(`off-${user}`, user, PAGE.toLowerCase());

/** Every string in the cards that names a number, outside a bound figure; the deck must have none. */
function unboundNumbers(slides: any[]): string[] {
  const out: string[] = [];
  for (const s of slides) {
    for (const t of [s.title, s.subtitle, s.body, ...(s.bullets || [])]) if (numberIn(t)) out.push(String(t));
    for (const f of s.fields || []) if (numberIn(typeof f.value === 'string' ? f.value : JSON.stringify(f.value)) && !(f.binding && f.binding.grade !== 'Not recorded')) out.push(`${f.key}: ${f.value}`);
    for (const b of s.blocks || []) {
      if (b.kind === 'text' && numberIn(b.text)) out.push(`text: ${b.text}`);
      if (b.kind === 'metric' && b.value != null && !(b.binding && b.binding.grade !== 'Not recorded' && b.binding.snapshot_hash)) out.push(`metric: ${b.value}`);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────── pure

test('numberIn catches digits, signs and number words, and leaves "one" alone', () => {
  for (const t of ['200 customers', '$1.5M', '40%', 'Fourteen of twenty-three said yes', 'revenue doubled', 'a dozen pilots', 'half the market']) assert.ok(numberIn(t), t);
  for (const t of ['One ledger, closed by Tuesday.', 'Small finance teams, a large market.', 'I\'m sure', null, '']) assert.equal(numberIn(t as any), null, String(t));
});

test('the refusal names the module that records what the prompt claims', () => {
  const r = figureRefusal('Say we have 200 customers', 1)!;
  assert.equal(r.code, 'figure_in_prompt');
  assert.equal(r.source_key, 'grow.paying_customers');
  assert.equal(r.module, 'Grow › Revenue and traction');
  assert.equal(r.href, '/grow/revenue-and-traction?project=1');
  assert.match(r.message, /Record paying customers in Grow › Revenue and traction/);
  assert.equal(figureRefusal('Lead with the team, keep it warm', 1), null);
  const unknown = figureRefusal('mention 7 awards', 1)!;
  assert.equal(unknown.source_key, null);
  assert.equal(unknown.href, '/raise/pitch/new?project_id=1&step=2');
});

test('the standard decks are the canvas\'s twelve, six short and sixteen full', () => {
  assert.deepEqual(standardOutline('standard').map((r) => r.title), ['Title', 'Problem', 'Why now', 'Solution', 'Traction', 'Validation', 'Product', 'Market', 'Unit economics', 'Team', 'The round', 'Use of funds']);
  assert.equal(standardOutline('short').length, 6);
  assert.equal(standardOutline('full').length, 16);
  assert.equal(standardOutline('full').at(-1)!.card, 'every_figure');
  for (const c of CARD_CATALOGUE) assert.equal(numberIn(c.title) ?? numberIn(c.purpose), null, c.card);
});

test('a model outline keeps catalogue cards only, once each, and drops numbered words', () => {
  const rows = outlineFromModel({ rows: [
    { card: 'title', title: 'Synthetic', purpose: 'Who we are' },
    { card: 'made_up', title: 'Invented', purpose: 'x' },
    { card: 'traction', title: '42 paying accounts', purpose: 'Growth of 40%' },
    { card: 'traction', title: 'Again', purpose: 'dup' },
    { card: 'team', title: 'The team', purpose: 'Builders' },
  ] }, 'short')!;
  assert.deepEqual(rows.map((r) => r.card), ['title', 'traction', 'team']);
  assert.deepEqual([rows[1].title, rows[1].purpose], ['Traction', 'Revenue and customers from your records']);
  assert.equal(outlineFromModel({ rows: [{ card: 'title' }] }, 'standard'), null, 'too few cards is no outline');
  assert.equal(outlineFromModel('nonsense', 'short'), null);
});

test('a founder outline row that states a figure is refused; an unknown card is refused', () => {
  const r = outlineFromBody([{ card: 'traction', title: 'We have 200 customers' }], 1) as any;
  assert.equal(r.refusal.code, 'figure_in_prompt');
  assert.match(r.error, /an outline row \(row 1\)/);
  assert.match((outlineFromBody([{ card: 'nope' }], 1) as any).error, /card must be one of/);
  assert.match((outlineFromBody([], 1) as any).error, /at least one card/);
  assert.deepEqual((outlineFromBody([{ card: 'team' }], 1) as any).rows, [{ card: 'team', title: 'Team', purpose: 'The founders and what they bring' }]);
});

test('wording that names a number is dropped and counted; the rest is kept by position', () => {
  const w = wordingFromModel({ cards: [
    { n: 1, headline: 'Close the books faster.', body: 'Customers asked for this.' },
    { n: 2, headline: 'Fourteen of twenty-three said yes.', body: 'We grew 40% last month.' },
    { n: 9, headline: 'Out of range' },
  ] }, 2);
  assert.deepEqual(w.byIndex, [{ headline: 'Close the books faster.', body: 'Customers asked for this.' }, { headline: null, body: null }]);
  assert.equal(w.dropped, 2);
});

test('values print by unit; a missing value is null, never 0', () => {
  assert.equal(valueText({ value: 1500000, unit: 'usd' } as any), '$1,500,000');
  assert.equal(valueText({ value: 123456, unit: 'cents' } as any), '$1,235');
  assert.equal(valueText({ value: 4.2, unit: 'percent' } as any), '4.2%');
  assert.equal(valueText({ value: 13.846, unit: 'months' } as any), '13.8 months');
  assert.equal(valueText({ value: '2026-12-15', unit: 'date' } as any), '15 Dec 2026');
  assert.equal(valueText({ value: 9, unit: 'count', of: 12 } as any), '9 of 12');
  assert.equal(valueText({ value: null, unit: 'count' } as any), null);
});

test('built cards pass the slide model, and every number on them is a binding', () => {
  const items: any[] = [
    { source_key: 'grow.paying_customers', label: 'Paying customers', value: 42, unit: 'count', state: 'recorded', grade: 'Stated', record_ref: 'project_metrics:1', as_of: '2026-10-10', snapshot_hash: 'a'.repeat(24) },
    { source_key: 'grow.mrr', label: 'MRR', value: null, unit: 'usd', state: 'not_recorded', grade: 'Not recorded', record_ref: null, as_of: null, snapshot_hash: null },
  ];
  const rows = standardOutline('full');
  const { slides, problems } = buildCards(rows, items, rows.map(() => ({ headline: 'Words only.', body: 'No figures here.' })), 'Synthetic venture');
  assert.deepEqual(problems, []);
  assert.deepEqual(unboundNumbers(slides), []);
  const traction = slides.find((s) => s.spec_id === 'new:traction');
  assert.equal(traction.layout, 'metric_tiles');
  const paying = traction.blocks.find((b: any) => b.binding?.source_key === 'grow.paying_customers');
  assert.deepEqual([paying.value, paying.binding.grade, paying.binding.record_ref], ['42', 'Stated', 'project_metrics:1']);
  const mrr = traction.blocks.find((b: any) => b.binding?.source_key === 'grow.mrr');
  assert.deepEqual([mrr.value, mrr.binding.grade], [null, 'Not recorded']);
  assert.deepEqual(traction.fields.find((x: any) => x.key === 'grow.mrr'), { key: 'grow.mrr', label: 'MRR', kind: 'auto', readonly: true, binding: mrr.binding, value: '', source: 'placeholder' });
  const appendix = slides.at(-1);
  assert.equal(appendix.appendix, true);
  assert.equal(appendix.blocks.filter((b: any) => b.kind === 'metric').length, 1, 'the appendix lists recorded figures only');
  assert.equal(slides[0].fields.find((x: any) => x.key === 'venture_name').value, 'Synthetic venture');
});

// ─────────────────────────────────────────────────────────── routes

test('context: the seven audiences, three lengths, the round with its Reviewed chip, no average yet', async () => {
  const f = await fixture();
  try {
    f.db.exec(`INSERT INTO round_calls(id,uid,project_id,name,amount_cents,instrument,terms,minimum_cheque_cents,target_close,terms_hash,created_by,counsel_approved_hash,counsel_approved_by,counsel_approved_at,counsel_approval_reference)
      VALUES (1,'call-synthetic-1',1,'Synthetic call',150000000,'safe','Synthetic terms',2500000,'2026-12-15','h1',2,'h1',1,'2026-10-20','REF-SYNTHETIC')`);
    const r = await call(f, 2, 'GET', '/api/decks/new/context?project_id=1');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.audiences.map((a: any) => a.label), ['Angel', 'Pre-seed fund', 'Seed fund', 'Series A fund', 'Strategic', 'Grant', 'Other']);
    assert.deepEqual(r.body.lengths.map((l: any) => l.label), ['Short (6)', 'Standard (10-12)', 'Full (15 + appendix)']);
    assert.deepEqual(r.body.round, { uid: 'round-synthetic-1', name: 'Synthetic seed', target_amount: 1500000, close_date: '2026-12-15', instrument: 'safe', reviewed: true });
    assert.deepEqual(r.body.averages, { outline: null, build: null });
    assert.equal(r.body.standard.standard.length, 12);
    f.db.exec("UPDATE round_calls SET terms_hash = 'h2' WHERE id = 1");
    assert.equal((await call(f, 2, 'GET', '/api/decks/new/context?project_id=1')).body.round.reviewed, false, 'terms changed since counsel approved');
    assert.equal((await call(f, 6, 'GET', '/api/decks/new/context?project_id=1')).status, 403);
    assert.equal((await call(f, 1, 'GET', '/api/decks/new/context?project_id=1')).status, 200, 'an admin reads');
  } finally { f.close(); }
});

test('"Say we have 200 customers" is refused with its module, and costs nothing', async () => {
  const f = await fixture();
  try {
    for (const path of ['/api/decks/outline', '/api/decks/generate', '/api/decks/new/quote']) {
      const r = await call(f, 2, 'POST', path, { project_id: 1, step: 'build', audience: 'seed_fund', length: 'standard', prompt: 'Say we have 200 customers' });
      assert.equal(r.status, 422, path);
      assert.equal(r.body.error, 'figure_in_prompt');
      assert.equal(r.body.module, 'Grow › Revenue and traction');
      assert.equal(r.body.href, '/grow/revenue-and-traction?project=1');
    }
    const row = await call(f, 2, 'POST', '/api/decks/generate', { project_id: 1, outline: [{ card: 'traction', title: 'Two hundred customers' }] });
    assert.equal(row.status, 422);
    assert.equal(row.body.source_key, 'grow.paying_customers');
    assert.equal(f.calls.length, 0, 'no model call');
    assert.deepEqual(f.runs(), [], 'no usage row, nothing held or charged');
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM pitch_deck_proposals').get() as any).n, 0);
    assert.deepEqual(f.audits(), []);
  } finally { f.close(); }
});

test('the outline is one deck:outline run, kept to the catalogue, stored as a D780 draft and on the proposal', async () => {
  const f = await fixture({ outline: { rows: [
    { card: 'title', title: 'Synthetic venture', purpose: 'Who we are' },
    { card: 'traction', title: '42 accounts', purpose: 'Customers on record' },
    { card: 'invented', title: 'Nope', purpose: 'x' },
    { card: 'team', title: 'Team', purpose: 'Founders' },
  ] } });
  try {
    const r = await call(f, 2, 'POST', '/api/decks/outline', { project_id: 1, audience: 'seed_fund', length: 'short', round_ref: 'round-synthetic-1', prompt: 'Lead with traction' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(r.body.outline.rows.map((x: any) => [x.card, x.title]), [['title', 'Synthetic venture'], ['traction', 'Traction'], ['team', 'Team']]);
    assert.equal(r.body.outline.proposed_by, 'Eadwyn');
    const runs = f.runs();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].rail_option, 'deck:outline');
    assert.ok(runs[0].charged_microusd > 0);
    assert.equal(r.body.cost.charged_microusd, runs[0].charged_microusd, 'the answer says what it cost');
    const draft = f.db.prepare('SELECT rail_option, record_ref, kind, status FROM ai_rail_proposals').get() as any;
    assert.deepEqual({ ...draft }, { rail_option: 'deck:outline', record_ref: 'project:1', kind: 'draft', status: 'proposed' });
    const p = r.body.proposal;
    assert.deepEqual(p.slides, []);
    assert.deepEqual([p.outline.audience, p.outline.length, p.outline.round_ref, p.outline.prompt], ['seed_fund', 'short', 'round-synthetic-1', 'Lead with traction']);
    assert.equal(p.kept, null);
    assert.ok(f.calls.some((c) => /Lead with traction/.test(c.prompt)), 'the founder\'s note reaches the run');
    assert.deepEqual(f.audits(), ['deck_outline_proposed']);
    assert.equal((await call(f, 2, 'POST', '/api/decks/outline', { project_id: 1, audience: 'seed_fund', length: 'short', round_ref: 'round-of-someone-else' })).status, 400);
    assert.equal((await call(f, 2, 'POST', '/api/decks/outline', { project_id: 1, audience: 'vc', length: 'short' })).status, 400);
    assert.equal((await call(f, 2, 'POST', '/api/decks/outline', { project_id: 1, audience: 'angel', length: 'short', prompt: 'x'.repeat(501) })).status, 400);
  } finally { f.close(); }
});

test('AI off: the outline is StudioOS\'s standard one and the build is figures only, at no cost', async () => {
  const f = await fixture();
  try {
    aiOff(f);
    const o = await call(f, 2, 'POST', '/api/decks/outline', { project_id: 1, audience: 'angel', length: 'short' });
    assert.equal(o.status, 201, JSON.stringify(o.body));
    assert.equal(o.body.outline.proposed_by, 'StudioOS');
    assert.match(o.body.outline.reason, /AI assistance is off/);
    assert.deepEqual(o.body.outline.rows, standardOutline('short'));
    const g = await call(f, 2, 'POST', '/api/decks/generate', { project_id: 1, proposal_id: o.body.proposal.id });
    assert.equal(g.status, 201, JSON.stringify(g.body));
    assert.equal(g.body.wording.by, 'none');
    assert.equal(g.body.proposal.slides.length, 6);
    assert.deepEqual(f.runs(), []);
    assert.equal(f.calls.length, 0);
    assert.equal(g.body.cost.charged_microusd, 0);
  } finally { f.close(); }
});

test('Build deck: one deck:build run, code fills every figure, and invented numbers never reach a card', async () => {
  const f = await fixture({ cards: { cards: [
    { n: 1, headline: 'Close the books in a day.', body: 'Finance teams asked for it.' },
    { n: 2, headline: 'We have 200 customers.', body: 'Revenue grew 300%.' },
    { n: 5, headline: 'Customers keep coming.', body: 'Accounts are paying.' },
  ] } });
  try {
    const r = await call(f, 2, 'POST', '/api/decks/generate', { project_id: 1, audience: 'series_a_fund', length: 'standard' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const slides = r.body.proposal.slides;
    assert.equal(slides.length, 12);
    assert.deepEqual(unboundNumbers(slides), [], 'a generated deck holds no number that is not a binding');
    assert.doesNotMatch(JSON.stringify(slides), /200 customers|300%/);
    assert.equal(r.body.wording.dropped, 2);
    const traction = slides[4];
    assert.equal(traction.blocks[0].text, 'Customers keep coming.');
    const paying = traction.blocks.find((b: any) => b.binding?.source_key === 'grow.paying_customers');
    assert.deepEqual([paying.value, paying.binding.grade, paying.binding.record_ref], ['42', 'Stated', 'project_metrics:1']);
    const validation = slides[5];
    assert.equal(validation.blocks.find((b: any) => b.binding?.source_key === 'validate.interviews').value, '3');
    assert.equal(validation.blocks.find((b: any) => b.binding?.source_key === 'validate.strong_fit').value, '2');
    const lois = validation.blocks.find((b: any) => b.binding?.source_key === 'validate.lois');
    assert.deepEqual([lois.value, lois.binding.grade], [null, 'Not recorded'], 'an empty slot is Not recorded, never 0');
    const round = slides[10].blocks.find((b: any) => b.binding?.source_key === 'raise.round_target');
    assert.equal(round.value, '$1,500,000');
    // The model saw the figures as read-only facts and was told not to restate them.
    const prompt = f.calls.find((c) => /Write the cards/.test(c.prompt))!.prompt;
    assert.match(prompt, /"label":"Paying customers","value":"42"/);
    assert.match(prompt, /Series A fund/);
    const runs = f.runs();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].rail_option, 'deck:build');
    assert.equal(r.body.cost.charged_microusd, runs[0].charged_microusd);
    assert.deepEqual(r.body.progress[4], { n: 5, title: 'Traction', filled: 1, slots: 4, missing: ['grow.mrr', 'grow.mercury_growth', 'grow.arr'], worded: true });
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM pitch_decks').get() as any).n, 0, 'nothing is a version until it is kept');
    assert.deepEqual(f.audits(), ['deck_built']);
    assert.equal(r.body.proposal.outline.audience, 'series_a_fund');
  } finally { f.close(); }
});

test('the quote is the hold: Build deck\'s shown price is what its run reserves', async () => {
  const f = await fixture({ cards: { cards: [] } });
  try {
    const body = { project_id: 1, step: 'build', audience: 'seed_fund', length: 'short', prompt: 'Keep it warm' };
    const q = await call(f, 2, 'POST', '/api/decks/new/quote', body);
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.ai, true);
    assert.ok(q.body.hold_microusd > 0);
    assert.deepEqual(f.runs(), [], 'a quote runs nothing');
    const g = await call(f, 2, 'POST', '/api/decks/generate', body);
    assert.equal(g.status, 201);
    const run = f.runs()[0];
    const hold = f.db.prepare('SELECT included_microusd + topup_microusd AS held FROM ai_budget_reservations WHERE uid = ?').get(run.reservation_uid) as any;
    assert.equal(hold.held, q.body.hold_microusd);
    assert.ok(run.charged_microusd <= q.body.hold_microusd, 'the receipt never exceeds the quote');
    const outlineQuote = await call(f, 2, 'POST', '/api/decks/new/quote', { ...body, step: 'outline' });
    assert.ok(outlineQuote.body.hold_microusd > 0);
    aiOff(f);
    const off = await call(f, 2, 'POST', '/api/decks/new/quote', body);
    assert.deepEqual([off.body.ai, off.body.reason], [false, 'assist_off']);
  } finally { f.close(); }
});

test('out of AI tokens: Build deck is refused 402 and nothing is written', async () => {
  const f = await fixture();
  try {
    f.db.exec('UPDATE ai_topup_accounts SET balance_microusd = 0 WHERE user_id = 2');
    const r = await call(f, 2, 'POST', '/api/decks/generate', { project_id: 1 });
    assert.equal(r.status, 402, JSON.stringify(r.body));
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM pitch_deck_proposals').get() as any).n, 0);
    assert.deepEqual(f.audits(), []);
  } finally { f.close(); }
});

test('keep slide by slide: kept cards accumulate, Save writes them alone as the outline\'s version', async () => {
  const f = await fixture();
  try {
    aiOff(f);
    const o = await call(f, 2, 'POST', '/api/decks/outline', { project_id: 1, audience: 'angel', length: 'short', round_ref: 'round-synthetic-1' });
    const id = o.body.proposal.id;
    assert.equal((await call(f, 2, 'POST', `/api/decks/proposals/${id}/keep-slides`, { indexes: [0] })).status, 409, 'nothing to keep before the build');
    await call(f, 2, 'POST', '/api/decks/generate', { project_id: 1, proposal_id: id });
    let r = await call(f, 2, 'POST', `/api/decks/proposals/${id}/keep-slides`, { indexes: [4, 0] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.proposal.kept, [0, 4]);
    r = await call(f, 2, 'POST', `/api/decks/proposals/${id}/keep-slides`, { indexes: [2] });
    assert.deepEqual(r.body.proposal.kept, [0, 2, 4]);
    assert.equal((await call(f, 2, 'POST', `/api/decks/proposals/${id}/keep-slides`, { indexes: [6] })).status, 400, 'out of range');
    assert.equal((await call(f, 2, 'POST', `/api/decks/proposals/${id}/keep-slides`, { indexes: [1, 1] })).status, 400, 'twice');
    assert.equal((await call(f, 6, 'POST', `/api/decks/proposals/${id}/keep-slides`, { all: true })).status, 403);
    assert.equal((await call(f, 1, 'POST', `/api/decks/proposals/${id}/keep-slides`, { all: true })).status, 403, 'an admin reads only');
    const saved = await call(f, 2, 'POST', `/api/decks/proposals/${id}/keep-slides`, { save: true });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(saved.body.deck.slides.map((s: any) => s.spec_id), ['new:title', 'new:solution', 'new:team']);
    assert.equal(saved.body.deck.audience, 'angel');
    assert.equal(saved.body.deck.round.uid, 'round-synthetic-1');
    assert.equal(saved.body.deck.is_current, true);
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM pitch_deck_proposals').get() as any).n, 0);
    assert.deepEqual(f.audits(), ['deck_outline_proposed', 'deck_built', 'deck_cards_kept', 'deck_cards_kept', 'deck_kept']);
  } finally { f.close(); }
});

test('Keep all keeps every card; saving with nothing kept is refused', async () => {
  const f = await fixture();
  try {
    aiOff(f);
    const g = await call(f, 2, 'POST', '/api/decks/generate', { project_id: 1, length: 'short' });
    const id = g.body.proposal.id;
    assert.equal((await call(f, 2, 'POST', `/api/decks/proposals/${id}/keep-slides`, { save: true })).status, 400);
    assert.deepEqual((await call(f, 2, 'POST', `/api/decks/proposals/${id}/keep-slides`, { all: true })).body.proposal.kept, [0, 1, 2, 3, 4, 5]);
    const saved = await call(f, 2, 'POST', `/api/decks/proposals/${id}/keep-slides`, { save: true });
    assert.equal(saved.body.deck.slides.length, 6);
    assert.equal(saved.body.deck.audience, 'seed_fund', 'the fast path is for a seed fund');
  } finally { f.close(); }
});

test('the plan gate and the venture gate', async () => {
  const f = await fixture();
  try {
    assert.equal((await call(f, 3, 'POST', '/api/decks/generate', { project_id: 3 })).status, 402, 'New deck is on the Raise + Grow plan');
    assert.equal((await call(f, 6, 'POST', '/api/decks/generate', { project_id: 1 })).status, 403);
    assert.equal((await call(f, 1, 'POST', '/api/decks/outline', { project_id: 1, audience: 'angel', length: 'short' })).status, 403, 'an admin reads only');
    assert.equal((await call(f, 2, 'POST', '/api/decks/generate', {})).status, 400);
    assert.equal((await call(f, 2, 'POST', '/api/decks/outline', { project_id: 1, audience: 'angel', length: 'short', start: { kind: 'template', id: 'yc_seed' } })).status, 400);
    assert.equal((await call(f, 2, 'POST', '/api/decks/outline', { project_id: 1, audience: 'angel', length: 'short', start: { kind: 'version', deck_id: 999 } })).status, 400);
  } finally { f.close(); }
});

test('PD4: a record the founder unticked is on no card and in no prompt, and the proposal remembers it', async () => {
  const f = await fixture({ cards: { cards: [] } });
  try {
    const r = await call(f, 2, 'POST', '/api/decks/generate', { project_id: 1, length: 'standard', exclude: ['grow.paying_customers'] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const slides = JSON.stringify(r.body.proposal.slides);
    assert.doesNotMatch(slides, /grow\.paying_customers/);
    assert.match(slides, /validate\.interviews/, 'the other records still fill their cards');
    assert.doesNotMatch(f.calls.find((c) => /Write the cards/.test(c.prompt))!.prompt, /Paying customers/);
    assert.deepEqual(r.body.proposal.outline.exclude, ['grow.paying_customers']);
    assert.deepEqual(r.body.progress[4].missing, ['grow.mrr', 'grow.mercury_growth', 'grow.arr']);
    for (const bad of ['grow', ['Grow.MRR'], ['grow.mrr', 'grow.mrr'], 'x'.split('')]) {
      assert.equal((await call(f, 2, 'POST', '/api/decks/generate', { project_id: 1, exclude: bad })).status, 400, JSON.stringify(bad));
    }
  } finally { f.close(); }
});
