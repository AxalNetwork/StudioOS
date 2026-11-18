/**
 * #6173 part 1 (D6173) — `GET /api/venture-scores/deal/:dealId` gives each scope its change since the investor's last
 * visit for this firm, after the NDA only: a difference between two stored, verified versions, never invented, and Not
 * recorded with its reason otherwise. Synthetic fixtures only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/deal_score_change_6173.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import routes from '../src/routes/venture_scores.ts';
import { mapError } from '../src/routes/_t13t14t15_helpers.ts';
import { CHANGE_REASONS, scorecardRowSignature } from '../src/services/ventureScoring/store.ts';
import { loadSchema } from './_schema_once.mjs';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network disabled in the #6173 fixtures'); };
after(() => { globalThis.fetch = realFetch; });

const SECRET = 'd6173-score-change-fixture-only-'.repeat(2); // A fixture signing key; never a service credential.
const FOUNDER = 1, INVESTOR = 4;
const SEEN = '2026-11-01T00:00:00.000Z';

async function fixture({ nda = true, seen = SEEN as string | null } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,is_active) VALUES (${FOUNDER},'f@example.test','Synthetic Founder','founder',20,1),(${INVESTOR},'i@example.test','Synthetic Investor','investor',NULL,1);
    INSERT INTO projects(id,name,founder_id,status,stage,lifecycle_stage,sector) VALUES (10,'Example venture',20,'spinout','seed','build','fintech');
    INSERT INTO deals(id,project_id,status) VALUES (100,10,'active');
    INSERT INTO deal_invitations(deal_id,investor_user_id) VALUES (100,${INVESTOR});
    INSERT INTO venture_score_sharing(project_id,audience,user_id,enabled,updated_by,updated_at) VALUES (10,'investors',0,1,${FOUNDER},'2026-10-26');`);
  if (nda) db.exec(`INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,status) VALUES (${FOUNDER},${INVESTOR},'active')`);
  if (seen) db.prepare('INSERT INTO deal_seen(deal_id,user_id,company_id,last_seen_at) VALUES (100,?,NULL,?)').run(INVESTOR, seen);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, SCORING_HMAC_SECRET: SECRET, ENVIRONMENT: 'development' };
  let n = 0;
  const version = async (scope: string, value: number | null, at: string, model = '1.0', { tamper = false } = {}) => {
    n += 1;
    const row = { project_id: 10, scope, uid: `v${n}`, value, band: value == null ? null : 'Fair', confidence: 0.8, coverage: 0.8,
      inputs_json: JSON.stringify({ result: { inputs: [] } }), inputs_hash: `h${n}`, model_version: model, trigger: 'rescore', computed_by: null, computed_at: at,
      state: value == null ? 'not_enough' : 'scored' };
    const signature = tamper ? 'f'.repeat(64) : await scorecardRowSignature(env, row);
    db.prepare(`INSERT INTO venture_scorecards (uid, project_id, scope, value, band, confidence, coverage, inputs_json, inputs_hash, signature, model_version, trigger, computed_by, computed_at, state)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.uid, 10, scope, value, row.band, 0.8, 0.8, row.inputs_json, row.inputs_hash, signature, model, 'rescore', null, at, row.state);
  };
  await version('team', 60, '2026-10-01T10:00:00.000Z');
  await version('team', 58, '2026-10-20T10:00:00.000Z');          // the version current at the visit
  await version('team', 64, '2026-11-05T10:00:00.000Z');          // now: +6
  await version('market', 70, '2026-10-01T10:00:00.000Z');        // one version only
  await version('technical', 50, '2026-11-03T10:00:00.000Z');     // both versions after the visit
  await version('technical', 55, '2026-11-04T10:00:00.000Z');
  await version('traction', 40, '2026-10-01T10:00:00.000Z', '0.9'); // another model then
  await version('traction', 45, '2026-11-04T10:00:00.000Z');
  await version('financial', 30, '2026-10-01T10:00:00.000Z', '1.0', { tamper: true }); // the earlier version does not verify
  await version('financial', 33, '2026-11-04T10:00:00.000Z');
  await version('governance', null, '2026-10-01T10:00:00.000Z');  // no score at the visit
  await version('governance', 52, '2026-11-04T10:00:00.000Z');
  await version('legal_ip', 61, '2026-10-01T10:00:00.000Z');      // unchanged: a recorded 0
  await version('legal_ip', 61, '2026-11-04T10:00:00.000Z');
  const app = new Hono().route('/api/venture-scores', routes);
  app.onError((e, c) => (e instanceof Response ? e : mapError(c as any, e)));
  const call = async (path: string) => {
    const token = await new SignJWT({ user_id: INVESTOR, role: 'investor' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`/api/venture-scores${path}`, { headers: { Authorization: `Bearer ${token}` } }, env).catch((e) => { if (e instanceof Response) return e; throw e; });
    return { status: res.status, json: await res.json() as any };
  };
  return { db, call };
}
const changes = (json: any) => Object.fromEntries(json.scopes.map((s: any) => [s.scope, s.change]));

// Mutation checked: the baseline as the first version, not the one current at the visit (fails); the delta's sign flipped
// (fails); one version compared with itself (fails); a version after the visit used as the baseline (fails); two models
// compared (fails); a row that does not verify compared (fails); a null then read as 0 (fails); an unchanged score dropped (fails).
test('after the NDA: each scope\'s change against the version current at the last visit, or why there is none', async () => {
  const f = await fixture();
  const r = await f.call('/deal/100');
  assert.equal(r.status, 200);
  assert.equal(r.json.nda, true);
  assert.equal(r.json.change_since, SEEN);
  const c = changes(r.json);
  assert.deepEqual(c.team, { state: 'recorded', delta: 6, from: 58, to: 64, from_computed_at: '2026-10-20T10:00:00.000Z', since: SEEN });
  assert.deepEqual(c.legal_ip, { state: 'recorded', delta: 0, from: 61, to: 61, from_computed_at: '2026-10-01T10:00:00.000Z', since: SEEN }, 'no change is a recorded 0');
  assert.deepEqual(c.market, { state: 'not_recorded', reason: CHANGE_REASONS.oneVersion });
  assert.deepEqual(c.technical, { state: 'not_recorded', reason: CHANGE_REASONS.noneBefore });
  assert.deepEqual(c.traction, { state: 'not_recorded', reason: CHANGE_REASONS.modelChanged });
  assert.deepEqual(c.financial, { state: 'unreadable', reason: CHANGE_REASONS.unreadable });
  assert.deepEqual(c.governance, { state: 'not_recorded', reason: CHANGE_REASONS.noScoreThen });
  assert.deepEqual(c.pmf, { state: 'not_recorded', reason: CHANGE_REASONS.noScore }, 'no score now');
});

// Mutation checked: a change before the NDA (fails); a first visit compared with something (fails).
test('before the NDA there is no change at all; a first visit says there is nothing to compare with', async () => {
  const masked = await (await fixture({ nda: false })).call('/deal/100');
  assert.equal(masked.json.nda, false);
  assert.ok(masked.json.scopes.every((s: any) => !('change' in s)), 'never before the NDA');
  assert.equal('change_since' in masked.json, false);
  const first = await (await fixture({ seen: null })).call('/deal/100');
  assert.equal(first.json.change_since, null);
  assert.deepEqual(changes(first.json).team, { state: 'not_recorded', reason: CHANGE_REASONS.firstVisit });
});

// Mutation checked: ?since= ignored (fails); a since later than the stored visit accepted (fails); a malformed since accepted (fails).
test('?since= is the page\'s What\'s new watermark: an earlier one is used; a later or malformed one is not', async () => {
  const f = await fixture();
  const earlier = await f.call('/deal/100?since=2026-10-10T00:00:00.000Z');
  assert.equal(earlier.json.change_since, '2026-10-10T00:00:00.000Z');
  assert.deepEqual(changes(earlier.json).team, { state: 'recorded', delta: 4, from: 60, to: 64, from_computed_at: '2026-10-01T10:00:00.000Z', since: '2026-10-10T00:00:00.000Z' });
  for (const bad of ['2026-11-10T00:00:00.000Z', 'yesterday', "2026-10-10' OR 1=1--"]) {
    assert.equal((await f.call(`/deal/100?since=${encodeURIComponent(bad)}`)).json.change_since, SEEN, bad);
  }
});
