/**
 * D137 — HQ's licence transitions reaching the branch that runs under them.
 *
 * THE DEFECT. `applyLicence` had NO CALLER. `POST /:uid/suspend` changed four
 * columns in HQ's ledger and nothing on the subsidiary, and D135 made that
 * urgent rather than theoretical: the compliance sweep now suspends a licence
 * on a clock, so an account HQ believes is frozen belonged to a branch that
 * went on trading.
 *
 * WHAT IS ASSERTED, and why it is behaviour rather than spelling: the push is
 * REPORTED and never thrown (D111), so every failure mode has to produce a
 * `pushed.ok === false` with a sentence rather than an exception — and the
 * transition has to stay recorded through all of them. A source scan cannot
 * see any of that.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/licence_push_d137.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { pushLicenceToBranch, licenceRecord } from '../src/services/licencePush.ts';

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind(...args: any[]) { b = coerce(args); return api; },
        async first<T>() { try { return (db.prepare(sql).get(...b) as T) ?? null; } catch (e) { throw e; } },
        async all<T>() { return { results: db.prepare(sql).all(...b) as T[] }; },
        async run() { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes) } }; },
      };
      return api;
    },
  };
}

const SCHEMA = `
  CREATE TABLE territory_licences (
    id INTEGER PRIMARY KEY, uid TEXT, licence_ref TEXT, legal_entity_name TEXT, brand_name TEXT,
    registered_address TEXT, signatory_name TEXT, signatory_title TEXT, status TEXT,
    term_years INTEGER, annual_fee_cents INTEGER, currency TEXT,
    revenue_share_bps INTEGER, token_split_bps INTEGER,
    starts_on TEXT, renews_on TEXT, suspended_at TEXT, terminated_at TEXT, status_note TEXT,
    kind TEXT NOT NULL DEFAULT 'subsidiary' CHECK (kind IN ('subsidiary', 'white_label')));
  CREATE TABLE licence_deployments (id INTEGER PRIMARY KEY, licence_uid TEXT, code TEXT);
  CREATE TABLE licence_territories (licence_id INTEGER, country_code TEXT);
  CREATE TABLE licence_seats (licence_id INTEGER, seat_type TEXT, seats_licensed INTEGER);
  CREATE TABLE licence_contracts (id INTEGER PRIMARY KEY, licence_uid TEXT, template_version INTEGER);
`;

/** One active FR licence with every field HQ holds populated. */
function db(opts: { deployed?: boolean } = {}) {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  d.exec(SCHEMA);
  d.prepare(
    `INSERT INTO territory_licences
       (id, uid, licence_ref, legal_entity_name, brand_name, registered_address,
        signatory_name, signatory_title, status, term_years, annual_fee_cents, currency,
        revenue_share_bps, token_split_bps, starts_on, renews_on, status_note)
     VALUES (1,'lic_fr','AXL-001','Axal VC France SAS','Axal VC France','12 rue de la Paix',
             'Claire Dubois','Managing Director','suspended',3,5000000,'EUR',3500,3100,
             '2026-01-01','2027-01-01','Fees outstanding since Q2.')`,
  ).run();
  d.prepare("INSERT INTO licence_territories (licence_id, country_code) VALUES (1,'BE'),(1,'FR')").run();
  d.prepare("INSERT INTO licence_seats (licence_id, seat_type, seats_licensed) VALUES (1,'founder',200),(1,'advisor',30)").run();
  d.prepare("INSERT INTO licence_contracts (id, licence_uid, template_version) VALUES (1,'lic_fr',4)").run();
  if (opts.deployed !== false) {
    d.prepare("INSERT INTO licence_deployments (id, licence_uid, code) VALUES (1,'lic_fr','fr')").run();
  }
  return d;
}

/** A branch binding that records what it was handed. */
function stub(answer: any = { applied: true }) {
  const seen: any[] = [];
  return {
    seen,
    binding: {
      applyLicence: async (record: any) => {
        seen.push(record);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  };
}

test('a bound branch receives the copy, and the push reports that it landed', async () => {
  const d = db();
  const s = stub();
  const res = await pushLicenceToBranch({ DB: makeD1(d), BRANCH_FR: s.binding } as any, 1, '2026-09-16T20:00:00Z');
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.code, 'fr');
  assert.equal(s.seen.length, 1, 'the branch was not called');
});

test('the record carries the five fields migration 265 added', async () => {
  // The whole reason 265 exists: without these the branch's Entity panel prints
  // "Not recorded" four times about facts HQ holds, and a terminated licence
  // never shows when it ended.
  const d = db();
  const s = stub();
  await pushLicenceToBranch({ DB: makeD1(d), BRANCH_FR: s.binding } as any, 1);
  const rec = s.seen[0];
  assert.equal(rec.registered_address, '12 rue de la Paix');
  assert.equal(rec.signatory_name, 'Claire Dubois');
  assert.equal(rec.signatory_title, 'Managing Director');
  assert.equal(rec.term_years, 3);
  assert.ok('terminated_at' in rec, 'terminated_at must ride even when null');
});

test('the record is in branch_licence\'s column vocabulary, which is what the upsert binds', async () => {
  // The copy is written by NAME. A record keyed in HQ's vocabulary would bind
  // nothing and leave every one of these columns NULL, silently.
  const d = db();
  const s = stub();
  await pushLicenceToBranch({ DB: makeD1(d), BRANCH_FR: s.binding } as any, 1);
  const rec = s.seen[0];
  assert.equal(rec.legal_entity, 'Axal VC France SAS', 'HQ\'s legal_entity_name maps to the column legal_entity');
  assert.equal(rec.term_start, '2026-01-01');
  assert.equal(rec.renewal_at, '2027-01-01');
  assert.equal(rec.suspended_note, 'Fees outstanding since Q2.');
  assert.equal(rec.territory, 'BE,FR', 'territories travel as the comma list the column holds');
  assert.deepEqual(JSON.parse(rec.seats_json), { founder: 200, advisor: 30 });
  assert.equal(rec.template_version, 4);
});

test('term_end is null: the copy does not invent a fact HQ does not hold', () => {
  // `branch_licence` has the column and `territory_licences` has no end date —
  // it holds a DURATION. Deriving one here would be the copy asserting
  // something HQ never said, which is the rule 257 and 265 both state.
  const rec = licenceRecord(
    { uid: 'x', starts_on: '2026-01-01', term_years: 3 } as any, [], {}, null, 'stamp',
  );
  assert.equal(rec.term_end, null);
  assert.equal(rec.term_years, 3, 'the duration HQ does hold still travels');
});

test('pushed_at is HQ\'s stamp, passed through rather than made on the branch', async () => {
  // Migration 256: it is the moment HQ ASSERTED the content, so a retry keeps
  // the age of the fact rather than resetting it.
  const d = db();
  const s = stub();
  await pushLicenceToBranch({ DB: makeD1(d), BRANCH_FR: s.binding } as any, 1, '2026-01-02T03:04:05Z');
  assert.equal(s.seen[0].pushed_at, '2026-01-02T03:04:05Z');
});

test('a licence with no deployment is not a failure, and says so in its own words', async () => {
  const d = db({ deployed: false });
  const res = await pushLicenceToBranch({ DB: makeD1(d) } as any, 1);
  assert.equal(res.ok, false);
  assert.equal(res.code, null);
  assert.match(String(res.reason), /no branch deployment/i);
  assert.match(String(res.reason), /recorded at HQ/, 'the operator must be told the write stands');
});

test('a deployment with no binding reports the branch it could not reach', async () => {
  // A DIFFERENT state from "not deployed": provisioning ran and HQ has not been
  // redeployed with the service binding yet. Same shape as D111's escalation.
  const d = db();
  const res = await pushLicenceToBranch({ DB: makeD1(d) } as any, 1);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'fr');
  assert.match(String(res.reason), /No branch Worker is bound for fr/);
  assert.match(String(res.reason), /recorded at HQ/);
});

test('a branch that throws is REPORTED, never rethrown', async () => {
  // The whole D111 rule. A 502 here would ask an operator to re-suspend
  // something already suspended, and the retry would find it done.
  const d = db();
  const s = stub(new Error('branch offline'));
  const res = await pushLicenceToBranch({ DB: makeD1(d), BRANCH_FR: s.binding } as any, 1);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'fr');
  assert.match(String(res.reason), /branch offline/, 'the branch\'s own message must survive');
});

test('a branch that REFUSES the copy surfaces its own sentence, not a generic success', async () => {
  const d = db();
  const s = stub({ ok: false, reason: 'this branch holds a different licence' });
  const res = await pushLicenceToBranch({ DB: makeD1(d), BRANCH_FR: s.binding } as any, 1);
  assert.equal(res.ok, false);
  assert.match(String(res.reason), /different licence/);
  assert.equal(res.code, 'fr', 'the code is added even when the branch answered for itself');
});

test('a licence HQ cannot re-read does not push a partial copy', async () => {
  const d = db();
  d.exec('DROP TABLE licence_territories');
  const s = stub();
  const res = await pushLicenceToBranch({ DB: makeD1(d), BRANCH_FR: s.binding } as any, 1);
  assert.equal(res.ok, false);
  assert.equal(s.seen.length, 0, 'a copy without its territory would tell the branch it holds no country');
});

test('every licence transition reports the push beside its own outcome', () => {
  // Wiring, which the unit tests above cannot see: each of the five routes must
  // return `pushed`. The behaviour of `pushed` itself is asserted above.
  const src = readFileSync(new URL('../src/routes/admin_licences.ts', import.meta.url), 'utf8');
  const calls = [...src.matchAll(/await pushLicenceToBranch\(c\.env, licence\.id\)/g)];
  assert.equal(calls.length, 5, `expected five transitions to push, found ${calls.length}`);
  for (const status of ['active', 'suspended', 'terminated']) {
    assert.ok(
      new RegExp(`status: '${status}'[^}]*pushed`).test(src) || src.includes(`status: '${status}', pushed }`),
      `the ${status} transition does not return pushed`,
    );
  }
  assert.ok(src.includes('renews_on: next, pushed'), 'renew does not return pushed');
});

test('the sweep counts what LANDED separately from what it suspended', () => {
  // Folding them into one number would report a freeze as complete when only
  // half of it happened — HQ's ledger changed and the branch never heard.
  const src = readFileSync(new URL('../src/services/complianceLadder.ts', import.meta.url), 'utf8');
  assert.match(src, /suspended: number;/);
  assert.match(src, /pushed: number;/);
  assert.match(src, /if \(push\.ok\) out\.pushed \+= 1;/);
  assert.match(src, /pushLicenceToBranch\(env, l\.id, stamp\)/,
    'the sweep must push with the SAME stamp it wrote, not a second clock');
});
