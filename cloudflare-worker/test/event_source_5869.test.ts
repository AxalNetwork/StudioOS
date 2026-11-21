/**
 * #5869 (D3724 §gaps 7, D5869): every shaped event carries `source`, so the
 * cards draw the Axal badge from the event rather than assume it. The owner
 * decided Axal events only (D1487, question 1), so the value is `axal` on the
 * public list, the public detail, the signed-in reads and the recommended read.
 * The public calendar feed (.ics) is unchanged by it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import events from '../src/routes/events.ts';
import publicEvents from '../src/routes/events_public.ts';
import { EVENT_SOURCE_AXAL, buildEventsIcs, shapeEvent } from '../src/services/eventsCommon.ts';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'synthetic-5869-event-source-secret';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['109_events_core.sql', '392_event_organiser.sql', '709_event_recommendations.sql']) db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, uid TEXT, name TEXT, email TEXT, role TEXT, is_active INTEGER DEFAULT 1);
    INSERT INTO users VALUES(1,'host','Synthetic host','host@example.test','founder',1);`);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'production', DB: d1Over(db) };
  async function request(path: string, method = 'GET', body?: unknown) {
    const token = await new SignJWT({ user_id: 1 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const response = await events.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: response.status, body: await response.json() as any };
  }
  return { db, env, request };
}

test('#5869: shapeEvent returns source "axal" on the public and the host shapes alike', () => {
  assert.equal(EVENT_SOURCE_AXAL, 'axal');
  const row = { id: 1, slug: 's', title: 'Synthetic', type: 'workshop', starts_at: '2099-01-01T10:00:00Z', visibility: 'public', status: 'published' };
  assert.equal(shapeEvent(row)!.source, 'axal');
  assert.equal(shapeEvent(row, { includePrivate: true })!.source, 'axal');
  assert.equal(shapeEvent(row, { includeJoinLink: true })!.source, 'axal');
  assert.equal(shapeEvent(null), null, 'no row is still no event, not an Axal one');
});

test('#5869: the public list, the public detail and the signed-in reads each carry source on every event', async () => {
  const f = fixture();
  try {
    const made = await f.request('/', 'POST', { title: 'Synthetic source event', starts_at: '2099-01-01T12:00:00Z' });
    assert.equal(made.status, 201);
    assert.equal(made.body.event.source, 'axal', 'the host\'s own read');
    await f.request('/', 'POST', { title: 'Second synthetic event', starts_at: '2099-01-02T12:00:00Z' });
    f.db.exec("UPDATE events SET visibility='public',status='published',admin_published=1");
    const list = await publicEvents.request('/events', {}, f.env);
    assert.equal(list.status, 200);
    const feed: any = await list.json();
    assert.equal(feed.events.length, 2);
    assert.deepEqual(feed.events.map((e: any) => e.source), ['axal', 'axal'], 'Discover\'s list');
    const detail = await publicEvents.request(`/events/${feed.events[0].slug}`, {}, f.env);
    assert.equal(((await detail.json()) as any).event.source, 'axal');
    const own = await f.request(`/${made.body.event.id}`);
    assert.equal(own.status, 200);
    assert.equal(own.body.event.source, 'axal', 'the signed-in event read');
    // The public calendar feed is built from the same shape and is unchanged by the field.
    const ics = await publicEvents.request('/events.ics', {}, f.env);
    assert.equal(ics.status, 200);
    const text = await ics.text();
    assert.match(text, /X-WR-CALNAME:Axal Events/);
    assert.doesNotMatch(text, /axal\r\n|SOURCE[:;]/i, 'no source line is added to the feed');
    assert.equal(text, buildEventsIcs(feed.events.map((e: any) => ({ ...e, source: undefined }))), 'the feed is the same with or without the field');
  } finally { f.db.close(); }
});
