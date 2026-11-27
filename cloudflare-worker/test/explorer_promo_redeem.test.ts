/**
 * D9036 (#9036) — the explorer promo, end to end: `GET /api/products/promo` and `POST /api/products/redeem` through
 * the real router on the migrated schema (node:sqlite), with synthetic accounts and codes generated at run time.
 *
 *   · The owner's code redeems once into exactly one 30-day `feature_unlocks` row keyed
 *     `explorer_promo:<code id>:<user>`, for $0; a second redeem is `already_redeemed` and grants nothing more.
 *   · Another account's code answers exactly what a made-up code answers (`not_found`), so a code probes no account.
 *   · An expired code is `expired`, an empty one `not_found`; a code matches with or without its dashes, in any case.
 *   · The claim and the grant are one D1 batch: when the grant fails the code is not spent (`redeemed_at` stays NULL),
 *     the caller is told nothing was used, and a later redeem succeeds.
 *   · Neither route answers without a session.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/explorer_promo_redeem.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import products from '../src/routes/products.ts';
import { mapError } from '../src/routes/_t13t14t15_helpers.ts';

const SECRET = 'd9036-explorer-promo-fixture-only-'.repeat(2); // A fixture signing key; never a service credential.
const OWNER = 1, OTHER = 2;
const DAY = 86_400_000;
/** A time relative to now: the route stamps and checks expiry on the real clock, so the fixture must too. */
const fromNow = (days: number) => new Date(Date.now() + days * DAY).toISOString(); // clock-ok: relative

/** A code in the issued shape (AXAL-XXXX-XXXX), made at run time so no literal looks like a credential. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function syntheticCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return ['AXAL', chars.slice(0, 4).join(''), chars.slice(4).join('')].join('-');
}

function fixture(opts: { ownerExpiresAt?: string } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`INSERT INTO users(id,email,name,role,is_active) VALUES
    (${OWNER},'owner@example.test','Promo Owner','founder',1),(${OTHER},'other@example.test','Other Account','founder',1);`);
  const codes = { owner: syntheticCode(), other: syntheticCode() };
  const add = db.prepare(`INSERT INTO explorer_promo_codes(user_id,code,track,feature_key,license_label,unlock_days,expires_at)
    VALUES (?,?,'founder','explorer_license_founder','Founder toolkit — 30-day license',30,?)`);
  const ownerRow = add.run(OWNER, codes.owner, opts.ownerExpiresAt ?? fromNow(90));
  add.run(OTHER, codes.other, fromNow(90));
  const ownerId = Number(ownerRow.lastInsertRowid);
  const base = d1Over(db);
  /** `afterLookup` runs once, right after the route reads the caller's code: a concurrent request landing in between. */
  const hooks: { afterLookup?: () => void } = {};
  const DB = {
    ...base,
    prepare(sql: string) {
      const stmt = base.prepare(sql);
      if (!/FROM explorer_promo_codes\s+WHERE REPLACE/.test(sql)) return stmt;
      return {
        ...stmt,
        bind: (...a: unknown[]) => {
          const bound = stmt.bind(...a);
          return { ...bound, first: async () => { const row = await bound.first(); hooks.afterLookup?.(); hooks.afterLookup = undefined; return row; } };
        },
      };
    },
  };
  const env: any = { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono().route('/api/products', products);
  app.onError((e, c) => (e instanceof Response ? e : mapError(c as any, e)));
  const call = async (who: number | null, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (who != null) {
      headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
    }
    const res = await app.request(path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) }, env);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json };
  };
  const unlocks = () => db.prepare('SELECT user_id, feature_key, expires_at, source_payment_intent_id FROM feature_unlocks ORDER BY id').all() as any[];
  const redeemedAt = (userId: number) =>
    (db.prepare('SELECT redeemed_at FROM explorer_promo_codes WHERE user_id = ?').get(userId) as any).redeemed_at;
  const redeem = (who: number, code: unknown) => call(who, 'POST', '/api/products/redeem', { code });
  return { db, call, redeem, codes, ownerId, unlocks, redeemedAt, hooks };
}

test("#9036: the owner's code redeems once, into exactly one $0 30-day unlock keyed to the code and the account", async () => {
  const f = fixture();
  const r = await f.redeem(OWNER, f.codes.owner);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.confirmation.amount_cents, 0);
  assert.equal(r.json.confirmation.feature_key, 'explorer_license_founder');
  assert.equal(r.json.confirmation.unlock_days, 30);
  const rows = f.unlocks();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_payment_intent_id, `explorer_promo:${f.ownerId}:${OWNER}`);
  assert.equal(rows[0].user_id, OWNER);
  assert.equal(rows[0].feature_key, 'explorer_license_founder');
  const days = (Date.parse(rows[0].expires_at) - Date.now()) / DAY; // clock-ok: relative
  assert.ok(days > 29.9 && days <= 30, `the unlock runs ${days} days`);
  assert.notEqual(f.redeemedAt(OWNER), null, 'the code is spent');
  assert.equal(f.redeemedAt(OTHER), null, "the other account's code is untouched");
});

test('#9036: a second redeem is already_redeemed and grants nothing more', async () => {
  const f = fixture();
  assert.equal((await f.redeem(OWNER, f.codes.owner)).status, 200);
  const spent = f.redeemedAt(OWNER);
  const again = await f.redeem(OWNER, f.codes.owner);
  assert.deepEqual([again.status, again.json.reason], [400, 'already_redeemed']);
  assert.equal(f.unlocks().length, 1);
  assert.equal(f.redeemedAt(OWNER), spent);
});

test('#9036: a redeem that loses the claim to a concurrent one is already_redeemed, and the unlock stays one row', async () => {
  const f = fixture();
  // Another request redeems the same code between this one's read and its batch: it spends the code and grants
  // the unlock, exactly as the batch would.
  f.hooks.afterLookup = () => {
    f.db.exec(`UPDATE explorer_promo_codes SET redeemed_at = datetime('now') WHERE user_id = ${OWNER}`);
    f.db.prepare(`INSERT INTO feature_unlocks(user_id,feature_key,expires_at,source_payment_intent_id) VALUES (?,?,?,?)`)
      .run(OWNER, 'explorer_license_founder', fromNow(30), `explorer_promo:${f.ownerId}:${OWNER}`);
  };
  const late = await f.redeem(OWNER, f.codes.owner);
  assert.deepEqual([late.status, late.json.reason], [400, 'already_redeemed']);
  assert.equal(f.unlocks().length, 1);
});

test("#9036: another account's code answers exactly what a made-up code answers, and spends nothing", async () => {
  const f = fixture();
  const theirs = await f.redeem(OWNER, f.codes.other);
  const madeUp = await f.redeem(OWNER, syntheticCode());
  assert.deepEqual([theirs.status, theirs.json.reason], [400, 'not_found']);
  assert.deepEqual(theirs, madeUp);
  assert.equal(f.redeemedAt(OTHER), null);
  assert.equal(f.redeemedAt(OWNER), null);
  assert.deepEqual(f.unlocks(), []);
});

test('#9036: an expired code is expired, an empty code is not_found, and neither writes', async () => {
  const f = fixture({ ownerExpiresAt: fromNow(-1) });
  const expired = await f.redeem(OWNER, f.codes.owner);
  assert.deepEqual([expired.status, expired.json.reason], [400, 'expired']);
  for (const empty of ['', '   ', '----', null]) {
    const r = await f.redeem(OWNER, empty);
    assert.deepEqual([r.status, r.json.reason], [400, 'not_found'], JSON.stringify(empty));
    // Nothing typed at all is asked for a code; a code of only dashes is simply not recognised.
    if (empty !== '----') assert.equal(r.json.error, 'Enter a code to redeem.', JSON.stringify(empty));
  }
  assert.equal(f.redeemedAt(OWNER), null);
  assert.deepEqual(f.unlocks(), []);
});

test('#9036: a code matches with or without its dashes, in either case', async () => {
  for (const shape of [(c: string) => c.replaceAll('-', ''), (c: string) => c.toLowerCase(), (c: string) => ` ${c.replaceAll('-', ' ')} `]) {
    const f = fixture();
    const r = await f.redeem(OWNER, shape(f.codes.owner));
    assert.equal(r.status, 200, shape(f.codes.owner).replace(/[A-Z0-9]/gi, 'x'));
    assert.equal(f.unlocks().length, 1);
  }
});

test('#9036: when the unlock cannot be written, the code is not spent and a later redeem succeeds', async () => {
  const f = fixture();
  f.db.exec(`CREATE TRIGGER d9036_unlock_fails BEFORE INSERT ON feature_unlocks BEGIN SELECT RAISE(ABORT, 'synthetic unlock failure'); END;`);
  const failed = await f.redeem(OWNER, f.codes.owner);
  assert.equal(failed.status, 503);
  assert.equal(failed.json.error, 'redeem_not_saved');
  assert.doesNotMatch(JSON.stringify(failed.json), /synthetic unlock failure/, 'the store error never reaches the caller');
  assert.equal(f.redeemedAt(OWNER), null, 'the code was spent with no unlock');
  assert.deepEqual(f.unlocks(), []);
  f.db.exec('DROP TRIGGER d9036_unlock_fails');
  const retry = await f.redeem(OWNER, f.codes.owner);
  assert.equal(retry.status, 200);
  assert.equal(f.unlocks().length, 1);
  assert.notEqual(f.redeemedAt(OWNER), null);
});

test('#9036: neither route answers without a session; the promo read is the caller\'s own', async () => {
  const f = fixture();
  assert.equal((await f.call(null, 'GET', '/api/products/promo')).status, 401);
  assert.equal((await f.call(null, 'POST', '/api/products/redeem', { code: f.codes.owner })).status, 401);
  assert.equal(f.redeemedAt(OWNER), null);
  const mine = await f.call(OWNER, 'GET', '/api/products/promo');
  assert.equal(mine.status, 200);
  assert.equal(mine.json.promo.code, f.codes.owner);
  assert.equal(mine.json.promo.redeemed_at, null);
});
