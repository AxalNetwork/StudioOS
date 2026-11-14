/**
 * D5074 slice 4 (#5074) — Capital relationships' capabilities, across roles. The module read returns the caller's map
 * (the working read for the owner and co-founders, the counts-only summary for staff), and each capability is checked
 * against the request it governs: an allowed request is never refused for who the caller is, a denied one is refused
 * with its own code. Roles: the founder who owns the venture, a member whose role is owner, an accepted co-founder, an
 * admin, the Super Admin on HQ, an advisor member, an investor-licence member, a removed co-founder, another founder and
 * a support session. The frontend fixtures' mirror (`frontend/test/_caprel_capabilities.mjs`) is pinned to the
 * Worker's function. Every identity and record is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/caprel_capabilities_5074.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleRaise from '../src/routes/cycle_raise.ts';
import { CAPREL_CAPABILITIES, capRelCan, capRelCapabilities } from '../src/services/capRelCapabilities.ts';
import { CAPREL_CAPABILITIES as MIRROR_KEYS, capRelCapabilities as mirror } from '../../frontend/test/_caprel_capabilities.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const SECRET = 'synthetic-caprel-capabilities-5074-'.repeat(3);
const OWNER = 1, COFOUNDER = 2, OTHER = 3, ADVISOR = 4, REMOVED = 5, INVESTOR = 6, MEMBER_OWNER = 7, ADMIN = 30, HQ = 31;
const P = 101;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  loadSchema(db);
  db.exec(`INSERT INTO users (id,name,email,role,founder_id) VALUES
    (1,'Fixture Owner','owner@example.test','founder',11),(2,'Fixture Co-founder','cofounder@example.test','founder',22),
    (3,'Fixture Other','other@example.test','founder',33),(4,'Fixture Advisor','advisor@example.test','advisor',NULL),
    (5,'Fixture Removed','removed@example.test','founder',55),(6,'Fixture Investor','investor@example.test','investor',NULL),
    (7,'Fixture Editor','editor@example.test','founder',77),
    (30,'Fixture Admin','staff@example.test','admin',NULL),(31,'Fixture Super Admin','super@example.test','admin',NULL);
    INSERT INTO projects (id,uid,name,founder_id) VALUES (101,'venture-a','Fixture venture A',11),(202,'venture-b','Fixture venture B',22);
    INSERT INTO project_members (project_id,user_id,role,status) VALUES (101,2,'cofounder','accepted'),(101,4,'advisor','accepted'),(101,5,'cofounder','removed'),(101,6,'cofounder','accepted'),(101,7,'owner','accepted');
    INSERT INTO super_admins (user_id,granted_by_user_id) VALUES (31,31);
    INSERT INTO raise_prospects (id,uid,project_id,name,email,firm,notes,stage,amount) VALUES
      (1,'investor-a',101,'Fixture Private Investor','private@example.test','Fixture Private Fund','Fixture private notes','meeting',123456);
    INSERT INTO raise_rounds (id,uid,project_id,name,target_amount,status) VALUES (1,'round-a',101,'Fixture round',456789,'active');`);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'production', APP_URL: 'https://axal.vc' };
  const app = new Hono<any>().route('/api/cycles/raise', cycleRaise);
  app.onError((error, c) => c.json({ detail: error.message === 'Unauthorized' ? 'Unauthorized' : 'Request unavailable' }, error.message === 'Unauthorized' ? 401 : 503));
  async function request(path: string, actor: number, method = 'GET', body?: unknown, impersonator?: number) {
    const token = await new SignJWT({ user_id: actor, ...(impersonator ? { impersonated_by: impersonator } : {}) }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
    try {
      const sep = path.includes('?') ? '&' : '?';
      const response = await app.request(`https://axal.vc/api/cycles/raise${path}${sep}project=${P}`, {
        method, headers: { 'content-type': 'application/json', Cookie: `studioos_auth=${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, env, { waitUntil() {}, passThroughOnException() {} } as any);
      const text = await response.text();
      let data: any; try { data = JSON.parse(text); } catch { data = { detail: text }; }
      return { status: response.status, data };
    } finally { [console.warn, console.error] = saved; }
  }
  return { db, request };
}

const originalFetch = globalThis.fetch;
test.beforeEach(() => { globalThis.fetch = async () => { throw new Error('Unexpected external provider call'); }; });
test.afterEach(() => { globalThis.fetch = originalFetch; });

const WORKER = capRelCapabilities({ staff: false, worker: true });
const STAFF = capRelCapabilities({ staff: true, worker: false });
const read = (f: ReturnType<typeof fixture>, who: number, impersonator?: number) => f.request('/modules/capital-relationships', who, 'GET', undefined, impersonator);

test('the map: each standing, every key a boolean; no map, an unknown key or a non-true value allows nothing', () => {
  assert.deepEqual(WORKER, { work: true, support_reads: true, support_read: false, admin_reason_required: false });
  assert.deepEqual(STAFF, { work: false, support_reads: false, support_read: true, admin_reason_required: true });
  assert.deepEqual(capRelCapabilities({ staff: false, worker: false }), { work: false, support_reads: false, support_read: false, admin_reason_required: false });
  // Staff never work the pipeline, whatever the standing says.
  assert.equal(capRelCapabilities({ staff: true, worker: true }).work, false);
  for (const caps of [WORKER, STAFF]) assert.deepEqual(Object.keys(caps).sort(), [...CAPREL_CAPABILITIES].sort());
  assert.equal(capRelCan(null, 'work'), false);
  assert.equal(capRelCan({ work: 'true' } as any, 'work'), false);
  assert.equal(capRelCan({ work: true }, 'support_read'), false);
});

test('the frontend fixtures\' mirror is the Worker\'s function', () => {
  assert.deepEqual([...MIRROR_KEYS], [...CAPREL_CAPABILITIES]);
  for (const staff of [false, true]) for (const worker of [false, true]) {
    assert.deepEqual(mirror({ staff, worker }), capRelCapabilities({ staff, worker }), JSON.stringify({ staff, worker }));
  }
});

for (const [label, who] of [['the founder who owns the venture', OWNER], ['an accepted co-founder', COFOUNDER], ['a member whose role is owner', MEMBER_OWNER]] as const) {
  test(`${label}: the working read carries the worker's map, and each capability governs its request`, async () => {
    // Mutation checked: `work: works` → `work: false` refuses every tab here; `support_reads: works` → false refuses the reads list.
    const f = fixture();
    const r = await read(f, who);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.notEqual(r.data.mode, 'summary');
    assert.deepEqual(r.data.capabilities, WORKER);
    // work: a tab's read is answered
    assert.equal((await f.request('/capital-relationships/commitments', who)).status, 200);
    // support_reads: the founder's list of reasoned reads
    assert.equal((await f.request('/capital-relationships/support-reads', who)).status, 200);
    // support_read: refused for who they are
    const support = await f.request('/capital-relationships/support-read', who, 'POST', { reason: 'Due diligence', page: 1 });
    assert.equal(support.status, 403);
    assert.equal(support.data.code ?? support.data.error, 'admin_required');
  });
}

for (const [label, who] of [['an admin', ADMIN], ['the Super Admin on HQ', HQ]] as const) {
  test(`${label}: the summary carries staff's map; the support read is allowed and nothing else`, async () => {
    // Mutation checked: `support_read: s.staff` → false refuses the support read here.
    const f = fixture();
    const r = await read(f, who);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.mode, 'summary');
    assert.equal(r.data.read_only, true);
    assert.deepEqual(r.data.capabilities, STAFF);
    assert.doesNotMatch(JSON.stringify(r.data), /Fixture Private Investor|private@example/, 'the summary names no investor');
    // support_read: allowed with a reason
    const support = await f.request('/capital-relationships/support-read', who, 'POST', { reason: 'Due diligence', page: 1 });
    assert.equal(support.status, 200, JSON.stringify(support.data));
    // work: refused, pointing at the support read
    const commitments = await f.request('/capital-relationships/commitments', who);
    assert.equal(commitments.status, 403);
    assert.equal(commitments.data.code ?? commitments.data.error, 'support_read_required');
    // support_reads: not staff's
    assert.equal((await f.request('/capital-relationships/support-reads', who)).status, 403);
  });
}

test('an advisor, an investor-licence member, a removed co-founder and another founder read no map', async () => {
  const f = fixture();
  for (const who of [ADVISOR, INVESTOR, REMOVED, OTHER]) {
    const r = await read(f, who);
    assert.equal(r.status, 403, `${who}: ${JSON.stringify(r.data)}`);
    assert.ok(!('capabilities' in (r.data || {})), `${who}: no map`);
    assert.equal((await f.request('/capital-relationships/commitments', who)).status, 403);
  }
});

test('a support session is refused before any map, whoever it acts as', async () => {
  const f = fixture();
  for (const who of [OWNER, ADMIN]) {
    const r = await read(f, who, HQ);
    assert.equal(r.status, 403);
    assert.equal(r.data.code ?? r.data.error, 'support_session_refused');
    assert.ok(!('capabilities' in r.data));
  }
});

test('every capital request refuses from the map, in the route source', () => {
  const raise = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/cycle_raise.ts'), 'utf8');
  const scope = raise.slice(raise.indexOf('async function scope('), raise.indexOf('\n}\n', raise.indexOf('async function scope(')));
  assert.match(scope, /caprel = capRelCapabilities\(await capRelStanding\(c\.env, project, user\)\)/);
  assert.match(scope, /if \(capRelCan\(caprel, 'admin_reason_required'\)\)/);
  assert.match(scope, /else if \(!capRelCan\(caprel, 'work'\)\) return c\.json\(\{ detail: 'Forbidden' \}, 403\);/);
  assert.ok(!/capitalCanWork\(/.test(raise), 'the route keeps no access check of its own');
  assert.match(raise, /if \(!capRelCan\(s\.caprel, 'support_read'\)\)/);
  assert.match(raise, /if \(!capRelCan\(s\.caprel, 'support_reads'\)\)/);
  assert.equal((raise.match(/capabilities: \(s as \{ caprel\?: CapRelCapabilities \}\)\.caprel/g) || []).length, 2, 'both modes of the module read carry the map');
});
