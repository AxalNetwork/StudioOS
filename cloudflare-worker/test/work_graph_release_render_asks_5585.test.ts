/**
 * D5585 part 17 (#5585, WorkGraph P1): render approvals asked for in the reviewer's inbox. Beside the publish asks, the
 * pending read lists the manifests asking this person for a render approval: one of the scope they did not author, not
 * taken down, pinning a video, image or brand piece that is still its asset's head, under a profile they can decide and
 * hold no live render decision for. Deciding it is part 15's render approval, on the same route. The real router over
 * the full migrated schema, with part 2's synthetic world.
 *
 *   1. Who is asked: a holder of the piece's profile authority, not the author, not someone without it; only the
 *      render pieces are listed; a manifest with no render piece asks nothing; another company asks nothing.
 *   2. Answering: a render approval (with its ceiling) or a rejection ends the ask; a withdrawal brings it back; a
 *      publish decision does not end it, and a render approval without a ceiling is refused.
 *   3. When it stops: a newer head of the piece, a takedown; a published manifest still asks.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_release_render_asks_5585.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { CTX, T0, attestAll, clock, newLine, piece, revise, type Piece, type W } from './_work_graph_release_world_5585.ts';
import reviews from '../src/routes/release_reviews.ts';
import { cutManifest } from '../src/services/workGraphReleases.ts';
import { takedownRelease } from '../src/services/workGraphReleaseTakedowns.ts';
import { grantReleaseAuthority } from '../src/services/workGraphReleaseAuthorities.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1, AUTHOR = 11, BOB = 12, CAROL = 13, ERIN = 15;
const BASE = '/api/work-graph/releases';
const IN = { tenant_id: 7, company_id: 70 };
const Q = 'tenant_id=7&company_id=70';

function fresh(): W {
  clock.t = T0;
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Super', 'super@axal.example');
  for (const id of [AUTHOR, BOB, CAROL, ERIN]) u.run(id, 'founder', `P${id}`, `p${id}@example.test`);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER})`);
  const s = db.prepare("INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at) VALUES (?, ?, 'totp', datetime('now'), datetime('now'))");
  for (const id of [AUTHOR, BOB, CAROL, ERIN]) s.run(`s-${id}`, id);
  const w = { env: { DB: d1Over(db) } as any, db } as W;
  for (const id of [AUTHOR, BOB, CAROL, ERIN]) link(w, 70, id);
  link(w, 71, CAROL);
  return w;
}
function link(w: W, company: number, user: number) {
  w.db.prepare('INSERT INTO user_company_links (uid, company_id, user_id) VALUES (?, ?, ?)').run(`l-${company}-${user}`, company, user);
}
let gk = 0;
async function grant(w: W, user: number, authority: string) {
  const r = await grantReleaseAuthority(w.env, { scope: { tenantId: 7, companyId: 70 }, userId: user, authority, reason: 'Named by the board.', expectedSeq: 0, actorUserId: SUPER, idempotencyKey: `g-${++gk}` });
  assert.ok(r.ok, JSON.stringify(r));
}

const app = new Hono<any>();
app.route(BASE, reviews);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, String(err?.message) === 'Unauthorized' ? 401 : 403));

const token = (who: number) => new SignJWT({ user_id: who, role: 'founder', jti: `s-${who}` })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
const envOf = (w: W) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: w.env.DB, WORK_GRAPH_RELEASE_ADMIN: 'on' } as any);
async function call(env: any, method: string, path: string, who: number, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${await token(who)}` };
  const w = console.warn, e = console.error, i = console.info; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try {
    const res = await app.request(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { console.warn = w; console.error = e; console.info = i; }
}
const pending = async (env: any, who: number, q = Q) => {
  const r = await call(env, 'GET', `/pending?${q}`, who);
  return r.body;
};
const MARKETING_REFS = { rights_ref: 'rights:brand-licence-2026', disclosure_ref: 'disclosure:forward-looking-v2' };
const decide = (env: any, who: number, m: { manifestUid: string; digest: string }, decision: string, key: string, over: Record<string, unknown> = {}) =>
  call(env, 'POST', `/manifests/${m.manifestUid}/decisions`, who,
    { ...IN, digest: m.digest, audience: 'public', profile: 'marketing', authority: 'brand_owner', decision, idempotency_key: key, ...MARKETING_REFS, ...over });
const asks = (body: any) => (body.renderPending ?? []).map((i: any) => [i.manifestUid, i.profiles, i.pieces.map((p: any) => p.kind)]);

/** A video (marketing) and a website (code) on one public line, attested. */
async function renderLine(w: W, key = 'r') {
  const video = await piece(w, `${key}-video`, 'video', 'public');
  const website = await piece(w, `${key}-website`, 'code', 'public');
  await attestAll(w, video, ['marketing']);
  await attestAll(w, website, ['code']);
  return { video, website, line: await newLine(w, `${key}-line`, 'public') };
}
async function cut(w: W, line: string, pieces: [Piece, 'code' | 'marketing'][], key: string) {
  clock.t += 60_000;
  const m = await cutManifest(w.env, CTX, {
    lineAssetUid: line, partial: true, author: { kind: 'person', userId: AUTHOR }, idempotencyKey: key,
    components: pieces.map(([p, profile]) => ({ assetUid: p.asset, revisionUid: p.rev, digest: p.digest, role: profile === 'code' ? 'website' : 'video', profile })),
  });
  assert.ok(m.ok, JSON.stringify(m));
  return m;
}

test('1. who is asked: the holder of the render piece\'s profile authority, for the render pieces only', async () => {
  const w = fresh();
  const env = envOf(w);
  await grant(w, CAROL, 'brand_owner');
  await grant(w, BOB, 'maintainer');
  const { video, website, line } = await renderLine(w);
  const m = await cut(w, line, [[video, 'marketing'], [website, 'code']], 'm1');
  const carol = await pending(env, CAROL);
  assert.deepEqual(asks(carol), [[m.manifestUid, ['marketing'], ['video']]]);
  const item = carol.renderPending[0];
  assert.deepEqual([item.digest, item.audience, item.authorUserId, item.lineAssetUid], [m.digest, 'public', AUTHOR, line]);
  assert.deepEqual(item.authorities, { marketing: ['brand_owner'] });
  assert.deepEqual(item.pieces, [{ asset: video.asset, revision: video.rev, kind: 'video', role: 'video', profiles: ['marketing'] }]);
  assert.equal(carol.people[AUTHOR]?.name, `P${AUTHOR}`);
  assert.deepEqual(asks(await pending(env, BOB)), [], 'a maintainer decides no video');
  await grant(w, AUTHOR, 'brand_owner');
  assert.deepEqual(asks(await pending(env, AUTHOR)), [], 'never the author');
  // A manifest with no render piece asks for nothing.
  const m2 = await cut(w, line, [[website, 'code']], 'm2');
  assert.ok(!asks(await pending(env, CAROL)).some((a: any) => a[0] === m2.manifestUid));
  // Another company: CAROL holds brand_owner only at 70.
  assert.deepEqual(asks(await pending(env, CAROL, 'tenant_id=7&company_id=71')), []);
});

test('2. answering: an approval with its ceiling or a rejection ends the ask, a withdrawal brings it back, a publish decision does not', async () => {
  const w = fresh();
  const env = envOf(w);
  await grant(w, CAROL, 'brand_owner');
  const { video, line } = await renderLine(w);
  const m = await cut(w, line, [[video, 'marketing']], 'm1');
  const open = async () => asks(await pending(env, CAROL)).length;
  assert.equal(await open(), 1);
  const pub = await decide(env, CAROL, m, 'approve', 'p1');
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal(await open(), 1, 'a publish approval is not a render approval');
  const only = await pending(env, CAROL);
  assert.deepEqual([only.pending.length, only.people[AUTHOR]?.name], [0, `P${AUTHOR}`], 'the render ask alone names its author');
  const noCap = await decide(env, CAROL, m, 'approve', 'r0', { purpose: 'render' });
  assert.equal(noCap.body.error, 'approval_incomplete');
  assert.equal(await open(), 1);
  const r1 = await decide(env, CAROL, m, 'approve', 'r1', { purpose: 'render', render_ceiling_microusd: 5_000_000 });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(await open(), 0);
  const row = w.db.prepare("SELECT purpose, render_ceiling_microusd AS c FROM work_graph_release_decisions WHERE idempotency_key = 'r1'").get() as any;
  assert.deepEqual({ ...row }, { purpose: 'render', c: 5_000_000 });
  assert.equal((await decide(env, CAROL, m, 'withdraw', 'r2', { purpose: 'render' })).status, 200);
  assert.equal(await open(), 1, 'a withdrawal asks again');
  assert.equal((await decide(env, CAROL, m, 'reject', 'r3', { purpose: 'render' })).status, 200);
  assert.equal(await open(), 0, 'a rejection is an answer');
});

test('3. when it stops: a newer head of the piece or a takedown; a published manifest still asks', async () => {
  const w = fresh();
  const env = envOf(w);
  await grant(w, CAROL, 'brand_owner');
  const { video, line } = await renderLine(w);
  const m = await cut(w, line, [[video, 'marketing']], 'm1');
  // Published (the line's pointer names it): a render approval is about spend, so it still asks.
  w.db.prepare('UPDATE work_graph_assets SET head_revision_uid = ? WHERE asset_uid = ?').run(m.manifestUid, line);
  assert.deepEqual(asks(await pending(env, CAROL)).map((a: any) => a[0]), [m.manifestUid]);
  // A newer head of the video: nothing builds on the pinned revision any more.
  await revise(w, video, 'r-video-v2');
  assert.deepEqual(asks(await pending(env, CAROL)), []);

  const w2 = fresh();
  const env2 = envOf(w2);
  await grant(w2, CAROL, 'brand_owner');
  const r2 = await renderLine(w2, 's');
  const m2 = await cut(w2, r2.line, [[r2.video, 'marketing']], 'm2');
  assert.equal(asks(await pending(env2, CAROL)).length, 1);
  const t = await takedownRelease(w2.env, { ...CTX, authorities: new Map([[ERIN, ['counsel']]]) }, {
    lineAssetUid: r2.line, manifestUid: m2.manifestUid, digest: m2.digest, reasonCode: 'rights_withdrawn', evidenceRef: 'notice:1',
    authority: 'counsel', actor: { kind: 'person', userId: ERIN }, idempotencyKey: 'td',
  });
  assert.ok(t.ok, JSON.stringify(t));
  assert.deepEqual(asks(await pending(env2, CAROL)), []);
});
