// #2395: the list projects only the caller's stored ticket; calendar stays gated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import events from '../src/routes/events.ts';

const SECRET = 'events-2395-synthetic-key-'.repeat(3);
function fixture(route = events) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['109_events_core.sql', '392_event_organiser.sql']) db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, uid TEXT, email TEXT, name TEXT, role TEXT, is_active INTEGER DEFAULT 1);
    INSERT INTO users VALUES (1,'host','host@example.test','Host','founder',1), (2,'a','a@example.test','A','founder',1), (3,'b','b@example.test','B','founder',1);
    INSERT INTO events (id,slug,host_user_id,title,starts_at,status,visibility,admin_published,audience_rules_json)
      VALUES (1,'fixture-talk',1,'Fixture talk','2099-01-01T12:00:00Z','published','public',1,'{"comp_investors":true}'),
             (2,'private-talk',1,'Private fixture','2099-02-01T12:00:00Z','draft','private',0,'{}');
    INSERT INTO event_agenda_items (id,event_id,title) VALUES (1,1,'Fixture agenda');
    INSERT INTO event_registrations (id,event_id,user_id,email,status,comp,payment_status,waitlist_position)
      VALUES (10,1,2,'a@example.test','confirmed',1,'none',NULL), (11,1,3,'b@example.test','confirmed',0,'paid',NULL);
    INSERT INTO event_checkins (event_id,registration_id,code) VALUES (1,10,'fixture-a-code'), (1,11,'fixture-b-code');`);
  const DB = { prepare(sql: string) { let args: any[] = []; const statement: any = {
    bind(...values: any[]) { args = values.map(v => v ?? null); return statement; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  }; return statement; } };
  const env: any = { DB, ENVIRONMENT: 'production', JWT_SECRET: SECRET };
  async function request(path: string, user: number | null = 2) {
    const token = user === null ? null : await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    // Anchors attach the same-origin session cookie rather than an auth header.
    return route.request(path, { headers: token ? { Cookie: `studioos_auth=${token}` } : {} }, env);
  }
  return { db, request };
}
async function ownTickets(route = events) {
  const f = fixture(route);
  try {
    const joinUrl = 'https://meet.example.test/own-ticket-room';
    f.db.prepare("UPDATE events SET location_kind='virtual',location_url=? WHERE id=1").run(joinUrl);
    for (const [user, code, comp] of [[2,'fixture-a-code',true],[3,'fixture-b-code',false]] as const) {
      const response = await f.request('/', user);
      assert.equal(response.status, 200);
      const body: any = await response.json();
      assert.equal(body.attending.length, 1);
      assert.equal(body.attending[0].location_url, joinUrl);
      assert.deepEqual([body.attending[0].status, body.attending[0].reg_status, body.attending[0].checkin_code, body.attending[0].comp], ['published','confirmed',code,comp]);
      assert.equal(JSON.stringify(body).includes(user === 2 ? 'fixture-b-code' : 'fixture-a-code'), false);
    }
    const host: any = await (await f.request('/', 1)).json();
    assert.equal(host.attending.length, 0);
    assert.equal(JSON.stringify(host).includes('fixture-a-code'), false);
    assert.equal((await f.request('/', null)).status, 401);
    // A cancelled seat can be registered again on the waitlist, retaining its
    // historical check-in row. Listing must mirror registration's no-code rule.
    f.db.exec("UPDATE event_registrations SET status='waitlisted' WHERE id=10");
    const waitlisted: any = await (await f.request('/')).json();
    assert.equal(waitlisted.attending[0]?.checkin_code, null);
    assert.equal(waitlisted.attending[0]?.location_url, null);
    f.db.exec("UPDATE event_registrations SET status='confirmed',payment_status='pending' WHERE id=10");
    const pending: any = await (await f.request('/')).json();
    assert.equal(pending.attending[0]?.checkin_code, null);
    assert.equal(pending.attending[0]?.location_url, null);
    f.db.exec("DELETE FROM event_checkins WHERE registration_id=10; UPDATE event_registrations SET status='waitlisted',waitlist_position=4,comp=0 WHERE id=10");
    const waiting: any = await (await f.request('/')).json();
    assert.equal(waiting.attending.length, 1);
    assert.deepEqual([waiting.attending[0].reg_status, waiting.attending[0].reg_waitlist_position, waiting.attending[0].checkin_code, waiting.attending[0].comp], ['waitlisted',4,null,false]);
    f.db.exec("UPDATE event_registrations SET status='cancelled' WHERE id=10");
    assert.deepEqual((await (await f.request('/')).json() as any).attending, []);
  } finally { f.db.close(); }
}
test('#2395: own code/comp, distinct registration status, null missing code, no other member codes', () => ownTickets());
async function calendar(route = events) {
  const f = fixture(route);
  try {
    const detail: any = await (await f.request('/1', 1)).json();
    assert.equal(detail.event.title, 'Fixture talk');
    assert.deepEqual(detail.event.audience_rules, { comp_investors: true });
    assert.equal(detail.agenda[0].title, 'Fixture agenda');
    const file = await f.request('/1/ics');
    assert.equal(file.status, 200);
    assert.match(file.headers.get('content-type')!, /^text\/calendar/);
    assert.match(await file.text(), /SUMMARY:Fixture talk/);
    assert.equal((await f.request('/1/ics', null)).status, 401);
    assert.equal((await f.request('/2/ics')).status, 403);
    assert.equal((await f.request('/2/ics', 1)).status, 200);
    assert.equal((await f.request('/999/ics')).status, 404);
  } finally { f.db.close(); }
}
test('#2395: editor envelope includes event/rules/agenda; numeric calendar uses cookie auth and denies private outsiders', () => calendar());

// Isolated mutation imports leave the checkout and normal module unchanged.
const url = new URL('../src/routes/events.ts', import.meta.url);
const original = readFileSync(url, 'utf8');
let serial = 0;
async function load(source: string) {
  const js = stripTypeScriptTypes(source).replace(/from ['"]([^'"]+)['"]/g, (_m, spec) => {
    const path = new URL(spec, url);
    const resolved = spec.startsWith('.') ? [path.href,path.href+'.ts',path.href+'.js'].find(p => statSync(new URL(p), { throwIfNoEntry: false })?.isFile()) : import.meta.resolve(spec);
    return `from '${resolved}'`;
  });
  return (await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64') + '#2395-' + serial++)).default;
}
test('#2395: list assertions reject projection and ownership mutations, then pass restored code', async () => {
  const mutants = [
    ['checkin_code: r.checkin_code ?? null', 'checkin_code: null'],
    ['r.payment_status AS reg_payment_status', 'NULL AS reg_payment_status'],
    ['comp: r.comp === 1', 'comp: false'],
    ['reg_waitlist_position: r.reg_waitlist_position ?? null', 'reg_waitlist_position: null'],
    ['reg_status: r.reg_status', 'reg_status: r.status'],
    ['WHERE r.user_id = ?', 'WHERE r.user_id != ?'],
    ['ch.registration_id = r.id', 'ch.registration_id != r.id'],
    ["AND r.status != 'waitlisted'", ''],
    ["AND r.payment_status != 'pending'", ''],
    ["'registered','confirmed','attended','waitlisted'", "'registered','confirmed','attended','cancelled'"],
  ];
  await ownTickets(await load(original));
  for (const [before, after] of mutants) {
    assert.ok(original.includes(before), before);
    await assert.rejects(() => load(original.replace(before, after)).then(ownTickets), { name: 'AssertionError' }, before);
    await ownTickets(await load(original));
  }
});

test('#2395: calendar checks reject missing file, session and privacy gates, then pass restored code', async () => {
  const start = original.indexOf("events.get('/:id/ics'");
  const head = original.slice(0, start), tail = original.slice(start);
  for (const [before, after] of [
    ['return new Response(ics, {', "return new Response('', {"],
    ['if (u instanceof Response) return u;', 'if (u instanceof Response) return c.json({}, 200);'],
    ['if (!(await canViewEvent(c.env, event, u)))', 'if (false)'],
    ['includePrivate: manage, includeJoinLink:', 'includePrivate: false, includeJoinLink:'],
  ]) {
    const inTail = tail.includes(before);
    assert.ok(inTail || head.includes(before), before);
    const mutant = inTail ? head + tail.replace(before, after) : head.replace(before, after) + tail;
    await calendar(await load(original));
    await assert.rejects(() => load(mutant).then(calendar), { name: 'AssertionError' }, before);
    await calendar(await load(original));
  }
});
