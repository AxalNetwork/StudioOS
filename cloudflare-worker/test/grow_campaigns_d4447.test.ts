/** D4447 (#4447) — campaign plans on real SQLite and the mounted Grow routes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleGrow from '../src/routes/cycle_grow.ts';
import { updateCampaign } from '../src/services/growCampaigns.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const BASELINE = readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = 1; const COFOUNDER = 2; const ADVISOR = 3; const PARTNER = 4; const ADMIN = 5; const OTHER = 6;
const PA = 7; const PB = 8;

const newer = readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n)).filter((n) => migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations);

/** The baseline plus every post-cutoff migration, restored between tests. */
let pristine: DatabaseSync | undefined;
// Build every migration once; a savepoint restores the exact pristine database before each sequential test.
function build(): DatabaseSync {
  if (pristine) { pristine.exec('ROLLBACK TO campaign_fixture'); return pristine; }
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(BASELINE);
  for (const name of newer) {
    db.exec(readFileSync(resolve(M, name), 'utf8'));
  }
  db.exec('SAVEPOINT campaign_fixture');
  pristine = db;
  return db;
}

function seed(db: DatabaseSync) {
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Founder A', 'fa@example.test'), (20, 'Founder B', 'fb@example.test');`);
  const u = db.prepare('INSERT INTO users (id, email, name, role, founder_id) VALUES (?, ?, ?, ?, ?)');
  u.run(FOUNDER, 'founder@example.test', 'Fay Founder', 'founder', 10);
  u.run(COFOUNDER, 'cofounder@example.test', 'Cal Cofounder', 'founder', null);
  u.run(ADVISOR, 'advisor@example.test', 'Ada Advisor', 'founder', null);
  u.run(PARTNER, 'partner@example.test', 'Pat Partner', 'partner', null);
  u.run(ADMIN, 'admin@example.test', 'Ari Admin', 'admin', null);
  u.run(OTHER, 'other@example.test', 'Oli Other', 'founder', 20);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${PA}, 'Kestrel Labs', 10), (${PB}, 'Heron Works', 20);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (${PA}, ${COFOUNDER}, 'cofounder', 'accepted'), (${PA}, ${ADVISOR}, 'advisor', 'accepted');
    INSERT INTO roadmap_okrs (id, project_id, objective) VALUES (1, ${PA}, 'CSV export'), (2, ${PB}, 'Heron item');
    INSERT OR IGNORE INTO research_countries (code, name, region) VALUES ('ES', 'Spain', 'Europe');`);
}

function fixture() {
  const db = build();
  seed(db);
  return { db, env: { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any };
}

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [COFOUNDER]: 'founder', [ADVISOR]: 'founder', [PARTNER]: 'partner', [ADMIN]: 'admin', [OTHER]: 'founder' };

async function call(f: { env: any }, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), f.env, { waitUntil() {}, passThroughOnException() {} } as any);
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) as any }; } catch { throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`); }
}
const grow = (f: any, who: number, method: string, path: string, body: Record<string, unknown> = {}) =>
  call(f, who, method, `/api/cycles/grow${path}`, { project: PA, ...body });
const list = (f: any, slug: string, qs = '', who = FOUNDER) => call(f, who, 'GET', `/api/cycles/grow/modules/${slug}?project=${PA}${qs}`);
const plain = (r: any) => (r == null ? r : { ...r });
const one = (f: any, sql: string, ...args: any[]) => plain(f.db.prepare(sql).get(...args)) as any;
const all = (f: any, sql: string, ...args: any[]) => (f.db.prepare(sql).all(...args) as any[]).map(plain);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const create = (f: any, b = {}, who = FOUNDER) => grow(f, who, 'POST', '/campaigns', { name: 'Spring launch', goal: 'signups', ...b });
const read = (f: any, who = FOUNDER, pid = PA) => call(f, who, 'GET', `/api/cycles/grow/campaigns?project=${pid}`);
function links(f: any) {
  f.db.exec(`INSERT INTO growth_channels(id,uid,project_id,name,utm_source) VALUES (1,'our-channel',7,'Search','search'),(2,'other-channel',8,'Other','other'),(3,'second-channel',7,'Social','social');
    INSERT INTO customer_segments(id,project_id,name,name_norm) VALUES (1,7,'Teams','teams'),(2,8,'Other teams','other teams');
    INSERT INTO content_calendar_items(id,uid,project_id,title) VALUES (1,'our-content',7,'A plan'),(2,'other-content',8,'Other plan');
    INSERT INTO publish_drafts(id,uid,project_id,module,author_user_id) VALUES (1,'our-draft',7,'distribution',1),(2,'other-draft',8,'distribution',6);`);
}
test('create, read, update and archive preserve null budget, actor and links; archive refuses every write', async () => {
  const f = fixture(); links(f);
  const r = await create(f, { channel_uids: ['our-channel'], segment_id: 1 });
  assert.equal(r.status, 201); const uid = r.body.campaign.uid;
  assert.match(uid, /^[a-f0-9]{32}$/);
  assert.deepEqual({ ...r.body.campaign, uid }, { uid, name: 'Spring launch', goal: 'signups', status: 'draft', starts_on: null, ends_on: null, budget_cents: null, budget_reason: 'Not recorded: no campaign budget entered', utm_campaign: null, segment: { id: 1, name: 'Teams' }, channels: [{ uid: 'our-channel', name: 'Search', planned_budget_cents: null, planned_budget_reason: 'Not recorded: no channel budget entered', spend_cents: null, spend_reason: 'Not recorded: this campaign has no complete date window' }], items: { content: 0, drafts: 0 }, leads: null, leads_reason: 'Not recorded: this campaign has no UTM campaign tag' });
  assert.equal((await read(f)).body.campaigns[0].uid, uid);
  const updated = await grow(f, COFOUNDER, 'PATCH', `/campaigns/${uid}`, { name: 'Revised', budget_cents: 0 });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.campaign.budget_cents, 0);
  assert.equal(updated.body.campaign.budget_reason, null);
  assert.equal(one(f, 'SELECT updated_by FROM grow_campaigns WHERE uid = ?', uid).updated_by, COFOUNDER);
  for (const [kind, item] of [['content_item', 'our-content'], ['publish_draft', 'our-draft']]) assert.equal((await grow(f, FOUNDER, 'POST', `/campaigns/${uid}/items`, { kind, uid: item })).status, 200);
  const archive = await grow(f, FOUNDER, 'DELETE', `/campaigns/${uid}`);
  assert.deepEqual(archive, { status: 200, body: { ok: true } });
  assert.deepEqual((await read(f)).body, { campaigns: [] });
  assert.equal(one(f, 'SELECT COUNT(*) n FROM grow_campaign_items').n, 2);
  assert.equal(one(f, 'SELECT COUNT(*) n FROM grow_campaign_channels').n, 1);
  for (const [method, path, b] of [
    ['PATCH', '', { name: 'No' }], ['DELETE', '', {}], ['PUT', '/channels/our-channel', { planned_budget_cents: 1 }], ['DELETE', '/channels/our-channel', {}], ['POST', '/items', { kind: 'content_item', uid: 'our-content' }], ['DELETE', '/items/content_item/our-content', {}],
  ] as const) assert.equal((await grow(f, FOUNDER, method, `/campaigns/${uid}${path}`, b)).status, 409);
  assert.ok(one(f, 'SELECT archived_at FROM grow_campaigns WHERE uid = ?', uid).archived_at);
  assert.equal(one(f, "SELECT COUNT(*) n FROM activity_logs WHERE entity_type = 'grow.distribution' AND entity_id = ?", uid).n, 5);
});
test('UTM normalization, project uniqueness including archived rows, and no partial write on conflicts', async () => {
  const f = fixture(); links(f);
  const a = await create(f, { utm_campaign: '  LAUNCH  ' });
  assert.equal(a.body.campaign.utm_campaign, 'launch');
  const duplicate = await create(f, { utm_campaign: 'Launch', channel_uids: ['our-channel'] });
  assert.equal(duplicate.status, 409); assert.equal(duplicate.body.field, 'utm_campaign');
  const other = await grow(f, OTHER, 'POST', '/campaigns', { project: PB, name: 'Other', goal: 'sales', utm_campaign: 'launch' });
  assert.equal(other.status, 201);
  const b = await create(f, { utm_campaign: 'second', channel_uids: ['our-channel'] });
  const conflict = await grow(f, FOUNDER, 'PATCH', `/campaigns/${b.body.campaign.uid}`, { utm_campaign: 'launch', channel_uids: ['second-channel'] });
  assert.equal(conflict.status, 409);
  assert.equal((await read(f)).body.campaigns.find((c: any) => c.uid === b.body.campaign.uid).channels[0].uid, 'our-channel');
  await grow(f, FOUNDER, 'DELETE', `/campaigns/${a.body.campaign.uid}`);
  assert.equal((await create(f, { utm_campaign: 'launch' })).status, 409);
  assert.equal(one(f, 'SELECT COUNT(*) n FROM grow_campaigns').n, 3);
});
test('field validation, combined dates on patches, and the campaign status state machine', async () => {
  const f = fixture();
  for (const [field, value] of [['name',' '],['name','x'.repeat(121)],['goal','invalid'],['budget_cents',-1],['budget_cents','0'],['budget_cents',1.2],['utm_campaign',' '],['utm_campaign','x'.repeat(81)],['starts_on','2026-02-30'],['ends_on',false],['channel_uids',null],['status','active']] as const) {
    const r = await create(f, { [field]: value }); assert.equal(r.status, 400, field); assert.equal(r.body.field, field);
  }
  const bad = await create(f, { starts_on: '2026-03-02', ends_on: '2026-03-01' });
  assert.equal(bad.status, 400); assert.equal(bad.body.field, 'ends_on');
  const a = await create(f, { starts_on: '2026-03-01', ends_on: '2026-03-31' }); const uid = a.body.campaign.uid;
  assert.equal((await grow(f, FOUNDER, 'PATCH', `/campaigns/${uid}`, { starts_on: '2026-04-01' })).status, 400);
  assert.equal((await grow(f, FOUNDER, 'PATCH', `/campaigns/${uid}`, { status: 'ended' })).status, 409);
  assert.equal((await grow(f, FOUNDER, 'PATCH', `/campaigns/${uid}`, { status: 'bogus' })).status, 400);
  for (const status of ['active','paused','active','ended']) {
    const r = await grow(f, FOUNDER, 'PATCH', `/campaigns/${uid}`, { status }); assert.equal(r.status, 200); assert.equal(r.body.campaign.status, status);
    if (status === 'paused') assert.equal((await grow(f, FOUNDER, 'PATCH', `/campaigns/${uid}`, { status: 'ended' })).status, 409);
  }
  assert.equal((await grow(f, FOUNDER, 'PATCH', `/campaigns/${uid}`, { status: 'active' })).status, 409);
});
test('same-venture segment, channel, item and campaign ownership; advisor reads but cannot write', async () => {
  const f = fixture(); links(f); const uid = (await create(f)).body.campaign.uid;
  for (const b of [{ segment_id: 2 }, { channel_uids: ['other-channel'] }, { channel_uids: ['missing'] }]) {
    assert.equal((await create(f, b)).status, 404);
    assert.equal((await grow(f, FOUNDER, 'PATCH', `/campaigns/${uid}`, b)).status, 404);
  }
  assert.equal((await grow(f, FOUNDER, 'PUT', `/campaigns/${uid}/channels/other-channel`, { planned_budget_cents: 0 })).status, 404);
  for (const [kind, item] of [['content_item','other-content'],['publish_draft','other-draft']]) {
    assert.equal((await grow(f, FOUNDER, 'POST', `/campaigns/${uid}/items`, { kind, uid: item })).status, 404);
    assert.equal((await grow(f, FOUNDER, 'DELETE', `/campaigns/${uid}/items/${kind}/${item}`)).status, 404);
  }
  assert.equal((await grow(f, FOUNDER, 'POST', `/campaigns/${uid}/items`, { kind: 'email', uid: 'our-content' })).status, 400);
  assert.equal((await grow(f, FOUNDER, 'DELETE', `/campaigns/${uid}/items/email/our-content`)).status, 404);
  assert.equal((await grow(f, OTHER, 'PATCH', `/campaigns/${uid}`, { project: PB, name: 'Stolen' })).status, 404);
  assert.equal((await read(f, OTHER)).status, 403);
  assert.equal((await read(f, FOUNDER, 999)).status, 404);
  assert.equal((await read(f, ADVISOR)).body.campaigns[0].uid, uid);
  assert.equal((await create(f, {}, ADVISOR)).status, 403);
  for (const [method, path, b] of [['PATCH','',{name:'Denied'}],['DELETE','',{}],['PUT','/channels/our-channel',{planned_budget_cents:0}],['DELETE','/channels/our-channel',{}],['POST','/items',{kind:'content_item',uid:'our-content'}],['DELETE','/items/content_item/our-content',{}]] as const) assert.equal((await grow(f, ADVISOR, method, `/campaigns/${uid}${path}`, b)).status, 403);
});
test('channel budgets, removals and item links are idempotent plans; replacement preserves retained budgets', async () => {
  const f = fixture(); links(f); const uid = (await create(f)).body.campaign.uid;
  assert.equal((await grow(f, FOUNDER, 'PUT', `/campaigns/${uid}/channels/our-channel`, {})).status, 400);
  let r = await grow(f, FOUNDER, 'PUT', `/campaigns/${uid}/channels/our-channel`, { planned_budget_cents: 0 });
  assert.equal(r.body.campaign.channels[0].planned_budget_cents, 0);
  r = await grow(f, FOUNDER, 'PATCH', `/campaigns/${uid}`, { channel_uids: ['our-channel','second-channel','our-channel'] });
  assert.equal(r.body.campaign.channels.length, 2); assert.equal(r.body.campaign.channels[0].planned_budget_cents, 0);
  r = await grow(f, FOUNDER, 'PUT', `/campaigns/${uid}/channels/our-channel`, { planned_budget_cents: null });
  assert.equal(r.body.campaign.channels[0].planned_budget_cents, null);
  for (const [kind, item] of [['content_item','our-content'],['publish_draft','our-draft']]) for (let i = 0; i < 2; i++) assert.equal((await grow(f, FOUNDER, 'POST', `/campaigns/${uid}/items`, { kind, uid: item })).status, 200);
  assert.deepEqual((await read(f)).body.campaigns[0].items, { content: 1, drafts: 1 });
  assert.equal((await grow(f, FOUNDER, 'DELETE', `/campaigns/${uid}/items/content_item/our-content`)).status, 200);
  assert.equal((await grow(f, FOUNDER, 'DELETE', `/campaigns/${uid}/items/content_item/our-content`)).status, 404);
  assert.equal((await grow(f, FOUNDER, 'DELETE', `/campaigns/${uid}/channels/our-channel`)).status, 200);
  assert.equal((await grow(f, FOUNDER, 'DELETE', `/campaigns/${uid}/channels/our-channel`)).status, 404);
  assert.equal(one(f, 'SELECT COUNT(*) n FROM publish_sends').n, 0);
});
test('spend sums recorded campaign months only; leads parse attribution within this venture; unreadable is never zero', async () => {
  const f = fixture(); links(f);
  const r = await create(f, { starts_on: '2026-03-15', ends_on: '2026-05-01', utm_campaign: 'launch', channel_uids: ['our-channel','second-channel'] }); const uid = r.body.campaign.uid;
  assert.equal(r.body.campaign.channels[0].spend_cents, null);
  assert.equal(r.body.campaign.channels[0].spend_reason, 'Not recorded: no spend entered for these months');
  assert.equal(r.body.campaign.leads, 0); assert.equal(r.body.campaign.leads_reason, null);
  f.db.exec(`INSERT INTO channel_spend(channel_id,month,spend_cents) VALUES (1,'2026-02',900),(1,'2026-03',0),(1,'2026-05',250),(1,'2026-06',900),(3,'2026-04',0);`);
  const insert = f.db.prepare("INSERT INTO contacts(uid,project_id,name,utm_json,audience,email) VALUES (?,?,?,?,'customer','synthetic@example.test')");
  for (const [id,pid,json] of [['a',PA,'{"utm_campaign":" LAUNCH "}'],['b',PA,'{"utm_campaign":"other"}'],['c',PB,'{"utm_campaign":"launch"}'],['d',PA,'bad json'],['e',PA,'{"utm_campaign":1}']]) insert.run(id,pid,'Synthetic contact',json);
  let c = (await read(f)).body.campaigns[0];
  assert.equal(c.uid, uid); assert.equal(c.channels[0].spend_cents, 250); assert.equal(c.channels[0].spend_reason, null); assert.equal(c.channels[1].spend_cents, 0); assert.equal(c.leads, 1);
  f.db.exec('DROP TABLE channel_spend; ALTER TABLE contacts RENAME COLUMN utm_json TO missing_utm;');
  c = (await read(f)).body.campaigns[0];
  assert.equal(c.channels[0].spend_cents, null); assert.match(c.channels[0].spend_reason, /^Unreadable:/); assert.equal(c.leads, null); assert.match(c.leads_reason, /^Unreadable:/);
});
test('the additive migration is re-runnable and the database enforces its checks and cascades', () => {
  const f = fixture();
  const migration = readFileSync(resolve(M, '202611041613_grow_campaigns.sql'), 'utf8');
  f.db.exec(migration);
  for (const [column, value] of [['name',' '],['goal','unknown'],['status','sending'],['budget_cents',-1],['utm_campaign',' Mixed ']]) {
    assert.throws(() => f.db.prepare(`INSERT INTO grow_campaigns(uid,project_id,name,goal,${column === 'name' || column === 'goal' ? 'starts_on' : column}) VALUES (?,?,?,?,?)`).run(`bad-${column}`, PA, column === 'name' ? value : 'Plan', column === 'goal' ? value : 'sales', column === 'name' || column === 'goal' ? null : value));
  }
  f.db.exec("INSERT INTO grow_campaigns(uid,project_id,name,goal) VALUES ('parent',7,'Plan','sales'); DELETE FROM projects WHERE id = 7;");
  assert.equal(one(f, 'SELECT COUNT(*) n FROM grow_campaigns').n, 0);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});
test('a failed atomic replacement rolls back campaign fields, links and audit; a stale snapshot writes no plan or links', async () => {
  const f = fixture(); links(f); const uid = (await create(f, { channel_uids: ['our-channel'] })).body.campaign.uid;
  const original = f.env.DB.batch.bind(f.env.DB);
  f.env.DB.batch = (statements: any[]) => original([...statements, f.env.DB.prepare('INSERT INTO campaign_test_failure_missing(id) VALUES (1)')]);
  await assert.rejects(updateCampaign(f.env, PA, { id: FOUNDER } as any, uid, { name: 'Failed', channel_uids: ['second-channel'] }));
  f.env.DB.batch = original;
  let c = (await read(f)).body.campaigns[0];
  assert.equal(c.name, 'Spring launch'); assert.equal(c.channels[0].uid, 'our-channel');
  assert.equal(one(f, "SELECT COUNT(*) n FROM activity_logs WHERE entity_id = ?", uid).n, 1);
  f.env.DB.batch = (statements: any[]) => {
    f.db.prepare("UPDATE grow_campaigns SET name = 'Concurrent edit' WHERE uid = ?").run(uid);
    return original(statements);
  };
  await assert.rejects(updateCampaign(f.env, PA, { id: FOUNDER } as any, uid, { name: 'Stale overwrite', channel_uids: ['second-channel'] }), (e: any) => e.status === 409);
  f.env.DB.batch = original;
  c = (await read(f)).body.campaigns[0];
  assert.equal(c.name, 'Concurrent edit'); assert.equal(c.channels[0].uid, 'our-channel');
  assert.equal(one(f, 'SELECT COUNT(*) n FROM activity_logs WHERE entity_id = ?', uid).n, 1);
});
