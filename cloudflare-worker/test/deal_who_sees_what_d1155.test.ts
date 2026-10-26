/**
 * D1155 (#3060, DL15) — who sees what on a deal page, read from the Worker's
 * own replies, for the seven viewers DL15 names: you, a colleague at your
 * firm, another investor on the deal, the deal's founder, an Operating
 * Partner, an Admin and a Super Admin (an admin by role).
 *
 * The kinds of information this file drives are the ones `routes/deals.ts`
 * answers: your commitment and its note, other investors' commitments, the
 * activity, the studio's internal deal notes, and whether an IC condition
 * holds wires. The other kinds are other routers' and other tests' (the table
 * in `frontend/src/pages/deal/dealAudienceModel.js` names each one's source).
 *
 * Real router on real `node:sqlite`, with the tables from `schema_baseline.sql`
 * and migration 334's `ic_conditions`. Every name and note is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_who_sees_what_d1155.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import deals from '../src/routes/deals.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const IC_CONDITIONS = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/334_ic_conditions_and_minutes.sql'), 'utf8');
function ddl(name: string, src = BASELINE): string {
  const head = src === BASELINE ? `\nCREATE TABLE ${name} (` : `\nCREATE TABLE IF NOT EXISTS ${name} (`;
  const at = `\n${src}`.indexOf(head);
  assert.ok(at >= 0, `${name} is no longer defined where this test reads it`);
  return src.slice(at, src.indexOf(');', at) + 2);
}

const YOU = 2, COLLEAGUE = 3, OTHER = 4, FOUNDER = 5, OP = 6, ADMIN = 1, SUPER = 7;
const ROLE: Record<number, string> = { 1: 'admin', 2: 'investor', 3: 'investor', 4: 'investor', 5: 'founder', 6: 'partner', 7: 'admin' };
const NAMES: Record<number, string> = { 1: 'Sam Staff', 2: 'Ada Angel', 3: 'Cam Colleague', 4: 'Ben Backer', 5: 'Fay Founder', 6: 'Pat Partner', 7: 'Hal Headquarters' };
const ADA_NOTE = 'Ada private sizing note';
const BEN_NOTE = 'Ben private sizing note';
const STUDIO_NOTE = 'Studio internal deal note';
const VIEWERS: Array<[string, number]> = [['you', YOU], ['colleague', COLLEAGUE], ['other investor', OTHER], ['founder', FOUNDER], ['Operating Partner', OP], ['Admin', ADMIN], ['Super Admin', SUPER]];

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'deals', 'deal_invitations', 'commitments', 'ic_decisions', 'user_company_links', 'super_admins', 'partners']) db.exec(ddl(t));
  db.exec(ddl('ic_conditions', IC_CONDITIONS));
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active, investor_tier) VALUES (?, ?, ?, ?, 1, ?)`);
  for (const [id, role] of Object.entries(ROLE)) u.run(Number(id), role, NAMES[Number(id)], `u${id}@example.test`, 'professional');
  db.exec(`UPDATE users SET founder_id = 50 WHERE id = ${FOUNDER}`);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER})`);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (10, 'Harbor Ledger', 50)`);
  db.exec(`INSERT INTO deals (id, project_id, status, notes, created_at) VALUES (1, 10, 'active', '${STUDIO_NOTE}', '2026-10-01 09:00:00')`);
  // You and your colleague are one firm (70); the other investor is another (80).
  db.exec(`INSERT INTO user_company_links (uid, user_id, company_id) VALUES ('ucl-you', ${YOU}, 70), ('ucl-col', ${COLLEAGUE}, 70), ('ucl-oth', ${OTHER}, 80)`);
  db.exec(`INSERT INTO deal_invitations (deal_id, investor_user_id, status, created_at) VALUES
    (1, ${YOU}, 'interested', '2026-10-02 09:00:00'), (1, ${COLLEAGUE}, 'invited', '2026-10-02 09:00:00'), (1, ${OTHER}, 'invited', '2026-10-03 09:00:00')`);
  db.exec(`INSERT INTO commitments (deal_id, investor_user_id, amount, status, notes, created_at, company_id) VALUES
    (1, ${YOU}, 50000, 'pending', '${ADA_NOTE}', '2026-10-05 09:00:00', 70),
    (1, ${OTHER}, 75000, 'confirmed', '${BEN_NOTE}', '2026-10-06 09:00:00', 80)`);
  return db;
}

const app = (() => {
  const a = new Hono();
  a.route('/api/deals', deals as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    return st ? c.json({ detail: err.message }, st) : c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function get(db: DatabaseSync, who: number, path: string) {
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://x/api/deals/1${path}`, { headers: { Authorization: `Bearer ${tok}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* a non-JSON reply is asserted on below */ }
  return { status: res.status, body, text };
}

test('DL15 · your commitment and its note: only you read your note; your firm’s colleague and another investor read none of it', async () => {
  const db = freshDb();
  try {
    const you = await get(db, YOU, '/commitments');
    assert.equal(you.status, 200, you.text);
    assert.deepEqual(you.body.map((r: any) => [r.investor_name, r.amount, r.status, r.notes]), [['Ada Angel', 50000, 'pending', ADA_NOTE]]);
    for (const [label, who] of [['colleague', COLLEAGUE], ['other investor', OTHER]] as const) {
      const r = await get(db, who, '/commitments');
      assert.equal(r.status, 200, `${label}: ${r.text}`);
      for (const leak of [ADA_NOTE, 'Ada Angel', '50000']) assert.ok(!r.text.includes(leak), `${label} reads ${leak}`);
    }
    // The other investor reads their own row and note, and no one else's.
    const other = await get(db, OTHER, '/commitments');
    assert.deepEqual(other.body.map((r: any) => [r.investor_name, r.notes]), [['Ben Backer', BEN_NOTE]]);
  } finally { db.close(); }
});

test('DL15 · other investors’ commitments: the founder, an Operating Partner, an Admin and a Super Admin read every row by name, amount and status, never a note', async () => {
  const db = freshDb();
  try {
    for (const [label, who] of VIEWERS.slice(3)) {
      const r = await get(db, who, '/commitments');
      assert.equal(r.status, 200, `${label}: ${r.text}`);
      assert.ok(Array.isArray(r.body), `${label} reads rows, not a total`);
      assert.deepEqual(r.body.map((x: any) => [x.investor_name, x.amount, x.status]), [['Ben Backer', 75000, 'confirmed'], ['Ada Angel', 50000, 'pending']], label);
      for (const row of r.body) assert.ok(!('notes' in row), `${label}: a row carries its note key`);
      for (const note of [ADA_NOTE, BEN_NOTE]) assert.ok(!r.text.includes(note), `${label} reads an investor's note`);
    }
  } finally { db.close(); }
});

test('DL15 · activity: the founder, an Operating Partner and staff read names; an investor reads "You" and "An investor"', async () => {
  const db = freshDb();
  try {
    for (const [label, who] of VIEWERS.slice(3)) {
      const labels = (await get(db, who, '/activity')).body.map((e: any) => e.label);
      assert.ok(labels.includes('Ben Backer committed 75,000 USD') && labels.includes('Ada Angel committed 50,000 USD'), `${label}: ${labels}`);
    }
    const you = (await get(db, YOU, '/activity')).body.map((e: any) => e.label);
    assert.ok(you.includes('You committed 50,000 USD') && you.includes('An investor committed'));
    for (const [label, who] of VIEWERS.slice(0, 3)) {
      const t = (await get(db, who, '/activity')).text;
      for (const note of [ADA_NOTE, BEN_NOTE]) assert.ok(!t.includes(note), `${label}: ${note}`);
      if (who !== OTHER) assert.ok(!t.includes('Ben Backer'), `${label} reads another investor's name`);
    }
  } finally { db.close(); }
});

test('DL15 · the studio’s internal deal notes: staff only — never an investor or the founder', async () => {
  const db = freshDb();
  try {
    for (const [label, who] of VIEWERS) {
      const r = await get(db, who, '');
      assert.equal(r.status, 200, `${label}: ${r.text}`);
      const staff = who === OP || who === ADMIN || who === SUPER;
      assert.equal(r.text.includes(STUDIO_NOTE), staff, `${label} ${staff ? 'does not read' : 'reads'} the studio's note`);
    }
  } finally { db.close(); }
});

test('DL17a · an open IC condition holds wires: an Admin reads the gate; nobody else may', async () => {
  const db = freshDb();
  try {
    const clear = await get(db, ADMIN, '/transfer-gate');
    assert.equal(clear.status, 200, clear.text);
    assert.deepEqual(clear.body, { held: false, open_conditions: null });
    db.exec(`INSERT INTO ic_decisions (id, uid, deal_id, title, status, created_by) VALUES (9, 'icd-9', 1, 'Harbor Ledger seed', 'decided', ${ADMIN})`);
    db.exec(`INSERT INTO ic_conditions (uid, ic_decision_id, body, status, created_by) VALUES ('icc-1', 9, 'Board seat letter signed', 'open', ${ADMIN})`);
    const held = await get(db, ADMIN, '/transfer-gate');
    assert.deepEqual(held.body, { held: true, open_conditions: 1 });
    assert.ok(!held.text.includes('Board seat letter'), 'the condition’s words stay in the commit room');
    for (const [label, who] of VIEWERS.filter(([, w]) => w !== ADMIN && w !== SUPER)) {
      const r = await get(db, who, '/transfer-gate');
      assert.equal(r.status, 403, `${label}: ${r.status}`);
    }
  } finally { db.close(); }
});

test('the source: the commitments read never selects a note for staff or the founder, and the gate logs no text', () => {
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/deals.ts'), 'utf8');
  const read = src.slice(src.indexOf("deals.get('/:id/commitments'"), src.indexOf("deals.post('/:id/commitments'"));
  const staff = read.slice(read.indexOf("user.role === 'admin' || user.role === 'founder' || user.role === 'partner'"));
  assert.ok(staff.length > 0);
  assert.doesNotMatch(staff.slice(0, staff.indexOf('return c.json(rows);')), /c\.notes/, 'staff and the founder never read a note');
  const gate = src.slice(src.indexOf("deals.get('/:id/transfer-gate'"), src.indexOf("deals.post('/:id/transfers'"));
  assert.match(gate, /requireRole\(c, 'admin'\)/);
  assert.match(gate, /console\.error\('\[deals\] transfer gate read failed:', \(e as Error\)\?\.name\)/, 'the log names the error, never its text');
});
