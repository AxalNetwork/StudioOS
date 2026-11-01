/**
 * D1465 § Notifications (#4022, RR08; #3713 Q3 B): the founder is told, in the
 * app, on each reasoned read. Over the migrated schema and the four real
 * routes. Every person, venture and reason is made up.
 *
 *   · each of the four reads sends one notification per founder user, with
 *     the right words and link, and none to the admin;
 *   · a refused read sends none (403, 400, 409);
 *   · a failed notification leaves the read recorded;
 *   · the reason's words reach no log line;
 *   · a missing admin name reads "Not recorded".
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/reasoned_read_notice_4022.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import cycleRaise from '../src/routes/cycle_raise.ts';
import captableAccess from '../src/routes/captable_access.ts';
import dataRoom from '../src/routes/data_room.ts';
import { NOT_RECORDED, noticeOf, notifyReasonedRead, whenOf } from '../src/services/reasonedReadNotice.ts';

test.after(() => removeMigratedDatabases());

const SECRET = 'synthetic-reasoned-read-secret-'.repeat(2);
const ADMIN = 30, HQ = 31, NAMELESS = 32, FOUNDER = 110, COFOUNDER = 111, OTHER = 120, INVESTOR = 150;
const P = 1, UID = 'venture-one';
const REASON = 'Synthetic support ticket review';

function fixture({ secondFounder = false } = {}) {
  const db = migratedDatabase();
  const u = db.prepare("INSERT INTO users (id, uid, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, ?, 1, ?)");
  u.run(ADMIN, 'u-admin', 'admin', 'Ada Admin', 'ada@example.test', null);
  u.run(HQ, 'u-hq', 'admin', 'Hal Headquarters', 'hal@example.test', null);
  u.run(NAMELESS, 'u-nameless', 'admin', '', 'nameless@example.test', null); // name is NOT NULL: a blank one
  u.run(FOUNDER, 'u-founder', 'founder', 'Fay Founder', 'fay@example.test', 1001);
  if (secondFounder) u.run(COFOUNDER, 'u-cofounder', 'founder', 'Cal Cofounder', 'cal@example.test', 1001);
  u.run(OTHER, 'u-other', 'founder', 'Bo Other', 'bo@example.test', 1002);
  u.run(INVESTOR, 'u-investor', 'investor', 'Ivy Investor', 'ivy@example.test', 1001); // shares the founder id: still not a founder
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${HQ});
    INSERT INTO projects (id, uid, name, founder_id) VALUES (${P}, '${UID}', 'Kestrel Labs', 1001), (2, 'venture-two', 'Osprey Works', 1002);`);
  for (const id of [ADMIN, HQ, NAMELESS, FOUNDER, COFOUNDER, OTHER]) {
    try { db.prepare('INSERT INTO user_sessions (user_id, jti, factor, assurance_level) VALUES (?, ?, ?, ?)').run(id, `jti-${id}`, 'totp', 'totp'); } catch { /* unknown id */ }
  }
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>()
    .route('/api/cycles/raise', cycleRaise)
    .route('/api/captable/access', captableAccess)
    .route('/api/data-room', dataRoom);
  app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));
  const lines: string[] = [];
  async function call(who: number, method: string, path: string, body?: unknown) {
    const jwt = await new SignJWT({ user_id: who, jti: `jti-${who}` }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const saved = [console.log, console.warn, console.error];
    const keep = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
    console.log = keep; console.warn = keep; console.error = keep;
    try {
      const res = await app.request('https://axal.vc' + path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
      const text = await res.text();
      let json: any; try { json = JSON.parse(text); } catch { json = text; }
      return { status: res.status, body: json, text };
    } finally { [console.log, console.warn, console.error] = saved; }
  }
  const inbox = () => db.prepare("SELECT user_id, type, title, body, link FROM notifications_inbox WHERE type = 'reasoned_read' ORDER BY id").all().map((r: any) => ({ ...r }));
  const close = () => { const f = db.location(); db.close(); if (f) rmSync(f, { force: true }); };
  return { db, call, inbox, lines, close };
}

const READS = {
  narrative: { path: `/api/cycles/raise/narrative/reads?project=${P}`, body: { reason: REASON }, link: `/raise/investor-narrative?project_id=${P}`, opened: 'opened your Investor narrative', span: '8 h' },
  cap_table: { path: `/api/captable/access/${P}/support`, body: { reason: REASON }, link: `/raise/cap-table/access?project_id=${P}`, opened: 'opened your Cap table for support', span: 'one open' },
  data_room: { path: `/api/data-room/${UID}/support-read`, body: { reason: REASON }, link: `/raise/data-room?project_id=${P}`, opened: 'opened your Data room for support', span: 'one open' },
  capital_relationships: { path: `/api/cycles/raise/capital-relationships/support-read?project=${P}`, body: { reason: REASON }, link: `/raise/capital-relationships?project_id=${P}`, opened: 'read your Capital relationships', span: 'one open' },
} as const;

test('the words: name and kind, what was opened; reason, when and how long; a missing name is "Not recorded"', () => {
  const at = new Date(Date.UTC(2026, 10, 1, 18, 4));
  assert.equal(whenOf(at), '1 Nov 2026, 18:04 UTC');
  assert.deepEqual(noticeOf({ surface: 'narrative', adminName: 'Ada Admin', hq: false, reason: 'Why', at }),
    { title: 'Ada Admin · Studio admin opened your Investor narrative', body: 'Why · 1 Nov 2026, 18:04 UTC · 8 h' });
  assert.equal(noticeOf({ surface: 'narrative', adminName: 'Hal', hq: true, reason: 'Why', at }).title, 'Hal · HQ opened your Investor narrative');
  assert.equal(noticeOf({ surface: 'cap_table', adminName: '  ', hq: false, reason: 'Why', at }).title, `${NOT_RECORDED} · Studio admin opened your Cap table for support`);
  assert.equal(noticeOf({ surface: 'capital_relationships', adminName: null, hq: false, reason: 'Why', at }).body, `Why · ${whenOf(at)} · one open`);
});

for (const [surface, r] of Object.entries(READS)) {
  test(`${surface}: one in-app notification to the founder, with the words and the link; none to the admin; the reason in no log line`, async () => {
    const f = fixture();
    try {
      const res = await f.call(ADMIN, 'POST', r.path, r.body);
      assert.ok(res.status === 200 || res.status === 201, `${res.status} ${res.text.slice(0, 300)}`);
      const sent = f.inbox();
      assert.equal(sent.length, 1, JSON.stringify(sent));
      const [n] = sent;
      assert.equal(n.user_id, FOUNDER);
      assert.equal(n.title, `Ada Admin · Studio admin ${r.opened}`);
      assert.match(n.body, new RegExp(`^${REASON} · \\d{1,2} [A-Z][a-z]{2} \\d{4}, \\d{2}:\\d{2} UTC · ${r.span}$`));
      assert.equal(n.link, r.link);
      assert.ok(!f.lines.some((l) => l.includes(REASON)), `a log line carried the reason: ${f.lines.find((l) => l.includes(REASON))}`);
      // No email is ever queued.
      const outbox = f.db.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE type = 'reasoned_read'").get() as any;
      assert.equal(Number(outbox?.n ?? 0), 0);
    } finally { f.close(); }
  });

  test(`${surface}: a refused read sends nothing`, async () => {
    const f = fixture();
    try {
      const short = await f.call(ADMIN, 'POST', r.path, { reason: '' });
      assert.ok([400].includes(short.status), `${short.status} ${short.text.slice(0, 200)}`);
      const founder = await f.call(FOUNDER, 'POST', r.path, r.body);
      assert.ok([403, 404].includes(founder.status), `${founder.status} ${founder.text.slice(0, 200)}`);
      assert.deepEqual(f.inbox(), []);
    } finally { f.close(); }
  });
}

test('the narrative and the cap table tell every founder user; HQ is named as HQ; a nameless admin as "Not recorded"', async () => {
  const f = fixture({ secondFounder: true });
  try {
    assert.equal((await f.call(HQ, 'POST', READS.narrative.path, READS.narrative.body)).status, 201);
    assert.equal((await f.call(NAMELESS, 'POST', READS.cap_table.path, READS.cap_table.body)).status, 200);
    const sent = f.inbox();
    assert.deepEqual(sent.map((n: any) => [n.user_id, n.title]), [
      [FOUNDER, 'Hal Headquarters · HQ opened your Investor narrative'],
      [COFOUNDER, 'Hal Headquarters · HQ opened your Investor narrative'],
      [FOUNDER, `${NOT_RECORDED} · Studio admin opened your Cap table for support`],
      [COFOUNDER, `${NOT_RECORDED} · Studio admin opened your Cap table for support`],
    ]);
    assert.ok(!sent.some((n: any) => [ADMIN, HQ, NAMELESS].includes(n.user_id)), 'never to the admin');
    assert.ok(!sent.some((n: any) => n.user_id === INVESTOR), 'only founder users, not another role on the same founder id');
    // The data room and capital relationships refuse two owners (409): nothing is sent for them.
    assert.equal((await f.call(ADMIN, 'POST', READS.data_room.path, READS.data_room.body)).status, 409);
    assert.equal((await f.call(ADMIN, 'POST', READS.capital_relationships.path, READS.capital_relationships.body)).status, 409);
    assert.equal(f.inbox().length, 4);
  } finally { f.close(); }
});

test('a notification that fails leaves the read recorded, and the failure is logged by code', async () => {
  const f = fixture();
  try {
    f.db.exec('DROP TABLE notifications_inbox');
    f.db.exec('CREATE TABLE notifications_inbox (id INTEGER PRIMARY KEY, nope TEXT NOT NULL)');
    const res = await f.call(ADMIN, 'POST', READS.narrative.path, READS.narrative.body);
    assert.equal(res.status, 201, res.text);
    assert.equal(Number((f.db.prepare('SELECT COUNT(*) AS n FROM narrative_read_reasons').get() as any).n), 1, 'the read stands');
    const cap = await f.call(ADMIN, 'POST', READS.cap_table.path, READS.cap_table.body);
    assert.equal(cap.status, 200, cap.text);
    assert.ok(!f.lines.some((l) => l.includes(REASON)));
  } finally { f.close(); }
});

test('a failure inside the notice never throws: it returns 0 and logs a code, never the reason', async () => {
  const lines: string[] = [];
  const saved = console.error;
  console.error = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try {
    const env: any = { DB: { prepare: () => { throw new Error(`synthetic failure: ${REASON}`); } } };
    const sent = await notifyReasonedRead(env, { surface: 'narrative', projectId: P, admin: { id: ADMIN }, reason: REASON, link: '/x' });
    assert.equal(sent, 0);
  } finally { console.error = saved; }
  assert.deepEqual(lines, ['[reasoned-read] notify_failed narrative Error']);
});

