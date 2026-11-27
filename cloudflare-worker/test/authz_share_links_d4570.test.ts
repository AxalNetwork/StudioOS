// #4570 slice 3 (S1 of #4554) — share links, on the real Worker.
//
// The links a founder hands to someone else, where the token (signed, stored
// only as a hash, with an expiry, a view limit and a revocation) is the gate,
// and the routes that revoke them. Asked through `worker.fetch` on the fully
// migrated schema, with every link minted by its owner through the same Worker:
//
//   GET  /api/captable/share/:token           a cap table scenario link   (no sign-in; the token is the gate)
//   GET  /api/captable/access/shared/:token   a cap table venture link    (no sign-in; the token is the gate)
//   GET  /api/lab-report-shares/open/:token   a scoring report link       (the named account, signed in)
//   POST /api/lab-report-shares/:id/revoke    revoking one                (the report's owner)
//
// A link that is not good is refused (403 for one that never was, 410 for one
// that was and is spent, expired or revoked; the scoring report answers one 404
// for all of them, and for the wrong account). A refusal names nothing of what
// the link shows, and changes nothing: no view counted, no open logged, no row
// written. Revoking or minting another owner's link is refused and changes
// nothing. These are the ledger's `verified` entries for these routes.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/authz_share_links_d4570.test.ts
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import worker from '../src/index.ts';
import { mintShareToken } from '../src/services/shareLink.ts';
import { signScore } from '../src/services/scoreIntegrity.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';

const SECRET = 'd4570-links-fixture-only-'.repeat(3); // A fixture signing key; never a service credential.
const SCORING = 'd4570-links-scoring-fixture-only';  // likewise
const ctx: any = { waitUntil() {}, passThroughOnException() {} };

const OWNER = 1, OTHER = 2, NAMED = 3, ADMIN = 4, DISABLED_NAMED = 5;
const VENTURE = 10, ELSEWHERE = 20;
const SCENARIO_NAME = 'Quill shared scenario';
const HOLDER = 'Quill Holderton';
const VENTURE_NAME = 'Synthetic Venture Quill';
const LEAKS = ['Quill', '82', 'TIER_2'];

let db: any, env: any;
const tokens: Record<number, string> = {};
const jwt = (claims: Record<string, unknown>, secret = SECRET) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30m').sign(new TextEncoder().encode(secret));

async function call(path: string, opts: { who?: number; method?: string; body?: unknown } = {}) {
  const method = opts.method ?? 'GET';
  const read = method === 'GET' || method === 'HEAD';
  const res = await worker.fetch(new Request(`https://unit.test${path}`, {
    method, redirect: 'manual',
    headers: {
      ...(opts.who ? { authorization: `Bearer ${tokens[opts.who]}` } : {}),
      ...(read ? {} : { 'content-type': 'application/json' }),
    },
    body: read ? undefined : JSON.stringify(opts.body ?? {}),
  // A fresh limiter per request: this suite is about gates, and the limiter would otherwise answer 429 first.
  }), { ...env, RATE_LIMITS: memKV() }, ctx);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, text, json };
}

/** Everything a refused open or a refused revoke could have changed. */
const snapshot = () => JSON.stringify([
  db.prepare('SELECT id, view_count, used_at, revoked_at, expires_at FROM captable_share_tokens ORDER BY id').all(),
  db.prepare('SELECT COUNT(*) AS n FROM captable_share_views').get(),
  db.prepare('SELECT COUNT(*) AS n FROM cap_table_access_log').get(),
  db.prepare('SELECT id, opens, revoked_at FROM lab_report_shares ORDER BY id').all(),
  // The app-wide request log writes its own `http_*` row for every request, refused or not: not the route's write.
  db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action NOT LIKE 'http\\_%' ESCAPE '\\'").get(),
]);

const tamper = (t: string) => `${t.slice(0, -2)}${t.endsWith('AA') ? 'BB' : 'AA'}`;
const named = (text: string) => LEAKS.filter((l) => text.includes(l));

before(async () => {
  db = migratedDatabase();
  db.exec(`INSERT INTO users (id, uid, name, email, role, founder_id, is_active, subscription_tier, subscription_status) VALUES
    (${OWNER},'u-owner','Owner','owner@example.test','founder',40,1,'studio','active'),
    (${OTHER},'u-other','Other Founder','other@example.test','founder',90,1,'studio','active'),
    (${NAMED},'u-named','Named Reader','named@example.test','investor',NULL,1,'studio','active'),
    (${ADMIN},'u-admin','Admin','admin@example.test','admin',NULL,1,'studio','active'),
    (${DISABLED_NAMED},'u-dis','Disabled Reader','disabled@example.test','investor',NULL,1,'studio','active');
    INSERT INTO projects (id, uid, name, founder_id) VALUES (${VENTURE},'p-quill','${VENTURE_NAME}',40), (${ELSEWHERE},'p-else','Elsewhere',90);`);
  env = { DB: d1Over(db), JWT_SECRET: SECRET, SCORING_HMAC_SECRET: SCORING, ENVIRONMENT: 'development', RATE_LIMITS: memKV(), TOKENS: memKV() };
  for (const id of [OWNER, OTHER, NAMED, ADMIN, DISABLED_NAMED]) tokens[id] = await jwt({ user_id: id });

  // The venture's record, written by its owner: one holder the venture link shows.
  const cls = await call(`/api/captable/record/${VENTURE}/classes`, { who: OWNER, method: 'POST', body: { name: 'Common', kind: 'common' } });
  assert.equal(cls.status, 201, cls.text);
  const iss = await call(`/api/captable/record/${VENTURE}/issuances`, { who: OWNER, method: 'POST',
    body: { kind: 'founding', holder_name: HOLDER, class_uid: cls.json.class.uid, shares: 1000, issued_on: '2026-01-02' } });
  assert.equal(iss.status, 201, iss.text);

  // An official scoring run the report link freezes.
  const when = '2026-10-01 12:00:00';
  const hash = await signScore({ JWT_SECRET: SECRET, SCORING_HMAC_SECRET: SCORING } as any, VENTURE, 82, when);
  db.prepare(`INSERT INTO score_snapshots (project_id, total_score, tier, created_at, market_total, inputs_json, integrity_hash, is_sandbox)
    VALUES (?, 82, 'TIER_2', ?, 12, '{}', ?, 0)`).run(VENTURE, when, hash);
});
after(() => { db?.close(); removeMigratedDatabases(); });

async function scenarioLink(viewLimit = 5) {
  const sc = await call('/api/captable/scenarios', { who: OWNER, method: 'POST',
    body: { name: SCENARIO_NAME, inputs: { founders: [{ name: 'Quill Founder', shares: 8000000 }], option_pool_pct: 10 } } });
  assert.equal(sc.status, 200, sc.text);
  const link = await call(`/api/captable/scenarios/${sc.json.uid}/share`, { who: OWNER, method: 'POST', body: { audience: 'summary', view_limit: viewLimit } });
  assert.equal(link.status, 201, link.text);
  const id = (db.prepare('SELECT id FROM captable_share_tokens WHERE scenario_uid = ? ORDER BY id DESC LIMIT 1').get(sc.json.uid) as any).id;
  return { uid: sc.json.uid as string, token: link.json.token as string, id: id as number };
}

async function ventureLink(viewLimit = 5) {
  const link = await call(`/api/captable/access/${VENTURE}/links`, { who: OWNER, method: 'POST', body: { level: 'summary', view_limit: viewLimit } });
  assert.equal(link.status, 201, link.text);
  return { token: link.json.token as string, id: link.json.id as number };
}

async function reportLink(grantee = 'named@example.test', openLimit = 5) {
  const link = await call('/api/lab-report-shares', { who: OWNER, method: 'POST',
    body: { project_id: VENTURE, audience: 'dimensions', grantee_email: grantee, expires_in_days: 7, open_limit: openLimit, consent: true, report_kind: 'scoring' } });
  assert.equal(link.status, 201, link.text);
  return { token: link.json.token as string, id: link.json.id as number };
}

test('a cap table scenario link: a forged, unstored, cross-kind, spent or revoked token is refused, counts no view, names nothing', async () => {
  const good = await scenarioLink(2);
  const opened = await call(`/api/captable/share/${good.token}`);
  assert.equal(opened.status, 200, opened.text);
  assert.ok(opened.text.includes('Quill'), 'the fixture: a good link shows the scenario');

  const venture = await ventureLink();
  const cases: Array<[string, string, number]> = [
    ['a token with a broken signature', tamper(good.token), 403],
    ['a well-formed token signed with another key', (await mintShareToken({ ...env, JWT_SECRET: 'other-key-'.repeat(4) }, `captable:${good.uid}:full`, 3600)).token, 403],
    ['a signed scope no link stored (the audience widened to full)', (await mintShareToken(env, `captable:${good.uid}:full`, 3600)).token, 403],
    ['a venture link presented as a scenario link', venture.token, 403],
    ['not a token', 'a'.repeat(32), 403],
  ];
  for (const [why, token, status] of cases) {
    const before = snapshot();
    const res = await call(`/api/captable/share/${token}`);
    // Mutation checked: claimShareToken answering `ok` when no stored row matched → the unstored full-audience
    // scope reads the scenario and this fails. (Skipping verifyShareToken's signature comparison alone is not
    // seen here, by design: a token whose hash no link stored is refused by the claim whatever its signature.)
    assert.equal(res.status, status, `${why}: ${res.text}`);
    assert.deepEqual(named(res.text), [], `${why}: the refusal names nothing`);
    assert.equal(snapshot(), before, `${why}: no view counted, no row written`);
  }

  // Another founder, or a studio admin, may not revoke the owner's link: refused, and nothing changes.
  for (const who of [OTHER, ADMIN]) {
    const before = snapshot();
    const res = await call(`/api/captable/shares/${good.id}`, { who, method: 'DELETE' });
    // Mutation checked: DELETE /shares/:id's ensureScenarioWriteOr404 removed → another founder revokes it and this fails.
    assert.equal(res.status, 403, `revoking another's link as ${who}: ${res.text}`);
    assert.equal(snapshot(), before, `revoking another's link as ${who} changed nothing`);
  }
  assert.equal((await call(`/api/captable/shares/${good.id}`)).status, 401, 'no credentials');

  // Spent: a limit of two, one view used; the second is the last.
  assert.equal((await call(`/api/captable/share/${good.token}`)).status, 200);
  const spent = await call(`/api/captable/share/${good.token}`);
  assert.equal(spent.status, 410, spent.text);
  assert.deepEqual(named(spent.text), []);

  // Revoked by its owner: refused at once though views remain, and counts no view.
  const fresh = await scenarioLink(5);
  assert.equal((await call(`/api/captable/shares/${fresh.id}`, { who: OWNER, method: 'DELETE' })).status, 200);
  const before = snapshot();
  // Mutation checked: DELETE /shares/:id's UPDATE dropped (answers ok, revokes nothing) → the link still reads and this fails.
  const revoked = await call(`/api/captable/share/${fresh.token}`);
  assert.equal(revoked.status, 410, revoked.text);
  assert.deepEqual(named(revoked.text), []);
  assert.equal(snapshot(), before, 'a revoked link counts no view');
});

test('a cap table venture link: a forged, unstored, cross-kind, spent or revoked token is refused, logs no open, names nothing', async () => {
  const good = await ventureLink(2);
  const opened = await call(`/api/captable/access/shared/${good.token}`);
  assert.equal(opened.status, 200, opened.text);
  assert.equal(opened.json.level, 'summary', 'the fixture: a good link reads at its level');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM cap_table_access_log WHERE share_token_id = ?').get(good.id) as any).n, 1, 'an open is logged');

  const scenario = await scenarioLink();
  const nonce = '0'.repeat(32);
  const cases: Array<[string, string, number]> = [
    ['a token with a broken signature', tamper(good.token), 403],
    ['a well-formed token signed with another key', (await mintShareToken({ ...env, JWT_SECRET: 'other-key-'.repeat(4) }, `captable-venture:${VENTURE}:full:${nonce}`, 3600)).token, 403],
    ['a signed scope no link stored (the level widened to full)', (await mintShareToken(env, `captable-venture:${VENTURE}:full:${nonce}`, 3600)).token, 403],
    ['a signed scope naming another venture', (await mintShareToken(env, `captable-venture:${ELSEWHERE}:summary:${nonce}`, 3600)).token, 403],
    ['a scenario link presented as a venture link', scenario.token, 403],
    ['not a token', 'a'.repeat(32), 403],
  ];
  for (const [why, token, status] of cases) {
    const before = snapshot();
    const res = await call(`/api/captable/access/shared/${token}`);
    // Mutation checked: the stored row's agreement test (`tok.project_id`, `tok.level`) removed together with the
    // claim answering `ok` when no stored row matched → the unstored scopes read the venture and this fails.
    assert.equal(res.status, status, `${why}: ${res.text}`);
    assert.ok(!res.text.includes(HOLDER) && !res.text.includes(VENTURE_NAME), `${why}: the refusal names nothing`);
    assert.equal(snapshot(), before, `${why}: no open logged, no view counted`);
  }

  // Another founder may neither revoke the owner's link nor mint one; an admin may not revoke it either.
  for (const [who, method, path, body] of [
    [OTHER, 'DELETE', `/api/captable/access/${VENTURE}/links/${good.id}`, undefined],
    [ADMIN, 'DELETE', `/api/captable/access/${VENTURE}/links/${good.id}`, undefined],
    [OTHER, 'POST', `/api/captable/access/${VENTURE}/links`, { level: 'summary' }],
  ] as const) {
    const before = snapshot();
    const res = await call(path, { who, method, body });
    // Mutation checked: ownerOf's `a.owner` test removed (any resolved caller passes) → the admin revokes it and this fails.
    assert.equal(res.status, 403, `${method} ${path} as ${who}: ${res.text}`);
    assert.equal(snapshot(), before, `${method} ${path} as ${who} changed nothing`);
  }

  assert.equal((await call(`/api/captable/access/shared/${good.token}`)).status, 200);
  // Mutation checked: claimShareToken answering `ok` whatever the view count → the spent link reads and this fails.
  const spent = await call(`/api/captable/access/shared/${good.token}`);
  assert.equal(spent.status, 410, spent.text);

  const fresh = await ventureLink(5);
  assert.equal((await call(`/api/captable/access/${VENTURE}/links/${fresh.id}`, { who: OWNER, method: 'DELETE' })).status, 200);
  const before = snapshot();
  // Mutation checked: DELETE /:projectId/links/:id's UPDATE dropped (answers ok, revokes nothing) → the link reads and this fails.
  const revoked = await call(`/api/captable/access/shared/${fresh.token}`);
  assert.equal(revoked.status, 410, revoked.text);
  assert.ok(!revoked.text.includes(HOLDER));
  assert.equal(snapshot(), before, 'a revoked link logs no open');
});

test('a scoring report link opens only for the named account; every other caller gets the one 404, and nothing is counted', async () => {
  const good = await reportLink('named@example.test', 2);
  const forDisabled = await reportLink('disabled@example.test', 2);
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(DISABLED_NAMED); // the named account, disabled after the link was made
  const unknown = (await mintShareToken(env, `lab-report:scoring:${VENTURE}:dimensions:${NAMED}:x`, 3600)).token;

  const cases: Array<[string, number | undefined, string, number]> = [
    ['no credentials', undefined, good.token, 401],
    ['the named account, disabled', DISABLED_NAMED, forDisabled.token, 401],
    ["the report's owner (not the named account)", OWNER, good.token, 404],
    ['another founder', OTHER, good.token, 404],
    ['a studio admin', ADMIN, good.token, 404],
    ['the named account, with a token no link stored', NAMED, unknown, 404],
    ['the named account, with a broken token', NAMED, tamper(good.token), 404],
  ];
  for (const [why, who, token, status] of cases) {
    const before = snapshot();
    const res = await call(`/api/lab-report-shares/open/${token}`, { who });
    // Mutation checked: the open's `grantee_user_id = ?` dropped from the claim → the owner, another founder and the
    // admin open it (200) and this fails.
    assert.equal(res.status, status, `${why}: ${res.text}`);
    assert.deepEqual(named(res.text), [], `${why}: the refusal names nothing`);
    if (status === 404) assert.equal(res.json?.error, 'lab_report_share_unavailable', `${why}: the one refusal, whoever asks`);
    assert.equal(snapshot(), before, `${why}: no open counted`);
  }

  const opened = await call(`/api/lab-report-shares/open/${good.token}`, { who: NAMED });
  assert.equal(opened.status, 200, opened.text);
  assert.equal(opened.json.total_score, 82, 'the fixture: the named account reads the frozen score');

  // Revoke: only the owner. Another founder, the named reader and an admin get the same 404, and nothing changes.
  for (const who of [OTHER, NAMED, ADMIN]) {
    const before = snapshot();
    const res = await call(`/api/lab-report-shares/${good.id}/revoke`, { who, method: 'POST' });
    // Mutation checked: revoke's `row.owner_user_id !== user.id` test removed → another founder revokes it and this fails.
    assert.equal(res.status, 404, `revoke as ${who}: ${res.text}`);
    assert.equal(snapshot(), before, `revoke as ${who} changed nothing`);
  }
  assert.equal((await call(`/api/lab-report-shares/${good.id}/revoke`, { method: 'POST' })).status, 401, 'no credentials');
  assert.equal((await call(`/api/lab-report-shares/${good.id}/revoke`, { who: OWNER, method: 'POST' })).status, 200);
  const before = snapshot();
  // Mutation checked: the open's `revoked_at IS NULL` dropped → the revoked link opens and this fails.
  const revoked = await call(`/api/lab-report-shares/open/${good.token}`, { who: NAMED });
  assert.equal(revoked.status, 404, revoked.text);
  assert.equal(snapshot(), before, 'a revoked link counts no open');
});
