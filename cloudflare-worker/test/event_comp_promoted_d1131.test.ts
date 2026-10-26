/**
 * D1131 (#3011), migration 611: a free seat records where it came from
 * (`event_registrations.comp_source`) and a waitlisted place records when it
 * gained a seat (`event_registrations.promoted_at`), each written at the moment
 * it happens. No backfill: a row from before 611 holds NULL, and My events reads
 * it as "Not recorded". On `node:sqlite` with the events migrations and the
 * routers themselves.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/event_comp_promoted_d1131.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import events from '../src/routes/events.ts';
import eventsPublic from '../src/routes/events_public.ts';
import { compSourceOf } from '../src/services/eventAudience.ts';

const SECRET = 'synthetic-comp-promoted-d1131-key-'.repeat(2);
const FUTURE = '2099-03-01T10:00:00Z';
const MIGRATION_611 = readFileSync(new URL('../sql/migrations/611_event_registrations_comp_promoted.sql', import.meta.url), 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['109_events_core.sql', '392_event_organiser.sql', '546_events_review_columns.sql']) {
    db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  }
  db.exec(MIGRATION_611);
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, uid TEXT, email TEXT, name TEXT, role TEXT, is_active INTEGER DEFAULT 1,
      notification_prefs TEXT, stripe_customer_id TEXT);
    CREATE TABLE activity_logs (user_id INTEGER, action TEXT, details TEXT, actor TEXT);
    CREATE TABLE admin_audit_log (admin_user_id INTEGER, action TEXT, report_type TEXT, filters_json TEXT, actor TEXT);
    CREATE TABLE partners (id INTEGER PRIMARY KEY, email TEXT, name TEXT, status TEXT);
    INSERT INTO users (id, uid, email, name, role) VALUES
      (2, 'host', 'host@example.test', 'Host fixture', 'founder'),
      (3, 'partner', 'partner@example.test', 'Partner fixture', 'partner'),
      (4, 'member', 'member@example.test', 'Member fixture', 'founder'),
      (5, 'waiting', 'waiting@example.test', 'Waiting fixture', 'investor');
    INSERT INTO partners (id, email, name, status) VALUES (1, 'partner@example.test', 'Partner fixture', 'active'),
      (2, 'outside@example.test', 'Outside partner', 'active');`);
  const DB: any = {
    prepare(sql: string) {
      let args: any[] = [];
      const statement: any = {
        bind(...values: any[]) { args = values.map((v) => v ?? null); return statement; },
        async first() { return db.prepare(sql).get(...args) || null; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      };
      return statement;
    },
    async batch(stmts: any[]) { return Promise.all(stmts.map((s) => s.run())); },
  };
  const env: any = { DB, ENVIRONMENT: 'development', JWT_SECRET: SECRET };
  async function call(path: string, user: number | null, opts: { method?: string; body?: unknown; router?: any } = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (user != null) {
      const token = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
        .sign(new TextEncoder().encode(SECRET));
      headers.Authorization = `Bearer ${token}`;
    }
    const router = opts.router || events;
    return router.request(path, { method: opts.method || 'GET', headers, ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }) }, env);
  }
  const ev = (o: Record<string, unknown>) => {
    const row = { host_user_id: 2, type: 'meetup', title: `Event ${o.id}`, starts_at: FUTURE, visibility: 'public', status: 'published',
      admin_published: 1, price_cents: 0, waitlist_enabled: 1, ...o };
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO events (slug, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`).run(`event-${o.id}`, ...cols.map((k) => (row as any)[k]));
  };
  const reg = (o: Record<string, unknown>) => {
    const row = { status: 'confirmed', payment_status: 'none', amount_cents: 0, comp: 0, source: 'self', ...o };
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO event_registrations (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((k) => (row as any)[k]));
  };
  const row = (eventId: number, where: string, ...args: any[]): any =>
    db.prepare(`SELECT id, status, comp, comp_source, promoted_at FROM event_registrations WHERE event_id = ? AND ${where}`).get(eventId, ...args);
  const place = async (user: number, eventId: number) => {
    const res = await call('/', user);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    return body.attending.find((p: any) => Number(p.id) === eventId);
  };
  return { db, call, ev, reg, row, place };
}

test('migration 611 adds both columns nullable, and comp_source takes only the invitation sources\' words', () => {
  const f = fixture();
  const cols = f.db.prepare(`PRAGMA table_info(event_registrations)`).all() as any[];
  for (const name of ['comp_source', 'promoted_at']) {
    const col = cols.find((c) => c.name === name);
    assert.ok(col, name);
    assert.equal(col.notnull, 0, `${name} is nullable`);
    assert.equal(col.dflt_value, null, `${name} has no default, so no row is backfilled`);
  }
  f.ev({ id: 1 });
  f.reg({ id: 1, event_id: 1, user_id: 3, comp: 1, comp_source: 'auto_partner' });
  assert.throws(() => f.reg({ id: 2, event_id: 1, user_id: 4, comp: 1, comp_source: 'official_partner' }), /CHECK/);
  f.reg({ id: 3, event_id: 1, user_id: 5 });
  assert.equal(f.row(1, 'id = 3').comp_source, null);
});

test('self-register: the audience rule that comps the seat is recorded with it, and My events reads it as recorded', async () => {
  // Mutation checked: compSource not passed from POST /:id/register → comp_source NULL, recorded false;
  // placeFields ignoring reg_comp_source → null source.
  const f = fixture();
  f.ev({ id: 1, audience_rules_json: '{"comp_official_partners":true}' });
  const res = await f.call('/1/register', 3, { method: 'POST', body: {} });
  assert.equal(res.status < 400, true, `register answered ${res.status}`);
  const r = f.row(1, 'user_id = 3');
  assert.equal(r.comp, 1);
  assert.equal(r.comp_source, 'auto_partner');
  assert.equal(r.promoted_at, null, 'a direct seat was never promoted');
  const p = await f.place(3, 1);
  assert.equal(p.comp, true);
  assert.equal(p.comp_source, 'official_partner');
  assert.equal(p.comp_source_recorded, true);
  assert.equal(p.promoted_at, null);

  // Not a partner: no free seat, so nothing to record.
  const other = await f.call('/1/register', 4, { method: 'POST', body: {} });
  assert.equal(other.status < 400, true);
  assert.equal(f.row(1, 'user_id = 4').comp, 0);
  assert.equal(f.row(1, 'user_id = 4').comp_source, null);
  assert.equal((await f.place(4, 1)).comp_source_recorded, null, 'not a free seat at all');
});

test('a comp invitation the host sent records "manual", accepted signed in or by token', async () => {
  // Mutation checked: compSource dropped from POST /:id/invitation → NULL; dropped from the token respond → NULL.
  const f = fixture();
  f.ev({ id: 1 });
  f.ev({ id: 2 });
  f.db.exec(`INSERT INTO event_invitations (id, event_id, token, invited_user_id, invited_email, source, comp, status) VALUES
      (11, 1, 'tok-11', 4, 'member@example.test', 'manual', 1, 'pending'),
      (12, 2, 'tok-12', NULL, 'guest@example.test', 'manual', 1, 'pending');`);
  const signedIn = await f.call('/1/invitation', 4, { method: 'POST', body: { action: 'accept' } });
  assert.equal(signedIn.status < 400, true, `accept answered ${signedIn.status}`);
  assert.equal(f.row(1, 'user_id = 4').comp_source, 'manual');
  const p = await f.place(4, 1);
  assert.equal(p.comp_source, 'invitation');
  assert.equal(p.comp_source_recorded, true);

  const byToken = await f.call('/invite/tok-12/respond', null, { method: 'POST', body: { action: 'accept' }, router: eventsPublic });
  assert.equal(byToken.status < 400, true, `respond answered ${byToken.status}`);
  assert.equal(f.row(2, "lower(email) = 'guest@example.test'").comp_source, 'manual');
});

test('public register records the rule that comped the seat', async () => {
  // Mutation checked: compSource dropped from POST /events/:slug/register → NULL.
  const f = fixture();
  f.ev({ id: 1, audience_rules_json: '{"comp_official_partners":true}' });
  const res = await f.call('/events/event-1/register', null, { method: 'POST', body: { email: 'outside@example.test', name: 'Outside' }, router: eventsPublic });
  assert.equal(res.status < 400, true, `public register answered ${res.status}`);
  const r = f.row(1, "lower(email) = 'outside@example.test'");
  assert.equal(r.comp, 1);
  assert.equal(r.comp_source, 'auto_partner');
});

test('a seat freed by a cancel stamps promoted_at on the place that takes it, and My events returns it', async () => {
  // Mutation checked: promoteWaitlist without `promoted_at = datetime('now')` → NULL; placeFields without promoted_at → undefined.
  const f = fixture();
  f.ev({ id: 1, capacity: 1 });
  f.reg({ id: 1, event_id: 1, user_id: 4 });
  f.reg({ id: 2, event_id: 1, user_id: 5, status: 'waitlisted', waitlist_position: 1 });
  assert.equal((await f.place(5, 1)).promoted_at, null, 'still waiting');
  const res = await f.call('/1/registration', 4, { method: 'DELETE' });
  assert.equal(res.status, 200);
  const r = f.row(1, 'id = 2');
  assert.equal(r.status, 'confirmed');
  assert.match(String(r.promoted_at), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal((await f.place(5, 1)).promoted_at, r.promoted_at);
  assert.equal(f.row(1, 'id = 1').promoted_at, null, 'the cancelled seat was never promoted');
});

test('the host\'s Promote and Approve stamp promoted_at; a seat that was never waitlisted keeps NULL', async () => {
  // Mutation checked: the promote route's UPDATE without promoted_at → NULL; the approve route's waitlisted UPDATE without it → NULL.
  const f = fixture();
  f.ev({ id: 1 });
  f.ev({ id: 2 });
  f.ev({ id: 3, approval_required: 1 });
  f.reg({ id: 1, event_id: 1, user_id: 5, status: 'waitlisted', waitlist_position: 1 });
  f.reg({ id: 2, event_id: 2, user_id: 5, status: 'waitlisted', waitlist_position: 1 });
  f.reg({ id: 3, event_id: 3, user_id: 5, status: 'registered' });
  const promote = await f.call('/1/registrations/1/promote', 2, { method: 'POST', body: {} });
  assert.equal(promote.status, 200, `promote answered ${promote.status}`);
  assert.ok(f.row(1, 'id = 1').promoted_at);
  const approve = await f.call('/2/registrations/2/approve', 2, { method: 'POST', body: {} });
  assert.equal(approve.status, 200, `approve answered ${approve.status}`);
  assert.ok(f.row(2, 'id = 2').promoted_at);
  const approveSeat = await f.call('/3/registrations/3/approve', 2, { method: 'POST', body: {} });
  assert.equal(approveSeat.status, 200);
  assert.equal(f.row(3, 'id = 3').status, 'confirmed');
  assert.equal(f.row(3, 'id = 3').promoted_at, null, 'approving a held seat is not a promotion');
});

test('registering again on a reused row clears the old promotion and source', async () => {
  // Mutation checked: the seated UPDATE in registerPrincipal without `promoted_at = NULL` → the old stamp survives.
  const f = fixture();
  f.ev({ id: 1 });
  f.reg({ id: 1, event_id: 1, user_id: 4, status: 'cancelled', comp: 1, comp_source: 'manual', promoted_at: '2099-01-01 09:00:00' });
  const res = await f.call('/1/register', 4, { method: 'POST', body: {} });
  assert.equal(res.status < 400, true);
  const r = f.row(1, 'id = 1');
  assert.equal(r.status, 'confirmed');
  assert.equal(r.comp, 0);
  assert.equal(r.comp_source, null);
  assert.equal(r.promoted_at, null);
});

test('a free seat from before 611 reads "Not recorded", never a guess from today\'s rules', async () => {
  const f = fixture();
  f.ev({ id: 1, audience_rules_json: '{"comp_official_partners":true}' });
  f.reg({ id: 1, event_id: 1, user_id: 3, comp: 1 });
  const p = await f.place(3, 1);
  assert.equal(p.comp, true);
  assert.equal(p.comp_source, null);
  assert.equal(p.comp_source_recorded, false);
  assert.equal(p.promoted_at, null);
  assert.equal(f.row(1, 'id = 1').comp_source, null, 'reading the page writes nothing back');
});

test('compSourceOf: the rule wins, then a comp invitation, and anything else is NULL', () => {
  // Mutation checked: an unknown rule source recorded as 'manual' → fails; any invitation (not only a comp one) → fails.
  assert.equal(compSourceOf({ eligible: true, source: 'auto_lp' }, { comp: 1, source: 'manual' }), 'auto_lp');
  assert.equal(compSourceOf({ eligible: false, source: null }, { comp: 1, source: 'manual' }), 'manual');
  assert.equal(compSourceOf(null, { comp: 1, source: 'auto_connection' }), 'auto_connection');
  assert.equal(compSourceOf(null, { comp: 0, source: 'manual' }), null, 'a non-comp invitation made nothing free');
  assert.equal(compSourceOf(null, { comp: 1, source: 'something_else' }), null, 'an unknown word is not recorded');
  assert.equal(compSourceOf({ eligible: true, source: 'bogus' as any }, null), null, 'a rule source outside the known words is not recorded');
  assert.equal(compSourceOf(undefined, null), null);
});
