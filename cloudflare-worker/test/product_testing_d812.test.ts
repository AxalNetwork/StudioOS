/**
 * D812 (#2258) — product testing: migration 516 and routes/testing.ts, on the
 * SQLite D1 harness with the real migration and the baseline's users,
 * partners and super_admins.
 *
 * What these prove:
 *   · A partner sees and edits only their firm's programmes; another firm's
 *     answers 404 like a missing one, on every owner route.
 *   · A partner's programme opens only after HQ approves it; HQ's own opens
 *     from draft. Sent back, it returns to draft on the next edit.
 *   · Apply is refused when not open, past its close, for the wrong role, when
 *     full, and twice.
 *   · A pick past the places is refused; withdrawing a pick frees its place.
 *   · Every change appends one `testing_events` row and the bell is told;
 *     the events table refuses UPDATE and DELETE.
 *   · The testers audience is the picked applicants who consented, nobody else.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/product_testing_d812.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { testing, partnerTesting, adminTesting } from '../src/routes/testing.ts';
import { testersAudience, CONSENT_VERSION, MY_APPLICATIONS_LINK } from '../src/services/testing.ts';

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

test('516: runs twice; one application per member per programme; events are append-only', () => {
  const w = world();
  w.db.exec(readFileSync(`${SQL}/migrations/516_product_testing.sql`, 'utf8'));
  w.db.exec(`INSERT INTO testing_programmes (uid, owner_kind, created_by, product_name, places) VALUES ('x', 'hq', ${HQ}, 'X', 1)`);
  assert.throws(() => w.db.exec(`INSERT INTO testing_programmes (uid, owner_kind, created_by, product_name, places) VALUES ('y', 'partner', ${ACME}, 'Y', 1)`), /CHECK/);
  w.db.exec(`INSERT INTO testing_applications (uid, programme_id, user_id) VALUES ('a', 1, ${FRAN})`);
  assert.throws(() => w.db.exec(`INSERT INTO testing_applications (uid, programme_id, user_id) VALUES ('b', 1, ${FRAN})`), /UNIQUE/);
  w.db.exec(`INSERT INTO testing_events (programme_id, action) VALUES (1, 'created')`);
  // Mutation checked: drop the no_update trigger → the UPDATE succeeds.
  assert.throws(() => w.db.exec("UPDATE testing_events SET action = 'x'"), /append-only/);
  assert.throws(() => w.db.exec('DELETE FROM testing_events'), /append-only/);
});

test('a partner sees and edits only their firm\'s programmes; another firm\'s reads as missing', async () => {
  // Mutation checked: drop the owner_partner_id clause from ownerWhere → Globex lists and edits Acme's programme.
  const w = world();
  const made = await call(w, ACME, 'POST', '/partner/testing/programmes', PROGRAMME);
  assert.equal(made.status, 201);
  const uid = made.body.programme.uid;
  assert.deepEqual([made.body.programme.status, made.body.programme.owner_name], ['draft', 'Acme Labs']);
  assert.equal((await call(w, ACME_2, 'GET', '/partner/testing/programmes')).body.items.length, 1, 'a colleague at the same firm sees it');
  assert.deepEqual((await call(w, GLOBEX, 'GET', '/partner/testing/programmes')).body.items, []);
  for (const [method, path, body] of [
    ['PATCH', `/partner/testing/programmes/${uid}`, { summary: 'Mine now' }],
    ['POST', `/partner/testing/programmes/${uid}/submit`, undefined],
    ['GET', `/partner/testing/programmes/${uid}/applicants`, undefined],
  ] as const) {
    const theirs = await call(w, GLOBEX, method, path, body);
    const missing = await call(w, GLOBEX, method, path.replace(uid, 'nope'), body);
    assert.deepEqual([theirs.status, theirs.body], [404, missing.body], `${method} ${path}`);
  }
  assert.equal((await call(w, FRAN, 'GET', '/partner/testing/programmes')).status, 403, 'a founder is not a partner');
  const edited = await call(w, ACME_2, 'PATCH', `/partner/testing/programmes/${uid}`, { summary: 'Sharper' });
  assert.deepEqual([edited.status, edited.body.programme.summary], [200, 'Sharper']);
  // Draft only: once submitted it cannot be edited.
  assert.equal((await call(w, ACME, 'POST', `/partner/testing/programmes/${uid}/submit`)).status, 200);
  const late = await call(w, ACME, 'PATCH', `/partner/testing/programmes/${uid}`, { summary: 'Again' });
  assert.deepEqual([late.status, late.body.error], [409, 'not_editable']);
  // Refused input.
  for (const bad of [{ ...PROGRAMME, places: 0 }, { ...PROGRAMME, eligible_roles: ['admin'] }, { ...PROGRAMME, eligible_roles: [] },
    { ...PROGRAMME, questions: ['1', '2', '3', '4', '5', '6'] }, { ...PROGRAMME, product_name: ' ' },
    { ...PROGRAMME, opens_at: '2026-12-01', closes_at: '2026-11-01' }]) {
    assert.equal((await call(w, ACME, 'POST', '/partner/testing/programmes', bad)).status, 400, JSON.stringify(bad));
  }
});

test('a partner\'s programme opens only after HQ approves it; sent back, its next edit returns it to draft', async () => {
  // Mutation checked: let open start a partner's programme from submitted → the first open answers 200.
  const w = world();
  const uid = (await call(w, ACME, 'POST', '/partner/testing/programmes', PROGRAMME)).body.programme.uid;
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/open`)).body.error, 'not_openable', 'a draft');
  // Mutation checked: let approve start from draft → approving a draft HQ never received answers 200.
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/approve`, {})).body.error, 'not_reviewable', 'not sent for review');
  await call(w, ACME, 'POST', `/partner/testing/programmes/${uid}/submit`);
  const early = await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/open`);
  assert.deepEqual([early.status, early.body.error], [409, 'not_openable'], 'submitted, not approved');
  assert.equal((await call(w, ADMIN, 'POST', `/admin/testing/programmes/${uid}/approve`, {})).status, 403, 'a plain admin is not HQ');
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/reject`, {})).status, 400, 'sent back needs a note');
  const back = await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/reject`, { note: 'Add the dates' });
  assert.deepEqual([back.body.programme.status, back.body.programme.review_note], ['rejected', 'Add the dates']);
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/open`)).status, 409, 'sent back');
  assert.equal((await call(w, ACME, 'PATCH', `/partner/testing/programmes/${uid}`, { testing_starts: '2026-11-02', testing_ends: '2026-11-30' })).body.programme.status, 'draft');
  await call(w, ACME, 'POST', `/partner/testing/programmes/${uid}/submit`);
  assert.deepEqual((await call(w, HQ, 'GET', '/admin/testing/programmes?status=submitted')).body.items.map((p: any) => p.uid), [uid]);
  assert.equal((await call(w, HQ, 'GET', '/admin/testing/programmes?status=nope')).status, 400);
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/approve`, {})).body.programme.status, 'approved');
  assert.equal((await call(w, ACME, 'POST', `/admin/testing/programmes/${uid}/open`)).status, 403, 'a partner cannot open it');
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/open`)).body.programme.status, 'open');
  assert.deepEqual(bell(w, ACME), ['testing_programme_sent_back', 'testing_programme_approved'], 'the partner is told both');
  // HQ's own: no review, opens from draft, and is not on a partner's list.
  const hq = (await call(w, HQ, 'POST', '/admin/testing/programmes', PROGRAMME)).body.programme;
  assert.deepEqual([hq.owner_kind, hq.owner_name], ['hq', 'Axal VC']);
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${hq.uid}/approve`, {})).status, 409);
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${hq.uid}/open`)).body.programme.status, 'open');
  assert.equal((await call(w, ACME, 'GET', `/partner/testing/programmes/${hq.uid}/applicants`)).status, 404);
  assert.equal((await call(w, HQ, 'GET', `/admin/testing/programmes/${uid}/applicants`)).status, 404, "HQ's owner routes are HQ's programmes");
  assert.equal((await call(w, HQ, 'POST', `/admin/testing/programmes/${hq.uid}/close`)).body.programme.status, 'closed');
});

test('apply is refused when not open, past its close, for the wrong role, when full, and twice', async () => {
  // Mutation checked: drop the role check from apply → Ivy (investor) applies (201).
  const w = world();
  const draft = (await call(w, ACME, 'POST', '/partner/testing/programmes', PROGRAMME)).body.programme.uid;
  assert.deepEqual([(await applyAs(w, FRAN, draft)).status, (await applyAs(w, FRAN, draft)).body.error], [409, 'not_open']);
  const uid = await openPartnerProgramme(w, { places: 1 });
  const listed = await call(w, FRAN, 'GET', '/testing/programmes');
  assert.deepEqual(listed.body.items.map((p: any) => [p.uid, p.places_left]), [[uid, 1]]);
  assert.equal(listed.body.consent.version, CONSENT_VERSION);
  assert.deepEqual((await call(w, IVY, 'GET', '/testing/programmes')).body.items, [], 'not listed for another role');
  const wrongRole = await applyAs(w, IVY, uid);
  assert.deepEqual([wrongRole.status, wrongRole.body.error], [403, 'not_eligible']);
  assert.equal((await call(w, FRAN, 'POST', `/testing/programmes/${uid}/apply`, { answers: [] })).status, 400, 'each question answered');
  const ok = await applyAs(w, FRAN, uid);
  assert.deepEqual([ok.status, ok.body.application.status, ok.body.application.consented], [201, 'applied', true]);
  const twice = await applyAs(w, FRAN, uid);
  assert.deepEqual([twice.status, twice.body.error], [409, 'already_applied']);
  // Full once every place is picked: no longer listed, and refused.
  assert.equal((await call(w, ACME, 'POST', `/partner/testing/applications/${ok.body.application.uid}/pick`)).status, 200);
  assert.deepEqual((await call(w, FINN, 'GET', '/testing/programmes')).body.items, []);
  const full = await applyAs(w, FINN, uid);
  assert.deepEqual([full.status, full.body.error], [409, 'programme_full']);
  // Past its close date: not listed, and refused.
  // Mutation checked: drop the closes_at test from apply → Fay applies to a programme past its close (201).
  const past = await openPartnerProgramme(w, { closes_at: '2020-01-01' });
  assert.deepEqual((await call(w, FAY, 'GET', '/testing/programmes')).body.items, []);
  assert.equal((await applyAs(w, FAY, past)).body.error, 'not_open');
  assert.equal((await call(w, FRAN, 'GET', '/testing/applications/mine')).body.items.length, 1);
});

test('a pick past the places is refused; withdrawing a pick frees its place; withdraw is the applicant\'s own', async () => {
  // Mutation checked: drop the places subquery from the pick UPDATE → the third pick answers 200.
  const w = world();
  const uid = await openPartnerProgramme(w, { places: 2 });
  const apps: Record<number, string> = {};
  for (const who of [FRAN, FINN, FAY]) apps[who] = (await applyAs(w, who, uid)).body.application.uid;
  for (const who of [FRAN, FINN]) assert.equal((await call(w, ACME, 'POST', `/partner/testing/applications/${apps[who]}/pick`)).status, 200);
  const third = await call(w, ACME, 'POST', `/partner/testing/applications/${apps[FAY]}/pick`);
  assert.deepEqual([third.status, third.body.error], [409, 'programme_full']);
  assert.equal((await call(w, GLOBEX, 'POST', `/partner/testing/applications/${apps[FAY]}/pick`)).status, 404, 'another firm');
  assert.equal((await call(w, FAY, 'POST', `/testing/applications/${apps[FINN]}/withdraw`)).status, 404, "another member's application");
  // Mutation checked: let withdraw leave a picked application picked → Finn's withdraw answers 409.
  const out = await call(w, FINN, 'POST', `/testing/applications/${apps[FINN]}/withdraw`);
  assert.deepEqual([out.status, out.body.application.status], [200, 'withdrawn']);
  assert.equal((await call(w, FINN, 'POST', `/testing/applications/${apps[FINN]}/withdraw`)).status, 409, 'once');
  assert.equal((await call(w, ACME, 'POST', `/partner/testing/applications/${apps[FAY]}/pick`)).status, 200, 'the freed place');
  const declined = await call(w, ACME, 'POST', `/partner/testing/applications/${apps[FRAN]}/decline`);
  assert.equal(declined.body.application.status, 'declined');
  const view = (await call(w, ACME, 'GET', `/partner/testing/programmes/${uid}/applicants`)).body;
  assert.deepEqual(view.items.map((a: any) => [a.name, a.status]), [['Fran Ruiz', 'declined'], ['Fay Wu', 'picked']], 'no withdrawn row');
  assert.ok(!JSON.stringify(view).includes('@example.test'), 'no email reaches the owner');
});

test('every change appends one event and tells the bell', async () => {
  // Mutation checked: drop the eventAfter statement from the pick batch → no picked:<ACME> event.
  const w = world();
  const uid = await openPartnerProgramme(w);
  const app = (await applyAs(w, FRAN, uid)).body.application.uid;
  const finn = (await applyAs(w, FINN, uid)).body.application.uid;
  await call(w, ACME, 'POST', `/partner/testing/applications/${app}/pick`);
  await call(w, ACME, 'POST', `/partner/testing/applications/${app}/decline`);
  await call(w, FINN, 'POST', `/testing/applications/${finn}/withdraw`);
  await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/close`);
  assert.deepEqual(events(w), [`created:${ACME}`, `submitted:${ACME}`, `approved:${HQ}`, `opened:${HQ}`,
    `applied:${FRAN}`, `applied:${FINN}`, `picked:${ACME}`, `declined:${ACME}`, `withdrawn:${FINN}`, `closed:${HQ}`]);
  // A refused change writes no event.
  const before = events(w).length;
  await call(w, HQ, 'POST', `/admin/testing/programmes/${uid}/close`);
  await applyAs(w, FRAN, uid);
  assert.equal(events(w).length, before);
  assert.deepEqual(bell(w, FRAN), ['testing_applied', 'testing_picked', 'testing_not_picked']);
  assert.deepEqual(bell(w, ACME), ['testing_programme_approved']);
  // D814 (#2260): a member's notification opens My applications; the creator's names no page yet.
  // Mutation checked: drop `link` from tell's notify → every link is null.
  const links = (user: number) => w.db.prepare('SELECT link FROM notifications_inbox WHERE user_id = ? ORDER BY id').all(user).map((r: any) => r.link);
  assert.deepEqual(links(FRAN), [MY_APPLICATIONS_LINK, MY_APPLICATIONS_LINK, MY_APPLICATIONS_LINK]);
  assert.equal(MY_APPLICATIONS_LINK, '/product-testing?tab=applications');
  assert.deepEqual(links(ACME), [null]);
});

test('the testers audience is the picked applicants who consented; the summary counts what the caller can join', async () => {
  // Mutation checked: drop `consent_email_at IS NOT NULL` from testersAudience → Finn (no consent) is in the list.
  const w = world();
  const uid = await openPartnerProgramme(w, { places: 3 });
  const apps: Record<number, string> = {};
  apps[FRAN] = (await applyAs(w, FRAN, uid, true)).body.application.uid;
  apps[FINN] = (await applyAs(w, FINN, uid, false)).body.application.uid;
  apps[FAY] = (await applyAs(w, FAY, uid, true)).body.application.uid;
  assert.deepEqual(await testersAudience(w.env, uid), [], 'nobody picked yet');
  for (const who of [FRAN, FINN]) await call(w, ACME, 'POST', `/partner/testing/applications/${apps[who]}/pick`);
  assert.deepEqual(await testersAudience(w.env, uid), [
    { user_id: FRAN, email: `u${FRAN}@example.test`, name: 'Fran Ruiz', first_name: 'Fran', consent_version: CONSENT_VERSION },
  ]);
  await call(w, FRAN, 'POST', `/testing/applications/${apps[FRAN]}/withdraw`);
  assert.deepEqual(await testersAudience(w.env, uid), [], 'a withdrawn tester leaves the list');
  // The Studio card's read.
  await openPartnerProgramme(w, { product_name: 'Payroll beta' });
  await openPartnerProgramme(w, { product_name: 'Investor tool', eligible_roles: ['investor'] });
  const s = (await call(w, FINN, 'GET', '/testing/summary')).body;
  assert.equal(s.open_count, 2, 'two open to founders');
  assert.deepEqual(s.picked.map((p: any) => p.product_name), ['Ledger beta']);
  assert.equal((await call(w, IVY, 'GET', '/testing/summary')).body.open_count, 1);
});
