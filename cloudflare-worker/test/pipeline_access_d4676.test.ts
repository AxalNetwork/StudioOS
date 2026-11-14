/**
 * D4676 (#4676, Pipeline audit 1 of 6) — one project-access policy for every
 * Pipeline door: the board's list and enrichment, the detail read, every
 * write, the per-deal realtime door, and what an open socket receives.
 *
 * Built on the baseline schema and every migration, with IDENTITY FIXTURES
 * THAT COLLIDE: an account whose `users.id` is the same number as another
 * founder's `founders.id`. Ownership is decided by `users.founder_id`, so that
 * account owns nothing by the coincidence.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/pipeline_access_d4676.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { buildFresh, postCutoffMigrations } from '../../scripts/check-baseline-drift.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import pipeline from '../src/routes/pipeline.ts';
import realtime from '../src/routes/realtime.ts';
import { pipelineCapabilities, readablePipelineScope } from '../src/services/pipelineAccess.ts';
import { socketDelivery, newAudienceCache } from '../src/services/pipelineRoomAudience.ts';

const ROOT = process.cwd();
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const LATER = (postCutoffMigrations(ROOT) as Array<{ sql: string }>).map((m) => m.sql);
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

// ── who's who ────────────────────────────────────────────────────────────────
const ADMIN = 1;
const OWNER = 10;            // founder; owns VENTURE through profile 700
const OWNER_PROFILE = 700;
const COLLIDER = 700;        // an account whose USER id is 700 — the owner's PROFILE id — with its own profile 701
const PARTNER_IN = 20;       // partner, accepted co-founder member of VENTURE
const PARTNER_OUT = 21;      // partner, no membership
const ADVISOR_IN = 22;       // advisor, accepted advisor member of VENTURE
const INVESTOR = 23;         // investor only
const MULTI = 24;            // founder licence (profile 702, owns OTHER) + partner licence, co-founder member of VENTURE
const VENTURE = 900;         // founder profile 700
const OTHER = 901;           // founder profile 702 (MULTI's own)
const STRANGER = 902;        // founder profile 703: nobody here reads it but the admin

function freshDb() {
  const db = buildFresh(BASELINE, LATER, { dqs: true });
  db.exec('PRAGMA foreign_keys = OFF;');
  const f = db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)');
  for (const [id, name] of [[700, 'Owner profile'], [701, 'Collider profile'], [702, 'Multi profile'], [703, 'Stranger profile']] as const) {
    f.run(id, name, `p${id}@example.test`);
  }
  const u = db.prepare('INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (?, ?, ?, ?, ?, 1)');
  u.run(ADMIN, 'admin', 'Admin', 'admin@example.test', null);
  u.run(OWNER, 'founder', 'Owner', 'owner@example.test', OWNER_PROFILE);
  u.run(COLLIDER, 'founder', 'Collider', 'collider@example.test', 701);
  u.run(PARTNER_IN, 'partner', 'Partner In', 'pin@example.test', null);
  u.run(PARTNER_OUT, 'partner', 'Partner Out', 'pout@example.test', null);
  u.run(ADVISOR_IN, 'advisor', 'Advisor In', 'adv@example.test', null);
  u.run(INVESTOR, 'investor', 'Investor', 'inv@example.test', null);
  u.run(MULTI, 'founder', 'Multi', 'multi@example.test', 702);
  db.prepare("INSERT INTO account_licences (user_id, licence, source) VALUES (?, 'partner', 'admin')").run(MULTI);
  const p = db.prepare("INSERT INTO projects (id, name, sector, stage, status, founder_id) VALUES (?, ?, 'saas', 'idea', 'active', ?)");
  p.run(VENTURE, 'Venture', OWNER_PROFILE);
  p.run(OTHER, 'Other', 702);
  p.run(STRANGER, 'Stranger', 703);
  const m = db.prepare("INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, ?, 'accepted')");
  m.run(VENTURE, PARTNER_IN, 'cofounder');
  m.run(VENTURE, ADVISOR_IN, 'advisor');
  m.run(VENTURE, MULTI, 'cofounder');
  return db;
}

const env = (db: any, extra: Record<string, unknown> = {}) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...extra }) as any;

async function token(userId: number, claims: Record<string, unknown> = {}) {
  return new SignJWT({ user_id: userId, ...claims }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}
const app = new Hono().route('/api/pipeline', pipeline);
async function call(db: any, as: number, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(as)}` };
  if (body) headers['content-type'] = 'application/json';
  const res = await app.request(`/api/pipeline${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }, env(db));
  let parsed: any = null; try { parsed = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: parsed };
}
const principal = (db: any, id: number) => {
  const row = db.prepare('SELECT id, role, founder_id FROM users WHERE id = ?').get(id) as any;
  const lic = (db.prepare('SELECT licence FROM account_licences WHERE user_id = ? AND revoked_at IS NULL').all(id) as any[]).map((r) => r.licence);
  return { ...row, licences: [...new Set([String(row.role), ...lic])] };
};

// ── 1. the policy itself ────────────────────────────────────────────────────

test('the capability matrix: read follows the project rule; edit, review and spin-out are admin or a member partner', async () => {
  const db = freshDb();
  const e = env(db);
  const venture = { id: VENTURE, founder_id: OWNER_PROFILE };
  const expect: Array<[number, string, [boolean, boolean, boolean, boolean]]> = [
    [ADMIN, 'admin', [true, true, true, true]],
    [OWNER, 'the founder who owns it', [true, false, false, false]],
    [COLLIDER, 'an account whose user id equals the owner\'s profile id', [false, false, false, false]],
    [PARTNER_IN, 'a partner who is a co-founder member', [true, true, true, true]],
    [PARTNER_OUT, 'a partner with no membership', [false, false, false, false]],
    [ADVISOR_IN, 'an advisor member', [true, false, false, false]],
    [INVESTOR, 'an investor-only account', [false, false, false, false]],
    [MULTI, 'a founder who also holds the partner licence and is a member', [true, true, true, true]],
  ];
  for (const [id, who, [read, edit, review, spinout]] of expect) {
    const caps = await pipelineCapabilities(e, principal(db, id), venture);
    assert.deepEqual([caps.read, caps.edit, caps.review, caps.spinout], [read, edit, review, spinout], who);
  }
  // Multi-licence: MULTI owns OTHER as a founder and reads it, but is not a
  // member of it, so the partner licence does not let it operate there.
  const other = await pipelineCapabilities(e, principal(db, MULTI), { id: OTHER, founder_id: 702 });
  assert.deepEqual([other.read, other.edit], [true, false]);
});

test('identity: ownership is the profile id, never an account id that happens to match it', async () => {
  // Mutation checked: comparing `user.id` with `project.founder_id` lets the
  // collider read the owner's venture.
  const db = freshDb();
  assert.equal(COLLIDER, OWNER_PROFILE, 'the fixture must collide');
  const scope = await readablePipelineScope(env(db), principal(db, COLLIDER));
  assert.deepEqual(scope, { all: false, founderId: 701, memberIds: [] });
  assert.equal((await call(db, COLLIDER, 'GET', `/projects/${VENTURE}/detail`)).status, 404);
  assert.deepEqual((await call(db, COLLIDER, 'GET', '/active')).body.items, []);
});

// ── 2. list and detail agree ────────────────────────────────────────────────

test('the list shows exactly the ventures the detail opens, for every principal, with its total', async () => {
  // Mutation checked: restoring the old fallthrough (every project for a
  // non-founder) puts STRANGER and VENTURE on the outside partner's list.
  const db = freshDb();
  for (const id of [ADMIN, OWNER, COLLIDER, PARTNER_IN, PARTNER_OUT, ADVISOR_IN, INVESTOR, MULTI]) {
    const list = await call(db, id, 'GET', '/active');
    assert.equal(list.status, 200, String(id));
    const listed = new Set(list.body.items.map((r: any) => Number(r.id)));
    assert.equal(list.body.total, listed.size, `${id}: the total counts a different set`);
    for (const pid of [VENTURE, OTHER, STRANGER]) {
      const detail = await call(db, id, 'GET', `/projects/${pid}/detail`);
      assert.equal(listed.has(pid), detail.status === 200, `${id} on ${pid}: list ${listed.has(pid)}, detail ${detail.status}`);
    }
  }
  const outside = await call(db, PARTNER_OUT, 'GET', '/active');
  assert.deepEqual(outside.body.items, [], 'an outside partner sees cards (and their metrics and gates)');
  const multi = await call(db, MULTI, 'GET', '/active');
  assert.deepEqual(multi.body.items.map((r: any) => r.id).sort(), [VENTURE, OTHER], 'the founder and member sets were not united');
});

// ── 3. every write is held to its venture ───────────────────────────────────

test('every write asks the venture\'s rule: an outsider, an advisor member, an investor and the collider are refused', async () => {
  const db = freshDb();
  db.exec(`INSERT INTO mvp_tasks (id, deal_id, title, status) VALUES (55, ${VENTURE}, 'Ship it', 'todo')`);
  db.exec(`INSERT INTO decision_gates (id, deal_id, status) VALUES (66, ${VENTURE}, 'pending')`);
  const writes = (asId: number) => [
    ['advance', () => call(db, asId, 'POST', `/projects/${VENTURE}/advance`, { stage: 'mvp_dev' })],
    ['task create', () => call(db, asId, 'POST', '/mvp-tasks', { deal_id: VENTURE, title: 'x' })],
    ['task update', () => call(db, asId, 'PATCH', '/mvp-tasks/55', { status: 'done' })],
    ['metrics', () => call(db, asId, 'POST', '/metrics/snapshot', { deal_id: VENTURE, key_metrics: { users: 1 } })],
    ['review', () => call(db, asId, 'POST', '/decision-gate/review', { deal_id: VENTURE })],
    ['decide', () => call(db, asId, 'PATCH', '/decision-gate/decide', { gate_id: 66, decision: 'failed' })],
  ] as const;
  for (const who of [PARTNER_OUT, ADVISOR_IN, INVESTOR, COLLIDER, OWNER]) {
    for (const [what, run] of writes(who)) {
      const r = await run();
      assert.equal(r.status, 403, `${who} ${what}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, 'pipeline_forbidden', `${who} ${what}`);
    }
  }
  const task = db.prepare('SELECT status FROM mvp_tasks WHERE id = 55').get() as any;
  assert.equal(task.status, 'todo', 'a refused update changed the task');
  const gate = db.prepare('SELECT status FROM decision_gates WHERE id = 66').get() as any;
  assert.equal(gate.status, 'pending', 'a refused decision moved the gate');
  const project = db.prepare('SELECT status FROM projects WHERE id = ?').get(VENTURE) as any;
  assert.equal(project.status, 'active');
});

test('a member partner and an admin operate the venture; the member partner nowhere else', async () => {
  const db = freshDb();
  db.exec(`INSERT INTO mvp_tasks (id, deal_id, title, status) VALUES (56, ${STRANGER}, 'Not yours', 'todo')`);
  assert.equal((await call(db, PARTNER_IN, 'POST', `/projects/${VENTURE}/advance`, { stage: 'mvp_dev' })).status, 200);
  assert.equal((await call(db, PARTNER_IN, 'POST', '/mvp-tasks', { deal_id: VENTURE, title: 'Mine' })).status, 201);
  assert.equal((await call(db, ADMIN, 'POST', `/projects/${STRANGER}/advance`, { stage: 'mvp_dev' })).status, 200);
  // Mutation checked: changing a task by its id alone lets the member partner
  // of one venture edit another venture's task.
  const elsewhere = await call(db, PARTNER_IN, 'PATCH', '/mvp-tasks/56', { status: 'done' });
  assert.equal(elsewhere.status, 403);
  assert.equal((db.prepare('SELECT status FROM mvp_tasks WHERE id = 56').get() as any).status, 'todo');
  assert.equal((await call(db, PARTNER_IN, 'POST', `/projects/${STRANGER}/advance`, { stage: 'mvp_dev' })).status, 403);
});

test('a venture that does not exist is 404 for every door, and a read the account may not make is 404 too', async () => {
  const db = freshDb();
  assert.equal((await call(db, ADMIN, 'POST', '/projects/99999/advance', { stage: 'mvp_dev' })).status, 404);
  assert.equal((await call(db, ADMIN, 'PATCH', '/mvp-tasks/99999', { status: 'done' })).status, 404);
  assert.equal((await call(db, PARTNER_OUT, 'GET', `/projects/${VENTURE}/detail`)).status, 404, 'a refused read tells the caller the venture exists');
});

// ── 4. realtime: the door, and what an open socket receives ─────────────────

test('the per-deal room admits by the read rule; any partner or investor no longer gets in', async () => {
  const db = freshDb();
  const opened: string[] = [];
  const room = { idFromName: (n: string) => n, get: (id: string) => ({ fetch: async () => { opened.push(id); return new Response(null, { status: 200 }); } }) };
  const rt = new Hono().route('/api', realtime);
  const knock = async (as: number, deal: number | string) => rt.request(`/api/pipeline/ws/${deal}?token=${await token(as)}`,
    { headers: { upgrade: 'websocket' } }, env(db, { PIPELINE_ROOM: room, RATE_LIMITS: { get: async () => null, put: async () => {} } }));
  assert.equal((await knock(PARTNER_OUT, VENTURE)).status, 404);
  assert.equal((await knock(INVESTOR, VENTURE)).status, 404);
  assert.equal((await knock(COLLIDER, VENTURE)).status, 404);
  assert.equal(opened.length, 0, 'a refused account reached the room');
  assert.equal((await knock(PARTNER_IN, VENTURE)).status, 200);
  assert.equal((await knock(ADVISOR_IN, VENTURE)).status, 200);
  assert.deepEqual(opened, [`deal:${VENTURE}`, `deal:${VENTURE}`]);
});

const live = (userId: number, extra: Record<string, unknown> = {}) => ({
  userId: String(userId), role: 'x', connectedAt: Date.now(),
  session: { iat: Math.floor(Date.now() / 1000), jti: null, sid: null, impersonated_by: null, ...extra },
});
const advanced = { type: 'stage_advanced', deal_id: VENTURE, stage: 'mvp_dev' };

test('a board event reaches only a socket whose account may read its deal; a tally keeps its audience; a notification its recipient', async () => {
  // Mutation checked: delivering every non-notification event to partner and
  // investor sockets (the old rule) sends this event to PARTNER_OUT and INVESTOR.
  const db = freshDb();
  const e = env(db);
  const answers = async (event: unknown) => Object.fromEntries(await Promise.all(
    [ADMIN, OWNER, PARTNER_IN, PARTNER_OUT, ADVISOR_IN, INVESTOR, COLLIDER].map(async (id) => [id, await socketDelivery(e, live(id), event, newAudienceCache())]),
  ));
  assert.deepEqual(await answers(advanced), {
    [ADMIN]: 'send', [OWNER]: 'send', [PARTNER_IN]: 'send', [ADVISOR_IN]: 'send',
    [PARTNER_OUT]: 'skip', [INVESTOR]: 'skip', [COLLIDER]: 'skip',
  });
  const tally = await answers({ type: 'vote_updated', deal_id: VENTURE, tally: { up: 1 } });
  assert.equal(tally[INVESTOR], 'send', 'the public tally stopped reaching investors');
  assert.equal(tally[OWNER], 'skip');
  const note = await answers({ type: 'notification', user_id: OWNER });
  assert.equal(note[OWNER], 'send');
  assert.equal(note[ADMIN], 'skip', 'a personal notification reached someone else');
  assert.equal(await socketDelivery(e, live(OWNER), { type: 'stage_change' }), 'skip', 'an event naming no deal reached a non-admin');
});

test('an open socket ends when its session does: sign-out, a revoked session row, deactivation — and is closed, not merely skipped', async () => {
  // Mutation checked: skipping the standing check keeps delivering to all three.
  const db = freshDb();
  const e = env(db);
  assert.equal(await socketDelivery(e, live(PARTNER_IN), advanced), 'send');
  db.prepare('UPDATE users SET jwt_min_iat = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) + 5, PARTNER_IN);
  assert.equal(await socketDelivery(e, live(PARTNER_IN), advanced), 'close', 'a signed-out account kept its channel');

  db.prepare("INSERT INTO user_sessions (jti, user_id, factor, created_at, revoked_at) VALUES ('jti-r', ?, 'password', datetime('now'), datetime('now'))").run(ADVISOR_IN);
  assert.equal(await socketDelivery(e, live(ADVISOR_IN, { jti: 'jti-r' }), advanced), 'close', 'a revoked session kept its channel');
  db.prepare("INSERT INTO user_sessions (jti, user_id, factor, created_at) VALUES ('jti-ok', ?, 'password', datetime('now'))").run(OWNER);
  assert.equal(await socketDelivery(e, live(OWNER, { jti: 'jti-ok' }), advanced), 'send');

  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(OWNER);
  assert.equal(await socketDelivery(e, live(OWNER, { jti: 'jti-ok' }), advanced), 'close', 'a deactivated account kept its channel');

  const legacy = { userId: String(ADMIN), role: 'admin', connectedAt: Date.now() };
  assert.equal(await socketDelivery(e, legacy as any, advanced), 'close', 'a socket with no session facts was trusted');
});

test('membership removed after connect stops the next event', async () => {
  const db = freshDb();
  const e = env(db);
  assert.equal(await socketDelivery(e, live(PARTNER_IN), advanced), 'send');
  db.prepare("UPDATE project_members SET status = 'removed' WHERE project_id = ? AND user_id = ?").run(VENTURE, PARTNER_IN);
  assert.equal(await socketDelivery(e, live(PARTNER_IN), advanced), 'skip');
});

// ── 5. identity, Worker-wide ────────────────────────────────────────────────

test('no Worker file joins users on a founder_id: a founder id is a profile, not an account', () => {
  // D4673 and #4768 fixed this join file by file (Delivery, Pipeline,
  // Research, Offers). This holds the whole Worker to it, so the next file
  // cannot reintroduce it — including any that builds AI context.
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(name)) files.push(p);
    }
  };
  walk(resolve(ROOT, 'cloudflare-worker/src'));
  assert.ok(files.length > 200, 'the walk found too few files to mean anything');
  const offenders = files.filter((f) => /JOIN\s+users\s+(?:AS\s+)?\w+\s+ON\s+\w+\.id\s*=\s*\w+\.founder_id\b/i.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
});
