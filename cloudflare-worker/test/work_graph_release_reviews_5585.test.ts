/**
 * D5585 part 10 (#5585, WorkGraph P1) — the signed-in reviewer routes: a person linked to a company records their own
 * publish decision, or an attestation, under a release authority part 8's store holds for them there, and reads the
 * manifests awaiting their decision. The real routers over the full migrated schema, with part 2's synthetic world.
 *
 *   1. Flag off: every route refuses 404 `release_review_off` before any D1 read; the mount.
 *   2. Gates: anonymous and revoked accounts are refused by the session; writes need a step-up; a person not linked
 *      to the company, a request naming another tenant, and a person the resolver finds revoked are refused, audited,
 *      and nothing is written.
 *   3. Decisions: no grant, the wrong authority and a Super Admin without a grant are `no_authority`; a stale digest,
 *      the wrong audience, a missing disclosure and a manifest of another tenant are refused; valid decisions count at
 *      publication; a withdrawal stops one counting until the person decides again; replays and key conflicts; audit.
 *   4. Attestations: only under an authority the requirement names and the person holds; a CI requirement is never a
 *      reviewer's; stale digest; the evidence counts in the evaluation.
 *   5. Pending: only manifests the person can decide, not their own, not published, not taken down, and not already
 *      decided by them (a withdrawal puts one back); ids and digests only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_release_reviews_5585.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { CTX, OTHER, OTHER_CTX, T0, attestAll, clock, newLine, piece, type Piece, type W } from './_work_graph_release_world_5585.ts';
import reviews, { mount } from '../src/routes/release_reviews.ts';
import releases from '../src/routes/admin_work_graph_releases.ts';
import { cutManifest, registerReleaseLine, releaseStatus } from '../src/services/workGraphReleases.ts';
import { takedownRelease } from '../src/services/workGraphReleaseTakedowns.ts';
import { grantReleaseAuthority } from '../src/services/workGraphReleaseAuthorities.ts';
import { RELEASE_ADMIN_DEPS, releaseAdminContext } from '../src/services/workGraphReleaseAdmin.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1, AUTHOR = 11, BOB = 12, CAROL = 13, ERIN = 15, OUTSIDER = 17, GONE = 18, MAGIC = 19;
const BASE = '/api/work-graph/releases';
const ADMIN_BASE = '/api/admin/work-graph/releases';
const IN = { tenant_id: 7, company_id: 70 };
const Q = 'tenant_id=7&company_id=70';

function fresh(): W {
  clock.t = T0;
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, ?)');
  u.run(SUPER, 'admin', 'Super', 'super@axal.example', 1);
  for (const id of [AUTHOR, BOB, CAROL, ERIN, OUTSIDER, MAGIC]) u.run(id, 'founder', `P${id}`, `p${id}@example.test`, 1);
  u.run(GONE, 'founder', 'Gone', 'gone@example.test', 0);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER})`);
  const s = db.prepare("INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES (?, ?, 'totp', datetime('now'), datetime('now'))");
  for (const id of [SUPER, AUTHOR, BOB, CAROL, ERIN, OUTSIDER, GONE]) s.run(`s-${id}`, id);
  db.prepare("INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES (?, ?, 'magic_link', datetime('now'), NULL)").run(`s-${MAGIC}`, MAGIC);
  const w = { env: { DB: d1Over(db) } as any, db } as W;
  // Everyone but OUTSIDER (and SUPER, until a test links them) works at company 70; CAROL also at 71.
  for (const id of [AUTHOR, BOB, CAROL, ERIN, GONE, MAGIC]) link(w, 70, id);
  link(w, 71, CAROL);
  return w;
}
function link(w: W, company: number, user: number) {
  w.db.prepare('INSERT INTO user_company_links (uid, company_id, user_id) VALUES (?, ?, ?)').run(`l-${company}-${user}`, company, user);
}
let gk = 0;
async function grant(w: W, user: number, authority: string, scope = { tenantId: 7, companyId: 70 }) {
  const r = await grantReleaseAuthority(w.env, { scope, userId: user, authority, reason: 'Named by the board.', expectedSeq: 0, actorUserId: SUPER, idempotencyKey: `g-${++gk}` });
  assert.ok(r.ok, JSON.stringify(r));
}

function untouchable() {
  const touched: string[] = [];
  const DB = new Proxy({}, { get(_t, k) { touched.push(String(k)); throw new Error(`D1 touched: ${String(k)}`); } });
  return { DB, touched };
}

const app = new Hono<any>();
app.route(BASE, reviews);
app.route(ADMIN_BASE, releases);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, String(err?.message) === 'Unauthorized' ? 401 : 403));

const token = (who: number) => new SignJWT({ user_id: who, role: who === SUPER ? 'admin' : 'founder', jti: `s-${who}` })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
function envOf(w: W | null, over: Record<string, unknown> = {}) {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: w?.env.DB, WORK_GRAPH_RELEASE_ADMIN: 'on', WORK_GRAPH_RELEASE_DELIVERY: 'preview', ...over } as any;
}
async function call(env: any, method: string, path: string, opts: { who?: number | null; body?: unknown; base?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const who = opts.who === undefined ? BOB : opts.who;
  if (who !== null) headers.Authorization = `Bearer ${await token(who)}`;
  const w = console.warn, e = console.error, i = console.info; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try {
    const res = await app.request(`${opts.base ?? BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { console.warn = w; console.error = e; console.info = i; }
}
const n = (w: W, sql: string, ...b: any[]) => Number((w.db.prepare(sql).get(...b) as any).n);
const auditRows = (w: W, action: string) => (w.db.prepare('SELECT admin_user_id, filters_json FROM admin_audit_log WHERE action = ? ORDER BY id').all(action) as any[])
  .map((r) => ({ admin: r.admin_user_id, ...JSON.parse(r.filters_json) }));

/** A public line with a code piece (website) and a marketing piece (copy), both attested. */
async function publicLine(w: W) {
  const website = await piece(w, 'pub-website', 'code', 'public');
  const copy = await piece(w, 'pub-copy', 'document', 'public');
  await attestAll(w, website, ['code']);
  await attestAll(w, copy, ['marketing']);
  return { website, copy, line: await newLine(w, 'line-public', 'public') };
}
async function cut(w: W, line: string, pieces: [Piece, 'code' | 'marketing'][], key: string, author = AUTHOR) {
  clock.t += 60_000; // each manifest a minute after the last, so newest-first is a real order
  const m = await cutManifest(w.env, CTX, {
    lineAssetUid: line, partial: false, author: { kind: 'person', userId: author }, idempotencyKey: key,
    components: pieces.map(([p, profile]) => ({ assetUid: p.asset, revisionUid: p.rev, digest: p.digest, role: profile === 'code' ? 'website' : 'copy', profile })),
  });
  assert.ok(m.ok, JSON.stringify(m));
  return m;
}
const MARKETING_REFS = { rights_ref: 'rights:brand-licence-2026', disclosure_ref: 'disclosure:forward-looking-v2' };
const dec = (m: { digest: string }, profile: string, authority: string, decision: string, key: string, over: Record<string, unknown> = {}) =>
  ({ ...IN, digest: m.digest, audience: 'public', profile, authority, decision, idempotency_key: key, ...(profile === 'marketing' ? MARKETING_REFS : {}), ...over });
const decide = (env: any, who: number, m: { manifestUid: string; digest: string }, profile: string, authority: string, decision: string, key: string, over: Record<string, unknown> = {}) =>
  call(env, 'POST', `/manifests/${m.manifestUid}/decisions`, { who, body: dec(m, profile, authority, decision, key, over) });
const pending = async (env: any, who: number, q = Q) => {
  const r = await call(env, 'GET', `/pending?${q}`, { who });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const missing = async (w: W, uid: string) => {
  const s = await releaseStatus(w.env, await releaseAdminContext(w.env, CTX.scope), uid);
  assert.ok(s.ok);
  return s.release.missingApprovals;
};
const publishBody = (m: { digest: string }, key: string) =>
  ({ ...IN, digest: m.digest, expected_manifest_uid: null, effects: [{ target: 'website_cdn', ref: 'campaign-site' }], idempotency_key: key });

// -------------------------------------------------------------------------------------------------------------------

test('1. flag off: every reviewer route refuses 404 before any D1 read; the router mounts at /api/work-graph/releases', async () => {
  assert.equal(mount.path, '/api/work-graph/releases');
  assert.equal((mount as any).before, undefined);
  const routes: [string, string, unknown?][] = [
    ['GET', `/pending?${Q}`], ['POST', '/manifests/m1/decisions', dec({ digest: 'a'.repeat(64) }, 'code', 'maintainer', 'approve', 'k')],
    ['POST', '/attestations', { ...IN }],
  ];
  for (const flag of [undefined, '', 'true', 'ON', 'off', 'preview']) {
    for (const who of [BOB, SUPER, null]) {
      for (const [method, path, body] of routes) {
        const { DB, touched } = untouchable();
        const r = await call(envOf(null, { DB, WORK_GRAPH_RELEASE_ADMIN: flag }), method, path, { who, body });
        assert.deepEqual([r.status, r.body?.error], [404, 'release_review_off'], `${flag} ${method} ${path}`);
        assert.equal(typeof r.body.message, 'string');
        assert.deepEqual(touched, [], `${method} ${path} touched D1`);
      }
    }
  }
});

test('2. gates: session, step-up, membership, tenant and revocation, each refused before anything is recorded', async () => {
  const w = fresh();
  const env = envOf(w);
  const { website, line } = await publicLine(w);
  const m = await cut(w, line, [[website, 'code']], 'm-gate');
  await grant(w, BOB, 'maintainer');
  await grant(w, MAGIC, 'maintainer');
  const attBefore = n(w, 'SELECT COUNT(*) AS n FROM work_graph_release_attestations');
  const att = { ...IN, revision_uid: website.rev, digest: website.digest, requirement: 'brand_rights', evidence_ref: 'ev:1', authority: 'brand_owner', idempotency_key: 'a' };

  // No session, or a revoked account (users.is_active = 0): the session itself is refused.
  for (const who of [null, GONE]) {
    assert.equal((await call(env, 'GET', `/pending?${Q}`, { who })).status, 401);
    assert.equal((await decide(env, who as any, m, 'code', 'maintainer', 'approve', 'd-x')).status, 401);
    assert.equal((await call(env, 'POST', '/attestations', { who, body: att })).status, 401);
  }
  // An email-link session reads, and cannot write without a step-up.
  assert.equal((await call(env, 'GET', `/pending?${Q}`, { who: MAGIC })).body.pending.length, 1);
  const lazy = await decide(env, MAGIC, m, 'code', 'maintainer', 'approve', 'd-magic');
  assert.deepEqual([lazy.status, lazy.body.detail], [403, 'step_up_required']);
  assert.equal((await call(env, 'POST', '/attestations', { who: MAGIC, body: att })).body.detail, 'step_up_required');

  // Not linked to the company.
  for (const r of [await call(env, 'GET', `/pending?${Q}`, { who: OUTSIDER }), await decide(env, OUTSIDER, m, 'code', 'maintainer', 'approve', 'd-out'),
    await call(env, 'POST', '/attestations', { who: OUTSIDER, body: att })]) {
    assert.deepEqual([r.status, r.body.error], [403, 'not_member']);
    assert.match(r.body.message, /not linked/);
  }
  // Linked to an archived company is not membership either.
  w.db.prepare("INSERT INTO company_profiles (id, uid, company_name, archived_at) VALUES (70, 'co-70', 'Acme', '2026-11-01T00:00:00Z')").run();
  assert.equal((await decide(env, BOB, m, 'code', 'maintainer', 'approve', 'd-arch')).body.error, 'not_member');
  w.db.prepare('DELETE FROM company_profiles WHERE id = 70').run();

  // Company 70's release records live under tenant 7: naming tenant 8 is another tenant.
  const t8 = { tenant_id: 8, company_id: 70 };
  assert.deepEqual([(await call(env, 'GET', '/pending?tenant_id=8&company_id=70')).status, (await call(env, 'GET', '/pending?tenant_id=8&company_id=70')).body.error], [403, 'wrong_tenant']);
  assert.equal((await decide(env, BOB, m, 'code', 'maintainer', 'approve', 'd-t8', t8)).body.error, 'wrong_tenant');
  assert.equal((await call(env, 'POST', '/attestations', { body: { ...att, ...t8 } })).body.error, 'wrong_tenant');

  // Revoked by the resolver (an account revoked while its session is still live): refused here, before the services.
  const real = RELEASE_ADMIN_DEPS.revokedUsers;
  RELEASE_ADMIN_DEPS.revokedUsers = async () => new Set([BOB]);
  try {
    for (const r of [await call(env, 'GET', `/pending?${Q}`), await decide(env, BOB, m, 'code', 'maintainer', 'approve', 'd-rev'),
      await call(env, 'POST', '/attestations', { body: att })]) {
      assert.deepEqual([r.status, r.body.error], [403, 'revoked_author']);
    }
    assert.equal((await decide(env, CAROL, m, 'code', 'maintainer', 'approve', 'd-carol')).body.error, 'no_authority', 'only BOB is revoked');
  } finally { RELEASE_ADMIN_DEPS.revokedUsers = real; }

  // Malformed scope or manifest id.
  assert.equal((await call(env, 'GET', '/pending?tenant_id=7')).status, 400);
  assert.equal((await decide(env, BOB, m, 'code', 'maintainer', 'approve', 'd-bad', { company_id: 'x' })).status, 400);
  const badUid = await call(env, 'POST', `/manifests/${'x'.repeat(81)}/decisions`, { body: dec(m, 'code', 'maintainer', 'approve', 'd-uid') });
  assert.deepEqual([badUid.status, badUid.body.error], [400, 'malformed']);

  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM work_graph_release_decisions'), 0);
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM work_graph_release_attestations'), attBefore);
  assert.deepEqual(auditRows(w, 'work_graph_release_review_decide').map((a) => [a.admin, a.outcome]), [
    [OUTSIDER, 'not_member'], [BOB, 'not_member'], [BOB, 'wrong_tenant'], [BOB, 'revoked_author'], [CAROL, 'no_authority'], [BOB, 'malformed'],
  ], 'every write past the session gate is audited; the step-up refusal and the bad scope are not acts');
  assert.deepEqual(auditRows(w, 'work_graph_release_review_attest').map((a) => [a.admin, a.outcome]), [
    [OUTSIDER, 'not_member'], [BOB, 'wrong_tenant'], [BOB, 'revoked_author'],
  ]);
});

test('3. decisions: only under a held authority, about the digest reviewed; they count at publication; a withdrawal stops one', async () => {
  const w = fresh();
  const env = envOf(w, { FILES: { head: async () => null, put: async () => ({}), delete: async () => {} } });
  const { website, copy, line } = await publicLine(w);
  const m = await cut(w, line, [[website, 'code'], [copy, 'marketing']], 'm1');

  // Nobody holds anything yet: not BOB, and not a Super Admin, linked or not.
  assert.equal((await decide(env, BOB, m, 'code', 'maintainer', 'approve', 'd-0')).body.error, 'no_authority');
  assert.equal((await decide(env, SUPER, m, 'code', 'maintainer', 'approve', 'd-s0')).body.error, 'not_member');
  link(w, 70, SUPER);
  const sup = await decide(env, SUPER, m, 'code', 'maintainer', 'approve', 'd-s1');
  assert.deepEqual([sup.status, sup.body.error], [409, 'no_authority'], 'a Super Admin holds only what was granted to them');
  // A grant in another company or tenant gives nothing here.
  await grant(w, CAROL, 'brand_owner', { tenantId: 7, companyId: 71 });
  assert.equal((await decide(env, CAROL, m, 'marketing', 'brand_owner', 'approve', 'd-c0')).body.error, 'no_authority');

  await grant(w, BOB, 'maintainer');
  await grant(w, CAROL, 'brand_owner');
  // The wrong authority for the profile, or a profile the authority does not approve.
  assert.equal((await decide(env, BOB, m, 'marketing', 'maintainer', 'approve', 'd-1')).body.error, 'no_authority');
  assert.equal((await decide(env, CAROL, m, 'code', 'brand_owner', 'approve', 'd-2')).body.error, 'no_authority');
  // Stale digest, another audience, a marketing approval without its disclosure.
  const stale = await decide(env, BOB, m, 'code', 'maintainer', 'approve', 'd-3', { digest: 'b'.repeat(64) });
  assert.deepEqual([stale.status, stale.body.error, stale.body.ids], [409, 'stale_approval', [m.manifestUid, 'b'.repeat(64)]]);
  assert.equal((await decide(env, BOB, m, 'code', 'maintainer', 'approve', 'd-4', { audience: 'investors' })).body.error, 'audience_forbidden');
  assert.equal((await decide(env, CAROL, m, 'marketing', 'brand_owner', 'approve', 'd-5', { disclosure_ref: null })).body.error, 'approval_incomplete');
  assert.equal((await decide(env, BOB, m, 'code', 'maintainer', 'maybe', 'd-6')).status, 400);
  assert.equal((await call(env, 'POST', '/manifests/nope/decisions', { body: dec(m, 'code', 'maintainer', 'approve', 'd-7') })).status, 404);
  // The author cannot approve their own manifest, though they hold the authority.
  await grant(w, AUTHOR, 'maintainer');
  assert.equal((await decide(env, AUTHOR, m, 'code', 'maintainer', 'approve', 'd-8')).body.error, 'self_approval');
  // A manifest of another tenant, named under this one.
  link(w, 80, BOB);
  const otherLine = await registerReleaseLine(w.env, OTHER_CTX, { scope: OTHER, audience: 'public', actor: { kind: 'person', userId: AUTHOR }, idempotencyKey: 'line-8' });
  assert.ok(otherLine.ok);
  const o = await piece(w, 'other-site', 'code', 'public', { scope: OTHER, ctx: OTHER_CTX });
  const om = await cutManifest(w.env, OTHER_CTX, {
    lineAssetUid: otherLine.lineAssetUid, partial: false, author: { kind: 'person', userId: AUTHOR }, idempotencyKey: 'om',
    components: [{ assetUid: o.asset, revisionUid: o.rev, digest: o.digest, role: 'website', profile: 'code' }],
  });
  assert.ok(om.ok);
  const cross = await decide(env, BOB, om, 'code', 'maintainer', 'approve', 'd-x');
  assert.deepEqual([cross.status, cross.body.error], [403, 'wrong_tenant']);
  assert.equal(n(w, 'SELECT COUNT(*) AS n FROM work_graph_release_decisions'), 0, 'nothing refused was written');

  // Valid decisions, each the person's own row, and they count at publication.
  assert.deepEqual(await missing(w, m.manifestUid), ['code', 'marketing']);
  const ok = await decide(env, BOB, m, 'code', 'maintainer', 'approve', 'd-bob');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.ok, ok.body.replayed, ok.body.scope.tenantId], [true, false, 7]);
  assert.ok(ok.body.cost.d1Statements > 0);
  const replay = await decide(env, BOB, m, 'code', 'maintainer', 'approve', 'd-bob');
  assert.deepEqual([replay.body.decisionId, replay.body.replayed], [ok.body.decisionId, true]);
  assert.equal((await decide(env, BOB, m, 'code', 'maintainer', 'reject', 'd-bob')).body.error, 'idempotency_conflict');
  assert.equal((await decide(env, CAROL, m, 'marketing', 'brand_owner', 'approve', 'd-carol')).status, 200);
  const row = w.db.prepare('SELECT reviewer_user_id, authority, profile, decision, approval_ref, manifest_digest, tenant_id, company_id FROM work_graph_release_decisions WHERE id = ?').get(ok.body.decisionId) as any;
  assert.deepEqual({ ...row }, { reviewer_user_id: BOB, authority: 'maintainer', profile: 'code', decision: 'approve', approval_ref: `release_review:${m.manifestUid}`, manifest_digest: m.digest, tenant_id: 7, company_id: 70 });
  assert.deepEqual(await missing(w, m.manifestUid), []);

  // BOB withdraws his own: the code profile has no live approval, and publication is refused.
  assert.equal((await decide(env, BOB, m, 'code', 'maintainer', 'withdraw', 'd-bob-w')).status, 200);
  assert.deepEqual(await missing(w, m.manifestUid), ['code']);
  const refusedPub = await call(env, 'POST', `/manifests/${m.manifestUid}/publish`, { who: SUPER, base: ADMIN_BASE, body: publishBody(m, 'p-0') });
  assert.deepEqual([refusedPub.status, refusedPub.body.error], [409, 'approval_required']);
  // He decides again; the release publishes.
  assert.equal((await decide(env, BOB, m, 'code', 'maintainer', 'approve', 'd-bob-2')).status, 200);
  const pub = await call(env, 'POST', `/manifests/${m.manifestUid}/publish`, { who: SUPER, base: ADMIN_BASE, body: publishBody(m, 'p-1') });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));

  assert.deepEqual(auditRows(w, 'work_graph_release_review_decide').map((a) => [a.admin, a.outcome]), [
    [BOB, 'no_authority'], [SUPER, 'not_member'], [SUPER, 'no_authority'], [CAROL, 'no_authority'],
    [BOB, 'no_authority'], [CAROL, 'no_authority'], [BOB, 'stale_approval'], [BOB, 'audience_forbidden'], [CAROL, 'approval_incomplete'],
    [BOB, 'malformed'], [BOB, 'not_found'], [AUTHOR, 'self_approval'], [BOB, 'wrong_tenant'],
    [BOB, 'recorded'], [BOB, 'recorded'], [BOB, 'idempotency_conflict'], [CAROL, 'recorded'], [BOB, 'recorded'], [BOB, 'recorded'],
  ]);
  const recorded = auditRows(w, 'work_graph_release_review_decide').filter((a) => a.outcome === 'recorded');
  assert.deepEqual(recorded.map((a) => [a.decision, a.replayed, a.manifest_uid, a.tenant_id, a.company_id]), [
    ['approve', false, m.manifestUid, 7, 70], ['approve', true, m.manifestUid, 7, 70], ['approve', false, m.manifestUid, 7, 70],
    ['withdraw', false, m.manifestUid, 7, 70], ['approve', false, m.manifestUid, 7, 70],
  ]);
  assert.ok(recorded.every((a) => typeof a.decision_id === 'number'));
  assert.equal(n(w, "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'work_graph_release_review_decide'"), 19);
});

test('4. attestations: only under an authority the requirement names and the person holds; never a CI requirement', async () => {
  const w = fresh();
  const env = envOf(w);
  const website = await piece(w, 'a-website', 'code', 'public');
  const copy = await piece(w, 'a-copy', 'document', 'public');
  const line = await newLine(w, 'line-att', 'public');
  const m = await cut(w, line, [[website, 'code'], [copy, 'marketing']], 'm-att');
  const body = (p: Piece, requirement: string, authority: string | null, key: string, over: Record<string, unknown> = {}) =>
    ({ ...IN, revision_uid: p.rev, digest: p.digest, requirement, evidence_ref: `ev:${key}`, authority, idempotency_key: key, ...over });
  const attest = (who: number, b: unknown) => call(env, 'POST', '/attestations', { who, body: b });
  const rows = () => n(w, 'SELECT COUNT(*) AS n FROM work_graph_release_attestations');
  const before = rows();

  await grant(w, BOB, 'maintainer');
  for (const req of ['ci_passed', 'pr_validated']) {
    const r = await attest(BOB, body(website, req, null, `ci-${req}`));
    assert.deepEqual([r.status, r.body.error, r.body.ids], [409, 'no_authority', [website.rev, req]], 'a CI run attests that, not a reviewer');
  }
  assert.equal((await attest(CAROL, body(copy, 'brand_rights', 'brand_owner', 'c-0'))).body.error, 'no_authority', 'no grant yet');
  link(w, 70, SUPER);
  assert.equal((await attest(SUPER, body(copy, 'brand_rights', 'brand_owner', 's-0'))).body.error, 'no_authority', 'a Super Admin without a grant');
  await grant(w, CAROL, 'brand_owner');
  assert.equal((await attest(CAROL, body(copy, 'counsel_review', 'brand_owner', 'c-1'))).body.error, 'no_authority', 'brand_owner does not attest counsel');
  assert.equal((await attest(CAROL, body(copy, 'brand_rights', 'counsel', 'c-2'))).body.error, 'no_authority', 'an authority not held');
  const stale = await attest(CAROL, body(copy, 'brand_rights', 'brand_owner', 'c-3', { digest: 'c'.repeat(64) }));
  assert.deepEqual([stale.status, stale.body.error], [409, 'stale_approval']);
  assert.equal((await attest(CAROL, body(copy, 'nonsense', 'brand_owner', 'c-4'))).status, 400);
  assert.equal(rows(), before);

  const r1 = await attest(CAROL, body(copy, 'brand_rights', 'brand_owner', 'c-5'));
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal((await attest(CAROL, body(copy, 'brand_rights', 'brand_owner', 'c-5'))).body.replayed, true);
  assert.equal((await attest(CAROL, body(copy, 'claims_review', 'brand_owner', 'c-6'))).status, 200);
  const row = w.db.prepare('SELECT actor_kind, actor_user_id, authority, requirement, digest, tenant_id FROM work_graph_release_attestations WHERE id = ?').get(r1.body.attestationId) as any;
  assert.deepEqual({ ...row }, { actor_kind: 'person', actor_user_id: CAROL, authority: 'brand_owner', requirement: 'brand_rights', digest: copy.digest, tenant_id: 7 });
  // Each attestation is the caller's own: ERIN attests counsel review under her own grant.
  const legal = await piece(w, 'a-legal', 'document', 'public');
  await grant(w, ERIN, 'counsel');
  const r2 = await attest(ERIN, body(legal, 'counsel_review', 'counsel', 'e-1'));
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.equal((w.db.prepare('SELECT actor_user_id FROM work_graph_release_attestations WHERE id = ?').get(r2.body.attestationId) as any).actor_user_id, ERIN);
  const s = await releaseStatus(w.env, await releaseAdminContext(w.env, CTX.scope), m.manifestUid);
  assert.ok(s.ok);
  assert.deepEqual(s.release.components.find((c) => c.revision === copy.rev)!.missingAttestations, [], 'the evidence counts');
  assert.deepEqual(auditRows(w, 'work_graph_release_review_attest').map((a) => [a.admin, a.outcome]), [
    [BOB, 'no_authority'], [BOB, 'no_authority'], [CAROL, 'no_authority'], [SUPER, 'no_authority'], [CAROL, 'no_authority'],
    [CAROL, 'no_authority'], [CAROL, 'stale_approval'], [CAROL, 'malformed'], [CAROL, 'recorded'], [CAROL, 'recorded'], [CAROL, 'recorded'],
    [ERIN, 'recorded'],
  ]);
});

test('5. pending: only what an authority the person holds can decide, not their own, not published, not taken down, not decided', async () => {
  const w = fresh();
  const env = envOf(w, { FILES: { head: async () => null, put: async () => ({}), delete: async () => {} } });
  const { website, copy, line } = await publicLine(w);
  const mA = await cut(w, line, [[website, 'code'], [copy, 'marketing']], 'mA');
  const mB = await cut(w, line, [[copy, 'marketing']], 'mB');
  const mC = await cut(w, line, [[website, 'code']], 'mC', BOB);
  const copy2 = await piece(w, 'pub-copy-2', 'document', 'public');
  await attestAll(w, copy2, ['marketing']);
  const mD = await cut(w, line, [[website, 'code'], [copy2, 'marketing']], 'mD');
  const uids = (b: any) => b.pending.map((p: any) => p.manifestUid);

  // Nothing held, nothing pending: not for BOB, and not for a linked Super Admin.
  assert.deepEqual((await pending(env, BOB)).pending, []);
  link(w, 70, SUPER);
  assert.deepEqual(await pending(env, SUPER), { ok: true, scope: { tenantId: 7, companyId: 70, projectId: null }, authorities: [], pending: [], people: {}, cost: { d1Statements: 0, d1Batches: 0 } });

  await grant(w, BOB, 'maintainer');
  await grant(w, CAROL, 'brand_owner');
  await grant(w, CAROL, 'marketing_lead', { tenantId: 7, companyId: 71 });
  await grant(w, ERIN, 'maintainer');
  const bob = await pending(env, BOB);
  assert.deepEqual(bob.authorities, ['maintainer']);
  assert.deepEqual(uids(bob), [mD.manifestUid, mA.manifestUid], 'code manifests only, newest first, and not the one he wrote (mC)');
  assert.deepEqual(bob.pending[0], {
    manifestUid: mD.manifestUid, lineAssetUid: line, digest: mD.digest, audience: 'public', authorUserId: AUTHOR, profiles: ['code'],
    authorities: { code: ['maintainer'] },
  }, 'ids, digests and names only');
  assert.deepEqual(bob.people, { [AUTHOR]: { name: `P${AUTHOR}` } }, 'part 11: the author, linked to the company, by name');
  const carol = await pending(env, CAROL);
  assert.deepEqual(uids(carol), [mD.manifestUid, mC.manifestUid, mB.manifestUid, mA.manifestUid].filter((u) => u !== mC.manifestUid));
  assert.deepEqual(carol.pending[0].authorities, { marketing: ['brand_owner'] });
  const in71 = await pending(env, CAROL, 'tenant_id=7&company_id=71');
  assert.deepEqual([in71.authorities, uids(in71)], [['marketing_lead'], []], 'her grants there, and that company holds no release');
  assert.equal((await pending(env, BOB, `${Q}&limit=1`)).pending.length, 1);

  // Decided drops it; a withdrawal puts it back; a request for changes is a decision too.
  assert.equal((await decide(env, BOB, mA, 'code', 'maintainer', 'approve', 'a-1')).status, 200);
  assert.deepEqual(uids(await pending(env, BOB)), [mD.manifestUid]);
  assert.deepEqual(uids(await pending(env, ERIN)), [mD.manifestUid, mC.manifestUid, mA.manifestUid], 'another maintainer still has mA (and BOB\'s mC) to decide');
  assert.equal((await decide(env, BOB, mA, 'code', 'maintainer', 'withdraw', 'a-2')).status, 200);
  assert.deepEqual(uids(await pending(env, BOB)), [mD.manifestUid, mA.manifestUid]);
  assert.equal((await decide(env, BOB, mD, 'code', 'maintainer', 'request_changes', 'a-3')).status, 200);
  assert.deepEqual(uids(await pending(env, BOB)), [mA.manifestUid]);
  assert.deepEqual(uids(await pending(env, CAROL)), [mD.manifestUid, mB.manifestUid, mA.manifestUid], 'BOB\'s decisions are not CAROL\'s');

  // A takedown covering mB removes it.
  const td = await takedownRelease(w.env, { scope: CTX.scope, authorities: new Map([[ERIN, ['counsel']]]) }, {
    lineAssetUid: line, manifestUid: mB.manifestUid, digest: mB.digest, reasonCode: 'rights_withdrawn', evidenceRef: 'notice:1', authority: 'counsel',
    actor: { kind: 'person', userId: ERIN }, idempotencyKey: 'td-b',
  });
  assert.ok(td.ok, JSON.stringify(td));
  assert.deepEqual(uids(await pending(env, CAROL)), [mD.manifestUid, mA.manifestUid]);

  // Published: mA leaves CAROL's list once it is the line's head.
  assert.equal((await decide(env, BOB, mA, 'code', 'maintainer', 'approve', 'a-4')).status, 200);
  assert.equal((await decide(env, CAROL, mA, 'marketing', 'brand_owner', 'approve', 'a-5')).status, 200);
  assert.deepEqual(uids(await pending(env, CAROL)), [mD.manifestUid]);
  assert.equal((await decide(env, CAROL, mA, 'marketing', 'brand_owner', 'withdraw', 'a-6')).status, 200);
  assert.deepEqual(uids(await pending(env, CAROL)), [mD.manifestUid, mA.manifestUid]);
  await grant(w, CAROL, 'marketing_lead');
  assert.deepEqual((await pending(env, CAROL)).pending[1].authorities, { marketing: ['brand_owner', 'marketing_lead'] });
  assert.equal((await decide(env, CAROL, mA, 'marketing', 'marketing_lead', 'approve', 'a-7')).status, 200);
  const pub = await call(env, 'POST', `/manifests/${mA.manifestUid}/publish`, { who: SUPER, base: ADMIN_BASE, body: publishBody(mA, 'p-a') });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal((await decide(env, CAROL, mA, 'marketing', 'marketing_lead', 'withdraw', 'a-8')).status, 200);
  assert.deepEqual(uids(await pending(env, CAROL)), [mD.manifestUid], 'a published manifest is not awaiting anyone');
  // Unlinked from the company: not a member any more.
  w.db.prepare('DELETE FROM user_company_links WHERE company_id = 70 AND user_id = ?').run(BOB);
  assert.equal((await call(env, 'GET', `/pending?${Q}`)).body.error, 'not_member');
});
