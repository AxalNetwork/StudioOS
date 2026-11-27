/**
 * D578 (#1205; S1's Q1 A and Q2 A for the owner) — a startup's SAFEs, on real
 * SQLite with migration 410's own DDL and the baseline's envelope table.
 *
 * What is pinned:
 *   - the terms are recorded per investor in the one form (post-money,
 *     valuation cap, no discount), in integer cents, and refused otherwise;
 *   - a SAFE's status is read from its envelope and nowhere else: no envelope
 *     is a draft, never "Sent" or "Countersigned";
 *   - sending is refused while no counsel-approved SAFE text is registered;
 *   - a founder or company editor records, an advisor member only reads,
 *     anyone else gets 404.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/safe_issuances_d578.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import safeIssuances, { safeSendable, safeStatus } from '../src/routes/safe_issuances.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1, OWNER = 10, COFOUNDER = 30, ADVISOR = 40, OTHER = 20, INVESTOR = 60;
const ROLE: Record<number, string> = { [ADMIN]: 'admin', [OWNER]: 'founder', [COFOUNDER]: 'founder', [ADVISOR]: 'founder', [OTHER]: 'founder', [INVESTOR]: 'investor' };

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIG410 = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/410_safe_issuances.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'raise_prospects', 'esign_envelopes']) db.exec(ddl(t));
  db.exec(MIG410);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(ADMIN, 'admin', 'Hq Admin', 'hq@axal.example', null);
  u.run(OWNER, 'founder', 'Fay Owner', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  u.run(COFOUNDER, 'founder', 'Cy Cofounder', 'cy@example.test', null);
  u.run(ADVISOR, 'founder', 'Ad Visor', 'ad@example.test', null);
  u.run(INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (1, 'Acme', 1001), (2, 'Beta', 1002);
    INSERT INTO raise_prospects (id, uid, project_id, name, firm, stage) VALUES (5, 'p5', 1, 'Ana Angel', 'Angel Co', 'committed'), (6, 'p6', 2, 'Ben Beta', 'B Fund', 'meeting');
    CREATE TABLE IF NOT EXISTS project_members (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'cofounder', status TEXT NOT NULL DEFAULT 'accepted', source TEXT,
      invitation_id INTEGER, cofounder_connection_id INTEGER, added_by_user_id INTEGER, accepted_at TEXT, removed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (1, ${COFOUNDER}, 'cofounder', 'accepted'), (1, ${ADVISOR}, 'advisor', 'accepted');`);
  return db;
}

const app = new Hono<any>();
app.route('/safe-issuances', safeIssuances);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 403));

async function call(db: any, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const record = (db: any, who: number, project: number, body: Record<string, unknown>) => call(db, who, 'POST', `/safe-issuances/project/${project}`, body);
const list = (db: any, who: number, project: number) => call(db, who, 'GET', `/safe-issuances/project/${project}`);
const count = (db: any) => Number((db.prepare('SELECT COUNT(*) AS n FROM safe_issuances').get() as any).n);
const TERMS = { investor_name: 'Ana Angel', amount_cents: 2500000, valuation_cap_cents: 1000000000 };

test('a founder records a SAFE\'s terms; it lists as a draft, in the cap-only form, with no discount', async () => {
  const db = fixture();
  const r = await record(db, OWNER, 1, { ...TERMS, prospect_id: 5 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.status, { key: 'draft', label: 'Draft · not sent' });
  const row = db.prepare('SELECT project_id, prospect_id, investor_name, form, amount_cents, valuation_cap_cents, envelope_id, created_by FROM safe_issuances').get() as any;
  assert.deepEqual({ ...row }, { project_id: 1, prospect_id: 5, investor_name: 'Ana Angel', form: 'post_money_cap', amount_cents: 2500000, valuation_cap_cents: 1000000000, envelope_id: null, created_by: OWNER });
  const l = await list(db, OWNER, 1);
  assert.equal(l.status, 200);
  assert.equal(l.body.form, 'post_money_cap');
  assert.equal(l.body.sendable, false);
  assert.equal(l.body.safes.length, 1);
  assert.equal(l.body.safes[0].discount, null);
  assert.deepEqual(l.body.safes[0].status, { key: 'draft', label: 'Draft · not sent' });
  assert.equal(l.body.safes[0].amount_cents, 2500000);
});

test('terms are refused unless they are whole positive cents in this form, for this round\'s prospect', async () => {
  const db = fixture();
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ ...TERMS, investor_name: '  ' }, 'investor_name_required'],
    [{ ...TERMS, amount_cents: 0 }, 'amount_cents_invalid'],
    [{ ...TERMS, amount_cents: 25000.5 }, 'amount_cents_invalid'],
    [{ ...TERMS, amount_cents: '2500000' }, 'amount_cents_invalid'],
    [{ ...TERMS, valuation_cap_cents: -1 }, 'valuation_cap_cents_invalid'],
    [{ ...TERMS, valuation_cap_cents: undefined }, 'valuation_cap_cents_invalid'],
    [{ ...TERMS, discount: 20 }, 'discount_not_in_form'],
    [{ ...TERMS, prospect_id: 6 }, 'prospect_not_on_project'],
    [{ ...TERMS, prospect_id: 'x' }, 'prospect_not_on_project'],
  ];
  for (const [body, error] of cases) {
    const r = await record(db, OWNER, 1, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(r.body, { error }, JSON.stringify(body));
  }
  assert.equal(count(db), 0);
  assert.equal((await record(db, OWNER, 1, { ...TERMS, discount: null })).status, 200, 'an explicit null discount is the form');
});

test('the status is the envelope\'s and nothing else: no envelope is never "Sent" or "Countersigned"', async () => {
  const db = fixture();
  for (const n of ['A', 'B', 'C', 'D', 'E']) await record(db, OWNER, 1, { ...TERMS, investor_name: `Investor ${n}` });
  const env = db.prepare("INSERT INTO esign_envelopes (envelope_uuid, document_type, document_title, document_body, body_sha256, status, created_by) VALUES (?, 'safe', 'SAFE', 'b', 'h', ?, 1)");
  const link = db.prepare('UPDATE safe_issuances SET envelope_id = ? WHERE investor_name = ?');
  for (const [name, status] of [['Investor B', 'sent'], ['Investor C', 'completed'], ['Investor D', 'void'], ['Investor E', 'rejected']]) {
    const id = Number(env.run(`env-${name}`, status).lastInsertRowid);
    link.run(id, name);
  }
  const l = await list(db, OWNER, 1);
  assert.deepEqual(l.body.safes.map((s: any) => [s.investor_name, s.status.label]), [
    ['Investor A', 'Draft · not sent'], ['Investor B', 'Sent'], ['Investor C', 'Countersigned'],
    ['Investor D', 'Voided'], ['Investor E', 'Declined'],
  ]);
  // An envelope id with no envelope behind it does not read as sent.
  db.prepare("UPDATE safe_issuances SET envelope_id = 999 WHERE investor_name = 'Investor A'").run();
  const again = await list(db, OWNER, 1);
  assert.notEqual(again.body.safes[0].status.label, 'Sent');
  assert.notEqual(again.body.safes[0].status.label, 'Countersigned');
  assert.equal(safeStatus(null).key, 'draft');
  assert.equal(safeStatus('partially_signed').label, 'Signed by some parties');
});

test('sending is refused while no counsel-approved SAFE text is registered', async () => {
  const db = fixture();
  const r = await record(db, OWNER, 1, TERMS);
  assert.equal(safeSendable(), false, 'a SAFE text is registered: this test and D578 need revisiting');
  const s = await call(db, OWNER, 'POST', `/safe-issuances/${r.body.uid}/send`);
  assert.equal(s.status, 409);
  assert.equal(s.body.error, 'safe_text_not_approved');
  assert.equal((db.prepare('SELECT envelope_id FROM safe_issuances').get() as any).envelope_id, null);
  const esign = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/esignOriginators.ts'), 'utf8');
  assert.match(esign, /\{ name: 'SAFE', tag: 'Financing', reason: NO_BODY \}/, 'SAFE left the not-offered list without a text');
});

test('a founder or co-founder records; an advisor member reads only; anyone else gets 404', async () => {
  const db = fixture();
  assert.equal((await record(db, COFOUNDER, 1, TERMS)).status, 200);
  assert.equal((await record(db, ADMIN, 1, TERMS)).status, 200);
  const adv = await record(db, ADVISOR, 1, TERMS);
  assert.equal(adv.status, 404, 'an advisor member recorded terms');
  assert.equal((await list(db, ADVISOR, 1)).status, 200);
  for (const who of [OTHER, INVESTOR]) {
    assert.equal((await list(db, who, 1)).status, 404, `${who} read`);
    assert.equal((await record(db, who, 1, TERMS)).status, 404, `${who} recorded`);
  }
  const uid = (db.prepare('SELECT uid FROM safe_issuances LIMIT 1').get() as any).uid;
  assert.equal((await call(db, OTHER, 'POST', `/safe-issuances/${uid}/send`)).status, 404);
  assert.equal((await list(db, OWNER, 99)).status, 404);
  assert.equal(count(db), 2);
});

test('migration 410 holds the form and positive amounts', () => {
  const db = fixture();
  const ins = db.prepare('INSERT INTO safe_issuances (project_id, investor_name, form, amount_cents, valuation_cap_cents, created_by) VALUES (1, ?, ?, ?, ?, 10)');
  assert.throws(() => ins.run('A', 'post_money_cap_discount', 1, 1), /CHECK/);
  assert.throws(() => ins.run('A', 'post_money_cap', 0, 1), /CHECK/);
  assert.throws(() => ins.run('A', 'post_money_cap', 1, 0), /CHECK/);
  assert.throws(() => ins.run(' ', 'post_money_cap', 1, 1), /CHECK/);
  ins.run('A', 'post_money_cap', 1, 1);
});
