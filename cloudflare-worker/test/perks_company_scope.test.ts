/**
 * Company scoping, stage 10: the shared user-keyed surfaces.
 *
 * Three files were on the list and only one has anything to narrow. Which one,
 * and why the other two do not, is most of what this file exists to record.
 *
 * PERKS SPLITS THREE WAYS and only the middle one is a firm's:
 *
 *   * the CATALOGUE is a marketplace — its own header calls it one, and a
 *     founder is meant to see perks from partners they have no relationship
 *     with;
 *   * the PARTNER SIDE is "what does MY agency offer", which is a claim about
 *     a firm and is what migration 198 is for;
 *   * the CREDIT LEDGER and CLAIMS are an ACCOUNT balance and what was spent
 *     from it — account-level for the same reason `partner_portal`'s referral
 *     code and `lpSelfScope`'s positions are. Splitting one person's credits
 *     across their firms would invent an accounting rule nobody asked for.
 *
 * The last two tests pin `networkfx` and `calendar` as deliberately untouched,
 * so a later reader sees a decision rather than two files someone forgot.
 *
 * Harness matches stages 1-9. Tables are canonical DDL from
 * sql/migrations/186_perks.sql, copied verbatim, plus 198's column.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import perks from '../src/routes/perks.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const PARTNER = 42;
const OTHER_PARTNER = 43;
const FOUNDER = 50;
const AGENCY_A = 21;
const AGENCY_B = 22;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { return x; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, partner_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT,
      subscription_tier TEXT
    );
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL
    );
    -- Verbatim from sql/migrations/186_perks.sql, plus 198's company_id.
    CREATE TABLE perks (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      uid            TEXT UNIQUE NOT NULL,
      partner_user_id INTEGER,
      partner_name   TEXT NOT NULL,
      category       TEXT NOT NULL,
      offer          TEXT NOT NULL,
      blurb          TEXT,
      detail         TEXT,
      kind           TEXT NOT NULL DEFAULT 'credits'
                     CHECK (kind IN ('credits', 'tier', 'money')),
      credits        INTEGER NOT NULL DEFAULT 0,
      required_tier  TEXT CHECK (required_tier IN ('free', 'growth', 'studio')),
      price_cents    INTEGER,
      fulfilment     TEXT NOT NULL DEFAULT 'code'
                     CHECK (fulfilment IN ('code', 'link', 'intro')),
      redeem_url     TEXT,
      claim_cap      INTEGER,
      status         TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'in_review', 'live', 'paused', 'rejected')),
      review_note    TEXT,
      reviewed_by_user_id INTEGER,
      reviewed_at    TEXT,
      featured       INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
      company_id     INTEGER
    );
    CREATE TABLE perk_claims (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      uid          TEXT UNIQUE NOT NULL,
      perk_id      INTEGER NOT NULL,
      user_id      INTEGER NOT NULL,
      credits_spent INTEGER NOT NULL DEFAULT 0,
      claimed_price_cents INTEGER,
      kind_at_claim TEXT NOT NULL DEFAULT 'credits',
      code         TEXT,
      redeem_url   TEXT,
      status       TEXT NOT NULL DEFAULT 'issued'
                   CHECK (status IN ('issued', 'redeemed', 'expired', 'revoked')),
      expires_at   TEXT,
      redeemed_at  TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE perk_credit_ledger (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      delta       INTEGER NOT NULL,
      kind        TEXT NOT NULL CHECK (kind IN ('grant', 'spend', 'refund', 'admin_adjust')),
      source_ref  TEXT NOT NULL,
      note        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, email, subscription_tier) VALUES (?,?,?,?)');
  u.run(PARTNER, 'partner', 'p@example.com', 'studio');
  u.run(OTHER_PARTNER, 'partner', 'q@example.com', 'studio');
  u.run(FOUNDER, 'founder', 'f@example.com', 'studio');
  const l = db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?,?)');
  l.run(AGENCY_A, PARTNER); l.run(AGENCY_B, PARTNER);
  // The founder holds AGENCY_A too, so a header from them is VERIFIED and the
  // catalogue test can actually detect over-narrowing. A caller that holds no
  // link resolves to null and would make that test vacuous.
  l.run(AGENCY_A, FOUNDER);

  const p = db.prepare(
    `INSERT INTO perks (id, uid, partner_user_id, partner_name, category, offer, status, kind, credits, company_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`);
  p.run(1, 'perk-a', PARTNER, 'Acme', 'Banking', '3 months free', 'live', 'credits', 0, AGENCY_A);
  p.run(2, 'perk-b', PARTNER, 'Acme', 'Legal', 'Discounted incorporation', 'live', 'credits', 0, AGENCY_B);
  p.run(3, 'perk-null', PARTNER, 'Acme', 'Cloud', 'Legacy listing', 'live', 'credits', 0, null);
  // Another partner's listing, inside a company OUR partner also belongs to.
  // Only partner_user_id keeps it out of reach.
  p.run(4, 'perk-other', OTHER_PARTNER, 'Other Co', 'Design', "Someone else's perk", 'live', 'credits', 0, AGENCY_A);
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

async function call(
  path: string, who: { user: number; role: string }, company?: number | string,
  init: RequestInit = {}, e?: any,
): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
    ...(init.headers as Record<string, string> | undefined),
  };
  if (company !== undefined) headers['X-Company-Id'] = String(company);
  const res = await perks.request(path, { ...init, headers }, e ?? env(freshDb()));
  return { status: res.status, body: await res.json().catch(() => null) };
}

const ids = (rows: any[]) => (rows || []).map((r) => Number(r.id)).sort((a, b) => a - b);
const partner = { user: PARTNER, role: 'partner' };
const founder = { user: FOUNDER, role: 'founder' };

test('a partner\'s own listings narrow to the active agency', async () => {
  assert.deepEqual(ids((await call('/partner', partner, AGENCY_A)).body.items), [1, 3],
    'agency A, plus the listing with no agency');
  assert.deepEqual(ids((await call('/partner', partner, AGENCY_B)).body.items), [2, 3]);
});

test('with no agency selected, the whole partner catalog shows', async () => {
  assert.deepEqual(ids((await call('/partner', partner)).body.items), [1, 2, 3]);
});

test('a forged agency header is ignored, not obeyed', async () => {
  assert.deepEqual(ids((await call('/partner', partner, 999)).body.items), [1, 2, 3]);
  assert.deepEqual(ids((await call('/partner', partner, 'abc')).body.items), [1, 2, 3]);
});

test('editing a listing under the wrong agency is refused', async () => {
  const ok = await call('/partner/perk-a', partner, AGENCY_A, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blurb: 'Updated' }),
  });
  assert.equal(ok.status, 200);
  const no = await call('/partner/perk-a', partner, AGENCY_B, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blurb: 'Updated' }),
  });
  assert.notEqual(no.status, 200, 'the other agency must not reach this listing');
});

test('an agency cannot substitute for ownership', async () => {
  // perk-other belongs to another partner and sits in AGENCY_A — the company
  // the caller is acting for. Only partner_user_id keeps it out of reach.
  for (const co of [AGENCY_A, AGENCY_B, undefined]) {
    const r = await call('/partner/perk-other', partner, co, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blurb: 'Stolen' }),
    });
    assert.notEqual(r.status, 200, `company=${co}`);
  }
});

test('the founder-facing catalogue is a marketplace and does NOT narrow', async () => {
  // Browsed by a caller who genuinely holds AGENCY_A, so an over-narrowing
  // build would actually show up here.
  // Asserted on `uid`: the catalogue DTO deliberately does not expose internal
  // row ids, so keying this on `id` would compare a list of NaN to itself and
  // pass no matter what the handler returned.
  for (const co of [AGENCY_A, undefined]) {
    const r = await call('/', founder, co);
    assert.equal(r.status, 200);
    const items = r.body?.items ?? r.body?.perks ?? [];
    assert.deepEqual(
      items.map((x: any) => x.uid).sort(),
      ['perk-a', 'perk-b', 'perk-null', 'perk-other'],
      `company=${co}`,
    );
  }
});

test('creating a listing records the agency it was submitted under', async () => {
  const e = env(freshDb());
  const r = await call('/partner', partner, AGENCY_B, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offer: 'New perk', partner_name: 'Acme' }),
  }, e);
  assert.equal(r.status, 201);
  const inB = await call('/partner', partner, AGENCY_B, {}, e);
  const inA = await call('/partner', partner, AGENCY_A, {}, e);
  const uids = (rows: any[]) => (rows || []).map((x) => x.uid);
  assert.ok(uids(inB.body.items).includes(r.body.uid), 'visible under the agency it was made in');
  assert.ok(!uids(inA.body.items).includes(r.body.uid), 'and not under the other one');
});

// ---------- what stage 10 deliberately did NOT scope ----------

test('the credit ledger and claims stay account-level', () => {
  // A balance belongs to the person. Splitting one person's credits across
  // their firms would invent an accounting rule nobody asked for — the same
  // reasoning that leaves partner_portal's referral code alone.
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/perks.ts'), 'utf8');
  const ledger = src.slice(src.indexOf('perk_credit_ledger WHERE user_id'));
  assert.doesNotMatch(ledger.slice(0, 400), /company_id/,
    'the credit balance query must stay keyed on the account alone');
  assert.match(src, /FROM perk_claims WHERE user_id = \?/,
    'and so must the claims list');
});

test('networkfx and calendar are untouched, and the reason holds', () => {
  const nfx = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/networkfx.ts'), 'utf8');
  const cal = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/calendar.ts'), 'utf8');
  assert.doesNotMatch(nfx, /activeCompanyFor/);
  assert.doesNotMatch(cal, /activeCompanyFor/);
  // The reason, asserted rather than asserted-about: a marketplace profile is
  // ONE row per account, so there is no per-company variant to select between.
  assert.match(nfx, /ON CONFLICT\(user_id\) DO UPDATE/,
    'marketplace_profiles is unique per user — a second company would need a schema change, not a scope');
  // And a calendar aggregates one person's own events.
  assert.match(cal, /fetchUserEvents\(c\.env, user\.id/);
});
