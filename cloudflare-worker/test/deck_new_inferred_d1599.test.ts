/**
 * D1599 (#3877): New deck's inferred brief and connector freshness on
 * GET /api/decks/new/context. Synthetic data, the mounted route and the real
 * migrated schema; `fetch` throws. Each case names the mutation it catches.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_new_inferred_d1599.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckNew from '../src/routes/deck_new.ts';
import { BRIEF_RULES, BRIEF_FALLBACK, inferBrief, stageOf } from '../src/services/decks/inferBrief.ts';
import { FRESHNESS_CADENCE_DAYS, PROVIDER_ADAPTERS, staleAt } from '../src/services/decks/freshness.ts';
import { DECK_SOURCES } from '../src/services/decks/sources.ts';
import { AUDIENCES } from '../src/services/decks/slideModel.ts';
import { LENGTH_IDS, FAST_PATH_AUDIENCE } from '../src/services/decks/newDeck.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()
  .map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'deck-new-d1599-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
schema.exec(baseline); for (const sql of migrations) schema.exec(sql); schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const JWT_SECRET = randomBytes(32).toString('hex');
const TODAY = new Date().toISOString().slice(0, 10);
const daysAgo = (d: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - d * 86_400_000).toISOString().slice(0, 10);

/** Founder 2 owns venture 1 in company 10; 4 is an accepted cofounder; 1 is an admin. */
async function fixture() {
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid] of [[1, 'admin', null], [2, 'founder', 100], [4, 'founder', 400]] as const)
    insert.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  db.exec("INSERT INTO company_profiles(id,uid,company_name) VALUES (10,'co-synthetic','Synthetic Co')");
  db.exec("INSERT INTO projects(id,name,founder_id,company_id,stage) VALUES (1,'Synthetic venture',100,10,'validate')");
  db.exec("INSERT INTO user_company_links(uid,company_id,user_id) VALUES ('ucl-2',10,2),('ucl-4',10,4)");
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  await ensureProjectMembershipSchema(env);
  db.exec("INSERT INTO project_members(project_id,user_id,role,status) VALUES (1,4,'cofounder','accepted')");
  const app = new Hono<any>().route('/api/decks', deckNew);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  let next = 1;
  const connect = (provider: string, lastSynced: string | null, opts: { owner?: number; company?: boolean } = {}) => {
    const id = next++;
    db.prepare("INSERT INTO integrations(id,uid,user_id,provider_key,status,auth_type,last_synced_at) VALUES (?,?,?,?, 'active', 'oauth2', ?)").run(id, `int_${provider}_${id}`, opts.owner ?? 2, provider, lastSynced);
    if (opts.company !== false) db.prepare('INSERT INTO integration_companies(integration_id,company_id,enabled) VALUES (?,10,1)').run(id);
    return `int_${provider}_${id}`;
  };
  const round = (target: number | null, instrument: string | null) => {
    db.prepare("INSERT INTO raise_rounds(uid,project_id,name,target_amount,close_date,status) VALUES ('round-1',1,'Synthetic round',?,'2026-12-15','active')").run(target);
    if (instrument) db.prepare(`INSERT INTO round_calls(uid,project_id,name,amount_cents,instrument,terms,terms_hash,minimum_cheque_cents,target_close,created_by)
      VALUES ('call-1',1,'Synthetic call',100000000,?,'Synthetic terms','synthetic-hash',100000,'2026-12-15',2)`).run(instrument);
  };
  return { db, env, app, connect, round, close: () => { globalThis.fetch = real; db.close(); } };
}
type F = Awaited<ReturnType<typeof fixture>>;
async function context(f: F, who = 2, headers: Record<string, string> = { 'X-Company-Id': '10' }) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request('/api/decks/new/context?project_id=1', { headers: { Authorization: `Bearer ${jwt}`, ...headers } }, f.env);
  return { status: res.status, body: await res.json() as any };
}

// ─── inferBrief, pure

test('a Series A venture with a priced $4M round: Series A funds, with a reason', () => {
  // Mutation: delete the priced-round row from BRIEF_RULES.
  const b = inferBrief({ projectStage: 'build', round: { target_amount: 4_000_000, instrument: 'equity' } });
  assert.deepEqual([b.stage, b.audience, b.length, b.round], ['series_a', 'series_a_fund', 'standard', { amount: 4_000_000, instrument: 'equity' }]);
  assert.equal(b.why, 'Series A round, priced: Series A funds.');
  assert.equal(inferBrief({ projectStage: 'series_a', round: null }).audience, 'series_a_fund');
  assert.equal(inferBrief({ projectStage: 'build', round: { target_amount: 3_000_000, instrument: 'equity' } }).audience, 'series_a_fund', '$3M exactly is Series A');
  assert.equal(inferBrief({ projectStage: 'build', round: { target_amount: 2_999_999, instrument: 'equity' } }).audience, 'seed_fund');
});

test('no active round at stage validate: pre-seed, angels, short, and why', () => {
  // Mutation: return seed_fund unconditionally.
  const b = inferBrief({ projectStage: 'validate', round: null });
  assert.deepEqual([b.stage, b.audience, b.length, b.round], ['pre_seed', 'angel', 'short', null]);
  assert.equal(b.why, 'No active round: a short deck for angels.');
  for (const s of ['idea', 'pre_seed', 'Pre-Seed']) assert.equal(inferBrief({ projectStage: s, round: null }).audience, 'angel', s);
});

test('a SAFE or note under $1M, or an early venture with a round: pre-seed funds, short', () => {
  for (const instrument of ['safe', 'convertible_note']) {
    const b = inferBrief({ projectStage: 'build', round: { target_amount: 750_000, instrument } });
    assert.deepEqual([b.stage, b.audience, b.length], ['pre_seed', 'pre_seed_fund', 'short'], instrument);
    assert.ok(b.why.startsWith('Pre-seed round'));
  }
  assert.equal(inferBrief({ projectStage: 'validate', round: { target_amount: null, instrument: null } }).audience, 'pre_seed_fund');
  assert.equal(inferBrief({ projectStage: 'build', round: { target_amount: 1_000_000, instrument: 'safe' } }).audience, 'seed_fund', '$1M on a SAFE is not pre-seed: the fallback');
});

test('a round target of 0 or none is not an amount: null, never 0', () => {
  // Mutation: Number(target) || 0.
  for (const target of [0, null, -5]) {
    const b = inferBrief({ projectStage: 'build', round: { target_amount: target, instrument: 'equity' } });
    assert.equal(b.round!.amount, null, String(target));
    assert.notEqual(b.audience, 'series_a_fund');
  }
});

test('nothing matched: the standard seed deck, and it says so', () => {
  for (const s of [null, 'build', 'launch', 'grow', 'nonsense']) {
    const b = inferBrief({ projectStage: s, round: null });
    assert.deepEqual([b.audience, b.length, b.why], [BRIEF_FALLBACK.audience, BRIEF_FALLBACK.length, 'Not enough recorded to infer; the standard seed deck.'], String(s));
  }
  assert.equal(inferBrief({ projectStage: 'series_b', round: null }).stage, 'later');
});

test('BRIEF_RULES: every row names a real audience and length and a plain why', () => {
  assert.ok(BRIEF_RULES.length >= 4);
  assert.equal(new Set(BRIEF_RULES.map((r) => r.id)).size, BRIEF_RULES.length);
  for (const r of BRIEF_RULES) {
    assert.ok((AUDIENCES as readonly string[]).includes(r.audience), r.id);
    assert.ok(LENGTH_IDS.includes(r.length), r.id);
  }
  assert.deepEqual(BRIEF_RULES.map((r) => r.id), ['series_a', 'seed', 'angel', 'pre_seed']);
  assert.equal(stageOf('Series-A'), 'series_a');
});

// ─── freshness, pure

test('cadence: Stripe is stale after 7 days, not at 7; Carta after 30; an unknown provider after 30; never read is stale', () => {
  // Mutations: Stripe at 30 days; >= instead of > at exactly 7 days.
  assert.equal(staleAt('stripe', daysAgo(10), TODAY), true);
  assert.equal(staleAt('stripe', daysAgo(3), TODAY), false);
  assert.equal(staleAt('stripe', daysAgo(7), TODAY), false);
  assert.equal(staleAt('stripe', daysAgo(8), TODAY), true);
  assert.equal(staleAt('carta', daysAgo(29), TODAY), false);
  assert.equal(staleAt('carta', daysAgo(31), TODAY), true);
  assert.equal(staleAt('posthog', daysAgo(31), TODAY), true);
  assert.equal(staleAt('stripe', null, TODAY), true);
  assert.deepEqual(FRESHNESS_CADENCE_DAYS, { stripe: 7, mercury: 7, carta: 30, github: 7 });
  const ids = new Set(DECK_SOURCES.map((a) => a.id));
  for (const list of Object.values(PROVIDER_ADAPTERS)) for (const id of list) assert.ok(ids.has(id), `adapter ${id} exists`);
});

// ─── the route

test('the route: a priced $4M round reads Series A, and the fast path follows the inferred brief', async () => {
  const f = await fixture();
  try {
    f.round(4_000_000, 'equity');
    const r = await context(f);
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.inferred.audience, r.body.inferred.length, r.body.inferred.stage], ['series_a_fund', 'standard', 'series_a']);
    assert.deepEqual(r.body.fast_path, { audience: 'series_a_fund', length: 'standard' });
    assert.equal(r.body.round.target_amount, 4_000_000, 'the existing round key is unchanged');
  } finally { f.close(); }
});

test('the route: no round at stage validate is angels; every existing key is still there', async () => {
  const f = await fixture();
  try {
    const r = await context(f);
    assert.deepEqual([r.body.inferred.audience, r.body.inferred.stage], ['angel', 'pre_seed']);
    assert.ok(r.body.inferred.why.length > 0);
    assert.deepEqual(r.body.fast_path, { audience: 'angel', length: 'short' });
    for (const k of ['project_id', 'audiences', 'lengths', 'cards', 'standard', 'round', 'averages', 'fast_path', 'prompt_max', 'inferred', 'freshness'])
      assert.ok(k in r.body, k);
    assert.equal(r.body.round, null);
  } finally { f.close(); }
});

test('the route: Stripe synced 10 days ago is stale with its sync path; 3 days ago is not; Carta not connected is absent', async () => {
  const f = await fixture();
  try {
    const uid = f.connect('stripe', `${daysAgo(10)} 09:00:00`);
    let r = await context(f);
    assert.deepEqual(r.body.freshness, [{ provider: 'stripe', as_of: daysAgo(10), stale: true, sync: { method: 'POST', path: `/api/connectors/${uid}/sync` } }]);
    f.db.prepare('UPDATE integrations SET last_synced_at = ?').run(`${daysAgo(3)} 09:00:00`);
    r = await context(f);
    assert.equal(r.body.freshness[0].stale, false);
    // Mutation: listing every provider as stale.
    assert.ok(!r.body.freshness.some((x: any) => x.provider === 'carta'));
  } finally { f.close(); }
});

test('the route: the adapter’s own as_of wins when it is newer than last_synced_at', async () => {
  const f = await fixture();
  try {
    f.connect('stripe', `${daysAgo(20)} 09:00:00`);
    f.db.prepare("INSERT INTO project_metrics(project_id,snapshot_date,source,paying_accounts) VALUES (1,?,'stripe',12)").run(daysAgo(2));
    const r = await context(f);
    assert.deepEqual([r.body.freshness[0].as_of, r.body.freshness[0].stale], [daysAgo(2), false]);
  } finally { f.close(); }
});

test('the route: a connector not switched on for the venture’s company is absent, and nothing starts a sync', async () => {
  const f = await fixture();
  try {
    f.connect('github', `${daysAgo(1)} 09:00:00`, { company: false });
    f.connect('github', `${daysAgo(1)} 09:00:00`, { owner: 4, company: false });
    let r = await context(f);
    assert.deepEqual(r.body.freshness, []);
    // Beside one that is switched on, the switched-off GitHub still does not appear.
    f.connect('stripe', `${daysAgo(1)} 09:00:00`);
    r = await context(f);
    assert.deepEqual(r.body.freshness.map((x: any) => x.provider), ['stripe']);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM integrations WHERE last_synced_at > ?").get(`${daysAgo(1)} 23:59:59`)!.n, 0);
  } finally { f.close(); }
});

test('the route: Mercury is the founder’s own; a cofounder and an admin do not see it at all', async () => {
  // Mutation: dropping the founder check.
  const f = await fixture();
  try {
    f.connect('mercury', `${daysAgo(1)} 09:00:00`, { company: false });
    f.connect('stripe', `${daysAgo(1)} 09:00:00`);
    const founder = await context(f, 2);
    assert.deepEqual(founder.body.freshness.map((x: any) => x.provider).sort(), ['mercury', 'stripe']);
    for (const who of [4, 1]) {
      const r = await context(f, who);
      assert.equal(r.status, 200, String(who));
      assert.deepEqual(r.body.freshness.map((x: any) => x.provider), ['stripe'], `user ${who}`);
    }
  } finally { f.close(); }
});

test('a read that fails leaves its key out: no guessed brief, no empty list, and the seed fallback', async () => {
  // Mutation: answering a guessed `inferred` when the read fails.
  const f = await fixture();
  try {
    const real = f.env.DB;
    f.env.DB = { ...real, prepare(sql: string) {
      if (/SELECT stage FROM projects/.test(sql) || /FROM projects p\s+JOIN integration_companies/.test(sql)) throw new Error('D1_ERROR: synthetic');
      return real.prepare(sql);
    }, batch: (...a: any[]) => real.batch(...a) };
    const s = console.warn; const warned: unknown[] = []; console.warn = (...a: unknown[]) => { warned.push(a); };
    let r;
    try { r = await context(f); } finally { console.warn = s; }
    assert.equal(r.status, 200);
    assert.ok(!('inferred' in r.body));
    assert.ok(!('freshness' in r.body));
    assert.deepEqual(r.body.fast_path, { audience: FAST_PATH_AUDIENCE, length: 'standard' });
    assert.equal(FAST_PATH_AUDIENCE, 'seed_fund');
    assert.equal(JSON.stringify(warned).includes('Synthetic venture'), false, 'logs carry the venture id only');
  } finally { f.close(); }
});

test('nothing is charged and no model runs for the context read', async () => {
  const f = await fixture();
  try {
    f.round(4_000_000, 'equity');
    await context(f);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ai_usage_logs').get()!.n, 0);
  } finally { f.close(); }
});
