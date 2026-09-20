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
    id INTEGER PRIMARY KEY CHECK (id = 1), licence_uid TEXT NOT NULL, licence_ref TEXT,
    legal_entity TEXT, brand_name TEXT,
    territory TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', seats_json TEXT,
    revenue_share_bps INTEGER, token_split_bps INTEGER, annual_fee_cents INTEGER,
    currency TEXT, term_start TEXT, term_end TEXT,
    renewal_at TEXT, template_version TEXT, suspended_at TEXT, suspended_note TEXT,
    -- Migration 265 (D137). A fixture NARROWER than the schema does not fail
    -- honestly: the SELECT throws, the payload degrades to licence_not_pushed,
    -- and every assertion below reads "HQ has not pushed this branch its
    -- licence" about a row that is sitting right there. Same lesson as D133.
    -- (No backticks in here: this comment lives inside a JS template literal.)
    registered_address TEXT, signatory_name TEXT, signatory_title TEXT,
    term_years INTEGER, terminated_at TEXT,
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
    (id, licence_uid, licence_ref, legal_entity, brand_name, territory, status, seats_json,
     revenue_share_bps, token_split_bps, template_version,
     term_start, renewal_at, suspended_note,
     registered_address, signatory_name, signatory_title, term_years,
     pushed_at)
  VALUES (1, 'lic_fr_001', 'AXL-001', 'Axal VC France SAS', 'Axal VC France', 'FR, BE,lu', 'active',
          '{"founder":200,"investor_lp":80,"advisor":30,"service_partner":15}',
          3500, 3100, 'v4',
          '2026-01-01', '2027-01-01', 'Fees outstanding since Q2.',
          '12 rue de la Paix, 75002 Paris', 'Claire Dubois', 'Managing Director', 3,
          '2026-09-14T22:10:00Z');
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
  // D127 — SEATS USED IS A NUMBER HERE NOW, and this assertion moved rather
  // than loosened. It read `=== null` with the reason "seats USED still has no
  // store", which was true when the only way to know was `seat_assignments`.
  // A branch counts its own instead: this fixture seeds no users, so 0 is the
  // right answer and it is a FIGURE — the read succeeded — not the fabricated
  // zero the old line was guarding against. That distinction is the whole
  // point, so it is asserted with a seeded branch below rather than left to
  // this empty one.
  assert.equal(body.licence.seats_used, 0, 'a branch counts its own seats; an empty one holds none');
  assert.match(String(body.licence.seats_used_basis), /Role is not a licensed seat/,
    'the number must carry what it means, or it reads as a seat ledger');
  assert.equal(body.derived_metrics_available, false);
  assert.ok(String(body.derived_metrics_reason).length > 0);
  // AND THE PAYLOAD MUST NOT CONTRADICT ITSELF. The shared reason said seats
  // used was "not shown" while the field beside it carried a number — for the
  // length of one commit, which this caught.
  //
  // THIS ASSERTION WAS DECORATION FIRST, and the mutation check is what found
  // it. Written as `doesNotMatch(/Seats used[^.]*not shown/)`, it could no
  // longer fail: the same commit had already narrowed the SHARED constant to
  // drop that clause, so reverting this route to it changed nothing the
  // pattern could see. What actually distinguishes the two sentences is that
  // the branch one says the figure IS shown, so that is what is asserted —
  // and reverting to the shared constant now fails, as it must.
  assert.match(String(body.derived_metrics_reason), /Seats used is shown/,
    'the branch reason must say the figure is there, or it is HQ\'s sentence on the wrong tier');
  assert.doesNotMatch(String(body.derived_metrics_reason), /Seats used[^.]*not shown/,
    'the branch payload says seats used is unavailable while showing it');
});

test('a branch with accounts counts only the roles a licence sells a seat for', async () => {
  // The empty case above cannot tell a correct count from a hardcoded zero.
  // This one can: six active accounts across six roles, one deactivated.
  const seeded = db(`${PUSHED}
    INSERT INTO users (id, email, name, role, is_active) VALUES
      (101, 'f@x.test', 'F', 'founder',   1),
      (102, 'i@x.test', 'I', 'investor',  1),
      (103, 'a@x.test', 'A', 'advisor',   1),
      (104, 'p@x.test', 'P', 'partner',   1),
      (105, 'd@x.test', 'D', 'admin',     1),
      (106, 'e@x.test', 'E', 'exploring', 1),
      (107, 'g@x.test', 'G', 'founder',   0);`);
  const { body } = await get({ ...FR, DB: makeD1(seeded) });
  assert.equal(body.licence.seats_used, 4,
    'admin and exploring hold no seat, and a deactivated account released theirs');
});

test('the per-type breakdown is the same rows un-summed, zeroes included', async () => {
  // D129 — S2 draws one tile per licence type, so the page needs used-per-type
  // beside licensed-per-type. Two properties matter and neither is implied by
  // the total above:
  //
  //   1. THE PARTS SUM TO THE WHOLE. If the breakdown were built by a second
  //      query it could ask a subtly different question — a different
  //      `is_active` predicate, say — and the tiles would disagree with the
  //      total sitting beside them. Asserting the sum is what pins that they
  //      come from one read.
  //   2. A ROLE WITH NO ACCOUNTS GETS A MEASURED ZERO. SQLite returns no row
  //      for a group with no members, so a naive map omits the key entirely and
  //      the page must then choose between rendering nothing and inventing a
  //      zero. `advisor` below is that case, and `partner` is deliberately
  //      absent from the seed too.
  const seeded = db(`${PUSHED}
    INSERT INTO users (id, email, name, role, is_active) VALUES
      (201, 'f1@x.test', 'F1', 'founder',   1),
      (202, 'f2@x.test', 'F2', 'founder',   1),
      (203, 'i1@x.test', 'I1', 'investor',  1),
      (204, 'x1@x.test', 'X1', 'admin',     1),
      (205, 'f3@x.test', 'F3', 'founder',   0);`);
  const { body } = await get({ ...FR, DB: makeD1(seeded) });
  const byType = body.licence.seats_used_by_type;
  assert.deepEqual(
    byType,
    { founder: 2, investor: 1, advisor: 0, partner: 0 },
    'the breakdown must carry every seat role, with a measured zero where a role holds none',
  );
  assert.equal(
    Object.values(byType as Record<string, number>).reduce((a, b) => a + b, 0),
    body.licence.seats_used,
    'the tiles and the total disagree, so they are not coming from one read',
  );
  assert.ok(
    !('admin' in (byType as Record<string, number>)),
    'a role that holds no seat reached the seat tiles',
  );
});

test('an uncountable account table gives null, not four zeroes', async () => {
  // The distinction the canvas draws between unknown and zero, at the one place
  // it can collapse: `seats_used_by_type: {founder:0,…}` says the query ran and
  // found nobody. `null` says it could not run. A page cannot tell those apart
  // from the same value, and S2's tiles would render "0 of 200" for both.
  //
  // THE FAILURE IS AIMED AT THE QUERY, NOT THE TABLE. A first draft dropped
  // `users` outright, which does not test this path at all: `requireAuth`
  // hydrates the caller from that table, so the request never reaches the
  // count and `body.licence` came back undefined. The assertion would have
  // been measuring a 403. Failing the one statement is what exercises the
  // try/catch this test is about.
  const real = makeD1(db(PUSHED));
  const failing = {
    ...real,
    prepare(sql: string) {
      if (!sql.includes('GROUP BY role')) return real.prepare(sql);
      const boom = () => { throw new Error('no such table: users'); };
      const stub: any = {
        bind: () => stub,
        async first() { return boom(); },
        async all() { return boom(); },
        async run() { return boom(); },
      };
      return stub;
    },
  };
  const { body } = await get({ ...FR, DB: failing });
  assert.equal(body.licence.seats_used, null, 'an uncountable table reported a number');
  assert.equal(body.licence.seats_used_by_type, null,
    'an uncountable table reported a breakdown, which would render as four measured zeroes');
  // And the licence terms beside it still render — the count has its own
  // try/catch precisely so one failure does not blank the other.
  assert.equal(body.licence.seats_licensed, 325, 'a failed count blanked the licence summary');
});

test('the copy uses HQ\'s field names, because the page that reads it is HQ\'s page', async () => {
  // D107 — this is a REGRESSION GUARD for a real defect, not a shape check.
  // `branch_licence` stores `legal_entity`; the HQ payload calls the same fact
  // `legal_entity_name`, and `MyLicencePage` reads the HQ name. The copy
  // returned its own column names, so the one screen it exists to render
  // showed a blank entity and a licence with no reference on it — on the one
  // tier nobody had run yet. Migration 257 added the missing `licence_ref`.
  //
  // Asserted against the HQ payload's key NAMES rather than against a list
  // written here, so a rename on either side fails rather than drifting.
  const { body } = await get({ ...FR, DB: makeD1(db(PUSHED)) });
  assert.equal(body.licence.legal_entity_name, 'Axal VC France SAS');
  assert.equal(body.licence.licence_ref, 'AXL-001');
  assert.ok(
    !('legal_entity' in body.licence),
    'the copy must not ALSO emit its own column name — two spellings of one fact is how they diverge',
  );

  // D137 — EVERY KEY THE PAGE READS, DERIVED FROM THE PAGE. The four typed
  // here before were the four somebody remembered, and the other eight went on
  // being emitted under the TABLE's names or not at all: `starts_on`,
  // `renews_on` and `status_note` were `term_start`, `renewal_at` and
  // `suspended_note`, and `term_years`, `registered_address`, `signatory_name`,
  // `signatory_title` and `terminated_at` were never stored. So the Entity
  // panel printed "Not recorded" four times about facts HQ holds, and the
  // sentence saying WHY a licence was suspended was blank on the page a
  // suspended administrator is sent to.
  //
  // Deriving the list means the next field added to the page fails here rather
  // than rendering blank on a tier nobody has run yet — which is how all eight
  // of these survived.
  const page = readFileSync(new URL('../../frontend/src/pages/subsidiary/MyLicencePage.jsx', import.meta.url), 'utf8');
  const readKeys = [...new Set([...page.matchAll(/\bl\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1]))];
  assert.ok(readKeys.length >= 12, `only ${readKeys.length} keys parsed out of the page — the scan is broken, not the payload`);
  for (const key of readKeys) {
    assert.ok(key in body.licence, `the page renders l.${key} and the branch payload does not supply it`);
  }
  // And the table's own spellings must NOT also appear: two names for one fact
  // is how they diverge, which is the defect this test was opened for.
  for (const columnName of ['legal_entity', 'term_start', 'renewal_at', 'suspended_note']) {
    assert.ok(
      !(columnName in body.licence),
      `the copy also emits its own column name "${columnName}" — one fact, one spelling`,
    );
  }
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

test('the three platform-content cadences are gated on HQ in the scheduled handler', () => {
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
    /if \(hqCadences && \[0, 6, 12, 18\]\.includes\(now\.getUTCHours\(\)\)/,
    /if \(hqCadences\) \{\s*\n\s*try \{\s*\n\s*const \{ sendMarketIntelDigests \}/,
  ];
  // D175 — THE COUNT LIVES IN AN ASSERTION, NOT ONLY IN THE TEST'S NAME.
  // It was in the title alone when the personas digest was retired, so
  // dropping its regex left a test called "the four" checking three. That is
  // the `sidebarConfig.js` shape D146 had to correct — a number in prose above
  // a list that no longer matches it. A fourth cadence added later must move
  // this figure and the title together.
  assert.equal(gated.length, 3, 'the cadence count moved; update the title in the same edit');
  for (const re of gated) assert.match(src, re, `a platform-content cadence lost its HQ gate: ${re}`);

  // D175 — and the retired one must stay retired. The personas weekly digest
  // was the fourth cadence; deleting the block without this assertion would
  // let a later edit re-add the fan-out with no gate and nothing would notice.
  assert.doesNotMatch(src, /sendPlatformPersonasDigest/, 'the retired personas digest cron is back (D175)');

  // And the other direction: branch-local work is NOT gated. A gate that
  // swallowed the queue drain or the trust sweeps would leave every branch
  // silently not doing its own housekeeping.
  assert.match(src, /if \(now\.getUTCHours\(\) === 4 && now\.getUTCMinutes\(\) === 35\)/, 'trust expiry stays per branch');
  assert.match(src, /if \(now\.getUTCHours\(\) === 4 && now\.getUTCMinutes\(\) === 40\)/, 'partner-deal expiry stays per branch');
  assert.match(src, /if \(now\.getUTCHours\(\) === 3 && now\.getUTCMinutes\(\) === 0\) \{\s*\n\s*await Jobs\.cleanup/, 'job cleanup stays per branch');

  // D122 — the support-session sweep joins that second list, and the negative
  // is the whole point. It looks like branch-only work, so the tempting "tidy"
  // is to move it under `hqCadences` with the platform-content cadences. That
  // would stop it running on the one tier whose rows it exists to close. It is
  // safe everywhere because `admin_user_id = 0` is a value HQ can never write,
  // so the predicate is the tier gate and the cron block needs none.
  // Anchored on the IMPORT, not on the function name. A mutation that replaced
  // the import with a local stub left the name in place and walked straight
  // through an earlier version of this assertion — the same shape as the #589
  // escape, where a scan matched a literal a `throw` had been inserted above.
  // The module specifier is the thing that cannot be faked by a stub.
  const sweep = src.indexOf("await import('./util/supportSessionSweep')");
  assert.ok(sweep > 0, 'the support-session sweep is no longer wired into the cron');
  assert.match(
    src.slice(sweep, sweep + 200),
    /closeExpiredSupportSessions\(env\)/,
    'the sweep is imported but never called with env',
  );
  const block = src.slice(Math.max(0, sweep - 400), sweep);
  assert.match(block, /if \(now\.getUTCMinutes\(\) % 5 === 0\) \{/, 'the sweep lost its cadence');
  assert.ok(
    !/hqCadences\s*&&[^\n]*\n[\s\S]{0,200}$/.test(block),
    'the support-session sweep was gated on hqCadences — it would then never run on a branch',
  );
});
