/**
 * #4570, the slice of #9040 (D9040): the 22 `/api/partner-office-hours` and `/api/partnernet` ledger routes, through
 * the mounted routers on the full schema.
 *
 * OFFICE HOURS (partner_office_hours.ts, services/partnerBookingFollowups.ts). Partner A (firm A) owns two slots and
 * the sessions booked on them; founder F booked them. Partner B and partner C are other firms, F2 another founder.
 *   · A slot is its firm's: another firm's partner gets 404, a non-partner 403, an admin with no firm 400.
 *   · The four booking transitions answer 403 to anyone who is not a party to the booking; confirm, complete and
 *     no-show are the partner's alone, cancel either party's. An admin may move a booking (the `transition` rule).
 *   · Action items and the rating answer every non-party, staff included, the same 404 as a booking or item that
 *     does not exist (D355). Only the author deletes an item; only the founder rates.
 *   · Anyone signed in reads a partner's slots, but the meeting link and the notes are the partner's (and an
 *     admin's) and a confirmed booker's (#4715): to anyone else they are withheld.
 *   · The `/:uid/book` alias is a founder's, like the route it forwards to, and books only a slot of the partner
 *     its address names.
 *
 * PARTNERNET (partnernet.ts). Partner A and partner B hold an accepted relationship; A asked C for one (pending).
 *   · A relationship's history, interactions, reminders and edit are its two parties'. Anyone else gets 403, except
 *     an admin or a Super Admin, whose bypass writes an `admin_audit_log` row naming the route; a party's own read
 *     writes none. A reminder is its creator's: the relationship's other party is refused it too.
 *   · A request is withdrawn by its author only (404 to everyone else, admin included).
 *   · The firm book (`partner_book_contacts`) is its owner's: everyone else, admin included, gets 404.
 *
 * Every refusal changes no row. Each route's right caller then passes the same gate, so each refusal is the gate
 * and not the body. Nothing here asserts that a support session may write (#9016 refuses those).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/authz_partner_network_d4570.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import partnerOfficeHours from '../src/routes/partner_office_hours.ts';
import partnernet from '../src/routes/partnernet.ts';
import { mapError } from '../src/routes/_t13t14t15_helpers.ts';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network disabled in the #9040 fixtures'); };
after(() => { globalThis.fetch = realFetch; });

const SECRET = 'd9040-partner-network-fixture-only-'.repeat(2); // A fixture signing key; never a service credential.

// The parties. Firm A is partner 1 (uid pa), firm B partner 2 (pb), firm C partner 3 (pc).
const P_A = 1, P_B = 2, P_C = 3, F = 4, F2 = 5, INVESTOR = 6, ADMIN = 7, SUPER = 8;
const ROLES: Record<number, string> = {
  [P_A]: 'partner', [P_B]: 'partner', [P_C]: 'partner', [F]: 'founder', [F2]: 'founder', [INVESTOR]: 'investor',
  [ADMIN]: 'admin', [SUPER]: 'admin',
};
const WHO: Record<string, string> = {
  [P_A]: 'partner A', [P_B]: 'partner B', [P_C]: 'partner C', [F]: 'the booking founder', [F2]: 'another founder',
  [INVESTOR]: 'an investor', [ADMIN]: 'an admin', [SUPER]: 'a Super Admin', null: 'no credentials',
};

// Markers a leak check can find; none is a real person or company.
const LEAKS = ['Wombat', 'wombat'];

const ddl = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map((r) => r.sql).join(';\n');
  db.close();
  return sql;
})();

/** Every table a refused route of either family could have changed. */
const TABLES = ['partner_office_hour_slots', 'partner_bookings', 'partner_booking_action_items', 'partner_booking_ratings',
  'partner_relationships', 'relationship_events', 'partner_interactions', 'partner_reminders', 'partner_book_contacts',
  'partner_book_interactions', 'activity_logs', 'admin_audit_log', 'notifications'];

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(ddl);
  db.exec(`INSERT INTO partners(id,uid,name,company,email,status) VALUES
      (1,'pa','Wombat Advisory','Wombat Advisory LLC','a@example.test','active'),
      (2,'pb','Elsewhere Firm','Elsewhere','b@example.test','active'),
      (3,'pc','Third Firm','Third','c@example.test','active');
    INSERT INTO users(id,email,name,role,partner_id,is_active) VALUES
      (${P_A},'pa@example.test','Firm A Partner','partner',1,1),(${P_B},'pb@example.test','Firm B Partner','partner',2,1),
      (${P_C},'pc@example.test','Firm C Partner','partner',3,1),(${F},'f@example.test','Some Founder','founder',NULL,1),
      (${F2},'f2@example.test','Other Founder','founder',NULL,1),(${INVESTOR},'i@example.test','Some Investor','investor',NULL,1),
      (${ADMIN},'ad@example.test','Some Admin','admin',NULL,1),(${SUPER},'sa@example.test','Some Super Admin','admin',NULL,1);
    INSERT INTO super_admins(user_id) VALUES (${SUPER});
    INSERT INTO partner_office_hour_slots(id,uid,partner_id,starts_at,ends_at,capacity,meeting_url,notes,is_cancelled,created_at) VALUES
      (1,'sl1',1,'2099-01-01T15:00:00Z','2099-01-01T16:00:00Z',3,'https://meet.example.test/wombat-room','Wombat slot notes',0,'2026-11-01'),
      (2,'sl2',1,'2099-01-02T15:00:00Z','2099-01-02T16:00:00Z',3,'https://meet.example.test/wombat-room-2','Wombat second notes',0,'2026-11-01'),
      (3,'sl3',2,'2099-01-03T15:00:00Z','2099-01-03T16:00:00Z',3,NULL,NULL,0,'2026-11-01'),
      (4,'sl4',1,'2026-10-01T15:00:00Z','2026-10-01T16:00:00Z',3,NULL,NULL,0,'2026-09-01');
    INSERT INTO partner_bookings(id,uid,slot_id,partner_id,founder_user_id,topic,notes,status,created_at,updated_at) VALUES
      (11,'bk11',1,1,${F},'Wombat topic','Wombat booking notes','pending','2026-11-02','2026-11-02'),
      (12,'bk12',4,1,${F},'Wombat done','','completed','2026-11-02','2026-11-02');
    INSERT INTO partner_booking_action_items(id,booking_id,title,created_by_user_id,created_by_role) VALUES
      (31,12,'Wombat action item',${F},'founder');
    INSERT INTO partner_relationships(id,partner_a_id,partner_b_id,relationship_type,strength_score,metadata,status,requested_by,requested_at) VALUES
      (101,${P_A},${P_B},'co_investor',60,'{"note":"Wombat shared"}','accepted',${P_A},'2026-11-01T00:00:00Z'),
      (102,${P_A},${P_C},'co_investor',50,'{}','pending',${P_A},'2026-11-03T00:00:00Z');
    INSERT INTO relationship_events(relationship_id,event_type,details) VALUES (101,'accepted','{"by":${P_B},"what":"Wombat"}');
    INSERT INTO partner_interactions(uid,relationship_id,kind,note,interacted_at,recorded_by) VALUES
      ('ia1',101,'call','Wombat call','2026-11-04T00:00:00Z',${P_A});
    INSERT INTO partner_reminders(uid,relationship_id,remind_at,note,done,created_by) VALUES ('ra1',101,'2026-12-01','Wombat reminder',0,${P_A});
    INSERT INTO partner_book_contacts(uid,owner_user_id,name,organization,source) VALUES ('bka',${P_A},'Wombat Contact','Wombat Org','ours');`);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono()
    .route('/api/partner-office-hours', partnerOfficeHours)
    .route('/api/partnernet', partnernet);
  app.onError((e, c) => (e instanceof Response ? e : mapError(c as any, e)));
  const deferred: Promise<unknown>[] = [];
  const ctx: any = { waitUntil(p: Promise<unknown>) { deferred.push(p); }, passThroughOnException() {} };
  const call = async (who: number | null, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (who != null) {
      headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: ROLES[who] }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
    }
    const res = await app.request(path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) }, env, ctx)
      .catch((e) => { if (e instanceof Response) return e; throw e; });
    await Promise.allSettled(deferred.splice(0));
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, text, json };
  };
  /** Every row of TABLES; without the admin-bypass audit lines when `withAudit` is false (they are append-only, D156). */
  const snapshot = (withAudit = true) => JSON.stringify(TABLES.map((t) => {
    if (!withAudit && t === 'admin_audit_log') return 'audit';
    const where = !withAudit && t === 'activity_logs' ? " WHERE action IS NOT 'partnernet_admin_bypass'" : '';
    try { return db.prepare(`SELECT * FROM ${t}${where} ORDER BY rowid`).all(); } catch { return `no ${t}`; }
  }));
  const audits = () => db.prepare(`SELECT admin_user_id, action, filters_json FROM admin_audit_log ORDER BY id`).all() as any[];
  return { db, env, call, snapshot, audits };
}

const named = (r: { text: string }) => LEAKS.filter((l) => r.text.includes(l));

const OH = '/api/partner-office-hours', PN = '/api/partnernet';
type Row = {
  key: string; method: string; path: string; body?: unknown;
  /** Each caller the route refuses, and the status it answers them. */
  refused: [number | null, number][];
  /** The callers that pass the gate. */
  passes: number[];
};
const STRANGERS_404: [number | null, number][] = [[P_B, 404], [P_C, 404], [F2, 404], [INVESTOR, 404], [ADMIN, 404], [SUPER, 404], [null, 401]];
const NON_PARTY_403: [number | null, number][] = [[P_C, 403], [F, 403], [F2, 403], [INVESTOR, 403], [null, 401]];

/** The 22 ledger routes, each on a record of firm A (or of partner A's network), with a body its owner could send. */
export const ROUTES: Row[] = [
  // --- /api/partner-office-hours -------------------------------------------------------------------------------
  { key: 'DELETE /api/partner-office-hours/me/slots/:id', method: 'DELETE', path: `${OH}/me/slots/1`,
    refused: [[P_B, 404], [P_C, 404], [F, 403], [F2, 403], [INVESTOR, 403], [ADMIN, 400], [SUPER, 400], [null, 401]], passes: [P_A] },
  { key: 'POST /api/partner-office-hours/bookings/:id/confirm', method: 'POST', path: `${OH}/bookings/11/confirm`,
    refused: [[P_B, 403], [P_C, 403], [F, 403], [F2, 403], [INVESTOR, 403], [null, 401]], passes: [P_A, ADMIN] },
  { key: 'POST /api/partner-office-hours/bookings/:id/complete', method: 'POST', path: `${OH}/bookings/11/complete`,
    refused: [[P_B, 403], [P_C, 403], [F, 403], [F2, 403], [INVESTOR, 403], [null, 401]], passes: [P_A, ADMIN] },
  { key: 'POST /api/partner-office-hours/bookings/:id/no-show', method: 'POST', path: `${OH}/bookings/11/no-show`,
    refused: [[P_B, 403], [P_C, 403], [F, 403], [F2, 403], [INVESTOR, 403], [null, 401]], passes: [P_A, ADMIN] },
  { key: 'POST /api/partner-office-hours/bookings/:id/cancel', method: 'POST', path: `${OH}/bookings/11/cancel`, body: { reason: 'x' },
    refused: [[P_B, 403], [P_C, 403], [F2, 403], [INVESTOR, 403], [null, 401]], passes: [P_A, F, ADMIN] },
  { key: 'GET /api/partner-office-hours/bookings/:id{[0-9]+}/action-items', method: 'GET', path: `${OH}/bookings/12/action-items`,
    refused: STRANGERS_404, passes: [P_A, F] },
  { key: 'POST /api/partner-office-hours/bookings/:id{[0-9]+}/action-items', method: 'POST', path: `${OH}/bookings/12/action-items`,
    body: { title: 'New item' }, refused: STRANGERS_404, passes: [P_A, F] },
  { key: 'PATCH /api/partner-office-hours/action-items/:itemId{[0-9]+}', method: 'PATCH', path: `${OH}/action-items/31`,
    body: { done: true }, refused: STRANGERS_404, passes: [P_A, F] },
  { key: 'DELETE /api/partner-office-hours/action-items/:itemId{[0-9]+}', method: 'DELETE', path: `${OH}/action-items/31`,
    refused: [...STRANGERS_404, [P_A, 403]], passes: [F] },
  { key: 'PUT /api/partner-office-hours/bookings/:id{[0-9]+}/rating', method: 'PUT', path: `${OH}/bookings/12/rating`,
    body: { rating: 5 }, refused: [...STRANGERS_404, [P_A, 403]], passes: [F] },
  { key: 'POST /api/partner-office-hours/:uid/book', method: 'POST', path: `${OH}/pa/book`, body: { slot_id: 2 },
    refused: [[P_A, 403], [P_B, 403], [INVESTOR, 403], [null, 401]], passes: [F2] },
  // GET /partners/:uid/slots answers everyone signed in; what it withholds is tested on its own below.
  // --- /api/partnernet -------------------------------------------------------------------------------------------
  { key: 'GET /api/partnernet/relationships/:id/events', method: 'GET', path: `${PN}/relationships/101/events`,
    refused: NON_PARTY_403, passes: [P_A, P_B, ADMIN, SUPER] },
  { key: 'GET /api/partnernet/relationships/:id/interactions', method: 'GET', path: `${PN}/relationships/101/interactions`,
    refused: NON_PARTY_403, passes: [P_A, P_B, ADMIN, SUPER] },
  { key: 'PATCH /api/partnernet/relationships/:id', method: 'PATCH', path: `${PN}/relationships/101`, body: { strength_score: 70 },
    refused: NON_PARTY_403, passes: [P_A, P_B, ADMIN, SUPER] },
  { key: 'POST /api/partnernet/relationships/:id/interactions', method: 'POST', path: `${PN}/relationships/101/interactions`,
    body: { note: 'Spoke today' }, refused: NON_PARTY_403, passes: [P_A, P_B, ADMIN, SUPER] },
  { key: 'POST /api/partnernet/relationships/:id/interactions/:uid/void', method: 'POST', path: `${PN}/relationships/101/interactions/ia1/void`,
    refused: [...NON_PARTY_403, [P_B, 403], [ADMIN, 403], [SUPER, 403]], passes: [P_A] },
  { key: 'POST /api/partnernet/relationships/:id/reminders', method: 'POST', path: `${PN}/relationships/101/reminders`,
    body: { remind_at: '2027-01-15' }, refused: NON_PARTY_403, passes: [P_A, P_B, ADMIN, SUPER] },
  { key: 'PATCH /api/partnernet/reminders/:uid', method: 'PATCH', path: `${PN}/reminders/ra1`, body: { done: true },
    refused: [[P_B, 403], ...NON_PARTY_403], passes: [P_A, ADMIN, SUPER] },
  { key: 'POST /api/partnernet/relationships/:id/withdraw', method: 'POST', path: `${PN}/relationships/102/withdraw`,
    refused: [[P_B, 404], [P_C, 404], [F, 404], [INVESTOR, 404], [ADMIN, 404], [SUPER, 404], [null, 401]], passes: [P_A] },
  { key: 'PATCH /api/partnernet/book/:uid/relationship', method: 'PATCH', path: `${PN}/book/bka/relationship`, body: { relationship: 'client' },
    refused: [[P_B, 404], [P_C, 404], [F, 404], [INVESTOR, 404], [ADMIN, 404], [SUPER, 404], [null, 401]], passes: [P_A] },
  { key: 'POST /api/partnernet/book/:uid/interactions', method: 'POST', path: `${PN}/book/bka/interactions`, body: { happened_at: '2026-11-20' },
    refused: [[P_B, 404], [P_C, 404], [F, 404], [INVESTOR, 404], [ADMIN, 404], [SUPER, 404], [null, 401]], passes: [P_A] },
];
const SLOTS_KEY = 'GET /api/partner-office-hours/partners/:uid/slots';
const TEST_PATH = 'cloudflare-worker/test/authz_partner_network_d4570.test.ts';
/** The relationship routes whose admin bypass is logged (partnernet.ts, `partnernet_admin_bypass`). */
const BYPASS = new Set(['GET /api/partnernet/relationships/:id/events', 'GET /api/partnernet/relationships/:id/interactions',
  'PATCH /api/partnernet/relationships/:id', 'POST /api/partnernet/relationships/:id/interactions',
  'POST /api/partnernet/relationships/:id/interactions/:uid/void', 'POST /api/partnernet/relationships/:id/reminders',
  'PATCH /api/partnernet/reminders/:uid']);

const ledger = (family: string) => JSON.parse(readFileSync(
  new URL(`../../scripts/baselines/auth-inventory/${encodeURIComponent(encodeURIComponent(family))}.json`, import.meta.url), 'utf8'));

test('#9040: the suite covers every /api/partner-office-hours and /api/partnernet ledger route, and each is verified by it', () => {
  const entries = { ...ledger('/api/partner-office-hours'), ...ledger('/api/partnernet') };
  assert.deepEqual([...ROUTES.map((r) => r.key), SLOTS_KEY].sort(), Object.keys(entries).sort());
  assert.equal(Object.keys(entries).length, 22);
  for (const [key, entry] of Object.entries<any>(entries)) {
    assert.equal(entry.state, 'verified', key);
    assert.equal(entry.test, TEST_PATH, key);
  }
});

test('#9040: every route refuses the wrong tenant and the wrong role, names nothing, and writes nothing', async () => {
  for (const row of ROUTES) {
    const f = fixture();
    const before = f.snapshot(false), beforeAll = f.snapshot();
    for (const [who, status] of row.refused) {
      // One fixture per route: a refusal writes nothing, so the next caller meets the same rows.
      const r = await f.call(who, row.method, row.path, row.body);
      assert.equal(r.status, status, `${row.key}: ${WHO[String(who)]} got ${r.status} ${r.text.slice(0, 160)}`);
      assert.deepEqual(named(r), [], `${row.key}: ${WHO[String(who)]}'s refusal names the record`);
      // An admin's refused bypass (the void) is still a bypass: its audit line is the one write allowed (asserted below).
      assert.equal(f.snapshot(false), before, `${row.key}: ${WHO[String(who)]}'s refusal changed a row`);
    }
    const adminRefused = BYPASS.has(row.key) && row.refused.some(([who]) => who === ADMIN || who === SUPER);
    if (!adminRefused) assert.equal(f.snapshot(), beforeAll, `${row.key}: a refusal wrote an audit row`);
  }
});

test('#9040: the right caller passes every gate, so each refusal above is the gate and not the body', async () => {
  for (const row of ROUTES) {
    for (const who of row.passes) {
      const f = fixture();
      const before = f.snapshot();
      const r = await f.call(who, row.method, row.path, row.body);
      assert.ok(r.status >= 200 && r.status < 300, `${row.key}: ${WHO[String(who)]} got ${r.status} ${r.text.slice(0, 160)}`);
      if (row.method !== 'GET') assert.notEqual(f.snapshot(), before, `${row.key}: ${WHO[String(who)]}'s write changed nothing`);
      else if (row.path.includes('/relationships/')) assert.notDeepEqual(named(r), [], `${row.key}: ${WHO[String(who)]}'s read is empty`);
    }
  }
});

test("#9040: an admin's or Super Admin's bypass on a relationship writes an admin_audit_log row naming the route; a party's writes none", async () => {
  for (const row of ROUTES.filter((r) => BYPASS.has(r.key))) {
    for (const who of [ADMIN, SUPER]) {
      const f = fixture();
      await f.call(who, row.method, row.path, row.body);
      const rows = f.audits();
      assert.equal(rows.length, 1, `${row.key}: ${WHO[who]} left ${rows.length} audit rows`);
      assert.equal(rows[0].admin_user_id, who);
      assert.equal(rows[0].action, 'partnernet_admin_bypass');
      assert.equal(JSON.parse(rows[0].filters_json).route, row.key.replace('/api/partnernet', ''), row.key);
    }
    const f = fixture();
    await f.call(P_A, row.method, row.path, row.body);
    assert.deepEqual(f.audits(), [], `${row.key}: a party's own call was logged as a bypass`);
  }
});

test("#9040: a partner's slots answer anyone signed in, but the link and notes are the partner's, an admin's and a confirmed booker's", async () => {
  const f = fixture();
  const before = f.snapshot();
  assert.equal((await f.call(null, 'GET', `${OH}/partners/pa/slots`)).status, 401);
  for (const who of [P_B, P_C, F, F2, INVESTOR]) {
    const r = await f.call(who, 'GET', `${OH}/partners/pa/slots`);
    assert.equal(r.status, 200, `${WHO[who]} got ${r.status}`);
    assert.equal(r.json.items.length, 2);
    assert.deepEqual(named(r), [], `${WHO[who]} read the link or the notes`);
    for (const s of r.json.items) {
      assert.equal(s.has_meeting_link, true);
      assert.ok(!('meeting_url' in s) && !('notes' in s), `${WHO[who]} read the link or the notes`);
    }
  }
  for (const who of [P_A, ADMIN, SUPER]) {
    const r = await f.call(who, 'GET', `${OH}/partners/pa/slots`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.items.map((s: any) => s.meeting_url), ['https://meet.example.test/wombat-room', 'https://meet.example.test/wombat-room-2']);
  }
  f.db.exec("UPDATE partner_bookings SET status = 'confirmed' WHERE id = 11");
  const held = await f.call(F, 'GET', `${OH}/partners/pa/slots`);
  assert.deepEqual(held.json.items.map((s: any) => s.meeting_url ?? null), ['https://meet.example.test/wombat-room', null],
    'a confirmed booker reads the link of their own slot only');
  f.db.exec("UPDATE partner_bookings SET status = 'pending' WHERE id = 11");
  assert.equal(f.snapshot(), before, 'reading slots wrote a row');
});

test('#9040: the /:uid/book alias books only a slot of the partner its address names', async () => {
  const f = fixture();
  const before = f.snapshot();
  // Slot 2 is partner A's; the address names partner B.
  const wrong = await f.call(F2, 'POST', `${OH}/pb/book`, { slot_id: 2 });
  assert.equal(wrong.status, 404, `got ${wrong.status} ${wrong.text.slice(0, 160)}`);
  const unknown = await f.call(F2, 'POST', `${OH}/nobody/book`, { slot_id: 2 });
  assert.equal(unknown.status, 404);
  assert.equal(f.snapshot(), before);
  const right = await f.call(F2, 'POST', `${OH}/pa/book`, { slot_id: 2 });
  assert.equal(right.status, 200, right.text.slice(0, 160));
  assert.equal(right.json.slot_id, 2);
  assert.equal(right.json.founder_user_id, F2);
});
