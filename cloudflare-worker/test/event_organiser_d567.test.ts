/** D567 / #1173: real route requests against migrations 109 + 392, never hand-added columns. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import events, { registerPrincipal } from '../src/routes/events.ts';
import { agendaLocation, registrationEligibility, validateRegistrationRules } from '../src/services/eventOrganiser.ts';
const SECRET = 'event-organiser-fixture-key-'.repeat(3);
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['109_events_core.sql', '392_event_organiser.sql']) db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, uid TEXT, email TEXT, name TEXT, role TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE user_personas (user_id INTEGER, persona_id TEXT);
    CREATE TABLE activity_logs (action TEXT, details TEXT, actor TEXT, user_id INTEGER);
    INSERT INTO users VALUES (1, 'host', 'host@example.test', 'Host Fixture', 'founder', 1), (2, 'other', 'member@example.test', 'Member Fixture', 'investor', 1), (3, 'admin', 'admin@example.test', 'Admin Fixture', 'admin', 1);
    INSERT INTO user_personas VALUES (2, 'angel_scout');
    INSERT INTO events (id, slug, host_user_id, title, starts_at, status, visibility, admin_published, capacity) VALUES (1, 'one', 1, 'Fixture event', '2099-01-01', 'published', 'public', 1, 2), (2, 'two', 2, 'Other fixture', '2099-01-01', 'published', 'public', 1, 2);
    INSERT INTO event_registrations (id, event_id, user_id, email, name, status, payment_status) VALUES (1, 1, 2, 'member@example.test', 'Member Fixture', 'registered', 'free'), (2, 1, NULL, 'waiting@example.test', 'Waiting Fixture', 'waitlisted', 'pending');
    INSERT INTO event_agenda_items (id, event_id, title, display_order) VALUES (1, 1, 'First', 0), (2, 1, 'Second', 1), (3, 2, 'Other event', 0);`);
  const DB = { prepare(sql: string) { let args: any[] = []; const statement: any = {
    bind(...values: any[]) { args = values.map(v => v ?? null); return statement; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  }; return statement; }, async batch(statements: any[]) { db.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.run()); db.exec('COMMIT'); return results; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
  const env: any = { DB, ENVIRONMENT: 'production', JWT_SECRET: SECRET };
  async function request(path: string, user = 1, method = 'GET', body?: unknown) {
    const token = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    return events.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  }
  return { db, env, request };
}
test('D567: host and admin gates cover every organiser write; outsider writes nothing', async () => {
  const { db, request } = fixture();
  for (const [path, method, body] of [['/1', 'PATCH', { audience_rules_json: '{"mode":"invite_only"}' }], ['/1/registrations/1/approve', 'POST', {}], ['/1/registrations/1/decline', 'POST', { reason: 'Fixture reason' }], ['/1/registrations/2/promote', 'POST', {}], ['/1/agenda', 'POST', { title: 'No' }], ['/1/agenda/1', 'PATCH', { title: 'No' }], ['/1/agenda/1', 'DELETE', undefined], ['/1/agenda/reorder', 'POST', { item_ids: [2, 1] }]] as const) {
    assert.equal((await request(path, 2, method, body)).status, 403);
  }
  assert.deepEqual(db.prepare('SELECT title FROM event_agenda_items ORDER BY id').all().map(r => r.title), ['First', 'Second', 'Other event']);
  assert.equal((await request('/1', 3, 'PATCH', { approval_required: true })).status, 200);
});
test('D567: decline stores trimmed reason, actor and timestamp; roster exposes actor name only', async () => {
  const { db, request } = fixture();
  db.exec(`CREATE TRIGGER decision_pair BEFORE UPDATE OF status ON event_registrations WHEN NEW.id = 1 AND NEW.status = 'declined' AND (NEW.decided_by_user_id IS NULL OR NEW.decided_at IS NULL) BEGIN SELECT RAISE(ABORT, 'decision must accompany status'); END;`);
  assert.equal((await request('/1/registrations/1/decline', 1, 'POST', { reason: '  Capacity review  ' })).status, 200);
  const row: any = db.prepare('SELECT * FROM event_registrations WHERE id = 1').get();
  assert.equal(row.decision_reason, 'Capacity review');
  assert.equal(row.decided_by_user_id, 1);
  assert.match(row.decided_at, /^\d{4}-\d{2}-\d{2} /);
  const roster: any = await (await request('/1/roster')).json();
  assert.deepEqual([roster.registrations[0].decided_by_name, roster.registrations[0].decision_reason], ['Host Fixture', 'Capacity review']);
  assert.equal(JSON.stringify(roster.registrations).includes('host@example.test'), false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'event_registration_decline' AND user_id = 1").get()?.n, 1);
  assert.equal((await request('/1/registrations/1/decline', 1, 'POST', { reason: 'x'.repeat(1001) })).status, 400);
  assert.equal((await request('/1/registrations/1/decline', 1, 'POST', { reason: 123 })).status, 400);
});
test('D567: approve and promote record decisions without giving unpaid tickets a code', async () => {
  const { db, request } = fixture();
  assert.equal((await request('/1/registrations/1/approve', 3, 'POST', {})).status, 200);
  assert.equal((await request('/1/registrations/2/promote', 1, 'POST', {})).status, 200);
  assert.deepEqual(db.prepare('SELECT decided_by_user_id FROM event_registrations ORDER BY id').all().map(r => r.decided_by_user_id), [3, 1]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM event_checkins WHERE registration_id = 2').get()?.n, 0);
  assert.equal((await request('/1/registrations/2/promote', 1, 'POST', {})).status, 400);
});
test('D567: invalid audience writes fail; saved selected rules gate central registration and preview', async () => {
  const { db, env, request } = fixture();
  for (const value of ['{', [], { mode: 'other' }, { mode: 'selected' }, { mode: 'selected', roles: ['super_admin'] }, { mode: 'selected', personas: ['invented'] }, { mode: 'everyone', bogus: true }]) assert.equal((await request('/1', 1, 'PATCH', { audience_rules_json: value })).status, 400);
  assert.equal((await request('/1', 1, 'PATCH', { audience_rules_json: JSON.stringify({ mode: 'selected', roles: ['founder'], comp_investors: true }) })).status, 200);
  const event: any = db.prepare('SELECT * FROM events WHERE id = 1').get();
  assert.equal((await registrationEligibility(env, event, 2, 'member@example.test')).eligible, false);
  assert.equal((await registrationEligibility(env, event, 1, 'host@example.test')).eligible, true);
  const c: any = { env, json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }) };
  assert.equal((await registerPrincipal(c, event, { userId: null, email: 'public@example.test', name: 'Fixture', comp: false, paid: false, source: 'self', invitationId: null, answers: null })).status, 403);
  assert.equal(JSON.parse(event.audience_rules_json).comp_investors, true);
  assert.equal((await request('/1', 1, 'PATCH', { audience_rules: { mode: 'selected', personas: ['angel_scout'] } })).status, 200);
  assert.equal((await registrationEligibility(env, db.prepare('SELECT * FROM events WHERE id = 1').get(), 2, 'member@example.test')).eligible, true);
});
test('D567: invite-only needs a non-revoked invitation, legacy rules remain everyone', async () => {
  const { db, env } = fixture(); const event: any = db.prepare('SELECT * FROM events WHERE id = 1').get();
  assert.equal((await registrationEligibility(env, event, 2, 'member@example.test')).eligible, true);
  event.audience_rules_json = '{"mode":"invite_only"}';
  assert.equal((await registrationEligibility(env, event, 2, 'member@example.test')).eligible, false);
  db.exec("INSERT INTO event_invitations (event_id, invited_user_id, token, status) VALUES (1, 2, 'fixture-invite', 'pending')");
  assert.equal((await registrationEligibility(env, event, 2, 'member@example.test')).eligible, true);
  db.exec("UPDATE event_invitations SET status = 'revoked'");
  assert.equal((await registrationEligibility(env, event, 2, 'member@example.test')).eligible, false);
});
test('D567: agenda location round trip and HTTPS validation, scoped edit never returns a foreign item', async () => {
  const { request } = fixture();
  const created: any = await (await request('/1/agenda', 1, 'POST', { title: 'Room fixture', location_text: '  Room A  ', location_url: 'https://example.test/meeting' })).json();
  assert.deepEqual([created.item.location_text, created.item.location_url], ['Room A', 'https://example.test/meeting']);
  assert.equal((await request('/1/agenda/1', 1, 'PATCH', { location_url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await request('/1/agenda', 1, 'POST', { title: 'Bad', location_url: 'http://example.test' })).status, 400);
  assert.equal((await request('/1/agenda/3', 1, 'PATCH', { title: 'Leaked' })).status, 404);
  const updated: any = await (await request('/1/agenda/1', 1, 'PATCH', { location_text: 'Room B', location_url: null })).json();
  assert.deepEqual([updated.item.location_text, updated.item.location_url], ['Room B', null]);
});
test('D567: bulk reorder requires exactly this event’s IDs, changes no other event and is audited', async () => {
  const { db, request } = fixture();
  for (const ids of [[1, 3], [1, 1], [1], [1, 2, 3], ['1', 2], [0, 2]]) assert.equal((await request('/1/agenda/reorder', 1, 'POST', { item_ids: ids })).status, 400);
  assert.equal((await request('/1/agenda/reorder', 1, 'POST', { item_ids: [2, 1] })).status, 200);
  assert.deepEqual(db.prepare('SELECT display_order FROM event_agenda_items ORDER BY id').all().map(r => r.display_order), [1, 0, 0]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'event_agenda_reordered'").get()?.n, 1);
});
test('D567: own registration read never returns somebody else’s registration', async () => {
  const { request } = fixture();
  assert.equal((await (await request('/1', 1)).json() as any).registration, null);
  assert.equal((await (await request('/1', 2)).json() as any).registration.id, 1);
});
test('D567: rule and location validation refuse ambiguous types and credential-bearing links', () => {
  assert.throws(() => validateRegistrationRules({ mode: 'everyone', comp_investors: 'yes' }));
  assert.throws(() => validateRegistrationRules({ mode: 'selected', roles: ['founder', 'founder'] }));
  assert.throws(() => agendaLocation({ location_url: 'https://user:pass@example.test' }));
  assert.throws(() => agendaLocation({ location_text: 12 }));
  assert.deepEqual(agendaLocation({ location_text: '   ', location_url: '' }), { location_text: null, location_url: null });
});
