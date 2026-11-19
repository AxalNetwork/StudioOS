/**
 * D5454 (#5454, ADP-01) — the private preparation boundary, on real `node:sqlite` with the full baseline schema and
 * the D5454 migration, through the real `deals` router. Every company, venture, person, title and amount is invented.
 *
 * What it proves, by acceptance criterion of #5454:
 *   AC1  a synthetic private draft (title, amount, description) reaches no deal list, count, funnel, pass or stage
 *        analytics, screening desk, studio lens, invitation inbox, transfer list, search hit set or index, for any
 *        viewer; a deal with unknown/corrupt preparation metadata answers 404 on every by-id route, for admins too.
 *   AC2  a published r1 stays the reader-visible revision while a private r2 is the working revision; the deal id and
 *        the commitment ids do not change.
 *   AC3  wrong deployment scope, a forged/mismatched company, a frozen admin, a support session, the partner and
 *        investor licences and preview mode never expand preparation capability.
 *   AC4  a stage move (PUT and the CRM system door) leaves publication state untouched and never rewrites the terms
 *        a release owns.
 *   AC5  every legacy fixture (visible, invited, funded/signed, unknown exposure, archived, no issuer) has its
 *        documented outcome, and no review or approval is recorded for any of them.
 *   AC6  the migration provisions a clean database and upgrades a populated one without touching legacy rows, is
 *        re-runnable, and a pre-D5454 reader (mixed version / rollback) still cannot list a never-released draft.
 *   AC7  the admin queue paginates beyond one page with a deterministic tie-breaker, counts the same filtered
 *        population, never crosses deployment scope, and costs exactly QUEUE_QUERY_COUNT statements per page.
 *
 * MUTATION CHECKS (each was run; each turns at least one test here red):
 *   M1  delete the `deals.use('/:id/*', …)` guard in routes/deals.ts            → "by-id routes answer 404" fails
 *   M2  return `new Set()` from hiddenDealIds                                    → list/funnel/inbox tests fail
 *   M3  drop the investor `unlisted` filter in GET /api/deals                    → "withdrawn release" test fails
 *   M4  remove `NOT IN json_each(${hidden})` from the funnel query               → funnel count test fails
 *   M5  make classifyPreparation return 'listed' for an unknown publication_state → corrupt-metadata tests fail
 *   M6  drop the `row.scope_code !== deploymentScope(env)` check                 → capability scope test fails
 *   M7  drop the `company_mismatch` comparison in resolveIssuerPair              → issuer pair test fails
 *   M8  remove the editorial lock in PUT /:id or in runSystemMove                → AC4 tests fail
 *   M9  drop CHECK dp_private_owns_no_deal from the migration                    → schema test fails
 *   M10 drop the transactional `withoutHidden` filter in GET /api/deals          → deal list test fails
 *   M11 widen the hidden-set SQL (`OR origin IS 'legacy_attach'`)                → list, counts and lens tests fail
 *   M12 drop the `dealHiddenFrom` check in dealFlow's liveDeal                   → deal-flow test fails
 *   M13 remove a row from D5454.md's inventory → scripts/check-deal-preparation-readers.mjs fails (test:guards)
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_preparation_5454.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import deals from '../src/routes/deals.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { runSystemMove } from '../src/services/dealTransitions.ts';
import { readStudioLens } from '../src/services/dealStudioLens.ts';
import { addToFlow, scopeFor } from '../src/services/dealFlow.ts';
import {
  classifyLegacyDeal, classifyPreparation, dealHiddenFrom, hiddenDealIds, issuerDrift, LEGACY_INVENTORY_SQL,
  PREPARATION_CAPABILITIES, PREPARATION_MUTATIONS_ENABLED, preparationCapabilities, project, QUEUE_QUERY_COUNT,
  readPreparationQueue, resolveIssuerPair, HIDDEN_SET_MAX,
} from '../src/services/dealPreparation.ts';
import { d1Over } from './_d1_sqlite.mjs';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIG = (f: string) => read(`cloudflare-worker/sql/migrations/${f}`);
const D5454 = MIG('202611150148_5454_deal_preparations.sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ADMIN = 1, PARTNER = 2, INV_REL = 3, INV_OUT = 4, FOUNDER = 5;
const ROLE: Record<number, string> = { 1: 'admin', 2: 'partner', 3: 'investor', 4: 'investor', 5: 'founder' };
const VIEWERS: Array<[string, number]> = [['admin', ADMIN], ['partner', PARTNER], ['related investor', INV_REL], ['other investor', INV_OUT], ['founder', FOUNDER]];

// The private draft's content: none of these strings may leave any reader.
const DRAFT_TITLE = 'Zephyr Quill Private Round';
const DRAFT_AMOUNT = '7777777';
const DRAFT_SECRET = 'Unreleased draft narrative';
const R2_TITLE = 'Glacier Working Terms r2';
const R1_DESCRIPTION = 'Released teaser one';
const PRIVATE_LEAKS = [DRAFT_TITLE, DRAFT_AMOUNT, DRAFT_SECRET, R2_TITLE];

/** Deals: 1 legacy visible, 2 legacy invited, 3 legacy funded/signed, 4 published r1 (+ private r2), 5 withdrawn, 6 corrupt metadata, 7 legacy attached. */
const LEGACY_VISIBLE = 1, LEGACY_INVITED = 2, LEGACY_FUNDED = 3, PUBLISHED = 4, WITHDRAWN = 5, CORRUPT = 6, ATTACHED = 7;

function baseDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of ['335_deal_transfers_and_closing_checklists.sql', '340_deal_transfer_company.sql', '599_deal_currency.sql',
    '336_deal_source.sql', '202611101052_deal_stage_event_source.sql',
    '202611161150_6889_deal_transfer_phone_verifier.sql']) db.exec(MIG(f));
  try { db.exec('ALTER TABLE company_profiles ADD COLUMN archived_at TEXT'); } catch { /* already in the baseline */ }
  db.exec(`
    INSERT INTO founders (id, name, email) VALUES (50, 'Fay Founder', 'fay@example.test');
    INSERT INTO users (id, role, name, email, founder_id, is_active, investor_tier) VALUES
      (1, 'admin', 'Ada Admin', 'ada@example.test', NULL, 1, 'professional'),
      (2, 'partner', 'Pia Partner', 'pia@example.test', NULL, 1, 'professional'),
      (3, 'investor', 'Ivy Related', 'ivy@example.test', NULL, 1, 'professional'),
      (4, 'investor', 'Oto Outside', 'oto@example.test', NULL, 1, 'professional'),
      (5, 'founder', 'Fay Founder', 'fay@example.test', 50, 1, 'professional');
    INSERT INTO company_profiles (id, uid, company_name) VALUES (70, 'co-70', 'Harbor Ledger Inc'), (71, 'co-71', 'Other Issuer Inc'), (72, 'co-72', 'Archived Issuer Inc');
    UPDATE company_profiles SET archived_at = '2026-10-01 00:00:00' WHERE id = 72;
    INSERT INTO projects (id, name, founder_id, company_id, sector) VALUES
      (10, 'Harbor Ledger', 50, 70, 'fintech'), (11, 'Unincorporated Idea', 50, NULL, 'health'),
      (13, 'Other Venture', NULL, 71, 'climate'), (14, 'Archived Venture', NULL, 72, 'retail');
    INSERT INTO projects (id, name, founder_id, company_id, deleted_at) VALUES (12, 'Deleted Venture', NULL, 70, '2026-09-01 00:00:00');
    INSERT INTO deals (id, uid, project_id, status, description, amount) VALUES
      (1, 'd1', 13, 'active', 'Legacy listing', 100000), (2, 'd2', 13, 'active', 'Legacy invited', 200000),
      (3, 'd3', 13, 'funded', 'Legacy funded', 300000), (4, 'd4', 10, 'active', '${R1_DESCRIPTION}', 400000),
      (5, 'd5', 13, 'active', 'Withdrawn release', 500000), (6, 'd6', 13, 'rejected', 'Corrupt metadata', 600000),
      (7, 'd7', 13, 'scored', 'Legacy attached', 700000), (8, 'd8', 12, 'active', 'Archived venture deal', 800000);
    UPDATE deals SET pass_reason = 'valuation', passed_at = '2026-10-02 00:00:00' WHERE id = 6;
    INSERT INTO deal_invitations (deal_id, investor_user_id, status, created_at) VALUES
      (2, 3, 'invited', '2026-10-02 09:00:00'), (6, 3, 'invited', '2026-10-02 09:00:00');
    INSERT INTO commitments (id, deal_id, investor_user_id, amount, status, created_at) VALUES
      (901, 3, 3, 50000, 'confirmed', '2026-10-05 09:00:00'), (902, 5, 3, 25000, 'confirmed', '2026-10-05 09:00:00'),
      (903, 4, 3, 10000, 'pending', '2026-10-06 09:00:00');
    INSERT INTO legal_documents (id, deal_id, type, status) VALUES (31, 3, 'subscription', 'signed');
  `);
  return db;
}

function withPreparations(db: DatabaseSync): DatabaseSync {
  db.exec(D5454);
  db.exec(`
    INSERT INTO deal_preparations (id, uid, scope_code, company_id, project_id, deal_id, origin, preparation_state, publication_state, created_by_user_id)
      VALUES (100, 'prep-draft', 'hq', 70, 10, NULL, 'preparation', 'draft', 'unreleased', 1);
    INSERT INTO deal_preparation_revisions (id, uid, preparation_id, revision_no, company_id, project_id, content_json, content_sha256, created_by_user_id)
      VALUES (1000, 'rev-draft-1', 100, 1, 70, 10, json_object('title', '${DRAFT_TITLE}', 'target_raise', ${DRAFT_AMOUNT}, 'description', '${DRAFT_SECRET}'), '${'a'.repeat(64)}', 1);
    UPDATE deal_preparations SET working_revision_id = 1000 WHERE id = 100;

    INSERT INTO deal_preparations (id, uid, scope_code, company_id, project_id, deal_id, origin, preparation_state, publication_state, created_by_user_id)
      VALUES (104, 'prep-pub', 'hq', 70, 10, NULL, 'preparation', 'draft', 'unreleased', 1);
    INSERT INTO deal_preparation_revisions (id, uid, preparation_id, revision_no, company_id, project_id, content_json, content_sha256, created_by_user_id) VALUES
      (1041, 'rev-pub-1', 104, 1, 70, 10, json_object('title', 'Harbor Ledger Seed', 'description', '${R1_DESCRIPTION}', 'internal_notes', 'staff only'), '${'b'.repeat(64)}', 1),
      (1042, 'rev-pub-2', 104, 2, 70, 10, json_object('title', '${R2_TITLE}', 'target_raise', ${DRAFT_AMOUNT}), '${'c'.repeat(64)}', 1);
    UPDATE deal_preparations SET deal_id = 4, released_revision_id = 1041, approved_revision_id = 1041, working_revision_id = 1042,
      publication_state = 'published', preparation_state = 'draft', released_at = '2026-10-10 00:00:00' WHERE id = 104;

    INSERT INTO deal_preparations (id, uid, scope_code, company_id, project_id, deal_id, origin, publication_state, released_revision_id, created_by_user_id)
      VALUES (105, 'prep-wd', 'hq', 71, 13, 5, 'legacy_attach', 'withdrawn', 1051, 1);
    INSERT INTO deal_preparations (id, uid, scope_code, company_id, project_id, deal_id, origin, publication_state, created_by_user_id)
      VALUES (107, 'prep-att', 'hq', 71, 13, 7, 'legacy_attach', 'unreleased', 1);
  `);
  // A row no current writer can produce: unknown publication state, written past the CHECK (a mixed-version or
  // corrupted write). It must read as private, never as published.
  db.exec('PRAGMA ignore_check_constraints = ON');
  db.exec(`INSERT INTO deal_preparations (id, uid, scope_code, company_id, project_id, deal_id, origin, publication_state, created_by_user_id)
           VALUES (106, 'prep-bad', 'hq', 71, 13, 6, 'legacy_attach', 'mystery', 1)`);
  db.exec('PRAGMA ignore_check_constraints = OFF');
  return db;
}

const freshDb = () => withPreparations(baseDb());

const app = (() => {
  const a = new Hono();
  a.route('/api/deals', deals as any);
  a.onError((err: any, c) => {
    if (err instanceof Response) return err;
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    return st ? c.json({ detail: err.message }, st) : c.json({ detail: 'Internal server error', m: String(err?.message) }, 500);
  });
  return a;
})();

async function call(db: DatabaseSync, who: number | null, path: string, init: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (who !== null) {
    const tok = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    headers.Authorization = `Bearer ${tok}`;
  }
  const res = await app.fetch(new Request(`http://x/api/deals${path}`, {
    method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* asserted on text */ }
  return { status: res.status, body, text };
}

const noLeak = (label: string, text: string) => { for (const s of PRIVATE_LEAKS) assert.ok(!text.includes(s), `${label} leaks ${s}`); };
const env = (db: DatabaseSync, extra: Record<string, unknown> = {}) => ({ DB: d1Over(db), ...extra }) as any;
const user = (id: number, extra: Record<string, unknown> = {}) => ({ id, role: ROLE[id], founder_id: id === FOUNDER ? 50 : null, ...extra }) as any;

// ------------------------------------------------------------------------------------------------ AC1 / AC2

test('AC1 · the deal list: no viewer reads the private draft, r2 or the corrupt deal; the withdrawn release lists only to staff and the related investor', async () => {
  const db = freshDb();
  try {
    for (const [label, who] of VIEWERS) {
      const r = await call(db, who, '');
      assert.equal(r.status, 200, `${label}: ${r.text}`);
      noLeak(label, r.text);
      const ids = new Set((r.body as any[]).map((d) => Number(d.id)));
      assert.ok(!ids.has(CORRUPT), `${label} lists the deal with unknown preparation metadata`);
      if (who === ADMIN || who === PARTNER || who === INV_REL) assert.ok(ids.has(WITHDRAWN), `${label} lost the withdrawn release`);
      if (who === INV_OUT) assert.ok(!ids.has(WITHDRAWN), 'an unrelated investor discovers a withdrawn release');
      if (who !== FOUNDER) {
        for (const id of [LEGACY_VISIBLE, LEGACY_INVITED, LEGACY_FUNDED, PUBLISHED, ATTACHED]) assert.ok(ids.has(id), `${label} lost deal ${id}`);
        // AC2: the reader-visible description is r1's while r2 is the working revision.
        assert.equal((r.body as any[]).find((d) => Number(d.id) === PUBLISHED).description, R1_DESCRIPTION);
      }
    }
    // The founder's own venture (project 10) is the published deal; the founder reads it.
    const f = await call(db, FOUNDER, '');
    assert.deepEqual((f.body as any[]).map((d) => Number(d.id)), [PUBLISHED]);
  } finally { db.close(); }
});

test('AC1 · counts and analytics: the funnel, pass analytics and screening count the same population the list shows', async () => {
  const db = freshDb();
  try {
    const admin = await call(db, ADMIN, '/funnel');
    assert.equal(admin.status, 200, admin.text);
    // Staff: deals 1,2,3,4,5,7 (6 is corrupt, 8's venture is deleted).
    assert.equal(admin.body.total, 6);
    const outside = await call(db, INV_OUT, '/funnel');
    assert.equal(outside.body.total, 5, 'the withdrawn release is not counted for discovery');
    const rejected = admin.body.stages.find((s: any) => s.stage === 'rejected');
    assert.equal(rejected.count, 0, 'the corrupt (rejected) deal is counted');
    for (const [label, who] of VIEWERS) {
      for (const path of ['/funnel', '/pass-analytics', '/pass-analytics?reason=valuation', '/stage-analytics', '/screening']) {
        const r = await call(db, who, path);
        noLeak(`${label} ${path}`, r.text);
        if (r.status === 200 && path.startsWith('/pass-analytics')) {
          assert.equal(r.body.total, 0, `${label} ${path} counts the hidden pass`);
          assert.ok(!(r.body.deals || []).some((d: any) => Number(d.id) === CORRUPT), `${label} ${path} names the hidden pass`);
        }
        if (r.status === 200 && path === '/screening') {
          assert.ok(!r.body.desk.rows.some((x: any) => x.deal_id === CORRUPT), `${label} screening lists the hidden deal`);
        }
      }
    }
  } finally { db.close(); }
});

test('AC1 · the invitation inbox and the transfer list never carry a hidden deal', async () => {
  const db = freshDb();
  try {
    db.exec(`INSERT INTO deal_transfers (uid, deal_id, amount_cents, recorded_by, recorded_at) VALUES ('t-6', 6, 100, 1, '2026-10-07 00:00:00'), ('t-3', 3, 200, 1, '2026-10-07 00:00:00')`);
    const inbox = await call(db, INV_REL, '/invitations/mine');
    assert.equal(inbox.status, 200, inbox.text);
    assert.deepEqual(inbox.body.map((r: any) => Number(r.deal_id)), [LEGACY_INVITED]);
    for (const who of [ADMIN, INV_REL]) {
      const t = await call(db, who, '/transfers');
      assert.equal(t.status, 200, t.text);
      assert.ok(!t.body.items.some((x: any) => Number(x.deal_id) === CORRUPT), `${ROLE[who]} reads a hidden deal's transfer`);
    }
  } finally { db.close(); }
});

test('AC1 · by-id routes answer 404 for a deal whose preparation is not released, reads and writes, for every viewer, naming nothing', async () => {
  const db = freshDb();
  try {
    for (const [label, who] of VIEWERS) {
      for (const path of [`/${CORRUPT}`, `/${CORRUPT}abc`, `/${CORRUPT}/commitments`, `/${CORRUPT}/activity`, `/${CORRUPT}/invitations`, `/${CORRUPT}/documents`]) {
        const r = await call(db, who, path);
        assert.equal(r.status, 404, `${label} ${path}: ${r.status} ${r.text}`);
      }
      const w = await call(db, who, `/${CORRUPT}/invitations`, { method: 'POST', body: { investor_user_id: INV_OUT } });
      assert.equal(w.status, 404, `${label} writes an invitation on a hidden deal: ${w.text}`);
    }
    const before = db.prepare('SELECT COUNT(*) AS n FROM deal_invitations WHERE deal_id = ?').get(CORRUPT) as any;
    assert.equal(Number(before.n), 1, 'nothing was written');
    // Unauthenticated: a visible deal keeps its route's 401; a hidden one is answered 404 with nothing named.
    assert.equal((await call(db, null, `/${LEGACY_VISIBLE}`)).status, 401);
    const anon = await call(db, null, `/${CORRUPT}`);
    assert.equal(anon.status, 404);
    assert.deepEqual(anon.body, { error: 'Deal not found' });
    // A withdrawn release stays readable to the investor who committed, and is still refused to an unrelated one.
    assert.equal((await call(db, INV_REL, `/${WITHDRAWN}`)).status, 200);
    assert.equal((await call(db, INV_OUT, `/${WITHDRAWN}`)).status, 403);
  } finally { db.close(); }
});

test('AC1 · the studio lens and the search/index hidden sets leave the hidden deal out', async () => {
  const db = freshDb();
  try {
    const lens = await readStudioLens(env(db), user(PARTNER));
    assert.ok(!lens.rows.some((r: any) => r.id === CORRUPT));
    assert.ok(lens.rows.some((r: any) => r.id === WITHDRAWN), 'staff keep the withdrawn release on the lens');
    noLeak('lens', JSON.stringify(lens));
    // routes/search.ts drops deal hits in this set; services/vectorize.ts deletes the vector when this says hidden.
    assert.deepEqual([...await hiddenDealIds(env(db), 'discovery')].sort(), [WITHDRAWN, CORRUPT]);
    assert.deepEqual([...await hiddenDealIds(env(db), 'transactional')], [CORRUPT]);
    assert.equal(await dealHiddenFrom(env(db), CORRUPT, 'discovery'), true);
    assert.equal(await dealHiddenFrom(env(db), PUBLISHED, 'discovery'), false);
    assert.equal(await dealHiddenFrom(env(db), LEGACY_VISIBLE, 'discovery'), false);
    const search = read('cloudflare-worker/src/routes/search.ts');
    assert.match(search, /hiddenDealIds\(c\.env, isDealStaff\(user\) \? 'transactional' : 'discovery'\)/);
    assert.match(read('cloudflare-worker/src/services/vectorize.ts'), /dealHiddenFrom\(env, id, 'discovery'\)\) \{ await deleteEntity/);
  } finally { db.close(); }
});

test('AC2 · r1 stays released while r2 is edited; deal and commitment ids are unchanged; projections read only their own pointer', async () => {
  const db = freshDb();
  try {
    const prep = db.prepare('SELECT * FROM deal_preparations WHERE id = 104').get() as any;
    assert.equal(prep.deal_id, PUBLISHED);
    assert.equal(prep.released_revision_id, 1041);
    assert.equal(prep.working_revision_id, 1042);
    const r1 = { id: 1041, content: { title: 'Harbor Ledger Seed', description: R1_DESCRIPTION, internal_notes: 'staff only', smuggled: 'x' } };
    const r2 = { id: 1042, content: { title: R2_TITLE } };
    assert.deepEqual(project('investor', prep, r1)!.content, { title: 'Harbor Ledger Seed', description: R1_DESCRIPTION });
    assert.equal(project('investor', prep, r2), null, 'an audience projection of the working revision');
    assert.equal(project('marketplace_teaser', prep, r2), null);
    assert.equal(project('authoring', prep, r2)!.content.title, R2_TITLE);
    assert.equal(project('review', prep, r1), null, 'nothing is submitted, so there is no review projection');
    assert.ok(!('internal_notes' in project('investor', prep, r1)!.content));
    assert.ok(!('smuggled' in project('authoring', prep, { id: 1042, content: { title: R2_TITLE, smuggled: 'x' } })!.content));
    const withdrawn = db.prepare('SELECT * FROM deal_preparations WHERE id = 105').get() as any;
    assert.equal(project('marketplace_teaser', withdrawn, { id: 1051, content: { title: 'x' } }), null);
    const ids = (db.prepare('SELECT id FROM commitments ORDER BY id').all() as any[]).map((r) => r.id);
    assert.deepEqual(ids, [901, 902, 903]);
    const r = await call(db, INV_REL, `/${PUBLISHED}`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.id, PUBLISHED);
    assert.equal(r.body.description, R1_DESCRIPTION);
    noLeak('published deal page', r.text);
  } finally { db.close(); }
});

// ------------------------------------------------------------------------------------------------ AC3

test('AC3 · capability: only an admin on its own deployment, outside a support session, holds read; nothing grants a mutation yet', () => {
  const hq = { scope_code: 'hq' };
  const ok = { writesFrozen: false };
  assert.deepEqual([...preparationCapabilities({}, user(ADMIN), hq, ok)], ['read']);
  assert.deepEqual([...preparationCapabilities({}, user(ADMIN), hq, { writesFrozen: true })], ['read'], 'a frozen admin keeps read only');
  assert.equal(preparationCapabilities({}, user(ADMIN, { support_session: true }), hq, ok).size, 0, 'a support session');
  assert.equal(preparationCapabilities({ BRANCH_CODE: 'north' }, user(ADMIN), hq, ok).size, 0, 'a branch admin on an HQ row');
  assert.equal(preparationCapabilities({}, user(ADMIN), { scope_code: 'north' }, ok).size, 0, 'an HQ admin on a branch row');
  for (const who of [PARTNER, INV_REL, FOUNDER]) {
    assert.equal(preparationCapabilities({}, user(who), hq, ok).size, 0, ROLE[who]);
    assert.equal(preparationCapabilities({}, user(who, { licences: ['partner', 'investor', 'founder'] }), hq, { ...ok, previewMode: true }).size, 0, `${ROLE[who]} with every licence in preview mode`);
  }
  assert.deepEqual(PREPARATION_CAPABILITIES, ['read', 'create', 'edit', 'submit', 'review', 'publish', 'withdraw']);
  for (const v of Object.values(PREPARATION_MUTATIONS_ENABLED)) assert.equal(v, false);
  // No route writes a preparation in this package.
  for (const f of ['routes/deals.ts', 'routes/search.ts', 'services/dealStudioLens.ts', 'services/dealTransitions.ts', 'services/dealPreparation.ts']) {
    assert.doesNotMatch(read(`cloudflare-worker/src/${f}`), /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+deal_preparation/i, f);
  }
});

test('AC3 · issuer pair: the project’s own company only; no company, a mismatched or archived company and a deleted venture are refused', async () => {
  const db = freshDb();
  try {
    const e = env(db);
    assert.deepEqual(await resolveIssuerPair(e, { company_id: 70, project_id: 10 }), { ok: true, company_id: 70, project_id: 10 });
    assert.deepEqual(await resolveIssuerPair(e, { company_id: 71, project_id: 10 }), { ok: false, code: 'company_mismatch' });
    assert.deepEqual(await resolveIssuerPair(e, { company_id: 70, project_id: 11 }), { ok: false, code: 'project_has_no_company' });
    assert.deepEqual(await resolveIssuerPair(e, { company_id: 70, project_id: 12 }), { ok: false, code: 'project_not_found' });
    assert.deepEqual(await resolveIssuerPair(e, { company_id: 72, project_id: 14 }), { ok: false, code: 'company_archived' });
    assert.deepEqual(await resolveIssuerPair(e, { company_id: '70 OR 1=1', project_id: 10 }), { ok: false, code: 'invalid_pair' });
    // A project move after release: the pinned revision keeps its party; the drift is reported, never rewritten.
    db.exec('UPDATE projects SET company_id = 71 WHERE id = 10');
    const pinned = db.prepare('SELECT company_id, project_id FROM deal_preparation_revisions WHERE id = 1041').get() as any;
    assert.equal(pinned.company_id, 70);
    assert.equal(issuerDrift(pinned, db.prepare('SELECT company_id FROM projects WHERE id = 10').get() as any), 'moved');
    db.exec('UPDATE projects SET company_id = NULL WHERE id = 10');
    assert.equal(issuerDrift(pinned, db.prepare('SELECT company_id FROM projects WHERE id = 10').get() as any), 'detached');
  } finally { db.close(); }
});

// ------------------------------------------------------------------------------------------------ AC4

test('AC4 · a stage move through PUT leaves publication untouched; an editorial term on a managed deal is refused whole', async () => {
  const db = freshDb();
  try {
    const before = JSON.stringify(db.prepare('SELECT * FROM deal_preparations WHERE id = 104').get());
    const terms = await call(db, ADMIN, `/${PUBLISHED}`, { method: 'PUT', body: { description: 'rewritten', notes: 'n' } });
    assert.equal(terms.status, 409, terms.text);
    assert.equal(terms.body.error, 'preparation_managed_terms');
    const row = db.prepare('SELECT description, notes FROM deals WHERE id = ?').get(PUBLISHED) as any;
    assert.equal(row.description, R1_DESCRIPTION);
    assert.equal(row.notes, null, 'nothing in the refused request landed');
    const move = await call(db, ADMIN, `/${PUBLISHED}`, { method: 'PUT', body: { status: 'funded' } });
    assert.equal(move.status, 200, move.text);
    assert.equal((db.prepare('SELECT status FROM deals WHERE id = ?').get(PUBLISHED) as any).status, 'funded');
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM deal_preparations WHERE id = 104').get()), before);
    // A legacy deal with no preparation keeps today's editable terms.
    const legacy = await call(db, ADMIN, `/${LEGACY_VISIBLE}`, { method: 'PUT', body: { description: 'edited legacy' } });
    assert.equal(legacy.status, 200, legacy.text);
  } finally { db.close(); }
});

test('AC4 · a CRM pull moves the stage but never the terms a release owns, and never the publication state', async () => {
  const db = freshDb();
  try {
    const before = JSON.stringify(db.prepare('SELECT * FROM deal_preparations ORDER BY id').all());
    assert.equal(await runSystemMove(env(db), { dealId: PUBLISHED, to: 'scored', source: 'hubspot', fields: { amount: 999 } }), 'moved');
    const d = db.prepare('SELECT status, amount FROM deals WHERE id = ?').get(PUBLISHED) as any;
    assert.equal(d.status, 'scored');
    assert.equal(d.amount, 400000);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM deal_preparations ORDER BY id').all()), before);
    // A legacy deal keeps the CRM amount, as before.
    await runSystemMove(env(db), { dealId: LEGACY_VISIBLE, to: 'active', source: 'hubspot', fields: { amount: 123 } });
    assert.equal((db.prepare('SELECT amount FROM deals WHERE id = ?').get(LEGACY_VISIBLE) as any).amount, 123);
  } finally { db.close(); }
});

// ------------------------------------------------------------------------------------------------ AC5

test('AC5 · every legacy fixture has its documented outcome; none records a review or an approval', () => {
  const base = { has_preparation: false, project_deleted: false, project_company_id: 71, invitations: 0, commitments: 0, confirmed_commitments: 0, signed_documents: 0, status: 'active' };
  const cases: Array<[string, any, string]> = [
    ['visible, no relationship', base, 'legacy_visible_unreviewed'],
    ['invited', { ...base, invitations: 1 }, 'legacy_transactional_preserved'],
    ['funded and signed', { ...base, status: 'funded', confirmed_commitments: 1, signed_documents: 1 }, 'legacy_transactional_preserved'],
    ['unknown exposure', { ...base, status: 'mystery' }, 'legacy_unknown_exposure'],
    ['archived venture', { ...base, project_deleted: true, invitations: 2 }, 'legacy_archived'],
    ['no issuer company', { ...base, project_company_id: null }, 'legacy_no_issuer'],
    ['already managed', { ...base, has_preparation: true }, 'preparation_managed'],
  ];
  for (const [label, facts, outcome] of cases) assert.equal(classifyLegacyDeal(facts), outcome, label);
  assert.equal(classifyPreparation(null), 'legacy');
  assert.equal(classifyPreparation({ origin: 'legacy_attach', publication_state: 'unreleased', released_revision_id: null }), 'legacy');
  assert.equal(classifyPreparation({ origin: 'legacy_attach', publication_state: 'mystery', released_revision_id: null }), 'private');
  assert.equal(classifyPreparation({ origin: 'preparation', publication_state: 'unreleased', released_revision_id: null }), 'private');
  assert.equal(classifyPreparation({ origin: 'preparation', publication_state: 'published', released_revision_id: null }), 'private', 'published without a release');
  assert.equal(classifyPreparation({ origin: undefined, publication_state: undefined, released_revision_id: undefined }), 'private');
  assert.equal(classifyPreparation({ origin: 'preparation', publication_state: 'published', released_revision_id: 3 }), 'listed');
  assert.equal(classifyPreparation({ origin: 'preparation', publication_state: 'archived', released_revision_id: 3 }), 'unlisted_released');
});

test('AC5 · the read-only legacy inventory returns counts only and matches the classifier on the fixtures', async () => {
  const db = baseDb();
  try {
    db.exec(D5454);
    const row = db.prepare(LEGACY_INVENTORY_SQL).get() as any;
    assert.deepEqual(Object.keys(row).sort(), ['archived', 'no_issuer', 'transactional', 'unknown_exposure', 'visible_unreviewed']);
    // 2 invited, 3 funded+signed, 4 and 5 committed, 6 invited -> transactional; 1 and 7 visible; 8 archived.
    assert.deepEqual({ ...row }, { archived: 1, unknown_exposure: 0, transactional: 5, no_issuer: 0, visible_unreviewed: 2 });
    assert.doesNotMatch(LEGACY_INVENTORY_SQL, /\b(name|title|description|amount|email)\b/i);
    assert.doesNotMatch(LEGACY_INVENTORY_SQL, /\b(INSERT|UPDATE|DELETE)\b/i);
  } finally { db.close(); }
});

// ------------------------------------------------------------------------------------------------ AC6

test('AC6 · schema: a never-released draft cannot own a deal; distribution needs a release; revisions are immutable and bounded', () => {
  const db = freshDb();
  try {
    const ins = (dealId: string, origin: string, pub: string, rel: string) => () => db.exec(`INSERT INTO deal_preparations
      (uid, scope_code, company_id, project_id, deal_id, origin, publication_state, released_revision_id, created_by_user_id)
      VALUES ('u-${Math.random()}', 'hq', 70, 10, ${dealId}, '${origin}', '${pub}', ${rel}, 1)`);
    assert.throws(ins('8', 'preparation', 'unreleased', 'NULL'), /CHECK/, 'a private draft with a deals row');
    assert.throws(ins('NULL', 'preparation', 'published', 'NULL'), /CHECK/, 'published without a release');
    assert.throws(ins('NULL', 'legacy_attach', 'unreleased', 'NULL'), /CHECK/, 'a legacy attachment with no deal');
    assert.throws(ins('NULL', 'preparation', 'unreleased', '5'), /CHECK/, 'a release with no deal');
    assert.throws(ins('4', 'legacy_attach', 'unreleased', 'NULL'), /UNIQUE/, 'two preparations on one deal');
    assert.throws(() => db.exec(`INSERT INTO deal_preparations (uid, scope_code, company_id, project_id, origin, created_by_user_id) VALUES ('u-x', 'hq', 70, 10, 'imported', 1)`), /CHECK/);
    assert.throws(() => db.exec(`INSERT INTO deal_preparations (uid, scope_code, project_id, origin, created_by_user_id) VALUES ('u-y', 'hq', 10, 'preparation', 1)`), /NOT NULL/, 'no company');
    assert.throws(() => db.exec(`UPDATE deal_preparation_revisions SET content_json = '{}' WHERE id = 1041`), /immutable/);
    assert.throws(() => db.exec('DELETE FROM deal_preparation_revisions WHERE id = 1041'), /immutable/);
    assert.throws(() => db.exec(`INSERT INTO deal_preparation_revisions (uid, preparation_id, revision_no, company_id, project_id, content_json, content_sha256, created_by_user_id)
      VALUES ('r-big', 100, 2, 70, 10, json_object('t', '${'x'.repeat(70000)}'), '${'d'.repeat(64)}', 1)`), /CHECK/, 'content over 64 KiB');
    for (const idx of ['idx_deal_preparations_deal', 'idx_deal_preparations_queue', 'idx_deal_preparations_publication', 'idx_deal_preparations_issuer', 'idx_deal_preparation_revisions_prep']) {
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(idx), idx);
    }
  } finally { db.close(); }
});

test('AC6 · clean provisioning and upgrade: the migration adds tables only, leaves legacy rows byte-identical and re-runs', () => {
  const clean = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  try {
    clean.exec(BASELINE);
    clean.exec(D5454);
    clean.exec(D5454);
  } finally { clean.close(); }
  const db = baseDb();
  try {
    const snap = () => JSON.stringify(['deals', 'commitments', 'deal_invitations', 'projects', 'company_profiles', 'legal_documents']
      .map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()));
    const before = snap();
    db.exec(D5454);
    db.exec(D5454);
    assert.equal(snap(), before);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM deal_preparations').get() as any).n, 0, 'nothing is backfilled');
    assert.doesNotMatch(D5454, /^\s*(INSERT|UPDATE|DELETE|ALTER|DROP)\b/im, 'statement-level writes or drops');
  } finally { db.close(); }
});

test('AC6 · mixed version and rollback: before the migration nothing is hidden and nothing breaks; an old reader cannot list a never-released draft', async () => {
  const old = baseDb();
  try {
    assert.equal((await hiddenDealIds(env(old), 'discovery')).size, 0);
    const r = await call(old, ADMIN, '');
    assert.equal(r.status, 200, r.text);
    assert.equal((r.body as any[]).length, 7);
  } finally { old.close(); }
  const db = freshDb();
  try {
    // The pre-D5454 list query, verbatim in shape: it has no preparation guard, and still cannot see the draft.
    const legacyList = JSON.stringify(db.prepare('SELECT d.*, p.name AS project_name FROM deals d LEFT JOIN projects p ON p.id = d.project_id').all());
    noLeak('a pre-D5454 build', legacyList);
    // Any other error than the missing table fails closed.
    const broken = { DB: { prepare: () => ({ bind: () => ({ all: async () => { throw new Error('D1_ERROR: network'); }, first: async () => { throw new Error('D1_ERROR: network'); } }) }) } } as any;
    await assert.rejects(hiddenDealIds(broken, 'discovery'), /network/);
    await assert.rejects(dealHiddenFrom(broken, 4, 'transactional'), /network/);
    assert.ok(HIDDEN_SET_MAX >= 1000);
  } finally { db.close(); }
});

// ------------------------------------------------------------------------------------------------ AC7

test('AC7 · the admin queue: scoped, deterministic beyond one page, counted over the same population, two statements a page', async () => {
  const db = freshDb();
  try {
    db.exec('DELETE FROM deal_preparations WHERE id IN (100, 104, 105, 106, 107)');
    const ins = db.prepare(`INSERT INTO deal_preparations (uid, scope_code, company_id, project_id, origin, preparation_state, created_by_user_id, updated_at)
      VALUES (?, ?, 70, 10, 'preparation', ?, 1, ?)`);
    for (let i = 1; i <= 30; i++) ins.run(`q-${i}`, 'hq', i % 3 === 0 ? 'in_review' : 'draft', i <= 12 ? '2026-11-01 10:00:00' : `2026-11-0${1 + (i % 8)} 09:00:00`);
    for (let i = 1; i <= 4; i++) ins.run(`b-${i}`, 'north', 'draft', '2026-11-09 09:00:00');
    let statements = 0;
    const base = d1Over(db);
    const counting = { ...base, prepare: (s: string) => { statements++; return base.prepare(s); } };
    const e = { DB: counting } as any;
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      statements = 0;
      const page = await readPreparationQueue(e, user(ADMIN), { writesFrozen: false }, { limit: 7, cursor });
      assert.ok(page);
      assert.equal(statements, QUEUE_QUERY_COUNT);
      assert.equal(page!.total, 30);
      for (const it of page!.items) { assert.ok(!('content_json' in it) && !('scope_code' in it)); seen.push(it.uid); }
      cursor = page!.next_cursor;
      pages++;
    } while (cursor && pages < 10);
    assert.equal(pages, 5);
    assert.equal(new Set(seen).size, 30);
    assert.ok(seen.every((u) => u.startsWith('q-')), 'a branch row crossed into HQ');
    const again: string[] = [];
    cursor = null;
    do { const p = await readPreparationQueue(e, user(ADMIN), { writesFrozen: false }, { limit: 7, cursor }); again.push(...p!.items.map((x: any) => x.uid)); cursor = p!.next_cursor; } while (cursor);
    assert.deepEqual(again, seen, 'the order is deterministic');
    const review = await readPreparationQueue(e, user(ADMIN), { writesFrozen: false }, { preparation_state: 'in_review', limit: 100 });
    assert.equal(review!.total, 10);
    assert.equal(review!.items.length, 10);
    const branch = await readPreparationQueue({ DB: base, BRANCH_CODE: 'north' } as any, user(ADMIN), { writesFrozen: false }, { limit: 100 });
    assert.equal(branch!.total, 4);
    for (const who of [PARTNER, INV_REL, FOUNDER]) assert.equal(await readPreparationQueue(e, user(who), { writesFrozen: false }), null, ROLE[who]);
    assert.equal(await readPreparationQueue(e, user(ADMIN, { support_session: true }), { writesFrozen: false }), null);
    assert.equal((await readPreparationQueue(e, user(ADMIN), { writesFrozen: false }, { cursor: 'not-a-cursor', limit: 500 }))!.items.length, 30);
  } finally { db.close(); }
});

test('AC1 · an investor cannot add a hidden deal to their deal flow: it reads as no deal at all', async () => {
  const db = freshDb();
  try {
    const scope = scopeFor(user(INV_OUT), null);
    for (const id of [CORRUPT, WITHDRAWN]) {
      await assert.rejects(addToFlow(env(db), scope, { deal_id: id }), (e: any) => e?.code === 'deal_not_found' || /deal_not_found/.test(String(e?.code ?? e?.message)), `deal ${id}`);
    }
  } finally { db.close(); }
});
