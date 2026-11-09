// #4570 slice 4 (S1 of #4554) — the calendar's record writes, on the real Worker.
//
// The eight signed-in calendar routes that name a record and change it, whose
// ownership check sits in the handler as a comparison the inventory's reader
// does not count as evidence. Asked through `worker.fetch` on the fully
// migrated schema, by every account that is not a party to the record:
//
//   POST   /api/calendar/ic-meetings/:id/rsvp       an attendee's own answer      (an invited attendee)
//   DELETE /api/calendar/ic-meetings/:id            cancel an IC meeting          (its organiser, or an admin)
//   PATCH  /api/calendar/ic-meetings/:id            reschedule one                (its organiser, or an admin)
//   DELETE /api/calendar/founder-checkins/:id       cancel a check-in             (its founder or counterpart, or an admin)
//   PATCH  /api/calendar/founder-checkins/:id       reschedule one                (the same)
//   PATCH  /api/calendar/events/:id                 edit a manual calendar row    (its owner, or an admin)
//   DELETE /api/calendar/events/:id                 delete one                    (the same)
//   POST   /api/calendar/push/:kind/:source_id      copy a session to the caller's Google or Outlook
//                                                   (only a session the caller's own calendar holds)
//
// A refusal names nothing of the record and changes nothing: the meeting, its
// attendees and RSVPs, the check-in, the manual row, every calendar copy
// mapping, the audit rows, and no call to Google (each party has a connected
// Google calendar holding a copy, so a cancel or move that got through would
// call it, and the outsiders have one too, so a push that got through would
// write a copy). No credentials and a disabled party get 401. These are the
// ledger's `verified` entries for these routes.
//
// Every one of the eight answers a non-party exactly as it answers an id that
// does not exist: the same status and the same body. The RSVP and the push did
// from the start; the six record writes do since the #4570 hardening fix. A
// caller who may see the record but not do this to it (an IC invitee asking to
// cancel or move it) still gets the distinct refusal: they know it exists.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/authz_calendar_writes_d4570.test.ts
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import worker from '../src/index.ts';
import { encryptString } from '../src/services/cryptoBox.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';

const SECRET = 'd4570-calendar-fixture-only-'.repeat(3); // A fixture signing key; never a service credential.

// The parties.
const ORGANISER = 1;    // an investor on the deal: organises the IC meeting
const FOUNDER = 2;      // the venture's founder: invited to the IC meeting; the check-in's founder; owns the manual row
const COUNTERPART = 3;  // the deal's lead partner: the check-in's counterpart
const ADMIN = 9;        // may cancel or move any IC meeting or check-in, and edit any manual row (D1207, Task #1)
// Everyone else.
const OTHER_FOUNDER = 4, OTHER_INVESTOR = 5, OTHER_PARTNER = 6, REVOKED_ADVISOR = 7, DISABLED = 8;
const OUTSIDERS = [OTHER_FOUNDER, OTHER_INVESTOR, OTHER_PARTNER, REVOKED_ADVISOR] as const;
const WHO: Record<number, string> = {
  [ORGANISER]: 'the organiser', [FOUNDER]: 'the founder', [COUNTERPART]: 'the counterpart', [ADMIN]: 'an admin',
  [OTHER_FOUNDER]: 'another venture\'s founder', [OTHER_INVESTOR]: 'another deal\'s investor',
  [OTHER_PARTNER]: 'an unrelated Operating Partner', [REVOKED_ADVISOR]: 'an advisor whose grant was revoked',
  [DISABLED]: 'a disabled party',
};

const IC = 11, CHECKIN = 21, CHECKIN_DISABLED = 22, ROW = 31, ROW_DISABLED = 32, MISSING = 999;
const LEAKS = ['Quokka', 'quokka', 'meet.example.test'];
const START = new Date(Date.now() + 7 * 86_400_000).toISOString();
const LATER = new Date(Date.now() + 14 * 86_400_000).toISOString();

let db: any, env: any;
const tokens: Record<number, string> = {};
const pending: Promise<unknown>[] = [];
const ctx: any = { waitUntil(p: Promise<unknown>) { pending.push(p); }, passThroughOnException() {} };
const outbound: string[] = [];
let realFetch: typeof fetch;

const jwt = (claims: Record<string, unknown>) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30m').sign(new TextEncoder().encode(SECRET));

async function call(method: string, path: string, who?: number, body?: unknown) {
  const read = method === 'GET';
  const res = await worker.fetch(new Request(`https://unit.test/api/calendar${path}`, {
    method, redirect: 'manual',
    headers: {
      ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}),
      ...(read ? {} : { 'content-type': 'application/json' }),
    },
    body: read ? undefined : JSON.stringify(body ?? {}),
  // A fresh limiter per request: this suite is about gates, and the limiter would otherwise answer 429 first.
  }), { ...env, RATE_LIMITS: memKV() }, ctx);
  // Every deferred calendar sync the handler started has finished before anything is compared.
  await Promise.all(pending.splice(0));
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, text, json };
}

/** Everything a refused write could have changed. */
const snapshot = () => JSON.stringify([
  db.prepare('SELECT * FROM ic_meetings ORDER BY id').all(),
  db.prepare('SELECT * FROM ic_meeting_attendees ORDER BY id').all(),
  db.prepare('SELECT * FROM founder_checkins ORDER BY id').all(),
  db.prepare('SELECT * FROM calendar_events ORDER BY id').all(),
  db.prepare('SELECT * FROM calendar_sync_records ORDER BY id').all(),
  db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get(),
  // The app-wide request log writes its own `http_*` row for every request, refused or not: not the route's write.
  db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action NOT LIKE 'http\\_%' ESCAPE '\\'").get(),
  db.prepare('SELECT COUNT(*) AS n FROM notifications').get(),
]);
const named = (text: string) => LEAKS.filter((l) => text.includes(l));

/** The eight writes, each with a body that would succeed for a party. */
const WRITES: Array<{ route: string; method: string; path: (id: number) => string; record: number; disabledRecord: number; body?: unknown }> = [
  { route: 'POST /api/calendar/ic-meetings/:id/rsvp', method: 'POST', path: (id) => `/ic-meetings/${id}/rsvp?rsvp=declined`, record: IC, disabledRecord: IC },
  { route: 'DELETE /api/calendar/ic-meetings/:id', method: 'DELETE', path: (id) => `/ic-meetings/${id}?reason=moved`, record: IC, disabledRecord: IC },
  { route: 'PATCH /api/calendar/ic-meetings/:id', method: 'PATCH', path: (id) => `/ic-meetings/${id}`, record: IC, disabledRecord: IC, body: { start_at: LATER, duration_min: 45 } },
  { route: 'DELETE /api/calendar/founder-checkins/:id', method: 'DELETE', path: (id) => `/founder-checkins/${id}`, record: CHECKIN, disabledRecord: CHECKIN_DISABLED },
  { route: 'PATCH /api/calendar/founder-checkins/:id', method: 'PATCH', path: (id) => `/founder-checkins/${id}`, record: CHECKIN, disabledRecord: CHECKIN_DISABLED, body: { start_at: LATER } },
  { route: 'PATCH /api/calendar/events/:id', method: 'PATCH', path: (id) => `/events/${id}`, record: ROW, disabledRecord: ROW_DISABLED, body: { title: 'Overwritten', status: 'cancelled' } },
  { route: 'DELETE /api/calendar/events/:id', method: 'DELETE', path: (id) => `/events/${id}`, record: ROW, disabledRecord: ROW_DISABLED },
  { route: 'POST /api/calendar/push/:kind/:source_id', method: 'POST', path: (id) => `/push/ic_meeting/${id}`, record: IC, disabledRecord: IC },
];

before(async () => {
  db = migratedDatabase();
  db.exec(`INSERT INTO users (id, uid, name, email, role, founder_id, is_active, subscription_tier, subscription_status, investor_tier) VALUES
    (${ORGANISER},'u-org','Quokka Organiser','org@example.test','investor',NULL,1,'studio','active','professional'),
    (${FOUNDER},'u-fdr','Quokka Founder','founder@example.test','founder',102,1,'studio','active','free'),
    (${COUNTERPART},'u-cp','Quokka Lead','lead@example.test','partner',NULL,1,'studio','active','free'),
    (${OTHER_FOUNDER},'u-of','Other Founder','of@example.test','founder',103,1,'studio','active','free'),
    (${OTHER_INVESTOR},'u-oi','Other Investor','oi@example.test','investor',NULL,1,'studio','active','professional'),
    (${OTHER_PARTNER},'u-op','Other Partner','op@example.test','partner',NULL,1,'studio','active','free'),
    (${REVOKED_ADVISOR},'u-ra','Revoked Advisor','ra@example.test','advisor',NULL,1,'studio','active','free'),
    (${DISABLED},'u-dis','Disabled Party','dis@example.test','investor',NULL,1,'studio','active','professional'),
    (${ADMIN},'u-adm','Admin','admin@example.test','admin',NULL,1,'studio','active','free');
    INSERT INTO projects (id, uid, name, founder_id) VALUES (20,'p-quokka','Quokka Venture',102), (30,'p-else','Elsewhere',103);
    INSERT INTO deals (id, project_id, lead_partner_id) VALUES (200,20,${COUNTERPART}), (300,30,NULL);
    INSERT INTO deal_invitations (deal_id, investor_user_id, status) VALUES (200,${ORGANISER},'interested'), (300,${OTHER_INVESTOR},'interested'), (200,${DISABLED},'interested');
    INSERT INTO advisor_client_grants (uid, project_id, advisor_user_id, granted_by_user_id, scope_sessions, status)
      VALUES ('grant-revoked',20,${REVOKED_ADVISOR},${FOUNDER},1,'revoked');
    INSERT INTO ic_meetings (id, uid, title, agenda, start_at, duration_min, deal_id, organizer_user_id, location_kind, location_uri)
      VALUES (${IC},'ic-quokka','Quokka IC review','Quokka agenda','${START}',60,200,${ORGANISER},'video','https://meet.example.test/quokka');
    INSERT INTO ic_meeting_attendees (meeting_id, user_id, rsvp) VALUES (${IC},${ORGANISER},'accepted'), (${IC},${FOUNDER},'invited'), (${IC},${DISABLED},'invited');
    INSERT INTO founder_checkins (id, uid, founder_user_id, counterpart_user_id, project_id, title, notes, start_at, duration_min)
      VALUES (${CHECKIN},'ck-quokka',${FOUNDER},${COUNTERPART},20,'Quokka check-in','Quokka notes','${START}',30),
             (${CHECKIN_DISABLED},'ck-quokka-2',${FOUNDER},${DISABLED},20,'Quokka second check-in',NULL,'${START}',30);
    INSERT INTO calendar_events (id, uid, user_id, source, kind, external_uri, title, start_at, end_at, notes) VALUES
      (${ROW},'axal:manual:quokka',${FOUNDER},'manual','other','axal:manual:quokka','Quokka manual event','${START}','${START}','Quokka private'),
      (${ROW_DISABLED},'axal:manual:quokka-2',${DISABLED},'manual','other','axal:manual:quokka-2','Quokka disabled row','${START}','${START}',NULL);`);
  env = {
    DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development', RATE_LIMITS: memKV(), TOKENS: memKV(),
    APP_URL: 'https://unit.test',
    // Fixture identifiers so the Google sync paths run; every outbound call is answered below, never sent.
    GOOGLE_CAL_CLIENT_ID: 'fixture-client', GOOGLE_CAL_CLIENT_SECRET: 'fixture-only',
  };
  for (const id of [ORGANISER, FOUNDER, COUNTERPART, ADMIN, DISABLED, ...OUTSIDERS]) tokens[id] = await jwt({ user_id: id });

  // Every party and every outsider has a connected Google calendar; each party's holds its copies.
  for (const id of [ORGANISER, FOUNDER, COUNTERPART, DISABLED, ...OUTSIDERS]) {
    db.prepare('INSERT INTO google_oauth_tokens (user_id, refresh_token, scope) VALUES (?, ?, ?)')
      .run(id, await encryptString(env, 'fixture-refresh'), 'https://www.googleapis.com/auth/calendar.events');
  }
  for (const [user, kind, source] of [[ORGANISER, 'ic_meeting', IC], [FOUNDER, 'ic_meeting', IC], [FOUNDER, 'founder_checkin', CHECKIN],
    [COUNTERPART, 'founder_checkin', CHECKIN], [DISABLED, 'ic_meeting', IC], [DISABLED, 'founder_checkin', CHECKIN_DISABLED]] as const) {
    db.prepare("INSERT INTO calendar_sync_records (user_id, provider, source_kind, source_id, external_event_id) VALUES (?, 'google', ?, ?, ?)")
      .run(user, kind, source, `copy-${user}-${kind}-${source}`);
  }
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(DISABLED);

  realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    outbound.push(String(url));
    if (String(url).includes('/token')) return Response.json({ access_token: 'fixture-access', expires_in: 3600 });
    return Response.json({ id: `fixture-copy-${outbound.length}` });
  }) as typeof fetch;
});
after(() => { if (realFetch) globalThis.fetch = realFetch; db?.close(); removeMigratedDatabases(); });

test('the fixture: the parties see the meeting and the check-in, the non-parties see neither', async () => {
  // Read-only probes: the organiser and the founder see the meeting and the check-in on their own lists.
  const ic = await call('GET', '/ic-meetings', FOUNDER);
  assert.equal(ic.status, 200, ic.text);
  assert.deepEqual(ic.json.items.map((m: any) => m.id), [IC]);
  const ck = await call('GET', '/founder-checkins', COUNTERPART);
  assert.deepEqual(ck.json.items.map((m: any) => m.id), [CHECKIN]);
  for (const id of OUTSIDERS) {
    assert.deepEqual((await call('GET', '/ic-meetings', id)).json.items, [], `${WHO[id]} lists no meeting`);
    assert.deepEqual((await call('GET', '/founder-checkins', id)).json.items, [], `${WHO[id]} lists no check-in`);
  }
  assert.equal(outbound.length, 0);
});

test('no credentials: every write is refused 401, names nothing and changes nothing', async () => {
  const before = snapshot();
  for (const w of WRITES) {
    const r = await call(w.method, w.path(w.record), undefined, w.body);
    // Mutation checked: the manual row delete's requireAuth replaced by a fixed caller → it deletes the row and this fails.
    assert.equal(r.status, 401, `${w.route}: ${r.text}`);
    assert.deepEqual(named(r.text), [], `${w.route}: the refusal names nothing`);
  }
  assert.equal(snapshot(), before);
  assert.equal(outbound.length, 0, 'nothing reached Google');
});

test('a disabled party (attendee, counterpart, owner): every write to their own record is refused 401 and changes nothing', async () => {
  const before = snapshot();
  for (const w of WRITES) {
    const r = await call(w.method, w.path(w.disabledRecord), DISABLED, w.body);
    // Mutation checked: getCurrentUser's `is_active` refusal removed → the disabled party's writes land and this fails.
    assert.equal(r.status, 401, `${w.route}: ${r.text}`);
    assert.deepEqual(named(r.text), [], `${w.route}: the refusal names nothing`);
  }
  assert.equal(snapshot(), before);
  assert.equal(outbound.length, 0, 'nothing reached Google');
});

test('every account that is not a party: refused, nothing of the record named, nothing written, nothing sent', async () => {
  const before = snapshot();
  const answers: Record<string, Set<string>> = {};
  for (const w of WRITES) {
    for (const id of OUTSIDERS) {
      const r = await call(w.method, w.path(w.record), id, w.body);
      // Mutation checked, one at a time: each handler's party test removed or widened, and the push's readers unbound from the caller.
      assert.equal(r.status, 404, `${w.route} as ${WHO[id]}: ${r.status} ${r.text}`);
      assert.deepEqual(named(r.text), [], `${w.route} as ${WHO[id]}: the refusal names nothing of the record`);
      (answers[w.route] ??= new Set()).add(`${r.status} ${r.text}`);
    }
    // One answer per route, whoever asks: a refusal says nothing about who the asker is or how near they are.
    assert.equal(answers[w.route].size, 1, `${w.route}: ${[...answers[w.route]].join(' | ')}`);
  }
  assert.equal(snapshot(), before, 'no meeting, RSVP, check-in, manual row, copy mapping, audit row or notification changed');
  assert.equal(outbound.length, 0, 'nothing reached Google: no copy cancelled, moved or written');
});

test('wrong role on the record: an IC attendee may answer but not cancel or move; a check-in party is a stranger to the other\'s manual row', async () => {
  const before = snapshot();
  // Mutation checked: the IC cancel's and reschedule's organiser test removed → the invited founder cancels or moves it.
  for (const [method, path, body] of [['DELETE', `/ic-meetings/${IC}`, undefined], ['PATCH', `/ic-meetings/${IC}`, { start_at: LATER }]] as const) {
    const r = await call(method, path, FOUNDER, body);
    assert.equal(r.status, 403, `${method} ${path} as the invited founder: ${r.text}`);
    assert.deepEqual(named(r.text), []);
  }
  // The counterpart shares the check-in with the founder, not the founder's manual row: no party to it, so not found.
  // Mutation checked: the manual row's `row.user_id !== user.id` test removed → the counterpart edits or deletes it.
  for (const [method, body] of [['PATCH', { title: 'Overwritten' }], ['DELETE', undefined]] as const) {
    const r = await call(method, `/events/${ROW}`, COUNTERPART, body);
    assert.equal(r.status, 404, `${method} /events/${ROW} as the counterpart: ${r.text}`);
  }
  // The counterpart is not invited to the IC meeting: no RSVP, no push.
  assert.equal((await call('POST', `/ic-meetings/${IC}/rsvp?rsvp=accepted`, COUNTERPART)).status, 404);
  assert.equal((await call('POST', `/push/ic_meeting/${IC}`, COUNTERPART)).status, 404);
  // The organiser is not on the check-in.
  assert.equal((await call('POST', `/push/founder_checkin/${CHECKIN}`, ORGANISER)).status, 404);
  assert.equal((await call('DELETE', `/founder-checkins/${CHECKIN}`, ORGANISER)).status, 404);
  assert.equal(snapshot(), before);
  assert.equal(outbound.length, 0);
});

test('the RSVP and the push answer a non-party exactly as they answer a record that does not exist', async () => {
  const before = snapshot();
  const asks: Array<[string, (n: number) => string, number]> = [
    ['rsvp', (n) => `/ic-meetings/${n}/rsvp?rsvp=accepted`, IC],
    ['push an IC meeting', (n) => `/push/ic_meeting/${n}`, IC],
    ['push a check-in', (n) => `/push/founder_checkin/${n}`, CHECKIN],
  ];
  for (const id of OUTSIDERS) {
    for (const [label, path, record] of asks) {
      const real = await call('POST', path(record), id);
      const none = await call('POST', path(MISSING), id);
      assert.equal(real.status, 404, `${label} as ${WHO[id]}: ${real.text}`);
      assert.deepEqual([real.status, real.text], [none.status, none.text], `${label} as ${WHO[id]}: no existence leak`);
    }
  }
  assert.equal(snapshot(), before);
  assert.equal(outbound.length, 0);
});

test('the six record writes answer a non-party exactly as they answer a record that does not exist', async () => {
  const before = snapshot();
  const records = WRITES.filter((w) => !w.route.includes('/rsvp') && !w.route.includes('/push/'));
  assert.equal(records.length, 6);
  for (const w of records) {
    for (const id of OUTSIDERS) {
      const real = await call(w.method, w.path(w.record), id, w.body);
      const none = await call(w.method, w.path(MISSING), id, w.body);
      // Mutation checked, one route at a time: the old 403 for an existing record restored → this fails.
      assert.equal(real.status, 404, `${w.route} as ${WHO[id]}: ${real.text}`);
      assert.deepEqual([real.status, real.text], [none.status, none.text], `${w.route} as ${WHO[id]}: no existence leak`);
    }
  }
  // Someone on one record is a stranger to the other: the same answer as a missing id.
  for (const [who, method, path, body] of [
    [ORGANISER, 'DELETE', `/founder-checkins/%`, undefined], [ORGANISER, 'PATCH', `/founder-checkins/%`, { start_at: LATER }],
    [COUNTERPART, 'DELETE', `/ic-meetings/%`, undefined], [COUNTERPART, 'PATCH', `/ic-meetings/%`, { start_at: LATER }],
    [COUNTERPART, 'PATCH', `/events/%`, { title: 'Overwritten' }], [COUNTERPART, 'DELETE', `/events/%`, undefined],
  ] as const) {
    const record = path.startsWith('/founder') ? CHECKIN : path.startsWith('/ic') ? IC : ROW;
    const real = await call(method, path.replace('%', String(record)), who, body);
    const none = await call(method, path.replace('%', String(MISSING)), who, body);
    assert.deepEqual([real.status, real.text], [none.status, none.text], `${method} ${path} as ${WHO[who]}`);
  }
  // An invitee sees the meeting on their list, so their refusal to cancel or move it is still its own.
  const invitee = await call('DELETE', `/ic-meetings/${IC}`, FOUNDER);
  assert.equal(invitee.status, 403, invitee.text);
  assert.notEqual(invitee.text, (await call('DELETE', `/ic-meetings/${MISSING}`, FOUNDER)).text);
  assert.equal(snapshot(), before);
  assert.equal(outbound.length, 0);
});

test('the parties succeed, so the refusals above are the gates (run last: these write)', async () => {
  outbound.length = 0;
  // The invited founder answers; the organiser pushes their own copy.
  assert.equal((await call('POST', `/ic-meetings/${IC}/rsvp?rsvp=tentative`, FOUNDER)).status, 200);
  assert.equal((db.prepare('SELECT rsvp FROM ic_meeting_attendees WHERE meeting_id = ? AND user_id = ?').get(IC, FOUNDER) as any).rsvp, 'tentative');
  const push = await call('POST', `/push/ic_meeting/${IC}`, ORGANISER);
  assert.equal(push.status, 200, push.text);
  // The counterpart moves the check-in; the owner edits the manual row; an admin moves and cancels the IC meeting.
  assert.equal((await call('PATCH', `/founder-checkins/${CHECKIN}`, COUNTERPART, { start_at: LATER })).status, 200);
  assert.equal((await call('PATCH', `/events/${ROW}`, FOUNDER, { title: 'Renamed' })).status, 200);
  assert.equal((await call('PATCH', `/ic-meetings/${IC}`, ORGANISER, { start_at: LATER })).status, 200);
  assert.equal((await call('DELETE', `/ic-meetings/${IC}`, ADMIN)).status, 200);
  assert.equal((db.prepare('SELECT status FROM ic_meetings WHERE id = ?').get(IC) as any).status, 'cancelled');
  assert.equal((await call('DELETE', `/founder-checkins/${CHECKIN}`, FOUNDER)).status, 200);
  assert.equal((await call('DELETE', `/events/${ROW}`, FOUNDER)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM calendar_events WHERE id = ?').get(ROW).n, 0);
  assert.ok(outbound.length > 0, 'the fixture: a party\'s cancel and move do reach Google, so "nothing reached Google" above is meaningful');
});
