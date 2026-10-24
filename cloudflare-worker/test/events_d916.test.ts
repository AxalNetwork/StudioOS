/** D916 / #2699: real event writes and independent analytics read blocks. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import events from '../src/routes/events.ts';
import adminEvents from '../src/routes/admin_events.ts';
import publicEvents from '../src/routes/events_public.ts';
import { EVENT_TYPE_IDS } from '../src/services/eventTypes.ts';
import { EVENT_TYPES, isInPersonEvent } from '../src/services/eventsCommon.ts';
import { registrationEligibility } from '../src/services/eventOrganiser.ts';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'd916-synthetic-fixture-'.repeat(3);
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['109_events_core.sql', '392_event_organiser.sql']) db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, uid TEXT, name TEXT, email TEXT, role TEXT, is_active INTEGER DEFAULT 1);
    INSERT INTO users VALUES(1,'host','Synthetic host','host@example.test','founder',1),(2,'admin','Synthetic admin','admin@example.test','admin',1),(3,'member','Synthetic member','member@example.test','investor',1);`);
  const base = d1Over(db);
  let fail = '';
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'production', DB: { ...base, prepare(sql: string) {
    if ((fail === 'summary-events' && sql.includes('COUNT(*) AS total_events')) ||
        (fail === 'summary-registrations' && sql.includes("AS registrations") && !sql.includes('FROM events e')) ||
        (fail === 'events' && sql.includes('FROM events e'))) throw new Error('Synthetic analytics read failure');
    if (fail === 'missing-summary' && sql.includes('COUNT(*) AS total_events')) return { first: async () => null };
    if (sql.includes('FROM events e')) {
      if (fail === 'failed-result') return { all: async () => ({ success: false, results: [] }) };
      if (fail === 'missing-result') return { all: async () => ({ success: true }) };
    }
    return base.prepare(sql);
  } } };
  async function request(path: string, method = 'GET', body?: unknown, user = 1) {
    const token = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    return events.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  }
  async function analytics(user: number | null = 2) {
    const token = user === null ? null : await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const response = await adminEvents.request('/analytics', { headers: token ? { Authorization: `Bearer ${token}` } : {} }, env);
    return { status: response.status, body: await response.json() as any };
  }
  const create = async (body: any = {}) => {
    const response = await request('/', 'POST', { title: 'Synthetic event', starts_at: '2099-01-01T12:00:00Z', ...body });
    return { status: response.status, body: await response.json() as any };
  };
  return { db, env, request, create, analytics, fail(block: string) { fail = block; } };
}

test('D916: create and edit preserve every canonical type, including the four formerly lost types', async () => {
  const f = fixture();
  try {
    assert.deepEqual(EVENT_TYPES, EVENT_TYPE_IDS);
    assert.equal(EVENT_TYPE_IDS.length, 12);
    for (const type of EVENT_TYPE_IDS) {
      const made = await f.create({ type });
      assert.equal(made.status, 201);
      assert.equal(made.body.event.type, type, `create ${type}`);
      const id = made.body.event.id;
      assert.equal((await f.request(`/${id}`, 'PATCH', { type: 'other' })).status, 200);
      const edited = await f.request(`/${id}`, 'PATCH', { type });
      assert.equal(edited.status, 200);
      assert.equal((await edited.json() as any).event.type, type, `edit ${type}`);
      assert.equal(f.db.prepare('SELECT type FROM events WHERE id=?').get(id)?.type, type);
    }
    const fallback = await f.create({ type: 'invented' });
    assert.equal(fallback.body.event.type, 'meetup');
    const refused = await f.request(`/${fallback.body.event.id}`, 'PATCH', { type: 'invented' });
    assert.equal((await refused.json() as any).event.type, 'meetup');
  } finally { f.db.close(); }
});

test('D916: create and edit preserve in_person and the public feed retains both new and legacy in-person rows', async () => {
  const f = fixture();
  try {
    const made = await f.create({ location_kind: 'in_person' });
    assert.equal(made.status, 201);
    assert.equal(made.body.event.location_kind, 'in_person');
    const id = made.body.event.id;
    await f.request(`/${id}`, 'PATCH', { location_kind: 'virtual' });
    const edited: any = await (await f.request(`/${id}`, 'PATCH', { location_kind: 'in_person' })).json();
    assert.equal(edited.event.location_kind, 'in_person');
    const legacy = await f.create({ location_kind: 'physical' });
    assert.equal(legacy.body.event.location_kind, 'physical');
    f.db.exec("UPDATE events SET visibility='public',status='published',admin_published=1");
    const response = await publicEvents.request('/events', {}, f.env);
    assert.equal(response.status, 200);
    const feed: any = await response.json();
    assert.deepEqual(feed.events.map((e: any) => e.location_kind).sort(), ['in_person', 'physical']);
    assert.equal(feed.events.every(isInPersonEvent), true);
  } finally { f.db.close(); }
});

test('D916: create validates editor JSON and legacy audience objects, preserving registration restrictions and comps', async () => {
  const f = fixture();
  try {
    const rules = { mode: 'selected', roles: ['founder'], comp_investors: true };
    for (const payload of [{ audience_rules_json: JSON.stringify(rules) }, { audience_rules: rules }, { audience_rules_json: JSON.stringify(rules), audience_rules: { mode: 'everyone' } }]) {
      const made = await f.create(payload);
      assert.equal(made.status, 201);
      const stored: any = f.db.prepare('SELECT * FROM events WHERE id=?').get(made.body.event.id);
      assert.deepEqual(JSON.parse(stored.audience_rules_json), rules);
      assert.equal((await registrationEligibility(f.env, stored, 3, 'member@example.test')).eligible, false);
      assert.equal((await registrationEligibility(f.env, stored, 1, 'host@example.test')).eligible, true);
    }
    const invite = await f.create({ audience_rules_json: '{"mode":"invite_only"}' });
    assert.equal(JSON.parse(f.db.prepare('SELECT audience_rules_json FROM events WHERE id=?').get(invite.body.event.id)!.audience_rules_json as string).mode, 'invite_only');
    assert.equal((await f.create()).status, 201, 'omitted rules still allow creation');
    const before = f.db.prepare('SELECT COUNT(*) AS n FROM events').get()!.n;
    for (const invalid of ['{', 'null', [], { mode: 'selected' }, { roles: ['advisor'] }, { comp_investors: 'yes' }, { unknown: true }]) {
      const rejected = await f.create({ audience_rules_json: invalid });
      assert.deepEqual([rejected.status, rejected.body.error], [400, 'invalid_audience_rules']);
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM events').get()!.n, before, 'invalid rules create no rows');
  } finally { f.db.close(); }
});

test('D916: analytics empty reads are measured zeros and access remains admin-only', async () => {
  const f = fixture();
  try {
    const r = await f.analytics();
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.unreadable, []);
    assert.deepEqual(r.body.events, []);
    assert.deepEqual(r.body.summary, { total_events: 0, published: 0, pending_review: 0, draft: 0, cancelled: 0, total_registrations: 0, total_attended: 0, total_waitlisted: 0 });
    assert.equal((await f.analytics(1)).status, 403);
    assert.equal((await f.analytics(null)).status, 401);
  } finally { f.db.close(); }
});

test('D916: either failed summary query or failed event rows is null and explicitly unreadable, with the other block intact', async () => {
  const f = fixture();
  try {
    const made = await f.create();
    for (const fail of ['summary-events', 'summary-registrations', 'missing-summary', 'events', 'failed-result', 'missing-result']) {
      f.fail(fail);
      const r = await f.analytics();
      assert.equal(r.status, 200);
      if (['events', 'failed-result', 'missing-result'].includes(fail)) {
        assert.equal(r.body.events, null);
        assert.deepEqual(r.body.unreadable, ['events']);
        assert.equal(r.body.summary.total_events, 1);
      } else {
        assert.equal(r.body.summary, null);
        assert.deepEqual(r.body.unreadable, ['summary']);
        assert.equal(r.body.events[0].id, made.body.event.id);
      }
    }
    f.fail('');
    assert.deepEqual((await f.analytics()).body.unreadable, []);
  } finally { f.db.close(); }
});

test('D916: conversion waits for the recorded end or a full day after start, and keeps real zero distinct from unrecorded', async () => {
  const f = fixture();
  const originalNow = Date.now;
  const now = Date.parse('2026-10-24T12:00:00Z');
  Date.now = () => now;
  try {
    const cases = [
      ['upcoming', '2026-10-25T12:00:00Z', null, null],
      ['running', '2026-10-23T10:00:00Z', '2026-10-24T13:00:00Z', null],
      ['ends-now', '2026-10-24T10:00:00Z', '2026-10-24T12:00:00Z', null],
      ['ended', '2026-10-24T10:00:00Z', '2026-10-24T11:59:59Z', 0.5],
      ['fallback-running', '2026-10-23T12:00:01Z', null, null],
      ['fallback-boundary', '2026-10-23T12:00:00Z', null, null],
      ['fallback-ended', '2026-10-23T11:59:59Z', null, 0.5],
      ['offset-end', '2026-10-24T09:00:00Z', '2026-10-24T13:00:00+02:00', 0.5],
      ['sqlite-running', '2026-10-24 10:00:00', '2026-10-24 13:00:00', null],
      ['sqlite-utc', '2026-10-24 10:00:00', '2026-10-24 11:59:59', 0.5],
      ['invalid-end', '2026-10-23T10:00:00Z', 'unreadable', null],
    ] as const;
    for (const [title, start, end] of cases) {
      const made = await f.create({ title, starts_at: start, ends_at: end, capacity: 4 });
      assert.equal(made.status, 201);
      f.db.prepare("INSERT INTO event_registrations(event_id,email,status) VALUES(?,'attended@example.test','attended'),(?,'registered@example.test','confirmed'),(?,'cancelled@example.test','cancelled'),(?,'waiting@example.test','waitlisted')").run(made.body.event.id, made.body.event.id, made.body.event.id, made.body.event.id);
    }
    const empty = await f.create({ title: 'no-registrations', starts_at: '2026-10-20T12:00:00Z' });
    const zero = await f.create({ title: 'zero-showup', starts_at: '2026-10-20T12:00:00Z' });
    f.db.prepare("INSERT INTO event_registrations(event_id,email,status) VALUES(?,'absent@example.test','confirmed')").run(zero.body.event.id);
    const result = await f.analytics();
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.unreadable, []);
    for (const [title, start, end, expected] of cases) {
      const row = result.body.events.find((r: any) => r.title === title);
      assert.deepEqual([row.starts_at, row.ends_at, row.conversion], [start, end, expected], title);
      assert.deepEqual([row.registrations, row.attended, row.waitlisted, row.cancelled, row.capacity_util], [2, 1, 1, 1, 0.5]);
    }
    assert.equal(result.body.events.find((r: any) => r.id === empty.body.event.id).conversion, null);
    assert.equal(result.body.events.find((r: any) => r.id === zero.body.event.id).conversion, 0);
  } finally { Date.now = originalNow; f.db.close(); }
});
