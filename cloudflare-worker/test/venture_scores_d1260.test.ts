/**
 * D1260 (#3283, part 7 of #2428) — Screening and venture risk read the
 * scorecard: the ten venture-risk layers as Risk's sub-rows on every
 * scorecard read, the model in force on `/models`, and a screening desk that
 * sends no Lab score. Full schema; every person and figure is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/venture_scores_d1260.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, compareMigrations, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import routes from '../src/routes/venture_scores.ts';
import deals from '../src/routes/deals.ts';
import { mapError } from '../src/routes/_t13t14t15_helpers.ts';
import { riskLayers } from '../src/services/ventureScoring/riskLayers.ts';
import { LAYERS } from '../src/services/ventureRisk.ts';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network disabled in D1260 fixtures'); };
after(() => { globalThis.fetch = realFetch; });

const secret = 'synthetic-d1260-only-'.repeat(3);
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const ddl = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(read('../sql/schema_baseline.sql'));
  for (const name of readdirSync(new URL('../sql/migrations/', import.meta.url)).filter((n) => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations)) {
    if (migrationNumber(name) > BASELINE_CUTOFF) db.exec(read(`../sql/migrations/${name}`));
  }
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map((r) => r.sql).join(';\n');
  db.close();
  return sql;
})();

// 1 founder, 3 advisor shared with, 4 investor on the deal, 5 investor off it, 6 Operating Partner, 11 Admin.
const ROLES: Record<number, string> = { 1: 'founder', 3: 'advisor', 4: 'investor', 5: 'investor', 6: 'partner', 11: 'admin' };
const NOTE = 'PRIVATE ANALYST NOTE';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(ddl);
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,is_active) VALUES
      (1,'f@example.test','Synthetic Founder','founder',20,1),(3,'a@example.test','Shared Advisor','advisor',NULL,1),
      (4,'i@example.test','Deal Investor','investor',NULL,1),(5,'o@example.test','Off Investor','investor',NULL,1),
      (6,'p@example.test','Operating Partner','partner',NULL,1),(11,'h@example.test','Plain Admin','admin',NULL,1);
    INSERT INTO projects(id,name,founder_id,status,stage,lifecycle_stage,sector) VALUES (10,'Synthetic venture',20,'spinout','seed','build','fintech'),(11,'Other venture',99,'spinout','seed','build','health');
    INSERT INTO project_members(project_id,user_id,role,status) VALUES (10,3,'advisor','accepted');
    INSERT INTO deals(id,project_id,status) VALUES (100,10,'active'),(101,11,'active');
    INSERT INTO deal_invitations(deal_id,investor_user_id) VALUES (100,4);
    INSERT INTO venture_score_sharing(project_id,audience,user_id,enabled,updated_by,updated_at) VALUES (10,'advisor',3,1,1,'2026-10-26');
    INSERT INTO venture_risk_overrides(project_id,layer_key,analyst_score,analyst_band,analyst_note,status,updated_by,updated_at)
      VALUES (10,'market',72,NULL,'${NOTE}','open',6,'2026-10-20 10:00:00'),(10,'hiring',NULL,NULL,'note only','open',6,'2026-10-21 10:00:00'),
             (10,'founder',20,'high',NULL,'flagged',6,'2026-10-22 10:00:00');
    INSERT INTO score_snapshots(project_id,total_score,tier,is_sandbox,created_at) VALUES (10,91,'A',0,'2026-10-01'),(11,88,'A',0,'2026-10-01');`);
  const env: any = { DB: d1Over(db), JWT_SECRET: secret, SCORING_HMAC_SECRET: secret, ENVIRONMENT: 'development' };
  const app = new Hono().route('/vs', routes).route('/deals', deals);
  app.onError((e, c) => (e instanceof Response ? e : mapError(c as any, e)));
  const call = async (who: number, method: string, path: string) => {
    const tok = await new SignJWT({ user_id: who, role: ROLES[who] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret));
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } }, env)
      .catch((e) => { if (e instanceof Response) return e; throw e; });
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  return { db, env, call };
}
const riskOf = (scopes: any[]) => scopes.find((s) => s.scope === 'risk');

test('the ten layers are Risk\'s sub-rows: an analyst\'s review or Not reviewed, never 0; notes only when asked', async () => {
  const f = fixture();
  const withNotes = await riskLayers(f.env, 10, { notes: true });
  assert.deepEqual(withNotes.map((l) => l.key), LAYERS.map((l) => l.key), 'the ten, in their one order');
  const by = Object.fromEntries(withNotes.map((l) => [l.key, l]));
  assert.deepEqual([by.market.state, by.market.score, by.market.band, by.market.reviewed_on, by.market.note], ['reviewed', 72, 'low', '2026-10-20', NOTE]);
  assert.deepEqual([by.founder.score, by.founder.band], [20, 'high'], 'a stored band is kept');
  assert.deepEqual([by.hiring.state, by.hiring.score, by.hiring.band, by.hiring.reviewed_on], ['not_reviewed', null, null, null], 'a note with no score is not a review');
  assert.deepEqual([by.timing.state, by.timing.score], ['not_reviewed', null], 'no row is Not reviewed, never 0');
  const plain = await riskLayers(f.env, 10, { notes: false });
  assert.ok(plain.every((l) => !('note' in l)), 'a note left without being asked for');
  assert.ok((await riskLayers(f.env, 11, { notes: true })).every((l) => l.state === 'not_reviewed'), 'another venture\'s reviews leaked');
});

test('every scorecard read carries the layers on Risk alone; the note is staff\'s; an investor sees them only after the NDA', async () => {
  const f = fixture();
  const staff = await f.call(6, 'GET', '/vs/10');
  assert.equal(staff.status, 200);
  assert.equal(riskOf(staff.body.scopes).layers.find((l: any) => l.key === 'market').note, NOTE);
  assert.equal(staff.body.scopes.filter((s: any) => 'layers' in s).length, 1, 'layers on a scope other than Risk');
  const founder = await f.call(1, 'GET', '/vs/10');
  assert.equal(riskOf(founder.body.scopes).layers.length, 10);
  assert.doesNotMatch(JSON.stringify(founder.body), new RegExp(NOTE), 'the founder reads the analyst\'s note');
  assert.equal(riskOf(founder.body.investor_preview.after_nda).layers.length, 10, 'the preview after the NDA differs from what the investor gets');
  assert.ok(!('layers' in riskOf(founder.body.investor_preview.before_nda)), 'the preview before the NDA shows layers');
  const advisor = await f.call(3, 'GET', '/vs/10');
  assert.equal(advisor.status, 200);
  assert.equal(riskOf(advisor.body.scopes).layers.find((l: any) => l.key === 'market').score, 72);
  assert.doesNotMatch(JSON.stringify(advisor.body), new RegExp(NOTE));
  const masked = await f.call(4, 'GET', '/vs/deal/100');
  assert.equal(masked.status, 200); assert.equal(masked.body.nda, false);
  assert.ok(!('layers' in riskOf(masked.body.scopes)), 'an investor before the NDA reads the layers');
  f.db.exec(`INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,status,valid_until) VALUES (1,4,'active',NULL)`);
  const open = await f.call(4, 'GET', '/vs/deal/100');
  assert.equal(open.body.nda, true);
  assert.equal(riskOf(open.body.scopes).layers.find((l: any) => l.key === 'market').score, 72);
  assert.doesNotMatch(JSON.stringify(open.body), new RegExp(NOTE), 'an investor reads the analyst\'s note');
  assert.equal((await f.call(5, 'GET', '/vs/deal/100')).status, 403, 'an investor off the deal reads anything');
  assert.equal((await f.call(4, 'GET', '/vs/10')).status, 403, 'an investor reads by venture id');
});

test('/models names the model in force: v1.0 by default, then the published version and its day', async () => {
  const f = fixture();
  const first = await f.call(4, 'GET', '/vs/models');
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.live, { version: '1.0', published_at: null, default_live: true });
  assert.equal(first.body.version, '1.0');
  f.db.exec(`INSERT INTO venture_model_publications(version,published_by,published_at,ventures_total,ventures_done,ventures_failed,cursor_project_id) VALUES ('1.1',11,'2026-10-26 09:00:00',2,0,0,0)`);
  const next = await f.call(4, 'GET', '/vs/models');
  assert.deepEqual(next.body.live, { version: '1.1', published_at: '2026-10-26 09:00:00', default_live: false });
  assert.equal(next.body.version, '1.1');
  const geo = next.body.scopes.find((s: any) => s.scope === 'geographic');
  assert.ok(geo.inputs.some((i: any) => i.source), 'v1.1 cites the store its index inputs read');
  assert.doesNotMatch(JSON.stringify(next.body), /published_by|Plain Admin/, 'the publisher is named to every member');
});

test('the screening desk sends no Lab score, tier or flag, and keeps its reader rule', async () => {
  const f = fixture();
  const admin = await f.call(11, 'GET', '/deals/screening');
  assert.equal(admin.status, 200);
  assert.deepEqual(admin.body.desk.rows.map((r: any) => r.deal_id).sort(), [100, 101]);
  assert.doesNotMatch(JSON.stringify(admin.body), /total_score|"tier"|anomaly|dimensions|rubric|"91"|\b91\b|\b88\b/, 'a Lab score reached the desk');
  assert.ok(!('scored' in admin.body) && !('flags' in admin.body));
  const investor = await f.call(4, 'GET', '/deals/screening');
  assert.equal(investor.status, 200);
  assert.deepEqual(investor.body.desk.rows.map((r: any) => r.deal_id), [100], 'an investor sees a deal they are not on');
  assert.deepEqual(Object.keys(investor.body.desk.rows[0]).sort(), ['company', 'deal_id', 'deal_status', 'sector']);
  assert.equal((await f.call(1, 'GET', '/deals/screening')).status, 403);
});
