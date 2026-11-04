/** Selected, consented, quoted post-call output proposals (D4412, #4412). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { applyEngineSchema } from './_engine_schema.mjs';
import { applySessionTranslationColumns } from './_session_translation_columns.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { createJWT } from '../src/auth.ts';
import sessionsApp from '../src/routes/founder_validate_sessions.ts';
import structure from '../src/routes/founder_validate_structure.ts';
import { parseOutputs, DEFAULT_OUTPUTS, enqueueOutputs, runOutputJob, outputPreferences } from '../src/services/callOutputs.ts';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ME = 2, OTHER = 3, LAB = 4, FOUNDER = 9, LAB_FOUNDER = 19, PROJECT = 7, LAB_PROJECT = 8;
function world(reply: (model: string, input: any) => any = () => ({ response: '{"placements":[]}' })) {
  const { DB, db } = aiBudgetFixture();
  db.exec(`
    ALTER TABLE users ADD COLUMN founder_id INTEGER;
    ALTER TABLE users ADD COLUMN spinout_lab_active INTEGER DEFAULT 0;
    UPDATE users SET founder_id = ${FOUNDER} WHERE id = ${ME};
    UPDATE users SET role = 'advisor', founder_id = ${LAB_FOUNDER}, spinout_lab_active = 1 WHERE id = ${LAB};
    CREATE TABLE user_sessions (jti TEXT, user_id INTEGER, revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT);
    INSERT INTO user_sessions (jti, user_id) VALUES ('jti-${ME}', ${ME}), ('jti-${OTHER}', ${OTHER}), ('jti-${LAB}', ${LAB});
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER);
    INSERT INTO projects VALUES (${PROJECT}, 'Ledger tool', ${FOUNDER}, NULL), (${LAB_PROJECT}, 'Lab venture', ${LAB_FOUNDER}, NULL);
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, interviewee_name TEXT NOT NULL, interviewee_role TEXT,
      interview_date TEXT, notes TEXT, hypotheses_json TEXT, pains_json TEXT, icp_fit TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES
      (101, ${PROJECT}, 'A'), (102, ${PROJECT}, 'B'), (201, ${LAB_PROJECT}, 'Lab interviewee');
    ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
    ALTER TABLE activity_logs ADD COLUMN entity_type TEXT;
    ALTER TABLE activity_logs ADD COLUMN entity_id TEXT;
  `);
  // The tables #1472's writers reach that this fixture does not hand-build,
  // from the baseline as D659's own test takes them, then 440 over them.
  for (const t of ['waitlist_signups', 'metric_targets', 'competitor_analyses', 'competitor_candidates',
    'competitor_sources', 'competitor_signals']) db.exec(tableFromBaseline(BASELINE, t));
  for (const m of ['106_pain_groups.sql', '211_founder_validate_evidence.sql', '214_validate_proposals.sql',
    '246_fills_the_blanks_everywhere.sql', '438_interview_sessions.sql', '439_validate_proposals_structuring.sql',
    '440_validate_cycle_stores.sql', '446_interview_structure_receipts.sql',
    // D685: the summary's receipts sit in the same receipt read (453).
    '453_interview_processing.sql']) {
    db.exec(mig(m));
  }
  applySessionTranslationColumns(db); // D857: migration 527's segment columns
  // D757: the Validate engine's schema (487, 465, 453 and the re-scope's columns).
  applyEngineSchema(db);
  db.exec(`
    INSERT INTO hypotheses (id, project_id, code, claim) VALUES (31, ${PROJECT}, 'H1', 'Finance leads reconcile by hand');
    INSERT INTO pain_groups (id, project_id, title) VALUES (41, ${PROJECT}, 'Manual reconciliation'), (42, ${PROJECT}, 'Cost');
  `);
  const calls: string[] = [];
  const env: any = {
    JWT_SECRET,
    ENVIRONMENT: 'development',
    DB,
    AI: {
      run: async (model: string, input: any) => {
        if (/guard/.test(model)) return { response: 'safe' };
        calls.push(model);
        return reply(model, input);
      },
    },
  };
  return { env, db, calls };
}

async function call(env: any, app: any, method: string, path: string, body?: unknown, id = ME) {
  const role = id === LAB ? 'advisor' : 'founder';
  const token = await createJWT(env, id, `u${id}@example.test`, role, undefined, `jti-${id}`);
  const res = await app.request(path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env);
  return { status: res.status, json: await res.json().catch(() => null) as any };
}


function setup(reply?: (model: string, input: any) => any) {
 const w = world(reply);
 w.db.exec(mig('202611041353_call_outputs.sql'));
 w.db.exec(mig('489_interview_findings.sql'));
 w.db.exec(`CREATE TABLE interview_session_points (id INTEGER PRIMARY KEY, session_id INTEGER, hypothesis_id INTEGER, text TEXT, sort_order INTEGER, covered_at TEXT, covered_offset_ms INTEGER);`);
 for (const column of ['quote_consent INTEGER','transcript TEXT','transcribed_at TEXT','transcribed_by_model TEXT']) {
  if (!w.db.prepare('PRAGMA table_info(discovery_interviews)').all().some((r: any) => r.name === column.split(' ')[0])) w.db.exec(`ALTER TABLE discovery_interviews ADD COLUMN ${column}`);
 }
 for (const [table, columns] of [['interview_sessions',['submitted_via TEXT','call_provider TEXT','meeting_url TEXT','client_key TEXT']], ['discovery_interviews',['stage TEXT','channel TEXT']]]) {
  for (const col of columns) if (!w.db.prepare(`PRAGMA table_info(${table})`).all().some((r: any) => r.name === col.split(' ')[0])) w.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`);
 }
 setFixtureAllowance(w.db, 10000000);
 w.db.exec(`INSERT INTO interview_sessions (id, uid, interview_id, project_id, created_by_user_id, channel, status, consent_status, outputs)
 VALUES (5, 'session-output', 101, 7, 2, 'in_person', 'transcribed', 'given', '["pain-points","market-intelligence"]');
 INSERT INTO interview_transcript_segments (session_id, source, start_ms, end_ms, text) VALUES
 (5, 'final', 0, 4000, 'Manual work hurts. Ledgerly is too expensive.');`);
 return w;
}
const candidate = (kind: string, payload: any) => ({ kind, payload, cite: { from: 0, to: 4000 }, quote: 'Manual work hurts. Ledgerly is too expensive.' });
const job = (output: string, user_id = 2) => ({ session_id: 5, user_id, output });
const rows = (db: any, table: string) => db.prepare(`SELECT * FROM ${table}`).all();

test('selection rejects unknowns and preserves explicit none; project preferences are member scoped', async () => {
 const { env, db } = setup();
 assert.deepEqual(parseOutputs([]), []);
 assert.equal(parseOutputs(['unregistered']), null);
 assert.deepEqual(parseOutputs(['icp-fit','icp-fit']), ['icp-fit']);
 assert.deepEqual(await outputPreferences(env, 2, 7), DEFAULT_OUTPUTS);
 db.prepare('INSERT INTO interview_output_preferences VALUES (?, ?, ?)').run(2, 7, '[]');
 assert.deepEqual(await outputPreferences(env, 2, 7), []);
 assert.deepEqual(await outputPreferences(env, 9, 7), DEFAULT_OUTPUTS);
});

test('Pain points and Market intelligence create pending proposals only, and independently; repeat delivery is free', async () => {
 const { env, db, calls } = setup((_m, i) => ({ response: JSON.stringify({ placements: [
  candidate('pain_severity', { phrase: 'Manual work', severity: 'severe' }),
  candidate('competitor_mention', { name: 'Ledgerly' }), candidate('icp_fit', { fit: 'strong', reason: 'Wrong output' }),
 ] }) }));
 await enqueueOutputs(env, 5);
 assert.deepEqual(rows(db, 'interview_output_jobs').map((r: any) => r.output).sort(), ['market-intelligence','pain-points']);
 await runOutputJob(env, job('pain-points'));
 assert.deepEqual(rows(db, 'validate_proposals').map((r: any) => [r.kind,r.status]), [['pain_severity','pending']]);
 assert.equal(db.prepare('SELECT pains_json FROM discovery_interviews WHERE id=101').get().pains_json, null);
 await runOutputJob(env, job('market-intelligence'));
 assert.deepEqual(rows(db, 'validate_proposals').map((r: any) => r.kind), ['pain_severity','competitor_mention']);
 assert.equal(rows(db, 'interview_output_jobs').every((r: any) => r.quote_microusd > 0 && r.status === 'done'), true);
 const paid = calls.length;
 db.exec("INSERT INTO interview_output_jobs(session_id, output, run_id) VALUES(5,'icp-fit','output:stale-unselected')");
 await runOutputJob(env, job('pain-points')); await runOutputJob(env, job('icp-fit')); await runOutputJob(env, job('market-intelligence', 3));
 assert.equal(calls.length, paid);
 const review = await call(env, structure, 'GET', '/sessions/5/placements');
 assert.equal(review.json.outputs.length, 2);
 assert.equal(review.json.runs.length, 2);
 const pain = rows(db, 'validate_proposals')[0];
 assert.equal((await call(env, structure, 'POST', `/placements/${pain.id}/accept`)).status, 200);
 assert.match(db.prepare('SELECT pains_json FROM discovery_interviews WHERE id=101').get().pains_json, /Manual work/);
});

test('live or unconsented sessions run nothing; withdrawal while model runs cannot store late proposals', async () => {
 const w = setup(() => { w.db.exec("UPDATE interview_sessions SET consent_status='declined' WHERE id=5"); return { response: JSON.stringify({ placements: [candidate('pain_severity', { phrase: 'Manual', severity: 'real' })] }) }; });
 w.db.exec("UPDATE interview_sessions SET status='recording' WHERE id=5"); await enqueueOutputs(w.env, 5);
 assert.equal(rows(w.db, 'interview_output_jobs').length, 0);
 w.db.exec("UPDATE interview_sessions SET status='transcribed', consent_status='not_recorded' WHERE id=5"); await enqueueOutputs(w.env, 5);
 assert.equal(rows(w.db, 'interview_output_jobs').length, 0);
 w.db.exec("UPDATE interview_sessions SET consent_status='given' WHERE id=5"); await enqueueOutputs(w.env, 5); await runOutputJob(w.env, job('pain-points'));
 assert.equal(rows(w.db, 'validate_proposals').length, 0);
 assert.equal(rows(w.db, 'interview_output_jobs')[0].status, 'failed');
});

test('empty is distinct from malformed/failed extraction; retry only runs the failed output', async () => {
 let malformed = false;
 const w = setup(() => ({ response: malformed ? 'not json' : '{"placements":[]}' }));
 await enqueueOutputs(w.env, 5); await runOutputJob(w.env, job('pain-points'));
 assert.equal(rows(w.db, 'interview_output_jobs')[0].status, 'empty');
 malformed = true; await runOutputJob(w.env, job('market-intelligence'));
 assert.equal(rows(w.db, 'interview_output_jobs')[1].status, 'failed');
 const retry = await call(w.env, sessionsApp, 'POST', '/sessions/5/outputs/market-intelligence/retry');
 assert.equal(retry.status, 200);
 assert.equal(rows(w.db, 'interview_output_jobs')[1].status, 'queued');
 malformed = false; await runOutputJob(w.env, job('market-intelligence'));
 assert.equal(rows(w.db, 'interview_output_jobs')[1].status, 'empty');
});

test('a changed source is discarded and quotable lines require separate Quotes OK', async () => {
 let change = true;
 const w = setup(() => {
  if (change) w.db.exec("UPDATE interview_transcript_segments SET text='Changed' WHERE session_id=5");
  return { response: JSON.stringify({ placements: [candidate('quotable_line', { text: 'Manual work hurts. Ledgerly is too expensive.' })] }) };
 });
 w.db.exec(`UPDATE interview_sessions SET outputs='["feature-requests-quotes"]' WHERE id=5`);
 await enqueueOutputs(w.env, 5); await runOutputJob(w.env, job('feature-requests-quotes'));
 assert.equal(rows(w.db, 'validate_proposals').length, 0);
 change = false;
 w.db.exec("UPDATE interview_transcript_segments SET text='Manual work hurts. Ledgerly is too expensive.' WHERE session_id=5; UPDATE interview_output_jobs SET status='queued'");
 await runOutputJob(w.env, job('feature-requests-quotes'));
 assert.equal(rows(w.db, 'validate_proposals').length, 0);
 w.db.exec("UPDATE discovery_interviews SET quote_consent=1 WHERE id=101; UPDATE interview_output_jobs SET status='queued'");
 await runOutputJob(w.env, job('feature-requests-quotes'));
 assert.equal(rows(w.db, 'validate_proposals').length, 1);
 w.db.exec("UPDATE discovery_interviews SET quote_consent=0 WHERE id=101");
 assert.equal((await call(w.env, structure, 'POST', `/placements/${rows(w.db,'validate_proposals')[0].id}/accept`)).status, 409);
});

test('setup persists selected outputs and quotes a member-scoped estimate', async () => {
 const w = setup();
 const quote = await call(w.env, sessionsApp, 'GET', '/sessions/outputs?project_id=7&minutes=30&outputs=%5B%22pain-points%22%5D');
 assert.equal(quote.status, 200);
 assert.ok(quote.json.quote.microusd > 0);
 assert.equal((await call(w.env, sessionsApp, 'GET', '/sessions/outputs?project_id=7', undefined, 3)).status, 404);
 const opened = await call(w.env, sessionsApp, 'POST', '/interviews/101/sessions', { channel:'in_person', consent:{status:'given',method:'verbal'}, outputs:['pain-points','market-intelligence'] });
 assert.equal(opened.status, 201);
 assert.deepEqual(JSON.parse(opened.json.session.outputs), ['pain-points','market-intelligence']);
 assert.deepEqual(await outputPreferences(w.env, 2, 7), ['pain-points','market-intelligence']);
});
