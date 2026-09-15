/**
 * D106 — a branch reads its licence from the copy HQ pushed, and says so.
 *
 * THE FAILURE THIS GUARDS is quieter than a leak and just as wrong. On a
 * branch, `licence_admins` and `territory_licences` EXIST — the database is
 * bootstrapped from the same baseline — and they are empty, because the
 * ledger is HQ's. So the unchanged route would answer its 404, "You do not
 * administer a territory licence", to the one person on the deployment who
 * does. A row in another database and a row that does not exist must not read
 * alike, and the two 404s here carry different codes for exactly that reason.
 *
 * The second half is the stamp. Everything a branch shows from HQ shows its
 * age; a response that carried the copy without `source` and `as_of` would
 * let a screen render a week-old licence as though it were live, which is the
 * thing the subsidiary canvas refuses on every artboard.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/branch_licence_copy.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import licence from '../src/routes/licence.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 7;

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
        async run() { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes) } }; },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out: any[] = []; for (const st of x || []) out.push(await st.run().catch(() => ({}))); return out; },
  };
}

/** The 256 tables plus the HQ ledger tables a branch database also carries, empty. */
const SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                      jwt_min_iat INTEGER, name TEXT, email TEXT);
  CREATE TABLE licence_admins (user_id INTEGER PRIMARY KEY, licence_id INTEGER, admin_role TEXT);
  CREATE TABLE territory_licences (id INTEGER PRIMARY KEY, uid TEXT, legal_entity TEXT, status TEXT);
  CREATE TABLE licence_territories (licence_id INTEGER, country_code TEXT);
  CREATE TABLE licence_seats (licence_id INTEGER, seat_type TEXT, seats_licensed INTEGER);
  CREATE TABLE licence_events (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER,
                               event TEXT, note TEXT, detail_json TEXT, created_at TEXT);
  CREATE TABLE branch_licence (
    id INTEGER PRIMARY KEY CHECK (id = 1), licence_uid TEXT NOT NULL, legal_entity TEXT, brand_name TEXT,
    territory TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', seats_json TEXT,
    revenue_share_bps INTEGER, token_split_bps INTEGER, annual_fee_cents INTEGER,
    currency TEXT, term_start TEXT, term_end TEXT,
    renewal_at TEXT, template_version TEXT, suspended_at TEXT, suspended_note TEXT,
    pushed_at TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
`;

function db(seed = '') {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  d.exec(SCHEMA);
  d.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)')
    .run(ADMIN, 'admin', 'Sue', 'sue@axal.example');
  if (seed) d.exec(seed);
  return d;
}

const PUSHED = `
  INSERT INTO branch_licence
    (id, licence_uid, legal_entity, brand_name, territory, status, seats_json,
     revenue_share_bps, token_split_bps, template_version, pushed_at)
  VALUES (1, 'lic_fr_001', 'Axal VC France SAS', 'Axal VC France', 'FR, BE,lu', 'active',
          '{"founder":200,"investor_lp":80,"advisor":30,"service_partner":15}',
          3500, 3100, 'v4', '2026-09-14T22:10:00Z');
`;

const app = new Hono<any>();
app.route('/licence', licence);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 403));

async function get(env: Record<string, unknown>) {
  const token = await new SignJWT({ user_id: ADMIN, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request('/licence/mine', { headers: { Authorization: `Bearer ${token}` } }, env);
  return { status: res.status, body: await res.json() as any };
}

const base = { JWT_SECRET, ENVIRONMENT: 'development' };
const HQ = { ...base, APP_URL: 'https://axal.vc' };
const FR = { ...base, BRANCH_CODE: 'fr', BRANCH_NAME: 'Axal VC France', BRANCH_TERRITORY: 'FR,BE,LU', APP_URL: 'https://fr.axal.vc' };

test('a branch serves the pushed copy, with the stamp that says how old it is', async () => {
  const { status, body } = await get({ ...FR, DB: makeD1(db(PUSHED)) });
  assert.equal(status, 200);
  assert.equal(body.source, 'hq_copy', 'the response must declare that this is a copy');
  assert.equal(body.as_of, '2026-09-14T22:10:00Z', 'as_of is HQ\'s assertion time, not this row\'s write time');
  assert.equal(body.branch, 'fr');
  assert.equal(body.licence.uid, 'lic_fr_001');
  assert.equal(body.licence.status, 'active');
  // Territory is stored as HQ wrote it and normalised on the way out, so a
  // stray space or a lower-case code in the push does not reach the screen.
  assert.deepEqual(body.licence.territories, ['FR', 'BE', 'LU']);
  assert.equal(body.licence.seats_licensed, 325, 'seats licensed is the sum of the pushed per-type grants');
  assert.equal(body.licence.seats_used, null, 'seats USED still has no store — it must not read as zero');
  assert.equal(body.derived_metrics_available, false, 'the derived-metrics reason is the same on both tiers');
  assert.ok(String(body.derived_metrics_reason).length > 0);
});

test('the event trail is absent with a reason, not an empty history', async () => {
  const { body } = await get({ ...FR, DB: makeD1(db(PUSHED)) });
  assert.deepEqual(body.events, []);
  assert.equal(body.events_available, false, 'an empty array alone would claim nothing has happened');
  assert.match(String(body.events_reason), /held at HQ/);
});

test('a branch HQ has not pushed to says so — a different 404 from "you administer nothing"', async () => {
  // No branch_licence row: provisioning ran, the push has not.
  const notPushed = await get({ ...FR, DB: makeD1(db()) });
  assert.equal(notPushed.status, 404);
  assert.equal(notPushed.body.error, 'licence_not_pushed');
  assert.equal(notPushed.body.branch, 'fr');

  // HQ, same empty ledger, keeps its own 404 and its own code. If these two
  // collapsed into one answer, support could not tell "the push has not
  // happened" from "this person administers no licence".
  const onHq = await get({ ...HQ, DB: makeD1(db()) });
  assert.equal(onHq.status, 404);
  assert.equal(onHq.body.error, 'no_licence');
  assert.notEqual(onHq.body.error, notPushed.body.error);
});

test('HQ never reads the copy, even when one is present', async () => {
  // A branch_licence row sitting in HQ's database must change nothing: the
  // ledger is HQ's truth, and reading a copy of your own ledger is a way to
  // disagree with yourself.
  const { status, body } = await get({ ...HQ, DB: makeD1(db(PUSHED)) });
  assert.equal(status, 404, 'HQ answers from licence_admins, which is empty here');
  assert.equal(body.error, 'no_licence');
  assert.equal(body.source, undefined, 'HQ must never stamp a response as a copy');
});

test('the four platform-content cadences are gated on HQ in the scheduled handler', () => {
  // Source-parsed because the alternative is booting the cron. The claim
  // being pinned is narrow and exact: the cron TRIM in the generated branch
  // config does not stop any of these — a branch keeps `* * * * *` and every
  // block gates on the wall clock — so the gate must be in this file, and a
  // later edit that drops it would otherwise be invisible until N branches
  // each hit the same external APIs.
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(src, /const hqCadences = branchOf\(env\) === null;/);

  const gated = [
    /if \(hqCadences && now\.getUTCHours\(\) === 4 && now\.getUTCMinutes\(\) === 20\) \{\s*\n\s*try \{\s*\n\s*const \{ runRefresh \}/,
    /if \(hqCadences && now\.getUTCDay\(\) === 1 && now\.getUTCHours\(\) === 9 && now\.getUTCMinutes\(\) === 0\) \{[\s\S]{0,140}sendPlatformPersonasDigest/,
    /if \(hqCadences && \[0, 6, 12, 18\]\.includes\(now\.getUTCHours\(\)\)/,
    /if \(hqCadences\) \{\s*\n\s*try \{\s*\n\s*const \{ sendMarketIntelDigests \}/,
  ];
  for (const re of gated) assert.match(src, re, `a platform-content cadence lost its HQ gate: ${re}`);

  // And the other direction: branch-local work is NOT gated. A gate that
  // swallowed the queue drain or the trust sweeps would leave every branch
  // silently not doing its own housekeeping.
  assert.match(src, /if \(now\.getUTCHours\(\) === 4 && now\.getUTCMinutes\(\) === 35\)/, 'trust expiry stays per branch');
  assert.match(src, /if \(now\.getUTCHours\(\) === 4 && now\.getUTCMinutes\(\) === 40\)/, 'partner-deal expiry stays per branch');
  assert.match(src, /if \(now\.getUTCHours\(\) === 3 && now\.getUTCMinutes\(\) === 0\) \{\s*\n\s*await Jobs\.cleanup/, 'job cleanup stays per branch');
});
