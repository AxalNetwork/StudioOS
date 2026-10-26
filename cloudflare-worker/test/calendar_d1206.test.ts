/** D1206: calendar plan, source, advisor and provider boundaries. All rows synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import calendar from '../src/routes/calendar.ts';
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
  for (const name of ['235_calendar_events_kind.sql', '277_user_recovery_state.sql', '603_calendar_feed_tokens.sql', '256_branch_local_copies.sql', '258_licence_deployments.sql']) {
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
    const init = { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: `${env.BRANCH_CODE ? 'studioos_auth_' + env.BRANCH_CODE : 'studioos_auth'}=${token}; studioos_csrf=fixture-csrf`, 'x-csrf-token': 'fixture-csrf', Origin: 'https://axal.vc', 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
    return mounted ? (await import('../src/index.ts')).default.fetch(new Request('https://axal.vc/api/calendar' + path, init), env, ctx) : calendar.request(path, init, env, ctx);
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
    assert.ok(said.some(args => args.some((arg: any) => arg?.outcome === 'not_configured')));
    assert.ok(said.some(args => args.some((arg: any) => arg?.outcome === 'unreadable')));
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

function licensed(f: ReturnType<typeof fixture>) {
  f.env.BRANCH_CODE = 'fr'; f.env.APP_URL = 'https://fr.axal.vc';
  f.db.exec("INSERT INTO branch_licence (id,licence_uid,brand_name,status,pushed_at) VALUES (1,'fixture-studio','Fixture studio','active',datetime('now'))");
}
function checkins(f: ReturnType<typeof fixture>) {
  for (const [id,owner] of [[11,1],[22,2],[33,5],[66,6]]) {
    f.db.prepare('INSERT INTO founder_checkins (id,uid,founder_user_id,title,start_at,location_uri) VALUES (?,?,?,?,?,?)')
      .run(id, `check-${id}`, owner, `Private check-in ${id}`, START, 'https://meet.example.test/private-room');
  }
  f.db.exec("INSERT INTO users (id,email,name,role) VALUES (6,'other-admin@example.test','Other administrator','admin'); UPDATE users SET is_active=0 WHERE id=5");
}

test('D1206: Studio reads only the licensed deployment, deduplicates participants and removes actions/private contact fields', async () => {
  const f = fixture();
  try {
    licensed(f); checkins(f);
    f.db.exec("UPDATE founder_checkins SET status='cancelled' WHERE id=22");
    f.db.prepare('INSERT INTO ic_meetings (id,uid,title,start_at,organizer_user_id) VALUES (?,?,?,?,?)').run(1,'shared-ic','Shared meeting',START,1);
    f.db.exec('INSERT INTO ic_meeting_attendees (meeting_id,user_id) VALUES (1,1),(1,2)');
    await assert.rejects(() => service.fetchCalendarScope(f.env,{ id: 2, role: 'founder' } as any,'studio',FROM,TO), { message: 'Forbidden' });
    await assert.rejects(() => service.fetchCalendarScope(f.env,{ id: 1, role: 'admin', is_super_admin: 1 } as any,'all',FROM,TO), { message: 'Forbidden' });
    const res = await f.request(`/events?${window}&scope=studio&kinds=founder_checkin,ic_meeting`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.scope, 'studio'); assert.equal(body.read_only, true);
    assert.deepEqual(new Set(body.items.map((e: any) => e.id)), new Set(['ic_meeting:1','founder_checkin:11','founder_checkin:22']));
    assert.equal(body.items.length, 3);
    assert.equal(body.coverage.complete, true);
    assert.deepEqual(body.coverage.studios, [{ name: 'Fixture studio', code: 'fr', ok: true, error: null, reason: null }]);
    for (const event of body.items) {
      assert.equal(event.read_only, true);
      assert.deepEqual(event.my_role,{ code: 'read_only', words: 'Read only' });
      assert.equal(event.family, 'meetings'); assert.equal(event.href,null);
      assert.deepEqual(event.can, { rsvp: false, reschedule: false, cancel: false, copy: false });
      assert.equal(event.organizer_email, null); assert.equal(event.location_uri, null); assert.equal(event.notes, null);
      assert.ok(event.attendees.every((person: any) => person.email === null));
      assert.deepEqual(event.pushed_to, []);
    }
    assert.equal(JSON.stringify(body.items).includes('@example.test'), false);
    assert.equal(JSON.stringify(body.items).includes('private-room'), false);
    assert.equal(service.eventsToIcs(body.items).includes('BEGIN:VEVENT'), false);
    let attemptedCopies = 0;
    globalThis.fetch = async () => { attemptedCopies++; throw new Error('scoped projection must not reach a provider'); };
    for (const provider of ['Google','Microsoft'] as const) assert.equal(await service[`pushEventTo${provider}`]('fixture-access',body.items[0],null), null);
    assert.equal(attemptedCopies,0);
    const personal = await f.request(`/events?${window}&kinds=founder_checkin,ic_meeting`);
    const mine = await personal.json() as any;
    assert.deepEqual(new Set(mine.items.map((e: any) => e.id)), new Set(['ic_meeting:1','founder_checkin:11']));
    const download = await f.request(`/events.ics?${window}&scope=studio&kinds=founder_checkin`);
    const file = await download.text();
    assert.equal(download.status, 200);
    assert.ok(file.includes('Private check-in 11')); assert.equal(file.includes('Private check-in 22'), false);
    assert.equal((await f.request('/push/founder_checkin/22?scope=studio',1,{})).status, 404);
    const payloads: any[] = [];
    globalThis.fetch = async (url: any, init: any) => {
      const u = new URL(String(url));
      assert.ok(['oauth2.googleapis.com','login.microsoftonline.com','www.googleapis.com','graph.microsoft.com'].includes(u.hostname));
      if (u.pathname.includes('token')) return Response.json({ access_token: 'fixture-access' });
      payloads.push(JSON.parse(init.body)); return Response.json({ id: `fixture-copy-${payloads.length}` });
    };
    for (const provider of ['google','microsoft']) {
      const table = provider === 'google' ? 'google_oauth_tokens' : 'microsoft_oauth_tokens';
      f.db.prepare(`INSERT INTO ${table} (user_id,refresh_token) VALUES (1,?)`).run(await encryptString(f.env,'fixture-refresh'));
      payloads.length = 0;
      const sync = await f.request(`/${provider}/sync?${window}&scope=studio`,1,{});
      assert.equal(sync.status,200,await sync.clone().text());
      const summary = await sync.json() as any;
      assert.deepEqual([summary.total,summary.pushed,summary.failed],[2,2,0]);
      assert.deepEqual(new Set(payloads.map(e => e.summary ?? e.subject)),new Set(['Private check-in 11','Shared meeting']));
    }

    for (const id of [2,3,4]) assert.equal((await f.request(`/events?${window}&scope=studio`,id)).status, 403);
    // An elevation row on a branch cannot turn it into HQ.
    f.db.exec('INSERT INTO super_admins (user_id,granted_by_user_id) VALUES (1,1)');
    assert.equal((await f.request(`/events?${window}&scope=all`)).status, 403);
    assert.equal((await f.request(`/events?${window}&scope=unknown`)).status, 400);
  } finally { await f.close(); }
});

test('D1206: Studio requires readable current licence and membership; a failed source keeps loaded items', async () => {
  const f = fixture();
  try {
    licensed(f); checkins(f);
    f.breakSource('FROM ic_meetings');
    const source = await f.request(`/events?${window}&scope=studio&kinds=ic_meeting,founder_checkin`);
    const result = await source.json() as any;
    assert.equal(source.status, 200);
    assert.equal(result.items.length, 2); assert.equal(result.coverage.complete, false);
    assert.equal(result.sources.find((s: any) => s.kind === 'ic_meeting').error, 'unreadable');
    for (const [broken, error] of [['FROM branch_licence','unreadable'],['SELECT id, role FROM users','unreadable']] as const) {
      f.breakSource(broken);
      const res = await f.request(`/events?${window}&scope=studio&kinds=founder_checkin`);
      const body = await res.json() as any;
      assert.equal(res.status, 200); assert.deepEqual(body.items, []);
      assert.equal(body.coverage.complete, false); assert.equal(body.coverage.error,error);
      assert.match(body.coverage.reason,/Try again/);
      assert.ok(body.sources.every((s: any) => !s.ok && s.error === error));
    }
    f.breakSource(''); f.db.exec('DROP TABLE advisor_bookings');
    const notConfigured = await (await f.request(`/events?${window}&scope=studio&kinds=advisor_booking,founder_checkin`)).json() as any;
    assert.equal(notConfigured.items.length,2); assert.equal(notConfigured.coverage.error,'not_configured');
    assert.match(notConfigured.coverage.reason,/Not read here yet/);
    f.breakSource(''); f.db.exec("UPDATE branch_licence SET status='terminated'");
    const terminated = await (await f.request(`/events?${window}&scope=studio`)).json() as any;
    assert.equal(terminated.coverage.error, 'not_configured'); assert.deepEqual(terminated.items, []);
    f.db.exec('DELETE FROM branch_licence');
    const missing = await (await f.request(`/events?${window}&scope=studio`)).json() as any;
    assert.equal(missing.coverage.error, 'not_configured'); assert.deepEqual(missing.items, []);
    delete f.env.BRANCH_CODE; f.env.APP_URL = 'https://axal.vc';
    const hq = await (await f.request(`/events?${window}&scope=studio`)).json() as any;
    assert.equal(hq.coverage.error, 'not_configured'); assert.match(hq.coverage.reason, /HQ has no member-to-licence/);
  } finally { await f.close(); }
});

test('D1206: All studios is HQ Super Admin only and reports remote or unreadable coverage without blanking local items', async () => {
  const f = fixture();
  try {
    checkins(f);
    assert.equal((await f.request(`/events?${window}&scope=all`)).status, 403);
    await assert.rejects(() => service.fetchCalendarScope(f.env,{ id: 1, role: 'admin' } as any,'all',FROM,TO), { message: 'Forbidden' });
    f.db.exec("INSERT INTO super_admins (user_id,granted_by_user_id) VALUES (1,1); INSERT INTO territory_licences (id,uid,licence_ref,legal_entity_name,brand_name,status) VALUES (1,'remote','fixture-1','Fixture entity','Remote studio','active'),(2,'ended','fixture-2','Ended entity','Ended studio','terminated'); INSERT INTO licence_deployments (licence_uid,code,hostname,worker_name,d1_name) VALUES ('remote','de','de.example.test','fixture','fixture');");
    let remoteCalls = 0;
    f.env.BRANCH_DE = { calendar() { remoteCalls++; throw new Error('must never call remote'); } };
    f.env.BRANCH_BE = { calendar() { remoteCalls++; throw new Error('must never call remote'); } };
    const res = await f.request(`/events?${window}&scope=all&kinds=founder_checkin`);
    const body = await res.json() as any;
    assert.equal(res.status,200); assert.equal(body.scope,'all'); assert.equal(body.read_only,true);
    assert.deepEqual(new Set(body.items.map((e: any) => e.id)),new Set(['founder_checkin:11','founder_checkin:22','founder_checkin:66']));
    assert.equal(body.coverage.complete,false); assert.equal(body.coverage.error,'not_configured');
    assert.match(body.coverage.reason,/HQ items only/);
    assert.deepEqual(body.coverage.studios.map((s: any) => [s.name,s.code,s.ok]), [['HQ','hq',true],['Remote studio','de',false],[null,'be',false]]);
    assert.ok(body.coverage.studios.slice(1).every((s: any) => s.error==='not_configured' && /Not read here yet/.test(s.reason)));
    assert.equal(remoteCalls,0);
    f.breakSource('FROM territory_licences');
    const unreadable = await (await f.request(`/events?${window}&scope=all&kinds=founder_checkin`)).json() as any;
    assert.equal(unreadable.items.length,3); assert.equal(unreadable.coverage.complete,false);
    assert.equal(unreadable.coverage.error,'unreadable'); assert.match(unreadable.coverage.reason,/Try again/);
  } finally { await f.close(); }
});


test('D1206: Studio member reads continue past a complete keyset page without a silent member cap', async () => {
  const f = fixture();
  try {
    licensed(f);
    for (let id=10; id<=114; id++) f.db.prepare('INSERT INTO users (id,email,name,role) VALUES (?,?,?,?)').run(id, `fixture-page-${id}@example.test`, `Fixture page ${id}`, 'founder');
    f.db.prepare('INSERT INTO founder_checkins (uid,founder_user_id,title,start_at) VALUES (?,?,?,?)').run('last-member',114,'Last member check-in',START);
    const body = await (await f.request(`/events?${window}&scope=studio&kinds=founder_checkin`)).json() as any;
    assert.equal(body.coverage.complete,true);
    assert.deepEqual(body.items.map((e: any) => e.title),['Last member check-in']);
  } finally { await f.close(); }
});
