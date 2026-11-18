/**
 * #6173 part 2 (D6173) — `GET /api/deals/:id/case`, the Investment case: thesis fit, main evidence, this firm's open
 * questions and risks, and thinly evidenced scopes. Each block has its own state; nothing another firm wrote and nothing
 * the NDA or the founder's switch holds back. Synthetic fixtures only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/deal_case_6173.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import dealCase, { CASE_REASONS, LOW_COVERAGE } from '../src/routes/deal_case.ts';
import { scorecardRowSignature } from '../src/services/ventureScoring/store.ts';
import { loadSchema } from './_schema_once.mjs';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network disabled in the #6173 fixtures'); };
after(() => { globalThis.fetch = realFetch; });

const SECRET = 'd6173-deal-case-fixture-only-'.repeat(2); // A fixture signing key; never a service credential.
const FOUNDER = 1, INVESTOR = 4, OTHER = 5, ADMIN = 9;

async function fixture({ nda = true, shared = true, thesis = true, notes = true, evidenceTable = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,is_active) VALUES (${FOUNDER},'f@example.test','Synthetic Founder','founder',20,1),
      (${INVESTOR},'i@example.test','Ivy Investor','investor',NULL,1),(${OTHER},'o@example.test','Oli Other','investor',NULL,1),(${ADMIN},'a@example.test','Ada Admin','admin',NULL,1);
    INSERT INTO projects(id,name,founder_id,status,stage,lifecycle_stage,sector) VALUES (10,'Example venture',20,'spinout','seed','build','fintech');
    INSERT INTO deals(id,project_id,status,minimum_check,currency) VALUES (100,10,'active',25000,'USD');
    INSERT INTO deal_invitations(deal_id,investor_user_id) VALUES (100,${INVESTOR}),(100,${OTHER});
    INSERT INTO venture_score_sharing(project_id,audience,user_id,enabled,updated_by,updated_at) VALUES (10,'investors',0,${shared ? 1 : 0},${FOUNDER},'2026-10-26');`);
  if (thesis) db.prepare(`INSERT INTO investor_profiles(user_id,sectors_json,stages_json,geos_json,anti_thesis_sectors_json,anti_thesis_stages_json) VALUES (?,?,?,?,?,?)`)
    .run(INVESTOR, '["fintech"]', '["seed"]', '[]', '[]', '[]');
  if (nda) db.exec(`INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,status) VALUES (${FOUNDER},${INVESTOR},'active')`);
  if (notes) {
    const n = db.prepare('INSERT INTO deal_notes(uid,deal_id,author_user_id,company_id,tag,body,created_at) VALUES (?,?,?,?,?,?,?)');
    n.run('n1', 100, INVESTOR, null, 'Question', 'How is churn measured?', '2026-11-01T10:00:00.000Z');
    n.run('n2', 100, INVESTOR, null, 'risk', 'Single bank partner.', '2026-11-02T10:00:00.000Z');
    n.run('n3', 100, INVESTOR, null, 'Follow-up', 'Call the founder.', '2026-11-03T10:00:00.000Z');          // another tag
    n.run('n4', 100, OTHER, null, 'Question', 'OTHER-INVESTOR-PRIVATE', '2026-11-03T10:00:00.000Z');       // another investor's own note
    n.run('n5', 100, OTHER, 77, 'Risk', 'ANOTHER-FIRM-NOTE', '2026-11-03T10:00:00.000Z');                    // another firm's note
  }
  if (!evidenceTable) db.exec('DROP TABLE raise_evidence_items');
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, SCORING_HMAC_SECRET: SECRET, ENVIRONMENT: 'development' };
  let k = 0;
  for (const [scope, value, coverage] of [['team', 70, 0.9], ['market', 55, 0.3], ['technical', null, 0.1]] as const) {
    k += 1;
    const row = { project_id: 10, scope, uid: `s${k}`, value, band: value == null ? null : 'Fair', confidence: 0.7, coverage, inputs_json: JSON.stringify({ result: { inputs: [] } }),
      inputs_hash: `h${k}`, model_version: '1.0', trigger: 'rescore', computed_by: null, computed_at: '2026-11-01T10:00:00.000Z', state: value == null ? 'not_enough' : 'scored' };
    db.prepare(`INSERT INTO venture_scorecards (uid, project_id, scope, value, band, confidence, coverage, inputs_json, inputs_hash, signature, model_version, trigger, computed_by, computed_at, state)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.uid, 10, scope, value, row.band, 0.7, coverage, row.inputs_json, row.inputs_hash, await scorecardRowSignature(env, row), '1.0', 'rescore', null, row.computed_at, row.state);
  }
  const app = new Hono().route('/api/deals', dealCase);
  const call = async (who: number, path = '/100/case') => {
    const role = who === ADMIN ? 'admin' : 'investor';
    const token = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`/api/deals${path}`, { headers: { Authorization: `Bearer ${token}` } }, env).catch((e) => { if (e instanceof Response) return e; throw e; });
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  };
  return { db, call };
}

// Mutation checked: another tag listed (fails); another firm's or another investor's note listed (fails); a well-covered
// scope listed as missing (fails); a not_enough scope left out (fails); the fit block not computed for this deal (fails).
test('the case: each block from what the caller may read, for this firm', async () => {
  const r = await (await fixture()).call(INVESTOR);
  assert.equal(r.status, 200);
  assert.equal(r.json.deal_id, 100);
  assert.equal(r.json.thesis_fit.state, 'recorded');
  assert.deepEqual(r.json.thesis_fit.fit.criteria.filter((c: any) => ['sector', 'stage'].includes(c.key)).map((c: any) => [c.key, c.state]), [['sector', 'match'], ['stage', 'match']]);
  assert.deepEqual(r.json.open_questions.items.map((n: any) => [n.uid, n.tag]), [['n2', 'risk'], ['n1', 'Question']], 'Question and Risk, any case, newest first');
  assert.doesNotMatch(r.text, /OTHER-INVESTOR-PRIVATE|ANOTHER-FIRM-NOTE|Call the founder/);
  assert.deepEqual(r.json.missing, { state: 'recorded', threshold: LOW_COVERAGE, scopes: [
    { scope: 'market', label: r.json.missing.scopes[0].label, state: 'scored', coverage: 0.3 },
    { scope: 'technical', label: r.json.missing.scopes[1].label, state: 'not_enough', coverage: 0.1 },
  ] });
  assert.equal(r.json.main_evidence.state, 'not_recorded');
  assert.equal(r.json.main_evidence.reason, CASE_REASONS.noEvidence);
});

// Mutation checked: missing scopes before the NDA (fails); missing scopes with the founder's switch off (fails); no thesis read as a fit (fails);
// no notes read as none-without-reason (fails).
test('what the NDA or the founder holds back is not in the case; an empty block says why', async () => {
  const before = await (await fixture({ nda: false })).call(INVESTOR);
  assert.deepEqual(before.json.missing, { state: 'not_recorded', reason: CASE_REASONS.beforeNda });
  assert.doesNotMatch(before.text, /"coverage"\s*:\s*0\.3/);
  const locked = await (await fixture({ shared: false })).call(INVESTOR);
  assert.deepEqual(locked.json.missing, { state: 'not_recorded', reason: CASE_REASONS.scoresLocked });
  const bare = await (await fixture({ thesis: false, notes: false })).call(INVESTOR);
  assert.equal(bare.json.thesis_fit.state, 'not_recorded');
  assert.equal(bare.json.thesis_fit.reason, CASE_REASONS.thesisNotSet);
  assert.deepEqual(bare.json.open_questions, { state: 'not_recorded', reason: CASE_REASONS.noQuestions });
});

// Mutation checked: a failed evidence read drawn as none (fails); one block failing the whole read (fails).
test('a block whose read fails is unreadable, and the others still answer', async () => {
  const r = await (await fixture({ evidenceTable: false })).call(INVESTOR);
  assert.equal(r.status, 200);
  assert.equal(r.json.main_evidence.state, 'unreadable');
  assert.equal(r.json.open_questions.state, 'recorded');
  assert.equal(r.json.thesis_fit.state, 'recorded');
});

// Mutation checked: the investor licence gate dropped (fails); a deal the investor is not on answering (fails).
test('only an investor on the deal reads its case', async () => {
  const f = await fixture();
  assert.equal((await f.call(ADMIN)).status, 403, 'no staff bypass: the case is the firm\'s');
  assert.equal((await f.call(INVESTOR, '/101/case')).status, 404);
  assert.equal((await f.call(INVESTOR, '/abc/case')).status, 400);
});
