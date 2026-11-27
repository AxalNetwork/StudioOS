/**
 * D4606 (#4606) — accepting an introduction: the debit is atomic per bucket,
 * retried safely when it loses a race, never double-spent, and fails with a
 * reason that says which of insufficient credit, already handled or conflict.
 * Synthetic records only.
 *
 * Run via the strip-types loader (see package.json test:drift).
 */
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { acceptIntroProposition, getIntroCreditState } from '../src/services/introductions.ts';
import type { Env } from '../src/types';

function makeEnv(): { env: Env; raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, email TEXT,
      role TEXT NOT NULL DEFAULT 'founder', is_active INTEGER DEFAULT 1, email_verified INTEGER DEFAULT 0,
      display_name TEXT, notification_prefs TEXT);
    CREATE TABLE referrals (id INTEGER PRIMARY KEY AUTOINCREMENT, referrer_id INTEGER NOT NULL,
      referred_id INTEGER NOT NULL UNIQUE, referral_code TEXT, status TEXT NOT NULL DEFAULT 'pending');
  `);
  for (const f of ['097_stripe_products.sql', '691_stripe_mode_stamps.sql']) {
    db.exec(readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8'));
  }
  let chain: Promise<unknown> = Promise.resolve();
  const DB = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const expand = () => {
        if (!/\?\d+/.test(sql)) return { sql, args: bound };
        const args: unknown[] = [];
        const rewritten = sql.replace(/\?(\d+)/g, (_m, n) => { args.push(bound[Number(n) - 1]); return '?'; });
        return { sql: rewritten, args };
      };
      const stmt = {
        bind(...vals: unknown[]) { bound = vals; return stmt; },
        async run() { const { sql: q, args } = expand(); const info = db.prepare(q).run(...(args as any[])); return { success: true, meta: { changes: Number(info.changes) } } as any; },
        async first<T = any>() { const { sql: q, args } = expand(); return (db.prepare(q).get(...(args as any[])) ?? null) as T | null; },
        async all<T = any>() { const { sql: q, args } = expand(); return { results: db.prepare(q).all(...(args as any[])) as T[] } as any; },
      };
      return stmt;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 } as any; },
    // D1 runs a batch as one transaction and one at a time; a chain models that.
    async batch(stmts: any[]) {
      const run = async () => {
        db.exec('BEGIN');
        try { const out = [] as any[]; for (const s of stmts) out.push(await s.run()); db.exec('COMMIT'); return out; }
        catch (e) { db.exec('ROLLBACK'); throw e; }
      };
      const mine = chain.then(run, run);
      chain = mine.then(() => undefined, () => undefined);
      return mine;
    },
  };
  return { env: { DB } as unknown as Env, raw: db };
}


/** Hold every batch until `n` requests have read their credit state, so they race for real. */
function raceAt(env: Env, n = 2) {
  const orig = (env as any).DB.batch.bind((env as any).DB);
  let waiting = 0; let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let first = true;
  (env as any).DB.batch = async (stmts: any[]) => {
    if (first) { waiting += 1; if (waiting >= n) { first = false; release(); } await gate; }
    return orig(stmts);
  };
}

const user = { id: 1, role: 'founder', subscription_tier: 'free' } as any;

async function seed(env: Env, raw: DatabaseSync, { allowance, purchased = 0, referral = 0, props = 2 }: { allowance: number; purchased?: number; referral?: number; props?: number }) {
  raw.prepare(`INSERT INTO users (id, uid, name, role) VALUES (1, 'u1', 'A', 'founder')`).run();
  await getIntroCreditState(env, user); // plants the month's grant (3 on free)
  raw.prepare(`DELETE FROM intro_credit_ledger`).run();
  const month = new Date().toISOString().slice(0, 7);
  const put = (delta: number, bucket: string, kind: string, ref: string) =>
    raw.prepare(`INSERT INTO intro_credit_ledger (user_id, delta, bucket, kind, source_ref) VALUES (1, ?, ?, ?, ?)`).run(delta, bucket, kind, ref);
  put(allowance, 'allowance', 'monthly_grant', `month:${month}`); // always planted, so a read never re-grants
  if (purchased) put(purchased, 'purchased', 'purchase', 'pi:seed');
  if (referral) put(referral, 'referral', 'referral_reward', 'referral:seed');
  for (let i = 1; i <= props; i += 1) {
    raw.prepare(`INSERT INTO intro_propositions (uid, user_id, target_user_id, status) VALUES (?, 1, ?, 'pending')`).run(`p${i}`, 100 + i);
  }
}
const bucketSums = (raw: DatabaseSync) => Object.fromEntries(
  (raw.prepare(`SELECT bucket, SUM(delta) AS s FROM intro_credit_ledger GROUP BY bucket`).all() as any[]).map((r) => [r.bucket, Number(r.s)]));
const spends = (raw: DatabaseSync) => Number((raw.prepare(`SELECT COUNT(*) AS n FROM intro_credit_ledger WHERE kind = 'spend'`).get() as any).n);

test('concurrent acceptances for different propositions never make a bucket negative: the loser spends the next bucket', async () => {
  const { env, raw } = makeEnv();
  await seed(env, raw, { allowance: 1, purchased: 5 });
  raceAt(env);
  const [a, b] = await Promise.all([acceptIntroProposition(env, user, 'p1'), acceptIntroProposition(env, user, 'p2')]);
  assert.equal(a.ok && b.ok, true);
  assert.deepEqual([a, b].map((x: any) => x.bucket).sort(), ['allowance', 'purchased']);
  assert.deepEqual(bucketSums(raw), { allowance: 0, purchased: 4 });
  const after = await getIntroCreditState(env, user);
  assert.equal(after.balance, 4, 'the shown balance is what can still be spent');
});

test('concurrent acceptances on the last credit: one succeeds, the other is insufficient credit, nothing goes negative', async () => {
  const { env, raw } = makeEnv();
  await seed(env, raw, { allowance: 1 });
  raceAt(env);
  const [a, b] = await Promise.all([acceptIntroProposition(env, user, 'p1'), acceptIntroProposition(env, user, 'p2')]);
  const oks = [a, b].filter((x) => x.ok);
  const fails = [a, b].filter((x) => !x.ok) as any[];
  assert.equal(oks.length, 1);
  assert.deepEqual([fails[0].status, fails[0].error], [402, 'no_credits']);
  assert.deepEqual(bucketSums(raw), { allowance: 0 });
  assert.equal((raw.prepare(`SELECT COUNT(*) AS n FROM intro_propositions WHERE status = 'pending'`).get() as any).n, 1, 'the loser stays pending');
});

test('repeating or racing the same proposition debits once and says it was already handled', async () => {
  const { env, raw } = makeEnv();
  await seed(env, raw, { allowance: 3 });
  raceAt(env);
  const [a, b] = await Promise.all([acceptIntroProposition(env, user, 'p1'), acceptIntroProposition(env, user, 'p1')]);
  assert.equal([a, b].filter((x) => x.ok).length, 1);
  const lost = [a, b].find((x) => !x.ok) as any;
  assert.deepEqual([lost.status, lost.error, lost.proposition_status], [409, 'already_responded', 'accepted']);
  const again = await acceptIntroProposition(env, user, 'p1') as any;
  assert.equal(again.error, 'already_responded');
  assert.equal(spends(raw), 1);
  assert.deepEqual(bucketSums(raw), { allowance: 2 });
});

test('a proposition is accepted only with its debit: no spend row, no accepted status', async () => {
  const { env, raw } = makeEnv();
  await seed(env, raw, { allowance: 0, purchased: 0 });
  const r = await acceptIntroProposition(env, user, 'p1') as any;
  assert.deepEqual([r.ok, r.status, r.error], [false, 402, 'no_credits']);
  assert.equal((raw.prepare(`SELECT status FROM intro_propositions WHERE uid = 'p1'`).get() as any).status, 'pending');
  assert.equal(spends(raw), 0);
  const missing = await acceptIntroProposition(env, user, 'nope') as any;
  assert.deepEqual([missing.status, missing.error], [404, 'not_found']);
});

test('a debit that keeps losing is a retryable conflict, not "already handled" and not "no credits"', async () => {
  const { env, raw } = makeEnv();
  await seed(env, raw, { allowance: 0, purchased: 1 });
  // The read sees one purchased credit, but another request always takes it before the debit lands.
  const orig = (env as any).DB.batch.bind((env as any).DB);
  (env as any).DB.batch = async (stmts: any[]) => {
    raw.prepare(`UPDATE intro_credit_ledger SET delta = 0 WHERE source_ref = 'pi:seed'`).run();
    try { return await orig(stmts); } finally { raw.prepare(`UPDATE intro_credit_ledger SET delta = 1 WHERE source_ref = 'pi:seed'`).run(); }
  };
  const r = await acceptIntroProposition(env, user, 'p1') as any;
  assert.deepEqual([r.ok, r.status, r.error, r.retryable], [false, 409, 'credit_conflict', true]);
  assert.equal((raw.prepare(`SELECT status FROM intro_propositions WHERE uid = 'p1'`).get() as any).status, 'pending');
  assert.equal(spends(raw), 0, 'nothing was spent');
});

test('month rollover: last month\'s spends stay on last month; the new month starts from its own grant', async () => {
  const { env, raw } = makeEnv();
  raw.prepare(`INSERT INTO users (id, uid, name, role) VALUES (1, 'u1', 'A', 'founder')`).run();
  await getIntroCreditState(env, user);
  raw.prepare(`DELETE FROM intro_credit_ledger`).run();
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12)).toISOString().replace('T', ' ').slice(0, 19);
  const prevKey = prev.slice(0, 7);
  raw.prepare(`INSERT INTO intro_credit_ledger (user_id, delta, bucket, kind, source_ref, created_at) VALUES (1, 3, 'allowance', 'monthly_grant', ?, ?)`).run(`month:${prevKey}`, prev);
  for (let i = 0; i < 3; i += 1) raw.prepare(`INSERT INTO intro_credit_ledger (user_id, delta, bucket, kind, source_ref, created_at) VALUES (1, -1, 'allowance', 'spend', ?, ?)`).run(`intro:old${i}`, prev);
  raw.prepare(`INSERT INTO intro_propositions (uid, user_id, target_user_id, status) VALUES ('p1', 1, 101, 'pending')`).run();
  const state = await getIntroCreditState(env, user);
  assert.equal(state.allowance_remaining, 3, 'a new month is its own grant, untouched by last month\'s spends');
  const r = await acceptIntroProposition(env, user, 'p1') as any;
  assert.equal(r.ok, true);
  assert.equal(r.credits.allowance_remaining, 2);
  const lastMonthNet = Number((raw.prepare(`SELECT SUM(delta) AS s FROM intro_credit_ledger WHERE bucket = 'allowance' AND strftime('%Y-%m', created_at) = ?`).get(prevKey) as any).s);
  assert.equal(lastMonthNet, 0, 'last month still nets to zero');
});

test('bucket boundaries: the exact last credit of each bucket spends, and the next bucket takes over', async () => {
  const { env, raw } = makeEnv();
  await seed(env, raw, { allowance: 1, referral: 1, purchased: 1, props: 4 });
  const order: string[] = [];
  for (const uid of ['p1', 'p2', 'p3']) order.push(((await acceptIntroProposition(env, user, uid)) as any).bucket);
  assert.deepEqual(order, ['allowance', 'referral', 'purchased']);
  assert.deepEqual(bucketSums(raw), { allowance: 0, referral: 0, purchased: 0 });
  assert.equal(((await acceptIntroProposition(env, user, 'p4')) as any).error, 'no_credits');
});
