/**
 * D206 — a white-label's `content` escalation is refused at both ends, and the
 * licence kind reaches the branch so it can say so first.
 *
 * WHAT THIS FILE HOLDS, each a way the gate fails quietly:
 *
 *   1. ONE RULE. `escalationKindsFor` is read by HQ's `recordEscalation`, the
 *      branch route and the branch drawer. `KIND_GATED_ESCALATIONS` — the only
 *      kinds HQ reads its ledger for — must equal every kind the rule can hide,
 *      or a kind hidden on the branch goes unchecked at HQ.
 *   2. HQ FAILS CLOSED, THE BRANCH FAILS OPEN. HQ's ledger is the authority, so
 *      a ledger HQ cannot read, or a deployment naming a licence it does not
 *      hold, is a refusal. The branch's copy is only a copy, so a copy it cannot
 *      read offers every kind and lets HQ decide. And an UNGATED kind never
 *      touches the ledger at all — `other` is the appeal path (D107), and an
 *      appeal that failed because HQ could not read a licence would lock the one
 *      door out of a freeze.
 *   3. A REFUSAL IS NOT AN UNDELIVERED ROW. Either end refusing answers 400 and
 *      writes nothing. An `undelivered` row reads as retryable, and retrying a
 *      decision gets the same decision.
 *   4. THE TWO EMITTERS SEND ONE RECORD. The push and the pull built their
 *      records apart and drifted; they now share `assembleLicenceRecord`, and
 *      this file compares their output field by field.
 *
 * Every table is sliced out of the baseline or a migration on disk, so a
 * fixture narrower than the schema — the D133 trap — cannot make a SELECT fail
 * and read as a refusal.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/escalation_kind_gate_d206.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import branchEscalationRoutes from '../src/routes/branch_escalations.ts';
import licence from '../src/routes/licence.ts';
import {
  escalationKindsFor, KIND_GATED_ESCALATIONS, ESCALATION_KINDS, WHITE_LABEL_CONTENT_HIDDEN,
  recordEscalation, licenceForBranch,
} from '../src/rpc/hqOps.ts';
import { applyLicenceCopy, branchLicenceKind } from '../src/rpc/branchOps.ts';
import { pushLicenceToBranch } from '../src/services/licencePush.ts';
import { tableFromBaseline, splitStatements, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const migration = (name: string) => read(`cloudflare-worker/sql/migrations/${name}.sql`);

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 7;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}

/**
 * A D1 over `node:sqlite`. `refuse` makes any statement naming that table throw
 * as D1 would on a missing table — the way to prove a path never reads it.
 */
function makeD1(db: InstanceType<typeof DatabaseSync>, refuse?: string) {
  const reads: string[] = [];
  const d1 = {
    reads,
    prepare(sql: string) {
      let b: any[] = [];
      const guard = () => {
        reads.push(sql);
        if (refuse && sql.includes(refuse)) throw new Error(`D1_ERROR: no such table: ${refuse}`);
      };
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { guard(); return db.prepare(sql).get(...b) ?? null; },
        async all() { guard(); return { results: db.prepare(sql).all(...b) }; },
        async run() {
          guard();
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
  };
  return d1;
}

const run = (db: InstanceType<typeof DatabaseSync>, sql: string) => {
  for (const st of splitStatements(sql)) db.exec(st);
};

/* ------------------------------------------------------------------ *
 * Fixtures, production-shaped                                         *
 * ------------------------------------------------------------------ */

// Synthetic per-deployment secrets. Obviously not credentials: they exist only
// in this file, and the secret scan must never mistake them for one.
const RPC_SECRET_FR = 'synthetic-test-value-fr-not-a-credential';
const RPC_SECRET_LYON = 'synthetic-test-value-lyon-not-a-credential';
const hashOf = (v: string) => createHash('sha256').update(v).digest('hex');

/**
 * HQ: the licence ledger as the baseline declares it, migration 279's `kind`
 * applied on top, the deployment registry, both 259s. Two licences — an Axal
 * subsidiary deployed as `fr`, and a white-label deployed as `lyon`.
 */
function hqDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['territory_licences', 'licence_territories', 'licence_seats']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  for (const m of ['258_licence_deployments', '259_hq_escalations', '259_licence_contracts', '261_branch_escalations', '279_licence_kind', '288_escalation_delivery', '296_escalation_relation']) {
    run(db, migration(m));
  }
  const lic = db.prepare(
    `INSERT INTO territory_licences
       (id, uid, licence_ref, legal_entity_name, brand_name, registered_address, signatory_name,
        signatory_title, status, term_years, annual_fee_cents, currency, revenue_share_bps,
        token_split_bps, starts_on, renews_on, suspended_at, status_note, kind)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  lic.run(1, 'lic_fr', 'AXL-001', 'Axal VC France SAS', 'Axal VC France', '12 rue de la Paix',
    'Claire Dubois', 'Managing Director', 'active', 3, 5000000, 'EUR', 3500, 3100,
    '2026-01-01', '2027-01-01', null, null, 'subsidiary');
  lic.run(2, 'lic_lyon', 'AXL-WL-001', 'Studio Lyon SAS', 'Studio Lyon', '4 quai Saint-Antoine',
    'Luc Moreau', 'Président', 'suspended', 2, 2400000, 'EUR', 2000, 2500,
    '2026-03-01', '2028-03-01', '2026-09-01T00:00:00Z', 'Fees outstanding.', 'white_label');
  // Territories inserted OUT of order on purpose: the pull used to list them in
  // whatever order the join returned, the push sorted them, and the copy moved
  // depending on which one wrote it last.
  const terr = db.prepare('INSERT INTO licence_territories (licence_id, country_code) VALUES (?,?)');
  for (const cc of ['LU', 'FR', 'BE']) terr.run(1, cc);
  terr.run(2, 'MC');
  const seat = db.prepare('INSERT INTO licence_seats (licence_id, seat_type, seats_licensed) VALUES (?,?,?)');
  seat.run(1, 'founder', 200); seat.run(1, 'advisor', 30); seat.run(2, 'founder', 40);
  // Two contract versions; the copy carries the latest.
  const ct = db.prepare(
    `INSERT INTO licence_contracts (uid, licence_uid, template_slug, template_version, template_title, body_md)
     VALUES (?,?,?,?,?,?)`,
  );
  ct.run('ct_1', 'lic_fr', 'licence-agreement', 3, 'Licence agreement', '…');
  ct.run('ct_2', 'lic_fr', 'licence-agreement', 4, 'Licence agreement', '…');
  // D244: the pull is authenticated, so each deployment carries the hash of the
  // secret its branch presents — what branch-provision.yml writes. The hash is
  // taken here with node:crypto rather than the Worker's own helper, so the
  // test does not agree with the code by construction.
  const dep = db.prepare(
    `INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status, rpc_secret_hash)
     VALUES (?,?,?,?,?,'live',?)`,
  );
  dep.run('lic_fr', 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr', hashOf(RPC_SECRET_FR));
  dep.run('lic_lyon', 'lyon', 'lyon.axal.vc', 'studioos-lyon', 'studioos-lyon', hashOf(RPC_SECRET_LYON));
  return db;
}

const escalations = (db: InstanceType<typeof DatabaseSync>) =>
  (db.prepare('SELECT COUNT(*) AS n FROM hq_escalations').get() as any).n as number;

/**
 * A branch: its copy of the licence built from the four migrations that shaped
 * it (256, 257, 265, 284), its own escalation lane (261), and one admin.
 * `kind` is what HQ pushed — `null` for a copy that predates migration 284.
 */
function branchDb(opts: { kind?: string | null; status?: string; copy?: boolean; table?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT);
           CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);`);
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)').run(ADMIN, 'admin', 'Luc Moreau', 'luc@lyon.example');
  if (opts.table !== false) {
    for (const m of ['256_branch_local_copies', '257_branch_licence_ref', '265_branch_licence_entity', '284_branch_licence_kind']) {
      run(db, migration(m));
    }
    if (opts.copy !== false) {
      db.prepare(
        `INSERT INTO branch_licence (id, licence_uid, licence_ref, status, kind, pushed_at)
         VALUES (1, 'lic_lyon', 'AXL-WL-001', ?, ?, '2026-09-20T00:00:00Z')`,
      ).run(opts.status ?? 'active', opts.kind === undefined ? 'white_label' : opts.kind);
    }
  }
  run(db, migration('259_hq_escalations'));
  run(db, migration('261_branch_escalations'));
  run(db, migration('288_escalation_delivery'));
  run(db, migration('296_escalation_relation'));
  return db;
}

const lane = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare('SELECT * FROM branch_escalations').all() as any[];

/**
 * A stub HQ binding: records what it was asked, answers the way it is told.
 * By default each raise gets its OWN uid, as HQ mints them — `hq_uid` is
 * UNIQUE on the branch lane (migration 261), so a stub that answered every
 * raise with one uid would fail the second raise for a reason no HQ produces.
 */
function stubHq(answer?: any) {
  const seen: Array<{ code: string; item: any }> = [];
  return {
    seen,
    HQ: {
      async escalate(code: string, item: any) {
        seen.push({ code, item });
        return answer ?? { uid: `esc_${seen.length}`, due_at: '2026-09-25T00:00:00Z', status: 'open' };
      },
    },
  };
}

async function bearer() {
  return new SignJWT({ user_id: ADMIN, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

function branchApp(env: Record<string, unknown>) {
  const app = new Hono<any>();
  app.route('/api/branch', branchEscalationRoutes);
  app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 403));
  return async (path: string, init: RequestInit = {}) => {
    const res = await app.request(`/api/branch${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await bearer()}` },
    }, env);
    return { status: res.status, body: await res.json() as any };
  };
}

const raise = (kind: string, subject = 'A localised launch post') =>
  ({ method: 'POST', body: JSON.stringify({ kind, subject }) });

/* ------------------------------------------------------------------ *
 * 1 · The rule                                                        *
 * ------------------------------------------------------------------ */

test('a white-label is offered three kinds; content is hidden with canvas H30’s sentence', () => {
  const g = escalationKindsFor('white_label');
  assert.equal(g.licence_kind, 'white_label');
  assert.equal(g.known, true);
  assert.deepEqual(g.available, ['moderation', 'seat_increase', 'other']);
  assert.deepEqual(g.hidden, [{ kind: 'content', reason: WHITE_LABEL_CONTENT_HIDDEN }]);
  assert.equal(WHITE_LABEL_CONTENT_HIDDEN, 'Hidden for this kind — there is no brand desk to send it to.');
});

test('a subsidiary is offered all four, and nothing is hidden', () => {
  const g = escalationKindsFor('subsidiary');
  assert.equal(g.known, true);
  assert.deepEqual(g.available, [...ESCALATION_KINDS]);
  assert.deepEqual(g.hidden, []);
});

test('an unknown or missing kind is offered all four and says it does not know', () => {
  // Hiding on "is not a subsidiary" would take content away from every branch
  // whose copy merely predates migration 284 — a refusal nobody decided.
  for (const k of [null, undefined, '', '   ', 42, 'franchise']) {
    const g = escalationKindsFor(k);
    assert.deepEqual(g.available, [...ESCALATION_KINDS], `${String(k)} lost a kind`);
    assert.deepEqual(g.hidden, [], `${String(k)} hid a kind`);
    assert.equal(g.known, false, `${String(k)} read as known`);
  }
  assert.equal(escalationKindsFor('franchise').licence_kind, 'franchise',
    'an unrecognised value must be carried as itself, not erased');
  assert.equal(escalationKindsFor(null).licence_kind, null);
});

test('the value is normalised before it is judged', () => {
  assert.equal(escalationKindsFor(' White_Label ').licence_kind, 'white_label');
  assert.deepEqual(escalationKindsFor('WHITE_LABEL').hidden.map((h) => h.kind), ['content']);
});

test('HQ reads its ledger for exactly the kinds the rule can hide', () => {
  // Every licence kind migration 279 admits, read off the migration itself, plus
  // the unknowns — so a third kind added there is covered the day it lands.
  const check = migration('279_licence_kind').match(/CHECK\s*\(\s*kind\s+IN\s*\(([^)]*)\)\s*\)/);
  assert.ok(check, 'migration 279 no longer carries a readable CHECK on kind');
  const licenceKinds = [...check![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(licenceKinds, ['subsidiary', 'white_label']);
  const hideable = new Set<string>();
  for (const k of [...licenceKinds, null, 'unknown']) {
    for (const h of escalationKindsFor(k).hidden) hideable.add(h.kind);
  }
  assert.deepEqual([...KIND_GATED_ESCALATIONS].sort(), [...hideable].sort(),
    'a kind the rule can hide is not checked at HQ, or HQ reads its ledger for a kind nothing hides');
});

/* ------------------------------------------------------------------ *
 * 2 · HQ's gate — fails closed, and only where it has to              *
 * ------------------------------------------------------------------ */

test('HQ refuses a white-label’s content escalation and records nothing', async () => {
  const db = hqDb();
  const res: any = await recordEscalation({ DB: makeD1(db) } as any, 'lyon',
    { kind: 'content', subject: 'A localised launch post' });
  assert.deepEqual(res, {
    refused: 'kind_not_available', kind: 'content', licence_kind: 'white_label',
    reason: WHITE_LABEL_CONTENT_HIDDEN,
  });
  assert.equal(escalations(db), 0, 'a refused escalation was recorded anyway');
});

test('HQ records a white-label’s three other kinds, and a subsidiary’s content', async () => {
  const db = hqDb();
  const env = { DB: makeD1(db) } as any;
  for (const kind of ['moderation', 'seat_increase', 'other']) {
    const r: any = await recordEscalation(env, 'lyon', { kind, subject: `A ${kind} item` });
    assert.ok(r.uid && !r.refused, `${kind} was refused for a white-label`);
  }
  const r: any = await recordEscalation(env, 'fr', { kind: 'content', subject: 'A localised post' });
  assert.ok(r.uid && !r.refused, 'a subsidiary’s content escalation was refused');
  assert.equal(escalations(db), 4);
});

test('an ungated kind never reads the ledger — the appeal path cannot depend on it', async () => {
  const db = hqDb();
  const d1 = makeD1(db, 'territory_licences');
  const r: any = await recordEscalation({ DB: d1 } as any, 'lyon',
    { kind: 'other', subject: 'Appealing the suspension' });
  assert.ok(r.uid, 'an appeal failed because the ledger could not be read');
  assert.ok(!d1.reads.some((s) => s.includes('territory_licences')), 'an ungated kind read the ledger');
});

test('a gated kind with an unreadable ledger is refused by throwing, not allowed', async () => {
  const db = hqDb();
  await assert.rejects(
    () => recordEscalation({ DB: makeD1(db, 'territory_licences') } as any, 'lyon',
      { kind: 'content', subject: 'A localised post' }),
    /no such table: territory_licences/,
    'HQ recorded a content escalation it could not check',
  );
  assert.equal(escalations(db), 0);
});

test('a deployment naming a licence HQ does not hold is refused, not allowed', async () => {
  const db = hqDb();
  db.prepare(
    `INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name)
     VALUES ('lic_missing', 'ghost', 'ghost.axal.vc', 'studioos-ghost', 'studioos-ghost')`,
  ).run();
  await assert.rejects(
    () => recordEscalation({ DB: makeD1(db) } as any, 'ghost', { kind: 'content', subject: 'x' }),
    /which HQ's ledger does not hold/,
  );
  assert.equal(escalations(db), 0);
  // …and the orphan still blocks nothing it does not have to.
  const r: any = await recordEscalation({ DB: makeD1(db) } as any, 'ghost', { kind: 'other', subject: 'y' });
  assert.ok(r.uid, 'an orphan deployment lost its appeal path too');
});

test('an unprovisioned branch is refused before any kind is judged', async () => {
  const db = hqDb();
  await assert.rejects(
    () => recordEscalation({ DB: makeD1(db) } as any, 'nowhere', { kind: 'content', subject: 'x' }),
    /not a provisioned branch/,
  );
});

/* ------------------------------------------------------------------ *
 * 3 · The branch route — the local gate, and HQ's refusal carried     *
 * ------------------------------------------------------------------ */

const BRANCH = { JWT_SECRET, BRANCH_CODE: 'lyon' };

test('the branch refuses a hidden kind before calling HQ, and writes nothing', async () => {
  const db = branchDb({ kind: 'white_label' });
  const hq = stubHq();
  const r = await branchApp({ ...BRANCH, DB: makeD1(db), HQ: hq.HQ })('/escalations', raise('content'));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'kind_not_available');
  assert.equal(r.body.message, WHITE_LABEL_CONTENT_HIDDEN);
  assert.equal(r.body.licence_kind, 'white_label');
  assert.equal(hq.seen.length, 0, 'HQ was called for a kind the branch already knew was hidden');
  assert.equal(lane(db).length, 0, 'a refused raise left a row');
});

test('the local gate stops content only — the other kinds still reach HQ', async () => {
  const db = branchDb({ kind: 'white_label' });
  const hq = stubHq();
  const call = branchApp({ ...BRANCH, DB: makeD1(db), HQ: hq.HQ });
  for (const kind of ['moderation', 'seat_increase', 'other']) {
    const r = await call('/escalations', raise(kind, `A ${kind} item`));
    assert.equal(r.status, 201, `${kind} was refused on a white-label`);
  }
  assert.equal(hq.seen.length, 3);
});

test('a suspended white-label can still appeal', async () => {
  const db = branchDb({ kind: 'white_label', status: 'suspended' });
  const r = await branchApp({ ...BRANCH, DB: makeD1(db), HQ: stubHq().HQ })(
    '/escalations', raise('other', 'Appealing the suspension'),
  );
  assert.equal(r.status, 201, 'the kind gate closed the appeal path on a frozen branch');
});

test('HQ’s refusal is a 400 with HQ’s reason — never an undelivered row', async () => {
  // A copy that predates migration 284 does not know its kind, so the branch
  // lets the raise through and HQ, which does know, refuses it.
  const db = branchDb({ kind: null });
  const hq = stubHq({
    refused: 'kind_not_available', kind: 'content', licence_kind: 'white_label',
    reason: WHITE_LABEL_CONTENT_HIDDEN,
  });
  const r = await branchApp({ ...BRANCH, DB: makeD1(db), HQ: hq.HQ })('/escalations', raise('content'));
  assert.equal(hq.seen.length, 1, 'an unknown kind was refused locally instead of asking HQ');
  assert.equal(r.status, 400, 'HQ’s refusal was stored as something else');
  assert.equal(r.body.error, 'kind_not_available');
  assert.equal(r.body.message, WHITE_LABEL_CONTENT_HIDDEN);
  assert.equal(r.body.licence_kind, 'white_label');
  assert.equal(lane(db).length, 0,
    'HQ’s refusal became a row — an undelivered one reads as retryable, and retrying gets the same answer');
});

test('an HQ that throws is still undelivered — only a refusal skips the row', async () => {
  // The line between the two is the point: a throw means HQ may not have heard,
  // a refusal means it heard and said no.
  const db = branchDb({ kind: null });
  const HQ = { async escalate() { throw new Error('binding unreachable'); } };
  const r = await branchApp({ ...BRANCH, DB: makeD1(db), HQ })('/escalations', raise('content'));
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'undelivered');
  assert.equal(lane(db).length, 1);
});

test('the lane read says which kinds this licence offers, and why', async () => {
  const wl = await branchApp({ ...BRANCH, DB: makeD1(branchDb({ kind: 'white_label' })) })('/escalations');
  assert.equal(wl.status, 200);
  assert.deepEqual(wl.body.kinds, [...ESCALATION_KINDS], 'the validation vocabulary shrank with the offer');
  assert.deepEqual(wl.body.kinds_available, ['moderation', 'seat_increase', 'other']);
  assert.deepEqual(wl.body.kinds_hidden, [{ kind: 'content', reason: WHITE_LABEL_CONTENT_HIDDEN }]);
  assert.equal(wl.body.licence_kind, 'white_label');
  assert.equal(wl.body.licence_kind_known, true);
  assert.match(wl.body.kind_basis, /licence copy HQ pushed/);

  const unknown = await branchApp({ ...BRANCH, DB: makeD1(branchDb({ kind: null })) })('/escalations');
  assert.deepEqual(unknown.body.kinds_available, [...ESCALATION_KINDS]);
  assert.deepEqual(unknown.body.kinds_hidden, []);
  assert.equal(unknown.body.licence_kind_known, false);
  assert.match(unknown.body.kind_basis, /HQ, which holds the licence, decides/);
});

test('a branch that cannot read its copy fails OPEN — every kind, HQ decides', async () => {
  for (const shape of [{ copy: false }, { table: false }]) {
    const db = branchDb(shape);
    assert.equal(await branchLicenceKind({ DB: makeD1(db) } as any), null);
    const r = await branchApp({ ...BRANCH, DB: makeD1(db) })('/escalations');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.kinds_available, [...ESCALATION_KINDS],
      `${JSON.stringify(shape)} took a kind away on a read that proves nothing`);
    assert.equal(r.body.licence_kind_known, false);
  }
});

/* ------------------------------------------------------------------ *
 * 4 · The copy — stored, emitted, and one record from both emitters   *
 * ------------------------------------------------------------------ */

test('the copy stores the kind HQ sent, and a value it does not know is kept, not refused', async () => {
  const db = branchDb({ copy: false });
  const env = { DB: makeD1(db), BRANCH_CODE: 'lyon' } as any;
  await applyLicenceCopy(env, { licence_uid: 'lic_lyon', kind: 'white_label', pushed_at: '2026-09-21T00:00:00Z' });
  assert.equal(await branchLicenceKind(env), 'white_label');
  // No CHECK on the copy (migration 284's header): a push from an HQ one
  // migration ahead must land whole, because it may carry a suspension.
  await applyLicenceCopy(env, { licence_uid: 'lic_lyon', kind: 'franchise', status: 'suspended', pushed_at: '2026-09-22T00:00:00Z' });
  const row = db.prepare('SELECT kind, status FROM branch_licence WHERE id = 1').get() as any;
  assert.equal(row.kind, 'franchise');
  assert.equal(row.status, 'suspended', 'a value the copy did not recognise cost it the suspension');
  assert.equal(escalationKindsFor(await branchLicenceKind(env)).known, false);
});

test('the branch’s licence payload carries the kind', async () => {
  const db = branchDb({ kind: 'white_label' });
  const app = new Hono<any>();
  app.route('/licence', licence);
  app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 403));
  const res = await app.request('/licence/mine', { headers: { Authorization: `Bearer ${await bearer()}` } }, {
    DB: makeD1(db), JWT_SECRET, ENVIRONMENT: 'development',
    BRANCH_CODE: 'lyon', BRANCH_NAME: 'Studio Lyon', BRANCH_TERRITORY: 'MC', APP_URL: 'https://lyon.axal.vc',
  });
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.source, 'hq_copy');
  assert.equal(body.licence.kind, 'white_label', 'the payload dropped the kind the copy holds');
});

test('the push and the pull send one record, field for field', async () => {
  const db = hqDb();
  const seen: any[] = [];
  const env = {
    DB: makeD1(db),
    BRANCH_FR: { async applyLicence(record: any) { seen.push(record); return { ok: true }; } },
  } as any;
  const pushed = await pushLicenceToBranch(env, 1, '2026-09-23T12:00:00Z');
  assert.equal(pushed.ok, true, pushed.reason);
  assert.equal(seen.length, 1);
  const pulled: any = await licenceForBranch(env, 'fr', RPC_SECRET_FR);
  assert.ok(!('error' in pulled), `the pull failed: ${JSON.stringify(pulled)}`);

  const { pushed_at: pushStamp, ...pushRecord } = seen[0];
  const { pushed_at: pullStamp, ...pullRecord } = pulled;
  assert.equal(pushStamp, '2026-09-23T12:00:00Z');
  assert.ok(typeof pullStamp === 'string' && pullStamp.length > 0);
  assert.deepEqual(pullRecord, pushRecord, 'the two emitters of the licence copy have drifted apart');

  // What the shared assembler fixed, pinned on the pull where it was wrong.
  assert.equal(pulled.kind, 'subsidiary');
  assert.equal(pulled.territory, 'BE,FR,LU', 'territories are not in a stable order');
  assert.equal(pulled.template_version, 4, 'the pull drops the template version the contract ledger holds');
  assert.equal(pulled.registered_address, '12 rue de la Paix', 'the pull lost migration 265’s fields');
  assert.equal(pulled.signatory_name, 'Claire Dubois');
  assert.equal(pulled.term_years, 3);
});

test('a white-label’s copy says it is one, from both emitters', async () => {
  const db = hqDb();
  const seen: any[] = [];
  const env = {
    DB: makeD1(db),
    BRANCH_LYON: { async applyLicence(record: any) { seen.push(record); return { ok: true }; } },
  } as any;
  await pushLicenceToBranch(env, 2, '2026-09-23T12:00:00Z');
  assert.equal(seen[0].kind, 'white_label');
  const pulled: any = await licenceForBranch(env, 'lyon', RPC_SECRET_LYON);
  assert.equal(pulled.kind, 'white_label');
  assert.equal(pulled.template_version, null, 'a licence with no contract invented a template version');
});
