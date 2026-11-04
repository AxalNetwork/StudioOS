/** D4483 (#4483) — campaign details, sources, funnels and creative gates over migrated SQLite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleGrow from '../src/routes/cycle_grow.ts';
import { putCampaignCreative } from '../src/services/growCampaigns.ts';
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
const plain = (r: any) => (r == null ? r : { ...r });
const one = (f: any, sql: string, ...args: any[]) => plain(f.db.prepare(sql).get(...args)) as any;

const create = (f: any, b = {}, who = FOUNDER) => grow(f, who, 'POST', '/campaigns', { name: 'Spring launch', goal: 'signups', ...b });
const read = (f: any, who = FOUNDER, pid = PA) => call(f, who, 'GET', `/api/cycles/grow/campaigns?project=${pid}`);
function links(f: any) {
  f.db.exec(`INSERT INTO growth_channels(id,uid,project_id,name,utm_source) VALUES (1,'our-channel',7,'Search','search'),(2,'other-channel',8,'Other','other'),(3,'second-channel',7,'Social','social');
    INSERT INTO customer_segments(id,project_id,name,name_norm) VALUES (1,7,'Teams','teams'),(2,8,'Other teams','other teams');
    INSERT INTO content_calendar_items(id,uid,project_id,title) VALUES (1,'our-content',7,'A plan'),(2,'other-content',8,'Other plan');
    INSERT INTO publish_drafts(id,uid,project_id,module,author_user_id) VALUES (1,'our-draft',7,'distribution',1),(2,'other-draft',8,'distribution',6);`);
}
const detail = (f: any, uid: string, who = FOUNDER, pid = PA) => call(f, who, 'GET', `/api/cycles/grow/campaigns/${uid}?project=${pid}`);
const creatives = (f: any, uid: string, who = FOUNDER, pid = PA) => call(f, who, 'GET', `/api/cycles/grow/campaigns/${uid}/creatives?project=${pid}`);
const creative = (f: any, uid: string, text: unknown = 'A founder wrote this', who = FOUNDER, extra = '') => grow(f, who, 'PUT', `/campaigns/${uid}/creatives/google_search_text/headline${extra}`, { text });
test('detail, literal filters and unfiltered status counts preserve venture boundaries', async () => {
  const f = fixture(); links(f);
  const uid = (await create(f, { name: 'Launch 50%_\\ Offer', channel_uids: ['our-channel'] })).body.campaign.uid;
  const second = (await create(f, { name: 'launch another' })).body.campaign.uid;
  await grow(f, FOUNDER, 'PATCH', `/campaigns/${second}`, { status: 'active' });
  await grow(f, FOUNDER, 'POST', `/campaigns/${uid}/items`, { kind: 'content_item', uid: 'our-content' });
  await grow(f, FOUNDER, 'POST', `/campaigns/${uid}/items`, { kind: 'publish_draft', uid: 'our-draft' });
  f.db.exec(`UPDATE content_calendar_items SET channel_id=1 WHERE id=1;
    UPDATE publish_drafts SET body_json='{"title":"Founder draft"}', calendar_item_id=1 WHERE id=1;`);
  const r = await detail(f, uid, ADVISOR);
  assert.equal(r.status, 200); assert.equal(r.body.campaign.created_by, 'Fay Founder');
  assert.ok(r.body.campaign.created_at); assert.equal(r.body.campaign.status, 'draft');
  assert.deepEqual(r.body.campaign.linked_items.map((i: any) => [i.uid, i.kind, i.title, i.channel.name, i.status]), [
    ['our-content','content_item','A plan','Search','idea'], ['our-draft','publish_draft','Founder draft','Search','draft']
  ]);
  assert.equal((await detail(f, uid, OTHER, PB)).status, 404);
  f.db.exec("UPDATE users SET name='' WHERE id=1");
  assert.equal((await detail(f, uid)).body.campaign.created_by, null);
  const query = async (q: string) => call(f, FOUNDER, 'GET', `/api/cycles/grow/campaigns?project=7&${q}`);
  let filtered = await query('status=draft&q=launch');
  assert.deepEqual(filtered.body.campaigns.map((c: any) => c.uid), [uid]);
  assert.deepEqual(filtered.body.counts, { all: 2, active: 1, draft: 1, paused: 0, ended: 0 });
  for (const q of ['%', '_', '\\']) {
    filtered = await query(`q=${encodeURIComponent(q)}`);
    assert.deepEqual(filtered.body.campaigns.map((c: any) => c.uid), [uid]);
  }
  assert.equal((await query('status=bogus')).status, 400);
  assert.equal((await query('status=active&q=absent')).body.campaigns.length, 0);
  await grow(f, FOUNDER, 'DELETE', `/campaigns/${uid}`);
  assert.equal((await detail(f, uid)).status, 404);
  assert.equal((await query('')).body.counts.all, 1);
});
test('explicit activation, paused end, audience validation and channel budget/date validation', async () => {
  const f = fixture(); links(f);
  for (const audience_kind of ['bad', 3, {}, '']) assert.equal((await create(f, { audience_kind })).status, 400);
  for (const audience_kind of ['icp', 'segment']) {
    const invalid = await create(f, { audience_kind }); assert.equal(invalid.status, 400); assert.equal(invalid.body.field, 'segment_id');
    assert.equal((await create(f, { audience_kind, segment_id: 2 })).status, 404);
    assert.equal((await create(f, { audience_kind, segment_id: 1 })).status, 201);
  }
  const r = await create(f, { audience_kind: 'import', starts_on: '2020-01-01', ends_on: '2020-02-01', channel_uids: ['our-channel'] });
  const uid = r.body.campaign.uid; assert.equal(r.body.campaign.status, 'draft');
  assert.equal((await detail(f, uid)).body.campaign.status, 'draft');
  for (const audience_kind of ['bad', false]) assert.equal((await grow(f, FOUNDER, 'PATCH', `/campaigns/${uid}`, { audience_kind })).status, 400);
  assert.equal((await grow(f, FOUNDER, 'PATCH', `/campaigns/${uid}`, { audience_kind: 'icp' })).status, 400);
  await grow(f, FOUNDER, 'PATCH', `/campaigns/${uid}`, { audience_kind: 'segment', segment_id: 1 });
  assert.equal((await grow(f, FOUNDER, 'PATCH', `/campaigns/${uid}`, { segment_id: null })).status, 400);
  const none = await grow(f, FOUNDER, 'PATCH', `/campaigns/${uid}`, { audience_kind: 'none' });
  assert.equal(none.body.campaign.audience_kind, 'none'); assert.equal(none.body.campaign.segment, null);
  for (const status of ['active', 'paused', 'ended']) assert.equal((await grow(f, FOUNDER, 'PATCH', `/campaigns/${uid}`, { status })).status, 200);
  for (const status of ['draft', 'active', 'paused']) assert.equal((await grow(f, FOUNDER, 'PATCH', `/campaigns/${uid}`, { status })).status, 409);
  for (const body of [{ budget_type:'weekly' }, { budget_type:1 }, { starts_on:'2026-02-30' }, { ends_on:'tomorrow' }, { starts_on:'2026-02-02', ends_on:'2026-02-01' }]) {
    const invalid = await grow(f, FOUNDER, 'PUT', `/campaigns/${uid}/channels/our-channel`, { planned_budget_cents: 40, ...body });
    assert.equal(invalid.status, 400); assert.ok(invalid.body.field);
  }
  for (const budget_type of ['daily','lifetime',null]) {
    const saved = await grow(f, FOUNDER, 'PUT', `/campaigns/${uid}/channels/our-channel`, { planned_budget_cents: 4000, budget_type, starts_on:'2026-12-01', ends_on:'2026-12-31' });
    assert.equal(saved.status, 200); const g = saved.body.campaign.channels[0];
    assert.equal(g.budget_type, budget_type); assert.equal(g.starts_on, '2026-12-01'); assert.equal(g.ends_on, '2026-12-31'); assert.equal(g.planned_budget_cents, 4000);
  }
});
test('Mercury wins within campaign months, sources and nulls are honest; funnels share one scoped scan', async () => {
  const f = fixture(); links(f);
  const uid = (await create(f, { starts_on:'2026-03-15', ends_on:'2026-05-01', utm_campaign:'launch', budget_cents:1000, channel_uids:['our-channel'] })).body.campaign.uid;
  const empty = (await detail(f, uid)).body.campaign;
  assert.equal(empty.channels[0].spend_cents, null); assert.match(empty.channels[0].spend_reason, /^Not recorded:/);
  assert.equal(empty.channels[0].spend_source, null); assert.equal(empty.budget_used_pct, null);
  f.db.exec(`INSERT INTO channel_spend(channel_id,month,spend_cents) VALUES (1,'2026-02',900),(1,'2026-03',100),(1,'2026-05',250),(1,'2026-06',900);`);
  const fact = f.db.prepare("INSERT INTO mercury_grow_facts(integration_id,project_id,module,kind,period,subject,amount_cents,as_of) VALUES (1,?,'distribution','channel_spend',?,'our-channel',?,'2026-06-01')");
  for (const [pid,month,amount] of [[7,'2026-02',999],[7,'2026-03',400],[7,'2026-06',999],[8,'2026-04',9999]] as const) fact.run(pid,month,amount);
  const contact = f.db.prepare("INSERT INTO contacts(uid,project_id,audience,email,status,utm_json) VALUES (?,?,'customer',?,?,?)");
  for (const [id,pid,status,json] of [['qualified',7,'qualified','{"utm_campaign":" LAUNCH "}'],['active',7,'active','{"utm_campaign":"launch"}'],['passed',7,'passed','{"utm_campaign":"launch"}'],['other',8,'active','{"utm_campaign":"launch"}'],['malformed',7,'active','oops'],['wrong',7,'active','{"utm_campaign":"wrong"}']] as const) contact.run(id,pid,`${id}@example.test`,status,json);
  await grow(f, FOUNDER, 'PUT', `/campaigns/${uid}/channels/our-channel`, { planned_budget_cents:1000 });
  let c = (await detail(f, uid)).body.campaign; let g = c.channels[0];
  assert.equal(g.spend_cents, 650); assert.equal(g.spend_source, 'mixed'); assert.equal(g.spend_reason, null);
  assert.deepEqual(g.spend_months, [{ month:'2026-03', spend_cents:400, source:'mercury' },{ month:'2026-05', spend_cents:250, source:'manual' }]);
  assert.equal(g.budget_used_pct, 65); assert.equal(c.budget_used_pct, 65);
  assert.deepEqual([c.leads,c.demos,c.customers], [3,2,1]);
  fact.run(7,'2026-05',0);
  c = (await detail(f, uid)).body.campaign; assert.equal(c.channels[0].spend_source, 'mercury'); assert.equal(c.channels[0].spend_cents, 400);
  f.db.exec('DELETE FROM mercury_grow_facts');
  assert.equal((await detail(f, uid)).body.campaign.channels[0].spend_source, 'manual');
  const tagless = (await create(f)).body.campaign;
  for (const key of ['leads','demos','customers']) { assert.equal(tagless[key], null); assert.match(tagless[`${key}_reason`], /^Not recorded:/); }
  await create(f, { utm_campaign:'second' });
  const prepare = f.env.DB.prepare.bind(f.env.DB); let scans = 0;
  f.env.DB.prepare = (sql: string) => { if (/FROM contacts/.test(sql)) scans++; return prepare(sql); };
  assert.equal((await read(f)).status, 200); assert.equal(scans, 1);
  f.db.exec('ALTER TABLE contacts RENAME COLUMN utm_json TO missing; DROP TABLE mercury_grow_facts');
  c = (await detail(f, uid)).body.campaign;
  for (const key of ['leads','demos','customers']) { assert.equal(c[key], null); assert.match(c[`${key}_reason`], /^Unreadable:/); }
  assert.equal(c.channels[0].spend_cents, null); assert.match(c.channels[0].spend_reason, /^Unreadable:/);
});
test('creative upsert is gated, capped, atomic, audited and never writes another venture or a final plan', async () => {
  const f = fixture(); const uid = (await create(f)).body.campaign.uid;
  assert.deepEqual((await creatives(f, uid, ADVISOR)).body.creatives, []);
  assert.equal((await creative(f, uid, 'Denied', ADVISOR)).status, 403);
  assert.equal((await creatives(f, uid, OTHER, PB)).status, 404);
  assert.equal((await grow(f, OTHER, 'PUT', `/campaigns/${uid}/creatives/google_search_text/headline`, { project: PB, text:'No' })).status, 404);
  for (const text of [null, 12, 'x'.repeat(2001)]) assert.equal((await creative(f, uid, text)).status, 400);
  assert.equal((await grow(f, FOUNDER, 'PUT', `/campaigns/${uid}/creatives/bad/body`, { text:'No' })).status, 400);
  assert.equal((await grow(f, FOUNDER, 'PUT', `/campaigns/${uid}/creatives/meta_feed_4_5/bad`, { text:'No' })).status, 400);
  let r = await creative(f, uid, 'x'.repeat(2000)); assert.equal(r.status, 200);
  const creativeUid = r.body.creatives[0].uid;
  r = await creative(f, uid, 'Revised', COFOUNDER);
  assert.equal(r.body.creatives.length, 1); assert.equal(r.body.creatives[0].uid, creativeUid);
  assert.equal(r.body.creatives[0].text, 'Revised'); assert.equal(r.body.creatives[0].updated_by, COFOUNDER);
  assert.equal(one(f, "SELECT COUNT(*) n FROM activity_logs WHERE action='grow_campaign_creative_changed'").n, 2);
  const batch = f.env.DB.batch.bind(f.env.DB);
  f.env.DB.batch = (ss: any[]) => batch([...ss, f.env.DB.prepare('INSERT INTO nonexistent_creative_test(id) VALUES(1)')]);
  await assert.rejects(putCampaignCreative(f.env, PA, { id: FOUNDER } as any, uid, 'google_search_text', 'headline', { text: 'Failed' }));
  f.env.DB.batch = batch;
  assert.equal((await creatives(f, uid)).body.creatives[0].text, 'Revised');
  // A concurrent finalization must prevent the write and its audit.
  f.env.DB.batch = (ss: any[]) => { f.db.prepare("UPDATE grow_campaigns SET status='ended' WHERE uid=?").run(uid); return batch(ss); };
  assert.equal((await creative(f, uid, 'Raced')).status, 409); f.env.DB.batch = batch;
  assert.equal((await creative(f, uid)).status, 409);
  assert.equal(one(f, "SELECT COUNT(*) n FROM activity_logs WHERE action='grow_campaign_creative_changed'").n, 2);
  const archived = (await create(f)).body.campaign.uid;
  await grow(f, FOUNDER, 'DELETE', `/campaigns/${archived}`);
  assert.equal((await creative(f, archived)).status, 409);
  assert.equal(one(f, 'SELECT COUNT(*) n FROM publish_sends').n, 0);
  f.db.prepare('DELETE FROM grow_campaigns WHERE uid=?').run(uid);
  assert.equal(one(f, 'SELECT COUNT(*) n FROM grow_campaign_creatives').n, 0);
});
