/**
 * D1336 (#3541) — Product testing member flow part 1, the Worker: the member's
 * own place in the tester pool, programmes for active testers only, what My
 * applications says about each row, and the programme-closed notice. On the
 * SQLite D1 harness with migrations 516 and 576 as they ship.
 *
 *   1. An Admin or Super Admin is refused every pool route, and nothing is written.
 *   2. A member joins once, with consent stored with its version; a second join,
 *      or one without the current consent, is refused. No reply carries an email.
 *   3. A declined member is refused before `reapply_after` and accepted after.
 *   4. Leaving writes one event, keeps a picked place, and a member who left may
 *      join again; one HQ removed may not.
 *   5. Anyone not active reads no programmes and cannot apply; the summary
 *      counts nothing for them.
 *   6. My applications: `withdrawn_by`, `finished` and `decides_by`.
 *   7. Closing a programme tells each picked tester, linking Inbox.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/tester_pool_d1336.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { testing, partnerTesting, adminTesting } from '../src/routes/testing.ts';
import { LEFT_REASON, POOL_CONSENT_VERSION, joinCheck } from '../src/services/testerPool.ts';
import { reapplyAfter } from '../src/services/productTesters.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SQL = resolve(process.cwd(), 'cloudflare-worker/sql');
const BASELINE = readFileSync(`${SQL}/schema_baseline.sql`, 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

const HQ = 1, ADMIN = 2, ACME = 10, ACME_2 = 11, GLOBEX = 12, FRAN = 20, FINN = 21, IVY = 22, FAY = 23;
const ACME_FIRM = 1, GLOBEX_FIRM = 2;

function coerce(a: any[]) { return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v)); }
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const stmt = (sql: string) => {
    let b: any[] = [];
    const api: any = {
      bind: (...x: any[]) => { b = coerce(x); return api; },
      async first() { return db.prepare(sql).get(...b) ?? null; },
      async all() { return { results: db.prepare(sql).all(...b) }; },
      async run() { return api.runSync(); },
      runSync() {
        const r = db.prepare(sql).run(...b);
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
    };
    return api;
  };
  return {
    prepare: stmt,
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    // As D1: one transaction, in order, all or nothing.
    async batch(xs: any[]) {
      db.exec('BEGIN');
      try { const out = xs.map((x) => x.runSync()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'partners', 'notifications_inbox', 'insight_subscriptions']) db.exec(ddl(t));
  // APPLIED, NOT MIRRORED: 515 and 517 are the tables D811's tester rule reads
  // (suppressions, unsubscribes, `mail_enabled`), so the email rule is tested
  // against the schema as it ships.
  db.exec(readFileSync(`${SQL}/migrations/515_newsletter_lists.sql`, 'utf8'));
  db.exec(readFileSync(`${SQL}/migrations/516_product_testing.sql`, 'utf8'));
  db.exec(readFileSync(`${SQL}/migrations/517_mail_link.sql`, 'utf8'));
  const u = db.prepare('INSERT INTO users (id, email, name, role, partner_id) VALUES (?, ?, ?, ?, ?)');
  for (const [id, role, name, firm] of [
    [HQ, 'admin', 'Hana Q', null], [ADMIN, 'admin', 'Plain Admin', null],
    [ACME, 'partner', 'Ada Acme', ACME_FIRM], [ACME_2, 'partner', 'Abe Acme', ACME_FIRM], [GLOBEX, 'partner', 'Gus Globex', GLOBEX_FIRM],
    [FRAN, 'founder', 'Fran Ruiz', null], [FINN, 'founder', 'Finn Oak', null], [IVY, 'investor', 'Ivy Lee', null], [FAY, 'founder', 'Fay Wu', null],
  ] as const) u.run(id, `u${id}@example.test`, name, role, firm);
  db.exec(`INSERT INTO partners (id, uid, name, company, email) VALUES (${ACME_FIRM}, 'p1', 'Ada Acme', 'Acme Labs', 'acme@example.test'),
    (${GLOBEX_FIRM}, 'p2', 'Gus Globex', 'Globex', 'globex@example.test');
    INSERT INTO super_admins (user_id) VALUES (${HQ});`);
  const app = new Hono();
  app.route('/api/testing', testing);
  app.route('/api/partner/testing', partnerTesting);
  app.route('/api/admin/testing', adminTesting);
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any;
  db.exec(readFileSync(`${SQL}/migrations/576_product_testers.sql`, 'utf8'));
  return { db, app, env };
}

const ROLE: Record<number, string> = { [HQ]: 'admin', [ADMIN]: 'admin', [ACME]: 'partner', [ACME_2]: 'partner', [GLOBEX]: 'partner', [IVY]: 'investor' };
async function call(w: any, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who, role: ROLE[who] ?? 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; (init as any).body = JSON.stringify(body); }
  const res = await w.app.request(`/api${path}`, init, w.env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const PROGRAMME = {
  product_name: 'Ledger beta', summary: 'A new close process', tester_tasks: 'Run one month-end close',
  time_needed: '2 hours a week', places: 2, eligible_roles: ['founder', 'investor'], questions: ['What do you use today?'],
};

const tester = (w: any, user: number) => w.db.prepare('SELECT * FROM product_testers WHERE user_id = ?').get(user) as any;
const poolEvents = (w: any, user: number) => (w.db.prepare('SELECT action, from_status, to_status, actor_user_id, reason FROM product_tester_events WHERE user_id = ? ORDER BY id').all(user) as any[]).map((r) => ({ ...r }));
const setTester = (w: any, user: number, status: string, decidedAt: string | null = '2026-10-01 00:00:00', decidedBy: number | null = HQ) =>
  w.db.prepare(`INSERT INTO product_testers (user_id, status, decided_at, decided_by) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET status = excluded.status, decided_at = excluded.decided_at, decided_by = excluded.decided_by`)
    .run(user, status, status === 'applied' ? null : decidedAt, status === 'applied' ? null : decidedBy);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().replace('T', ' ').slice(0, 19);
const noEmail = (body: unknown) => assert.doesNotMatch(JSON.stringify(body), /@example\.test/, 'no email in the reply');
const join = (w: any, who: number, extra: Record<string, unknown> = {}) =>
  call(w, who, 'POST', '/testing/tester/apply', { consent_version: POOL_CONSENT_VERSION, availability: '3 hours a week', ...extra });

async function openPartnerProgramme(w: any, extra: Record<string, unknown> = {}) {
  const uid = (await call(w, ACME, 'POST', '/partner/testing/programmes', { ...PROGRAMME, ...extra })).body.programme.uid;
  assert.equal((await call(w, ACME, 'POST', `/partner/testing/programmes/${uid}/submit`)).status, 200);
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/approve`, {})).status, 200);
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/open`)).status, 200);
  return uid;
}
const applyAs = (w: any, who: number, uid: string) =>
  call(w, who, 'POST', `/testing/programmes/${uid}/apply`, { answers: ['Spreadsheets'], availability: 'Evenings', consent_email: true });

test('an Admin or the Super Admin is refused every pool route, and nothing is written', async () => {
  const w = world();
  for (const who of [HQ, ADMIN]) {
    for (const [method, path, body] of [['GET', '/testing/tester'], ['POST', '/testing/tester/apply', { consent_version: POOL_CONSENT_VERSION }], ['POST', '/testing/tester/leave']] as const) {
      const r = await call(w, who, method, path, body);
      assert.deepEqual([r.status, r.body.error], [403, 'admin_account'], `${who} ${path}`);
    }
  }
  assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM product_testers').get() as any).n, 0);
});

test('a member joins once, with consent stored with its version; a second join is refused; no reply carries an email', async () => {
  const w = world();
  const before = await call(w, FRAN, 'GET', '/testing/tester');
  assert.equal(before.status, 200);
  assert.deepEqual([before.body.tester, before.body.can_apply, before.body.consent.version], [{ status: null }, true, POOL_CONSENT_VERSION]);
  assert.match(before.body.consent.text, /leave the tester pool, at any time/);
  // Mutation checked: accept a join with no consent → a row with no consent.
  for (const bad of [{}, { consent_version: 'd812-1' }, { consent_version: true }]) {
    const r = await call(w, FRAN, 'POST', '/testing/tester/apply', bad);
    assert.deepEqual([r.status, r.body.error], [400, 'consent_required'], JSON.stringify(bad));
  }
  assert.equal(tester(w, FRAN), undefined, 'a refused join writes nothing');
  const joined = await join(w, FRAN);
  assert.equal(joined.status, 201);
  assert.equal(joined.body.tester.status, 'applied');
  assert.equal(joined.body.tester.consent_current, true);
  noEmail(joined.body);
  const row = tester(w, FRAN);
  assert.deepEqual([row.status, row.consent_version, row.availability, Boolean(row.consent_email_at)], ['applied', POOL_CONSENT_VERSION, '3 hours a week', true]);
  assert.deepEqual(poolEvents(w, FRAN), [{ action: 'applied', from_status: null, to_status: 'applied', actor_user_id: FRAN, reason: null }]);
  // Mutation checked: drop the applied check → a second row's worth of history.
  const again = await join(w, FRAN);
  assert.deepEqual([again.status, again.body.error], [409, 'already_applied']);
  for (const status of ['active', 'paused']) {
    setTester(w, FRAN, status);
    assert.deepEqual([(await join(w, FRAN)).status, (await call(w, FRAN, 'GET', '/testing/tester')).body.can_apply], [409, false], status);
  }
  assert.equal(poolEvents(w, FRAN).length, 1, 'a refused join writes no event');
  noEmail((await call(w, FRAN, 'GET', '/testing/tester')).body);
});

test('a declined member is refused before reapply_after and accepted after', async () => {
  const w = world();
  const recent = daysAgo(30);
  setTester(w, FINN, 'declined', recent);
  w.db.prepare("UPDATE product_testers SET reason = 'Not enough availability this quarter.' WHERE user_id = ?").run(FINN);
  const read = await call(w, FINN, 'GET', '/testing/tester');
  assert.deepEqual([read.body.tester.status, read.body.tester.reason, read.body.tester.reapply_after, read.body.can_apply],
    ['declined', 'Not enough availability this quarter.', reapplyAfter(recent), false]);
  assert.equal(read.body.cannot_apply.code, 'reapply_later');
  // Mutation checked: drop the date check → a declined member rejoins at once.
  const early = await join(w, FINN);
  assert.deepEqual([early.status, early.body.error], [409, 'reapply_later']);
  assert.match(early.body.detail ?? early.body.message ?? JSON.stringify(early.body), new RegExp(reapplyAfter(recent)));
  w.db.prepare('UPDATE product_testers SET decided_at = ? WHERE user_id = ?').run(daysAgo(91), FINN);
  const later = await join(w, FINN);
  assert.equal(later.status, 201);
  const row = tester(w, FINN);
  assert.deepEqual([row.status, row.decided_at, row.decided_by, row.reason, row.consent_version], ['applied', null, null, null, POOL_CONSENT_VERSION]);
  assert.deepEqual(poolEvents(w, FINN).map((e) => [e.action, e.from_status, e.actor_user_id]), [['applied', 'declined', FINN]]);
  // The boundary itself: reapply_after is the first day a join is taken.
  const decided = '2026-01-01 10:00:00';
  const row2 = { id: 1, user_id: 9, status: 'declined', applied_at: '', decided_at: decided, decided_by: 1, reason: null, availability: null, consent_email_at: null, consent_version: null } as any;
  assert.equal(joinCheck(row2, '2026-03-31').can, false);
  assert.equal(joinCheck(row2, reapplyAfter(decided)).can, true);
});

test('leaving writes one event and keeps a picked place; a member who left may join again, one HQ removed may not', async () => {
  const w = world();
  setTester(w, FAY, 'active');
  const uid = await openPartnerProgramme(w);
  const app = (await applyAs(w, FAY, uid)).body.application.uid;
  assert.equal((await call(w, ACME, 'POST', `/partner/testing/applications/${app}/pick`)).status, 200);
  const left = await call(w, FAY, 'POST', '/testing/tester/leave');
  assert.equal(left.status, 200);
  assert.deepEqual([left.body.tester.status, left.body.tester.reason, left.body.tester.left_by_member, left.body.can_apply], ['removed', LEFT_REASON, true, true]);
  noEmail(left.body);
  const row = tester(w, FAY);
  assert.deepEqual([row.status, row.reason, row.decided_by], ['removed', LEFT_REASON, FAY]);
  // Mutation checked: drop the event insert → leaving leaves no history.
  assert.deepEqual(poolEvents(w, FAY), [{ action: 'removed', from_status: 'active', to_status: 'removed', actor_user_id: FAY, reason: LEFT_REASON }]);
  assert.equal((w.db.prepare('SELECT status FROM testing_applications WHERE uid = ?').get(app) as any).status, 'picked', 'a picked place carries on (D1335 §3)');
  const twice = await call(w, FAY, 'POST', '/testing/tester/leave');
  assert.deepEqual([twice.status, twice.body.error], [409, 'not_in_pool']);
  assert.equal(poolEvents(w, FAY).length, 1);
  assert.equal((await join(w, FAY)).status, 201, 'a member who left may join again');
  // Never in the pool: nothing to leave.
  assert.deepEqual([(await call(w, IVY, 'POST', '/testing/tester/leave')).status], [409]);
  // HQ removed: the member cannot rejoin by themselves (the canvas's Removed card points to Support).
  setTester(w, FINN, 'removed', daysAgo(1), HQ);
  const removed = await call(w, FINN, 'GET', '/testing/tester');
  assert.deepEqual([removed.body.can_apply, removed.body.cannot_apply.code, removed.body.tester.left_by_member], [false, 'removed_by_hq', false]);
  assert.deepEqual([(await join(w, FINN)).status, (await join(w, FINN)).body.error], [409, 'removed_by_hq']);
});

test('anyone not an active tester reads no programmes and cannot apply; the summary counts nothing for them', async () => {
  const w = world();
  const uid = await openPartnerProgramme(w);
  const cases: Array<[number, string | null, RegExp]> = [
    [FRAN, null, /Apply to join the tester pool first/],
    [FINN, 'applied', /deciding your application/],
    [FAY, 'paused', /paused/],
    [IVY, 'declined', /not approved/],
  ];
  for (const [who, status, says] of cases) {
    if (status) setTester(w, who, status);
    // Mutation checked: drop the gate from memberProgrammes → a list for a member not in the pool.
    const list = await call(w, who, 'GET', '/testing/programmes');
    assert.deepEqual([list.status, list.body.error, list.body.items], [403, 'not_active_tester', undefined], String(status));
    assert.match(JSON.stringify(list.body), says);
    // Mutation checked: drop the gate from apply → a non-tester applies.
    const applied = await applyAs(w, who, uid);
    assert.deepEqual([applied.status, applied.body.error], [403, 'not_active_tester'], String(status));
    assert.equal((await call(w, who, 'GET', '/testing/summary')).body.open_count, 0);
  }
  setTester(w, IVY, 'removed');
  assert.equal((await call(w, IVY, 'GET', '/testing/programmes')).status, 403);
  assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM testing_applications').get() as any).n, 0, 'nobody applied');
  setTester(w, FRAN, 'active');
  const active = await call(w, FRAN, 'GET', '/testing/programmes');
  assert.deepEqual([active.status, active.body.items.map((p: any) => p.uid)], [200, [uid]]);
  assert.equal((await call(w, FRAN, 'GET', '/testing/summary')).body.open_count, 1);
  assert.equal((await applyAs(w, FRAN, uid)).status, 201);
});

test('My applications says who withdrew, which picks are finished, and when the owner decides by', async () => {
  const w = world();
  for (const who of [FRAN, FINN, FAY]) setTester(w, who, 'active');
  const uid = await openPartnerProgramme(w, { places: 3, closes_at: '2099-10-31' });
  const app: Record<string, string> = {};
  for (const [k, who] of [['fran', FRAN], ['finn', FINN], ['fay', FAY]] as const) app[k] = (await applyAs(w, who, uid)).body.application.uid;
  assert.equal((await call(w, FRAN, 'POST', `/testing/applications/${app.fran}/withdraw`)).status, 200);
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/applications/${app.finn}/withdraw`, { reason: 'Synthetic: a conflict of interest.' })).status, 200);
  assert.equal((await call(w, ACME, 'POST', `/partner/testing/applications/${app.fay}/pick`)).status, 200);
  const mine = async (who: number) => (await call(w, who, 'GET', '/testing/applications/mine')).body.items[0];
  // Mutation checked: compare the actor with HQ instead of the member → both read the same.
  assert.deepEqual([(await mine(FRAN)).withdrawn_by, (await mine(FINN)).withdrawn_by, (await mine(FAY)).withdrawn_by], ['member', 'hq', null]);
  const open = await mine(FAY);
  assert.deepEqual([open.status, open.finished, open.decides_by], ['picked', false, '2099-10-31T00:00:00.000Z']);
  noEmail((await call(w, FAY, 'GET', '/testing/applications/mine')).body);
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/close`)).status, 200);
  // Mutation checked: drop the closed check → a pick on an open programme reads finished.
  assert.equal((await mine(FAY)).finished, true, 'picked on a closed programme is finished');
  assert.equal((await mine(FRAN)).finished, false, 'a withdrawn one is not');
  // HQ removing a tester ends their open places (D1132): withdrawn by HQ.
  const uid2 = await openPartnerProgramme(w, { product_name: 'Second beta' });
  const fayApp2 = (await applyAs(w, FAY, uid2)).body.application.uid;
  const t = tester(w, FAY);
  w.db.prepare("UPDATE product_testers SET status = 'active' WHERE id = ?").run(t.id);
  const { applyTransition, readTester } = await import('../src/services/productTesters.ts');
  await applyTransition(w.env, (await readTester(w.env, t.id))!, 'remove', HQ, { note: null, reason: 'Synthetic removal.' });
  const ended = (await call(w, FAY, 'GET', '/testing/applications/mine')).body.items.find((a: any) => a.uid === fayApp2);
  assert.deepEqual([ended.status, ended.withdrawn_by], ['withdrawn', 'hq']);
});

test('closing a programme tells each picked tester, linking Inbox; nobody else among the testers is told', async () => {
  const w = world();
  for (const who of [FRAN, FINN]) setTester(w, who, 'active');
  const uid = await openPartnerProgramme(w);
  const fran = (await applyAs(w, FRAN, uid)).body.application.uid;
  await applyAs(w, FINN, uid);
  assert.equal((await call(w, ACME, 'POST', `/partner/testing/applications/${fran}/pick`)).status, 200);
  const closed = await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/close`);
  // Mutation checked: drop the testers' notice → told.testers 0 and Fran's inbox has none.
  assert.deepEqual(closed.body.told, { owner: 2, testers: 1 });
  const notice = w.db.prepare("SELECT title, link FROM notifications_inbox WHERE user_id = ? AND type = 'testing_programme_closed'").get(FRAN) as any;
  assert.deepEqual({ ...notice }, { title: 'Ledger beta is closed', link: '/inbox' });
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM notifications_inbox WHERE user_id = ? AND type = 'testing_programme_closed'").get(FINN).n, 0, 'an applicant not picked is not told');
  const firm = w.db.prepare("SELECT link FROM notifications_inbox WHERE user_id = ? AND type = 'testing_programme_closed'").get(ACME) as any;
  assert.equal(firm.link, null, 'the firm\'s notice keeps no member link');
});

// D1337 (#3542, PT-M3, PT-M4): what the member's application sheet and the Inbox read.
test('D1337: each application names the firm that runs it ("Axal VC" for HQ) and its questions; each member notice names its programme', async () => {
  const w = world();
  setTester(w, FRAN, 'active');
  const uid = await openPartnerProgramme(w);
  const appUid = (await applyAs(w, FRAN, uid)).body.application.uid;
  const mine = async () => (await call(w, FRAN, 'GET', '/testing/applications/mine')).body.items[0];
  const a = await mine();
  // Mutation checked: drop the join → owner_name reads null.
  assert.deepEqual([a.uid, a.owner_name, a.questions, a.answers], [appUid, 'Acme Labs', ['What do you use today?'], ['Spreadsheets']]);
  noEmail(a);
  w.db.prepare("UPDATE testing_programmes SET owner_kind = 'hq', owner_partner_id = NULL WHERE uid = ?").run(uid);
  assert.equal((await mine()).owner_name, 'Axal VC');
  // The Inbox opens the matching sheet from the notice's payload.
  const told = w.db.prepare("SELECT type, link, payload FROM notifications_inbox WHERE user_id = ? AND type = 'testing_applied'").get(FRAN) as any;
  assert.equal(told.link, '/inbox');
  assert.deepEqual(JSON.parse(told.payload), { programme_uid: uid, application_uid: appUid });
});
