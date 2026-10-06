/**
 * D601 (#998; the owner's answer 1A) — an Axal admin records a paid formation
 * order's packet, then its state filing, by hand.
 *
 * The real admin router and the founder's order read run over node:sqlite with
 * the baseline's tables and migration 411 itself. What is pinned:
 *   - "Packet ready" attaches a document of the order's own project, once, and
 *     only from paid / packet_processing;
 *   - "Filed with the state" needs a ready packet and a real date that is not in
 *     the future or before payment, once;
 *   - each step stores who recorded it and logs the acting admin;
 *   - only an admin writes; the founder's order read shows what was recorded.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/incorporation_filing_d601.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import adminIncorporations from '../src/routes/admin_incorporations.ts';
import legal from '../src/routes/legal.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { markFiled, markPacketReady } from '../src/services/incorporationFiling.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1, FOUNDER = 10;
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIG411 = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/411_incorporation_packet_and_filing.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'documents', 'incorporations', 'activity_logs']) db.exec(ddl(t));
  db.exec(MIG411);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(ADMIN, 'admin', 'Hq Admin', 'hq@axal.example', null);
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (1, 'Acme', 1001), (2, 'Beta', 1002);
    INSERT INTO documents (id, project_id, title, doc_type, status) VALUES
      (51, 1, 'Formation packet — Acme', 'other', 'generated'), (52, 2, 'Beta bylaws', 'bylaws', 'generated');`);
  const o = db.prepare(`INSERT INTO incorporations (id, user_id, project_id, jurisdiction_id, company_name, amount_cents, status, paid_at)
    VALUES (?, ?, ?, 'us_de_ccorp', ?, 50000, ?, ?)`);
  o.run(7, FOUNDER, 1, 'Acme, Inc.', 'packet_processing', '2026-09-01 10:00:00');
  o.run(8, FOUNDER, 1, 'Acme Two, Inc.', 'pending_payment', null);
  return db;
}

const app = new Hono<any>();
app.route('/admin/incorporations', adminIncorporations);
app.route('/legal', legal);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 403));

async function call(db: any, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who, role: who === ADMIN ? 'admin' : 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const w = console.warn; console.warn = () => {};
  try {
    const res = await app.request(path, {
      method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { console.warn = w; }
}
const row = (db: any, id: number) => ({ ...(db.prepare('SELECT status, packet_document_id, packet_ready_by, packet_ready_at, filed_on, filed_by, filed_recorded_at FROM incorporations WHERE id = ?').get(id) as any) });
const logs = (db: any, action: string) => db.prepare('SELECT action, details, user_id FROM activity_logs WHERE action = ?').all(action).map((x: any) => ({ ...x }));
const packet = (db: any, id: number, documentId: unknown, who = ADMIN) => call(db, who, 'POST', `/admin/incorporations/${id}/packet-ready`, { document_id: documentId });
const filed = (db: any, id: number, filedOn: unknown, who = ADMIN) => call(db, who, 'POST', `/admin/incorporations/${id}/filed`, { filed_on: filedOn });

test('"Packet ready" attaches a document of the order\'s project, records the admin, and logs it', async () => {
  const db = fixture();
  const r = await packet(db, 7, 51);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const o = row(db, 7);
  assert.equal(o.status, 'packet_ready');
  assert.equal(o.packet_document_id, 51);
  assert.equal(o.packet_ready_by, ADMIN);
  assert.ok(o.packet_ready_at);
  const l = logs(db, 'incorporation_packet_ready');
  assert.equal(l.length, 1);
  assert.equal(l[0].user_id, ADMIN);
  assert.deepEqual(JSON.parse(l[0].details), { incorporation_id: 7, document_id: 51 });
});

test('"Packet ready" is refused for another project\'s document, no document, an unpaid order, or a second time', async () => {
  const db = fixture();
  assert.deepEqual((await packet(db, 7, 52)).body, { error: 'document_not_on_project' });
  assert.deepEqual((await packet(db, 7, null)).body, { error: 'document_id_required' });
  assert.deepEqual((await packet(db, 7, 999)).body, { error: 'document_not_on_project' });
  const unpaid = await packet(db, 8, 51);
  assert.equal(unpaid.status, 409);
  assert.deepEqual(unpaid.body, { error: 'order_not_awaiting_packet' });
  assert.equal((await packet(db, 99, 51)).status, 404);
  assert.equal(row(db, 7).status, 'packet_processing', 'a refusal moved the order');
  assert.equal((await packet(db, 7, 51)).status, 200);
  const again = await packet(db, 7, 51);
  assert.equal(again.status, 409, 'a second "Packet ready" was accepted');
  assert.equal(logs(db, 'incorporation_packet_ready').length, 1);
});

test('"Filed with the state" needs a ready packet and a real date, not future and not before payment', async () => {
  const db = fixture();
  const early = await filed(db, 7, '2026-09-10');
  assert.equal(early.status, 409);
  assert.deepEqual(early.body, { error: 'packet_not_ready' });
  await packet(db, 7, 51);
  for (const [d, e] of [['2026-02-31', 'filed_on_invalid'], ['10/09/2026', 'filed_on_invalid'], [null, 'filed_on_invalid'],
    ['2999-01-01', 'filed_on_future'], ['2026-08-31', 'filed_on_before_payment']] as const) {
    const r = await filed(db, 7, d);
    assert.equal(r.status, 400, String(d));
    assert.deepEqual(r.body, { error: e }, String(d));
  }
  assert.equal(row(db, 7).status, 'packet_ready');
  const ok = await filed(db, 7, '2026-09-01');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const o = row(db, 7);
  assert.equal(o.status, 'filed');
  assert.equal(o.filed_on, '2026-09-01', 'the payment day itself is a valid filing day');
  assert.equal(o.filed_by, ADMIN);
  assert.ok(o.filed_recorded_at);
  assert.deepEqual(JSON.parse(logs(db, 'incorporation_filed')[0].details), { incorporation_id: 7, filed_on: '2026-09-01' });
  assert.equal((await filed(db, 7, '2026-09-02')).status, 409, 'a second filing was accepted');
  assert.equal(row(db, 7).filed_on, '2026-09-01');
});

test('only an admin records a step or reads the list', async () => {
  const db = fixture();
  assert.equal((await packet(db, 7, 51, FOUNDER)).status, 403);
  await packet(db, 7, 51);
  assert.equal((await filed(db, 7, '2026-09-02', FOUNDER)).status, 403);
  assert.equal((await call(db, FOUNDER, 'GET', '/admin/incorporations')).status, 403);
  assert.equal(row(db, 7).status, 'packet_ready');
  assert.equal(logs(db, 'incorporation_filed').length, 0);
});

test('HQ lists paid orders only, each with its project\'s documents', async () => {
  const db = fixture();
  const r = await call(db, ADMIN, 'GET', '/admin/incorporations');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.orders.map((o: any) => o.id), [7], 'an unpaid order is listed');
  assert.deepEqual(r.body.orders[0].documents.map((d: any) => d.id), [51]);
  assert.equal(r.body.orders[0].project_name, 'Acme');
});

test('the founder\'s order read shows the packet and the filing date that were recorded', async () => {
  const db = fixture();
  await packet(db, 7, 51);
  await filed(db, 7, '2026-09-03');
  const r = await call(db, FOUNDER, 'GET', '/legal/incorporate/orders');
  assert.equal(r.status, 200);
  const o = r.body.orders.find((x: any) => x.id === 7);
  assert.equal(o.status, 'filed');
  assert.equal(o.packet_document_id, 51);
  assert.equal(o.filed_on, '2026-09-03');
  const s = await call(db, FOUNDER, 'GET', '/legal/incorporate/status?id=7');
  assert.equal(s.body.filed_on, '2026-09-03');
  assert.equal(s.body.packet_document_id, 51);
});

test('a ready packet also stops a refund', () => {
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/admin_billing.ts'), 'utf8');
  const set = src.slice(src.indexOf('const INCORPORATION_FILED_STATUSES'), src.indexOf(']);', src.indexOf('const INCORPORATION_FILED_STATUSES')));
  for (const s of ['packet_processing', 'packet_ready', 'filed']) assert.match(set, new RegExp(`'${s}'`), s);
});

test('the order\'s state is checked before anything else, so a step out of order says so', async () => {
  const db = fixture();
  // Unpaid, with a document of another project: the order's state answers first.
  const r = await packet(db, 8, 52);
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { error: 'order_not_awaiting_packet' });
  // Not packet-ready, with a bad date: the order's state answers first.
  const f = await filed(db, 7, 'not-a-date');
  assert.equal(f.status, 409);
  assert.deepEqual(f.body, { error: 'packet_not_ready' });
});

test('a step that loses a race to another admin changes nothing and answers 409', async () => {
  // The status moves between the step's read and its write, as when two
  // admins press at once. The write's own WHERE must refuse it.
  const raced = (db: any, sqlPrefix: string, interfere: string) => {
    const inner = d1Over(db);
    return {
      JWT_SECRET, ENVIRONMENT: 'development',
      DB: { ...inner, prepare(sql: string) { if (sql.startsWith(sqlPrefix)) db.exec(interfere); return inner.prepare(sql); }, exec: inner.exec, batch: inner.batch },
    } as any;
  };
  const db = fixture();
  const env = raced(db, "UPDATE incorporations SET status = 'packet_ready'", "UPDATE incorporations SET status = 'packet_ready', packet_document_id = 99 WHERE id = 7");
  const w = console.warn; console.warn = () => {};
  try {
    const out = await markPacketReady(env, 7, 51, ADMIN);
    assert.deepEqual(out, { ok: false, status: 409, error: 'order_not_awaiting_packet' });
    assert.equal(row(db, 7).packet_document_id, 99, 'the losing step overwrote the winner\'s packet');

    const db2 = fixture();
    await packet(db2, 7, 51);
    const env2 = raced(db2, "UPDATE incorporations SET status = 'filed'", "UPDATE incorporations SET status = 'filed', filed_on = '2026-09-05' WHERE id = 7");
    const out2 = await markFiled(env2, 7, '2026-09-02', ADMIN);
    assert.deepEqual(out2, { ok: false, status: 409, error: 'packet_not_ready' });
    assert.equal(row(db2, 7).filed_on, '2026-09-05', 'the losing step overwrote the winner\'s date');
  } finally { console.warn = w; }
});
