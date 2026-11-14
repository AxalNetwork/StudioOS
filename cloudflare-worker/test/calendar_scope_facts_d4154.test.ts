/**
 * D4154 C1 (#4196): each staff-scope item's owner, company, studio, where it
 * lives and its link into its company. node:sqlite world on the real baseline
 * and the additive migrations, set up as calendar_d1206.test.ts is. All rows
 * synthetic; no provider is reached.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import calendar from '../src/routes/calendar.ts';
import * as service from '../src/services/calendar.ts';

const SECRET = 'synthetic-calendar-d4154-'.repeat(3);
const FROM = new Date(Date.now() - 86400000).toISOString();
const START = new Date(Date.now() + 86400000).toISOString();
const END = new Date(Date.now() + 90000000).toISOString();
const TO = new Date(Date.now() + 30 * 86400000).toISOString();
const DUE = START.slice(0, 10);
const window = `from=${FROM}&to=${TO}`;
/** An address anywhere in a reply, not merely a bare '@'. */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const NONE = { rsvp: false, reschedule: false, cancel: false, copy: false };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
  for (const name of ['235_calendar_events_kind.sql', '277_user_recovery_state.sql', '603_calendar_feed_tokens.sql', '256_branch_local_copies.sql', '258_licence_deployments.sql', '463_raise_record_stores.sql', '607_raise_money_cents.sql', '610_calendar_feed_scope_sync_errors.sql',
    '443_grow_stores.sql', '388_learning_core.sql', '389_learning_programs.sql', '390_learning_exercises_exams.sql', '391_learning_webinars.sql', '758_learning_plan.sql']) {
    db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  }
  for (const [id, role, name] of [[1, 'admin', 'Fixture admin'], [2, 'founder', 'Ada Founder'], [3, 'founder', 'booker@example.test'], [4, 'founder', 'Bo Second']] as const) {
    db.prepare('INSERT INTO users (id,uid,email,name,role,founder_id) VALUES (?,?,?,?,?,?)').run(id, `user-${id}`, `fixture-${id}@example.test`, name, role, role === 'founder' ? 100 + id : null);
  }
  db.exec(`INSERT INTO company_profiles (id,uid,company_name) VALUES (1,'northwind','Northwind Labs');
    INSERT INTO projects (id,name,founder_id,company_id) VALUES (20,'Fixture venture',102,1),(40,'Loose venture',104,NULL);
    INSERT INTO deals (id,project_id) VALUES (200,20);`);
  let broken = ''; const statements: string[] = [];
  const DB = { prepare(sql: string) {
    statements.push(sql);
    if (broken && sql.includes(broken)) throw new Error('synthetic lookup failure must not escape');
    let args: any[] = []; const stmt: any = {
      bind(...values: any[]) { args = values.map(v => v ?? null); return stmt; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    }; return stmt;
  }, async exec(sql: string) { db.exec(sql); } };
  const pending: Promise<unknown>[] = [];
  const ctx: any = { waitUntil(p: Promise<unknown>) { pending.push(p); }, passThroughOnException() {} };
  const env: any = { DB, JWT_SECRET: SECRET, SCORING_HMAC_SECRET: 'synthetic-scoring-d4154-'.repeat(3), ENVIRONMENT: 'production', APP_URL: 'https://axal.vc' };
  async function request(path: string, id = 1) {
    const token = await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    return calendar.request(path, { headers: { Cookie: `${env.BRANCH_CODE ? 'studioos_auth_' + env.BRANCH_CODE : 'studioos_auth'}=${token}`, Origin: 'https://axal.vc' } }, env, ctx);
  }
  return { db, env, request, statements() { return statements; }, breakSource(s: string) { broken = s; }, async close() { await Promise.allSettled(pending); db.close(); } };
}

function licensed(f: ReturnType<typeof fixture>) {
  f.env.BRANCH_CODE = 'fr'; f.env.APP_URL = 'https://fr.axal.vc';
  f.db.exec("INSERT INTO branch_licence (id,licence_uid,brand_name,status,pushed_at) VALUES (1,'fixture-studio','Fixture studio','active',datetime('now'))");
}
function hq(f: ReturnType<typeof fixture>) {
  delete f.env.BRANCH_CODE; f.env.APP_URL = 'https://axal.vc';
  f.db.exec('INSERT INTO super_admins (user_id,granted_by_user_id) VALUES (1,1)');
}
/** One item of every scoped kind, each with something to say about where it lives. */
function items(f: ReturnType<typeof fixture>) {
  const { db } = f;
  db.prepare('INSERT INTO ic_meetings (id,uid,title,start_at,organizer_user_id,deal_id) VALUES (?,?,?,?,?,?)').run(1, 'ic-1', 'Fixture IC', START, 2, 200);
  db.exec('INSERT INTO ic_meeting_attendees (meeting_id,user_id) VALUES (1,2),(1,3)');
  db.prepare('INSERT INTO founder_checkins (id,uid,founder_user_id,title,start_at,project_id) VALUES (?,?,?,?,?,?)').run(11, 'check-11', 2, 'Fixture check-in', START, 20);
  db.prepare('INSERT INTO founder_checkins (id,uid,founder_user_id,title,start_at,project_id) VALUES (?,?,?,?,?,?)').run(12, 'check-12', 4, 'Loose check-in', START, 40);
  db.prepare('INSERT INTO compliance_events (id,uid,project_id,jurisdiction,event_type,title,due_date,owner_user_id) VALUES (?,?,?,?,?,?,?,?)').run(5, 'comp-5', 20, 'DE', 'annual_report', 'Fixture annual report', DUE, 2);
  db.prepare("INSERT INTO compliance_events (id,uid,project_id,jurisdiction,event_type,title,due_date,owner_name) VALUES (?,?,?,?,?,?,?,?)").run(6, 'comp-6', 20, 'DE', 'franchise_tax', 'Fixture franchise tax', DUE, 'Outside Counsel');
  db.prepare('INSERT INTO events (id,slug,host_user_id,title,starts_at,ends_at,status,visibility,project_id) VALUES (?,?,?,?,?,?,?,?,?)').run(30, 'fixture-demo-day', 2, 'Fixture demo day', START, END, 'published', 'unlisted', 20);
  db.prepare('INSERT INTO events (id,slug,host_user_id,title,starts_at,ends_at,status,visibility,project_id) VALUES (?,?,?,?,?,?,?,?,?)').run(31, 'fixture-draft', 2, 'Fixture draft', START, END, 'draft', 'unlisted', 20);
  db.exec("INSERT INTO advisors (id,uid,user_id,display_name) VALUES (30,'a30',NULL,'Fixture advisor')");
  db.prepare('INSERT INTO advisor_office_hour_slots (id,uid,advisor_id,starts_at,ends_at) VALUES (?,?,?,?,?)').run(30, 'as-30', 30, START, END);
  db.prepare('INSERT INTO advisor_bookings (id,uid,slot_id,advisor_id,founder_user_id,topic) VALUES (?,?,?,?,?,?)').run(30, 'ab-30', 30, 30, 2, 'Fixture topic');
  db.prepare('INSERT INTO advisor_bookings (id,uid,slot_id,advisor_id,founder_user_id,topic) VALUES (?,?,?,?,?,?)').run(31, 'ab-31', 30, 30, 3, 'Address-named booker');
  db.prepare('INSERT INTO raise_prospects (id,uid,project_id,name,firm,stage) VALUES (?,?,?,?,?,?)').run(30, 'prospect-30', 20, 'Fixture prospect', 'Fixture firm', 'meeting');
  db.prepare('INSERT INTO raise_prospect_events (id,prospect_id,kind,starts_at,calendar_item_uid,created_by) VALUES (?,?,?,?,?,?)').run(30, 30, 'meeting', START, 'meeting-30', 2);
}
const byId = (body: any) => new Map<string, any>(body.items.map((item: any) => [item.id, item]));
const ADA = { uid: 'user-2', name: 'Ada Founder' };
const NORTHWIND = { uid: 'northwind', name: 'Northwind Labs' };

test('D4154 C1: Studio items carry owner, company, where and open_href by name, never an email, with can all false', async () => {
  const f = fixture();
  try {
    licensed(f); items(f);
    const res = await f.request(`/events?${window}&scope=studio`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    const text = JSON.stringify(body);
    assert.equal(EMAIL.test(text), false, `no email anywhere in the scoped reply: ${text.match(EMAIL)?.[0]}`);
    const got = byId(body);
    for (const item of body.items) {
      assert.deepEqual(item.can, NONE); assert.equal(item.read_only, true); assert.equal(item.href, null);
      assert.equal('studio' in item, false, 'studio is scope=all only');
      for (const key of ['owner', 'company', 'where', 'open_href']) assert.ok(key in item, `${item.id} carries ${key}`);
    }
    const ic = got.get('ic_meeting:1');
    assert.deepEqual(ic.owner, ADA); assert.deepEqual(ic.company, NORTHWIND, 'an IC meeting reaches its company through its deal');
    assert.equal(ic.where, 'Northwind Labs › Deals › Investment committee'); assert.equal(ic.open_href, '/deals/200');
    const check = got.get('founder_checkin:11');
    assert.deepEqual(check.owner, ADA); assert.deepEqual(check.company, NORTHWIND);
    assert.equal(check.where, 'Northwind Labs › Ventures › Check-ins'); assert.equal(check.open_href, '/projects/20');
    const loose = got.get('founder_checkin:12');
    assert.deepEqual(loose.owner, { uid: 'user-4', name: 'Bo Second' });
    assert.equal(loose.company, null, 'a venture in no company has none'); assert.equal(loose.where, null);
    assert.equal(loose.project_name, 'Loose venture'); assert.equal(loose.open_href, '/projects/40');
    const due = got.get('compliance_due:5');
    assert.deepEqual(due.owner, ADA); assert.equal(due.where, 'Northwind Labs › Build › Compliance');
    assert.equal(due.open_href, '/account/companies/northwind/settings/compliance');
    assert.deepEqual(got.get('compliance_due:6').owner, { uid: null, name: 'Outside Counsel' }, 'a written owner is a name with no account');
    const published = got.get('event_hosted:30');
    assert.deepEqual(published.owner, ADA); assert.equal(published.open_href, '/events/fixture-demo-day');
    assert.equal(published.where, 'Northwind Labs › My events › Hosting');
    assert.equal(got.get('event_hosted:31').open_href, null, 'a draft has no page to open');
    const booking = got.get('advisor_booking:30');
    assert.deepEqual(booking.owner, ADA, 'a booking belongs to the member who booked it');
    assert.equal(booking.company, null); assert.equal(booking.where, null); assert.equal(booking.open_href, null);
    const addressed = got.get('advisor_booking:31');
    assert.equal(addressed.owner, null, 'a name that is an address is not shown');
    assert.ok(addressed.attendees.every((p: any) => p.name !== 'booker@example.test'));
    const investor = got.get('investor_meeting:30');
    assert.deepEqual(investor.owner, ADA); assert.deepEqual(investor.company, NORTHWIND);
    assert.equal(investor.where, 'Northwind Labs › Raise › Capital relationships');
    assert.equal(investor.open_href, null, 'Capital relationships is a personal page, not the item’s');
    assert.equal(f.statements().some(sql => /\bo\.email\b|\bu\.email\b|cp\.contact_email/.test(sql)), false, 'no scoped statement selects an email');
  } finally { await f.close(); }
});

test('D4154 C1: Platform (scope=all) sets studio on every row, HQ-held for HQ rows', async () => {
  const f = fixture();
  try {
    hq(f); items(f);
    f.db.exec("INSERT INTO territory_licences (id,uid,licence_ref,legal_entity_name,brand_name,status) VALUES (1,'remote','fixture-1','Fixture entity','Remote studio','active')");
    const res = await f.request(`/events?${window}&scope=all`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(body.items.length >= 10, JSON.stringify(body.sources));
    for (const item of body.items) {
      assert.deepEqual(item.studio, { code: 'hq', name: 'HQ-held' }, item.id);
      assert.deepEqual(item.can, NONE);
    }
    assert.equal(EMAIL.test(JSON.stringify(body)), false);
    assert.deepEqual(byId(body).get('ic_meeting:1').owner, ADA);
    assert.equal(body.coverage.complete, false, 'remote studios are still Not read here yet');
  } finally { await f.close(); }
});

test('D4154 C1: a branch admin cannot read scope=all, even holding an elevation row', async () => {
  const f = fixture();
  try {
    licensed(f); items(f);
    f.db.exec('INSERT INTO super_admins (user_id,granted_by_user_id) VALUES (1,1)');
    const res = await f.request(`/events?${window}&scope=all`);
    assert.equal(res.status, 403);
    assert.equal(EMAIL.test(await res.text()), false);
    await assert.rejects(() => service.fetchCalendarScope(f.env, { id: 1, role: 'admin', is_super_admin: 1 } as any, 'all', FROM, TO), { message: 'Forbidden' });
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='calendar_scope_read'").get()?.n, 0);
  } finally { await f.close(); }
});

test('D4154 C1: a failed company lookup leaves company and where null and the scope still answers', async () => {
  const f = fixture();
  const said: unknown[][] = []; const warn = console.warn;
  console.warn = (...args) => { said.push(args); };
  try {
    licensed(f); items(f);
    f.breakSource('JOIN company_profiles cp');
    const res = await f.request(`/events?${window}&scope=studio`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.coverage.complete, true, 'a lookup is not a source');
    assert.ok(body.items.length >= 10);
    for (const item of body.items) { assert.equal(item.company, null, item.id); assert.equal(item.where, null, item.id); }
    const got = byId(body);
    assert.deepEqual(got.get('founder_checkin:11').owner, ADA, 'owners do not depend on the company lookup');
    assert.equal(got.get('compliance_due:5').open_href, '/projects/20', 'with no company the deadline opens its venture');
    assert.equal(got.get('ic_meeting:1').open_href, '/deals/200');
    assert.equal(JSON.stringify(said).includes('synthetic lookup failure'), false, 'no database text in a log');
    assert.ok(said.some(args => args.includes('[calendar] scope companies unreadable')));
  } finally { console.warn = warn; await f.close(); }
});

test('D4154 C1: companies are one batched lookup however many items the scope returns', async () => {
  const f = fixture();
  try {
    licensed(f); items(f);
    for (let n = 0; n < 60; n++) f.db.prepare('INSERT INTO founder_checkins (uid,founder_user_id,title,start_at,project_id) VALUES (?,?,?,?,?)').run(`bulk-${n}`, 2, `Bulk ${n}`, START, n % 2 ? 20 : 40);
    const before = f.statements().length;
    const body = await service.fetchCalendarScope(f.env, { id: 1, role: 'admin' } as any, 'studio', FROM, TO);
    assert.ok(body.events.length >= 70);
    const lookups = f.statements().slice(before).filter(sql => sql.includes('company_profiles'));
    assert.equal(lookups.length, 1, 'no lookup per item');
    assert.ok(body.events.filter(e => e.title.startsWith('Bulk')).every(e => (e.project_id === 20) === (e.company?.name === 'Northwind Labs')));
  } finally { await f.close(); }
});
