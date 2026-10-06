/**
 * D579 (#1206) — a startup's EIN, encrypted at rest and owner-scoped.
 *
 * The owner chose 1A (store it) and 2A (the founder, company editors and
 * admins read it). On real SQLite with migration 397's own DDL and the
 * baseline's Lab and ledger tables, these pin:
 *   - access per role: the founder and a co-founder read and write; an admin
 *     reads the last four and writes; another founder, an advisor member, a
 *     partner and an investor get 404 and store nothing;
 *   - only ciphertext in the row, bound to its project;
 *   - masking: the full number only in a founder's own edit-field read;
 *   - the shape refusal, which never echoes what was sent;
 *   - no log, audit row or console line carries the number;
 *   - storing a valid EIN marks the owner's `ein_received`, once.
 *
 * Every number here is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/company_ein_d579.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import companyEin from '../src/routes/company_ein.ts';
import { decryptColumn } from '../src/services/columnCipher.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SYNTHETIC = '12-3456789';
const SYNTHETIC_2 = '98-7654321';

const OWNER = 10, COFOUNDER = 30, ADVISOR = 40, OTHER = 20, PARTNER = 50, INVESTOR = 60, ADMIN = 1, OWNER_B = 70;
const ROLE: Record<number, string> = {
  [OWNER]: 'founder', [COFOUNDER]: 'founder', [ADVISOR]: 'founder', [OTHER]: 'founder',
  [PARTNER]: 'partner', [INVESTOR]: 'investor', [ADMIN]: 'admin', [OWNER_B]: 'founder',
};

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIG381 = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/381_credit_reward_rules.sql'), 'utf8');
const MIG397 = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/397_company_eins.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

function fixture({ labActive = 1 } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'spinout_lab_milestones', 'activity_logs', 'user_spinout_flags', 'perk_credit_ledger']) db.exec(ddl(t));
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_perk_ledger_idem ON perk_credit_ledger(user_id, kind, source_ref);');
  db.exec(MIG381);
  db.exec(MIG397);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active, spinout_lab_week) VALUES (?, ?, ?, ?, 1, ?, ?, 4)');
  u.run(ADMIN, 'admin', 'Hq Admin', 'hq@axal.example', null, 0);
  u.run(OWNER, 'founder', 'Fay Owner', 'fay@example.test', 1001, labActive);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002, 1);
  u.run(COFOUNDER, 'founder', 'Cy Cofounder', 'cy@example.test', null, 1);
  u.run(ADVISOR, 'founder', 'Ad Visor', 'ad@example.test', null, 0);
  u.run(PARTNER, 'partner', 'Pat Partner', 'pat@example.test', null, 0);
  u.run(INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null, 0);
  u.run(OWNER_B, 'founder', 'Bea Owner', 'bea@example.test', 1003, 1);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (1, 'Acme', 1001), (2, 'Beta', 1002), (3, 'Gamma', 1003)`);
  db.exec(`INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted, spinout_lab_cohort) VALUES (${OWNER}, 1, 'Cohort 4'), (${OWNER_B}, 1, 'Cohort 4')`);
  db.exec(`CREATE TABLE IF NOT EXISTS project_members (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'cofounder', status TEXT NOT NULL DEFAULT 'accepted', source TEXT,
    invitation_id INTEGER, cofounder_connection_id INTEGER, added_by_user_id INTEGER, accepted_at TEXT, removed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (1, ${COFOUNDER}, 'cofounder', 'accepted'), (1, ${ADVISOR}, 'advisor', 'accepted');`);
  return db;
}

const app = new Hono<any>();
app.route('/company-ein', companyEin);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 403));
const ENV = (db: any) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) }) as any;

const CONSOLE: string[] = [];
async function call(db: any, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
    .setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.log, console.warn, console.error, console.info];
  const grab = (...a: unknown[]) => { CONSOLE.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  console.log = grab; console.warn = grab; console.error = grab; console.info = grab;
  try {
    const res = await app.request(path, {
      method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, ENV(db));
    const text = await res.text();
    return { status: res.status, text, body: text ? JSON.parse(text) : null };
  } finally {
    [console.log, console.warn, console.error, console.info] = saved;
  }
}
const put = (db: any, who: number, project: number, ein: unknown) => call(db, who, 'PUT', `/company-ein/${project}`, { ein });
const get = (db: any, who: number, project: number | string, full = false) => call(db, who, 'GET', `/company-ein/${project}${full ? '?full=1' : ''}`);
const rows = (db: any) => db.prepare('SELECT project_id, ein_enc, ein_last4, recorded_by FROM company_eins ORDER BY project_id').all().map((r: any) => ({ ...r }));
const milestones = (db: any, who: number) => Number((db.prepare("SELECT COUNT(*) AS n FROM spinout_lab_milestones WHERE user_id = ? AND milestone_key = 'ein_received'").get(who) as any).n);
const DIGITS = SYNTHETIC.replace('-', '');

test('a founder stores a valid EIN: only ciphertext in the row, and the answer is masked', async () => {
  const db = fixture();
  const res = await put(db, OWNER, 1, SYNTHETIC);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.masked, '••-•••6789');
  assert.equal(res.body.last4, '6789');
  assert.equal(res.body.recorded, true);
  assert.ok(!res.text.includes(SYNTHETIC) && !res.text.includes(DIGITS), 'the write answer carries the number');
  const [row] = rows(db);
  assert.equal(row.project_id, 1);
  assert.equal(row.recorded_by, OWNER);
  assert.equal(row.ein_last4, '6789');
  assert.match(row.ein_enc, /^v1\./);
  assert.ok(!row.ein_enc.includes(SYNTHETIC) && !row.ein_enc.includes(DIGITS), 'the row holds plaintext');
  assert.equal(await decryptColumn(ENV(db), 'company_eins', 'ein_enc', 1, row.ein_enc), SYNTHETIC);
});

test('the ciphertext is bound to its project: copied onto another project it does not decrypt', async () => {
  const db = fixture();
  await put(db, OWNER, 1, SYNTHETIC);
  await put(db, OWNER_B, 3, SYNTHETIC_2);
  db.exec("UPDATE company_eins SET ein_enc = (SELECT ein_enc FROM company_eins WHERE project_id = 1) WHERE project_id = 3");
  const r = await get(db, OWNER_B, 3, true);
  assert.equal(r.status, 200);
  assert.equal(r.body.ein, null);
  assert.equal(r.body.last4, '4321');
});

test('the full number is only in a founder\'s or company editor\'s own edit-field read', async () => {
  const db = fixture();
  await put(db, OWNER, 1, SYNTHETIC);
  for (const who of [OWNER, COFOUNDER]) {
    const full = await get(db, who, 1, true);
    assert.equal(full.status, 200);
    assert.equal(full.body.ein, SYNTHETIC, `${who} full read`);
    const plain = await get(db, who, 1);
    assert.equal('ein' in plain.body, false, 'a read without full=1 carries the number');
    assert.equal(plain.body.masked, '••-•••6789');
  }
  const admin = await get(db, ADMIN, 1, true);
  assert.equal(admin.status, 200);
  assert.equal('ein' in admin.body, false, 'an admin read carries the number');
  assert.ok(!admin.text.includes(DIGITS));
  assert.equal(admin.body.last4, '6789');
});

test('anyone else gets 404 on read and write, and stores nothing', async () => {
  const db = fixture();
  await put(db, OWNER, 1, SYNTHETIC);
  for (const who of [OTHER, ADVISOR, PARTNER, INVESTOR]) {
    const r = await get(db, who, 1, true);
    assert.equal(r.status, 404, `${ROLE[who]} ${who} read`);
    assert.deepEqual(r.body, { error: 'not_found' });
    const w = await put(db, who, 1, SYNTHETIC_2);
    assert.equal(w.status, 404, `${ROLE[who]} ${who} write`);
  }
  assert.equal(rows(db)[0].ein_last4, '6789', 'a refused write changed the number');
  assert.equal((await get(db, OWNER, 99)).status, 404);
  assert.equal((await get(db, OWNER, 'x')).status, 404);
  assert.equal((await get(db, OTHER, 2)).body.recorded, false, 'another founder reads their own, unrecorded');
});

test('a co-founder and an admin write it; an admin write records the actor and never the number', async () => {
  const db = fixture();
  assert.equal((await put(db, COFOUNDER, 1, SYNTHETIC)).status, 200);
  assert.equal(rows(db)[0].recorded_by, COFOUNDER);
  // The milestone's credit grant writes its own system row; no admin action is recorded for a founder.
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'company_ein_recorded'").get() as any).n), 0, 'a founder write was recorded as an admin action');
  assert.equal((await put(db, ADMIN, 1, SYNTHETIC_2)).status, 200);
  assert.equal(rows(db)[0].recorded_by, ADMIN);
  assert.equal(rows(db)[0].ein_last4, '4321');
  const log = db.prepare("SELECT action, details, user_id FROM activity_logs WHERE action = 'company_ein_recorded'").all() as any[];
  assert.equal(log.length, 1);
  assert.equal(log[0].action, 'company_ein_recorded');
  assert.equal(log[0].user_id, ADMIN);
  assert.deepEqual(JSON.parse(log[0].details), { project_id: 1 });
  const audit = db.prepare('SELECT admin_user_id, action, filters_json FROM admin_audit_log').all() as any[];
  assert.deepEqual(audit.map((a) => [a.admin_user_id, a.action]), [[ADMIN, 'company_ein_recorded']]);
  const everyText = JSON.stringify([db.prepare('SELECT * FROM activity_logs').all(), audit, db.prepare('SELECT * FROM spinout_lab_milestones').all(), db.prepare('SELECT * FROM perk_credit_ledger').all()]);
  for (const n of [SYNTHETIC, SYNTHETIC_2, DIGITS, SYNTHETIC_2.replace('-', '')]) assert.ok(!everyText.includes(n), `a row outside the store carries ${n}`);
});

test('the shape is NN-NNNNNNN, and a refusal never echoes what was sent', async () => {
  const db = fixture();
  CONSOLE.length = 0;
  for (const bad of ['123456789', '12-345678', '12-34567890', 'ab-cdefghi', '12 3456789', 123456789, null, '']) {
    const r = await put(db, OWNER, 1, bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.deepEqual(r.body, { error: 'ein_invalid' });
  }
  assert.deepEqual(rows(db), []);
  assert.equal(milestones(db, OWNER), 0);
  assert.equal((await put(db, OWNER, 1, ` ${SYNTHETIC} `)).status, 200, 'surrounding spaces are trimmed');
  for (const line of CONSOLE) assert.ok(!line.includes(DIGITS) && !line.includes('3456789'), `a console line carries the number: ${line}`);
});

test('storing a valid EIN marks the owner\'s ein_received once, whoever stores it', async () => {
  const db = fixture();
  const first = await put(db, COFOUNDER, 1, SYNTHETIC);
  assert.equal(milestones(db, OWNER), 1, 'the owner\'s milestone was not recorded');
  assert.equal(milestones(db, COFOUNDER), 0, 'the co-founder\'s own account got the startup\'s milestone');
  assert.equal(first.body.milestone[0].user_id, OWNER);
  assert.equal(first.body.milestone[0].recorded, true);
  const grants = () => db.prepare("SELECT COUNT(*) AS n FROM perk_credit_ledger WHERE user_id = ? AND kind = 'grant' AND source_ref LIKE '%ein_received%'").get(OWNER) as any;
  const paid = Number(grants().n);
  assert.equal(paid, 1, 'migration 381 prices lab:ein_received, and the first record did not pay it');
  assert.equal(first.body.milestone[0].milestone_credit.status, 'granted');
  const again = await put(db, ADMIN, 1, SYNTHETIC_2);
  assert.equal(again.body.milestone[0].reason, 'already_recorded');
  assert.equal(milestones(db, OWNER), 1);
  assert.equal(Number(grants().n), paid, 'a second save paid the milestone again');
});

test('an inactive Lab records no milestone, and the EIN is still stored', async () => {
  const db = fixture({ labActive: 0 });
  const r = await put(db, OWNER, 1, SYNTHETIC);
  assert.equal(r.status, 200);
  assert.equal(r.body.milestone[0].reason, 'lab_inactive');
  assert.equal(milestones(db, OWNER), 0);
  assert.equal(rows(db).length, 1);
});

test('migration 397 refuses plaintext and a malformed last four', () => {
  const db = fixture();
  assert.throws(() => db.prepare("INSERT INTO company_eins (project_id, ein_enc, ein_last4, recorded_by) VALUES (1, ?, '6789', 10)").run(SYNTHETIC), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO company_eins (project_id, ein_enc, ein_last4, recorded_by) VALUES (1, 'v1.x', '67a9', 10)").run(), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO company_eins (project_id, ein_enc, ein_last4, recorded_by) VALUES (1, 'v1.x', '56789', 10)").run(), /CHECK/);
});
