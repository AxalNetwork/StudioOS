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
  for (const name of ['235_calendar_events_kind.sql', '277_user_recovery_state.sql', '603_calendar_feed_tokens.sql', '256_branch_local_copies.sql', '258_licence_deployments.sql', '463_raise_record_stores.sql', '607_raise_money_cents.sql']) {
    db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  }
  for (const [id, role] of [[1,'admin'],[2,'founder'],[3,'advisor'],[4,'investor'],[5,'investor']] as const) {
    db.prepare('INSERT INTO users (id,email,name,role,founder_id) VALUES (?,?,?,?,?)').run(id, `fixture-${id}@example.test`, `Fixture ${id}`, role, id === 2 ? 102 : null);
  }
  db.exec(`UPDATE users SET investor_tier='professional' WHERE id=5;
    INSERT INTO projects (id,name,founder_id) VALUES (20,'Fixture venture',102);
    INSERT INTO deals (id,project_id) VALUES (200,20);
    INSERT INTO deal_invitations (deal_id,investor_user_id) VALUES (200,4),(200,5);`);
  let broken = ''; let reads = 0; const statements: string[] = [];
  const DB = { prepare(sql: string) {
    reads++; statements.push(sql);
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
  return { db, env, request, readCount() { return reads; }, statements() { return statements; }, breakSource(s: string) { broken = s; }, async close() { await Promise.allSettled(pending); db.close(); } };
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
      assert.deepEqual(r, { total: 1, pushed: 1, updated: 0, failed: 0, skipped: 0, removed: 0, excluded_kinds: ['calendly_event'] });
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
    f.db.exec("UPDATE founder_checkins SET status='cancelled' WHERE id=22; UPDATE founder_checkins SET notes='Fixture private notes'");
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
    assert.equal((await f.request(`/events?scope=studio&from=1970-01-01&to=2100-01-01`)).status,400);
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
    f.db.exec('DROP TABLE ic_meetings'); f.breakSource('FROM founder_checkins');
    const mixed=await (await f.request(`/events?${window}&scope=studio&kinds=ic_meeting,founder_checkin`)).json() as any;
    assert.equal(mixed.sources.find((s: any)=>s.kind==='ic_meeting').error,'not_configured');
    assert.equal(mixed.sources.find((s: any)=>s.kind==='founder_checkin').error,'unreadable');
    assert.equal(mixed.coverage.error,'unreadable'); assert.match(mixed.coverage.reason,/Try again/);
    for (const [broken, error] of [['FROM branch_licence','unreadable'],['SELECT id FROM users WHERE is_active','unreadable']] as const) {
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
    f.db.exec('DROP TABLE advisor_bookings');
    for(let n=0;n<1001;n++) f.db.prepare('INSERT INTO founder_checkins (uid,founder_user_id,title,start_at) VALUES (?,?,?,?)').run(`compound-${n}`,2,`Fixture compound ${n}`,START);
    const compound=await (await f.request(`/events?${window}&scope=all&kinds=founder_checkin,advisor_booking`)).json() as any;
    assert.equal(compound.items.length,1000); assert.equal(compound.coverage.complete,false);
    assert.equal(compound.coverage.error,'unreadable','a missing source cannot downgrade the unreadable studio register');
    assert.deepEqual(compound.coverage.truncated_kinds,['founder_checkin']);
    for(const reason of [/HQ items only/,/Narrow the date window/,/some calendar sources/]) assert.match(compound.coverage.reason,reason);
    assert.equal(compound.sources.find((source: any)=>source.kind==='advisor_booking').error,'not_configured');
  } finally { await f.close(); }
});


test('D1206: Studio includes large memberships with a fixed query count', async () => {
  const f = fixture();
  try {
    licensed(f);
    for (let id=10; id<=114; id++) f.db.prepare('INSERT INTO users (id,email,name,role) VALUES (?,?,?,?)').run(id, `fixture-page-${id}@example.test`, `Fixture page ${id}`, 'founder');
    f.db.prepare('INSERT INTO founder_checkins (uid,founder_user_id,title,start_at) VALUES (?,?,?,?)').run('last-member',114,'Last member check-in',START);
    for (let i=0;i<500;i++) f.db.prepare('INSERT INTO founder_checkins (uid,founder_user_id,title,start_at) VALUES (?,?,?,?)').run(`bulk-${i}`,10+i%105,`Bulk check-in ${i}`,START);
    const before = f.readCount();
    const body = await service.fetchCalendarScope(f.env,{ id: 1,role: 'admin' } as any,'studio',FROM,TO);
    assert.equal(body.coverage.complete,true);
    assert.equal(body.events.length,501);
    assert.ok(body.events.some((e: any) => e.title==='Last member check-in'));
    assert.ok(f.readCount()-before <= 12, 'queries must not multiply with members');
  } finally { await f.close(); }
});


test('D1206: scoped event cards keep the item shape while removing source links, notes and copy actions', async () => {
  const f = fixture();
  try {
    licensed(f);
    f.db.prepare('INSERT INTO events (id,slug,host_user_id,title,summary,starts_at,ends_at,location_kind,location_url,visibility,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(77,'fixture-scope-event',2,'Fixture hosted event','Fixture private context',START,END,'virtual','https://meet.example.test/host-room','unlisted','published');
    const personal = await service.fetchUserEvents(f.env,2,'founder',FROM,TO,['event_hosted']);
    assert.equal(personal.length,1); assert.ok(personal[0].url); assert.ok(personal[0].notes);
    const response = await f.request(`/events?${window}&scope=studio&kinds=event_hosted`);
    const body = await response.json() as any;
    assert.equal(response.status,200); assert.equal(body.items.length,1);
    const item = body.items[0];
    assert.equal(item.family,'events'); assert.equal(item.all_day,false);
    assert.deepEqual(item.my_role,{ code: 'read_only', words: 'Read only' });
    assert.equal(item.href,null); assert.equal('url' in item,false); assert.equal(item.notes,null);
    assert.equal(item.organizer_email,null); assert.equal(item.location_uri,null);
    assert.ok(item.attendees.every((person: any) => person.email===null));
    assert.deepEqual(item.can,{ rsvp: false, reschedule: false, cancel: false, copy: false });
  } finally { await f.close(); }
});


test('D1206: private Calendly and wellbeing items stay personal and are never queried by either staff scope', async () => {
  const f = fixture();
  try {
    licensed(f);
    for (const source of ['calendly','axal']) f.db.prepare('INSERT INTO calendar_events (uid,user_id,source,kind,external_uri,title,start_at,end_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(`private-${source}`,2,source,'expert_booking',`fixture-${source}`,`Private ${source}`,START,END);
    const own = await service.fetchUserEvents(f.env,2,'founder',FROM,TO,['calendly_event','expert_booking']);
    assert.equal(own.length,2);
    for (const scope of ['studio','all']) {
      if (scope==='all') { delete f.env.BRANCH_CODE; f.env.APP_URL='https://axal.vc'; f.db.exec('INSERT INTO super_admins (user_id,granted_by_user_id) VALUES (1,1)'); }
      const before = f.statements().length;
      const response = await f.request(`/events?${window}&scope=${scope}`);
      const body = await response.json() as any;
      assert.equal(response.status,200); assert.deepEqual(body.items,[]);
      assert.deepEqual(body.excluded_kinds,['calendly_event','expert_booking']);
      assert.ok(body.sources.every((s: any) => !['calendly_event','expert_booking'].includes(s.kind)));
      assert.equal(f.statements().slice(before).some(sql => sql.includes('FROM calendar_events')),false);
    }
  } finally { await f.close(); }
});

test('D1206: set-based scope preserves every allowed source and filters private admin, inactive and revoked rows', async () => {
  const f = fixture();
  try {
    licensed(f); checkins(f);
    f.db.exec("UPDATE users SET founder_id=106 WHERE id=6; INSERT INTO projects (id,name,founder_id) VALUES (66,'Foreign venture',106); INSERT INTO advisors (id,uid,user_id,display_name) VALUES (30,'a30',3,'Fixture advisor'),(60,'a60',6,'Foreign advisor'); INSERT INTO partners (id,uid,name,email) VALUES (30,'p30','Fixture partner','partner@example.test'),(60,'p60','Foreign partner','foreign@example.test'); UPDATE users SET partner_id=30 WHERE id=4; UPDATE users SET partner_id=60 WHERE id=6;");
    for (const [id,owner] of [[30,2],[60,6]]) {
      f.db.prepare('INSERT INTO advisor_office_hour_slots (id,uid,advisor_id,starts_at,ends_at) VALUES (?,?,?,?,?)').run(id,`as-${id}`,id,START,END);
      f.db.prepare('INSERT INTO advisor_bookings (id,uid,slot_id,advisor_id,founder_user_id,topic) VALUES (?,?,?,?,?,?)').run(id,`ab-${id}`,id,id,owner,`${id===30?'Fixture':'Foreign'} topic`);
      f.db.prepare('INSERT INTO partner_office_hour_slots (id,uid,partner_id,starts_at,ends_at) VALUES (?,?,?,?,?)').run(id,`ps-${id}`,id,START,END);
      f.db.prepare('INSERT INTO partner_bookings (id,uid,slot_id,partner_id,founder_user_id,topic) VALUES (?,?,?,?,?,?)').run(id,`pb-${id}`,id,id,owner,`${id===30?'Fixture':'Foreign'} topic`);
    }
    f.db.exec("INSERT INTO advisor_bookings (id,uid,slot_id,advisor_id,founder_user_id,topic) VALUES (31,'ab-host-side',30,30,5,'Fixture host session'); INSERT INTO partner_bookings (id,uid,slot_id,partner_id,founder_user_id,topic) VALUES (31,'pb-host-side',30,30,5,'Fixture host office hours');");
    for (const [id,attendee] of [[70,2],[71,6],[72,2]]) {
      f.db.prepare('INSERT INTO ic_meetings (id,uid,title,start_at,organizer_user_id) VALUES (?,?,?,?,?)').run(id,`ic-${id}`,id===71?'Foreign IC':'Fixture shared IC',START,6);
      f.db.prepare('INSERT INTO ic_meeting_attendees (meeting_id,user_id) VALUES (?,?)').run(id,attendee);
    }
    f.db.exec("UPDATE ic_meetings SET status='cancelled',cancel_reason='capacity_race' WHERE id=72");
    for (const [id,owner,status] of [[30,2,'published'],[31,6,'published'],[32,6,'published'],[33,2,'cancelled'],[34,2,'draft']] as const) f.db.prepare('INSERT INTO events (id,slug,host_user_id,title,starts_at,ends_at,status,visibility) VALUES (?,?,?,?,?,?,?,?)').run(id,`event-${id}`,owner,id===31?'Foreign event':`Fixture event ${id}`,START,END,status,'unlisted');
    for (const [id,user,status] of [[40,2,'confirmed'],[41,5,'confirmed'],[42,3,'cancelled']] as const) f.db.prepare('INSERT INTO event_registrations (id,event_id,user_id,email,status) VALUES (?,?,?,?,?)').run(id,32,user,`fixture-${user}@example.test`,status);
    f.db.exec("INSERT INTO event_registrations (id,event_id,user_id,email,status) VALUES (43,30,2,'fixture-host@example.test','confirmed'),(44,32,4,'fixture-wait@example.test','waitlisted'); UPDATE event_registrations SET waitlist_position=7 WHERE id=44;");
    for (const [id,project] of [[30,20],[60,66]]) {
      f.db.prepare('INSERT INTO raise_prospects (id,uid,project_id,name,firm,stage) VALUES (?,?,?,?,?,?)').run(id,`prospect-${id}`,project,'Fixture prospect',id===30?'Fixture firm':'Foreign firm','meeting');
      f.db.prepare('INSERT INTO raise_prospect_events (id,prospect_id,kind,starts_at,calendar_item_uid,note) VALUES (?,?,?,?,?,?)').run(id,id,'meeting',START,`meeting-${id}`,'Private note must not be selected');
    }
    const before = f.readCount();
    const body = await service.fetchCalendarScope(f.env,{ id: 1,role: 'admin' } as any,'studio',FROM,TO);
    assert.equal(body.coverage.complete,true,JSON.stringify(body.sources));
    assert.deepEqual(new Set(body.events.map(e=>e.id)),new Set(['ic_meeting:70','ic_meeting:72','founder_checkin:11','founder_checkin:22','advisor_booking:30','advisor_booking:31','partner_office_hour:30','partner_office_hour:31','event_hosted:30','event_hosted:34','event_ticket:40','event_ticket:44','investor_meeting:30']));
    assert.ok(f.readCount()-before <= 12);
    assert.equal(JSON.stringify(body.events).includes('Foreign IC'),false);
    assert.equal(JSON.stringify(body.events).includes('Foreign topic'),false);
    assert.equal(JSON.stringify(body.events).includes('Foreign firm'),false);
    for (const event of body.events) {
      assert.equal(event.organizer_email,null); assert.equal(event.notes,null); assert.equal(event.location_uri,null);
      assert.ok(event.attendees.every(p=>p.email===null)); assert.equal(event.href,null);
      assert.deepEqual(event.can,{ rsvp:false,reschedule:false,cancel:false,copy:false });
    }
    assert.equal(body.events.find(e=>e.id==='ic_meeting:72')?.cancel_reason,'capacity_race','an IC free-text reason is not a booking code');
    const waitlisted = body.events.find(e=>e.id==='event_ticket:44')!;
    assert.equal(waitlisted.title,'Waitlist · #7: Fixture event 32'); assert.equal(waitlisted.status,'waitlisted');
    const investor = body.events.find(e=>e.id==='investor_meeting:30')!;
    assert.equal(investor.start_at,START); assert.equal(investor.end_at,START); assert.equal(investor.source_uid,'meeting-30');
    const queries = f.statements().slice(before);
    assert.equal(queries.some(sql => /\b(?:m\.agenda|c\.notes|ev\.note|u\.email|location_uri|location_url)\b/.test(sql)),false,'scoped reads must not fetch private content only to strip it');
    const expected = new Set<string>();
    const allowed = service.KNOWN_KINDS.filter(kind => !['calendly_event','expert_booking'].includes(kind));
    for (const member of f.db.prepare("SELECT id,role FROM users WHERE is_active=1 AND (role<>'admin' OR id=1)").all() as any[]) {
      const personal = await service.fetchUserEventsWithSources(f.env,member.id,member.role,FROM,TO,allowed,{ withCancelled:true });
      assert.ok(personal.sources.every(source=>source.ok));
      for (const item of personal.events) expected.add(item.id);
    }
    assert.deepEqual(new Set(body.events.map(e=>e.id)),expected,'set-based visibility must match the allowed union of unchanged personal readers');
  } finally { await f.close(); }
});


test('D1206: excluded Calendly read failures do not block eligible copies on either provider', async () => {
  const f = fixture(); const titles: string[] = [];
  globalThis.fetch = async (url: any,init: any) => {
    const u = new URL(String(url));
    assert.ok(['oauth2.googleapis.com','login.microsoftonline.com','www.googleapis.com','graph.microsoft.com'].includes(u.hostname));
    if (u.pathname.includes('token')) return Response.json({ access_token:'fixture-access' });
    const body=JSON.parse(init.body); titles.push(body.summary ?? body.subject); return Response.json({ id:'fixture-copied' });
  };
  try {
    f.db.prepare('INSERT INTO founder_checkins (uid,founder_user_id,title,start_at) VALUES (?,?,?,?)').run('copy-own',1,'Fixture eligible copy',START);
    f.breakSource("source = 'calendly'");
    for (const provider of ['Google','Microsoft'] as const) {
      const table=provider==='Google'?'google_oauth_tokens':'microsoft_oauth_tokens';
      f.db.prepare(`INSERT INTO ${table} (user_id,refresh_token) VALUES (1,?)`).run(await encryptString(f.env,'fixture-refresh'));
      const r=await service[`syncUserTo${provider}`](f.env,1,'admin',FROM,TO);
      assert.deepEqual([r.total,r.pushed,r.failed],[1,1,0]); assert.deepEqual(r.excluded_kinds,['calendly_event']);
    }
    assert.deepEqual(titles,['Fixture eligible copy','Fixture eligible copy']);
    assert.equal(f.statements().some(sql=>sql.includes("source = 'calendly'")),false);
  } finally { await f.close(); }
});

test('D1206: staff windows and per-source result caps are explicit; boundary windows remain readable', async () => {
  const f=fixture();
  try {
    licensed(f);
    const from=new Date('2026-01-01T00:00:00Z').toISOString();
    const boundary=new Date(Date.parse(from)+180*86400000).toISOString();
    assert.equal(service.validScopeWindow(from,boundary),true);
    assert.equal(service.validScopeWindow(from,new Date(Date.parse(boundary)+1).toISOString()),false);
    assert.equal(service.validScopeWindow(boundary,from),false);
    assert.equal(service.validScopeWindow('invalid',boundary),false);
    await assert.rejects(()=>service.fetchCalendarScope(f.env,{ id:1,role:'admin' } as any,'studio',boundary,from),{ message:'Invalid calendar scope window' });
    assert.equal((await f.request(`/events?scope=studio&from=${from}&to=${boundary}&kinds=founder_checkin`)).status,200);
    assert.equal((await f.request(`/events?scope=studio&from=${boundary}&to=${from}`)).status,400);
    for(let id=0;id<1001;id++) f.db.prepare('INSERT INTO founder_checkins (uid,founder_user_id,title,start_at) VALUES (?,?,?,?)').run(`limit-${id}`,2,`Fixture capped ${id}`,new Date(Date.parse(START)+(1001-id)*1000).toISOString());
    const result=await service.fetchCalendarScope(f.env,{ id:1,role:'admin' } as any,'studio',FROM,TO,['founder_checkin']);
    assert.equal(result.events.length,1000); assert.equal(result.coverage.complete,false);
    assert.equal(result.events[0].title,'Fixture capped 1000'); assert.equal(result.events.at(-1)?.title,'Fixture capped 1');
    assert.equal(result.events.some(item=>item.title==='Fixture capped 0'),false);
    assert.deepEqual(result.coverage.truncated_kinds,['founder_checkin']); assert.match(result.coverage.reason || '',/Narrow the date window/);
    assert.deepEqual(result.sources,[{ kind:'founder_checkin',ok:true,error:null }]);
  } finally { await f.close(); }
});
