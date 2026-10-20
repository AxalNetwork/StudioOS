/**
 * D812 part 2a (#2258) — the two reads Mail's Product testing page takes through
 * D811's signed link: `mailProgrammes` and `mailApplicants` (services/testing.ts),
 * on the same SQLite harness as product_testing_d812.test.ts. Nothing mounts
 * them yet (part 2b does, behind D811's signature check).
 *
 * The email rule, one case each: a picked tester who consented is the only
 * applicant with an address. Picked without consent, applied, declined, an
 * inactive account and a withdrawn application carry none; an unknown uid is
 * null, never another programme's list.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/product_testing_mail_d812.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { testing, partnerTesting, adminTesting } from '../src/routes/testing.ts';
import { firstAnswerLine, mailApplicants, mailProgrammes, testersAudience } from '../src/services/testing.ts';

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
  for (const t of ['users', 'super_admins', 'partners', 'notifications_inbox']) db.exec(ddl(t));
  db.exec(readFileSync(`${SQL}/migrations/516_product_testing.sql`, 'utf8'));
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

const IDA = 24, IAN = 25;
/** Two more founders: one whose account is closed, one who withdraws. */
function worldPlus() {
  const w = world();
  const u = w.db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, ?)');
  u.run(IDA, `u${IDA}@example.test`, 'Ida Lane', 'founder', 1);
  u.run(IAN, `u${IAN}@example.test`, 'Ian Moss', 'founder', 1);
  return w;
}

/**
 * A partner programme with one applicant per case: Fran picked and consented;
 * Finn picked without consent; Fay applied and consented, not picked; Ida
 * picked and consented, then her account closed; Ian applied and withdrew.
 * Then HQ's own programme, where Fay is declined, so a decline can be checked
 * and kept out of the partner's list.
 */
async function seeded() {
  const w = worldPlus();
  const uid = await openPartnerProgramme(w, { places: 5, questions: ['What do you use today?'] });
  const app = async (who: number, consent: boolean, answer = 'Spreadsheets') =>
    (await call(w, who, 'POST', `/testing/programmes/${uid}/apply`, { answers: [answer], availability: 'Evenings', consent_email: consent })).body.application.uid;
  const a: Record<string, string> = {
    fran: await app(FRAN, true, 'Spreadsheets\nand a lot of email'),
    finn: await app(FINN, false),
    fay: await app(FAY, true),
    ida: await app(IDA, true),
    ian: await app(IAN, true),
  };
  for (const k of ['fran', 'finn', 'ida']) assert.equal((await call(w, ACME, 'POST', `/partner/testing/applications/${a[k]}/pick`)).status, 200, k);
  assert.equal((await call(w, IAN, 'POST', `/testing/applications/${a.ian}/withdraw`)).status, 200);
  w.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(IDA);
  // A second programme: HQ's own, with a declined consenting applicant who must not surface in the first.
  const hq = (await call(w, HQ, 'POST', '/admin/testing/programmes', { ...PROGRAMME, product_name: 'HQ beta', places: 1 })).body.programme.uid;
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${hq}/open`)).status, 200);
  const declined = (await call(w, FAY, 'POST', `/testing/programmes/${hq}/apply`, { answers: ['x'], consent_email: true })).body.application.uid;
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/applications/${declined}/decline`)).status, 200);
  return { w, uid, hq, a };
}

const byName = (items: any[]) => Object.fromEntries(items.map((i) => [i.name, i]));

test('an email only for a picked tester who consented, on an active account', async () => {
  const { w, uid } = await seeded();
  const r = await mailApplicants(w.env, uid);
  assert.ok(r);
  const m = byName(r!.items);
  assert.equal(m['Fran Ruiz'].email, `u${FRAN}@example.test`, 'picked and consented');
  assert.equal(m['Finn Oak'].email, null, 'picked without consent');
  assert.equal(m['Fay Wu'].email, null, 'applied, not picked, though consented');
  assert.equal(m['Ida Lane'].email, null, 'picked and consented, but the account is closed');
  assert.equal(m['Ian Moss'], undefined, 'a withdrawn application is left out');
  const withEmail = r!.items.filter((i: any) => i.email !== null).map((i: any) => i.email);
  assert.deepEqual(withEmail, (await testersAudience(w.env, uid)).map((t) => t.email), 'the same people as the testers audience');
  assert.ok(!JSON.stringify(r).includes(`u${FINN}@`) && !JSON.stringify(r).includes(`u${FAY}@`) && !JSON.stringify(r).includes(`u${IDA}@`));
});

test('a declined applicant carries no email, and one programme never shows another\'s applicants', async () => {
  const { w, uid, hq } = await seeded();
  const h = await mailApplicants(w.env, hq);
  assert.deepEqual(h!.items.map((i: any) => [i.name, i.status, i.email]), [['Fay Wu', 'declined', null]]);
  assert.equal(h!.programme.owner_name, 'Axal VC');
  const p = await mailApplicants(w.env, uid);
  assert.ok(!p!.items.some((i: any) => i.status === 'declined'), 'the HQ programme\'s decline is not in the partner\'s list');
  assert.equal(p!.programme.owner_name, 'Acme Labs');
});

test('an unknown uid is null, never a list', async () => {
  const { w } = await seeded();
  assert.equal(await mailApplicants(w.env, 'nope'), null);
  assert.equal(await mailApplicants(w.env, ''), null);
  assert.equal(await mailApplicants(w.env, undefined as any), null);
});

test('each applicant has name, role, the first line of their answers, applied on and status', async () => {
  const { w, uid } = await seeded();
  const m = byName((await mailApplicants(w.env, uid))!.items);
  assert.deepEqual(Object.keys(m['Fran Ruiz']).sort(), ['applied_on', 'consented', 'email', 'first_answer', 'name', 'role', 'status', 'uid']);
  assert.equal(m['Fran Ruiz'].first_answer, 'Spreadsheets', 'only the first line');
  assert.equal(m['Fran Ruiz'].role, 'founder');
  assert.match(m['Fran Ruiz'].applied_on, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(Object.fromEntries(Object.entries(m).map(([k, v]: any) => [k, v.status])),
    { 'Fran Ruiz': 'picked', 'Finn Oak': 'picked', 'Fay Wu': 'applied', 'Ida Lane': 'picked' });
  assert.equal(firstAnswerLine('["  "]'), null);
  assert.equal(firstAnswerLine('not json'), null);
  assert.equal(firstAnswerLine(JSON.stringify(['x'.repeat(200)])).length, 140);
});

test('every programme, with its owner, status, places, applicants and dates', async () => {
  const { w, uid, hq } = await seeded();
  const all = await mailProgrammes(w.env);
  const m = Object.fromEntries(all.map((p) => [p.uid, p]));
  assert.deepEqual(Object.keys(m[uid]).sort(), ['applicant_count', 'closes_at', 'opens_at', 'owner_kind', 'owner_name', 'picked_count', 'places', 'places_left', 'product_name', 'status', 'testing_ends', 'testing_starts', 'uid']);
  assert.equal(m[uid].owner_name, 'Acme Labs');
  assert.equal(m[uid].status, 'open');
  assert.equal(m[uid].places, 5);
  assert.equal(m[uid].picked_count, 3);
  assert.equal(m[uid].applicant_count, 4, 'the withdrawn one is not counted');
  assert.equal(m[hq].owner_name, 'Axal VC');
  // A draft is listed too: Mail's page reads every programme.
  await call(w, GLOBEX, 'POST', '/partner/testing/programmes', { ...PROGRAMME, product_name: 'Globex draft' });
  const drafts = (await mailProgrammes(w.env)).filter((p) => p.status === 'draft');
  assert.deepEqual(drafts.map((p) => [p.product_name, p.owner_name]), [['Globex draft', 'Globex']]);
  assert.ok(!JSON.stringify(await mailProgrammes(w.env)).includes('@'), 'no address in the programme list');
});

test('nothing in the Worker mounts the two reads yet', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  for (const f of ['cloudflare-worker/src/index.ts', 'cloudflare-worker/src/routes/testing.ts']) {
    const src = read(f);
    assert.ok(!src.includes('mailApplicants') && !src.includes('mailProgrammes'), `${f} mounts a Mail read before D811's signature check`);
  }
});
