/**
 * #6216 (D6215, D6216) — the founder reads, on their own `/updates/:uid`, the
 * support their recipients promised against each ask: investor, support kind,
 * and the promised, delivered, withdrawn and cancelled dates. Never hours,
 * outcome or the entry's own words, and never to a recipient.
 *
 * Synthetic data only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/founder_ask_promises_6216.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import updates from '../src/routes/portfolio_updates.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { applySupportLedgerSchema } from './_support_ledger_schema.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(here, '../sql/migrations');
const file = (prefix: string) => readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith(`${prefix}_`))!), 'utf8');
const ddl = (prefix: string) => file(prefix).split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter((s) => /^CREATE\s+(TABLE|INDEX|UNIQUE INDEX)/i.test(s)).map((s) => `${s};`).join('\n');

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 20, ALEX = 21, BEA = 22, OUTSIDER = 30;
const SENT = '2026-11-01T00:00:00Z';

const app = new Hono<any>();
app.route('/api/portfolio-updates', updates);
const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT);
           CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);`);
  db.exec(ddl('125'));
  db.exec(file('437'));
  db.exec(file('202611091055'));
  db.exec(file('202611182124'));
  applySupportLedgerSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?,?,?,?,?)');
  u.run(FOUNDER, 'founder', 10, 'Fay', 'fay@co.example');
  u.run(ALEX, 'investor', null, 'Alex Investor', 'alex@fund.example');
  u.run(BEA, 'investor', null, 'Bea Investor', 'bea@fund.example');
  u.run(OUTSIDER, 'founder', 11, 'Olaf', 'olaf@other.example');
  db.prepare("INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'p7', 'Venture', 10), (8, 'p8', 'Other', 11)").run();
  db.prepare(`INSERT INTO portfolio_updates (id, uid, project_id, author_user_id, title, status, sent_at)
              VALUES (1, 'u1', 7, ?, 'October', 'sent', ?)`).run(FOUNDER, SENT);
  db.prepare(`INSERT INTO update_asks (id, uid, update_id, kind, text) VALUES (1, 'ask-cust', 1, 'customer', 'A grocery buyer'),
              (2, 'ask-hire', 1, 'hire', 'A VP Sales')`).run();
  const rcp = db.prepare(`INSERT INTO update_recipients (update_id, audience, user_id) VALUES (1, 'investor', ?)`);
  rcp.run(ALEX);
  rcp.run(BEA);
  return db;
}

function promise(db: DatabaseSync, uid: string, who: number, ask: string, extra: Record<string, unknown> = {}) {
  const row = { uid, project_id: 7, kind: 'customer', state: 'promised', hours: 3, summary: 'PRIVATE SUMMARY', outcome: 'PRIVATE OUTCOME',
    recorded_by: who, promised_at: null, delivered_at: null, withdrawn_at: null, cancelled_at: null, created_at: '2026-11-05T09:00:00Z', ask_uid: ask, ...extra };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO portfolio_support_entries (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...Object.values(row) as any[]);
}

async function page(db: DatabaseSync, who: number, role: string) {
  const token = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request('http://t/api/portfolio-updates/u1/page', { headers: { Authorization: `Bearer ${token}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any, ctx as any);
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as any };
}

test('the author reads each ask’s promises: investor, kind and dates, never hours or outcome', async (t) => {
  const db = fixture();
  t.after(() => db.close());
  promise(db, 's1', ALEX, 'ask-cust', { promised_at: '2026-11-06' });
  promise(db, 's2', BEA, 'ask-cust', { kind: 'intro', state: 'delivered', delivered_at: '2026-11-09' });
  promise(db, 's3', ALEX, 'ask-hire', { kind: 'hiring', state: 'withdrawn', withdrawn_at: '2026-11-10' });
  // Another company's entry carrying this ask's uid is not this founder's.
  promise(db, 's4', BEA, 'ask-hire', { project_id: 8 });

  const res = await page(db, FOUNDER, 'founder');
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.promises_readable, true);
  const byAsk = Object.fromEntries(res.body.asks.map((a: any) => [a.uid, a.promises]));
  assert.deepEqual(byAsk['ask-cust'], [
    { investor: 'Alex Investor', kind: 'customer', promised_at: '2026-11-06', delivered_at: null, withdrawn_at: null, cancelled_at: null },
    { investor: 'Bea Investor', kind: 'intro', promised_at: '2026-11-05', delivered_at: '2026-11-09', withdrawn_at: null, cancelled_at: null },
  ]);
  assert.deepEqual(byAsk['ask-hire'], [
    { investor: 'Alex Investor', kind: 'hiring', promised_at: '2026-11-05', delivered_at: null, withdrawn_at: '2026-11-10', cancelled_at: null },
  ]);
  assert.doesNotMatch(res.text, /PRIVATE SUMMARY|PRIVATE OUTCOME|"hours"/);
});

test('an ask nobody promised against reads an empty list, and an unreadable ledger reads Unavailable without failing the page', async (t) => {
  const db = fixture();
  t.after(() => db.close());
  const none = await page(db, FOUNDER, 'founder');
  assert.equal(none.status, 200, none.text);
  assert.deepEqual(none.body.asks.map((a: any) => a.promises), [[], []]);

  db.exec('DROP TABLE portfolio_support_entries');
  const broken = await page(db, FOUNDER, 'founder');
  assert.equal(broken.status, 200, broken.text);
  assert.equal(broken.body.promises_readable, false);
  assert.ok(broken.body.asks.every((a: any) => !('promises' in a)), 'an unreadable ledger is not an empty one');
});

test('a recipient never reads another recipient’s promise or name, and another founder is refused', async (t) => {
  const db = fixture();
  t.after(() => db.close());
  promise(db, 's1', ALEX, 'ask-cust', { promised_at: '2026-11-06' });
  const bea = await page(db, BEA, 'investor');
  assert.equal(bea.status, 200, bea.text);
  assert.equal(bea.body.promises_readable, undefined);
  assert.ok(bea.body.asks.every((a: any) => !('promises' in a)));
  assert.doesNotMatch(bea.text, /Alex Investor/);
  // Another company's founder is neither author nor recipient.
  assert.equal((await page(db, OUTSIDER, 'founder')).status, 403);
});
