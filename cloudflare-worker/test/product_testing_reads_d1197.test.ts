/**
 * D1197 (#3147, part 2 of #2382) — HQ's three Product testing reads, on D812's
 * SQLite harness with the real migrations 516 and 576:
 *
 *   · GET /api/admin/testing/programmes/:uid/events — a programme's history,
 *     newest first, paged, the actor and applicant by name, never an address;
 *   · GET /api/admin/testing/programmes/:uid/applicants — any programme's,
 *     a partner's read only (`can_decide: false`), and no write route opened;
 *   · GET /api/admin/testing/applications — every application, paged, with
 *     its filters; withdrawn only when asked.
 *
 * Every one is Super Admin only: a plain Admin is 403. A D1 error is a 503.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/product_testing_reads_d1197.test.ts
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
  // D1197: the tester pool (D1196) the applications read filters on.
  db.exec(readFileSync(`${SQL}/migrations/576_product_testers.sql`, 'utf8'));
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
  // D1336: only an active Product tester reads and applies to programmes, so every member here starts as one.
  db.exec("INSERT INTO product_testers (user_id, status, decided_at) SELECT id, 'active', '2026-10-01' FROM users WHERE role NOT IN ('partner', 'admin') AND id NOT IN (SELECT user_id FROM super_admins)");
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

const noEmail = (x: unknown) => assert.doesNotMatch(JSON.stringify(x), /@example\.test|"email"/, 'no email address on a Product testing read');

/** Acme's open programme with Fran (consented), Finn (no consent) and Fay (withdrawn); HQ's with Ivy-less Fran. */
async function seeded() {
  const w = world();
  const acme = await openPartnerProgramme(w, { eligible_roles: ['founder', 'investor'], places: 3 });
  assert.equal((await applyAs(w, FRAN, acme)).status, 201);
  assert.equal((await applyAs(w, FINN, acme, false)).status, 201);
  assert.equal((await applyAs(w, FAY, acme)).status, 201);
  const fayApp = w.db.prepare("SELECT a.uid FROM testing_applications a WHERE a.user_id = ?").get(FAY) as any;
  assert.equal((await call(w, FAY, 'POST', `/testing/applications/${fayApp.uid}/withdraw`)).status, 200);
  const hq = (await call(w, HQ, 'POST', '/admin/testing/programmes', { ...PROGRAMME, product_name: 'Axal inbox', eligible_roles: ['founder', 'investor'] })).body.programme.uid;
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${hq}/open`)).status, 200);
  assert.equal((await applyAs(w, IVY, hq)).status, 201);
  // Finn is an active tester in HQ's pool; Fran's pool application is still waiting.
  // D1336: everyone applied as an active tester; the pool these reads filter on is then just these two.
  w.db.exec(`DELETE FROM product_testers; INSERT INTO product_testers (user_id, status, decided_at) VALUES (${FINN}, 'active', '2026-10-01'), (${FRAN}, 'applied', NULL)`);
  return { w, acme, hq };
}

test('HQ reads a partner\'s applicants, read only: can_decide false, no email, and pick and decline still refused', async () => {
  const { w, acme, hq } = await seeded();
  const r = await call(w, HQ, 'GET', `/admin/testing/programmes/${acme}/applicants`);
  assert.equal(r.status, 200);
  assert.equal(r.body.can_decide, false);
  assert.equal(r.body.programme.owner_name, 'Acme Labs');
  assert.deepEqual(r.body.items.map((i: any) => i.name).sort(), ['Finn Oak', 'Fran Ruiz'], 'an owner\'s list leaves the withdrawn out');
  noEmail(r.body);
  const own = await call(w, HQ, 'GET', `/admin/testing/programmes/${hq}/applicants`);
  assert.equal(own.body.can_decide, true, 'HQ decides its own');
  // The partner's own read says it may decide.
  assert.equal((await call(w, ACME, 'GET', `/partner/testing/programmes/${acme}/applicants`)).body.can_decide, true);
  // No write opened: HQ's pick and decline on a partner's application are still 404.
  const app = r.body.items[0].uid;
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/applications/${app}/pick`)).status, 404);
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/applications/${app}/decline`)).status, 404);
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM testing_applications WHERE status = 'picked'").get().n, 0);
  assert.equal((await call(w, HQ, 'GET', '/admin/testing/programmes/nope/applicants')).status, 404);
});

test('a programme\'s history: newest first, paged, actor and applicant by name, never an address', async () => {
  const { w, acme } = await seeded();
  const all = w.db.prepare('SELECT action FROM testing_events WHERE programme_id = (SELECT id FROM testing_programmes WHERE uid = ?) ORDER BY id DESC').all(acme).map((r: any) => r.action);
  const r = await call(w, HQ, 'GET', `/admin/testing/programmes/${acme}/events?page_size=3`);
  assert.equal(r.status, 200);
  assert.equal(r.body.events.available, true);
  assert.equal(r.body.events.total, all.length);
  assert.deepEqual(r.body.events.items.map((e: any) => e.action), all.slice(0, 3), 'newest first');
  const withdrew = r.body.events.items.find((e: any) => e.applicant_name === 'Fay Wu');
  assert.ok(withdrew, 'the withdrawal names its applicant');
  assert.deepEqual(withdrew.actor, { name: 'Fay Wu' });
  noEmail(r.body);
  const p2 = await call(w, HQ, 'GET', `/admin/testing/programmes/${acme}/events?page=2&page_size=3`);
  assert.deepEqual(p2.body.events.items.map((e: any) => e.action), all.slice(3, 6));
  const created = (await call(w, HQ, 'GET', `/admin/testing/programmes/${acme}/events?page_size=100`)).body.events.items.at(-1);
  assert.equal(created.action, all.at(-1));
  assert.deepEqual(created.actor, { name: 'Ada Acme' }, 'the partner who created it, by name');
  assert.equal((await call(w, HQ, 'GET', `/admin/testing/programmes/${acme}/events?page_size=101`)).status, 400);
  assert.equal((await call(w, HQ, 'GET', `/admin/testing/programmes/${acme}/events?page=0`)).status, 400);
  assert.equal((await call(w, HQ, 'GET', '/admin/testing/programmes/nope/events')).status, 404);
});

test('every application across programmes: withdrawn only when asked, each filter, the search and both sorts', async () => {
  const { w, acme, hq } = await seeded();
  const names = async (q = '') => (await call(w, HQ, 'GET', `/admin/testing/applications${q}`)).body.applications.items.map((i: any) => i.name);
  const r = await call(w, HQ, 'GET', '/admin/testing/applications');
  assert.equal(r.status, 200);
  assert.equal(r.body.applications.total, 3, 'withdrawn left out by default');
  assert.deepEqual(r.body.applications.items.map((i: any) => i.name), ['Ivy Lee', 'Finn Oak', 'Fran Ruiz'], 'newest applied first');
  noEmail(r.body);
  const ivy = r.body.applications.items[0];
  assert.deepEqual(ivy.programme, { uid: hq, product_name: 'Axal inbox', owner_kind: 'hq', owner_name: 'Axal VC' });
  assert.equal((await names('?status=all')).length, 4);
  assert.deepEqual(await names('?status=withdrawn'), ['Fay Wu']);
  assert.deepEqual(await names(`?programme=${acme}`), ['Finn Oak', 'Fran Ruiz']);
  assert.deepEqual(await names('?owner=hq'), ['Ivy Lee']);
  assert.deepEqual(await names('?owner=partner'), ['Finn Oak', 'Fran Ruiz']);
  assert.deepEqual(await names(`?owner=partner:${ACME_FIRM}`), ['Finn Oak', 'Fran Ruiz']);
  assert.deepEqual(await names(`?owner=partner:${GLOBEX_FIRM}`), []);
  assert.deepEqual(await names('?role=investor'), ['Ivy Lee']);
  assert.deepEqual(await names('?consented=no'), ['Finn Oak']);
  assert.deepEqual(await names('?consented=yes'), ['Ivy Lee', 'Fran Ruiz']);
  assert.deepEqual(await names('?tester=yes'), ['Finn Oak'], 'an active tester only, never one still applying');
  assert.deepEqual(await names('?tester=no'), ['Ivy Lee', 'Fran Ruiz']);
  assert.deepEqual(await names('?q=fr'), ['Fran Ruiz']);
  assert.deepEqual(await names('?q=%25%25'), [], 'a wildcard is searched as itself, never as everyone');
  assert.deepEqual(await names('?sort=name'), ['Finn Oak', 'Fran Ruiz', 'Ivy Lee']);
  const page = (await call(w, HQ, 'GET', '/admin/testing/applications?sort=name&page=2&page_size=2')).body.applications;
  assert.deepEqual([page.total, page.page, page.items.map((i: any) => i.name)], [3, 2, ['Ivy Lee']]);
  const finn = r.body.applications.items.find((i: any) => i.name === 'Finn Oak');
  assert.deepEqual([finn.in_pool, finn.consented, finn.status], [true, false, 'applied']);
  for (const bad of ['?status=lost', '?role=king', '?owner=firm', '?consented=maybe', '?sort=size', '?q=a', '?page_size=0']) {
    assert.equal((await call(w, HQ, 'GET', `/admin/testing/applications${bad}`)).status, 400, bad);
  }
});

test('every new read is Super Admin only: a plain Admin, a partner and a member are refused', async () => {
  const { w, acme } = await seeded();
  for (const path of [`/admin/testing/programmes/${acme}/events`, `/admin/testing/programmes/${acme}/applicants`, '/admin/testing/applications']) {
    assert.equal((await call(w, ADMIN, 'GET', path)).status, 403, `${path} for a plain Admin`);
    assert.notEqual((await call(w, ACME, 'GET', path)).status, 200, `${path} for a partner`);
    assert.notEqual((await call(w, FRAN, 'GET', path)).status, 200, `${path} for a member`);
  }
});

test('a read that fails is a 503 with its sentence, never an empty list', async () => {
  const { w, acme } = await seeded();
  w.db.exec('DROP TABLE product_testers');
  const a = await call(w, HQ, 'GET', '/admin/testing/applications');
  assert.equal(a.status, 503);
  assert.match(JSON.stringify(a.body), /Applications could not be read\. That is not the same as none\./);
  w.db.exec('ALTER TABLE testing_events RENAME TO testing_events_gone');
  const e = await call(w, HQ, 'GET', `/admin/testing/programmes/${acme}/events`);
  assert.equal(e.status, 503);
  assert.match(JSON.stringify(e.body), /history could not be read/);
  assert.doesNotMatch(JSON.stringify(e.body), /no such table|SELECT/, 'never the statement or the D1 error');
});
