/**
 * D1198 (#3148) — Product testing part 3: Move to testing, the owner told on
 * open, close and testing, and HQ's Withdraw with a reason. The harness is
 * D812's (migration 516 on the baseline's users, partners and super_admins,
 * with 515 and 517 applied for Mail's tester rule). Every person is made up.
 *
 * What these prove:
 *   · open or closed → testing, and nothing else; a refusal is 409 with the
 *     Worker's sentence and writes no event;
 *   · the firm (every active partner account it holds) is told on open, close
 *     and testing, another firm and an inactive account are not, and HQ's own
 *     programme has no owner to tell (`told.owner` null);
 *   · testing tells the picked testers on active accounts and no one else,
 *     and `mail_reach` is Mail's rule's count, never an address;
 *   · Withdraw needs a reason of 10 to 500 characters, takes applied or picked
 *     only, frees a picked place, tells the member the reason, and writes
 *     `withdrawn_by_hq` under the Super Admin in the same batch.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/product_testing_transitions_d1198.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { testing, partnerTesting, adminTesting } from '../src/routes/testing.ts';

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
  time_needed: '2 hours a week', places: 2, eligible_roles: ['founder'], questions: ['What do you use today?'],
};
const events = (w: any) => w.db.prepare('SELECT action, actor_user_id FROM testing_events ORDER BY id').all().map((r: any) => `${r.action}:${r.actor_user_id}`);
const bell = (w: any, user: number) => w.db.prepare('SELECT type FROM notifications_inbox WHERE user_id = ? ORDER BY id').all(user).map((r: any) => r.type);

/** A partner programme through submit, approve and open; returns its uid. */
async function openPartnerProgramme(w: any, extra: Record<string, unknown> = {}) {
  const uid = (await call(w, ACME, 'POST', '/partner/testing/programmes', { ...PROGRAMME, ...extra })).body.programme.uid;
  assert.equal((await call(w, ACME, 'POST', `/partner/testing/programmes/${uid}/submit`)).status, 200);
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/approve`, {})).status, 200);
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/open`)).status, 200);
  return uid;
}
const applyAs = (w: any, who: number, uid: string, consent = true) =>
  call(w, who, 'POST', `/testing/programmes/${uid}/apply`, { answers: ['Spreadsheets'], availability: 'Evenings', consent_email: consent });


const eventRows = (w: any) => (w.db.prepare('SELECT action, actor_user_id, detail FROM testing_events ORDER BY id').all() as any[]).map((r) => ({ ...r }));
const inbox = (w: any, user: number) => w.db.prepare('SELECT type, title, body FROM notifications_inbox WHERE user_id = ? ORDER BY id').all(user) as any[];

/** Acme's programme, open, with Fran picked (consenting), Fay picked (no consent) and Finn applied. */
async function withTesters(w: any) {
  const uid = await openPartnerProgramme(w, { places: 3 });
  const fran = (await applyAs(w, FRAN, uid)).body.application.uid;
  const fay = (await applyAs(w, FAY, uid, false)).body.application.uid;
  const finn = (await applyAs(w, FINN, uid)).body.application.uid;
  assert.equal((await call(w, ACME, 'POST', `/partner/testing/applications/${fran}/pick`)).status, 200);
  assert.equal((await call(w, ACME, 'POST', `/partner/testing/applications/${fay}/pick`)).status, 200);
  return { uid, fran, fay, finn };
}

test('Move to testing: open or closed only; a refusal says why and writes no event', async () => {
  const w = world();
  const { uid } = await withTesters(w);
  const moved = await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/testing`);
  assert.equal(moved.status, 200);
  assert.equal(moved.body.programme.status, 'testing');
  assert.deepEqual(eventRows(w).at(-1), { action: 'testing_started', actor_user_id: HQ, detail: null });
  const before = eventRows(w).length;
  const again = await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/testing`);
  assert.deepEqual([again.status, again.body.error, again.body.detail], [409, 'not_testable', 'Only an open or closed programme can move to testing.']);
  assert.equal(eventRows(w).length, before, 'a refused move writes no event');
  // Closed → testing as well.
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/close`)).body.programme.status, 'closed');
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/testing`)).body.programme.status, 'testing');
  // A draft and an approved programme cannot.
  const draft = (await call(w, HQ, 'POST', '/admin/testing/programmes', PROGRAMME)).body.programme.uid;
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${draft}/testing`)).status, 409);
  const p2 = (await call(w, ACME, 'POST', '/partner/testing/programmes', PROGRAMME)).body.programme.uid;
  await call(w, ACME, 'POST', `/partner/testing/programmes/${p2}/submit`);
  await call(w, HQ, 'POST', `/admin/testing/programmes/${p2}/approve`, {});
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${p2}/testing`)).body.error, 'not_testable', 'approved, not yet open');
  // Super Admin only.
  assert.equal((await call(w, ADMIN, 'POST', `/admin/testing/programmes/${p2}/testing`)).status, 403);
  assert.equal((await call(w, ACME, 'POST', `/admin/testing/programmes/${p2}/testing`)).status, 403);
  assert.equal((await call(w, HQ, 'POST', '/admin/testing/programmes/nope/testing')).status, 404);
});

test('Move to testing tells the firm and the picked testers, and counts Mail\'s reach', async () => {
  const w = world();
  w.db.exec(`INSERT INTO users (id, email, name, role, partner_id, is_active) VALUES (13, 'u13@example.test', 'Old Acme', 'partner', ${ACME_FIRM}, 0)`);
  const { uid } = await withTesters(w);
  const moved = await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/testing`);
  // Ada and Abe hold Acme; Fran and Fay are picked; only Fran consented to email.
  assert.deepEqual(moved.body.told, { owner: 2, testers: 2, mail_reach: 1 });
  for (const who of [ACME, ACME_2, FRAN, FAY]) assert.equal(inbox(w, who).at(-1).type, 'testing_started', `user ${who} told`);
  assert.ok(!inbox(w, FINN).some((n) => n.type === 'testing_started'), 'an applicant not picked is not told');
  assert.ok(!inbox(w, GLOBEX).some((n) => n.type === 'testing_started'), 'another firm is not told');
  assert.equal(inbox(w, 13).length, 0, 'an inactive firm account is not told');
  assert.ok(!JSON.stringify(moved.body).includes('@example.test'), 'no address in the answer');
  // A tester who turned this notice off is not counted as told.
  const w3 = world();
  const t3 = await withTesters(w3);
  w3.db.exec(`UPDATE users SET notification_prefs = '{"testing_started":{"in_app":false}}' WHERE id = ${FAY}`);
  assert.deepEqual((await call(w3, HQ, 'POST', `/admin/testing/programmes/${t3.uid}/testing`)).body.told, { owner: 2, testers: 1, mail_reach: 1 });
  // An inactive picked tester is not told, and not counted.
  const w2 = world();
  const t2 = await withTesters(w2);
  w2.db.exec(`UPDATE users SET is_active = 0 WHERE id = ${FAY}`);
  assert.deepEqual((await call(w2, HQ, 'POST', `/admin/testing/programmes/${t2.uid}/testing`)).body.told, { owner: 2, testers: 1, mail_reach: 1 });
});

test('open and close tell the firm; HQ\'s own programme has no owner to tell', async () => {
  const w = world();
  const uid = (await call(w, ACME, 'POST', '/partner/testing/programmes', PROGRAMME)).body.programme.uid;
  await call(w, ACME, 'POST', `/partner/testing/programmes/${uid}/submit`);
  await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/approve`, {});
  const opened = await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/open`);
  assert.deepEqual([opened.body.programme.status, opened.body.told], ['open', { owner: 2 }]);
  const closed = await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/close`);
  assert.deepEqual([closed.body.programme.status, closed.body.told], ['closed', { owner: 2 }]);
  for (const who of [ACME, ACME_2]) {
    assert.deepEqual(inbox(w, who).map((n) => n.type).slice(-2), ['testing_programme_opened', 'testing_programme_closed']);
  }
  assert.equal(inbox(w, ACME_2).find((n) => n.type === 'testing_programme_opened').title, 'Ledger beta is open');
  assert.equal(inbox(w, GLOBEX).length, 0, 'another firm is not told');
  // HQ's own.
  const hq = (await call(w, HQ, 'POST', '/admin/testing/programmes', PROGRAMME)).body.programme.uid;
  const hqBefore = w.db.prepare('SELECT COUNT(*) AS n FROM notifications_inbox').get().n;
  assert.deepEqual((await call(w, HQ, 'POST', `/admin/testing/programmes/${hq}/open`)).body.told, { owner: null });
  assert.deepEqual((await call(w, HQ, 'POST', `/admin/testing/programmes/${hq}/testing`)).body.told, { owner: null, testers: 0, mail_reach: 0 });
  assert.deepEqual((await call(w, HQ, 'POST', `/admin/testing/programmes/${hq}/close`)).body.told, { owner: null });
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM notifications_inbox').get().n, hqBefore, 'nobody is told for HQ\'s own');
});

test('Withdraw needs a reason of 10 to 500 characters', async () => {
  const w = world();
  const { fran } = await withTesters(w);
  const before = eventRows(w).length;
  // A number is not a reason, however long it is written.
  for (const reason of [undefined, '', '   ', 'Too short', 'x'.repeat(501), 42, 12345678901]) {
    const r = await call(w, HQ, 'POST', `/admin/testing/applications/${fran}/withdraw`, reason === undefined ? {} : { reason });
    assert.deepEqual([r.status, r.body.error, r.body.detail], [400, 'invalid_request', 'Give the reason they will read, 10 to 500 characters.'], String(reason));
  }
  assert.equal(eventRows(w).length, before, 'a refused withdraw writes no event');
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/applications/${fran}/withdraw`, { reason: `  ${'x'.repeat(500)}  ` })).status, 200, '500 after trimming');
  const w2 = world();
  const t2 = await withTesters(w2);
  assert.equal((await call(w2, HQ, 'POST', `/admin/testing/applications/${t2.finn}/withdraw`, { reason: 'Ten chars!' })).status, 200, 'exactly 10');
});

test('Withdraw: a picked place is freed, the member reads the reason, and the event is HQ\'s', async () => {
  const w = world();
  const { uid, fran, finn } = await withTesters(w);
  const left = async () => (await call(w, HQ, 'GET', '/admin/testing/programmes')).body.items.find((p: any) => p.uid === uid).places_left;
  assert.equal(await left(), 1);
  const reason = 'Your availability does not cover the testing dates.';
  const r = await call(w, HQ, 'POST', `/admin/testing/applications/${fran}/withdraw`, { reason });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.application.status, r.body.freed_place, r.body.told], ['withdrawn', true, { member: true }]);
  assert.equal(await left(), 2, 'the picked place is free again');
  const last = inbox(w, FRAN).at(-1);
  assert.equal(last.type, 'testing_withdrawn');
  assert.equal(last.body, `HQ withdrew your application: ${reason}`);
  const ev = eventRows(w).at(-1);
  assert.deepEqual([ev.action, ev.actor_user_id, JSON.parse(ev.detail)], ['withdrawn_by_hq', HQ, { reason, from: 'picked' }]);
  // An applied application: withdrawn, no place to free.
  const finnOut = await call(w, HQ, 'POST', `/admin/testing/applications/${finn}/withdraw`, { reason: 'The programme no longer needs this role.' });
  assert.deepEqual([finnOut.body.application.status, finnOut.body.freed_place], ['withdrawn', false]);
  assert.equal(JSON.parse(eventRows(w).at(-1).detail).from, 'applied');
  // Twice, or a declined one: 409 with the sentence, and no event.
  const before = eventRows(w).length;
  const twice = await call(w, HQ, 'POST', `/admin/testing/applications/${fran}/withdraw`, { reason });
  assert.deepEqual([twice.status, twice.body.error, twice.body.detail], [409, 'not_withdrawable', 'Only an application that is applied or picked can be withdrawn.']);
  assert.equal(eventRows(w).length, before);
  assert.equal(inbox(w, FRAN).filter((n) => n.type === 'testing_withdrawn').length, 1, 'told once');
  // Unknown, and not a Super Admin.
  assert.equal((await call(w, HQ, 'POST', '/admin/testing/applications/nope/withdraw', { reason })).status, 404);
  assert.equal((await call(w, ADMIN, 'POST', `/admin/testing/applications/${finn}/withdraw`, { reason })).status, 403);
  assert.ok(!JSON.stringify(r.body).includes('@example.test'), 'no address in the answer');
});

test('Withdraw says when the member\'s bell did not take the notice', async () => {
  const w = world();
  const { finn } = await withTesters(w);
  w.db.exec(`UPDATE users SET notification_prefs = '{"testing_withdrawn":{"in_app":false}}' WHERE id = ${FINN}`);
  const r = await call(w, HQ, 'POST', `/admin/testing/applications/${finn}/withdraw`, { reason: 'The programme no longer needs this role.' });
  assert.deepEqual([r.body.application.status, r.body.told], ['withdrawn', { member: false }]);
});

test('Withdraw refuses a declined application', async () => {
  const w = world();
  const { finn } = await withTesters(w);
  await call(w, ACME, 'POST', `/partner/testing/applications/${finn}/decline`);
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/applications/${finn}/withdraw`, { reason: 'Not a fit for this round.' })).body.error, 'not_withdrawable');
});
