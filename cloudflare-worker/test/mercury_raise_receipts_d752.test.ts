/**
 * D752 §5 (#1887) — raise receipts: a founder matches an investor's wire, read
 * from their own Mercury, to a committed raise prospect or a pending deal
 * commitment. Migration 490, the two target kinds, what fits, what confirming
 * and withdrawing change, the trigger, the race with a revenue import, who may
 * read, and the logs.
 *
 * Mercury is stubbed throughout (`bank()`); every id, amount and name is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_raise_receipts_d752.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { confirmMatch, personalConnection, raiseReceiptIds } from '../src/services/mercuryPersonal.ts';
import { MERCURY_INSERT } from '../src/routes/revenue.ts';
import { fixture, mig } from './_mercury_d713.ts';
import { personalFixture, connected, bank, credit, req, count, tx, day, ACC_A, FOUR_A } from './_mercury_personal_d713.ts';

const FOUNDER = 10, PARTNER = 20, INVESTOR = 30;

async function setup() {
  const { db, env } = await personalFixture();
  const integration = await connected(db, env, FOUNDER);
  db.exec(`INSERT INTO users (id, role, name, email, founder_id) VALUES (11, 'founder', 'Other Founder', 'other-founder@example.test', 101);
    INSERT INTO projects VALUES (3, 'Theirs', 101, NULL);`);
  return { db, env, integration };
}
let seq = 0;
function prospect(db: any, project: number, stage: string, amount: number | null, createdOffset = -10, name = 'Ana Angel') {
  seq += 1;
  db.prepare(`INSERT INTO raise_prospects (uid, project_id, name, firm, stage, amount, created_at) VALUES (?, ?, ?, 'Angel Fund', ?, ?, ?)`)
    .run(`rp-${seq}`, project, name, stage, amount, `${day(createdOffset)} 09:00:00`);
  return Number((db.prepare('SELECT id FROM raise_prospects WHERE uid = ?').get(`rp-${seq}`) as any).id);
}
function commitment(db: any, project: number, amount: number, status = 'pending', createdOffset = -10) {
  seq += 1;
  db.prepare("INSERT INTO deals (uid, project_id, status, capital_committed) VALUES (?, ?, 'active', ?)").run(`deal-${seq}`, project, amount);
  const deal = Number((db.prepare('SELECT id FROM deals WHERE uid = ?').get(`deal-${seq}`) as any).id);
  db.prepare('INSERT INTO commitments (uid, deal_id, investor_user_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(`cm-${seq}`, deal, INVESTOR, amount, status, `${day(createdOffset)} 09:00:00`);
  return { deal, id: Number((db.prepare('SELECT id FROM commitments WHERE uid = ?').get(`cm-${seq}`) as any).id) };
}
const revenueRow = (db: any, transactionId: string) => db.prepare(
  `INSERT INTO revenue_entries (uid, project_id, customer, amount_cents, revenue_type, received_on, source, source_ref, verification, created_by)
   VALUES (?, 1, 'Customer Co', 100000, 'one_time', ?, 'mercury', ?, 'supported', 10)`,
).run(`re-${transactionId}`, day(-1), transactionId);
const matches = async (env: any, word: string, who = FOUNDER) => req(env, who, 'GET', `/api/mercury/personal/matches?target=${word}`);
const confirm = (env: any, kind: string, id: number, transaction: string, who = FOUNDER) =>
  req(env, who, 'POST', '/api/mercury/personal/matches', { target_kind: kind, target_id: id, transaction_id: transaction });

// ------------------------------------------------------------------ the migration

test('490 keeps every row of the three old kinds, recreates both partial indexes, and widens only target_kind', () => {
  const { db } = fixture('477');
  const ins = db.prepare(`INSERT INTO mercury_personal_matches (uid, user_id, integration_id, mercury_transaction_id, account_last_four, amount_cents, posted_on, target_kind, target_id, state, withdrawn_at, withdraw_reason)
    VALUES (?, 20, 9, ?, '4242', ?, '2026-10-02', ?, ?, ?, ?, ?)`);
  let n = 0;
  for (const kind of ['engagement_invoice', 'payout', 'partner_deal_settlement']) {
    for (const state of ['confirmed', 'withdrawn']) {
      n += 1;
      ins.run(`u-${n}`, `txn-${n}`, 1000 * n, kind, n, state, state === 'withdrawn' ? '2026-10-03 00:00:00' : null, state === 'withdrawn' ? 'A reason of ten' : null);
    }
  }
  const before = db.prepare('SELECT * FROM mercury_personal_matches ORDER BY id').all();
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(mig('490_mercury_raise_receipts.sql'));
  assert.deepEqual(db.prepare('SELECT * FROM mercury_personal_matches ORDER BY id').all(), before);
  const idx = Object.fromEntries((db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'mercury_personal_matches'").all() as any[]).map((r) => [r.name, r.sql]));
  for (const name of ['uq_mercury_personal_match_transaction', 'uq_mercury_personal_match_target']) assert.match(String(idx[name]), /WHERE state = 'confirmed'/, name);
  const one = (kind: string, last4 = '4242') => db.prepare(`INSERT INTO mercury_personal_matches (uid, user_id, integration_id, mercury_transaction_id, account_last_four, amount_cents, posted_on, target_kind, target_id)
    VALUES (?, 10, 9, ?, ?, 500, '2026-10-02', ?, 99)`).run(`new-${kind}-${last4}`, `t-${kind}-${last4}`, last4, kind);
  one('raise_prospect');
  db.exec("UPDATE mercury_personal_matches SET state = 'withdrawn' WHERE target_kind = 'raise_prospect'");
  one('deal_commitment');
  assert.throws(() => one('other'), /CHECK/);
  assert.throws(() => one('payout', '12ab'), /CHECK/);
});

// ------------------------------------------------------------------ the targets and what fits

test('GET ?target=raise: the founder\'s own committed prospects, the window, exact cents, and no line already on the revenue ledger', async () => {
  const { db, env } = await setup();
  const fits = prospect(db, 1, 'committed', 2500, -10, 'Ana Angel');
  const second = prospect(db, 2, 'committed', 1200.5, -5, 'Ben Backer');
  prospect(db, 1, 'meeting', 2500);
  prospect(db, 3, 'committed', 2500, -10, 'Not Mine');
  const fraction = prospect(db, 1, 'committed', 1000.005);
  const missing = prospect(db, 1, 'committed', null);
  const old = prospect(db, 1, 'committed', 9999, -730);
  const b = bank();
  b.state.txns[ACC_A] = [
    credit(1, 2500, day(-40), 'Ana Angel'),            // 30 days before created_at: fits
    credit(2, 2500.01, day(-5)),                        // one cent off
    credit(3, 2500, day(-41)),                          // 31 days before
    credit(4, 2500, day(-3), 'Someone Else Trust'),     // the counterparty is never checked
    credit(5, 1200.5, day(-2)),
    credit(6, 2500, day(-2)),                           // already revenue
  ];
  revenueRow(db, tx(6));
  try {
    const r = await matches(env, 'raise');
    assert.equal(r.status, 200, r.text);
    const byId = new Map(r.body.items.map((i: any) => [i.target_id, i]));
    assert.deepEqual([...byId.keys()].sort((a: any, c: any) => a - c), [fits, second, fraction, missing, old].sort((a, c) => a - c));
    const a: any = byId.get(fits);
    assert.equal(a.label, 'Ana Angel · Venture');
    assert.deepEqual([a.matchable, a.unmatchable, a.amount_cents], [true, null, 250000]);
    assert.deepEqual(a.candidates.map((c: any) => c.transaction_id).sort(), [tx(1), tx(4)].sort());
    assert.equal(a.window.from, day(-40));
    assert.equal(a.window.to, day(0));
    assert.deepEqual((byId.get(second) as any).candidates.map((c: any) => c.transaction_id), [tx(5)]);
    assert.equal((byId.get(second) as any).label, 'Ben Backer · Second');
    assert.deepEqual([(byId.get(fraction) as any).matchable, (byId.get(fraction) as any).unmatchable, (byId.get(fraction) as any).candidates], [false, 'amount_not_whole_cents', []]);
    assert.deepEqual([(byId.get(missing) as any).matchable, (byId.get(missing) as any).unmatchable], [false, 'amount_missing']);
    assert.equal((byId.get(old) as any).window.from, day(-366), 'a window never starts more than 366 days back');
  } finally { b.restore(); }
});

test('GET ?target=commitment: the pending commitments on the founder\'s own deals only', async () => {
  const { db, env } = await setup();
  const mine = commitment(db, 1, 5000);
  commitment(db, 1, 6000, 'confirmed');
  commitment(db, 3, 5000);
  db.exec("UPDATE users SET name = 'Ivy Investor' WHERE id = 30");
  const b = bank();
  b.state.txns[ACC_A] = [credit(1, 5000, day(-1), 'Ivy Holdings SPV')];
  try {
    const r = await matches(env, 'commitment');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.items.map((i: any) => [i.target_id, i.label, i.candidates.length]), [[mine.id, 'Ivy Investor · Venture', 1]]);
  } finally { b.restore(); }
});

// ------------------------------------------------------------------ confirming

test('confirming a raise prospect: one match, commit_status wired; every refusal', async () => {
  const { db, env } = await setup();
  const p = prospect(db, 1, 'committed', 2500);
  const q = prospect(db, 1, 'committed', 2500, -10, 'Second Angel');
  const frac = prospect(db, 1, 'committed', 1000.005);
  const theirs = prospect(db, 3, 'committed', 2500);
  const b = bank();
  b.state.txns[ACC_A] = [credit(1, 2500, day(-2)), credit(2, 999, day(-2)), credit(3, 2500, day(-1)), credit(4, 1000, day(-1))];
  revenueRow(db, tx(3));
  try {
    const ok = await confirm(env, 'raise', p, tx(1));
    assert.equal(ok.status, 201, ok.text);
    assert.deepEqual([ok.body.match.target_kind, ok.body.match.amount_cents, ok.body.match.last_four], ['raise_prospect', 250000, FOUR_A]);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM mercury_personal_matches WHERE target_kind = 'raise_prospect' AND state = 'confirmed'"), 1);
    assert.equal((db.prepare('SELECT commit_status FROM raise_prospects WHERE id = ?').get(p) as any).commit_status, 'wired');
    assert.deepEqual((await confirm(env, 'raise', p, tx(1))).body.error, 'target_already_matched');
    assert.deepEqual((await confirm(env, 'raise', q, tx(1))).body.error, 'already_matched');
    assert.deepEqual((await confirm(env, 'raise', q, tx(2))).body.error, 'not_matchable', 'a line that does not fit');
    assert.deepEqual((await confirm(env, 'raise', frac, tx(4))).body.error, 'not_matchable', 'a target that is not matchable');
    const rev = await confirm(env, 'raise', q, tx(3));
    assert.deepEqual([rev.status, rev.body.error], [409, 'imported_as_revenue']);
    const other = await confirm(env, 'raise', theirs, tx(4));
    const none = await confirm(env, 'raise', 999999, tx(4));
    assert.deepEqual([other.status, other.body], [none.status, none.body], 'another founder\'s prospect reads as one that does not exist');
    assert.deepEqual([other.status, other.body.error, other.body.message], [404, 'target_not_found', 'That is not one of your committed raise prospects.']);
  } finally { b.restore(); }
});

test('confirming a deal commitment moves pending to confirmed and leaves capital_committed as it was', async () => {
  const { db, env } = await setup();
  const c = commitment(db, 1, 5000);
  const b = bank();
  b.state.txns[ACC_A] = [credit(1, 5000, day(-1))];
  try {
    const ok = await confirm(env, 'commitment', c.id, tx(1));
    assert.equal(ok.status, 201, ok.text);
    assert.equal((db.prepare('SELECT status FROM commitments WHERE id = ?').get(c.id) as any).status, 'confirmed');
    assert.equal((db.prepare('SELECT capital_committed FROM deals WHERE id = ?').get(c.deal) as any).capital_committed, 5000);
    const nf = await confirm(env, 'commitment', 999999, tx(1));
    assert.equal(nf.body.message, 'That is not one of your pending deal commitments.');
  } finally { b.restore(); }
});

// ------------------------------------------------------------------ withdrawing, and the trigger

test('withdrawing: a reason of ten; a raise receipt keeps wired, a deal receipt goes back to pending', async () => {
  const { db, env } = await setup();
  const p = prospect(db, 1, 'committed', 2500);
  const c = commitment(db, 1, 5000);
  const b = bank();
  b.state.txns[ACC_A] = [credit(1, 2500, day(-2)), credit(2, 5000, day(-1))];
  try {
    const rp = (await confirm(env, 'raise', p, tx(1))).body.match.uid;
    const dc = (await confirm(env, 'commitment', c.id, tx(2))).body.match.uid;
    assert.equal((await req(env, FOUNDER, 'POST', `/api/mercury/personal/matches/${rp}/withdraw`, { reason: 'short' })).status, 400);
    assert.equal((await req(env, FOUNDER, 'POST', `/api/mercury/personal/matches/${rp}/withdraw`, { reason: 'Wrong wire picked' })).status, 200);
    assert.equal((await req(env, FOUNDER, 'POST', `/api/mercury/personal/matches/${dc}/withdraw`, { reason: 'Wrong wire picked' })).status, 200);
    assert.equal((db.prepare('SELECT commit_status FROM raise_prospects WHERE id = ?').get(p) as any).commit_status, 'wired');
    assert.equal((db.prepare('SELECT status FROM commitments WHERE id = ?').get(c.id) as any).status, 'pending');
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM mercury_personal_matches WHERE state = 'withdrawn'"), 2);
  } finally { b.restore(); }
});

test('the trigger: a changed amount or stage withdraws the receipt with its fixed reason; the same values, or commit_status alone, do not', async () => {
  const { db, env } = await setup();
  const b = bank();
  try {
    for (const change of ['amount', 'stage', 'same', 'commit_status'] as const) {
      const p = prospect(db, 1, 'committed', 2500);
      b.state.txns[ACC_A] = [credit(100 + p, 2500, day(-2))];
      assert.equal((await confirm(env, 'raise', p, tx(100 + p))).status, 201, change);
      if (change === 'amount') db.prepare('UPDATE raise_prospects SET amount = 2600, updated_at = datetime(\'now\') WHERE id = ?').run(p);
      if (change === 'stage') db.prepare("UPDATE raise_prospects SET stage = 'passed', commit_status = NULL WHERE id = ?").run(p);
      if (change === 'same') db.prepare("UPDATE raise_prospects SET amount = 2500, stage = 'committed' WHERE id = ?").run(p);
      if (change === 'commit_status') db.prepare("UPDATE raise_prospects SET commit_status = 'signed' WHERE id = ?").run(p);
      const m = db.prepare("SELECT state, withdraw_reason FROM mercury_personal_matches WHERE target_kind = 'raise_prospect' AND target_id = ?").get(p) as any;
      const moved = change === 'amount' || change === 'stage';
      assert.deepEqual([m.state, m.withdraw_reason], moved
        ? ['withdrawn', "The prospect's amount or stage changed after the match (D752)."] : ['confirmed', null], change);
    }
  } finally { b.restore(); }
});

// ------------------------------------------------------------------ one line, one meaning: the race

test('the race: a receipt and a revenue import on one line, in either order, never both win', async () => {
  // A revenue row first, with confirm's own pre-check bypassed: the INSERT's NOT EXISTS refuses, and nothing becomes wired.
  const a = await setup();
  const p = prospect(a.db, 1, 'committed', 2500);
  const b = bank();
  b.state.txns[ACC_A] = [credit(1, 2500, day(-2))];
  try {
    revenueRow(a.db, tx(1));
    const fakeCtx: any = { env: a.env, req: { header: () => undefined, raw: { headers: new Headers() } }, get: () => undefined, json: (x: any, s: number) => new Response(JSON.stringify(x), { status: s }) };
    const user: any = (a.db.prepare('SELECT * FROM users WHERE id = 10').get());
    const conn = await personalConnection(fakeCtx, user, 'raise_receipts');
    assert.ok(!(conn instanceof Response), 'the connection reads');
    const out = await confirmMatch(a.env, user, conn as any, 'raise_prospect', p, tx(1), { importedAsRevenue: async () => new Set() });
    assert.deepEqual(out.ok ? 'ok' : out.code, 'imported_as_revenue');
    assert.equal(count(a.db, 'SELECT COUNT(*) AS n FROM mercury_personal_matches'), 0);
    assert.equal((a.db.prepare('SELECT commit_status FROM raise_prospects WHERE id = ?').get(p) as any).commit_status, null, 'a lost confirmation sets nothing');
  } finally { b.restore(); }
  // A receipt first, then the revenue INSERT itself, with its own pre-check bypassed.
  const c = await setup();
  const q = prospect(c.db, 1, 'committed', 2500);
  const b2 = bank();
  b2.state.txns[ACC_A] = [credit(1, 2500, day(-2))];
  try {
    assert.equal((await confirm(c.env, 'raise', q, tx(1))).status, 201);
    const r = await c.env.DB.prepare(MERCURY_INSERT).bind('re-race', 1, 'Customer Co', 250000, 'USD', 'one_time', day(-2), tx(1), 'supported', 'batch', 10, tx(1)).run();
    assert.equal(Number(r.meta?.changes ?? 0), 0);
    assert.equal(count(c.db, "SELECT COUNT(*) AS n FROM revenue_entries WHERE source = 'mercury'"), 0);
    assert.deepEqual([...await raiseReceiptIds(c.env, 10)], [tx(1)]);
    assert.deepEqual([...await raiseReceiptIds(c.env, 10, ['other'])], []);
  } finally { b2.restore(); }
});

// ------------------------------------------------------------------ policy and logs

test('policy: a partner and an investor are purpose_not_allowed, a support session is refused, a branch Worker serves a founder', async () => {
  const { db, env } = await setup();
  await connected(db, env, PARTNER);
  await connected(db, env, INVESTOR);
  const b = bank();
  try {
    for (const who of [PARTNER, INVESTOR]) {
      for (const word of ['raise', 'commitment']) {
        const r = await matches(env, word, who);
        assert.deepEqual([r.status, r.body.error ?? r.body.code], [403, 'purpose_not_allowed'], `${who} ${word}`);
      }
    }
    const support = await req(env, FOUNDER, 'GET', '/api/mercury/personal/matches?target=raise', undefined, { impersonated: true });
    assert.deepEqual([support.status, support.body.error ?? support.body.code], [403, 'support_session_refused']);
    const branch = await req(env, FOUNDER, 'GET', '/api/mercury/personal/matches?target=commitment', undefined, { branch: true });
    assert.equal(branch.status, 200, branch.text);
    const bad = await req(env, FOUNDER, 'GET', '/api/mercury/personal/matches?target=nope');
    assert.equal(bad.body.message, 'Choose invoice, payout, settlement, raise or commitment.');
  } finally { b.restore(); }
});

test('logs: one integration_logs row per read, with the use and counts only', async () => {
  const { db, env } = await setup();
  prospect(db, 1, 'committed', 2500, -10, 'Ana Angel');
  const b = bank();
  b.state.txns[ACC_A] = [credit(1, 2500, day(-2), 'Ana Angel Trust')];
  try {
    await matches(env, 'raise');
    const rows = db.prepare("SELECT event_type, response_summary FROM integration_logs WHERE provider_key = 'mercury' AND event_type = 'mercury_matches_read'").all() as any[];
    assert.equal(rows.length, 1);
    assert.match(rows[0].response_summary, /^use=raise_receipts targets=1 lines=\d+$/);
    assert.doesNotMatch(rows[0].response_summary, /2500|Ana|4242|\d{4}-\d{2}-\d{2}/);
  } finally { b.restore(); }
});

test('no file but services/mercuryPersonal.ts writes a commitments row', () => {
  const root = 'cloudflare-worker/src';
  const walk = (p: string): string[] => readdirSync(p, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(p, e.name)) : [join(p, e.name)]));
  const writers = walk(root).filter((f) => /\.[cm]?[jt]s$/.test(f) && /UPDATE\s+commitments\b/i.test(readFileSync(f, 'utf8'))).map((f) => relative(root, f));
  assert.deepEqual(writers, ['services/mercuryPersonal.ts']);
});
