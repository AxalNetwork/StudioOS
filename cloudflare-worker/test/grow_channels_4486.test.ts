/** D4447 (#4447) — channel details on migrated SQLite and the mounted routes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleGrow from '../src/routes/cycle_grow.ts';
import growChannels from '../src/routes/grow_channels.ts';
import { channelConnections } from '../src/services/growChannels.ts';
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
app.route('/api/grow/channels', growChannels);
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

const read = (f: any, who = FOUNDER, pid = PA) => call(f, who, 'GET', `/api/grow/channels?project=${pid}`);
const create = (f: any, b = {}) => grow(f, FOUNDER, 'POST', '/channels', { name: 'Search', ...b });
function assertNoSecretKeys(v: any) {
  if (v && typeof v === 'object') for (const [key, value] of Object.entries(v)) {
    assert.doesNotMatch(key, /credential|token|secret|password|config|email/i); assertNoSecretKeys(value);
  }
}
test('migration preserves legacy categories, child references and ids; new kind CHECK accepts only the requested vocabulary', () => {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = ON;'); db.exec(BASELINE);
  const migration = '202611041912_growth_channel_details.sql';
  for (const name of newer) { if (name === migration) break; db.exec(readFileSync(resolve(M, name), 'utf8')); }
  seed(db);
  db.exec("INSERT INTO growth_channels(id,uid,project_id,name,utm_source,kind) VALUES (41,'old-paid',7,'Paid','paid','paid_search'),(42,'old-event',7,'Event','event','events'); INSERT INTO channel_spend(channel_id,month,spend_cents) VALUES (41,'2026-10',100)");
  db.exec(readFileSync(resolve(M, migration), 'utf8'));
  const a = db.prepare("SELECT id,kind,legacy_kind FROM growth_channels WHERE uid='old-paid'").get();
  assert.deepEqual({ ...a }, { id: 41, kind: 'ads', legacy_kind: 'paid_search' });
  assert.deepEqual({ ...db.prepare("SELECT kind,legacy_kind FROM growth_channels WHERE uid='old-event'").get() }, { kind: null, legacy_kind: 'events' });
  assert.equal(db.prepare('SELECT channel_id FROM channel_spend').get()!.channel_id, 41);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  for (const kind of ['organic', 'ads', 'newsletter', 'outreach', 'signups', 'partner', null]) db.prepare('UPDATE growth_channels SET kind=? WHERE id=41').run(kind);
  assert.throws(() => db.prepare('UPDATE growth_channels SET kind=? WHERE id=41').run('unknown'), /CHECK/);
  assert.throws(() => db.prepare('UPDATE growth_channels SET purpose=? WHERE id=41').run('x'.repeat(141)), /CHECK/);
  db.close();
});
test('only this venture channels, with member owner, null readings and reasons; no private credentials on any key', async () => {
  const f = fixture();
  f.db.exec("INSERT INTO growth_channels(uid,project_id,name,utm_source) VALUES ('other-channel',8,'Other venture','other')");
  const made = await create(f, { purpose: 'Find customers', owner_user_id: COFOUNDER });
  assert.equal(made.status, 201);
  const r = await read(f);
  assert.equal(r.status, 200);
  assert.equal(r.body.channels.length, 1);
  const ch = r.body.channels[0];
  assert.equal(ch.uid, made.body.uid);
  assert.equal(ch.status, 'active');
  assert.equal(ch.purpose, 'Find customers');
  assert.deepEqual(ch.owner, { user_id: COFOUNDER, name: 'Cal Cofounder', avatar: null });
  assert.equal(ch.last_activity, null); assert.match(ch.last_activity_reason, /^Not recorded:/);
  assert.equal(ch.results, null); assert.match(ch.results_reason, /^Not recorded:/);
  assert.deepEqual(ch.campaigns, []);
  const linkedin = r.body.connections.find((c: any) => c.key === 'linkedin');
  assert.equal(linkedin.status, 'not_offered'); assert.equal(linkedin.reason, 'Needs LinkedIn’s approval'); assert.equal(linkedin.href, null);
  assertNoSecretKeys(r.body);
  assert.equal((await read(f, OTHER)).status, 403);
  assert.equal((await call(f, FOUNDER, 'GET', '/api/grow/channels?project=bad')).status, 400);
});

test('refuses non-members and pending invitations as owner; updates preserve details or explicitly clear them and audit the actor', async () => {
  const f = fixture();
  assert.equal((await create(f, { owner_user_id: OTHER })).status, 400);
  assert.equal((await create(f, { owner_user_id: true })).status, 400);
  f.db.exec("INSERT INTO project_members(project_id,user_id,role,status) VALUES (7,4,'advisor','invited')");
  assert.equal((await create(f, { owner_user_id: PARTNER })).status, 400);
  assert.equal((await create(f, { purpose: 'a'.repeat(141) })).status, 400);
  const made = await create(f, { owner_user_id: FOUNDER, purpose: 'Reach teams' });
  assert.equal(made.status, 201);
  const uid = made.body.uid;
  assert.equal((await grow(f, COFOUNDER, 'PATCH', `/channels/${uid}`, { name: 'Renamed' })).status, 200);
  let ch = (await read(f)).body.channels[0]; assert.equal(ch.purpose, 'Reach teams'); assert.equal(ch.owner.user_id, FOUNDER);
  assert.equal((await grow(f, FOUNDER, 'PATCH', `/channels/${uid}`, { owner_user_id: OTHER })).status, 400);
  assert.equal((await grow(f, COFOUNDER, 'PATCH', `/channels/${uid}`, { purpose: null, owner_user_id: null })).status, 200);
  ch = (await read(f)).body.channels[0]; assert.equal(ch.purpose, null); assert.equal(ch.owner, null);
  assert.equal((await grow(f, FOUNDER, 'PATCH', '/channels/no-channel', { owner_user_id: FOUNDER })).status, 404);
  assert.equal(one(f, "SELECT COUNT(*) AS n FROM activity_logs WHERE user_id = ? AND action = 'grow_channel_updated'", COFOUNDER).n, 2);
});

test('activity is the latest observed content, attributed customer capture or spend; other venture never contributes', async () => {
  const f = fixture(); const made = await create(f); const uid = made.body.uid;
  f.db.prepare("INSERT INTO contacts(uid,project_id,audience,email,utm_json,created_at) VALUES ('hit',7,'customer','not-shown@example.test',?, '2026-10-03T10:00:00Z'),('other',8,'customer','private@example.test',?,'2026-10-30T10:00:00Z')")
    .run(JSON.stringify({ utm_source: 'search' }), JSON.stringify({ utm_source: 'search' }));
  const channelId = one(f, 'SELECT id FROM growth_channels WHERE uid = ?', uid).id;
  f.db.prepare("INSERT INTO content_calendar_items(uid,project_id,channel_id,title,updated_at) VALUES ('piece',7,?,'A plan','2026-10-04T10:00:00Z')").run(channelId);
  f.db.prepare("INSERT INTO channel_spend(channel_id,month,spend_cents,created_at) VALUES (?,'2026-10',100,'2026-10-05T10:00:00Z')").run(channelId);
  let ch = (await read(f)).body.channels[0]; assert.equal(ch.results, 1); assert.equal(ch.results_reason, null);
  assert.equal(ch.last_activity, '2026-10-05T10:00:00Z'); assert.equal(ch.last_activity_reason, null);
  f.db.exec('DROP TABLE contacts');
  ch = (await read(f)).body.channels[0]; assert.equal(ch.results, null); assert.match(ch.results_reason, /^Unreadable:/);
  assert.equal(ch.last_activity, null); assert.match(ch.last_activity_reason, /^Unreadable:/);
});

test('connection reads use only own grant and address, author safe error sentences and disable unsupported apps', async () => {
  const f = fixture();
  f.db.exec(`INSERT INTO mail_accounts(uid,user_id,provider,address,status,credentials,last_error) VALUES
    ('own',1,'imap','own@example.test','active','sensitive-value','Provider private diagnostic'),
    ('other',6,'imap','other-private@example.test','active','other-secret',NULL);
    INSERT INTO integrations(uid,user_id,provider_key,status,auth_type,credentials_enc) VALUES
    ('own-wa',1,'whatsapp','active','webhook','secret-wa'),('other-tg',6,'telegram','active','webhook','secret-tg');`);
  const r = await read(f); const json = JSON.stringify(r.body);
  assertNoSecretKeys(r.body);
  assert.match(json, /own@example.test/); assert.doesNotMatch(json, /other-private|sensitive-value|other-secret|secret-wa|secret-tg|Provider private/);
  assert.equal(r.body.connections.find((c: any) => c.key === 'email:own').status, 'error');
  const wa = r.body.connections.find((c: any) => c.key === 'whatsapp'); assert.equal(wa.status, 'connected'); assert.equal(wa.permission, 'Interview capture only today');
  assert.equal(r.body.connections.find((c: any) => c.key === 'telegram').status, 'not_connected');
  assert.doesNotMatch(JSON.stringify((await read(f, COFOUNDER)).body), /own@example.test/);
  f.db.exec('DROP TABLE mail_accounts');
  const failed = (await read(f)).body.connections.find((c: any) => c.key === 'email'); assert.equal(failed.status, 'unreadable'); assert.match(failed.reason, /^Unreadable:/);
});

test('new categories, safe profile owner, Mercury activity and campaign links reuse existing stores', async () => {
  const f = fixture();
  for (const kind of ['organic', 'ads', 'newsletter', 'outreach', 'signups', 'partner']) {
    const made = await create(f, { name: kind, kind }); assert.equal(made.status, 201);
  }
  assert.equal((await create(f, { name: 'Bad', kind: 'invented' })).status, 400);
  const uid = one(f, "SELECT uid FROM growth_channels WHERE name = 'ads'").uid;
  f.db.exec("UPDATE users SET name='hidden@example.test', headshot_r2_key='private/object' WHERE id=2");
  assert.equal((await grow(f, FOUNDER, 'PATCH', `/channels/${uid}`, { owner_user_id: COFOUNDER })).status, 200);
  const campaign = await grow(f, FOUNDER, 'POST', '/campaigns', { name: 'Launch', goal: 'sales', channel_uids: [uid] });
  assert.equal(campaign.status, 201);
  f.db.prepare("INSERT INTO mercury_grow_facts(integration_id,project_id,module,kind,period,subject,as_of,updated_at) VALUES (1,7,'distribution','channel_spend','2026-10',?,'2026-10-12','2026-10-12T10:00:00Z')").run(uid);
  const r = await read(f); const ch = r.body.channels.find((c: any) => c.uid === uid);
  assert.equal(ch.kind, 'ads'); assert.equal(ch.last_activity, '2026-10-12T10:00:00Z');
  assert.equal(ch.owner.name, null); assert.match(ch.owner.avatar, /^\/api\/settings\/headshot\//);
  assert.doesNotMatch(JSON.stringify(r.body), /hidden@example|private\/object/);
  assert.deepEqual(ch.campaigns, [{ uid: campaign.body.campaign.uid, name: 'Launch' }]);
});

test('support sessions receive no private grant data and unreadable core storage gives a safe refusal', async () => {
  const f = fixture();
  const connections = await channelConnections({ DB: { prepare() { throw new Error('private diagnostic'); } } } as any, { id: FOUNDER } as any, PA, true);
  assertNoSecretKeys(connections);
  assert.equal(connections.find((c) => c.key === 'email')!.status, 'unreadable');
  assert.doesNotMatch(JSON.stringify(connections), /private diagnostic/);
  const anonymous = await app.fetch(new Request('http://t/api/grow/channels?project=7'), f.env);
  assert.equal(anonymous.status, 401);
  f.db.exec('DROP TABLE growth_channels');
  const r = await read(f); assert.equal(r.status, 503); assert.deepEqual(r.body, { detail: 'Channel details are unreadable. Try again.' });
});

