/**
 * D1017 (#2854) — Cap table part 2: the record (migration 573). Issuances,
 * share classes, outstanding and fully diluted, proposals, record and void,
 * the admin's reason, the history read and a currency per venture.
 *
 * Run on a database built from the baseline and every migration, as
 * production builds it; 573 is applied whole and must apply.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cap_table_record_d1017.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import captable from '../src/routes/captable.ts';
import { acceptProposal, recordFromSource } from '../src/services/capTableRecord.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const RECORD = '573_cap_table_record.sql';
const JWT_SECRET = 'unit-test-jwt-secret-d1017-0123456789';

// 1 admin · 2 partner (unrelated) · 3 investor member · 4 owner · 5 co-founder · 6 advisor
// 7 co-founder on the free plan · 8 a member whose recorded role is owner · 9 another venture's founder
const USERS: Array<[number, string, number | null, string]> = [
  [1, 'admin', null, 'studio'], [2, 'partner', null, 'studio'], [3, 'investor', null, 'studio'], [4, 'founder', 40, 'studio'],
  [5, 'founder', 50, 'studio'], [6, 'advisor', null, 'studio'], [7, 'founder', 70, 'free'], [8, 'founder', 80, 'studio'], [9, 'founder', 90, 'studio'],
];
const ADMIN = 1, PARTNER = 2, INVESTOR = 3, OWNER = 4, COFOUNDER = 5, ADVISOR = 6, FREE = 7, MEMBER_OWNER = 8, OTHER = 9;

function built(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql') && x !== RECORD).sort(compareMigrations)
    .filter((x) => migrationNumber(x) > BASELINE_CUTOFF)) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  // Whole, as the deploy applies it: a failure here fails the file.
  db.exec(readFileSync(resolve(MIGRATIONS, RECORD), 'utf8'));
  return db;
}
const BUILT = built();

function fresh() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const objs = BUILT.prepare(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[];
  for (const o of objs) { try { db.exec(o.sql); } catch { /* views and triggers naming absent objects */ } }
  db.exec('PRAGMA foreign_keys = OFF');
  for (const [id, role, founder, tier] of USERS) {
    db.prepare('INSERT INTO users (id, uid, email, name, role, founder_id, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
      .run(id, `u-${id}`, `person${id}@example.test`, `Person ${id}`, role, founder, tier);
  }
  db.exec(`INSERT INTO projects (id, uid, name, founder_id) VALUES (10, 'p-10', 'Synthetic Venture', 40), (20, 'p-20', 'Other Venture', 90);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES
      (10, ${COFOUNDER}, 'cofounder', 'accepted'), (10, ${ADVISOR}, 'advisor', 'accepted'), (10, ${INVESTOR}, 'cofounder', 'accepted'),
      (10, ${FREE}, 'cofounder', 'accepted'), (10, ${MEMBER_OWNER}, 'owner', 'accepted');
    INSERT INTO cap_table_holders (id, user_id, project_id, name) VALUES (101, ${OWNER}, 10, 'Ada Founder'), (201, ${OTHER}, 20, 'Elsewhere');`);
  return { db, env: { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any };
}

async function call(f: any, id: number, path: string, method = 'GET', body?: unknown) {
  const token = await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await captable.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, f.env);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, body: json, text };
}
const one = (f: any, sql: string, ...args: any[]) => f.db.prepare(sql).get(...args) as any;
const audits = (f: any, action: string, uid?: string) =>
  one(f, `SELECT COUNT(*) AS n FROM activity_logs WHERE action = ?${uid ? ' AND entity_id = ?' : ''}`, ...(uid ? [action, uid] : [action])).n;

async function classes(f: any) {
  const common = (await call(f, OWNER, '/record/10/classes', 'POST', { name: 'Common', kind: 'common' })).body.class;
  const prefA = (await call(f, OWNER, '/record/10/classes', 'POST', { name: 'Series A Preferred', kind: 'preferred', price_per_share_micros: 2_500_000 })).body.class;
  const pool = (await call(f, OWNER, '/record/10/classes', 'POST', { name: '2026 Plan', kind: 'option_pool', authorized_shares: 1000 })).body.class;
  return { common, prefA, pool };
}

async function record(f: any, body: Record<string, unknown>, who = OWNER) {
  const r = await call(f, who, '/record/10/issuances', 'POST', body);
  assert.equal(r.status, 201, r.text);
  return r.body.issuance;
}

/** The worked example: every share kind, a SAFE and a note, with the totals done by hand below. */
async function worked(f: any) {
  const c = await classes(f);
  const day = '2026-01-15';
  await record(f, { kind: 'founding', holder_id: 101, class_uid: c.common.uid, shares: 8000, issued_on: day });
  await record(f, { kind: 'founding', holder_name: 'Bo Cofounder', class_uid: c.common.uid, shares: 2000, issued_on: day });
  await record(f, { kind: 'grant', holder_name: 'Cy Engineer', class_uid: c.pool.uid, shares: 300, issued_on: '2026-02-01' });
  await record(f, { kind: 'exercise', holder_name: 'Cy Engineer', class_uid: c.common.uid, from_class_uid: c.pool.uid, shares: 100, issued_on: '2026-03-01' });
  await record(f, { kind: 'priced', holder_name: 'Fund One', class_uid: c.prefA.uid, shares: 1000, price_per_share_micros: 2_500_000, amount_cents: 250_000, issued_on: '2026-04-01' });
  const transfer = await record(f, { kind: 'transfer', holder_name: 'Di Angel', from_holder_id: 101, class_uid: c.common.uid, shares: 500, issued_on: '2026-05-01' });
  const safe = await record(f, { kind: 'safe', holder_name: 'Early Angel', amount_cents: 2_500_000, cap_cents: 500_000_000, basis: 'post_money', discount_bps: 2000, mfn: true, issued_on: '2026-06-01' });
  await record(f, { kind: 'note', holder_name: 'Bridge Lender', amount_cents: 1_000_000, interest_bps: 800, maturity_on: '2027-06-01' });
  return { ...c, transfer, safe };
}

test('573 applies whole on the full chain, and its checks hold', () => {
  for (const t of ['cap_table_issuances', 'cap_table_share_classes', 'cap_table_currency']) {
    assert.ok(BUILT.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t), t);
  }
  const f = fresh();
  try {
    assert.throws(() => f.db.exec(`INSERT INTO cap_table_issuances (project_id, kind, holder_name, source, origin, status) VALUES (10, 'safe', 'X', 'typed', 'owner', 'void')`), /CHECK/, 'a void row carries its reason');
    assert.throws(() => f.db.exec(`INSERT INTO cap_table_issuances (project_id, kind, source, origin) VALUES (10, 'safe', 'typed', 'owner')`), /CHECK/, 'a row names its holder');
    assert.throws(() => f.db.exec(`INSERT INTO cap_table_currency (project_id, currency) VALUES (10, 'usd')`), /CHECK/);
  } finally { f.db.close(); }
});

test('an empty record says nothing is recorded, never 0', async () => {
  const f = fresh();
  try {
    const r = await call(f, OWNER, '/record/10');
    assert.equal(r.status, 200, r.text);
    for (const k of ['by_holder', 'by_class', 'outstanding', 'fully_diluted']) {
      assert.equal(r.body[k].available, false, k);
      assert.equal(r.body[k].reason, 'nothing_recorded', k);
      assert.equal('shares' in r.body[k], false, `${k} carries no number`);
    }
    assert.deepEqual(r.body.currency, { code: 'USD', source: 'default' });
    assert.deepEqual(r.body.instruments.rows, []);
  } finally { f.db.close(); }
});

test('outstanding and fully diluted, by holder and by class, worked by hand; SAFEs and notes never added', async () => {
  const f = fresh();
  try {
    const w = await worked(f);
    const r = (await call(f, OWNER, '/record/10')).body;
    // Common: Ada 8000 − 500 = 7500, Bo 2000, Di 500, Cy 100 (exercised) = 10100. Preferred: Fund One 1000.
    assert.deepEqual(r.outstanding, { available: true, reason: null, shares: 11100, common: 10100, preferred: 1000 });
    // Options: Cy 300 granted − 100 exercised = 200. Pool: 1000 − 200 − 100 = 700 unallocated.
    assert.deepEqual(r.fully_diluted, { available: true, reason: null, shares: 12000, outstanding: 11100, options_granted: 200, unallocated_pool: 700, pool_recorded: true });
    const holders = Object.fromEntries(r.by_holder.rows.map((h: any) => [h.name, [h.shares, h.options]]));
    assert.deepEqual(holders, { 'Ada Founder': [7500, 0], 'Bo Cofounder': [2000, 0], 'Cy Engineer': [100, 200], 'Fund One': [1000, 0], 'Di Angel': [500, 0] });
    assert.equal(r.by_holder.rows.find((h: any) => h.name === 'Ada Founder').holder_id, 101);
    const cls = Object.fromEntries(r.by_class.rows.map((c: any) => [c.name, [c.issued, c.options_granted, c.options_exercised, c.unallocated]]));
    assert.deepEqual(cls, { Common: [10100, null, null, null], 'Series A Preferred': [1000, null, null, null], '2026 Plan': [null, 200, 100, 700] });
    // The SAFE and the note are listed with their terms, and in no count.
    assert.deepEqual(r.instruments.rows.map((i: any) => [i.kind, i.amount_cents, i.currency]), [['safe', 2_500_000, 'USD'], ['note', 1_000_000, 'USD']]);
    const safe = r.instruments.rows[0];
    assert.deepEqual(safe.terms, { cap_cents: 500_000_000, discount_bps: 2000, basis: 'post_money', mfn: true, interest_bps: null, maturity_on: null });
    assert.equal(r.by_holder.rows.some((h: any) => h.name === 'Early Angel' || h.name === 'Bridge Lender'), false);
    assert.equal(r.instruments.rows[1].issued_on, null, 'a note with no date reads Not recorded');
    assert.equal(r.issuances.rows.length, 8);
    void w;
  } finally { f.db.close(); }
});

test('a pool with no size recorded, or overgranted, leaves fully diluted unavailable with its reason', async () => {
  const f = fresh();
  try {
    const c = await classes(f);
    await record(f, { kind: 'founding', holder_id: 101, class_uid: c.common.uid, shares: 100, issued_on: '2026-01-01' });
    await record(f, { kind: 'grant', holder_name: 'Cy', class_uid: c.pool.uid, shares: 900, issued_on: '2026-01-02' });
    assert.equal((await call(f, OWNER, `/record/10/classes/${c.pool.uid}`, 'PATCH', { authorized_shares: 800 })).status, 200);
    let r = (await call(f, OWNER, '/record/10')).body;
    assert.equal(r.outstanding.shares, 100);
    assert.deepEqual([r.fully_diluted.available, r.fully_diluted.reason], [false, 'pool_overgranted']);
    assert.equal((await call(f, OWNER, `/record/10/classes/${c.pool.uid}`, 'PATCH', { authorized_shares: null })).status, 200);
    r = (await call(f, OWNER, '/record/10')).body;
    assert.deepEqual([r.fully_diluted.available, r.fully_diluted.reason], [false, 'pool_size_not_recorded']);
    assert.equal('shares' in r.fully_diluted, false);
    assert.equal((await call(f, OWNER, `/record/10/classes/${c.pool.uid}`, 'PATCH', { kind: 'common' })).body.error, 'bad_kind');
    assert.equal((await call(f, OWNER, '/record/10/classes', 'POST', { name: 'Common', kind: 'common' })).status, 409);
  } finally { f.db.close(); }
});

test('who may read and write: the venture gate, the plan, and only the owner records', async () => {
  const f = fresh();
  try {
    for (const id of [PARTNER, INVESTOR, OTHER]) {
      assert.equal((await call(f, id, '/record/10')).status, 403, `${id} read`);
      assert.equal((await call(f, id, '/record/10/proposals', 'POST', { kind: 'safe', holder_name: 'X' })).status, 403, `${id} propose`);
    }
    assert.equal((await call(f, ADVISOR, '/record/10')).status, 200);
    assert.equal((await call(f, ADVISOR, '/record/10/history')).status, 200);
    assert.equal((await call(f, ADVISOR, '/record/10/proposals', 'POST', { kind: 'safe', holder_name: 'X' })).status, 403, 'an advisor reads only');
    assert.equal((await call(f, FREE, '/record/10/proposals', 'POST', { kind: 'safe', holder_name: 'X' })).status, 402, 'writes are on Raise + Grow');
    assert.equal((await call(f, OWNER, '/record/999')).status, 404);

    const c = await classes(f);
    const body = { kind: 'founding', holder_name: 'Bo Cofounder', class_uid: c.common.uid, shares: 2000, issued_on: '2026-01-15' };
    const direct = await call(f, COFOUNDER, '/record/10/issuances', 'POST', body);
    assert.equal(direct.status, 403);
    assert.equal(direct.body.error, 'owner_records');
    for (const path of ['/record/10/classes', '/record/10/currency']) {
      assert.equal((await call(f, COFOUNDER, path, path.endsWith('currency') ? 'PUT' : 'POST', { name: 'B', kind: 'common', currency: 'EUR' })).body.error, 'owner_records', path);
    }

    // A co-founder proposes; nothing counts until the owner accepts.
    const p = await call(f, COFOUNDER, '/record/10/proposals', 'POST', body);
    assert.equal(p.status, 201, p.text);
    assert.equal(p.body.issuance.status, 'proposed');
    assert.equal(p.body.issuance.origin, 'cofounder');
    let r = (await call(f, OWNER, '/record/10')).body;
    assert.equal(r.outstanding.available, false);
    assert.deepEqual(r.proposals.rows.map((x: any) => x.uid), [p.body.issuance.uid]);
    assert.equal((await call(f, COFOUNDER, `/record/10/proposals/${p.body.issuance.uid}/accept`, 'POST', {})).body.error, 'owner_records');
    assert.equal((await call(f, COFOUNDER, `/record/10/proposals/${p.body.issuance.uid}/dismiss`, 'POST', {})).body.error, 'owner_records');
    assert.ok(one(f, `SELECT id FROM activity_logs WHERE user_id = ${COFOUNDER} AND action = 'captable_member_write_authorized'`));

    const ok = await call(f, OWNER, `/record/10/proposals/${p.body.issuance.uid}/accept`, 'POST', {});
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.issuance.status, 'recorded');
    assert.equal(ok.body.issuance.recorded_by, OWNER);
    r = (await call(f, OWNER, '/record/10')).body;
    assert.equal(r.outstanding.shares, 2000);
    assert.equal(audits(f, 'captable.proposal.accepted', p.body.issuance.uid), 1, 'one audit row');
    const again = await call(f, OWNER, `/record/10/proposals/${p.body.issuance.uid}/accept`, 'POST', {});
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'not_proposed');
    assert.equal(audits(f, 'captable.proposal.accepted', p.body.issuance.uid), 1, 'a second Accept writes no audit row');

    // A second Accept that read the row before the first one landed: the guarded
    // UPDATE changes nothing, and its audit row is not written.
    const race = (await call(f, COFOUNDER, '/record/10/proposals', 'POST', { ...body, holder_name: 'Racer' })).body.issuance;
    const prepare = f.env.DB.prepare.bind(f.env.DB);
    const stale = await prepare(`SELECT i.*, NULL AS holder_row_name, NULL AS from_holder_row_name FROM cap_table_issuances i WHERE i.uid = ?`).bind(race.uid).first();
    assert.equal((await call(f, OWNER, `/record/10/proposals/${race.uid}/accept`, 'POST', {})).status, 200);
    const staleEnv = { ...f.env, DB: { ...f.env.DB, batch: f.env.DB.batch.bind(f.env.DB),
      prepare: (sql: string) => (sql.includes('LEFT JOIN cap_table_holders h') ? { bind: () => ({ all: async () => ({ results: [stale] }) }) } : prepare(sql)) } };
    await assert.rejects(() => acceptProposal(staleEnv as any, 10, { id: OWNER, role: 'owner' }, race.uid, {}), (e: any) => e.code === 'not_proposed');
    assert.equal(audits(f, 'captable.proposal.accepted', race.uid), 1);

    // A member whose recorded role is owner records too.
    assert.equal((await call(f, MEMBER_OWNER, '/record/10/issuances', 'POST', { ...body, holder_name: 'Member Owner' })).status, 201);
  } finally { f.db.close(); }
});

test('Dismiss keeps the proposal in the history; Accept may fill what the proposal left empty', async () => {
  const f = fresh();
  try {
    const c = await classes(f);
    const p1 = (await call(f, COFOUNDER, '/record/10/proposals', 'POST', { kind: 'priced', holder_name: 'Fund One', class_uid: c.prefA.uid })).body.issuance;
    const missing = await call(f, OWNER, `/record/10/proposals/${p1.uid}/accept`, 'POST', {});
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error, 'incomplete');
    assert.deepEqual(missing.body.missing, ['issued_on', 'shares', 'price_per_share_micros']);
    assert.equal(one(f, 'SELECT status FROM cap_table_issuances WHERE uid = ?', p1.uid).status, 'proposed');
    const filled = await call(f, OWNER, `/record/10/proposals/${p1.uid}/accept`, 'POST', { shares: 1000, price_per_share_micros: 2_500_000, issued_on: '2026-04-01' });
    assert.equal(filled.status, 200, filled.text);
    assert.equal(filled.body.issuance.shares, 1000);

    const p2 = (await call(f, COFOUNDER, '/record/10/proposals', 'POST', { kind: 'safe', holder_name: 'Maybe Angel', amount_cents: 100 })).body.issuance;
    const d = await call(f, OWNER, `/record/10/proposals/${p2.uid}/dismiss`, 'POST', { reason: 'Not ours' });
    assert.equal(d.status, 200);
    assert.deepEqual([d.body.issuance.status, d.body.issuance.dismiss_reason], ['dismissed', 'Not ours']);
    assert.equal(audits(f, 'captable.proposal.dismissed', p2.uid), 1);
    assert.equal((await call(f, OWNER, `/record/10/proposals/${p2.uid}/dismiss`, 'POST', {})).status, 409);
    const r = (await call(f, OWNER, '/record/10')).body;
    assert.deepEqual(r.proposals.rows, []);
    assert.equal(r.instruments.rows.length, 0, 'a dismissed SAFE is not on record');
  } finally { f.db.close(); }
});

test('void keeps the row with its required reason and takes it out of the counts', async () => {
  const f = fresh();
  try {
    const w = await worked(f);
    const noReason = await call(f, OWNER, `/record/10/issuances/${w.transfer.uid}/void`, 'POST', {});
    assert.equal(noReason.status, 400);
    assert.equal(noReason.body.error, 'reason_required');
    const v = await call(f, OWNER, `/record/10/issuances/${w.transfer.uid}/void`, 'POST', { reason: 'Transfer was never signed' });
    assert.equal(v.status, 200, v.text);
    assert.deepEqual([v.body.issuance.status, v.body.issuance.void_reason, v.body.issuance.voided_by], ['void', 'Transfer was never signed', OWNER]);
    assert.equal(audits(f, 'captable.issuance.voided', w.transfer.uid), 1);
    const r = (await call(f, OWNER, '/record/10')).body;
    assert.equal(r.outstanding.shares, 11100, 'a transfer moves shares; voiding it changes no total');
    const holders = Object.fromEntries(r.by_holder.rows.map((h: any) => [h.name, h.shares]));
    assert.equal(holders['Ada Founder'], 8000);
    assert.equal('Di Angel' in holders, false);
    assert.ok(r.issuances.rows.some((i: any) => i.uid === w.transfer.uid && i.status === 'void'), 'kept, struck through');
    assert.equal((await call(f, OWNER, `/record/10/issuances/${w.transfer.uid}/void`, 'POST', { reason: 'again' })).body.error, 'not_recorded');
    // Voiding what a later row took from leaves the record not adding up, and it says so.
    const ada = r.issuances.rows.find((i: any) => i.kind === 'founding' && i.holder.holder_id === 101);
    await record(f, { kind: 'transfer', holder_name: 'Di Angel', from_holder_id: 101, class_uid: w.common.uid, shares: 8000, issued_on: '2026-07-01' });
    await call(f, OWNER, `/record/10/issuances/${ada.uid}/void`, 'POST', { reason: 'Issued in error' });
    const broken = (await call(f, OWNER, '/record/10')).body;
    for (const k of ['by_holder', 'outstanding', 'fully_diluted']) assert.deepEqual([broken[k].available, broken[k].reason], [false, 'negative_balance'], k);
    // Void the SAFE: it leaves the instruments.
    await call(f, OWNER, `/record/10/issuances/${w.safe.uid}/void`, 'POST', { reason: 'Rescinded' });
    assert.deepEqual((await call(f, OWNER, '/record/10')).body.instruments.rows.map((i: any) => i.kind), ['note']);
  } finally { f.db.close(); }
});

test('a row that takes shares must find them; field checks refuse what cannot belong', async () => {
  const f = fresh();
  try {
    const c = await classes(f);
    await record(f, { kind: 'founding', holder_id: 101, class_uid: c.common.uid, shares: 100, issued_on: '2026-01-01' });
    const over = await call(f, OWNER, '/record/10/issuances', 'POST', { kind: 'transfer', holder_name: 'Di', from_holder_id: 101, class_uid: c.common.uid, shares: 101, issued_on: '2026-01-02' });
    assert.deepEqual([over.status, over.body.error, over.body.held], [409, 'insufficient_shares', 100]);
    assert.equal((await call(f, OWNER, '/record/10/issuances', 'POST', { kind: 'cancellation', holder_id: 101, class_uid: c.common.uid, shares: 101, issued_on: '2026-01-02' })).body.error, 'insufficient_shares');
    assert.equal((await call(f, OWNER, '/record/10/issuances', 'POST', { kind: 'exercise', holder_id: 101, class_uid: c.common.uid, from_class_uid: c.pool.uid, shares: 1, issued_on: '2026-01-02' })).body.error, 'insufficient_shares');
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ kind: 'safe', holder_name: 'A', amount_cents: 100, shares: 5 }, 'bad_shares'],
      [{ kind: 'safe', holder_name: 'A', amount_cents: 100, class_uid: c.common.uid }, 'bad_class_uid'],
      [{ kind: 'grant', holder_name: 'A', class_uid: c.common.uid, shares: 5, issued_on: '2026-01-01' }, 'bad_class_uid'],
      [{ kind: 'founding', holder_name: 'A', class_uid: c.pool.uid, shares: 5, issued_on: '2026-01-01' }, 'bad_class_uid'],
      [{ kind: 'founding', holder_name: 'A', class_uid: c.common.uid, shares: -5, issued_on: '2026-01-01' }, 'bad_shares'],
      [{ kind: 'founding', holder_name: 'A', class_uid: c.common.uid, shares: 5, issued_on: '2026-02-30' }, 'bad_issued_on'],
      [{ kind: 'founding', holder_id: 201, class_uid: c.common.uid, shares: 5, issued_on: '2026-01-01' }, 'unknown_holder'],
      [{ kind: 'founding', holder_name: 'A', class_uid: 'nope', shares: 5, issued_on: '2026-01-01' }, 'unknown_class'],
      [{ kind: 'safe', holder_name: 'A', amount_cents: 100, discount_bps: 10000 }, 'bad_discount_bps'],
      [{ kind: 'safe', holder_name: 'A', amount_cents: 1.5 }, 'bad_amount_cents'],
      [{ kind: 'safe', holder_name: 'A', amount_cents: 100, mfn: 'yes' }, 'bad_mfn'],
      [{ kind: 'safe', holder_name: 'A', amount_cents: 100, document_ref: 'data_room_files:999' }, 'unknown_document'],
      [{ kind: 'safe', holder_name: 'A', amount_cents: 100, document_ref: 'somewhere:1' }, 'bad_document_ref'],
      [{ kind: 'safe', holder_name: 'A' }, 'incomplete'],
      [{ kind: 'correction', holder_id: 101, class_uid: c.common.uid, shares: -10, issued_on: '2026-01-01' }, 'incomplete'],
      [{ kind: 'conversion', holder_name: 'A', class_uid: c.prefA.uid, shares: 5, issued_on: '2026-01-01' }, 'incomplete'],
    ];
    for (const [body, code] of cases) {
      const r = await call(f, OWNER, '/record/10/issuances', 'POST', body);
      assert.equal(r.status, 400, `${code}: ${r.text}`);
      assert.equal(r.body.error, code, JSON.stringify(body));
    }
    // A cancellation takes shares back; a cancelled grant returns its options to the pool.
    await record(f, { kind: 'cancellation', holder_id: 101, class_uid: c.common.uid, shares: 10, issued_on: '2026-01-03' });
    await record(f, { kind: 'grant', holder_name: 'Cy', class_uid: c.pool.uid, shares: 300, issued_on: '2026-01-03' });
    await record(f, { kind: 'cancellation', holder_name: 'Cy', class_uid: c.pool.uid, shares: 50, issued_on: '2026-01-04' });
    let rec = (await call(f, OWNER, '/record/10')).body;
    assert.equal(rec.outstanding.shares, 90);
    assert.deepEqual([rec.fully_diluted.options_granted, rec.fully_diluted.unallocated_pool, rec.fully_diluted.shares], [250, 750, 1090]);
    await record(f, { kind: 'founding', holder_id: 101, class_uid: c.common.uid, shares: 10, issued_on: '2026-01-05' });
    // A correction with its reason, negative, within what is held.
    const corr = await call(f, OWNER, '/record/10/issuances', 'POST', { kind: 'correction', holder_id: 101, class_uid: c.common.uid, shares: -10, issued_on: '2026-01-01', reason: 'Typed 100, the certificate says 90' });
    assert.equal(corr.status, 201, corr.text);
    rec = (await call(f, OWNER, '/record/10')).body;
    assert.equal(rec.outstanding.shares, 90);
    assert.equal(one(f, 'SELECT COUNT(*) AS n FROM cap_table_issuances WHERE status = ?', 'recorded').n, 6, 'no refused row was written');
  } finally { f.db.close(); }
});

test('an admin writes only with a reason, which the founder reads in the history', async () => {
  const f = fresh();
  try {
    const c = await classes(f);
    const body = { kind: 'founding', holder_id: 101, class_uid: c.common.uid, shares: 100, issued_on: '2026-01-01' };
    const bare = await call(f, ADMIN, '/record/10/issuances', 'POST', body);
    assert.equal(bare.status, 400);
    assert.deepEqual(bare.body.missing, ['reason']);
    assert.equal((await call(f, ADMIN, '/record/10/classes', 'POST', { name: 'B', kind: 'common' })).body.error, 'reason_required');
    assert.equal((await call(f, ADMIN, '/record/10/currency', 'PUT', { currency: 'EUR' })).body.error, 'reason_required');
    const fixed = await call(f, ADMIN, '/record/10/issuances', 'POST', { ...body, reason: 'Support ticket 12: the founder’s certificate was missed' });
    assert.equal(fixed.status, 201, fixed.text);
    assert.deepEqual([fixed.body.issuance.origin, fixed.body.issuance.correction_reason], ['admin', 'Support ticket 12: the founder’s certificate was missed']);
    const h = (await call(f, OWNER, '/record/10/history')).body;
    const row = h.rows.find((x: any) => x.type === 'issuance' && x.issuance.uid === fixed.body.issuance.uid);
    assert.equal(row.issuance.correction_reason, 'Support ticket 12: the founder’s certificate was missed');
    const act = h.rows.find((x: any) => x.type === 'activity' && x.activity.action === 'captable.issuance.recorded' && x.activity.entity_uid === fixed.body.issuance.uid);
    assert.equal(act.activity.details.reason, 'Support ticket 12: the founder’s certificate was missed');
    assert.equal(act.activity.user_id, ADMIN);
  } finally { f.db.close(); }
});

test('the history: issuances and the cap table’s activity rows, newest first, paged, with an exact total', async () => {
  const f = fresh();
  try {
    await worked(f);
    // Spread the clock so newest-first is checkable: rows written in a burst share a second.
    f.db.exec(`UPDATE cap_table_issuances SET created_at = datetime('2026-01-01', '+' || id || ' hours')`);
    f.db.exec(`UPDATE activity_logs SET created_at = datetime('2026-01-01', '+' || id || ' hours', '+30 minutes')`);
    f.db.exec(`INSERT INTO activity_logs (project_id, user_id, action, created_at) VALUES (10, 4, 'deck_saved', '2027-01-01 00:00:00'), (20, 9, 'captable.issuance.recorded', '2027-01-01 00:00:00')`);
    const issuances = one(f, 'SELECT COUNT(*) AS n FROM cap_table_issuances').n;
    const activity = one(f, `SELECT COUNT(*) AS n FROM activity_logs WHERE project_id = 10 AND action LIKE 'captable.%'`).n;
    assert.equal(issuances, 8);
    assert.equal(activity, 11, '3 classes and 8 issuances, one audit row each');
    const p1 = (await call(f, OWNER, '/record/10/history?page_size=5')).body;
    assert.equal(p1.total, 19, 'exact: neither another venture’s nor a non-cap-table row');
    assert.equal(p1.rows.length, 5);
    const all: any[] = [];
    for (let page = 1; page <= 4; page++) all.push(...(await call(f, OWNER, `/record/10/history?page=${page}&page_size=5`)).body.rows);
    assert.equal(all.length, 19);
    const ats = all.map((r) => r.at);
    assert.deepEqual(ats, [...ats].sort().reverse(), 'newest first');
    // Activity row 11 (+11h30) is the note's audit row; the newest issuance is the note (+8h).
    assert.equal(all[0].type, 'activity');
    assert.equal(all[0].activity.action, 'captable.issuance.recorded');
    const firstIssuance = all.find((r) => r.type === 'issuance');
    assert.equal(firstIssuance.issuance.kind, 'note');
    assert.equal(all[0].activity.entity_uid, firstIssuance.issuance.uid);
    assert.equal(all.filter((r) => r.type === 'activity').every((r) => r.activity.action.startsWith('captable.')), true);
    for (const q of ['page=0', 'page_size=101', 'page=x']) assert.equal((await call(f, OWNER, `/record/10/history?${q}`)).status, 400, q);
  } finally { f.db.close(); }
});

test('a SAFE sent through StudioOS links its uid and reads its terms from there', async () => {
  const f = fresh();
  try {
    f.db.exec(`INSERT INTO safe_issuances (uid, project_id, investor_name, amount_cents, valuation_cap_cents, currency, created_by) VALUES
      ('safe-10', 10, 'Signed Angel', 5000000, 800000000, 'usd', 4), ('safe-20', 20, 'Elsewhere', 100, 100, 'usd', 9)`);
    assert.equal((await call(f, OWNER, '/record/10/issuances', 'POST', { kind: 'safe', holder_name: 'Signed Angel', safe_issuance_uid: 'safe-10', amount_cents: 5000000 })).body.error, 'linked_terms');
    assert.equal((await call(f, OWNER, '/record/10/issuances', 'POST', { kind: 'safe', holder_name: 'X', safe_issuance_uid: 'safe-20' })).body.error, 'unknown_safe');
    const r = await record(f, { kind: 'safe', holder_name: 'Signed Angel', safe_issuance_uid: 'safe-10', source: 'signed' });
    assert.deepEqual([r.amount_cents, r.currency, r.terms.cap_cents, r.terms.basis, r.terms.discount_bps], [5000000, 'USD', 800000000, 'post_money', null]);
    const row = one(f, 'SELECT amount_cents, cap_cents, basis FROM cap_table_issuances WHERE uid = ?', r.uid);
    assert.deepEqual({ ...row }, { amount_cents: null, cap_cents: null, basis: null }, 'nothing copied');
    assert.equal((await call(f, OWNER, '/record/10/issuances', 'POST', { kind: 'safe', holder_name: 'Signed Angel', safe_issuance_uid: 'safe-10' })).body.error, 'already_on_record');
  } finally { f.db.close(); }
});

test('a currency per venture: USD by default, set by the owner, and a recorded amount keeps its own', async () => {
  const f = fresh();
  try {
    await record(f, { kind: 'safe', holder_name: 'Dollar Angel', amount_cents: 100 });
    assert.equal((await call(f, OWNER, '/record/10/currency', 'PUT', { currency: 'eur' })).body.error, 'bad_currency');
    const set = await call(f, OWNER, '/record/10/currency', 'PUT', { currency: 'EUR' });
    assert.deepEqual(set.body.currency, { code: 'EUR', source: 'set' });
    assert.equal(audits(f, 'captable.currency.set'), 1);
    await record(f, { kind: 'safe', holder_name: 'Euro Angel', amount_cents: 200 });
    const r = (await call(f, OWNER, '/record/10')).body;
    assert.deepEqual(r.currency, { code: 'EUR', source: 'set' });
    assert.deepEqual(r.instruments.rows.map((i: any) => [i.holder.name, i.currency]), [['Dollar Angel', 'USD'], ['Euro Angel', 'EUR']]);
    assert.deepEqual((await call(f, OWNER, '/record/20')).status, 403, 'another venture’s is not read');
  } finally { f.db.close(); }
});

test('a connector item is recorded once; a read that fails answers 5xx, never an empty record', async () => {
  const f = fresh();
  try {
    const body = { kind: 'safe', holder_name: 'Angel', amount_cents: 100, source: 'connector_mercury', basis: 'post_money' };
    await recordFromSource(f.env, { projectId: 10, actorId: OWNER, origin: 'mercury', originRef: 'safe-1', body });
    await assert.rejects(() => recordFromSource(f.env, { projectId: 10, actorId: OWNER, origin: 'mercury', originRef: 'safe-1', body }), (e: any) => e.code === 'already_on_record');
    f.db.exec('DROP TABLE cap_table_share_classes');
    const r = await call(f, OWNER, '/record/10');
    assert.ok(r.status >= 500, `${r.status} ${r.text}`);
    assert.equal(r.body?.outstanding, undefined);
  } finally { f.db.close(); }
});

test('the record routes are matched before the venture alias, and the client names each one', () => {
  const src = readFileSync(resolve(ROOT, 'cloudflare-worker/src/routes/captable.ts'), 'utf8');
  assert.ok(src.indexOf("captable.get('/record/:projectId'") < src.indexOf("captable.get('/:projectId'"));
  const client = readFileSync(resolve(ROOT, 'frontend/src/lib/api/capTableRecord.js'), 'utf8');
  for (const p of ['/proposals', '/accept', '/dismiss', '/issuances', '/void', '/classes', '/currency', '/history']) assert.ok(client.includes(p), p);
  assert.match(readFileSync(resolve(ROOT, 'frontend/src/lib/api.js'), 'utf8'), /export \* from '\.\/api\/capTableRecord\.js';/);
});
