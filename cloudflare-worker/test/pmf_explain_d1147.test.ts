import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { recomputePmf, storedPmfInputs } from '../src/services/scoring/pmfStore.ts';
import { explanationInputs, explanationPrompt, parseExplanation, PMF_EXPLAIN_PAGE, PMF_EXPLAIN_OPTIONS } from '../src/services/scoring/pmfExplain.ts';
import { createPmfExplainRouter } from '../src/routes/pmf_explain.ts';
import { neverFillReason } from '../src/services/fills/neverFill.ts';
import { recordFill } from '../src/services/fills/provenance.ts';
import { signHmac } from '../src/services/scoreIntegrity.ts';
import type { PmfInputResult } from '../src/services/scoring/pmf.ts';
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
let previousFetch: typeof fetch;
beforeEach(() => { previousFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('Providers, including Mercury, are stubbed'); }; });
afterEach(() => { globalThis.fetch = previousFetch; });
async function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const baseline = read('../sql/schema_baseline.sql');
  for (const t of ['users','projects','activity_logs','data_room_files','raise_prospects','spinout_deck_overrides','discovery_interviews','interview_pain_severities','pain_groups','pain_group_aliases','hypotheses','hypothesis_pain_links','waitlist_signups','metric_targets','validation_decisions','roadmap_okrs','competitor_analyses','competitor_candidates','competitor_sources','competitor_signals']) db.exec(tableFromBaseline(baseline, t));
  for (const f of ['311_revenue_entries.sql','440_validate_cycle_stores.sql','464_verdict_decisions.sql','460_validate_record_stores.sql','438_interview_sessions.sql','499_github_roadmap.sql','442_raise_cycle_stores.sql','536_readiness_stated_evidence.sql','558_readiness_scores_nullable_score.sql','598_venture_scorecards.sql']) db.exec(read('../sql/migrations/' + f));
  db.exec(tableFromBaseline(read('../sql/migrations/221_research_ask_sessions.sql'), 'research_zone_drafts'));
  db.exec(`INSERT INTO users(id,email,name,role,is_active,founder_id) VALUES
    (1,'owner@example.test','Synthetic owner','founder',1,11),(2,'other@example.test','Other owner','founder',1,22),
    (3,'admin@example.test','Synthetic admin','admin',1,11),(4,'investor@example.test','Synthetic investor','investor',1,NULL),(5,'partner@example.test','Synthetic partner','partner',1,NULL);
    INSERT INTO projects(id,name,founder_id) VALUES(1,'Synthetic venture',11),(2,'Other venture',22);
    INSERT INTO demand_signals(project_id,kind,status,signal_date,who) VALUES(1,'need_to_have','confirmed','2026-10-01','Private fixture buyer');
    INSERT INTO customer_segments(id,project_id,name,name_norm,source) VALUES(1,1,'Synthetic segment','synthetic segment','manual');
    INSERT INTO discovery_interviews(id,project_id,interviewee_name,notes,stage,done_at,icp_fit,segment_id,pains_json)
      VALUES(1,1,'Private fixture interviewee','Private fixture quote','done','2026-10-01','strong',1,'[]');
    INSERT INTO metric_targets(project_id,metric_key,target_value) VALUES(1,'waitlist_target',10);
    INSERT INTO waitlist_signups(project_id,email,audience,created_at) VALUES(1,'hidden@example.test','customer','2026-10-01');`);
  const env: any = { DB: d1Over(db), JWT_SECRET: crypto.randomUUID() + crypto.randomUUID(), ENVIRONMENT: 'development' };
  await recomputePmf(env, 1, 1, 'module_read', '2026-10-25');
  const displayedHash = (await storedPmfInputs(env, 1))!.hash;
  let model: any = null;
  let output: string | null = null;
  let refusal: string | null = null;
  const app = new Hono<any>();
  app.route('/api/cycles/raise/pmf/explain', createPmfExplainRouter((async (_env: any, params: any) => {
    model = params;
    if (refusal) return { ok: false, refusal };
    const rows = JSON.parse(params.text.split('INPUT PAYLOAD:\n')[1]);
    return { ok: true, output: output ?? JSON.stringify({ items: rows.map((r: any) => ({ input: r.key, text: 'Explore the experience behind this evidence.' })) }), usage: { model: 'synthetic-model', est_cost_usd: 0.001 } };
  }) as any));
  async function call(user: number | null, method = 'POST', body: any = { mode: 'explain' }, path = '?project=1', operator?: number) {
    if (body?.mode && !Object.prototype.hasOwnProperty.call(body, 'inputs_hash')) body = { ...body, inputs_hash: displayedHash };
    const headers: any = { 'Content-Type': 'application/json' };
    if (user !== null) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: user, ...(operator ? { impersonated_by: operator } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
    const res = await app.request('/api/cycles/raise/pmf/explain' + path, { method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: res.status, body: await res.json() as any };
  }
  const state = () => JSON.stringify({ scores: db.prepare('SELECT * FROM venture_scorecards').all(), checklist: db.prepare('SELECT * FROM readiness_scores').all(), activity: db.prepare('SELECT * FROM activity_logs').all(), drafts: db.prepare('SELECT * FROM research_zone_drafts').all() });
  return { db, env, call, state, model: () => model, output: (v: string) => { output = v; }, refusal: (v: string) => { refusal = v; } };
}
test('Explain reads only the verified input payload, cites recorded inputs exactly, and writes nothing before Keep', async () => {
  const f = await fixture(); const before = f.state();
  const result = await f.call(1);
  assert.equal(result.status, 200); assert.equal(result.body.surface, 'raise/pmf-explain');
  assert.deepEqual(result.body.items.map((i: any) => i.input), explanationInputs((await storedPmfInputs(f.env, 1))!.inputs, 'explain').map(i => i.key));
  assert.equal(result.body.items.every((i: any) => i.citation.state === 'recorded' && i.citation.label && i.citation.words), true);
  assert.deepEqual(result.body.items.map((i: any) => i.citation), (await storedPmfInputs(f.env, 1))!.inputs.filter(i => i.state === 'recorded').map(i => ({ label: i.label, state: i.state, words: i.words, grade: i.grade, stale: i.stale, module: i.module })));
  assert.equal(typeof result.body.receipt.signature, 'string'); assert.equal(f.state(), before);
  assert.equal(f.model().task, 'workspace_explain'); assert.equal(f.model().surface, '/raise/fundraising-readiness');
  assert.deepEqual(f.model().rail, { page: PMF_EXPLAIN_PAGE, option: PMF_EXPLAIN_OPTIONS.explain, record: null });
  assert.doesNotMatch(f.model().text, /Private fixture|hidden@example|contribution|computed_by|"steps"|"value"|"verdict"/);
  const fresh = await f.call(1, 'GET'); assert.equal(fresh.body.reading, null);
});
test('Keep writes one owner-scoped reading and actor audit, preserves scores, and is idempotent', async () => {
  const f = await fixture(); const before = f.db.prepare('SELECT * FROM venture_scorecards').all();
  const preview = await f.call(1);
  const kept = await f.call(1, 'POST', { receipt: preview.body.receipt }, '/keep?project=1');
  assert.equal(kept.status, 200); assert.deepEqual(kept.body.reading.items, preview.body.items);
  assert.deepEqual(f.db.prepare('SELECT * FROM venture_scorecards').all(), before);
  assert.equal((f.db.prepare('SELECT COUNT(*) n FROM research_zone_drafts').get() as any).n, 1);
  const row = f.db.prepare('SELECT owner_user_id,cost_micro_usd,accepted_at FROM research_zone_drafts').get() as any;
  assert.equal(row.owner_user_id, 1); assert.equal(row.cost_micro_usd, 1000); assert.ok(row.accepted_at);
  const audit = f.db.prepare("SELECT user_id,actor,details FROM activity_logs WHERE action='pmf_reading_kept'").get() as any;
  assert.equal(audit.user_id, 1); assert.equal(audit.actor, 'user:1'); assert.doesNotMatch(audit.details, /Explore|Private|value|confidence/);
  assert.equal((await f.call(1, 'POST', { receipt: preview.body.receipt }, '/keep?project=1')).status, 200);
  assert.equal((f.db.prepare("SELECT COUNT(*) n FROM activity_logs WHERE action='pmf_reading_kept'").get() as any).n, 1);
  assert.deepEqual((await f.call(1, 'GET')).body.reading, kept.body.reading);
  assert.equal((await f.call(2, 'GET', null, '?project=2')).body.reading, null);
});
test('questions use the lowest-confidence applicable inputs, return no Keep receipt, and write nothing', async () => {
  const f = await fixture(); const before = f.state();
  const result = await f.call(1, 'POST', { mode: 'questions' });
  assert.equal(result.status, 200); assert.equal(result.body.receipt, undefined);
  const inputs = (await storedPmfInputs(f.env, 1))!.inputs;
  const expected = [...inputs].filter(i => i.state !== 'not_expected').sort((a, b) => a.grade_factor - b.grade_factor).slice(0, 3);
  assert.deepEqual(result.body.items.map((i: any) => i.input), expected.map(i => i.key));
  assert.equal(f.model().rail.option, PMF_EXPLAIN_OPTIONS.questions); assert.equal(f.state(), before);
  assert.equal((await f.call(1, 'POST', { items: result.body.items }, '/keep?project=1')).status, 400); assert.equal(f.state(), before);
});
test('other founders, admins with residual founder links, investors, partners and support sessions cannot run, read or Keep', async () => {
  const f = await fixture(); const before = f.state();
  for (const user of [null, 2, 3, 4, 5]) for (const method of ['GET', 'POST']) {
    assert.equal((await f.call(user, method)).status, user === null ? 401 : 403);
  }
  assert.equal((await f.call(1, 'POST', { mode: 'explain' }, '?project=1', 3)).status, 403);
  assert.equal((await f.call(1, 'POST', { mode: 'explain' }, '?project=2')).status, 403);
  assert.equal((await f.call(1, 'POST', { mode: 'explain' }, '?project=no')).status, 400);
  assert.equal(f.model(), null); assert.equal(f.state(), before);
  f.db.exec("UPDATE projects SET deleted_at=datetime('now') WHERE id=1");
  assert.equal((await f.call(1)).status, 403); assert.equal(f.model(), null);
});
test('forged, changed, expired or differently scoped receipts and browser-supplied scores are refused without writes', async () => {
  const f = await fixture(); const preview = await f.call(1); const before = f.state();
  const forged = structuredClone(preview.body.receipt); const p = JSON.parse(forged.payload); p.items[0].text = 'Different wording'; forged.payload = JSON.stringify(p);
  assert.equal((await f.call(1, 'POST', { receipt: forged }, '/keep?project=1')).status, 400);
  assert.equal((await f.call(1, 'POST', { mode: 'explain', score: 100 })).status, 400);
  assert.equal((await f.call(1, 'POST', { receipt: preview.body.receipt }, '/keep?project=2')).status, 403);
  f.db.exec('UPDATE users SET founder_id=11 WHERE id=2');
  assert.equal((await f.call(2, 'POST', { receipt: preview.body.receipt }, '/keep?project=1')).status, 409);
  const wrongProject = JSON.parse(preview.body.receipt.payload); wrongProject.project = 2;
  const wrongPayload = JSON.stringify(wrongProject);
  assert.equal((await f.call(1, 'POST', { receipt: { payload: wrongPayload, signature: await signHmac(f.env, 'pmf-reading:v1:' + wrongPayload) } }, '/keep?project=1')).status, 409);
  const now = Date.now; Date.now = () => now() + 16 * 60 * 1000;
  try { assert.equal((await f.call(1, 'POST', { receipt: preview.body.receipt }, '/keep?project=1')).status, 409); } finally { Date.now = now; }
  assert.equal(f.state(), before);
  f.db.exec('UPDATE metric_targets SET target_value=20 WHERE project_id=1');
  await recomputePmf(f.env, 1, 1, 'rescore', '2026-10-25');
  const changed = f.state(); assert.equal((await f.call(1, 'POST', { receipt: preview.body.receipt }, '/keep?project=1')).status, 409); assert.equal(f.state(), changed);
});
test('an absent, unreadable or tampered snapshot never reaches the model and cannot become a zero', async () => {
  const f = await fixture(); f.db.exec('DELETE FROM venture_scorecards');
  assert.equal((await f.call(1)).status, 409); assert.equal(f.model(), null);
  await recomputePmf(f.env, 1, 1, 'module_read', '2026-10-25');
  const raw = f.db.prepare('SELECT inputs_json FROM venture_scorecards').get() as any;
  const altered = JSON.parse(raw.inputs_json); altered.result.inputs[0].words = 'Altered fixture fact';
  f.db.prepare('UPDATE venture_scorecards SET inputs_json=?').run(JSON.stringify(altered));
  assert.equal((await f.call(1)).status, 503); assert.equal(f.model(), null);
  f.db.exec("UPDATE venture_scorecards SET inputs_json='{}'");
  assert.equal((await f.call(1)).status, 503); assert.equal(f.model(), null);
});
test('manual mode and ungrounded model output are refused before a reading or score is saved', async () => {
  const f = await fixture(); const before = f.state(); f.refusal('assist_off');
  assert.equal((await f.call(1)).status, 403); assert.equal(f.state(), before);
  const g = await fixture(); g.output('{"items":[{"input":"invented","text":"Invented reading"}]}');
  const unchanged = g.state(); assert.equal((await g.call(1)).status, 503); assert.equal(g.state(), unchanged);
});
test('a displayed input hash must match the current signed snapshot before either model run', async () => {
  const f = await fixture(); const before = f.state();
  for (const mode of ['explain', 'questions']) {
    const stale = await f.call(1, 'POST', { mode, inputs_hash: 'a'.repeat(64) });
    assert.equal(stale.status, 409); assert.equal(stale.body.code, 'pmf_inputs_changed');
  }
  assert.equal((await f.call(1, 'POST', { mode: 'explain', inputs_hash: 'invalid' })).status, 400);
  assert.equal(f.model(), null); assert.equal(f.state(), before);
});
test('the parser refuses absent, duplicated and numeric claims; zero evidence remains a recorded citation', () => {
  const rows = [{ key: 'waitlist', label: 'Waitlist', state: 'recorded', grade_factor: 0.7, words: '0 signups', grade: 'sourced', stale: true, module: 'demand-signals' }] as PmfInputResult[];
  const valid = JSON.stringify({ items: [{ input: 'waitlist', text: 'The recorded evidence is limited.' }] });
  assert.equal(parseExplanation(valid, rows)![0].citation.words, '0 signups');
  assert.equal(parseExplanation(valid, rows)![0].citation.stale, true);
  assert.equal(parseExplanation(JSON.stringify({ ...JSON.parse(valid), score: 100 }), rows), null);
  assert.equal(parseExplanation(valid.replace('limited.', 'advice.'), rows), null);
  assert.equal(parseExplanation(valid.replace('The recorded evidence is limited.', 'a'.repeat(651)), rows), null);
  for (const raw of ['{}', 'not JSON', '{"items":[]}', '{"score":10,"items":[]}', valid.replace('waitlist', 'product_pull'), valid.replace('limited.', 'rated 99.'), valid.replace('limited.', 'rated ninety percent.'), valid.replace('limited.', 'from eleven buyers.')]) assert.equal(parseExplanation(raw, rows), null);
  assert.equal(parseExplanation(JSON.stringify({ items: [{ input: 'waitlist', text: 'Limited.' }, { input: 'waitlist', text: 'Limited.' }] }), rows), null);
  assert.equal(parseExplanation(JSON.stringify({ items: [{ input: 'waitlist', text: 'Limited.' }, { input: 'waitlist', text: 'Limited.' }] }), [rows[0], { ...rows[0], key: 'would_pay' }]), null);
  assert.equal(explanationInputs([{ ...rows[0], state: 'not_expected' }], 'questions').length, 0);
  assert.doesNotMatch(explanationPrompt(rows, 'explain'), /"value"|"contribution"/);
});
test('a snapshot change inside Keep is refused atomically, and a failed batch leaves no reading or audit', async () => {
  const f = await fixture(); const preview = await f.call(1); const batch = f.env.DB.batch;
  let first = true;
  f.env.DB.batch = async (statements: any[]) => {
    if (first) {
      first = false; f.db.exec('UPDATE metric_targets SET target_value=20 WHERE project_id=1');
      await recomputePmf(f.env, 1, 1, 'rescore', '2026-10-25');
    }
    return batch(statements);
  };
  assert.equal((await f.call(1, 'POST', { receipt: preview.body.receipt }, '/keep?project=1')).status, 409);
  assert.equal((f.db.prepare('SELECT COUNT(*) n FROM research_zone_drafts').get() as any).n, 0);
  assert.equal((f.db.prepare("SELECT COUNT(*) n FROM activity_logs WHERE action='pmf_reading_kept'").get() as any).n, 0);
  const g = await fixture(); const proposed = await g.call(1); const before = g.state(); const realBatch = g.env.DB.batch;
  g.env.DB.batch = async (statements: any[]) => realBatch([...statements, g.env.DB.prepare('INSERT INTO missing_fixture_table VALUES (?)').bind(1)]);
  assert.equal((await g.call(1, 'POST', { receipt: proposed.body.receipt }, '/keep?project=1')).status, 503);
  assert.equal(g.state(), before);
});
test('altered kept text is Unreadable, while old captured readings survive later score changes', async () => {
  const f = await fixture(); const proposal = await f.call(1);
  const kept = await f.call(1, 'POST', { receipt: proposal.body.receipt }, '/keep?project=1');
  f.db.exec('UPDATE metric_targets SET target_value=20 WHERE project_id=1');
  await recomputePmf(f.env, 1, 1, 'rescore', '2026-10-25');
  assert.deepEqual((await f.call(1, 'GET')).body.reading, kept.body.reading);
  const row = f.db.prepare('SELECT body FROM research_zone_drafts').get() as any;
  const altered = JSON.parse(row.body); altered.reading.items[0].text = 'Altered fixture wording.';
  f.db.prepare('UPDATE research_zone_drafts SET body=?').run(JSON.stringify(altered));
  assert.equal((await f.call(1, 'GET')).status, 503);
  f.db.exec("UPDATE research_zone_drafts SET body='{}'");
  const changed = await f.call(1, 'GET'); assert.equal(changed.status, 503); assert.match(changed.body.detail, /Unreadable/);
});
test('score_rating refuses rating/score fields in both copies and provenance refuses before touching DB', async () => {
  const spa = await import('../../frontend/src/lib/neverFill.js');
  for (const field of ['score','readiness_scores.score','venture_scorecards.value','reviewRating','pmf_score']) {
    assert.equal(neverFillReason(field)?.category, 'score_rating'); assert.equal(spa.neverFillReason(field)?.category, 'score_rating');
    let touched = false;
    const at = field.lastIndexOf('.');
    await assert.rejects(recordFill({ DB: { prepare() { touched = true; throw new Error('No write expected'); } } } as any,
      { target: { table: at < 0 ? 'synthetic' : field.slice(0, at), rowId: 1, column: at < 0 ? field : field.slice(at + 1) }, fillClass: 'composition', proposedValue: 'Synthetic', writtenValue: 'Synthetic' } as any), /Eadwyn never fills this field \(scores and ratings\)/);
    assert.equal(touched, false);
  }
});
