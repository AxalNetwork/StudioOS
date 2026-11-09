/**
 * D4819 (#4819), Build part 2 — the conflict board (Licences v2 L07) says who
 * changed the terms and when, and only when the record says so. D4694 already
 * refuses a stale terms write with 409 `terms_conflict`, `current_revision`
 * and `current`; this adds `changed_by` and `changed_at`. Synthetic data only.
 *
 * WHAT IS PINNED
 *   · Core terms: the PATCH and a renewal put the `terms_revision` they
 *     produced in their event, and a stale PATCH's 409 names that event's
 *     actor and time.
 *   · A winner that has not logged yet is null, never the latest older event.
 *   · The schedule: the 409 names the row's last writer and time, which the
 *     statement that bumped its revision wrote; a row without them is null.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_terms_conflict_d4819.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { licenceRevisionAlters } from './_licence_revisions.mjs';
import adminLicences from '../src/routes/admin_licences.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (f: string) => readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8');
const SCHEMA = ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'territory_licences', 'licence_admins',
  'licence_events', 'licence_territories', 'licence_seats']
  .map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n')
  + '\nCREATE TABLE licence_deployments (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT UNIQUE, code TEXT, hostname TEXT, status TEXT);\n'
  + ['202611062240_licence_event_changes.sql'].map(mig).join('\n')
  + '\n' + mig('512_licence_terms.sql').replace(/ALTER TABLE branch_licence[^;]*;/, '')
  + '\n' + mig('202611071540_licence_revision.sql')
  + '\n' + licenceRevisionAlters('territory_licences', 'licence_terms');
const SECRET = ['d4819', 'terms', 'conflict', 'fixture', 'secret'].join('-');
const ADA = 1, BEN = 2, LIC = 'lic_4819';
const REASON = 'Annual licence review';

type Hook = ((sql: string) => void) | null;

function fixture() {
  const { DB, db } = makeD1(SCHEMA);
  const hooks: { before: Hook } = { before: null };
  const wrapped: any = new Proxy(DB, {
    get(target, prop, recv) {
      if (prop === 'prepare') return (sql: string) => { hooks.before?.(sql); return target.prepare(sql); };
      return Reflect.get(target, prop, recv);
    },
  });
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(ADA, 'admin', 'Ada Okafor', 'ada@example.test');
  u.run(BEN, 'admin', 'Ben Durand', 'ben@example.test');
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${ADA}), (${BEN})`);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  s.run(ADA, 'totp-1');
  s.run(BEN, 'totp-2');
  db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, term_years,
      annual_fee_cents, currency, revenue_share_bps, token_split_bps, starts_on, renews_on)
    VALUES (1, ?, 'AXL-4819', 'Licensee', 'Brand', 'active', 3, 9000000, 'EUR', 1200, 5000, '2026-03-02', '2027-03-01')`).run(LIC);

  const env = { DB: wrapped, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  app.route('/api/admin/licences', adminLicences);
  app.onError((err: any, c) => {
    const status = ({ Unauthorized: 401, 'Admin required': 403 } as Record<string, 401 | 403>)[String(err?.message || '')];
    if (status) return c.json({ detail: err.message }, status);
    throw err;
  });
  async function call(who: number, method: string, path: string, body?: unknown) {
    const token = await new SignJWT({ user_id: who, jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const res = await withThrownResponses(() => app.request(`/api/admin/licences${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env));
    let json: any = null; try { json = await res.json(); } catch { json = null; }
    return { status: res.status, body: json };
  }
  const row = (sql: string, ...a: unknown[]) => ({ ...(db.prepare(sql).get(...a) as any) });
  const events = (name: string) => (db.prepare('SELECT detail_json, created_at, actor_user_id FROM licence_events WHERE event = ? ORDER BY id').all(name) as any[])
    .map((e) => ({ ...e, detail: JSON.parse(e.detail_json) }));
  return { db, hooks, call, row, events, T: `/${LIC}/terms` };
}

// 1 ───────────────────────────────────────────────────────────────────────────
test('a stale core-terms PATCH is told who changed the terms and when: the event that produced the current revision', async () => {
  // Mutations checked: terms_revision left out of the PATCH event; the attribution query not bound to the revision;
  // changed_by / changed_at dropped from the 409.
  const f = fixture();
  const won = await f.call(ADA, 'PATCH', f.T, { revenue_share_bps: 1000, expected_revision: 0, reason: REASON });
  assert.equal(won.status, 200, JSON.stringify(won.body));
  const [ev] = f.events('terms_changed');
  assert.equal(ev.detail.terms_revision, 1, 'the event names the revision it produced');
  assert.equal(ev.detail.reason, REASON, 'the event keeps what it held before');

  const lost = await f.call(BEN, 'PATCH', f.T, { annual_fee_cents: 10000000, expected_revision: 0, reason: REASON });
  assert.equal(lost.status, 409, JSON.stringify(lost.body));
  assert.equal(lost.body.error, 'terms_conflict');
  assert.equal(lost.body.current_revision, 1);
  assert.deepEqual([lost.body.current.revenue_share_bps, lost.body.current.annual_fee_cents], [1000, 9000000], 'the current values, not the lost ones');
  assert.deepEqual([lost.body.changed_by, lost.body.changed_at], ['Ada Okafor', ev.created_at]);
  assert.equal(f.row('SELECT annual_fee_cents FROM territory_licences').annual_fee_cents, 9000000, 'nothing of the stale write was stored');
  assert.equal(f.events('terms_changed').length, 1, 'and no event was appended for it');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('a renewal names the terms revision it produced, so a form it made stale says the renewal moved it', async () => {
  // Mutations checked: terms_revision left out of the renewal event; 'renewed' dropped from the attribution query.
  const f = fixture();
  const renewed = await f.call(ADA, 'POST', `/${LIC}/renew`, { renews_on: '2028-03-01' });
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
  const [ev] = f.events('renewed');
  assert.deepEqual(ev.detail, { renews_on: '2028-03-01', terms_revision: 1 });
  assert.equal(f.row('SELECT terms_revision FROM territory_licences').terms_revision, 1, 'the event agrees with the row');

  const lost = await f.call(BEN, 'PATCH', f.T, { term_years: 5, expected_revision: 0, reason: REASON });
  assert.equal(lost.status, 409);
  assert.equal(lost.body.current.renews_on, '2028-03-01');
  assert.deepEqual([lost.body.changed_by, lost.body.changed_at], ['Ada Okafor', ev.created_at]);
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('a winner that has not logged yet is not recorded: the older terms event is never offered in its place', async () => {
  // Mutations checked: the attribution falling back to the latest terms event; the revision compared as "at most".
  const f = fixture();
  assert.equal((await f.call(ADA, 'PATCH', f.T, { revenue_share_bps: 1000, expected_revision: 0, reason: REASON })).status, 200);
  // Another write lands between this PATCH's read and its UPDATE, and has not appended its event yet.
  let raced = false;
  f.hooks.before = (sql) => {
    if (!raced && sql.startsWith('UPDATE territory_licences') && sql.includes('terms_revision = terms_revision + 1')) {
      raced = true;
      f.db.exec('UPDATE territory_licences SET terms_revision = terms_revision + 1, revenue_share_bps = 900');
    }
  };
  const lost = await f.call(BEN, 'PATCH', f.T, { annual_fee_cents: 10000000, expected_revision: 1, reason: REASON });
  f.hooks.before = null;
  assert.equal(lost.status, 409, JSON.stringify(lost.body));
  assert.equal(lost.body.current_revision, 2);
  assert.equal(lost.body.current.revenue_share_bps, 900);
  assert.deepEqual([lost.body.changed_by, lost.body.changed_at], [null, null], 'Ada\'s older change did not take revision 2');
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('a stale schedule save is told the row\'s last writer and time; a row written without them is null', async () => {
  // Mutations checked: changed_by / changed_at dropped from the schedule 409; the writer read from the wrong column.
  const f = fixture();
  const a = await f.call(ADA, 'PUT', f.T, { terms: { payment_terms_days: 30 }, reason: REASON, expected_revision: 0 });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const stored = f.row('SELECT updated_at, updated_by_user_id FROM licence_terms');
  assert.equal(stored.updated_by_user_id, ADA);

  const b = await f.call(BEN, 'PUT', f.T, { terms: { payment_terms_days: 45 }, reason: REASON, expected_revision: 0 });
  assert.equal(b.status, 409, JSON.stringify(b.body));
  assert.deepEqual([b.body.current_revision, b.body.current.terms.payment_terms_days], [1, 30]);
  assert.deepEqual([b.body.changed_by, b.body.changed_at], ['Ada Okafor', stored.updated_at]);

  // The same refusal from the conditional UPDATE (the competing write lands after the check): still the row's writer.
  let raced = false;
  f.hooks.before = (sql) => {
    if (!raced && sql.startsWith('UPDATE licence_terms')) {
      raced = true;
      f.db.exec(`UPDATE licence_terms SET revision = revision + 1, cure_days = 20, updated_by_user_id = ${BEN}, updated_at = '2026-11-08T14:24:00.000Z'`);
    }
  };
  const c = await f.call(ADA, 'PUT', f.T, { terms: { cure_days: 10 }, reason: REASON, expected_revision: 1 });
  f.hooks.before = null;
  assert.equal(c.status, 409, JSON.stringify(c.body));
  assert.deepEqual([c.body.current_revision, c.body.changed_by, c.body.changed_at], [2, 'Ben Durand', '2026-11-08T14:24:00.000Z']);

  f.db.exec('UPDATE licence_terms SET updated_by_user_id = NULL');
  const d = await f.call(BEN, 'PUT', f.T, { terms: { cure_days: 10 }, reason: REASON, expected_revision: 0 });
  assert.equal(d.status, 409);
  assert.equal(d.body.changed_by, null, 'no writer on the row is not recorded, not a guess');
});
