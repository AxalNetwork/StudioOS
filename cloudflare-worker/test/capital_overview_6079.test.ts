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
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleRaise from '../src/routes/cycle_raise.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

test.beforeEach(() => test.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-19T10:00:00Z') }));
test.afterEach(() => test.mock.timers.reset());

const SECRET = 'synthetic-5074-only-not-a-real-credential'.repeat(2);
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
  return { db, request, env };
}


test('D6079 the Overview route keeps founder/cofounder access and refuses staff, foreign and support reads', async () => {
  const f = fixture();
  try {
    const owner = await f.request('/capital-relationships/overview', OWNER);
    assert.equal(owner.status, 200);
    assert.deepEqual(owner.data.meetings, { state: 'ok', items: [] });
    assert.deepEqual(owner.data.fit.counts, { fits: 0, outside: 0, unclear: 0, not_recorded: 1 });
    assert.equal(owner.data.history.state, 'not_recorded');
    assert.match(owner.data.history.reason, /complete stage snapshot/);
    assert.equal((await f.request('/capital-relationships/overview', COFOUNDER)).status, 200);
    for (const who of [OTHER, ADVISOR, REMOVED, INVESTOR, ADMIN, HQ]) assert.equal((await f.request('/capital-relationships/overview', who)).status, 403);
    assert.equal((await f.request('/capital-relationships/overview', OWNER, 'GET', undefined, ADMIN)).status, 403);
    assert.equal((await f.request('/capital-relationships/overview?part=made-up', OWNER)).status, 400);
  } finally { f.db.close(); }
});

test('D6079 upcoming venture meetings use the calendar source, and one failed source does not zero the other blocks', async () => {
  const f = fixture();
  try {
    f.db.exec("INSERT INTO raise_prospects (id,uid,project_id,name,stage) VALUES (2,'other-investor',202,'Other venture investor','meeting')");
    f.db.exec("INSERT INTO raise_prospect_events (id, prospect_id, kind, starts_at, calendar_item_uid) VALUES (40, 2, 'meeting', '2089-01-01T09:00:00Z', 'foreign-cal'), (39, 1, 'call', '2020-01-01T09:00:00Z', 'past-cal')");
    f.db.exec("INSERT INTO raise_prospect_events (id, prospect_id, kind, starts_at, calendar_item_uid, note) VALUES (41, 1, 'meeting', '2090-01-01T09:00:00Z', 'cal-41', 'Private note')");
    const result = await f.request('/capital-relationships/overview', OWNER);
    assert.equal(result.data.meetings.items[0].calendar_item_uid, 'cal-41');
    assert.equal(result.data.meetings.items[0].prospect_id, 1);
    f.db.exec('DROP TABLE raise_prospect_events');
    const failed = await f.request('/capital-relationships/overview', OWNER);
    assert.equal(failed.status, 200);
    assert.equal(failed.data.meetings.state, 'unreadable');
    assert.equal(failed.data.fit.state, 'ok');
    assert.equal(failed.data.activity.state, 'ok');
    assert.equal(failed.data.history.state, 'not_recorded');
    const one = await f.request('/capital-relationships/overview?part=fit', OWNER);
    assert.deepEqual(Object.keys(one.data).sort(), ['fit', 'read_at']);
    f.db.exec('DROP TABLE activity_logs');
    const logFailure = await f.request('/capital-relationships/overview', OWNER);
    assert.equal(logFailure.data.activity.state, 'unreadable');
    assert.equal(logFailure.data.history.state, 'unreadable');
    assert.equal(logFailure.data.fit.state, 'ok');
  } finally { f.db.close(); }
});
