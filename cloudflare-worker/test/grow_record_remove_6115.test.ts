/**
 * D6115 (#6115) — Remove a Grow partner, market or obligation added by mistake.
 *
 *   1  A fresh record is removed by its record action and by its DELETE
 *      route: it leaves the module's table, card and counts, its children go
 *      with it, and activity keeps the removal.
 *   2  A record with history is refused (409) with a sentence that says what
 *      to do instead, and nothing is deleted or logged: a partner with
 *      revenue, a deal or accepted Mercury payments; an obligation held once.
 *   3  DELETE /api/compliance/events/:id runs the same delete: it refuses a
 *      held obligation and takes the agenda with a fresh one.
 *   4  Every remove is write-gated: an advisor (a reader) and another
 *      venture's founder are refused, and a foreign id is a 404.
 *
 * The database is the baseline plus every migration, with foreign keys on, as
 * D1 runs them. Every name is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/grow_record_remove_6115.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { createCycleRecords } from '../src/routes/cycle_records.ts';
import cycleGrow from '../src/routes/cycle_grow.ts';
import compliance from '../src/routes/compliance.ts';
import { OBLIGATION_KEPT, PARTNER_KEPT } from '../src/services/growWriters.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = ['fixture', 'key', 'for', 'd6115', 'grow', 'remove'].join('-');
const FOUNDER = 10, OTHER_FOUNDER = 20, ADVISOR = 12;
const A = 1, B = 2;
const PEOPLE: Array<[number, string, string]> = [[FOUNDER, 'founder', 'Ana Wren'], [OTHER_FOUNDER, 'founder', 'Ola Kestrel'], [ADVISOR, 'founder', 'Dee Advisor']];

function fixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = ON');
  for (const [id, role, name] of PEOPLE) {
    db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(id, name, `f${id}@example.test`);
    db.prepare('INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(id, role, name, `u${id}@example.test`, id);
  }
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${A}, 'Harbour Lantern', ${FOUNDER}), (${B}, 'Kestrel Mill', ${OTHER_FOUNDER})`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${A}, ${ADVISOR}, 'advisor', 'accepted')`);
  db.exec(`INSERT INTO growth_partners (id, uid, project_id, name, type, stage, created_by) VALUES
    (1, 'ptfresh', ${A}, 'Typo Partners', 'reseller', 'talking', ${FOUNDER}),
    (2, 'ptrev', ${A}, 'Revenue Partners', 'agency', 'signed', ${FOUNDER}),
    (3, 'ptdeal', ${A}, 'Deal Partners', 'referral', 'signed', ${FOUNDER}),
    (4, 'ptmercury', ${A}, 'Mercury Partners', 'integration', 'signed', ${FOUNDER}),
    (5, 'ptother', ${B}, 'Mill Agency', 'agency', 'talking', ${OTHER_FOUNDER}),
    (6, 'ptroute', ${A}, 'Route Partners', 'other', 'talking', ${FOUNDER})`);
  db.exec(`INSERT INTO partner_revenue (partner_id, month, amount_cents, source) VALUES (2, '2026-10', 50000, 'manual')`);
  db.exec(`INSERT INTO growth_partner_deals (uid, partner_id, customer, amount_cents, currency) VALUES ('dl1', 3, 'Rui Tomas', 9000, 'usd')`);
  db.exec(`INSERT INTO mercury_partner_proposals (integration_id, project_id, partner_uid, partner_company, paid_cents, payments, since, as_of, state, growth_partner_id)
    VALUES (7, ${A}, 'mp1', 'Mercury Partners', 12000, 2, '2026-09-01', '2026-11-01', 'accepted', 4)`);
  db.exec(`INSERT INTO markets (id, uid, project_id, name, created_by) VALUES
    (1, 'mkfresh', ${A}, 'Atlantis', ${FOUNDER}), (2, 'mkkeep', ${A}, 'Portugal', ${FOUNDER}), (3, 'mkother', ${B}, 'Chile', ${OTHER_FOUNDER}),
    (4, 'mkroute', ${A}, 'Narnia', ${FOUNDER})`);
  db.exec(`INSERT INTO market_entry_steps (uid, market_id, text) VALUES ('st1', 1, 'Find a distributor')`);
  db.exec(`INSERT INTO market_localisation (uid, market_id, key, done_at) VALUES ('lo1', 1, 'language', '2026-10-01')`);
  db.exec(`INSERT INTO compliance_events (id, project_id, jurisdiction, event_type, title, due_date, kind, recurrence, created_by_user_id) VALUES
    (51, ${A}, 'Unspecified', 'board_meeting', 'Mistaken board meeting', '2026-12-30', 'governance', 'quarterly', ${FOUNDER}),
    (52, ${A}, 'Unspecified', 'other', 'Held board meeting', '2026-12-31', 'governance', 'quarterly', ${FOUNDER}),
    (53, ${B}, 'Unspecified', 'annual_report', 'Annual report', '2026-12-01', NULL, 'annual', ${OTHER_FOUNDER}),
    (54, ${A}, 'Unspecified', 'risk', 'Route obligation', '2026-12-20', 'risk', 'one_time', ${FOUNDER}),
    (55, ${A}, 'Unspecified', 'culture', 'Compliance-page obligation', '2026-12-21', 'culture', 'one_time', ${FOUNDER})`);
  db.exec(`INSERT INTO obligation_agenda_items (uid, event_id, text) VALUES ('ag1', 51, 'Approve the budget'), ('ag2', 52, 'Minutes'), ('ag5', 55, 'Agenda')`);
  db.exec(`INSERT INTO obligation_occurrences (uid, event_id, held_on) VALUES ('oc1', 52, '2026-09-30')`);
  db.exec(`INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id) VALUES
    (9, ${A}, 'durable-company-building', 'obligation', 'calendar:evt1:${A}', 'compliance_events', 51)`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);
app.route('/api/cycles', createCycleRecords());
app.route('/api/compliance', compliance);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: DatabaseSync, method: string, path: string, { who = FOUNDER, body }: { who?: number; body?: unknown } = {}) {
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const rec = (db: DatabaseSync, slug: string, id: string | number, who = FOUNDER) =>
  call(db, 'GET', `/api/cycles/grow/modules/${slug}/records/${id}?project=${A}`, { who });
const act = (db: DatabaseSync, slug: string, id: string | number, key: string, who = FOUNDER) =>
  call(db, 'POST', `/api/cycles/grow/modules/${slug}/records/${id}/actions/${key}?project=${A}`, { who, body: {} });
const moduleRead = (db: DatabaseSync, slug: string) => call(db, 'GET', `/api/cycles/grow/modules/${slug}?project=${A}`);
const n = (db: DatabaseSync, sql: string, ...args: Array<string | number>) => Number((db.prepare(sql).get(...args) as any).n);
const logged = (db: DatabaseSync, type: string, id: string | number, action: string) =>
  db.prepare('SELECT project_id, user_id, details FROM activity_logs WHERE entity_type = ? AND entity_id = ? AND action = ?').all(type, String(id), action).map((row) => ({ ...row })) as any[];
const removeOf = (r: any) => r.body.actions.find((a: any) => a.key === 'remove');

test('1: a fresh partner is removed and leaves the table, card and counts; activity keeps it', async () => {
  const db = fixture();
  const action = removeOf(await rec(db, 'partner-network', 'ptfresh'));
  assert.equal(action.tone, 'danger');
  assert.equal(action.kind, 'write');
  assert.equal(action.confirm.title, 'Remove Typo Partners?');
  const before = await moduleRead(db, 'partner-network');
  assert.ok(before.body.records.rows.some((r: any) => r.id === 'ptfresh'));
  const r = await act(db, 'partner-network', 'ptfresh', 'remove');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, record: { uid: 'ptfresh', removed: true } });
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM growth_partners WHERE uid = 'ptfresh'"), 0);
  const after = await moduleRead(db, 'partner-network');
  assert.equal(after.body.records.rows.some((x: any) => x.id === 'ptfresh'), false);
  assert.equal(after.body.records.total, before.body.records.total - 1);
  // The card counts partners by stage: one fewer talking.
  const talking = (read: any) => read.body.card.series.by_stage.find((s: any) => s.stage === 'talking').count;
  assert.equal(talking(after), talking(before) - 1);
  assert.equal((await rec(db, 'partner-network', 'ptfresh')).status, 404);
  assert.deepEqual(logged(db, 'grow.partner-network', 'ptfresh', 'grow_partner_removed'),
    [{ project_id: A, user_id: FOUNDER, details: 'Partner removed: Typo Partners' }]);
});

test('1: a market goes with its entry plan and localisation; an obligation with its agenda, and its ledger row is unlinked', async () => {
  const db = fixture();
  const before = await moduleRead(db, 'market-expansion');
  assert.equal((await act(db, 'market-expansion', 'mkfresh', 'remove')).status, 200);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM markets WHERE uid = 'mkfresh'"), 0);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM market_entry_steps WHERE market_id = 1'), 0);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM market_localisation WHERE market_id = 1'), 0);
  const after = await moduleRead(db, 'market-expansion');
  assert.equal(after.body.records.total, before.body.records.total - 1);
  assert.equal(after.body.records.rows.some((x: any) => x.id === 'mkfresh'), false);
  assert.equal(logged(db, 'grow.market-expansion', 'mkfresh', 'grow_market_removed')[0]?.details, 'Market removed: Atlantis');

  const obBefore = await moduleRead(db, 'durable-company-building');
  const r = await act(db, 'durable-company-building', 51, 'remove');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM compliance_events WHERE id = 51'), 0);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM obligation_agenda_items WHERE event_id = 51'), 0);
  // The ledger row stays, unlinked, so Calendar does not propose it again.
  assert.deepEqual(db.prepare("SELECT local_id FROM connector_fed_items WHERE external_id = 'calendar:evt1:1'").all().map((x: any) => x.local_id), [null]);
  const obAfter = await moduleRead(db, 'durable-company-building');
  assert.equal(obAfter.body.records.total, obBefore.body.records.total - 1);
  assert.equal(logged(db, 'grow.durable-company-building', 51, 'grow_obligation_removed')[0]?.details, 'Obligation removed: Mistaken board meeting');
});

test('1: the DELETE routes run the same writers, write-gated', async () => {
  const db = fixture();
  assert.equal((await call(db, 'DELETE', '/api/cycles/grow/partners/ptroute', { who: ADVISOR, body: { project: A } })).status, 403);
  assert.equal((await call(db, 'DELETE', '/api/cycles/grow/partners/ptroute', { who: OTHER_FOUNDER, body: { project: A } })).status, 403);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM growth_partners WHERE uid = 'ptroute'"), 1);
  assert.deepEqual((await call(db, 'DELETE', '/api/cycles/grow/partners/ptroute', { body: { project: A } })).body, { uid: 'ptroute', removed: true });
  assert.deepEqual((await call(db, 'DELETE', '/api/cycles/grow/markets/mkroute', { body: { project: A } })).body, { uid: 'mkroute', removed: true });
  assert.deepEqual((await call(db, 'DELETE', '/api/cycles/grow/obligations/54', { body: { project: A } })).body, { id: 54, removed: true });
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM growth_partners WHERE uid = 'ptroute'") + n(db, "SELECT COUNT(*) AS n FROM markets WHERE uid = 'mkroute'")
    + n(db, 'SELECT COUNT(*) AS n FROM compliance_events WHERE id = 54'), 0);
  assert.equal(logged(db, 'grow.durable-company-building', 54, 'grow_obligation_removed').length, 1);
  // Another venture's record is a 404 through this venture.
  assert.equal((await call(db, 'DELETE', '/api/cycles/grow/partners/ptother', { body: { project: A } })).status, 404);
  assert.equal((await call(db, 'DELETE', '/api/cycles/grow/markets/mkother', { body: { project: A } })).status, 404);
  assert.equal((await call(db, 'DELETE', '/api/cycles/grow/obligations/53', { body: { project: A } })).status, 404);
  assert.equal((await call(db, 'DELETE', '/api/cycles/grow/obligations/nope', { body: { project: A } })).status, 404);
});

test('2: a partner with revenue, a deal or accepted Mercury payments is refused with what to do instead', async () => {
  const db = fixture();
  for (const uid of ['ptrev', 'ptdeal', 'ptmercury']) {
    const r = await act(db, 'partner-network', uid, 'remove');
    assert.equal(r.status, 409, `${uid} ${JSON.stringify(r.body)}`);
    assert.equal(r.body.detail, PARTNER_KEPT);
    assert.match(r.body.detail, /Ended instead/);
    assert.equal(n(db, 'SELECT COUNT(*) AS n FROM growth_partners WHERE uid = ?', uid), 1, `${uid} stays`);
    assert.equal(logged(db, 'grow.partner-network', uid, 'grow_partner_removed').length, 0, `${uid} logs no removal`);
  }
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM partner_revenue WHERE partner_id = 2'), 1);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM growth_partner_deals WHERE partner_id = 3'), 1);
  assert.equal((await call(db, 'DELETE', '/api/cycles/grow/partners/ptrev', { body: { project: A } })).status, 409);
});

test('2: a held obligation is refused, and keeps its agenda and its past meetings', async () => {
  const db = fixture();
  const r = await act(db, 'durable-company-building', 52, 'remove');
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.detail, OBLIGATION_KEPT);
  assert.match(r.body.detail, /Mark it done instead/);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM compliance_events WHERE id = 52'), 1);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM obligation_occurrences WHERE event_id = 52'), 1);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM obligation_agenda_items WHERE event_id = 52'), 1);
  assert.equal(logged(db, 'grow.durable-company-building', 52, 'grow_obligation_removed').length, 0);
});

test('3: DELETE /api/compliance/events/:id refuses a held obligation and logs a fresh one\'s removal', async () => {
  const db = fixture();
  const held = await call(db, 'DELETE', '/api/compliance/events/52');
  assert.equal(held.status, 409, JSON.stringify(held.body));
  assert.equal(held.body.detail, OBLIGATION_KEPT);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM compliance_events WHERE id = 52'), 1);
  assert.equal((await call(db, 'DELETE', '/api/compliance/events/55', { who: OTHER_FOUNDER })).status, 403);
  const fresh = await call(db, 'DELETE', '/api/compliance/events/55');
  assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
  assert.deepEqual(fresh.body, { ok: true });
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM compliance_events WHERE id = 55'), 0);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM obligation_agenda_items WHERE event_id = 55'), 0);
  assert.deepEqual(logged(db, 'grow.durable-company-building', 55, 'grow_obligation_removed'),
    [{ project_id: A, user_id: FOUNDER, details: 'Obligation removed: Compliance-page obligation' }]);
});

test('4: an advisor reads the record without Remove and is refused it', async () => {
  const db = fixture();
  const read = await rec(db, 'partner-network', 'ptfresh', ADVISOR);
  assert.equal(read.status, 200);
  assert.equal(removeOf(read), undefined);
  for (const [slug, id] of [['partner-network', 'ptfresh'], ['market-expansion', 'mkfresh'], ['durable-company-building', 51]] as const) {
    assert.equal((await act(db, slug, id, 'remove', ADVISOR)).status, 403, `${slug} advisor`);
  }
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM growth_partners WHERE uid = 'ptfresh'") + n(db, "SELECT COUNT(*) AS n FROM markets WHERE uid = 'mkfresh'")
    + n(db, 'SELECT COUNT(*) AS n FROM compliance_events WHERE id = 51'), 3);
});
