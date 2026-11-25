/**
 * D5585 part 11 (#5585, WorkGraph P1) — the read-only gaps the release page's brief (#8608) marks "backend required":
 * people's names beside user ids, the scopes with release lines, a line's name (not recorded), why a decision does not
 * count, which switches are on, and a company's grant candidates. The real routers over the full migrated schema, with
 * part 2's synthetic world.
 *
 *   1. Flag off: the new routes and the reviewer read refuse 404 before any D1 read.
 *   2. Gates: no session is 401; a signed-in member who is not a Super Admin is refused every admin read.
 *   3. Status: booleans only, from the exact switch values; nothing else of the environment.
 *   4. Scopes: every (tenant, company) with lines, company names, archived, counts, order.
 *   5. Candidates: linked people only, names never emails, what each holds and each key's seq; another tenant refused.
 *   6. Names: every admin read names the ids it returns; the line has no name; a project of another company is not named;
 *      the reviewer read names only people linked to the reviewer's company; no email anywhere.
 *   7. Not counted: every live decision is either counted or has exactly one reason, the one the counting rule gives.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_release_admin_reads_5585.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { CTX, OTHER, OTHER_CTX, T0, attestAll, clock, newLine, piece, type Piece, type W } from './_work_graph_release_world_5585.ts';
import reviews from '../src/routes/release_reviews.ts';
import releases from '../src/routes/admin_work_graph_releases.ts';
import {
  DECISION_NOT_COUNTED, cutManifest, decisionNotCounted, readLine, readManifest, registerReleaseLine, releaseStatus, Meter,
  type ReleaseContext,
} from '../src/services/workGraphReleases.ts';
import { grantReleaseAuthority, revokeReleaseAuthority } from '../src/services/workGraphReleaseAuthorities.ts';
import { RELEASE_ADMIN_DEPS } from '../src/services/workGraphReleaseAdmin.ts';
import { releaseSwitches } from '../src/services/workGraphReleaseDirectory.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1, AUTHOR = 11, BOB = 12, CAROL = 13, ERIN = 15, OUTSIDER = 17, GONE = 18;
const R1 = 21, R2 = 22, R3 = 23, R4 = 24, R5 = 25, R6 = 26, R7 = 27;
const ADMIN = '/api/admin/work-graph/releases';
const REVIEW = '/api/work-graph/releases';
const Q = 'tenant_id=7&company_id=70';

function fresh(): W {
  clock.t = T0;
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, ?)');
  u.run(SUPER, 'admin', 'Super', 'super@axal.example', 1);
  for (const id of [AUTHOR, BOB, CAROL, ERIN, OUTSIDER, R1, R2, R3, R4, R5, R6, R7]) u.run(id, 'founder', `P${id}`, `p${id}@example.test`, 1);
  u.run(GONE, 'founder', 'Gone', 'gone@example.test', 0);
  // BOB has chosen a display name: it wins over the account name (D4616).
  db.prepare("UPDATE users SET display_name = 'Bob B.' WHERE id = ?").run(BOB);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER})`);
  const s = db.prepare("INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES (?, ?, 'totp', datetime('now'), datetime('now'))");
  for (const id of [SUPER, AUTHOR, BOB, CAROL, ERIN, OUTSIDER]) s.run(`s-${id}`, id);
  const w = { env: { DB: d1Over(db) } as any, db } as W;
  for (const id of [AUTHOR, BOB, CAROL, ERIN, GONE]) link(w, 70, id);
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
app.route(REVIEW, reviews);
app.route(ADMIN, releases);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, String(err?.message) === 'Unauthorized' ? 401 : 403));

const token = (who: number) => new SignJWT({ user_id: who, role: who === SUPER ? 'admin' : 'founder', jti: `s-${who}` })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
function envOf(w: W | null, over: Record<string, unknown> = {}) {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: w?.env.DB, WORK_GRAPH_RELEASE_ADMIN: 'on', ...over } as any;
}
async function call(env: any, path: string, opts: { who?: number | null; base?: string } = {}) {
  const headers: Record<string, string> = {};
  const who = opts.who === undefined ? SUPER : opts.who;
  if (who !== null) headers.Authorization = `Bearer ${await token(who)}`;
  const w = console.warn, e = console.error, i = console.info; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try {
    const res = await app.request(`${opts.base ?? ADMIN}${path}`, { method: 'GET', headers }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { console.warn = w; console.error = e; console.info = i; }
}
const ok = async (env: any, path: string, opts: { who?: number | null; base?: string } = {}) => {
  const r = await call(env, path, opts);
  assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.body)}`);
  return r.body;
};
/** No email, and no key that could carry one, anywhere in an answer. */
function noEmail(body: unknown, label: string) {
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /@/, `${label} carries an email`);
  assert.doesNotMatch(text, /"email"/i, `${label} has an email key`);
}

/** A public line with a code piece (website) and a marketing piece (copy), both attested. */
async function publicLine(w: W) {
  const website = await piece(w, 'pub-website', 'code', 'public');
  const copy = await piece(w, 'pub-copy', 'document', 'public');
  await attestAll(w, website, ['code']);
  await attestAll(w, copy, ['marketing']);
  return { website, copy, line: await newLine(w, 'line-public', 'public') };
}
async function cut(w: W, line: string, pieces: [Piece, 'code' | 'marketing'][], key: string, author = AUTHOR) {
  clock.t += 60_000;
  const m = await cutManifest(w.env, CTX, {
    lineAssetUid: line, partial: false, author: { kind: 'person', userId: author }, idempotencyKey: key,
    components: pieces.map(([p, profile]) => ({ assetUid: p.asset, revisionUid: p.rev, digest: p.digest, role: profile === 'code' ? 'website' : 'copy', profile })),
  });
  assert.ok(m.ok, JSON.stringify(m));
  return m;
}
let dk = 0;
/** A decision row as the store holds it, written directly so every rule can be exercised (the services refuse most of these). */
function row(w: W, m: { manifestUid: string; digest: string }, reviewer: number, profile: string, authority: string, decision: string,
  over: { digest?: string; audience?: string } = {}) {
  clock.t += 1000;
  w.db.prepare(
    `INSERT INTO work_graph_release_decisions (tenant_id, company_id, project_id, manifest_uid, manifest_digest, audience, purpose, profile,
       authority, decision, reviewer_user_id, approval_ref, idempotency_key, request_hash, decided_at)
     VALUES (7, 70, 700, ?, ?, ?, 'publish', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(m.manifestUid, over.digest ?? m.digest, over.audience ?? 'public', profile, authority, decision, reviewer, `ref:${++dk}`, `dk-${dk}`,
    'c'.repeat(64), new Date(clock.t).toISOString());
}

// -------------------------------------------------------------------------------------------------------------------

test('1. flag off: the part 11 reads and the reviewer read refuse 404 before any D1 read', async () => {
  const admin = ['/scopes', '/status', `/authorities/candidates?${Q}`, `/lines?${Q}`, `/authorities?${Q}`];
  for (const flag of [undefined, '', 'true', 'ON', 'off', 'preview']) {
    for (const who of [SUPER, BOB, null]) {
      for (const path of admin) {
        const { DB, touched } = untouchable();
        const r = await call(envOf(null, { DB, WORK_GRAPH_RELEASE_ADMIN: flag, WORK_GRAPH_RELEASE_DELIVERY: 'preview', WORK_GRAPH_RELEASE_SITES: 'on' }), path, { who });
        assert.deepEqual([r.status, r.body?.error], [404, 'release_admin_off'], `${flag} ${path}`);
        assert.deepEqual(touched, [], `${path} touched D1`);
      }
      const { DB, touched } = untouchable();
      const r = await call(envOf(null, { DB, WORK_GRAPH_RELEASE_ADMIN: flag }), `/pending?${Q}`, { who, base: REVIEW });
      assert.deepEqual([r.status, r.body?.error], [404, 'release_review_off']);
      assert.deepEqual(touched, []);
    }
  }
});

test('2. gates: no session is 401; a member who is not a Super Admin is refused every admin read and nothing is answered', async () => {
  const w = fresh();
  const env = envOf(w, { WORK_GRAPH_RELEASE_DELIVERY: 'preview', WORK_GRAPH_RELEASE_SITES: 'on' });
  await publicLine(w);
  const paths = ['/scopes', '/status', `/authorities/candidates?${Q}`, `/lines?${Q}`, `/authorities?${Q}`];
  for (const path of paths) {
    assert.equal((await call(env, path, { who: null })).status, 401, path);
    for (const who of [BOB, CAROL, OUTSIDER]) {
      const r = await call(env, path, { who });
      assert.equal(r.status, 403, `${who} ${path}`);
      assert.equal(r.body.ok, undefined);
      assert.equal(r.body.switches, undefined);
      assert.equal(r.body.scopes, undefined);
      assert.equal(r.body.candidates, undefined);
    }
    assert.equal((await call(env, path)).status, 200, `the Super Admin reads ${path}`);
  }
  // A malformed scope on the candidate read.
  for (const q of ['', '?tenant_id=7', '?tenant_id=0&company_id=70', '?tenant_id=7&company_id=x']) {
    const r = await call(env, `/authorities/candidates${q}`);
    assert.deepEqual([r.status, r.body.error], [400, 'malformed'], q);
  }
});

test('3. status: whether delivery and public sites are on, as booleans from the exact values; nothing else', async () => {
  const w = fresh();
  const cases: [unknown, unknown, boolean, boolean][] = [
    [undefined, undefined, false, false], ['preview', 'on', true, true], ['on', 'preview', false, false], ['PREVIEW', 'ON', false, false],
    ['preview', undefined, true, false], [undefined, 'on', false, true], ['', '', false, false],
  ];
  for (const [delivery, sites, d, s] of cases) {
    const env = envOf(w, { WORK_GRAPH_RELEASE_DELIVERY: delivery, WORK_GRAPH_RELEASE_SITES: sites, SOME_SECRET: 'sk_live_do_not_echo' });
    const body = await ok(env, '/status');
    assert.deepEqual(body, { ok: true, switches: { admin: true, delivery: d, sites: s } }, `${delivery} ${sites}`);
    assert.doesNotMatch(JSON.stringify(body), /sk_live|unit-test|preview|"on"/);
    assert.deepEqual(releaseSwitches({ WORK_GRAPH_RELEASE_ADMIN: 'off', WORK_GRAPH_RELEASE_DELIVERY: delivery as any, WORK_GRAPH_RELEASE_SITES: sites as any }),
      { admin: false, delivery: d, sites: s });
  }
});

test('4. scopes: every tenant and company with release lines, with the company name, archived flag and line count', async () => {
  const w = fresh();
  const env = envOf(w);
  assert.deepEqual(await ok(env, '/scopes'), { ok: true, scopes: [], truncated: false, cost: { d1Statements: 1, d1Batches: 0 } });
  await newLine(w, 'l-a');
  await newLine(w, 'l-b', 'public');
  const o = await registerReleaseLine(w.env, OTHER_CTX, { scope: OTHER, audience: 'public', actor: { kind: 'person', userId: AUTHOR }, idempotencyKey: 'l-8' });
  assert.ok(o.ok);
  const o2 = await registerReleaseLine(w.env, { ...OTHER_CTX, scope: { tenantId: 8, companyId: 81, projectId: null } },
    { scope: { tenantId: 8, companyId: 81, projectId: null }, audience: 'internal', actor: { kind: 'person', userId: AUTHOR }, idempotencyKey: 'l-81' });
  assert.ok(o2.ok);
  w.db.prepare("INSERT INTO company_profiles (id, uid, company_name) VALUES (70, 'co-70', 'Acme')").run();
  w.db.prepare("INSERT INTO company_profiles (id, uid, company_name, archived_at) VALUES (81, 'co-81', 'Old Co', '2026-11-01T00:00:00Z')").run();
  w.db.prepare("INSERT INTO company_profiles (id, uid, company_name) VALUES (99, 'co-99', 'No Lines Inc')").run();
  const body = await ok(env, '/scopes');
  assert.deepEqual(body.scopes, [
    { tenantId: 7, companyId: 70, companyName: 'Acme', companyArchived: false, lines: 2 },
    { tenantId: 8, companyId: 80, companyName: null, companyArchived: false, lines: 1 },
    { tenantId: 8, companyId: 81, companyName: 'Old Co', companyArchived: true, lines: 1 },
  ], 'a company with no lines is not a scope; a company with no profile has no name');
  assert.equal(body.truncated, false);
  assert.deepEqual(body.cost, { d1Statements: 1, d1Batches: 0 });
});

test('5. candidates: the company\'s linked people only, by name, with what each holds and each key\'s seq; another tenant refused', async () => {
  const w = fresh();
  const env = envOf(w);
  await newLine(w, 'l-a');
  await grant(w, BOB, 'maintainer');
  await grant(w, CAROL, 'brand_owner');
  await grant(w, CAROL, 'counsel');
  const rv = await revokeReleaseAuthority(w.env, { scope: { tenantId: 7, companyId: 70 }, userId: CAROL, authority: 'counsel', reason: 'Left.', expectedSeq: 1, actorUserId: SUPER, idempotencyKey: 'rv-1' });
  assert.ok(rv.ok);
  await grant(w, CAROL, 'marketing_lead', { tenantId: 7, companyId: 71 });
  link(w, 71, OUTSIDER);
  const body = await ok(env, `/authorities/candidates?${Q}`);
  assert.deepEqual(body.candidates, [
    { userId: AUTHOR, name: `P${AUTHOR}`, active: true, held: [], seqs: {} },
    { userId: BOB, name: 'Bob B.', active: true, held: ['maintainer'], seqs: { maintainer: 1 } },
    { userId: CAROL, name: `P${CAROL}`, active: true, held: ['brand_owner'], seqs: { brand_owner: 1, counsel: 2 } },
    { userId: ERIN, name: `P${ERIN}`, active: true, held: [], seqs: {} },
    { userId: GONE, name: 'Gone', active: false, held: [], seqs: {} },
  ], 'OUTSIDER (linked to 71 only) and SUPER are not linked here; CAROL\'s grant in company 71 is not here');
  assert.ok(Array.isArray(body.authorities) && body.authorities.includes('maintainer'));
  assert.equal(body.truncated, false);
  noEmail(body, 'candidates');
  // Company 71: CAROL alone, holding what she holds there.
  assert.deepEqual((await ok(env, '/authorities/candidates?tenant_id=7&company_id=71')).candidates,
    [{ userId: CAROL, name: `P${CAROL}`, active: true, held: ['marketing_lead'], seqs: { marketing_lead: 1 } },
      { userId: OUTSIDER, name: `P${OUTSIDER}`, active: true, held: [], seqs: {} }]);
  // Company 70's release records live under tenant 7: naming tenant 8 is refused before anyone is listed.
  const t8 = await call(env, '/authorities/candidates?tenant_id=8&company_id=70');
  assert.deepEqual([t8.status, t8.body.error, t8.body.candidates], [403, 'wrong_tenant', undefined]);
  // A company with no release records in any tenant lists its people (a first grant needs them).
  link(w, 72, ERIN);
  assert.deepEqual((await ok(env, '/authorities/candidates?tenant_id=9&company_id=72')).candidates.map((c: any) => c.userId), [ERIN]);
});

test('6. names: every admin read names its people, never by email; a line has no name; the reviewer sees only their company\'s people', async () => {
  const w = fresh();
  const env = envOf(w);
  const { website, copy, line } = await publicLine(w);
  const m = await cut(w, line, [[website, 'code'], [copy, 'marketing']], 'm1');
  const mOut = await cut(w, line, [[website, 'code']], 'm-out', OUTSIDER);
  await grant(w, BOB, 'maintainer');
  await grant(w, CAROL, 'brand_owner');
  row(w, m, BOB, 'code', 'maintainer', 'approve');
  row(w, m, ERIN, 'code', 'maintainer', 'request_changes');
  row(w, m, CAROL, 'marketing', 'brand_owner', 'withdraw');

  // Lines: the creator by name; the line has no name of its own; the project is named only if it is this company's.
  w.db.prepare("INSERT INTO projects (id, name, company_id) VALUES (700, 'Orchard', 70)").run();
  const lines = await ok(env, `/lines?${Q}`);
  assert.deepEqual(lines.lines.map((l: any) => [l.lineAssetUid, l.lineName, l.lineNameReason, l.projectId, l.projectName]),
    [[line, null, 'not_recorded', 700, 'Orchard']]);
  assert.deepEqual(lines.people, { [AUTHOR]: { name: `P${AUTHOR}` } });
  noEmail(lines, 'lines');
  w.db.prepare('UPDATE projects SET company_id = 71 WHERE id = 700').run();
  assert.equal((await ok(env, `/lines?${Q}`)).lines[0].projectName, null, 'another company\'s project is not named');
  w.db.prepare('UPDATE projects SET company_id = 70, deleted_at = datetime(\'now\') WHERE id = 700').run();
  assert.equal((await ok(env, `/lines?${Q}`)).lines[0].projectName, null, 'a deleted project is not named');

  // One line: its manifests' authors, no line name.
  const one = await ok(env, `/lines/${line}?${Q}`);
  assert.deepEqual([one.lineName, one.lineNameReason], [null, 'not_recorded']);
  assert.deepEqual(one.people, { [AUTHOR]: { name: `P${AUTHOR}` }, [OUTSIDER]: { name: `P${OUTSIDER}` } });
  noEmail(one, 'line');

  // One manifest: the author, the reviewer who counts, the one who asked for changes, the one who withdrew.
  const man = await ok(env, `/manifests/${m.manifestUid}?${Q}`);
  assert.equal(man.release.authorUserId, AUTHOR);
  assert.deepEqual(man.release.approvals.map((a: any) => a.reviewerUserId), [BOB]);
  assert.deepEqual(man.release.changesRequestedBy, [ERIN]);
  assert.deepEqual(man.release.notCounted.map((d: any) => [d.reviewerUserId, d.reason]), [[ERIN, 'changes_requested'], [CAROL, 'withdrawn']]);
  assert.deepEqual(man.people, {
    [AUTHOR]: { name: `P${AUTHOR}` }, [BOB]: { name: 'Bob B.' }, [CAROL]: { name: `P${CAROL}` }, [ERIN]: { name: `P${ERIN}` },
  });
  assert.equal(man.cost.d1Statements > 0, true);
  noEmail(man, 'manifest');

  // Authorities: grantees and the Super Admin who granted, in holders and history. ERIN's grant was revoked: she is
  // only in the history, and named there.
  await grant(w, ERIN, 'counsel');
  const rv = await revokeReleaseAuthority(w.env, { scope: { tenantId: 7, companyId: 70 }, userId: ERIN, authority: 'counsel', reason: 'Left.', expectedSeq: 1, actorUserId: SUPER, idempotencyKey: 'rv-6' });
  assert.ok(rv.ok);
  const auth = await ok(env, `/authorities?${Q}&history=1`);
  assert.ok(!auth.holders.some((h: any) => h.userId === ERIN));
  assert.deepEqual(auth.people, { [SUPER]: { name: 'Super' }, [BOB]: { name: 'Bob B.' }, [CAROL]: { name: `P${CAROL}` }, [ERIN]: { name: `P${ERIN}` } });
  noEmail(auth, 'authorities');
  // A blank display name falls back to the account name; no name at all is null.
  w.db.prepare("UPDATE users SET display_name = '   ' WHERE id = ?").run(BOB);
  w.db.prepare("UPDATE users SET name = '' WHERE id = ?").run(CAROL);
  assert.deepEqual((await ok(env, `/authorities?${Q}`)).people, { [SUPER]: { name: 'Super' }, [BOB]: { name: `P${BOB}` }, [CAROL]: { name: null } });

  // The reviewer: authors by name only when linked to the reviewer's company. OUTSIDER is not linked: null, still keyed.
  const mine = await ok(env, `/pending?${Q}`, { who: BOB, base: REVIEW });
  assert.deepEqual(mine.pending.map((p: any) => [p.manifestUid, p.authorUserId]), [[mOut.manifestUid, OUTSIDER]]);
  assert.deepEqual(mine.people, { [OUTSIDER]: { name: null } });
  noEmail(mine, 'pending');
  link(w, 70, OUTSIDER);
  assert.deepEqual((await ok(env, `/pending?${Q}`, { who: BOB, base: REVIEW })).people, { [OUTSIDER]: { name: `P${OUTSIDER}` } });
  // Linked to another company only does not count: CAROL (70 and 71) sees an author linked to 71 alone as null.
  w.db.prepare('DELETE FROM user_company_links WHERE company_id = 70 AND user_id = ?').run(OUTSIDER);
  link(w, 71, OUTSIDER);
  const carol = await ok(env, `/pending?${Q}`, { who: CAROL, base: REVIEW });
  assert.equal(carol.people[OUTSIDER]?.name ?? null, null);
  assert.equal(carol.people[AUTHOR]?.name, `P${AUTHOR}`);
});

test('7. not counted: every live decision is counted or has exactly one reason, the one the counting rule gives', async () => {
  const w = fresh();
  const env = envOf(w);
  const { website, copy, line } = await publicLine(w);
  const m = await cut(w, line, [[website, 'code'], [copy, 'marketing']], 'm1');
  const authorities = new Map<number, string[]>([
    [BOB, ['maintainer']], [CAROL, ['brand_owner']], [AUTHOR, ['maintainer']], [R1, ['maintainer']], [R2, ['maintainer']],
    [R3, ['maintainer']], [R5, ['brand_owner']], [R7, ['maintainer']],
  ]);
  const revoked = new Set([R3, R7]);
  row(w, m, BOB, 'code', 'maintainer', 'approve'); // counts
  row(w, m, CAROL, 'marketing', 'brand_owner', 'approve'); // counts
  row(w, m, ERIN, 'code', 'maintainer', 'approve');
  row(w, m, ERIN, 'code', 'maintainer', 'withdraw'); // withdrawn (the latest row is the live one)
  row(w, m, R6, 'code', 'maintainer', 'reject'); // changes_requested
  row(w, m, R6, 'marketing', 'brand_owner', 'request_changes'); // changes_requested
  row(w, m, R1, 'code', 'maintainer', 'approve', { digest: 'd'.repeat(64) }); // other_digest
  row(w, m, R2, 'code', 'maintainer', 'approve', { audience: 'investors' }); // other_audience
  row(w, m, R3, 'code', 'maintainer', 'approve'); // reviewer_revoked
  row(w, m, AUTHOR, 'code', 'maintainer', 'approve'); // author_own
  row(w, m, R4, 'code', 'maintainer', 'approve'); // authority_not_held
  row(w, m, R5, 'code', 'brand_owner', 'approve'); // authority_not_for_profile
  // Fails several rules at once (revoked, another digest, not held for the profile): the first rule names it.
  row(w, m, R7, 'marketing', 'maintainer', 'approve', { digest: 'e'.repeat(64) });

  const ctx: ReleaseContext = { scope: CTX.scope, authorities, revokedUserIds: revoked };
  const s = await releaseStatus(w.env, ctx, m.manifestUid);
  assert.ok(s.ok);
  const rel = s.release;
  assert.deepEqual(rel.approvals.map((a) => [a.reviewerUserId, a.profile]), [[BOB, 'code'], [CAROL, 'marketing']]);
  assert.deepEqual(rel.missingApprovals, []);
  assert.deepEqual(rel.notCounted.map((d) => [d.reviewerUserId, d.profile, d.reason]), [
    [ERIN, 'code', 'withdrawn'], [R6, 'code', 'changes_requested'], [R6, 'marketing', 'changes_requested'], [R1, 'code', 'other_digest'],
    [R2, 'code', 'other_audience'], [R3, 'code', 'reviewer_revoked'], [AUTHOR, 'code', 'author_own'], [R4, 'code', 'authority_not_held'],
    [R5, 'code', 'authority_not_for_profile'], [R7, 'marketing', 'other_digest'],
  ]);
  assert.deepEqual(new Set(rel.notCounted.map((d) => d.reason)), new Set(DECISION_NOT_COUNTED), 'every reason is exercised');
  assert.deepEqual(rel.notCounted.find((d) => d.reviewerUserId === ERIN), {
    profile: 'code', reviewerUserId: ERIN, authority: 'maintainer', decision: 'withdraw', decidedAt: rel.notCounted[0].decidedAt, reason: 'withdrawn',
  });

  // The whole set of live decisions, read independently of the evaluation: each one is counted xor not counted, once,
  // and its reason is exactly what the counting rule gives for that row.
  const live = w.db.prepare(
    `SELECT d.* FROM work_graph_release_decisions d WHERE d.manifest_uid = ? AND d.purpose = 'publish'
       AND d.id = (SELECT MAX(x.id) FROM work_graph_release_decisions x WHERE x.manifest_uid = d.manifest_uid AND x.purpose = 'publish'
                    AND x.profile = d.profile AND x.reviewer_user_id = d.reviewer_user_id)`,
  ).all(m.manifestUid) as any[];
  assert.equal(live.length, rel.approvals.length + rel.notCounted.length);
  const meter = new Meter(w.env);
  const manRow = (await readManifest(w.env, meter, m.manifestUid))!;
  const lineRow = (await readLine(w.env, meter, line))!;
  for (const d of live) {
    const key = (x: { reviewerUserId: number; profile: string }) => x.reviewerUserId === d.reviewer_user_id && x.profile === d.profile;
    const counted = rel.approvals.filter(key);
    const dropped = rel.notCounted.filter(key);
    assert.equal(counted.length + dropped.length, 1, `${d.reviewer_user_id} ${d.profile} appears exactly once`);
    const reason = decisionNotCounted(ctx, manRow, lineRow.audience, d);
    assert.equal(dropped[0]?.reason ?? null, reason, `${d.reviewer_user_id} ${d.profile}`);
    assert.equal(counted.length === 1, reason === null);
  }

  // Through the admin route, with the store's authorities: the same rule, and every reviewer it names has a name.
  const realA = RELEASE_ADMIN_DEPS.authorities, realR = RELEASE_ADMIN_DEPS.revokedUsers;
  RELEASE_ADMIN_DEPS.authorities = async () => authorities;
  RELEASE_ADMIN_DEPS.revokedUsers = async () => revoked;
  try {
    const body = await ok(env, `/manifests/${m.manifestUid}?${Q}`);
    assert.deepEqual(body.release.notCounted, JSON.parse(JSON.stringify(rel.notCounted)));
    assert.deepEqual(body.release.approvals, JSON.parse(JSON.stringify(rel.approvals)));
    for (const d of [...body.release.notCounted, ...body.release.approvals]) assert.equal(body.people[d.reviewerUserId].name, `P${d.reviewerUserId}`.replace(`P${BOB}`, 'Bob B.'));
    noEmail(body, 'manifest');
    // Revoking BOB's grant moves his approval to authority_not_held, and code goes missing again.
    authorities.delete(BOB);
    const after = await ok(env, `/manifests/${m.manifestUid}?${Q}`);
    assert.deepEqual(after.release.missingApprovals, ['code']);
    assert.equal(after.release.notCounted.find((d: any) => d.reviewerUserId === BOB).reason, 'authority_not_held');
  } finally { RELEASE_ADMIN_DEPS.authorities = realA; RELEASE_ADMIN_DEPS.revokedUsers = realR; }
});
