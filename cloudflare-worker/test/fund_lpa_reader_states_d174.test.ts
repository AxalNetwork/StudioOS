/**
 * D174 — the LP drawer told an LP they were not an LP, and the fix it was
 * planned with could never have fired.
 *
 * WHAT WENT WRONG. `GET /funds/:id/lpa` returned the document and never a
 * `content_url`, under a TODO to port the FastAPI contract-minting flow into
 * the worker. So `FundsPage.jsx` fell to its `content_url`-absent branch for
 * EVERY reader and rendered:
 *
 *     Content redacted (you are not an LP of this fund).
 *
 * An LP who had just passed the server's own membership check saw that. So
 * did every admin. A false claim about ENTITLEMENT, made to the two audiences
 * who have it.
 *
 * WHY THE OBVIOUS FIX WAS THE WRONG ONE, which is the reason this file
 * exercises the route instead of reading it. Minting a signed download token
 * binds an R2 object key — and an LPA has none. `legal_documents` has twelve
 * columns in production and not one of them is `file_key`; the body is
 * `content`, inline text from the `lpa_generation` queue job. A mint here
 * would have been guarded by `if (!safeDoc.file_key)`, false on every row
 * that exists, so the button would still never have rendered and the only
 * visible change would have been a different sentence. A source scan cannot
 * see that. Four readers against a real database can.
 *
 * Run with the repo's ts loader:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs --test \
 *     cloudflare-worker/test/fund_lpa_reader_states_d174.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import funds from '../src/routes/funds.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ADMIN = 10;
const LP = 11;          // linked by user_id
const LEGACY_LP = 12;   // an unclaimed row carrying their address, no user_id
const OUTSIDER = 13;    // an investor who is not an LP of this fund
const FUND = 1;         // has an LPA with a body
const FUND_EMPTY = 2;   // has an LPA row whose body is blank
const DOC = 100;
const DOC_EMPTY = 101;

const LPA_BODY = 'LIMITED PARTNERSHIP AGREEMENT — TEST FUND I\n\n1. FUND\n   Name: Test Fund I\n';

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

/**
 * `legal_documents` is created VERBATIM from schema_baseline.sql — twelve
 * columns, no `file_key`. Adding one by hand here is the one thing this
 * fixture must not do: it would make the mint that cannot fire in production
 * fire in the test, which is precisely the reading error D174 corrects.
 */
function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT,
      email TEXT, last_active TEXT, investor_seat_primary_user_id INTEGER,
      investor_tier TEXT, investor_subscription_status TEXT, subscription_tier TEXT
    );
    CREATE TABLE vc_funds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'fundraising',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      lpa_doc_id INTEGER
    );
    -- Verbatim from sql/schema_baseline.sql:2670.
    CREATE TABLE legal_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      content TEXT,
      file_url TEXT,
      generated_by INTEGER,
      signed_by INTEGER,
      version INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    , fund_id INTEGER);
    CREATE TABLE limited_partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, fund_id INTEGER NOT NULL,
      commitment_amount REAL NOT NULL DEFAULT 0,
      invested_amount REAL NOT NULL DEFAULT 0,
      returns REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'committed',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      name TEXT, email TEXT
    );
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action_type TEXT,
      entity_type TEXT, entity_id TEXT, ip_address TEXT, user_agent TEXT,
      metadata TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE activity_stats (
      user_id INTEGER NOT NULL, stat_date TEXT NOT NULL,
      action_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, stat_date)
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, email) VALUES (?, ?, ?)');
  u.run(ADMIN, 'admin', 'admin@example.com');
  u.run(LP, 'investor', 'lp@example.com');
  u.run(LEGACY_LP, 'investor', 'legacy@example.com');
  u.run(OUTSIDER, 'investor', 'outsider@example.com');

  const d = db.prepare(
    'INSERT INTO legal_documents (id, deal_id, fund_id, type, status, content, version) VALUES (?, 0, ?, ?, ?, ?, ?)',
  );
  d.run(DOC, FUND, 'LPA', 'generated', LPA_BODY, 3);
  d.run(DOC_EMPTY, FUND_EMPTY, 'LPA', 'generated', '   ', 1);

  const f = db.prepare('INSERT INTO vc_funds (id, name, lpa_doc_id) VALUES (?, ?, ?)');
  f.run(FUND, 'Test Fund I', DOC);
  f.run(FUND_EMPTY, 'Test Fund II', DOC_EMPTY);

  const l = db.prepare('INSERT INTO limited_partners (fund_id, user_id, email) VALUES (?, ?, ?)');
  l.run(FUND, LP, 'lp@example.com');
  // The legacy row: written before the account existed, so it carries an
  // address and no link. `claimLpRowsByEmail` is what adopts it.
  l.run(FUND, null, 'legacy@example.com');
  // An LP of a DIFFERENT fund, so "is an LP somewhere" cannot pass for "is an
  // LP of this fund".
  l.run(FUND_EMPTY, OUTSIDER, 'outsider@example.com');
  return db;
}

const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function get(e: any, path: string, who: { user: number; role: string }): Promise<Response> {
  const headers = { Authorization: `Bearer ${await token(who.user, who.role)}` };
  try {
    return await funds.request(path, { headers }, e);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

const admin = { user: ADMIN, role: 'admin' };
const lp = { user: LP, role: 'investor' };
const legacy = { user: LEGACY_LP, role: 'investor' };
const outsider = { user: OUTSIDER, role: 'investor' };

test('an entitled reader is told a body exists — and is never told they are not an LP', async () => {
  for (const who of [admin, lp, legacy]) {
    const e = env(freshDb());
    const res = await get(e, `/${FUND}/lpa`, who);
    assert.equal(res.status, 200, `user ${who.user}`);
    const body: any = await res.json();
    assert.equal(body.content_available, true, `user ${who.user} was not offered the body`);
    // The whole defect: `redacted` is what the page turns into "you are not an
    // LP of this fund", and no entitled reader may carry it.
    assert.equal(body.redacted, undefined, `user ${who.user} was flagged redacted`);
  }
});

test('the body never rides the metadata response, for anyone', async () => {
  // Security #8. The drawer opening is not the same act as the download.
  for (const who of [admin, lp, legacy, outsider]) {
    const e = env(freshDb());
    const res = await get(e, `/${FUND}/lpa`, who);
    const body: any = await res.json();
    assert.equal(body.doc?.content, undefined, `user ${who.user} was sent the LPA text`);
    assert.ok(!JSON.stringify(body).includes('LIMITED PARTNERSHIP AGREEMENT'),
      `the LPA text reached user ${who.user} in the metadata payload`);
  }
});

test('a non-LP is refused, and told that specifically', async () => {
  const e = env(freshDb());
  const res = await get(e, `/${FUND}/lpa`, outsider);
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.redacted, true);
  assert.equal(body.content_available, undefined, 'a non-LP was offered the body');
  // `file_url` is the one column on this table that points AT a body, so it
  // is the one the non-LP branch withholds.
  assert.equal('file_url' in (body.doc ?? {}), false, 'a non-LP was handed file_url');
});

test('an LPA row with no stored body is its own state, not a refusal', async () => {
  // The state that turns out to be the ONLY one in production today, because
  // nothing has ever written a body for a second fund. It must not borrow the
  // entitlement sentence.
  const e = env(freshDb());
  const res = await get(e, `/${FUND_EMPTY}/lpa`, admin);
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.content_available, false);
  assert.equal(body.redacted, undefined, 'an empty body was reported as a missing entitlement');
});

test('the download hands over the text, as an attachment, to an entitled reader', async () => {
  for (const who of [admin, lp, legacy]) {
    const e = env(freshDb());
    const res = await get(e, `/${FUND}/lpa/download`, who);
    assert.equal(res.status, 200, `user ${who.user}`);
    assert.match(res.headers.get('content-type') || '', /^text\/plain/);
    // Built from two integers — the fund id and the row's version — so no
    // stored text can reach a response header.
    assert.equal(res.headers.get('content-disposition'), 'attachment; filename="lpa-fund-1-v3.txt"');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(await res.text(), LPA_BODY);
  }
});

test('the download refuses the same reader the metadata route redacts', async () => {
  // The control this whole shape exists for. Two copies of an entitlement
  // check is how a download route ends up more permissive than the screen
  // that links to it — and the download is the half that hands over the text.
  const e = env(freshDb());
  const res = await get(e, `/${FUND}/lpa/download`, outsider);
  assert.equal(res.status, 403);
  const body: any = await res.json();
  assert.equal(body.code, 'lpa_not_entitled');
  assert.ok(!JSON.stringify(body).includes('LIMITED PARTNERSHIP AGREEMENT'));
});

test('"nothing to give you" and "you may not have it" stay different answers', async () => {
  const e = env(freshDb());
  const res = await get(e, `/${FUND_EMPTY}/lpa/download`, admin);
  assert.equal(res.status, 404);
  assert.equal((await res.json() as any).code, 'lpa_no_body');
});

test('a download is recorded, and a failed recording does not fail the download', async () => {
  const db = freshDb();
  const e = env(db);
  assert.equal((await get(e, `/${FUND}/lpa/download`, lp)).status, 200);
  const row: any = db.prepare(
    `SELECT action_type, entity_type, entity_id FROM activity_logs WHERE user_id = ?`,
  ).get(LP);
  assert.deepEqual({ ...row }, { action_type: 'fund_lpa_downloaded', entity_type: 'vc_fund', entity_id: '1' });

  // Same download with the audit table gone: the reader still gets their
  // agreement. A recorded act must not be undone by its own bookkeeping.
  const db2 = freshDb();
  db2.exec('DROP TABLE activity_logs');
  const res = await get(env(db2), `/${FUND}/lpa/download`, lp);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), LPA_BODY);
});

test('a fund with no LPA at all is a 404 on both routes, before any entitlement is computed', async () => {
  const db = freshDb();
  db.prepare('UPDATE vc_funds SET lpa_doc_id = NULL WHERE id = ?').run(FUND);
  for (const path of [`/${FUND}/lpa`, `/${FUND}/lpa/download`]) {
    const res = await get(env(db), path, admin);
    assert.equal(res.status, 404, path);
  }
});
