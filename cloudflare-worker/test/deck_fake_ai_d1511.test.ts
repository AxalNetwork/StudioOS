/**
 * D1511 (#3762, deck v2 A18) — the fake AI binding (`_fake_ai.mjs`) and the
 * one-click run on it.
 *
 *   1. The binding answers from recorded outputs and injects each failure:
 *      429, 3040, a timeout, a guard block, bad JSON, over-capacity text and a
 *      non-image answer.
 *   2. The one-click run (`POST /api/decks/generate`) on the fake binding, for
 *      a venture whose unrecorded records are unticked: 0 Not recorded
 *      placeholders, 0 fit problems, and a quote at least the settled charge.
 *   3. Each injected failure through the same run: the deck still comes back
 *      or the run is refused, nothing a failed model did is charged, and no
 *      card overflows.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_fake_ai_d1511.test.ts
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
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { fitProblems } from '../src/services/decks/designSystem.ts';
import { readSources } from '../src/services/decks/sources.ts';
import { readImage } from '../src/services/ai/shapes.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { FAILURES, GUARD_MODEL, OVER_CAPACITY, fakeAi } from './_fake_ai.mjs';

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()
  .map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'deck-fake-ai-d1511-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
schema.exec(baseline); for (const sql of migrations) schema.exec(sql); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = 'synthetic-d1511-only-not-a-real-credential'.repeat(2);

async function fixture(ai: any) {
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
  const AI = ai;
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckNew).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const runs = () => db.prepare("SELECT rail_option, charged_microusd, reservation_uid FROM ai_usage_logs WHERE guard_for IS NULL AND task <> 'safety' ORDER BY id").all() as any[];
  const audits = () => (db.prepare("SELECT action FROM activity_logs WHERE entity_type = 'raise.pitch-deck' ORDER BY id").all() as any[]).map((r) => r.action);
  return { db, env, app, runs, audits, close };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, method: string, path: string, json?: unknown, claims: Record<string, unknown> = {}) {
  const jwt = await new SignJWT({ ...claims, user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, ...(json === undefined ? {} : { body: JSON.stringify(json) }) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
/** Recorded words for every card the run's message names: a headline and one sentence, no figure. */
function recordedWords(_model: string, _input: unknown, prompt: string) {
  // D1506 (#3757): the build message frames its cards as record_text (BEGIN_RECORD_TEXT_UNTRUSTED_<nonce> … END_…).
  const m = prompt.match(/Cards:\nBEGIN_RECORD_TEXT_UNTRUSTED_([0-9a-f]+)\n(\[[\s\S]*?\])\nEND_RECORD_TEXT_UNTRUSTED_\1/);
  const cards = m ? JSON.parse(m[2]) : [];
  return { cards: cards.map((c: any) => ({ n: c.n, headline: `${c.title} for finance teams`, body: 'Finance teams asked for it.' })) };
}

/** The Not recorded lines and empty figure tiles a deck draws; the one-click bar wants none. */
const placeholders = (slides: any[]) => slides.flatMap((s) => s.blocks ?? [])
  .filter((b: any) => (b.kind === 'text' && /Not recorded/.test(String(b.text ?? ''))) || (b.kind === 'metric' && (b.value == null || b.value === ''))).length;

/** What the founder unticks on the one-click run: every record the venture has not made. */
async function unrecorded(f: F): Promise<string[]> {
  const { items } = await readSources({ env: f.env, projectId: 1, today: '2026-11-01', mercury: null } as any);
  return [...new Set(items.filter((i: any) => i.state !== 'recorded').map((i: any) => i.source_key as string))]
    .filter((k) => /^[a-z]+\.[a-z0-9_]{1,48}$/.test(k));
}

const BUILD = { project_id: 1, audience: 'seed_fund', length: 'standard' } as const;

// ── 1. The binding ───────────────────────────────────────────────────────

test('1. the fake binding answers from recorded outputs and injects each failure as a real binding gives it', async () => {
  const ok = fakeAi({ answer: () => ({ cards: [{ n: 1, headline: 'Close in a day' }] }) });
  assert.deepEqual(JSON.parse((await ok.run('@cf/fixture/chat', { messages: [] })).response), { cards: [{ n: 1, headline: 'Close in a day' }] });
  assert.equal((await ok.run(GUARD_MODEL, {})).response, 'safe');
  assert.equal(ok.calls.length, 1, 'the guard is counted apart');
  assert.equal(ok.guardCalls.length, 1);

  const err = async (fail: string) => { try { await fakeAi({ fail }).run('@cf/fixture/chat', {}); return null; } catch (e) { return e as any; } };
  assert.equal((await err('rate_limited')).status, 429);
  assert.match((await err('capacity')).message, /\b3040\b/);
  assert.equal((await err('timeout')).name, 'TimeoutError');
  assert.equal((await fakeAi({ fail: 'guard_block' }).run(GUARD_MODEL, {})).response, 'unsafe\nS2');
  const badOut = await fakeAi({ fail: 'bad_json' }).run('@cf/fixture/chat', {});
  assert.throws(() => JSON.parse(badOut.response));
  const over = JSON.parse((await fakeAi({ fail: 'over_capacity_text', answer: () => ({ cards: [{ n: 1, headline: 'x', body: 'y' }] }) }).run('@cf/fixture/chat', {})).response);
  assert.deepEqual(over, { cards: [{ n: 1, headline: OVER_CAPACITY, body: OVER_CAPACITY }] });
  assert.ok(OVER_CAPACITY.length > 400 && !/\d/.test(OVER_CAPACITY));
  const notImage = await fakeAi({ fail: 'non_image', answer: () => new Uint8Array([137, 80, 78, 71]) }).run('@cf/fixture/image', {});
  assert.equal(typeof notImage.response, 'string');
  assert.equal(notImage.image, undefined);
  assert.equal((await fakeAi({ answer: () => new Uint8Array([1, 2]) }).run('@cf/fixture/image', {})).image, 'AQI=');
  // Only the failOn-th call fails; the rest answer.
  const second = fakeAi({ fail: 'rate_limited', failOn: 2 });
  await second.run('@cf/fixture/chat', {});
  await assert.rejects(second.run('@cf/fixture/chat', {}));
  await second.run('@cf/fixture/chat', {});
  assert.equal(second.calls.length, 3, 'the third call answers again');
  assert.throws(() => fakeAi({ fail: 'meteor' }));
});

// ── 2. The one-click run ─────────────────────────────────────────────────

test('2. the one-click run on the fake binding: no placeholder, no fit problem, and a quote at least the settled charge', async () => {
  const ai = fakeAi({ answer: recordedWords });
  const f = await fixture(ai);
  try {
    const exclude = await unrecorded(f);
    const q = await call(f, 2, 'POST', '/api/decks/new/quote', { ...BUILD, step: 'build', exclude });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    const g = await call(f, 2, 'POST', '/api/decks/generate', { ...BUILD, exclude });
    assert.equal(g.status, 201, JSON.stringify(g.body));
    assert.equal(g.body.wording.by, 'Eadwyn');
    const slides = g.body.proposal.slides;
    assert.equal(slides.length, 12);
    assert.equal(placeholders(slides), 0, 'no Not recorded placeholder');
    assert.deepEqual(fitProblems(slides.filter((s: any) => !s.appendix)), [], 'no fit or overflow problem');
    assert.ok(g.body.cost.charged_microusd > 0, 'the run was charged');
    assert.ok(q.body.hold_microusd >= g.body.cost.charged_microusd, `quote ${q.body.hold_microusd} ≥ charge ${g.body.cost.charged_microusd}`);
    assert.equal(ai.calls.length, 1, 'one model run');
  } finally { f.close(); }
});

// ── 3. Each failure through the run ──────────────────────────────────────

test('3. a model that fails (429, 3040, a timeout) on every try leaves the deck from records, with nothing charged', async () => {
  for (const fail of ['rate_limited', 'capacity', 'timeout']) {
    const ai = fakeAi({ answer: recordedWords, fail, failOn: 'every' });
    const f = await fixture(ai);
    try {
      const g = await call(f, 2, 'POST', '/api/decks/generate', BUILD);
      assert.equal(g.status, 201, `${fail}: ${JSON.stringify(g.body)}`);
      assert.equal(g.body.wording.by, 'none', fail);
      assert.match(g.body.wording.reason, /Nothing was charged/, fail);
      assert.equal(g.body.cost.charged_microusd, 0, fail);
      assert.ok(ai.calls.length >= 1, fail);
      assert.deepEqual(fitProblems(g.body.proposal.slides.filter((s: any) => !s.appendix)), [], fail);
    } finally { f.close(); }
  }
});

test('3. a guard block refuses the run before any model, and holds nothing', async () => {
  const ai = fakeAi({ answer: recordedWords, fail: 'guard_block' });
  const f = await fixture(ai);
  try {
    const g = await call(f, 2, 'POST', '/api/decks/generate', BUILD);
    assert.equal(g.status, 422);
    assert.equal(g.body.error, 'guard_blocked');
    assert.equal(ai.calls.length, 0, 'no model ran');
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM pitch_deck_proposals').get() as any).n, 0);
  } finally { f.close(); }
});

test('3. bad JSON leaves the cards their titles; over-capacity words never overflow a card', async () => {
  const bad = fakeAi({ answer: recordedWords, fail: 'bad_json' });
  let f = await fixture(bad);
  try {
    const g = await call(f, 2, 'POST', '/api/decks/generate', BUILD);
    assert.equal(g.status, 201);
    assert.equal(g.body.wording.by, 'none');
    assert.match(g.body.wording.reason, /could not be read/);
  } finally { f.close(); }
  const over = fakeAi({ answer: recordedWords, fail: 'over_capacity_text' });
  f = await fixture(over);
  try {
    const g = await call(f, 2, 'POST', '/api/decks/generate', BUILD);
    assert.equal(g.status, 201, JSON.stringify(g.body));
    const slides = g.body.proposal.slides.filter((s: any) => !s.appendix);
    assert.deepEqual(fitProblems(slides), [], 'the long words were moved, shortened or dropped');
    for (const s of slides) for (const b of s.blocks ?? []) assert.notEqual(b.text, OVER_CAPACITY, 'an over-capacity string is never drawn whole');
  } finally { f.close(); }
});

test('3. an image model answering words is no image: the router reads none, so the run fails as an unexpected answer', async () => {
  const ai = fakeAi({ fail: 'non_image', answer: () => new Uint8Array([137, 80, 78, 71]) });
  assert.equal(await readImage(await ai.run('@cf/fixture/image', {}), { width: 1024, height: 768 }), null);
  const fine = fakeAi({ answer: () => new Uint8Array([137, 80, 78, 71]) });
  assert.ok(await readImage(await fine.run('@cf/fixture/image', {}), { width: 1024, height: 768 }), 'the recorded image is read');
});

test('3. every failure the binding knows is covered here', () => {
  assert.deepEqual([...FAILURES].sort(), ['bad_json', 'capacity', 'guard_block', 'non_image', 'over_capacity_text', 'rate_limited', 'timeout']);
});
