/** #2440: personal calendar boundaries and relationship-gated scheduling. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import calendar from '../src/routes/calendar.ts';
import * as service from '../src/services/calendar.ts';
import { encryptString } from '../src/services/cryptoBox.ts';

const SECRET = 'synthetic-calendar-2440-'.repeat(3);
const START = new Date(Date.now() + 86_400_000).toISOString();
const END = new Date(Date.now() + 90_000_000).toISOString();
const FROM = new Date(Date.now() - 86_400_000).toISOString();
const TO = new Date(Date.now() + 30 * 86_400_000).toISOString();
const roles = ['admin', 'founder', 'partner', 'exploring', 'advisor', 'investor'] as const;
function fixture(route = calendar) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  // Canonical production baseline, followed by the real additive migration.
  db.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
  for (const name of ['235_calendar_events_kind.sql', '277_user_recovery_state.sql']) db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  for (let i = 1; i <= 12; i++) db.prepare('INSERT INTO users (id,email,name,role,founder_id) VALUES (?,?,?,?,?)')
    .run(i, `member-${i}@example.test`, `Fixture ${i}`, i === 1 ? 'admin' : i === 2 || i === 3 ? 'founder' : 'investor', i === 2 ? 102 : i === 3 ? 103 : null);
  db.exec(`INSERT INTO projects (id,name,founder_id) VALUES (20,'Fixture venture',102),(30,'Other venture',103);
    INSERT INTO deals (id,project_id) VALUES (200,20),(300,30);
    INSERT INTO deal_invitations (deal_id,investor_user_id) VALUES (200,4),(300,5);
    INSERT INTO commitments (deal_id,investor_user_id,amount) VALUES (200,6,100);
    INSERT INTO project_members (project_id,user_id,role,status) VALUES (20,7,'cofounder','accepted'),(20,8,'advisor','removed');
    UPDATE users SET role='founder' WHERE id=7;
    UPDATE users SET role='advisor' WHERE id IN (8,9);
    UPDATE users SET role='partner' WHERE id IN (11,12);
    UPDATE deals SET lead_partner_id=11 WHERE id=200;
    INSERT INTO advisor_client_grants (uid,project_id,advisor_user_id,granted_by_user_id,scope_sessions)
      VALUES ('fixture-grant',20,9,2,1);`);
  const DB = { prepare(sql: string) { let args: any[] = []; const statement: any = {
    bind(...values: any[]) { args = values.map(v => v ?? null); return statement; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  }; return statement; }, async exec(sql: string) { db.exec(sql); } };
  const env: any = { DB, ENVIRONMENT: 'production', JWT_SECRET: SECRET, APP_URL: 'https://example.test',
    GOOGLE_CAL_CLIENT_ID: 'synthetic-client', GOOGLE_CAL_CLIENT_SECRET: 'synthetic-secret',
    MICROSOFT_CLIENT_ID: 'synthetic-client', MICROSOFT_CLIENT_SECRET: 'synthetic-secret' };
  const pending: Promise<unknown>[] = [];
  async function request(path: string, user = 1, body?: unknown) {
    const token = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    return route.request(path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: `studioos_auth=${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env, { waitUntil(p: Promise<unknown>) { pending.push(p); }, passThroughOnException() {} });
  }
  return { db, env, request, async close() { await Promise.all(pending); db.close(); } };
}
function seedEvents(db: DatabaseSync) {
  for (const [id, owner] of [[1,1],[2,2],[3,3]]) {
    db.prepare('INSERT INTO ic_meetings (id,uid,title,start_at,organizer_user_id) VALUES (?,?,?,?,?)').run(id, `ic-${id}`, `IC ${id}`, START, owner);
    db.prepare('INSERT INTO ic_meeting_attendees (meeting_id,user_id) VALUES (?,?)').run(id, owner);
    db.prepare('INSERT INTO founder_checkins (id,uid,founder_user_id,title,start_at) VALUES (?,?,?,?,?)').run(id, `ck-${id}`, owner, `Checkin ${id}`, START);
    for (const source of ['calendly','axal']) db.prepare('INSERT INTO calendar_events (uid,user_id,source,external_uri,title,start_at,end_at,kind) VALUES (?,?,?,?,?,?,?,?)')
      .run(`${source}-${id}`, owner, source, `https://example.test/${source}/${id}`, `${source} ${id}`, START, END, source === 'axal' ? 'expert_booking' : null);
    db.prepare('INSERT INTO advisor_office_hour_slots (id,uid,advisor_id,starts_at,ends_at) VALUES (?,?,?,?,?)').run(id, `as-${id}`, id, START, END);
    db.prepare('INSERT INTO advisor_bookings (uid,slot_id,advisor_id,founder_user_id,topic) VALUES (?,?,?,?,?)').run(`ab-${id}`, id, id, owner, `Advisor ${id}`);
    db.prepare('INSERT INTO partner_office_hour_slots (id,uid,partner_id,starts_at,ends_at) VALUES (?,?,?,?,?)').run(id, `ps-${id}`, id, START, END);
    db.prepare('INSERT INTO partner_bookings (uid,slot_id,partner_id,founder_user_id,topic) VALUES (?,?,?,?,?)').run(`pb-${id}`, id, id, owner, `Partner ${id}`);
  }
  // Attending is sufficient even when the admin did not organise the meeting.
  db.prepare('INSERT INTO ic_meeting_attendees (meeting_id,user_id) VALUES (2,1)').run();
}
async function personal(api = service, route = calendar) {
  const f = fixture(route);
  const oldFetch = globalThis.fetch;
  const pushed: any[] = [];
  globalThis.fetch = async (url: any, init: any) => {
    if (String(url).includes('/token')) return Response.json({ access_token: 'synthetic-access', expires_in: 3600 });
    pushed.push(JSON.parse(init.body));
    return Response.json({ id: `synthetic-${pushed.length}` });
  };
  try {
    seedEvents(f.db);
    const own = await api.fetchUserEvents(f.env, 1, 'admin', FROM, TO);
    assert.equal(own.length, 7);
    // Compare the full ids too: the axal direct row is calendar_events id 2.
    assert.deepEqual(new Set(own.map(e => e.id)), new Set(['ic_meeting:1','ic_meeting:2','founder_checkin:1','advisor_booking:1','partner_office_hour:1','calendly_event:1','expert_booking:2']));
    const feed = await f.request(`/events.ics?from=${FROM}&to=${TO}`);
    assert.equal(feed.status, 200);
    const ics = await feed.text();
    assert.match(ics, /SUMMARY:IC 2/);
    assert.equal(ics.includes('SUMMARY:IC 3'), false);
    for (const title of ['Checkin 2','Advisor 2','Partner 2','calendly 2','axal 2']) assert.equal(ics.includes(title), false, title);
    assert.equal((await f.request('/push/founder_checkin/2', 1, {})).status, 404);
    assert.equal((await f.request('/push/founder_checkin/1', 1, {})).status, 200);
    for (const provider of ['Google','Microsoft'] as const) {
      const encrypted = await encryptString(f.env, 'synthetic-refresh');
      f.db.prepare(`INSERT INTO ${provider === 'Google' ? 'google_oauth_tokens' : 'microsoft_oauth_tokens'} (user_id,refresh_token) VALUES (1,?)`).run(encrypted);
      pushed.length = 0;
      const summary = await api[`syncUserTo${provider}`](f.env, 1, 'admin', FROM, TO);
      assert.deepEqual([summary.total, summary.pushed, summary.failed], [7,7,0]);
      assert.deepEqual(new Set(pushed.map(e => e.summary ?? e.subject)), new Set(own.map(e => e.title)));
    }
  } finally { globalThis.fetch = oldFetch; await f.close(); }
}
test('#2440: admin feeds, Google/Outlook sync and one-event push are personal across all six sources', () => personal());
const checkin = (extra = {}) => ({ title: 'Fixture check-in', founder_user_id: 2, start_at: START, project_id: 20, ...extra });
async function deniedCheckins(route = calendar) {
  const f = fixture(route);
  try {
    for (const role of roles) {
      f.db.prepare('UPDATE users SET role=? WHERE id=10').run(role);
      for (const counterpart_user_id of [undefined, 10, 2, 4, 3]) {
        assert.equal((await f.request('/founder-checkins', 10, checkin({ counterpart_user_id }))).status, 403, `${role}/${counterpart_user_id}`);
      }
    }
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM founder_checkins').get()?.n, 0);
  } finally { await f.close(); }
}
test('#2440: every unrelated role is refused regardless of the named counterpart', () => deniedCheckins());
async function allowedCheckins(route = calendar) {
  const f = fixture(route);
  try {
    for (const user of [2,4,6,7,9,11]) assert.equal((await f.request('/founder-checkins', user, checkin())).status, 200, `related ${user}`);
    assert.equal((await f.request('/founder-checkins', 2, checkin({ counterpart_user_id: 11 }))).status, 200, 'assigned lead counterpart');
    assert.equal((await f.request('/founder-checkins', 4, checkin({ project_id: null }))).status, 200, 'related without explicit project');
    assert.equal((await f.request('/founder-checkins', 10, checkin({ founder_user_id: 10, project_id: null }))).status, 403, 'non-founder self');
    assert.equal((await f.request('/founder-checkins', 2, checkin({ project_id: 30 }))).status, 403, 'another founder project');
    assert.equal((await f.request('/founder-checkins', 4, checkin({ founder_user_id: 5 }))).status, 403, 'target must be a founder');
    assert.equal((await f.request('/founder-checkins', 2, checkin({ project_id: 'invalid' }))).status, 400);
    assert.equal((await f.request('/founder-checkins', 2, checkin({ counterpart_user_id: 'invalid' }))).status, 400);
    f.db.exec('UPDATE users SET is_active=0 WHERE id=3');
    assert.equal((await f.request('/founder-checkins', 2, checkin({ founder_user_id: 3, project_id: 30 }))).status, 404, 'inactive founder');
    assert.equal((await f.request('/founder-checkins', 2, checkin({ counterpart_user_id: 10 }))).status, 403, 'unrelated counterpart');
    assert.equal((await f.request('/founder-checkins', 8, checkin())).status, 403, 'removed member');
    f.db.exec("UPDATE advisor_client_grants SET scope_sessions=0");
    assert.equal((await f.request('/founder-checkins', 9, checkin())).status, 403, 'no sessions grant');
    f.db.exec("UPDATE advisor_client_grants SET scope_sessions=1,status='revoked'");
    assert.equal((await f.request('/founder-checkins', 9, checkin())).status, 403, 'revoked advisor');
    f.db.exec("UPDATE advisor_client_grants SET status='active',expires_at='2000-01-01'");
    assert.equal((await f.request('/founder-checkins', 9, checkin())).status, 403, 'expired advisor');
    assert.deepEqual(f.db.prepare("SELECT user_id FROM activity_logs WHERE action='calendar_checkin_created' ORDER BY id").all().map((r: any) => r.user_id), [2,4,6,7,9,11,2,4]);
  } finally { await f.close(); }
}
test('#2440: self, accepted project members, deal investors and assigned advisors work; foreign projects and revoked ties fail', () => allowedCheckins());
const ic = (extra = {}) => ({ title: 'Fixture IC', start_at: START, deal_id: 200, attendee_user_ids: [2,6], ...extra });
async function icGuards(route = calendar) {
  const f = fixture(route);
  try {
    assert.equal((await f.request('/ic-meetings', 4, ic({ deal_id: null }))).status, 400);
    assert.equal((await f.request('/ic-meetings', 4, ic({ deal_id: 300, attendee_user_ids: [3] }))).status, 403);
    f.db.exec('INSERT INTO deals (id,project_id,lead_partner_id) VALUES (201,20,12)');
    assert.equal((await f.request('/ic-meetings', 4, ic({ attendee_user_ids: [12] }))).status, 403, 'lead on a different deal of the same venture');
    assert.equal((await f.request('/ic-meetings', 4, ic({ attendee_user_ids: [5] }))).status, 403, 'foreign-deal investor');
    f.db.exec('INSERT INTO deal_invitations (deal_id,investor_user_id) VALUES (201,5)');
    assert.equal((await f.request('/ic-meetings', 4, ic({ attendee_user_ids: [5] }))).status, 403, 'same venture, different deal');
    for (const role of roles) {
      f.db.prepare('UPDATE users SET role=? WHERE id=10').run(role);
      assert.equal((await f.request('/ic-meetings', 4, ic({ attendee_user_ids: [10] }))).status, 403, `outside attendee ${role}`);
    }
    assert.equal((await f.request('/ic-meetings', 4, ic({ attendee_user_ids: [999] }))).status, 403);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM ic_meetings').get()?.n, 0);
    for (const role of ['founder','partner','exploring','advisor']) {
      f.db.prepare('UPDATE users SET role=? WHERE id=10').run(role);
      assert.equal((await f.request('/ic-meetings', 10, ic())).status, 403, `organizer ${role}`);
    }
    assert.equal((await f.request('/ic-meetings', 4, ic({ attendee_user_ids: 'invalid' }))).status, 400);
    assert.equal((await f.request('/ic-meetings', 4, ic({ attendee_user_ids: ['invalid'] }))).status, 400);
    f.db.exec('UPDATE users SET is_active=0 WHERE id=6');
    assert.equal((await f.request('/ic-meetings', 4, ic())).status, 403, 'inactive attendee');
    f.db.exec('UPDATE users SET is_active=1 WHERE id=6');
    assert.equal((await f.request('/ic-meetings', 4, ic({ attendee_user_ids: [2,6,7,9,11] }))).status, 200, 'founder, commitment, member, advisor and assigned lead');
    assert.equal((await f.request('/ic-meetings', 1, ic())).status, 200, 'admin explicitly organizes a readable deal');
    assert.deepEqual(f.db.prepare("SELECT user_id FROM activity_logs WHERE action='calendar_ic_created' ORDER BY id").all().map((r: any) => r.user_id), [4,1]);
  } finally { await f.close(); }
}
test('#2440: IC requires a readable deal and participants on that deal before any writes', () => icGuards());

// Isolated mutants exercise real handlers and SQLite, then restore passing
// sources. Imports (including the push handler's dynamic import) stay local.
const routeUrl = new URL('../src/routes/calendar.ts', import.meta.url);
const serviceUrl = new URL('../src/services/calendar.ts', import.meta.url);
const routeSource = readFileSync(routeUrl, 'utf8');
const serviceSource = readFileSync(serviceUrl, 'utf8');
let serial = 0;
function moduleUrl(source: string, base: URL, overrides: Record<string, string> = {}) {
  const js = stripTypeScriptTypes(source).replace(/(from\s+|import\()(['"])([^'"]+)\2/g, (_m, prefix, _quote, spec) => {
    if (/\s/.test(spec)) return _m; // quoted prose in comments is not an import
    let resolved = overrides[spec];
    if (!resolved && spec.startsWith('.')) {
      const path = new URL(spec, base);
      resolved = [path.href,path.href+'.ts',path.href+'.js'].find(p => statSync(new URL(p), { throwIfNoEntry: false })?.isFile())!;
    }
    resolved ||= import.meta.resolve(spec);
    return `${prefix}'${resolved}'`;
  });
  return 'data:text/javascript;base64,' + Buffer.from(js).toString('base64') + '#2440-' + serial++;
}
test('#2440: scheduling assertions reject each removed relationship/ownership guard and pass restored sources', async () => {
  const mutants: [string, string, (route: typeof calendar) => Promise<void>][] = [
    ["if (!canScheduleIc(lc(user.role)))", 'if (false)', icGuards],
    ["if (!Number.isSafeInteger(dealId) || dealId <= 0)", 'if (false)', icGuards],
    ["if (!(await userMayReadDeal(c.env, user, dealId)))", 'if (false)', icGuards],
    ["if (!attendee || !(await isDealParty(c.env, attendee, dealId)))", 'if (false)', icGuards],
    ["if (body.attendee_user_ids != null && !Array.isArray(body.attendee_user_ids))", 'if (false)', icGuards],
    ["if (!Number.isSafeInteger(attendeeId) || attendeeId <= 0)", 'if (false)', icGuards],
    ["WHERE id = ${attendeeId} AND is_active = 1", 'WHERE id = ${attendeeId}', icGuards],
    ["if (deal.lead_partner_id === user.id) return true;", '', icGuards],
    ["if (lead.length) return true;", '', allowedCheckins],
    ['isProjectParty(env, user, deal, false)', 'isProjectParty(env, user, deal)', icGuards],
    ["WHERE deal_id = ${dealId} AND investor_user_id = ${user.id} LIMIT 1", "WHERE deal_id != ${dealId} AND investor_user_id = ${user.id} LIMIT 1", icGuards],
    ["if (!isSelf && !(await related(user)))", 'if (false)', deniedCheckins],
    ["if (founder.role !== 'founder')", 'if (false)', allowedCheckins],
    ["if (projectId !== null && !projects.length)", 'if (false)', allowedCheckins],
    ["if (projectId !== null && (!Number.isSafeInteger(projectId) || projectId <= 0))", 'if (false)', allowedCheckins],
    ["if (!Number.isSafeInteger(counterId) || counterId <= 0)", 'if (false)', allowedCheckins],
    ["WHERE id = ${founderId} AND is_active = 1", 'WHERE id = ${founderId}', allowedCheckins],
    ['WHERE id = ${projectId} AND founder_id = ${founder.founder_id}', 'WHERE id = ${projectId} AND (${founder.founder_id} IS NOT NULL)', allowedCheckins],
    ["if (!counterpart || !(await related(counterpart)))", 'if (false)', allowedCheckins],
    ["if (member && await canAccessProject(env, user, project))", 'if (false)', allowedCheckins],
    ["await logAdminAction(c.env, user.id, user.email, 'calendar_checkin_created', { checkin_id: checkin.id, target_user_id: founderId, project_id: projectId });", '', allowedCheckins],
    ["await logAdminAction(c.env, user.id, user.email, 'calendar_ic_created', { meeting_id: meeting.id, deal_id: dealId, attendees: attendeeIds.size });", '', icGuards],
    ["if (invited.length) return true;", 'if (false) return true;', allowedCheckins],
    ["return committed.length > 0;", 'return false;', allowedCheckins],
    ["AND status = 'active'", '', allowedCheckins],
    ["AND scope_sessions = 1", '', allowedCheckins],
    ["AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))", '', allowedCheckins],
  ];
  for (const [before, after, check] of mutants) {
    assert.ok(routeSource.includes(before), before);
    const route = (await import(moduleUrl(routeSource.replace(before, after), routeUrl))).default;
    // Removing the array validation intentionally reaches the safe() error
    // handler. Avoid logging that mutant's entire data-URL module as a stack.
    const logError = console.error;
    if (before.includes('!Array.isArray')) console.error = () => {};
    try { await assert.rejects(() => check(route), { name: 'AssertionError' }, before); }
    finally { console.error = logError; }
    await check(calendar);
  }
});
test('#2440: personal calendar assertions reject widened readers across all sources, then pass restored sources', async () => {
  for (const [before, after] of [
    ['if (!(m.organizer_user_id === userId || invited.has(userId)))', 'if (false)'],
    ['AND (founder_user_id = ${userId} OR counterpart_user_id = ${userId})', 'AND (${userId} IS NOT NULL OR counterpart_user_id = ${userId})'],
    ['if (!(isRequester || isAdvisor))', 'if (false)'],
    ['if (!(isRequester || isPartnerSide))', 'if (false)'],
    ["source = 'calendly' AND user_id = ?", "source = 'calendly' AND ? IS NOT NULL"],
    ["kind = ? AND user_id = ?", "kind = ? AND ? IS NOT NULL"],
    ['fetchUserEvents(env, userId, role, fromIso, toIso)', 'fetchUserEvents(env, 2, role, fromIso, toIso)'],
  ]) {
    assert.ok(serviceSource.includes(before), before);
    const mutated = moduleUrl(serviceSource.replace(before, after), serviceUrl);
    const api = await import(mutated);
    const route = (await import(moduleUrl(routeSource, routeUrl, { '../services/calendar': mutated }))).default;
    await assert.rejects(() => personal(api, route), { name: 'AssertionError' }, before);
    await personal();
  }
});

test('#2440: feed and push entry points cannot substitute another member', async () => {
  for (const [before, after] of [
    ['fetchUserEvents(c.env, user.id, lc(user.role), fromDt.toISOString(), toDt.toISOString())', 'fetchUserEvents(c.env, 2, lc(user.role), fromDt.toISOString(), toDt.toISOString())'],
    ['fetchUserEvents(c.env, user.id, user.role, from, to, [kind])', 'fetchUserEvents(c.env, 2, user.role, from, to, [kind])'],
  ]) {
    assert.ok(routeSource.includes(before), before);
    const route = (await import(moduleUrl(routeSource.replace(before, after), routeUrl))).default;
    await assert.rejects(() => personal(service, route), { name: 'AssertionError' }, before);
    await personal();
  }
});
