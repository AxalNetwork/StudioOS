/**
 * D1384 (#3692): the Compliance layer of /calendar. D1208's `compliance_due`
 * reader, wired into the registry, on the baseline plus every post-cutoff
 * migration: the founder's own ventures in the active company, done
 * deadlines on the page read only, the item read, the staff scope, and no
 * feed or file ever holding one. Every value is invented.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import {
  FEED_KINDS, KNOWN_KINDS, PAGE_ONLY_KINDS, fetchCalendarScope, fetchUserEvents, fetchUserEventsWithSources,
} from '../src/services/calendar.ts';
import { describeItems } from '../src/services/calendar/items.ts';
import { readItem } from '../src/services/calendar/itemRead.ts';
import { complianceState } from '../src/services/calendar/sourceReaders.ts';
import calendar from '../src/routes/calendar.ts';

const root = mkdtempSync(join(tmpdir(), 'calendar-d1384-'));
const seed = join(root, 'seed.sqlite');
const initial = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
initial.exec(readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8'));
const dir = 'cloudflare-worker/sql/migrations';
for (const n of readdirSync(dir).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()) initial.exec(readFileSync(`${dir}/${n}`, 'utf8'));
initial.prepare('VACUUM INTO ?').run(seed); initial.close();
after(() => rmSync(root, { recursive: true, force: true }));

const SECRET = 'synthetic-calendar-d1384-'.repeat(3);
const FROM = '2026-11-01T00:00:00.000Z', TO = '2026-12-01T00:00:00.000Z';
let serial = 0;
function fixture() {
  const path = join(root, `${++serial}.sqlite`); copyFileSync(seed, path);
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES
    (1,'founder','Fixture founder','one@example.test',101,1),(2,'founder','Other founder','two@example.test',102,1),
    (5,'admin','Fixture admin','five@example.test',NULL,1),(6,'partner','Fixture partner','six@example.test',NULL,1);
   INSERT INTO projects(id,name,founder_id,company_id) VALUES(10,'Fixture venture',101,NULL),(11,'Second company venture',101,77),(20,'Other venture',102,NULL);
   INSERT INTO compliance_events(id,uid,project_id,jurisdiction,event_type,title,description,due_date,recurrence,source,owner_name,completion_status) VALUES
    (1,'filing-open',10,'US-DE','annual_report','Fixture annual report','File with the state.','2026-11-10','annual','auto',NULL,'pending'),
    (2,'filing-done',10,'US-DE','franchise_tax','Fixture franchise tax',NULL,'2026-11-12','one_time','manual','Fixture owner','completed'),
    (3,'filing-company',11,'US-DE','annual_report','Second company filing',NULL,'2026-11-14','annual','manual',NULL,'pending'),
    (4,'filing-foreign',20,'US-DE','annual_report','Other founder filing',NULL,'2026-11-15','annual','manual',NULL,'pending'),
    (5,'filing-far',10,'US-DE','board_meeting','Fixture board meeting',NULL,'2028-06-30','annual','manual',NULL,'pending');`);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'production', APP_URL: 'https://axal.vc' };
  return { db, env };
}
const page = (env: any, user: number, companyId?: number | null, kinds = ['compliance_due']) =>
  fetchUserEventsWithSources(env, user, 'founder', FROM, TO, kinds, { withCancelled: true, ...(companyId !== undefined ? { companyId } : {}) });

test('the registry reads compliance as one more source, and no feed or file kind includes it', () => {
  assert.ok(KNOWN_KINDS.includes('compliance_due'), 'compliance_due is registered in READERS');
  // D1484 (#3977): D1208's three readers and the manual reader joined it, all page only; #3959: so is Learning;
  // D1486 §b (#3981): so are Publish's sends and Grow's planned content; §a (#3980): the bot's calls; §c (#3982): round close and NDA expiry.
  assert.deepEqual([...PAGE_ONLY_KINDS], ['compliance_due', 'interview_call', 'cohort_date', 'deal_closing', 'manual', 'learning', 'publish_send', 'content_planned', 'bot_call', 'round_close', 'nda_expiry']);
  assert.ok(!FEED_KINDS.includes('compliance_due'));
  assert.deepEqual([...FEED_KINDS, ...PAGE_ONLY_KINDS].sort(), [...KNOWN_KINDS].sort());
});

test('the page read: the founder\'s own deadlines, open and done, each with its state and facts; nobody else\'s', async () => {
  const { db, env } = fixture();
  try {
    const { events, sources } = await page(env, 1);
    assert.deepEqual(sources, [{ kind: 'compliance_due', ok: true, error: null }]);
    assert.deepEqual(events.map((e) => e.source_uid), ['filing-open', 'filing-done', 'filing-company']);
    const open = events[0] as any, done = events[1] as any;
    assert.deepEqual([open.id, open.kind, open.start_at, open.end_at, open.project_id, open.notes], ['compliance_due:filing-open', 'compliance_due', '2026-11-10', '2026-11-11', 10, 'File with the state.']);
    assert.deepEqual(open.compliance, {
      state: complianceState('pending', '2026-11-10', new Date().toISOString().slice(0, 10)), due_date: '2026-11-10',
      event_type: 'annual_report', jurisdiction: 'US-DE', recurrence: 'annual', owner: null, source: 'auto',
    });
    assert.equal(done.status, 'completed');
    assert.equal(done.compliance.state, 'done');
    assert.equal(done.compliance.owner, 'Fixture owner');
    assert.ok(!events.some((e) => e.source_uid === 'filing-foreign'), 'another founder\'s venture never shows');
    assert.deepEqual((await page(env, 2)).events.map((e) => e.source_uid), ['filing-foreign']);
  } finally { db.close(); }
});

test('the state: done wins over the date; a passed day is overdue; today is due', () => {
  assert.equal(complianceState('completed', '2020-01-01', '2026-11-10'), 'done');
  assert.equal(complianceState('pending', '2026-11-09', '2026-11-10'), 'overdue');
  assert.equal(complianceState('pending', '2026-11-10', '2026-11-10'), 'due');
  assert.equal(complianceState('snoozed', '2026-11-11', '2026-11-10'), 'due');
});

test('the active company narrows it as GET /compliance/events does; no role widens a personal read', async () => {
  const { db, env } = fixture();
  try {
    // An unassigned venture shows under every company; a venture of company 77 only under 77.
    assert.deepEqual((await page(env, 1, 12)).events.map((e) => e.source_uid), ['filing-open', 'filing-done']);
    assert.deepEqual((await page(env, 1, 77)).events.map((e) => e.source_uid), ['filing-open', 'filing-done', 'filing-company']);
    assert.deepEqual((await page(env, 1, null)).events.map((e) => e.source_uid), ['filing-open', 'filing-done', 'filing-company']);
    // An admin's and a partner's own calendars hold no venture's deadlines: the staff scope does (below).
    assert.deepEqual((await page(env, 5)).events, []);
    assert.deepEqual((await page(env, 6)).events, []);
  } finally { db.close(); }
});

test('a feed, an .ics file and a provider copy never carry a deadline, even when one is asked for by name', async () => {
  const { db, env } = fixture();
  try {
    assert.deepEqual(await fetchUserEvents(env, 1, 'founder', FROM, TO, ['compliance_due']), []);
    assert.ok(!(await fetchUserEvents(env, 1, 'founder', FROM, TO)).some((e) => e.kind === 'compliance_due'));
    // Without the page's ask, done deadlines are left out (D1208's own rule).
    const plain = await fetchUserEventsWithSources(env, 1, 'founder', FROM, TO, ['compliance_due']);
    assert.deepEqual(plain.events.map((e) => e.source_uid), ['filing-open', 'filing-company']);
  } finally { db.close(); }
});

test('the drawer\'s item: Deadlines family, all day, no meeting actions; found however far off; nobody else\'s, nor another company\'s', async () => {
  const { db, env } = fixture();
  try {
    const [item] = await describeItems(env, { id: 1, role: 'founder' }, (await page(env, 1)).events.slice(0, 1));
    assert.deepEqual([item.family, item.all_day, item.href, item.my_role.words, item.project_name],
      ['deadlines', true, null, 'Your venture’s deadline', 'Fixture venture']);
    assert.deepEqual(item.can, { rsvp: false, reschedule: false, cancel: false, copy: false });
    const far = await readItem(env, { id: 1, role: 'founder' }, 'compliance_due', '5');
    assert.equal(far.ok, true);
    assert.equal(far.ok && far.item.title, 'Fixture board meeting');
    assert.equal(far.ok && (far.item as any).compliance.event_type, 'board_meeting');
    const done = await readItem(env, { id: 1, role: 'founder' }, 'compliance_due', '2');
    assert.equal(done.ok && (done.item as any).compliance.state, 'done', 'a done deadline still opens');
    const foreign = await readItem(env, { id: 1, role: 'founder' }, 'compliance_due', '4');
    assert.deepEqual(foreign.ok ? null : [foreign.status, foreign.error], [404, 'not_party']);
    const otherCompany = await readItem(env, { id: 1, role: 'founder' }, 'compliance_due', '3', 12);
    assert.deepEqual(otherCompany.ok ? null : [otherCompany.status, otherCompany.error], [404, 'not_party']);
    const missing = await readItem(env, { id: 1, role: 'founder' }, 'compliance_due', '999');
    assert.deepEqual(missing.ok ? null : missing.status, 404);
  } finally { db.close(); }
});

test('an admin\'s staff scope keeps what /compliance showed them, read-only, for the scope\'s ventures', async () => {
  const { db, env } = fixture();
  try {
    env.BRANCH_CODE = 'fr'; env.APP_URL = 'https://fr.axal.vc';
    db.exec("INSERT INTO branch_licence (id,licence_uid,brand_name,status,pushed_at) VALUES (1,'fixture-studio','Fixture studio','active',datetime('now'))");
    const body = await fetchCalendarScope(env, { id: 5, role: 'admin' } as any, 'studio', FROM, TO, ['compliance_due']);
    assert.deepEqual(body.sources, [{ kind: 'compliance_due', ok: true, error: null }]);
    const rows = body.events.map((e: any) => [e.source_id, e.start_at, e.status, e.compliance?.state, e.read_only]);
    assert.deepEqual(rows.map((r) => r[0]).sort(), [1, 2, 3, 4]);
    assert.ok(rows.every((r) => r[4] === true), 'every row is read-only');
    assert.deepEqual(rows.find((r) => r[0] === 2)!.slice(1, 4), ['2026-11-12', 'completed', 'done']);
    assert.ok(body.events.every((e: any) => e.can.cancel === false && e.all_day === true));
  } finally { db.close(); }
});

test('the routes: /events passes the active company; the .ics file refuses a deadline kind by name', async () => {
  const { db, env } = fixture();
  try {
    const token = await new SignJWT({ user_id: 1 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const get = (path: string, company?: string) => calendar.request(path, { headers: {
      Cookie: `studioos_auth=${token}`, Origin: 'https://axal.vc', ...(company ? { 'X-Company-Id': company } : {}),
    } }, env, { waitUntil() {}, passThroughOnException() {} } as any);
    const ics = await get(`/events.ics?from=${FROM}&to=${TO}&kinds=compliance_due`);
    assert.equal(ics.status, 400);
    const r = await get(`/events?from=${FROM}&to=${TO}&kinds=compliance_due`);
    assert.equal(r.status, 200);
    const body: any = await r.json();
    assert.deepEqual(body.items.map((i: any) => [i.source_id, i.family, i.compliance.state === 'done']), [[1, 'deadlines', false], [2, 'deadlines', true], [3, 'deadlines', false]]);
    // Company 12, verified against the founder's own link: company 77's venture leaves the list and its item.
    db.exec("INSERT INTO user_company_links (uid, user_id, company_id) VALUES ('link-fixture', 1, 12)");
    const scoped: any = await (await get(`/events?from=${FROM}&to=${TO}&kinds=compliance_due`, '12')).json();
    assert.deepEqual(scoped.items.map((i: any) => i.source_id), [1, 2]);
    assert.equal((await get('/item/compliance_due/3', '12')).status, 404);
    assert.equal((await get('/item/compliance_due/3')).status, 200);
  } finally { db.close(); }
});

test('nothing about a deadline is logged: the source logs its kind and outcome only', () => {
  const src = readFileSync('cloudflare-worker/src/services/calendar/sourceReaders.ts', 'utf8');
  const fn = src.slice(src.indexOf('export async function complianceDueEvents'), src.indexOf('/** Only the investor'));
  assert.ok(fn.length > 200, 'the reader did not parse');
  assert.doesNotMatch(fn, /console\./);
});
