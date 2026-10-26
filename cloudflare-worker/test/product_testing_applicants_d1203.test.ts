/**
 * D1203 (#3153, part 8 of #2382) — the applications read's two additions for
 * TST8's Applicants tab, on D1197's harness (migrations 515, 516, 517, 576):
 *
 *   · `scope=open` keeps applications to programmes that are open or in
 *     testing; `all` (the default) keeps every programme; anything else is 400;
 *   · `counts` gives one count per status under every other filter, so the
 *     chips add up to what each status would list, withdrawn included.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/product_testing_applicants_d1203.test.ts
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
  w.db.exec(`INSERT INTO product_testers (user_id, status, decided_at) VALUES (${FINN}, 'active', '2026-10-01'), (${FRAN}, 'applied', NULL)`);
  return { w, acme, hq };
}

test('scope=open keeps open and testing programmes; all keeps every one; a bad scope is 400', async () => {
  const { w, acme, hq } = await seeded();
  // A closed programme with one applicant.
  const shut = await openPartnerProgramme(w, { product_name: 'Closed beta', eligible_roles: ['investor'] });
  assert.equal((await applyAs(w, IVY, shut)).status, 201);
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${shut}/close`)).status, 200);
  const all = (await call(w, HQ, 'GET', '/admin/testing/applications')).body.applications;
  assert.equal(all.scope, 'all');
  assert.ok(all.items.some((a: any) => a.programme.uid === shut), 'all keeps a closed programme');
  const open = await call(w, HQ, 'GET', '/admin/testing/applications?scope=open');
  assert.equal(open.status, 200);
  assert.equal(open.body.applications.scope, 'open');
  assert.ok(!open.body.applications.items.some((a: any) => a.programme.uid === shut), 'open leaves the closed programme out');
  assert.deepEqual(new Set(open.body.applications.items.map((a: any) => a.programme.uid)), new Set([acme, hq]));
  // In testing still counts as open.
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${hq}/testing`)).status, 200);
  assert.ok((await call(w, HQ, 'GET', '/admin/testing/applications?scope=open')).body.applications.items.some((a: any) => a.programme.uid === hq));
  const bad = await call(w, HQ, 'GET', '/admin/testing/applications?scope=closed');
  assert.equal(bad.status, 400);
  assert.match(bad.body.message || bad.body.detail || '', /scope is all or open/);
  noEmail(open.body);
});

test('counts: one per status under the other filters, withdrawn included, a measured 0 where none', async () => {
  const { w, acme } = await seeded();
  const finnApp = (w.db.prepare('SELECT uid FROM testing_applications WHERE user_id = ?').get(FINN) as any).uid;
  const all = (await call(w, HQ, 'GET', '/admin/testing/applications')).body.applications;
  // Fran applied, Finn applied, Fay withdrew (Acme); Ivy applied (HQ).
  assert.deepEqual(all.counts, { applied: 3, picked: 0, declined: 0, withdrawn: 1 });
  assert.equal(all.total, 3, 'the list leaves the withdrawn out; the chips still count them');
  assert.equal((await call(w, ACME, 'POST', `/partner/testing/applications/${finnApp}/pick`)).status, 200);
  const acmeOnly = (await call(w, HQ, 'GET', `/admin/testing/applications?programme=${acme}`)).body.applications;
  assert.deepEqual(acmeOnly.counts, { applied: 1, picked: 1, declined: 0, withdrawn: 1 }, 'the programme filter holds');
  const picked = (await call(w, HQ, 'GET', '/admin/testing/applications?status=picked')).body.applications;
  assert.deepEqual(picked.counts, { applied: 2, picked: 1, declined: 0, withdrawn: 1 }, 'a status filter does not narrow the chips');
  assert.equal(picked.total, 1);
  const ivy = (await call(w, HQ, 'GET', '/admin/testing/applications?role=investor')).body.applications;
  assert.deepEqual(ivy.counts, { applied: 1, picked: 0, declined: 0, withdrawn: 0 }, 'the role filter holds');
});
