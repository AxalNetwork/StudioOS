// D1020 (#2857): option pools and vesting per venture (migration 574), the
// register per venture, Carta read only, and the exports. Real SQLite from the
// baseline and the whole migration chain; synthetic accounts and names only.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import captable from '../src/routes/captable.ts';
import { boundVenture } from '../src/integrations/providers/carta.ts';
import { updateHolder, HolderError } from '../src/services/capTableWrites.ts';
import { csvCell, knownSum, withOwnership } from '../src/services/capTableRegister.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const read = (p: string) => readFileSync(p, 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const MIGRATION = read(`${DIR}/574_cap_table_pools_vesting_per_venture.sql`);
const chain = (pred: (n: number) => boolean) => readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF && pred(migrationNumber(n))).sort();

const scratch = mkdtempSync(join(tmpdir(), 'cap-d1020-'));
const seed = join(scratch, 'before-574.sqlite');
{
  const db = new DatabaseSync(seed, { enableForeignKeyConstraints: false });
  db.exec(read('cloudflare-worker/sql/schema_baseline.sql'));
  for (const name of chain((n) => n < 574)) db.exec(read(`${DIR}/${name}`));
  db.close();
}
after(() => rmSync(scratch, { recursive: true, force: true }));

const SECRET = 'synthetic-cap-table-d1020-'.repeat(3);
// Accounts: 4 founds ventures 10 and 11; 7 founds venture 20; 6 is venture
// 10's advisor; 3 is an investor; 1 is an admin.
const FOUNDER = 4; const OTHER = 7; const ADVISOR = 6; const INVESTOR = 3;

let serial = 0;
/** Rows seeded before 574 runs, so the backfill is what is tested. */
function fixture({ upgrade = true } = {}) {
  const file = join(scratch, `${++serial}.sqlite`);
  copyFileSync(seed, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false });
  db.exec(`
    INSERT INTO users (id, role, name, email, founder_id, is_active, subscription_tier) VALUES
      (1, 'admin', 'Synthetic admin', 'admin@example.invalid', NULL, 1, 'studio'),
      (3, 'investor', 'Synthetic investor', 'investor@example.invalid', NULL, 1, 'free'),
      (4, 'founder', 'Synthetic founder', 'founder@example.invalid', 40, 1, 'studio'),
      (6, 'advisor', 'Synthetic advisor', 'advisor@example.invalid', NULL, 1, 'free'),
      (7, 'founder', 'Other founder', 'other@example.invalid', 70, 1, 'studio');
    INSERT INTO projects (id, uid, name, founder_id) VALUES
      (10, 'ventureten', 'Venture Ten', 40), (11, 'ventureeleven', 'Venture Eleven', 40), (20, 'venturetwenty', 'Venture Twenty', 70);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (10, 6, 'advisor', 'accepted');
    INSERT INTO cap_table_holders (id, user_id, project_id, name, email, security_type, shares, source) VALUES
      (101, 4, 10, 'Ada Ten', 'ada@example.invalid', 'common', 600, 'manual'),
      (102, 4, 10, 'Ben Ten', 'ben@example.invalid', 'common', 400, 'manual'),
      (103, 4, 11, 'Cy Eleven', 'cy@example.invalid', 'common', 100, 'manual'),
      (104, 4, NULL, 'Carta stakeholder', 'carta@example.invalid', 'common', NULL, 'carta'),
      (105, 7, 20, 'Dee Twenty', 'dee@example.invalid', 'common', 50, 'manual');
    INSERT INTO cap_table_securities (id, user_id, project_id, name, share_class, shares_authorized, shares_issued, source) VALUES
      (201, 4, 10, 'Common', 'common', 10000, 1000, 'manual'),
      (202, 4, 11, 'Common', 'common', 5000, NULL, 'manual');
    INSERT INTO cap_table_vesting (id, user_id, holder_id, security_id, start_date, total_shares, vested_shares, source) VALUES
      (301, 4, 101, NULL, '2026-01-01', 600, 150, 'manual'),
      (302, 4, 103, NULL, '2026-02-01', NULL, 10, 'manual'),
      (303, 4, NULL, 202, '2026-03-01', 50, 0, 'manual'),
      (304, 4, 104, NULL, '2026-04-01', 10, 5, 'carta'),
      (305, 4, 105, NULL, '2026-05-01', 7, 1, 'manual'),
      (306, 7, 105, NULL, '2026-06-01', 50, 25, 'manual');
    INSERT INTO cap_table_option_pools (id, user_id, name, shares_authorized, shares_issued, shares_available, source) VALUES
      (401, 4, 'Option pool', 1000, 200, 800, 'carta');
  `);
  if (upgrade) {
    db.exec(MIGRATION);
    for (const name of chain((n) => n > 574)) db.exec(read(`${DIR}/${name}`));
  }
  const files = new Map<string, Uint8Array>();
  const FILES = {
    put: async (key: string, bytes: Uint8Array) => { files.set(key, bytes); },
    delete: async (key: string) => { files.delete(key); },
  };
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development', FILES };
  return { db, env, files };
}
type F = ReturnType<typeof fixture>;

async function call(f: F, who: number, path: string, method = 'GET', body?: unknown) {
  const token = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await captable.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env);
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* CSV */ }
  return { status: res.status, body: json, text, headers: res.headers };
}
const one = (f: F, sql: string, ...args: any[]) => f.db.prepare(sql).get(...args) as any;
const ids = (rows: any[]) => rows.map((r) => r.id).sort((a, b) => a - b);

test('574 ties a vesting row to a venture only through its own holder or security, and names Carta as a connector', () => {
  const f = fixture();
  const venture = (id: number) => one(f, 'SELECT project_id FROM cap_table_vesting WHERE id = ?', id).project_id;
  assert.equal(venture(301), 10, 'through its holder');
  assert.equal(venture(302), 11, 'through its holder, in the other venture');
  assert.equal(venture(303), 11, 'through its security, with no holder');
  assert.equal(venture(304), null, 'a holder with no venture proves nothing');
  assert.equal(venture(305), null, 'a holder on another account proves nothing');
  assert.equal(venture(306), 20, "the other founder's own row");
  assert.equal(one(f, 'SELECT project_id FROM cap_table_option_pools WHERE id = 401').project_id, null, 'a pool has no link, so none is guessed');
  for (const t of ['cap_table_holders', 'cap_table_securities', 'cap_table_option_pools', 'cap_table_vesting']) {
    assert.equal(one(f, `SELECT COUNT(*) AS n FROM ${t} WHERE source = 'carta'`).n, 0, `${t} keeps no 'carta' source`);
  }
  assert.equal(one(f, 'SELECT source FROM cap_table_holders WHERE id = 104').source, 'connector_carta');
  assert.equal(one(f, 'SELECT source FROM cap_table_holders WHERE id = 101').source, 'manual', 'a manual row is untouched');
});

test('the equity plan reads one venture: two ventures under one founder never mix', async () => {
  const f = fixture();
  const ten = await call(f, FOUNDER, '/equity-plan?project_id=10');
  const eleven = await call(f, FOUNDER, '/equity-plan?project_id=11');
  assert.equal(ten.status, 200);
  assert.deepEqual(ten.body.scope, { kind: 'venture', project_id: 10 });
  assert.deepEqual(ids(ten.body.grants), [301]);
  assert.deepEqual(ids(eleven.body.grants), [302, 303]);
  assert.deepEqual(ten.body.pools, [], 'the unlinked pool is shown under no venture');
  const account = await call(f, FOUNDER, '/equity-plan');
  assert.deepEqual(account.body.scope, { kind: 'account', project_id: null });
  assert.deepEqual(ids(account.body.grants), [301, 302, 303, 304, 305], 'the account view, as before, for the Spin-Out Lab card');
  assert.deepEqual(ids(account.body.pools), [401]);
});

test('a total over a partly recorded column is null, never a smaller number', async () => {
  const f = fixture();
  const ten = (await call(f, FOUNDER, '/equity-plan?project_id=10')).body.summary;
  assert.deepEqual([ten.granted_shares, ten.vested_shares, ten.unvested_shares], [600, 150, 450]);
  const eleven = (await call(f, FOUNDER, '/equity-plan?project_id=11')).body.summary;
  assert.equal(eleven.granted_shares, null, 'one grant has no total, so the total is not known');
  assert.equal(eleven.vested_shares, 10);
  assert.equal(eleven.unvested_shares, null);
  assert.equal(eleven.shares_authorized, null, 'no pool is recorded');
  assert.equal(knownSum([], 'x' as never), null);
  assert.equal(knownSum([{ x: 0 }, { x: 2 }], 'x'), 2, 'a recorded zero is a zero');
});

test("a venture read is the venture's gate: another founder, an investor and a bad id are refused", async () => {
  const f = fixture();
  for (const path of ['/equity-plan?project_id=20', '/live?project_id=20']) {
    assert.ok([403, 404].includes((await call(f, FOUNDER, path)).status), `${path} is not this founder's`);
  }
  assert.equal((await call(f, INVESTOR, '/equity-plan?project_id=10')).status, 403);
  assert.equal((await call(f, FOUNDER, '/equity-plan?project_id=ten')).status, 400);
  assert.equal((await call(f, OTHER, '/equity-plan?project_id=20')).status, 200);
});

test('/live per venture: its holders only, a share of a known total, and null with any count missing', async () => {
  const f = fixture();
  const ten = await call(f, FOUNDER, '/live?project_id=10');
  assert.equal(ten.status, 200);
  assert.deepEqual(ids(ten.body.holders), [101, 102]);
  assert.equal(ten.body.total_shares, 1000);
  assert.deepEqual(ten.body.holders.map((h: any) => [h.id, h.ownership_pct]).sort(), [[101, 60], [102, 40]]);
  f.db.exec("INSERT INTO cap_table_holders (id, user_id, project_id, name, shares, source) VALUES (106, 4, 10, 'No count', NULL, 'manual')");
  const partly = await call(f, FOUNDER, '/live?project_id=10');
  assert.equal(partly.body.total_shares, null);
  assert.ok(partly.body.holders.every((h: any) => h.ownership_pct === null), 'no 0% and no share of a total nobody knows');
  const account = await call(f, FOUNDER, '/live');
  assert.equal(account.body.scope.kind, 'account');
  assert.ok(ids(account.body.holders).includes(104));
  const advisor = await call(f, ADVISOR, '/live?project_id=10');
  assert.equal(advisor.status, 200);
  assert.ok(advisor.body.holders.every((h: any) => h.email === undefined), "an advisor reads no holder's email");
  assert.equal(withOwnership([{ shares: 0 }]).holders[0].ownership_pct, null, 'a zero total gives no share');
});

test('Carta: the founder names the venture, its rows move there, and it is the record read only', async () => {
  const f = fixture();
  f.db.exec(`INSERT INTO integrations (uid, user_id, provider_key, status, auth_type, config_json) VALUES ('carta-1', 4, 'carta', 'active', 'oauth2', '{"issuer_id":"iss"}')`);
  assert.equal((await call(f, FOUNDER, '/live?project_id=10')).body.carta_is_record, false, 'no venture is named yet');
  assert.ok([403, 404].includes((await call(f, FOUNDER, '/carta/venture', 'PUT', { project_id: 20 })).status), "another founder's venture is refused");
  assert.equal((await call(f, ADVISOR, '/carta/venture', 'PUT', { project_id: 10 })).status, 403, 'an advisor may not name the venture');
  assert.equal((await call(f, OTHER, '/carta/venture', 'PUT', { project_id: 20 })).status, 404, 'no Carta connection on that account');
  const set = await call(f, FOUNDER, '/carta/venture', 'PUT', { project_id: 10 });
  assert.equal(set.status, 200);
  assert.equal(JSON.parse(one(f, "SELECT config_json FROM integrations WHERE uid = 'carta-1'").config_json).project_id, 10);
  assert.equal(JSON.parse(one(f, "SELECT config_json FROM integrations WHERE uid = 'carta-1'").config_json).issuer_id, 'iss', 'the rest of the config is kept');
  assert.equal(one(f, 'SELECT project_id FROM cap_table_holders WHERE id = 104').project_id, 10);
  assert.equal(one(f, 'SELECT project_id FROM cap_table_option_pools WHERE id = 401').project_id, 10);
  assert.equal(one(f, 'SELECT project_id FROM cap_table_vesting WHERE id = 304').project_id, 10);
  assert.equal(one(f, 'SELECT project_id FROM cap_table_holders WHERE id = 103').project_id, 11, 'a manual row stays where it is');
  assert.ok(one(f, "SELECT 1 AS x FROM activity_logs WHERE action = 'cap_table_carta_venture_set' AND project_id = 10 AND user_id = 4"));
  const live = await call(f, FOUNDER, '/live?project_id=10');
  assert.equal(live.body.carta_is_record, true);
  assert.equal((await call(f, FOUNDER, '/live?project_id=11')).body.carta_is_record, false);
  assert.deepEqual(ids((await call(f, FOUNDER, '/equity-plan?project_id=10')).body.pools), [401]);
  // Read only here: the one holder writer refuses Carta's rows.
  await assert.rejects(
    updateHolder(f.env, { projectId: 10, actor: { id: 4, role: 'founder', founder_id: 40, subscription_tier: 'studio' } as any, id: 'h-104', name: 'Changed' }),
    (e: any) => e instanceof HolderError && e.status === 409 && /Change it in Carta/.test(e.sentence),
  );
  assert.equal(one(f, 'SELECT name FROM cap_table_holders WHERE id = 104').name, 'Carta stakeholder');
  const cleared = await call(f, FOUNDER, '/carta/venture', 'PUT', { project_id: null });
  assert.equal(cleared.status, 200);
  assert.equal(one(f, 'SELECT project_id FROM cap_table_holders WHERE id = 104').project_id, null, 'account-level again');
  assert.equal((await call(f, FOUNDER, '/carta/venture', 'PUT', { project_id: 'ten' })).status, 400);
});

test("the sync writes only to a venture the founder still owns", async () => {
  const f = fixture();
  const row = (cfg: unknown) => ({ user_id: FOUNDER, config_json: JSON.stringify(cfg) }) as any;
  assert.equal(await boundVenture(f.env, row({ project_id: 10 })), 10);
  assert.equal(await boundVenture(f.env, row({ project_id: 20 })), null, 'not this founder\'s');
  assert.equal(await boundVenture(f.env, row({})), null, 'none named');
  f.db.exec("UPDATE projects SET deleted_at = '2026-10-01' WHERE id = 10");
  assert.equal(await boundVenture(f.env, row({ project_id: 10 })), null, 'a deleted venture');
  const source = read('cloudflare-worker/src/integrations/providers/carta.ts');
  assert.ok(!/VALUES \([^)]*'carta'/.test(source), "no insert writes source 'carta'");
  assert.ok(!/\?\? 0;/.test(source.slice(source.indexOf('// ── Holders upsert'), source.indexOf('// ── Vesting schedules'))), 'no missing count becomes 0');
});

test('the CSV export: one venture, a cell never read as a formula, no email for a reader, and one audit row', async () => {
  const f = fixture();
  f.db.exec(`INSERT INTO cap_table_holders (id, user_id, project_id, name, email, shares, source) VALUES (107, 4, 10, '=HYPERLINK("x")', 'f@example.invalid', NULL, 'manual')`);
  const r = await call(f, FOUNDER, '/register/10/export.csv');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /text\/csv/);
  assert.match(r.text, /Ada Ten/);
  assert.match(r.text, /Ben Ten/);
  assert.doesNotMatch(r.text, /Cy Eleven/, 'the other venture is not in it');
  assert.doesNotMatch(r.text, /Carta stakeholder/, 'an account-level row is not in it');
  assert.match(r.text, /"'=HYPERLINK\(""x""\)"/, 'a formula is neutralised');
  assert.match(r.text, /ada@example\.invalid/);
  const line = r.text.split('\r\n').find((l) => l.startsWith('"\'=HYPERLINK'))!;
  assert.equal(line.split(',')[3], '', 'a missing count is an empty cell, never 0');
  assert.ok(one(f, "SELECT 1 AS x FROM activity_logs WHERE action = 'cap_table_register_exported' AND project_id = 10 AND user_id = 4"));
  const advisor = await call(f, ADVISOR, '/register/10/export.csv');
  assert.equal(advisor.status, 200);
  assert.doesNotMatch(advisor.text, /@example\.invalid/, 'no email for a reader who may not write');
  assert.equal((await call(f, INVESTOR, '/register/10/export.csv')).status, 403);
  assert.equal(csvCell('-12.5'), '-12.5', 'a negative number is a number');
  assert.equal(csvCell('+1 555'), "'+1 555");
});

test('an export whose audit row cannot be written is refused', async () => {
  const f = fixture();
  const original = f.env.DB;
  f.env.DB = { ...original, prepare(sql: string) {
    const st = original.prepare(sql);
    if (/INSERT INTO activity_logs/.test(sql)) {
      const fail = async () => { throw new Error('synthetic audit failure'); };
      return { bind: () => ({ run: fail, all: fail, first: fail }) };
    }
    return st;
  } };
  const quiet = console.error; console.error = () => {};
  try {
    const r = await call(f, FOUNDER, '/register/10/export.csv');
    assert.equal(r.status, 500);
    assert.doesNotMatch(r.text, /Ada Ten/, 'no file without its audit row');
  } finally { console.error = quiet; }
});

test('the PDF snapshot: "As of", into the data room under NDA, seen by nobody, with its audit row', async () => {
  const f = fixture();
  const r = await call(f, FOUNDER, '/register/10/snapshot', 'POST', {});
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.file.visibility, r.body.file.access_tier], ['nda', 'nobody']);
  assert.match(r.body.file.name, /^Cap table as of \d{4}-\d{2}-\d{2}\.pdf$/);
  const row = one(f, 'SELECT project_id, visibility, access_tier, content_type, r2_key FROM data_room_files WHERE uid = ?', r.body.file.uid);
  assert.deepEqual([row.project_id, row.visibility, row.access_tier, row.content_type], [10, 'nda', 'nobody', 'application/pdf']);
  const bytes = f.files.get(row.r2_key)!;
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  assert.ok(one(f, "SELECT 1 AS x FROM activity_logs WHERE action = 'cap_table_snapshot_filed' AND project_id = 10"));
  assert.equal((await call(f, ADVISOR, '/register/10/snapshot', 'POST', {})).status, 403, 'an advisor files nothing');
  f.env.FILES = undefined;
  assert.equal((await call(f, FOUNDER, '/register/10/snapshot', 'POST', {})).status, 503);
});

test('a snapshot whose file row fails leaves no stored object', async () => {
  const f = fixture();
  f.db.exec('DROP TABLE data_room_files');
  const quiet = console.error; console.error = () => {};
  try {
    const r = await call(f, FOUNDER, '/register/10/snapshot', 'POST', {});
    assert.equal(r.status, 500);
    assert.equal(f.files.size, 0);
  } finally { console.error = quiet; }
});
