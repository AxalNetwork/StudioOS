/** D4483 (#4483) — campaign details, sources, funnels and creative gates over migrated SQLite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import ads, { mergeMonths, costPerLead } from '../src/routes/grow_ads.ts';
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
app.route('/api/grow/ads', ads);
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

async function adsFixture() {
  const f=fixture();
  f.db.exec(`INSERT INTO growth_channels(id,uid,project_id,name,utm_source) VALUES (1,'search-a',7,'Google Search','google'),(2,'search-b',8,'Other Search','google');
    INSERT INTO grow_campaigns(id,uid,project_id,name,goal,starts_on,ends_on,budget_cents) VALUES (1,'campaign-a',7,'Launch','signups','2026-09-01','2026-11-30',10000),(2,'campaign-b',8,'Private campaign','demos','2026-09-01','2026-11-30',10000);
    INSERT INTO grow_campaign_channels(campaign_id,channel_id,planned_budget_cents,budget_type) VALUES (1,1,10000,'lifetime'),(2,2,50000,'lifetime');
    INSERT INTO channel_spend(channel_id,month,spend_cents) VALUES (1,'2026-09',1000),(1,'2026-11',3000),(2,'2026-10',99999);
    INSERT INTO mercury_grow_facts(integration_id,project_id,module,kind,period,subject,amount_cents,as_of) VALUES
    (1,7,'distribution','channel_spend','2026-11','search-a',12000,'2026-11-04'),
    (2,8,'distribution','channel_spend','2026-10','search-a',77777,'2026-11-04');
    INSERT INTO grow_campaign_creatives(uid,campaign_id,placement,field,text) VALUES ('private',2,'google_search_text','body','Private creative');`);
  f.db.exec(`INSERT INTO contacts(uid,project_id,audience,email,status,utm_json,created_at) VALUES
    ('recent',7,'customer','recent@example.test','new','{"utm_source":" GOOGLE "}',datetime('now','-1 day')),
    ('old',7,'customer','old@example.test','new','{"utm_source":"google"}',datetime('now','-8 day')),
    ('foreign',8,'customer','foreign@example.test','new','{"utm_source":"google"}',datetime('now','-1 day')),
    ('bad',7,'customer','bad@example.test','new','broken',datetime('now','-1 day'));`);
  return f;
}
const readAdsRoute=(f:any,pid=7,uid='campaign-a',who=FOUNDER)=>call(f,who,'GET',`/api/grow/ads?project=${pid}&campaign=${uid}`);
test('Ads merges monthly spend with Mercury precedence, absent months, and no cross-venture records',async()=>{
  const f=await adsFixture(),r=await readAdsRoute(f);
  assert.equal(r.status,200);
  assert.deepEqual(r.body.channels[0].months,[{month:'2026-09',spend_cents:1000,source:'manual'},{month:'2026-11',spend_cents:12000,source:'mercury'}]);
  assert.equal(r.body.channels[0].spend_cents,13000);
  assert.equal(r.body.channels[0].leads,1);
  assert.equal(r.body.channels[0].budget_reached,true);
  assert.equal(r.body.channels[0].cost_per_lead_cents,null);
  assert.match(r.body.channels[0].cost_per_lead_reason,/monthly/);
  assert.equal(JSON.stringify(r.body).includes('Private'),false);
  assert.equal(JSON.stringify(r.body).includes('77777'),false);
  assert.equal((await readAdsRoute(f,7,'campaign-b')).status,404);
  assert.equal((await readAdsRoute(f,8,'campaign-b')).status,403);
});
test('non-team advisor sees manual spend only and has no write authority',async()=>{
  const f=await adsFixture(),r=await readAdsRoute(f,7,'campaign-a',ADVISOR);
  assert.equal(r.status,200);assert.equal(r.body.can_write,false);assert.equal(r.body.mercury_visible,false);
  assert.equal(r.body.channels[0].spend_cents,4000);
  assert.equal(JSON.stringify(r.body).includes('12000'),false);
});
test('missing spend stays null, daily budgets do not claim a reached daily limit',async()=>{
  const f=await adsFixture();f.db.exec("DELETE FROM channel_spend; DELETE FROM mercury_grow_facts; UPDATE grow_campaign_channels SET budget_type='daily'");
  const r=await readAdsRoute(f);assert.equal(r.body.channels[0].spend_cents,null);assert.deepEqual(r.body.channels[0].months,[]);assert.equal(r.body.channels[0].budget_reached,false);
  assert.equal(costPerLead(null,3),null);assert.equal(costPerLead(100,null),null);assert.equal(costPerLead(100,0),null);assert.equal(costPerLead(100,2),50);
  assert.deepEqual(mergeMonths([],[{period:'2026-10',amount_cents:null}]),[]);
});
test('Ads authentication and missing parameters refuse without internal errors',async()=>{
  const f=await adsFixture();
  const r=await call(f,FOUNDER,'GET','/api/grow/ads?project=7');assert.equal(r.status,400);
  const unauth=await app.request('/api/grow/ads?project=7&campaign=campaign-a',{},f.env);assert.equal(unauth.status,401);
});
