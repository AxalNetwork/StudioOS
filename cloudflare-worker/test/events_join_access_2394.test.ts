/** #2394: join links are released only to managers and confirmed, paid-up seats. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import events from '../src/routes/events.ts';
import eventsPublic from '../src/routes/events_public.ts';
import { shapeEvent, shapeAgendaItem } from '../src/services/eventsCommon.ts';
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

const JOIN = 'https://meet.example.test/private-room';
const AGENDA = 'https://meet.example.test/private-session';
// Compare complete URL tokens in JSON/calendar output, never URL substrings.
function recordedUrls(body: string): Set<string> {
  return new Set(body.match(/https?:\/\/[^\s"\\<>]+/g) || []);
}
function onlineFixture(kind = 'virtual') {
  const f = fixture();
  f.db.prepare('UPDATE events SET location_kind = ?, location_url = ? WHERE id = 1').run(kind, JOIN);
  f.db.prepare('UPDATE event_agenda_items SET location_url = ? WHERE event_id = 1').run(AGENDA);
  f.db.exec(`INSERT INTO event_invitations (event_id, invited_user_id, token, status) VALUES (1, 2, 'synthetic-invite', 'pending')`);
  return f;
}

test('#2394: public feed, detail, invitations and calendar downloads withhold virtual and hybrid join links', async () => {
  for (const kind of ['virtual', 'hybrid']) {
    const { db, env } = onlineFixture(kind);
    try {
      for (const path of ['/events', '/events/one', '/invite/synthetic-invite', '/events.ics', '/events/one/ics']) {
        const response = await eventsPublic.request(path, {}, env);
        assert.equal(response.status, 200, path);
        const body = await response.text();
        assert.equal(recordedUrls(body).has(JOIN), false, `${kind} ${path} event link`);
        assert.equal(recordedUrls(body).has(AGENDA), false, `${kind} ${path} agenda link`);
      }
    } finally { db.close(); }
  }
});

test('#2394: member detail, attending list, agenda and calendar require a confirmed seat with settled payment', async () => {
  const { db, request } = onlineFixture();
  try {
    for (const [status, payment, allowed] of [
      ['registered', 'free', false], ['waitlisted', 'free', false],
      ['declined', 'free', false], ['cancelled', 'paid', false],
      ['confirmed', 'pending', false], ['confirmed', 'refunded', false],
      ['confirmed', 'free', true], ['confirmed', 'none', true],
      ['confirmed', 'paid', true], ['attended', 'paid', true],
    ] as const) {
      db.prepare('UPDATE event_registrations SET status = ?, payment_status = ? WHERE id = 1').run(status, payment);
      for (const path of ['/1', '/1/agenda', '/1/ics', '/']) {
        const response = await request(path, 2);
        assert.equal(response.status, 200, path);
        const body = await response.text();
        assert.equal(recordedUrls(body).has(path === '/1/agenda' ? AGENDA : JOIN), allowed, `${status}/${payment} ${path}`);
        if (path === '/1') assert.equal(recordedUrls(body).has(AGENDA), allowed);
      }
    }
    db.exec('DELETE FROM event_registrations WHERE user_id = 2');
    for (const path of ['/1', '/1/agenda', '/1/ics']) {
      const response = await request(path, 2);
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.equal(recordedUrls(body).has(JOIN) || recordedUrls(body).has(AGENDA), false, `invitation alone ${path}`);
    }
  } finally { db.close(); }
});

test('#2394: host and admin retain links without a registration', async () => {
  const { db, request } = onlineFixture('hybrid');
  try {
    for (const user of [1, 3]) {
      for (const path of ['/1', '/1/agenda', '/1/ics']) {
        const response = await request(path, user);
        assert.equal(response.status, 200);
        assert.equal(recordedUrls(await response.text()).has(path === '/1/agenda' ? AGENDA : JOIN), true, `${user} ${path}`);
      }
    }
    assert.equal(recordedUrls(await (await request('/', 1)).text()).has(JOIN), true, 'hosting list');
  } finally { db.close(); }
});

test('#2394: in-person map URLs stay public; absent or unknown formats fail closed', async () => {
  for (const kind of ['physical', 'in_person']) {
    const { db, env } = onlineFixture(kind);
    try {
      for (const path of ['/events', '/events/one', '/events.ics', '/events/one/ics']) {
        const response = await eventsPublic.request(path, {}, env);
        assert.equal(response.status, 200);
        assert.equal(recordedUrls(await response.text()).has(JOIN), true, `${kind} ${path}`);
      }
      const detail: any = await (await eventsPublic.request('/events/one', {}, env)).json();
      assert.equal(detail.agenda[0].location_url, AGENDA);
    } finally { db.close(); }
  }
  for (const location_kind of [undefined, 'unknown']) {
    assert.equal(shapeEvent({ location_kind, location_url: JOIN })?.location_url, null);
  }
  assert.equal(shapeAgendaItem({ location_url: AGENDA })?.location_url, null);
});
