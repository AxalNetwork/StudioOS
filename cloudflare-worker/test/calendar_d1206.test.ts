/** D1206: calendar plan, source, advisor and provider boundaries. All rows synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import calendar from '../src/routes/calendar.ts';
import worker from '../src/index.ts';
import * as service from '../src/services/calendar.ts';
import { mintFeedToken } from '../src/services/calendar/feedTokens.ts';
import { encryptString } from '../src/services/cryptoBox.ts';

const SECRET = 'synthetic-calendar-d1206-'.repeat(3);
const FROM = new Date(Date.now() - 86400000).toISOString();
const START = new Date(Date.now() + 86400000).toISOString();
const END = new Date(Date.now() + 90000000).toISOString();
const TO = new Date(Date.now() + 30 * 86400000).toISOString();
const window = `from=${FROM}&to=${TO}`;
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
  for (const name of ['235_calendar_events_kind.sql', '277_user_recovery_state.sql', '603_calendar_feed_tokens.sql']) {
    db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  }
  for (const [id, role] of [[1,'admin'],[2,'founder'],[3,'advisor'],[4,'investor'],[5,'investor']] as const) {
    db.prepare('INSERT INTO users (id,email,name,role,founder_id) VALUES (?,?,?,?,?)').run(id, `fixture-${id}@example.test`, `Fixture ${id}`, role, id === 2 ? 102 : null);
  }
  db.exec(`UPDATE users SET investor_tier='professional' WHERE id=5;
    INSERT INTO projects (id,name,founder_id) VALUES (20,'Fixture venture',102);
    INSERT INTO deals (id,project_id) VALUES (200,20);
    INSERT INTO deal_invitations (deal_id,investor_user_id) VALUES (200,4),(200,5);`);
  let broken = '';
  const DB = { prepare(sql: string) {
    if (broken && sql.includes(broken)) throw new Error('synthetic private row and token must not escape');
    let args: any[] = []; const stmt: any = {
      bind(...values: any[]) { args = values.map(v => v ?? null); return stmt; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    }; return stmt;
  }, async exec(sql: string) { db.exec(sql); } };
  const pending: Promise<unknown>[] = [];
  const ctx: any = { waitUntil(p: Promise<unknown>) { pending.push(p); }, passThroughOnException() {} };
  const env: any = { DB, JWT_SECRET: SECRET, SCORING_HMAC_SECRET: 'synthetic-scoring-d1206-'.repeat(3), ENVIRONMENT: 'production', APP_URL: 'https://axal.vc',
    GOOGLE_CAL_CLIENT_ID: 'fixture-client', GOOGLE_CAL_CLIENT_SECRET: 'fixture-secret',
    MICROSOFT_CLIENT_ID: 'fixture-client', MICROSOFT_CLIENT_SECRET: 'fixture-secret' };
  async function request(path: string, id = 1, body?: unknown, mounted = false) {
    const token = await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const init = { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: `studioos_auth=${token}; studioos_csrf=fixture-csrf`, 'x-csrf-token': 'fixture-csrf', Origin: 'https://axal.vc', 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
    return mounted ? worker.fetch(new Request('https://axal.vc/api/calendar' + path, init), env, ctx) : calendar.request(path, init, env, ctx);
  }
  return { db, env, request, breakSource(s: string) { broken = s; }, async close() { await Promise.allSettled(pending); db.close(); } };
}

// Nothing in this suite may contact a real provider, even on a refusal path.
const realFetch = globalThis.fetch;
test.beforeEach(() => { globalThis.fetch = async () => { throw new Error('unexpected provider call'); }; });
test.afterEach(() => { globalThis.fetch = realFetch; });

test('D1206: Free investor reads mounted calendar and subscriptions; only IC creation requires Professional', async () => {
  const f = fixture();
  try {
    for (const path of [`/events?${window}`, `/events.ics?${window}`, '/ic-meetings', '/my-events/feed']) {
      const res = await f.request(path, 4, undefined, true);
      assert.equal(res.status, 200, `${path}: ${await res.clone().text()}`);
    }
    const feed = await mintFeedToken(f.env, 4);
    const res = await f.request(`/feed/my-events.ics?token=${feed.token}`, 4, undefined, true);
    assert.equal(res.status, 200, await res.clone().text());
    const body = { title: 'Fixture IC', start_at: START, deal_id: 200, attendee_user_ids: [2] };
    const denied = await f.request('/ic-meetings', 4, body, true);
    assert.equal(denied.status, 402);
    const paywall = await denied.json() as any;
    assert.equal(paywall.error, 'investor_tier_required');
    assert.equal(paywall.required, 'professional');
    assert.equal(paywall.plan.plan_key, 'investor:professional');
    assert.match(paywall.message, /Investor Professional/);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM ic_meetings').get()?.n, 0);
    assert.equal((await f.request('/ic-meetings', 5, body, true)).status, 200);
    assert.equal((await f.request('/ic-meetings', 1, body, true)).status, 200);
  } finally { await f.close(); }
});

test('D1206: source failures carry fixed codes, preserve other sources and leak no raw error in logs or strict reads', async () => {
  const f = fixture();
  const said: unknown[][] = []; const warn = console.warn;
  console.warn = (...args) => { said.push(args.map(arg => arg instanceof Error ? String(arg) : arg)); };
  try {
    f.db.prepare("INSERT INTO calendar_events (uid,user_id,source,kind,external_uri,title,start_at,end_at) VALUES ('own',1,'axal','expert_booking','fixture','Fixture meeting',?,?)").run(START, END);
    f.breakSource('FROM ic_meetings');
    const r = await service.fetchUserEventsWithSources(f.env, 1, 'admin', FROM, TO, ['ic_meeting','expert_booking']);
    assert.deepEqual(r.sources, [{ kind: 'ic_meeting', ok: false, error: 'unreadable' }, { kind: 'expert_booking', ok: true, error: null }]);
    assert.deepEqual(r.events.map(e => e.title), ['Fixture meeting']);
    await assert.rejects(() => service.fetchUserEvents(f.env, 1, 'admin', FROM, TO, ['ic_meeting']), { message: 'calendar source ic_meeting failed: unreadable' });
    f.breakSource(''); f.db.exec('DROP TABLE advisor_bookings');
    const missing = await service.fetchUserEventsWithSources(f.env, 1, 'admin', FROM, TO, ['advisor_booking']);
    assert.deepEqual(missing, { events: [], sources: [{ kind: 'advisor_booking', ok: false, error: 'not_configured' }] });
    await assert.rejects(() => service.fetchUserEvents(f.env, 1, 'admin', FROM, TO, ['advisor_booking']), { message: 'calendar source advisor_booking failed: not_configured' });
    f.db.exec('ALTER TABLE partner_office_hour_slots RENAME COLUMN starts_at TO old_starts_at');
    const column = await service.fetchUserEventsWithSources(f.env, 1, 'admin', FROM, TO, ['partner_office_hour']);
    assert.deepEqual(column.sources, [{ kind: 'partner_office_hour', ok: false, error: 'not_configured' }]);
    const response = await f.request(`/events?${window}&kinds=ic_meeting,advisor_booking`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.deepEqual(body.sources, [{ kind: 'ic_meeting', ok: true, error: null }, { kind: 'advisor_booking', ok: false, error: 'not_configured' }]);
    assert.equal(JSON.stringify(said).includes('synthetic private'), false);
    assert.equal(JSON.stringify(said).includes('user_id'), false);
  } finally { console.warn = warn; await f.close(); }
});

test('D1206: advisor ownership fallback finds own bookings and rejects a stale foreign advisor pointer', async () => {
  const f = fixture();
  try {
    f.db.exec(`INSERT INTO advisors (id,uid,user_id,display_name,email) VALUES (30,'own-advisor',3,'Fixture advisor','advisor@example.test'),(40,'other-advisor',5,'Other advisor','other@example.test');`);
    for (const id of [30,40]) {
      f.db.prepare('INSERT INTO advisor_office_hour_slots (id,uid,advisor_id,starts_at,ends_at) VALUES (?,?,?,?,?)').run(id, `slot-${id}`, id, START, END);
      f.db.prepare('INSERT INTO advisor_bookings (uid,slot_id,advisor_id,founder_user_id,topic) VALUES (?,?,?,?,?)').run(`booking-${id}`, id, id, 2, 'Fixture session');
    }
    for (const pointer of [null,30,40]) {
      f.db.prepare('UPDATE users SET advisor_id=? WHERE id=3').run(pointer);
      const events = await service.fetchUserEvents(f.env, 3, 'advisor', FROM, TO, ['advisor_booking']);
      assert.deepEqual(events.map(e => e.source_uid), ['booking-30'], `pointer ${pointer}`);
    }
    const outsider = await service.fetchUserEvents(f.env, 4, 'investor', FROM, TO, ['advisor_booking']);
    assert.deepEqual(outsider, []);
    const founder = await service.fetchUserEvents(f.env, 2, 'founder', FROM, TO, ['advisor_booking']);
    assert.equal(founder.length, 2);
  } finally { await f.close(); }
});

test('D1206: both providers skip Calendly on full sync and direct push; the personal download still includes it', async () => {
  const f = fixture(); const payloads: any[] = [];
  globalThis.fetch = async (url: any, init: any) => {
    const u = new URL(String(url));
    assert.ok(['oauth2.googleapis.com','oauth2.microsoftonline.com','login.microsoftonline.com','www.googleapis.com','graph.microsoft.com'].includes(u.hostname), u.hostname);
    if (u.pathname.includes('token')) return Response.json({ access_token: 'fixture-access', expires_in: 3600 });
    payloads.push(JSON.parse(init.body)); return Response.json({ id: `fixture-event-${payloads.length}` });
  };
  try {
    for (const [id,user,source] of [[1,1,'calendly'],[2,1,'axal'],[3,2,'axal']] as const) f.db.prepare('INSERT INTO calendar_events (id,uid,user_id,source,kind,external_uri,title,start_at,end_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, `row-${id}`, user, source, 'expert_booking', `fixture-${id}`, `Fixture ${id}`, START, END);
    const events = await service.fetchUserEvents(f.env, 1, 'admin', FROM, TO, ['calendly_event','expert_booking']);
    const calendly = events.find(e => e.kind === 'calendly_event')!;
    assert.ok(calendly);
    for (const provider of ['Google','Microsoft'] as const) {
      const table = provider === 'Google' ? 'google_oauth_tokens' : 'microsoft_oauth_tokens';
      f.db.prepare(`INSERT INTO ${table} (user_id,refresh_token) VALUES (1,?)`).run(await encryptString(f.env, 'fixture-refresh'));
      payloads.length = 0;
      const r = await service[`syncUserTo${provider}`](f.env, 1, 'admin', FROM, TO);
      assert.deepEqual(r, { total: 2, pushed: 1, updated: 0, failed: 0, skipped: 1, removed: 0 });
      assert.deepEqual(payloads.map(p => p.summary ?? p.subject), ['Fixture 2']);
      assert.equal(await service[`pushEventTo${provider}`]('fixture-access', calendly, null), null);
      assert.equal(await service[`pushEventTo${provider}`]('fixture-access', calendly, 'fixture-existing'), null);
      assert.equal(payloads.length, 1);
    }
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM calendar_sync_records WHERE source_kind='calendly_event'").get()?.n, 0);
    const download = await f.request(`/events.ics?${window}&scope=studio`);
    const text = await download.text();
    assert.equal(download.status, 200);
    assert.ok(text.includes('SUMMARY:Fixture 1'));
    assert.ok(text.includes('SUMMARY:Fixture 2'));
    assert.equal(text.includes('SUMMARY:Fixture 3'), false);
    assert.equal((await f.request('/push/calendly_event/1', 1, {})).status, 400);
    assert.equal((await f.request('/push/expert_booking/3?scope=studio', 1, {})).status, 400); // expert booking has no single-event push surface
  } finally { await f.close(); }
});
