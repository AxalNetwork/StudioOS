/**
 * D757 §2.6, §2.13 and §2.16-B (#1923, part 1) — the findings every Validate
 * module was missing: `interview_findings` (migration 489), the new and
 * widened kinds, their writers through the one accept route, the privacy
 * statements, and the MCP tool. Fixture people are synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/interview_findings_d757.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { applyEngineSchema } from './_engine_schema.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { PASS_MAX_TOKENS, PLACEMENT_KINDS, STRUCTURE_PASSES, parsePlacements, placementSlug, structureTranscript, type Segment } from '../src/services/interviewStructuring.ts';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { FINDING_KINDS } from '../src/services/interviewFindings.ts';
import structure, { storePlacements } from '../src/routes/founder_validate_structure.ts';
import { writeInterviewFinding } from '../src/services/validateWriters.ts';
import { deleteInterview } from '../src/services/interviewWriters.ts';
import { deleteSession } from '../src/services/interviewSessions.ts';
import { withdrawDigest } from '../src/services/validateEngine.ts';
import { TOOLS } from '../src/services/assistantInterviews.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ME = 2, FOUNDER = 1009, PROJECT = 7, IV = 101, SESSION = 5;

const SEGMENTS: Segment[] = [
  { start: 0, end: 4000, speaker: 'Me', text: 'How do you reconcile invoices today?' },
  { start: 4000, end: 12000, speaker: '[Interviewee]', text: 'By hand, every Friday. It takes my whole afternoon and I hate it.' },
  { start: 12000, end: 20000, speaker: '[Interviewee]', text: 'We looked at Ledgerly but it was too expensive.' },
  { start: 20000, end: 26000, speaker: '[Interviewee]', text: 'If it worked I would pay for it tomorrow.' },
];
const Q = {
  hand: { cite: { from: 4000, to: 12000 }, quote: 'By hand, every Friday. It takes my whole afternoon and I hate it.' },
  ledgerly: { cite: { from: 12000, to: 20000 }, quote: 'We looked at Ledgerly but it was too expensive.' },
  pay: { cite: { from: 20000, to: 26000 }, quote: 'If it worked I would pay for it tomorrow.' },
};
const CTX = { hypotheses: [{ id: 31, code: 'H1', claim: 'Finance leads reconcile by hand' }], painGroups: [{ id: 41, title: 'Manual reconciliation' }] };

// The tables the writers reach, from the baseline, then the migrations over
// them in the order validate_writes_d690's own fixture applies them.
const TABLES = [
  'users', 'projects', 'activity_logs', 'discovery_interviews', 'interview_pain_severities', 'pain_groups',
  'pain_group_aliases', 'hypotheses', 'hypothesis_pain_links', 'waitlist_signups', 'metric_targets',
  'competitor_analyses', 'competitor_candidates', 'competitor_sources', 'competitor_signals',
  'competitor_analysis_outputs', 'mvp_features', 'roadmap_okrs',
];

function world({ findings = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) db.exec(tableFromBaseline(BASELINE, t));
  db.exec('CREATE UNIQUE INDEX idx_hypotheses_project_code ON hypotheses (project_id, code)');
  db.exec('CREATE UNIQUE INDEX idx_hypothesis_pain_links_unique ON hypothesis_pain_links (hypothesis_id, pain_group_id, direction)');
  db.exec('ALTER TABLE projects ADD COLUMN icp_definition_meta TEXT');
  db.exec(mig('255_hypothesis_verdict_history.sql'));
  db.exec(mig('311_revenue_entries.sql').replace(/REFERENCES documents\(id\)/, ''));
  db.exec(mig('440_validate_cycle_stores.sql'));
  db.exec('ALTER TABLE mvp_features ADD COLUMN pain_group_id INTEGER REFERENCES pain_groups(id)');
  db.exec(mig('459_cycle_activity_convention.sql'));
  db.exec(mig('460_validate_record_stores.sql'));
  for (const m of ['214_validate_proposals.sql', '246_fills_the_blanks_everywhere.sql', '438_interview_sessions.sql', '439_validate_proposals_structuring.sql', '446_interview_structure_receipts.sql',
    '447_assistant_interviews.sql', '452_record_session_setup.sql', '453_interview_processing.sql']) db.exec(mig(m));
  db.exec(mig('449_interview_channels.sql').split(';')
    .filter((sql) => /CREATE TABLE IF NOT EXISTS channel_threads \(/.test(sql)).map((sql) => `${sql};`).join('\n'));
  db.exec(mig('488_channel_consents.sql'));
  applyEngineSchema(db);
  if (findings) db.exec(mig('489_interview_findings.sql'));
  db.prepare("INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, 'founder', 'Fay Founder', 'fay@example.test', 1, ?, 0)").run(ME, FOUNDER);
  db.exec(`
    INSERT INTO projects (id, name, founder_id) VALUES (${PROJECT}, 'Ledger tool', ${FOUNDER});
    INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (${IV}, ${PROJECT}, 'Interviewee A');
    INSERT INTO hypotheses (id, project_id, code, claim) VALUES (31, ${PROJECT}, 'H1', 'Finance leads reconcile by hand');
    INSERT INTO pain_groups (id, project_id, title) VALUES (41, ${PROJECT}, 'Manual reconciliation');
    INSERT INTO interview_sessions (id, uid, interview_id, project_id, created_by_user_id, channel, status, consent_status)
      VALUES (${SESSION}, 'sess-5', ${IV}, ${PROJECT}, ${ME}, 'video', 'transcribed', 'given');
  `);
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  return { env, db };
}

async function call(env: any, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: ME, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await structure.request(path, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env);
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

/** Store placements as one structuring run, and return their proposal ids in order. */
async function propose(env: any, db: any, placements: any[]) {
  const parsed = parsePlacements(JSON.stringify({ placements }), SEGMENTS, CTX);
  assert.equal(parsed.dropped, 0, `a fixture placement was dropped: ${JSON.stringify(placements)}`);
  await storePlacements(env, { projectId: PROJECT, sessionId: SESSION, interviewId: IV, runId: crypto.randomUUID(), userId: ME, model: 'm', placements: parsed.placements });
  return db.prepare('SELECT id FROM validate_proposals ORDER BY id DESC LIMIT ?').all(placements.length).map((r: any) => Number(r.id)).reverse();
}
const accept = (env: any, id: number, body?: unknown) => call(env, 'POST', `/placements/${id}/accept`, body);
const status = (db: any, id: number) => db.prepare('SELECT status FROM validate_proposals WHERE id = ?').get(id).status;
const findings = (db: any) => db.prepare('SELECT module, kind, key_norm, payload_json, quote, cite_from, cite_to, session_id, proposal_id FROM interview_findings ORDER BY id').all()
  .map((r: any) => ({ ...r, payload: JSON.parse(r.payload_json) }));

// ── 1. migration 489 ────────────────────────────────────────────────────────

test('migration 489 applies on the Validate world; a duplicate (interview, kind, key) upserts one row', async () => {
  const { env, db } = world();
  const cols = db.prepare('PRAGMA table_info(interview_findings)').all().map((c: any) => c.name);
  for (const c of ['uid', 'project_id', 'interview_id', 'session_id', 'proposal_id', 'module', 'kind', 'key_norm', 'payload_json', 'quote', 'cite_from', 'cite_to', 'created_by', 'created_at']) {
    assert.ok(cols.includes(c), c);
  }
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_interview_findings_module'").get());
  assert.doesNotMatch(mig('489_interview_findings.sql'), /\b(BEGIN|COMMIT|ROLLBACK)\b/, 'no transaction statements');
  assert.throws(() => db.prepare(`INSERT INTO interview_findings (uid, project_id, interview_id, module, kind, key_norm, payload_json)
    VALUES ('x', ${PROJECT}, ${IV}, 'verdict', 'timing', 'timing', '{}')`).run(), /CHECK/, 'module keeps its CHECK');
  const first = await writeInterviewFinding(env, { projectId: PROJECT, userId: ME, interviewId: IV, kind: 'timing', payload: { when: 'next quarter' } });
  const again = await writeInterviewFinding(env, { projectId: PROJECT, userId: ME, interviewId: IV, kind: 'timing', payload: { when: 'this month' }, quote: 'soon', citeFrom: 1, citeTo: 2 });
  assert.equal(first.id, again.id, 'the same (interview, kind, key) is one row');
  assert.deepEqual([first.created, again.created], [true, false]);
  const rows = findings(db);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].module, rows[0].payload.when, rows[0].quote], ['demand-signals', 'this month', 'soon']);
  const log = db.prepare("SELECT action, details FROM activity_logs WHERE action = 'interview_finding_written' ORDER BY id").all();
  assert.equal(log.length, 2);
  assert.doesNotMatch(log.map((l: any) => l.details).join(' '), /next quarter|this month|soon/, 'the log row names the kind, never the words');
  await assert.rejects(writeInterviewFinding(env, { projectId: PROJECT, userId: ME, interviewId: IV, kind: 'verdict', payload: {} }), /kind must be one of/);
  await assert.rejects(writeInterviewFinding(env, { projectId: PROJECT, userId: ME, interviewId: IV, kind: 'urgency', payload: { level: 'extreme' } }), /not a valid value/);
  await assert.rejects(writeInterviewFinding(env, { projectId: 999, userId: ME, interviewId: IV, kind: 'timing', payload: { when: 'now' } }), /Interview not found/);
});

// ── 2. one accept per new kind ──────────────────────────────────────────────

const NEW_KINDS: [string, Record<string, unknown>, keyof typeof Q, string][] = [
  ['firmographic', { attribute: 'industry', value: 'Accounting' }, 'hand', 'ideal-customer-profile'],
  ['job_to_be_done', { job: 'Close the books by Friday' }, 'hand', 'ideal-customer-profile'],
  ['alternative', { name: 'Spreadsheets', kind: 'workaround' }, 'hand', 'market-intelligence'],
  ['market_fact', { fact: 'Ledgerly is priced for enterprises', topic: 'pricing' }, 'ledgerly', 'market-intelligence'],
  ['budget', { detail: 'About a hundred a month', amount_cents: 10000, currency: 'usd', period: 'month' }, 'pay', 'demand-signals'],
  ['timing', { when: 'tomorrow' }, 'pay', 'demand-signals'],
  ['urgency', { level: 'high', reason: 'Every Friday' }, 'hand', 'demand-signals'],
  ['buying_trigger', { trigger: 'Month-end close' }, 'hand', 'demand-signals'],
  ['objection', { about: 'price', detail: 'Ledgerly was too expensive' }, 'ledgerly', 'demand-signals'],
];

test('every new finding kind accepts through the one route into interview_findings, with its quote and module', async () => {
  const { env, db } = world();
  const ids = await propose(env, db, NEW_KINDS.map(([kind, payload, q]) => ({ kind, payload, ...Q[q] })));
  for (const id of ids) {
    const r = await accept(env, id);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(status(db, id), 'accepted');
  }
  const rows = findings(db);
  assert.deepEqual(rows.map((r: any) => [r.kind, r.module]), NEW_KINDS.map(([k, , , m]) => [k, m]));
  for (const [i, [, , q]] of NEW_KINDS.entries()) {
    assert.deepEqual([rows[i].quote, rows[i].cite_from, rows[i].cite_to, rows[i].session_id, rows[i].proposal_id], [Q[q].quote, Q[q].cite.from, Q[q].cite.to, SESSION, ids[i]]);
  }
  assert.deepEqual(rows[4].payload, { detail: 'About a hundred a month', amount_cents: 10000, currency: 'usd', period: 'month' });
  // Every kind names its cycle slug, the one #1925 reads.
  for (const [kind] of NEW_KINDS) assert.ok(typeof PLACEMENT_KINDS[kind as keyof typeof PLACEMENT_KINDS].slug === 'string', kind);
  assert.equal(placementSlug('firmographic', { attribute: 'role', value: 'x' }), 'customer-research');
  assert.equal(placementSlug('firmographic', { attribute: 'tools', value: 'x' }), 'ideal-customer-profile');
  assert.equal(placementSlug('icp_fit', { fit: 'strong' }), 'ideal-customer-profile');
});

test('a second accept is idempotent; a bad edit is refused and the suggestion stays pending', async () => {
  const { env, db } = world();
  const [id] = await propose(env, db, [{ kind: 'urgency', payload: { level: 'high' }, ...Q.hand }]);
  const bad = await accept(env, id, { payload: { level: 'extreme' } });
  assert.equal(bad.status, 422);
  assert.equal(status(db, id), 'pending');
  assert.equal(findings(db).length, 0);
  assert.equal((await accept(env, id)).status, 200);
  const twice = await accept(env, id);
  assert.equal(twice.status, 409);
  assert.equal(twice.json.error, 'not_pending');
  assert.equal(findings(db).length, 1, 'a second accept writes nothing');
  // The same finding proposed again and accepted lands on the same row.
  const [again] = await propose(env, db, [{ kind: 'urgency', payload: { level: 'medium' }, ...Q.pay }]);
  assert.equal((await accept(env, again)).status, 200);
  const rows = findings(db);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].payload.level, rows[0].quote], ['medium', Q.pay.quote]);
});

test('a writer refusal puts the suggestion back to pending: the store missing is a failed write, not a half accept', async () => {
  const { env, db } = world({ findings: false });
  const [id] = await propose(env, db, [{ kind: 'timing', payload: { when: 'tomorrow' }, ...Q.pay }]);
  const r = await accept(env, id);
  assert.equal(r.status, 500);
  assert.equal(r.json.error, 'apply_failed');
  assert.equal(status(db, id), 'pending');
});

test('hypothesis_new and experiment_idea accept through Experiments\' own writers', async () => {
  const { env, db } = world();
  const [h, e] = await propose(env, db, [
    { kind: 'hypothesis_new', payload: { claim: 'Finance leads would pay to skip Fridays', disproof: 'None of five would pay' }, ...Q.pay },
    { kind: 'experiment_idea', payload: { hypothesis_id: 31, title: 'Fake-door pricing page', method: 'Landing page' }, ...Q.pay },
  ]);
  assert.equal((await accept(env, h)).status, 200);
  const hyp = db.prepare("SELECT claim, disproof FROM hypotheses WHERE claim LIKE 'Finance leads would pay%'").get();
  assert.deepEqual({ ...hyp }, { claim: 'Finance leads would pay to skip Fridays', disproof: 'None of five would pay' });
  assert.equal((await accept(env, e)).status, 200);
  const ex = db.prepare('SELECT hypothesis_id, title, method FROM hypothesis_experiments').get();
  assert.deepEqual({ ...ex }, { hypothesis_id: 31, title: 'Fake-door pricing page', method: 'Landing page' });
  // An experiment on a hypothesis this project does not have is never proposed.
  const r = parsePlacements(JSON.stringify({ placements: [{ kind: 'experiment_idea', payload: { hypothesis_id: 99, title: 'x' }, ...Q.pay }] }), SEGMENTS, CTX);
  assert.equal(r.dropped, 1);
});

// ── 3. firmographic role ────────────────────────────────────────────────────

test('a firmographic role or company fills only an empty field on the interview', async () => {
  const { env, db } = world();
  const [role, company] = await propose(env, db, [
    { kind: 'firmographic', payload: { attribute: 'role', value: 'Finance lead' }, ...Q.hand },
    { kind: 'firmographic', payload: { attribute: 'company', value: 'Example Ltd' }, ...Q.hand },
  ]);
  assert.equal((await accept(env, role)).status, 200);
  assert.equal(db.prepare('SELECT interviewee_role FROM discovery_interviews WHERE id = ?').get(IV).interviewee_role, 'Finance lead');
  assert.equal(findings(db).length, 0, 'role and company are the interview record\'s own fields');
  db.prepare("UPDATE discovery_interviews SET interviewee_company = 'Typed by the founder' WHERE id = ?").run(IV);
  const r = await accept(env, company);
  assert.equal(r.status, 409);
  assert.match(r.json.detail, /already has a company/);
  assert.equal(status(db, company), 'pending');
  assert.equal(db.prepare('SELECT interviewee_company FROM discovery_interviews WHERE id = ?').get(IV).interviewee_company, 'Typed by the founder', 'never overwritten');
  assert.equal(db.prepare('SELECT interviewee_name FROM discovery_interviews WHERE id = ?').get(IV).interviewee_name, 'Interviewee A', 'the name is untouched');
  // A second role suggestion meets the role the first one filled: refused, never overwritten.
  const [second] = await propose(env, db, [{ kind: 'firmographic', payload: { attribute: 'role', value: 'Controller' }, ...Q.pay }]);
  const again = await accept(env, second);
  assert.equal(again.status, 409);
  assert.match(again.json.detail, /already has a role/);
  assert.equal(db.prepare('SELECT interviewee_role FROM discovery_interviews WHERE id = ?').get(IV).interviewee_role, 'Finance lead');
});

// ── 4. competitor_mention with a price and no list ─────────────────────────

test('a priced competitor with no list creates the manual list, with no crawl fetch', async (t) => {
  const { env, db } = world();
  const calls: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (u: any) => { calls.push(String(u)); return new Response('{}'); }) as any;
  t.after(() => { globalThis.fetch = orig; });
  const [id] = await propose(env, db, [{ kind: 'competitor_mention', payload: { name: 'Ledgerly', context: 'Too expensive', amount_cents: 4900, currency: 'usd', period: 'month' }, ...Q.ledgerly }]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM competitor_analyses').get().n, 0);
  const r = await accept(env, id);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM competitor_analyses WHERE project_id = ?').get(PROJECT).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM competitor_candidates WHERE name = 'Ledgerly'").get().n, 1);
  const sig = db.prepare('SELECT signal_type, amount_cents, currency, detail, source_kind FROM competitor_signals').get();
  assert.deepEqual({ ...sig }, { signal_type: 'pricing', amount_cents: 4900, currency: 'usd', detail: 'Too expensive · per month', source_kind: 'session' });
  assert.deepEqual(calls, [], 'no crawl, no discovery');
});

// ── 5. demand_signal ────────────────────────────────────────────────────────

test('demand_signal: an accepted would_pay is confirmed; an loi stays to_confirm; a need_to_have names no amount', async () => {
  const { env, db } = world();
  const [pay, loi] = await propose(env, db, [
    { kind: 'demand_signal', payload: { signal: 'would_pay', detail: 'Tomorrow', amount_cents: 5000, currency: 'usd', period: 'month' }, ...Q.pay },
    { kind: 'demand_signal', payload: { signal: 'loi', detail: 'Will sign a letter' }, ...Q.hand },
  ]);
  assert.equal((await accept(env, pay)).status, 200);
  assert.equal((await accept(env, loi)).status, 200);
  const rows = db.prepare('SELECT kind, status, amount_cents, period FROM demand_signals ORDER BY id').all().map((r: any) => ({ ...r }));
  assert.deepEqual(rows, [
    { kind: 'would_pay', status: 'confirmed', amount_cents: 5000, period: 'month' },
    { kind: 'loi', status: 'to_confirm', amount_cents: null, period: null },
  ]);
  const need = parsePlacements(JSON.stringify({ placements: [{ kind: 'demand_signal', payload: { signal: 'need_to_have', amount_cents: 100 }, ...Q.hand }] }), SEGMENTS, CTX);
  assert.deepEqual(need.placements[0].payload, { signal: 'need_to_have', detail: null }, 'the writer refuses an amount on a need-to-have, so it is not kept');
  const half = parsePlacements(JSON.stringify({ placements: [{ kind: 'demand_signal', payload: { signal: 'would_pay', amount_cents: 0 }, ...Q.pay }] }), SEGMENTS, CTX);
  assert.equal(half.dropped, 1, 'a half amount is refused, never stored');
});

// ── 6. evidence without a group ─────────────────────────────────────────────

test('evidence without a theme lands as interview evidence on the hypothesis', async () => {
  const { env, db } = world();
  const [id] = await propose(env, db, [{ kind: 'evidence', payload: { hypothesis_id: 31, direction: 'refutes', strength: 'pattern' }, ...Q.hand }]);
  assert.equal((await accept(env, id)).status, 200);
  const link = db.prepare('SELECT hypothesis_id, kind, ref_id, direction, strength FROM hypothesis_evidence_links').get();
  assert.deepEqual({ ...link }, { hypothesis_id: 31, kind: 'interview', ref_id: String(IV), direction: 'contradicts', strength: 'pattern' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM hypothesis_pain_links').get().n, 0, 'no theme link without a theme');
  const r = parsePlacements(JSON.stringify({ placements: [{ kind: 'evidence', payload: { hypothesis_id: 31, pain_group_id: 99, direction: 'supports', strength: 'anecdote' }, ...Q.hand }] }), SEGMENTS, CTX);
  assert.equal(r.dropped, 1, 'a theme it names must be this project\'s');
});

// ── 7. privacy ──────────────────────────────────────────────────────────────

async function withFindings(env: any, db: any) {
  const ids = await propose(env, db, [
    { kind: 'timing', payload: { when: 'tomorrow' }, ...Q.pay },
    { kind: 'evidence', payload: { hypothesis_id: 31, direction: 'supports', strength: 'anecdote' }, ...Q.hand },
  ]);
  for (const id of ids) assert.equal((await accept(env, id)).status, 200);
  assert.equal(findings(db)[0].quote, Q.pay.quote);
}

test('deleting the session clears its findings\' quotes and cites; the finding stays', async () => {
  const { env, db } = world();
  await withFindings(env, db);
  await deleteSession(env, db.prepare('SELECT * FROM interview_sessions WHERE id = ?').get(SESSION), ME);
  const rows = findings(db);
  assert.equal(rows.length, 1, 'an accepted finding is the founder\'s');
  assert.deepEqual([rows[0].quote, rows[0].cite_from, rows[0].cite_to], [null, null, null]);
});

test('deleting the interview deletes its findings and its interview evidence links', async () => {
  const { env, db } = world();
  await withFindings(env, db);
  db.prepare(`INSERT INTO hypothesis_evidence_links (uid, project_id, hypothesis_id, kind, ref_id, direction) VALUES ('other', ${PROJECT}, 31, 'signal', 'signal-1', 'supports')`).run();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM hypothesis_evidence_links WHERE kind = 'interview'").get().n, 1);
  await deleteInterview(env, { projectId: PROJECT, userId: ME, interviewId: IV });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM interview_findings').get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM hypothesis_evidence_links WHERE kind = 'interview'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM hypothesis_evidence_links WHERE kind = 'signal'").get().n, 1, 'another kind of evidence stays');
});

test('withdrawDigest clears the session\'s findings\' quotes', async () => {
  const { env, db } = world();
  await withFindings(env, db);
  await withdrawDigest(env, SESSION, ME);
  const rows = findings(db);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].quote, rows[0].cite_from, rows[0].cite_to], [null, null, null]);
});

test('a database without migration 489 still deletes a session and an interview', async () => {
  const { env, db } = world({ findings: false });
  await deleteSession(env, db.prepare('SELECT * FROM interview_sessions WHERE id = ?').get(SESSION), ME);
  await deleteInterview(env, { projectId: PROJECT, userId: ME, interviewId: IV });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM discovery_interviews').get().n, 0);
});

// ── 9. MCP ──────────────────────────────────────────────────────────────────

test('propose_placements takes every new kind with its module, and its description lists them', () => {
  const schema = (TOOLS.propose_placements as any).inputSchema.properties.placements.items.properties;
  for (const kind of [...Object.keys(FINDING_KINDS), 'hypothesis_new', 'experiment_idea']) {
    assert.ok(schema.kind.enum.includes(kind), kind);
    assert.ok(schema.module.enum.includes(PLACEMENT_KINDS[kind as keyof typeof PLACEMENT_KINDS].module), kind);
    assert.match(TOOLS.propose_placements.description, new RegExp(`\\b${kind}\\b`), kind);
  }
  // The module strings assistants already send are kept.
  assert.equal(PLACEMENT_KINDS.market_fact.module, 'market_intelligence');
  assert.equal(PLACEMENT_KINDS.pain_severity.module, 'problem_discovery');
  assert.match(TOOLS.propose_placements.description, /module_mismatch/);
});

// ── 8. two structure passes (PR 2) ──────────────────────────────────────────

/** A router world: the AI budget tables and a Workers AI stub that answers by pass. */
function routerWorld(answer: (pass: 'A' | 'B', input: any) => unknown) {
  const { DB } = aiBudgetFixture();
  const calls: { pass: 'A' | 'B'; max_tokens: number; system: string }[] = [];
  const env: any = {
    DB, ENVIRONMENT: 'development',
    AI: {
      run: async (model: string, input: any) => {
        if (/guard/.test(model)) return { response: 'safe' };
        const system = String(input.messages?.[0]?.content ?? '');
        const pass = /This pass reads for demand and evidence/.test(system) ? 'B' : 'A';
        calls.push({ pass, max_tokens: input.max_tokens, system });
        return answer(pass, input);
      },
    },
  };
  return { env, calls };
}
const A_REPLY = JSON.stringify({ placements: [
  { kind: 'pain_severity', payload: { phrase: 'Reconcile by hand', severity: 'severe' }, ...Q.hand },
  { kind: 'competitor_mention', payload: { name: 'Ledgerly' }, ...Q.ledgerly },
  // Pass B's kind, answered in pass A: skipped, not counted as dropped.
  { kind: 'timing', payload: { when: 'tomorrow' }, ...Q.pay },
] });
const B_REPLY = JSON.stringify({ placements: [
  { kind: 'demand_signal', payload: { signal: 'would_pay', detail: 'Tomorrow' }, ...Q.pay },
  { kind: 'urgency', payload: { level: 'high' }, ...Q.hand },
  // Pass A's kind, answered in pass B: skipped.
  { kind: 'pain_severity', payload: { phrase: 'Reconcile by hand', severity: 'severe' }, ...Q.hand },
] });

test('every kind is in exactly one pass, and each pass\'s prompt lists only its own', () => {
  const all = STRUCTURE_PASSES.flatMap((p) => [...p.kinds]);
  assert.deepEqual([...all].sort(), Object.keys(PLACEMENT_KINDS).sort(), 'a kind is in no pass, or in two');
  assert.equal(new Set(all).size, all.length);
});

test('a stubbed router sees two calls, each with the raised maxTokens and its own pass; the placements merge', async () => {
  const { env, calls } = routerWorld((pass) => ({ response: pass === 'A' ? A_REPLY : B_REPLY }));
  const out = await structureTranscript(env, { userId: ME, segments: SEGMENTS, context: CTX, step: 'structured' });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepEqual(calls.map((c) => c.pass), ['A', 'B']);
  assert.ok(PASS_MAX_TOKENS > 1500, 'raised from one pass\'s 1500');
  assert.deepEqual(calls.map((c) => c.max_tokens), [PASS_MAX_TOKENS, PASS_MAX_TOKENS]);
  assert.match(calls[0].system, /- pain_severity:/);
  assert.doesNotMatch(calls[0].system, /- demand_signal:/);
  assert.match(calls[1].system, /- demand_signal:/);
  assert.doesNotMatch(calls[1].system, /- pain_severity:/);
  assert.deepEqual(out.placements.map((p) => p.kind), ['pain_severity', 'competitor_mention', 'demand_signal', 'urgency']);
  assert.equal(out.dropped, 0, 'a kind answered in the other pass is not a placement without a passage');
  assert.equal(out.receipt.length, 2);
  assert.equal(out.passBRefusal, undefined);
});

test('pass B refused keeps pass A\'s placements whole and says why; pass A refused stores nothing', async () => {
  const b = routerWorld((pass) => { if (pass === 'B') throw new Error('capacity'); return { response: A_REPLY }; });
  const out = await structureTranscript(b.env, { userId: ME, segments: SEGMENTS, context: CTX, step: 'structured' });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepEqual(out.placements.map((p) => p.kind), ['pain_severity', 'competitor_mention']);
  assert.notEqual(out.passBRefusal, undefined, 'the refusal travels beside pass A');
  assert.ok(out.receipt.length >= 2);
  const a = routerWorld((pass) => { if (pass === 'A') throw new Error('capacity'); return { response: B_REPLY }; });
  const refused = await structureTranscript(a.env, { userId: ME, segments: SEGMENTS, context: CTX, step: 'structured' });
  assert.equal(refused.ok, false);
  assert.ok(a.calls.every((c) => c.pass === 'A'), 'pass B never runs after pass A is refused');
});
