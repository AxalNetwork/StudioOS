/**
 * D267 — HQ's content lane shows a row the kind gate should have refused.
 *
 * D206 refuses a white-label's `content` escalation at both ends, so a
 * white-label content row on HQ's lane can only be a gate regression, a row
 * inserted by hand, or a row older than D206. Nothing showed one. The GET now
 * reads every deployment's licence kind in ONE statement (`licenceKindsByCode`)
 * and flags each row with the rule `recordEscalation` applies, against the
 * row's own kind.
 *
 * WHAT THIS FILE HOLDS, each a way the flag lies quietly:
 *
 *   1. THE RIGHT ROW. Of a subsidiary's content row, a white-label's content
 *      row, a white-label's moderation row and two orphans, exactly the
 *      white-label content row is flagged — and it is still on the lane.
 *   2. AN ORPHAN IS UNKNOWN, NOT GUILTY. A code with no deployment, and a
 *      deployment naming a licence the ledger does not hold, read as a null
 *      kind and are not flagged.
 *   3. A FAILED KIND READ NEVER BLANKS THE LANE. With the licence ledger gone
 *      the lane still answers, every row is present, `licence_kinds_available`
 *      is false with the server's sentence, and no row is flagged — each one
 *      reads "not checked" (null), never "passed" (false).
 *
 * The rows are inserted by hand, because HQ refuses to record the one this
 * lane exists to show. The tables come off the baseline and the migrations on
 * disk (D206's `hqDb` shape), so a fixture narrower than the schema — the D133
 * trap — cannot make a read fail and pass for a refusal.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/escalation_gate_flag_d267.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import adminEscalations from '../src/routes/admin_escalations.ts';
import { licenceKindsByCode } from '../src/rpc/hqOps.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
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
  };
}
const run = (db: InstanceType<typeof DatabaseSync>, sql: string) => {
  for (const st of splitStatements(sql)) db.exec(st);
};

/**
 * HQ, in D206's shape: `fr` runs the subsidiary `lic_fr`, `lyon` the
 * white-label `lic_lyon`. One more deployment, `nice`, names `lic_gone`, a
 * licence the ledger does not hold — the LEFT JOIN's case.
 */
function hqDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'super_admins', 'territory_licences']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  for (const m of ['258_licence_deployments', '259_hq_escalations', '261_branch_escalations', '279_licence_kind', '288_escalation_delivery', '296_escalation_relation']) {
    run(db, migration(m));
  }
  db.prepare('INSERT INTO users (id, email, role, name) VALUES (?,?,?,?)').run(ADMIN, 'sue@axal.example', 'admin', 'Sue Hart');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(ADMIN);

  const lic = db.prepare(
    `INSERT INTO territory_licences
       (id, uid, licence_ref, legal_entity_name, brand_name, registered_address, signatory_name,
        signatory_title, status, term_years, annual_fee_cents, currency, revenue_share_bps,
        token_split_bps, starts_on, renews_on, kind)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  lic.run(1, 'lic_fr', 'AXL-001', 'Axal VC France SAS', 'Axal VC France', '12 rue de la Paix',
    'Claire Dubois', 'Managing Director', 'active', 3, 5000000, 'EUR', 3500, 3100,
    '2026-01-01', '2027-01-01', 'subsidiary');
  lic.run(2, 'lic_lyon', 'AXL-WL-001', 'Studio Lyon SAS', 'Studio Lyon', '4 quai Saint-Antoine',
    'Luc Moreau', 'Président', 'active', 2, 2400000, 'EUR', 2000, 2500,
    '2026-03-01', '2028-03-01', 'white_label');
  const dep = db.prepare(
    `INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status)
     VALUES (?,?,?,?,?,'live')`,
  );
  dep.run('lic_fr', 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr');
  dep.run('lic_lyon', 'lyon', 'lyon.axal.vc', 'studioos-lyon', 'studioos-lyon');
  dep.run('lic_gone', 'nice', 'nice.axal.vc', 'studioos-nice', 'studioos-nice');

  // BY HAND, because `recordEscalation` refuses the one row this lane must show.
  const esc = db.prepare(
    `INSERT INTO hq_escalations (uid, branch_code, kind, subject, status, due_at, created_at)
     VALUES (?, ?, ?, ?, 'open', '2026-09-30T00:00:00Z', ?)`,
  );
  esc.run('esc_fr_content', 'fr', 'content', 'Newsletter header for approval', '2026-09-20 09:00:00');
  esc.run('esc_lyon_content', 'lyon', 'content', 'Rebranded pitch template', '2026-09-20 09:01:00');
  esc.run('esc_lyon_moderation', 'lyon', 'moderation', 'A reported post', '2026-09-20 09:02:00');
  esc.run('esc_ghost_content', 'ghost', 'content', 'From a code HQ never provisioned', '2026-09-20 09:03:00');
  esc.run('esc_nice_content', 'nice', 'content', 'From a deployment with no licence row', '2026-09-20 09:04:00');
  return db;
}

async function token() {
  return new SignJWT({ user_id: ADMIN, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const app = new Hono<any>();
app.route('/api/admin', adminEscalations);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});
async function lane(db: InstanceType<typeof DatabaseSync>, query = '') {
  const res = await app.request(`/api/admin/escalations${query}`, {
    headers: { Authorization: `Bearer ${await token()}` },
  }, { DB: makeD1(db), JWT_SECRET } as any);
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text), text };
}
const byUid = (items: any[]) => Object.fromEntries(items.map((it) => [it.uid, it]));

/* ------------------------------------------------------------------ *
 * 1 · the right row, and still on the lane                            *
 * ------------------------------------------------------------------ */

test('D267: of five rows, exactly the white-label content row is flagged — and it stays on the lane', async () => {
  const db = hqDb();
  const r = await lane(db);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.available, true);
  assert.equal(r.body.licence_kinds_available, true);
  assert.ok(!('licence_kinds_reason' in r.body), 'a reason was written for a read that answered');
  assert.equal(r.body.items.length, 5, 'a row went missing: a flagged row is marked, never filtered out');

  const flagged = r.body.items.filter((it: any) => it.kind_gate_failed === true).map((it: any) => it.uid);
  assert.deepEqual(flagged, ['esc_lyon_content']);

  const it = byUid(r.body.items);
  assert.equal(it.esc_lyon_content.licence_kind, 'white_label');
  assert.equal(it.esc_fr_content.licence_kind, 'subsidiary');
  assert.equal(it.esc_fr_content.kind_gate_failed, false);
  // THE ROW'S OWN KIND DECIDES: a white-label may raise moderation.
  assert.equal(it.esc_lyon_moderation.licence_kind, 'white_label');
  assert.equal(it.esc_lyon_moderation.kind_gate_failed, false,
    'a white-label moderation row was flagged: the flag read the licence kind alone');
});

test('D267: the content lane the page reads carries the same flag', async () => {
  const db = hqDb();
  const r = await lane(db, '?kind=content');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.items.map((it: any) => it.uid).sort(),
    ['esc_fr_content', 'esc_ghost_content', 'esc_lyon_content', 'esc_nice_content']);
  assert.deepEqual(r.body.items.filter((it: any) => it.kind_gate_failed).map((it: any) => it.uid), ['esc_lyon_content']);
});

/* ------------------------------------------------------------------ *
 * 2 · an orphan is unknown, not guilty                                *
 * ------------------------------------------------------------------ */

test('D267: a code with no deployment and a deployment with no licence read as a null kind, and neither is flagged', async () => {
  const db = hqDb();
  const it = byUid((await lane(db)).body.items);
  for (const uid of ['esc_ghost_content', 'esc_nice_content']) {
    assert.equal(it[uid].licence_kind, null, `${uid} was given a kind the ledger does not hold`);
    assert.equal(it[uid].kind_gate_failed, false, `${uid} was flagged on a kind nobody knows`);
  }
});

test('D267: licenceKindsByCode is one read keyed by code, and an orphan deployment is null, not missing', async () => {
  const db = hqDb();
  const kinds = await licenceKindsByCode({ DB: makeD1(db) } as any);
  assert.ok(kinds instanceof Map);
  assert.deepEqual([...kinds.entries()].sort(), [['fr', 'subsidiary'], ['lyon', 'white_label'], ['nice', null]]);
});

/* ------------------------------------------------------------------ *
 * 3 · a failed kind read never blanks the lane                        *
 * ------------------------------------------------------------------ */

test('D267: licenceKindsByCode throws to its caller when the ledger is gone, rather than answering "unknown"', async () => {
  const db = hqDb();
  db.exec('DROP TABLE territory_licences');
  await assert.rejects(licenceKindsByCode({ DB: makeD1(db) } as any), /territory_licences/);
});

test('D267: with the licence ledger gone, the lane still answers, says why, and flags nothing', async () => {
  const db = hqDb();
  db.exec('DROP TABLE territory_licences');
  const r = await lane(db);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.available, true, 'a failed kind read blanked the lane');
  assert.equal(r.body.items.length, 5);
  assert.equal(r.body.licence_kinds_available, false);
  assert.match(r.body.licence_kinds_reason, /no row here was checked/);
  for (const it of r.body.items) {
    assert.equal(it.kind_gate_failed, null, `${it.uid} reads as checked when nothing was checked`);
    assert.equal(it.licence_kind, null);
  }
});

test('D267: a lane that could not be read carries no kind verdict at all', async () => {
  const db = hqDb();
  db.exec('DROP TABLE hq_escalations');
  const r = await lane(db);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.available, false);
  assert.deepEqual(r.body.items, []);
  assert.ok(!('licence_kinds_available' in r.body), 'a kind verdict was given for a lane that has no rows to check');
});
