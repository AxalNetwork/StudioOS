/**
 * D658 (#1471) — an interview turned into Validate placements, and decided.
 *
 * What the issue asks the tests to prove:
 *   · a placement without a citation is never stored;
 *   · an accepted placement and a hand-typed row produce identical module rows;
 *   · a discarded placement writes nothing;
 *   · the receipt names the fallback model when the first choice fails;
 *   · an answer with no citation is refused.
 * Plus: a long transcript is split and merged, never cut; segment, demand
 * signal and competitor accept through #1472's writers; a market fact stays
 * proposed; an edit is validated as strictly as the
 * model's own payload; a Lab venture's member accepts into the same rows the
 * Lab reads.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/interview_structuring_d658.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { createJWT } from '../src/auth.ts';
import {
  chunkSegments,
  parsePlacements,
  mergePlacements,
  structureTranscript,
  checkAnswer,
  alignRuns,
  segmentsInSpan,
  toSegments,
  type Segment,
} from '../src/services/interviewStructuring.ts';
import sessionsApp from '../src/routes/founder_validate_sessions.ts';
import cycleValidate from '../src/routes/cycle_validate.ts';
import { tableFromBaseline } from './_baseline.mjs';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
import structure, { storePlacements, loadStructureContext } from '../src/routes/founder_validate_structure.ts';
import founderValidate from '../src/routes/founder_validate.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ME = 2, OTHER = 3, LAB = 4, FOUNDER = 9, LAB_FOUNDER = 19;
const PROJECT = 7, LAB_PROJECT = 8;
const MID = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const SMALL = '@cf/meta/llama-3.1-8b-instruct-fp8';
const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');

const SEGMENTS: Segment[] = [
  { start: 0, end: 4000, speaker: 'Me', text: 'How do you reconcile invoices today?' },
  { start: 4000, end: 12000, speaker: '[Interviewee]', text: 'By hand, every Friday. It takes my whole afternoon and I hate it.' },
  { start: 12000, end: 20000, speaker: '[Interviewee]', text: 'We looked at Ledgerly but it was too expensive.' },
  { start: 20000, end: 26000, speaker: '[Interviewee]', text: 'If it worked I would pay for it tomorrow.' },
];

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
  `);
  // The tables #1472's writers reach that this fixture does not hand-build,
  // from the baseline as D659's own test takes them, then 440 over them.
  for (const t of ['waitlist_signups', 'metric_targets', 'competitor_analyses', 'competitor_candidates',
    'competitor_sources', 'competitor_signals']) db.exec(tableFromBaseline(BASELINE, t));
  for (const m of ['106_pain_groups.sql', '211_founder_validate_evidence.sql', '214_validate_proposals.sql',
    '246_fills_the_blanks_everywhere.sql', '438_interview_sessions.sql', '439_validate_proposals_structuring.sql',
    '440_validate_cycle_stores.sql', '446_interview_structure_receipts.sql']) {
    db.exec(mig(m));
  }
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

const CTX = { hypotheses: [{ id: 31, code: 'H1', claim: 'x' }], painGroups: [{ id: 41, title: 'Manual reconciliation' }, { id: 42, title: 'Cost' }] };

async function seed(env: any, placements: any[], interviewId = 101, projectId = PROJECT) {
  const parsed = parsePlacements(JSON.stringify({ placements }), SEGMENTS, CTX);
  await storePlacements(env, { projectId, sessionId: 5, interviewId, runId: 'run-a', userId: ME, model: MID, placements: parsed.placements });
  return parsed;
}

const rowsOf = (db: any, table: string, cols: string) => db.prepare(`SELECT ${cols} FROM ${table} ORDER BY id`).all();

// ── a placement without a citation is never stored ──────────────────────────

test('a placement with no cited span, or a span outside the transcript, is dropped and never stored', async () => {
  const { env, db } = world();
  const parsed = await seed(env, [
    { kind: 'pain_severity', payload: { phrase: 'reconcile by hand', severity: 'severe' }, cite: { from: 4000, to: 12000 } },
    { kind: 'pain_severity', payload: { phrase: 'no cite at all', severity: 'real' } },
    { kind: 'competitor_mention', payload: { name: 'Ledgerly' }, cite: { from: 90000, to: 95000 } },
    { kind: 'icp_fit', payload: { fit: 'strong', reason: 'Owns the close' }, cite: { from: 9000, to: 9000 } },
    { kind: 'segment', payload: { name: 'Finance leads' }, cite: { from: '0', to: '4000' } },
  ]);
  assert.equal(parsed.placements.length, 1);
  assert.equal(parsed.dropped, 4, 'an uncited placement was kept');
  const stored = rowsOf(db, 'validate_proposals', 'kind, cite_from, cite_to, citation_json, run_id, session_id');
  assert.equal(stored.length, 1, 'an uncited placement reached the table');
  assert.deepEqual([stored[0].kind, stored[0].cite_from, stored[0].cite_to, stored[0].run_id, stored[0].session_id], ['pain_severity', 4000, 12000, 'run-a', 5]);
  assert.equal(JSON.parse(stored[0].citation_json).quote, 'By hand, every Friday. It takes my whole afternoon and I hate it.');
});

test('a span is only a span: it must end after it starts and overlap a segment', () => {
  assert.equal(segmentsInSpan(SEGMENTS, 4000, 4000).length, 0);
  assert.equal(segmentsInSpan(SEGMENTS, 26000, 30000).length, 0, 'a span touching only the end is a citation');
  assert.equal(segmentsInSpan(SEGMENTS, 3999, 4001).length, 2);
});

test('a payload that does not fit its kind is dropped, and evidence can only name this project\'s rows', () => {
  const r = parsePlacements(JSON.stringify({ placements: [
    { kind: 'pain_severity', payload: { phrase: 'x', severity: 'critical' }, cite: { from: 4000, to: 12000 } },
    { kind: 'evidence', payload: { hypothesis_id: 99, pain_group_id: 41, direction: 'supports', strength: 'anecdote' }, cite: { from: 4000, to: 12000 } },
    { kind: 'evidence', payload: { hypothesis_id: 31, pain_group_id: 41, direction: 'supports', strength: 'Anecdote' }, cite: { from: 4000, to: 12000 } },
    { kind: 'demand_signal', payload: { signal: 'would pay' }, cite: { from: 20000, to: 26000 } },
    { kind: 'unknown_kind', payload: {}, cite: { from: 0, to: 4000 } },
  ] }), SEGMENTS, CTX);
  assert.deepEqual(r.placements.map((p) => [p.kind, p.payload]), [
    ['evidence', { hypothesis_id: 31, pain_group_id: 41, direction: 'supports', strength: 'anecdote' }],
    ['demand_signal', { signal: 'would_pay', detail: null }],
  ]);
  assert.equal(r.dropped, 3);
});

// ── never truncated, split and merged ───────────────────────────────────────

test('a long transcript is split on segment boundaries, every segment once, and the placements merged', async () => {
  const long: Segment[] = Array.from({ length: 30 }, (_, i) => ({ start: i * 1000, end: (i + 1) * 1000, speaker: 'X', text: `line ${i} `.repeat(40) }));
  const parts = chunkSegments(long, 3000);
  assert.ok(parts.length > 1);
  assert.deepEqual(parts.flat(), long, 'a segment was cut, lost or repeated');

  const seen: string[] = [];
  const { env } = world((_m, input) => {
    const content = input.messages.at(-1).content as string;
    seen.push(content.split('\n')[0]);
    const first = Number(/\[(\d+)-/.exec(content)![1]);
    return { response: JSON.stringify({ placements: [
      { kind: 'competitor_mention', payload: { name: 'Ledgerly' }, cite: { from: first, to: first + 1000 } },
      { kind: 'segment', payload: { name: `Part at ${first}` }, cite: { from: first, to: first + 1000 } },
    ] }) };
  });
  const out = await structureTranscript(env, { userId: ME, segments: long, context: CTX, step: 'structured', maxChars: 3000 });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.parts, parts.length, 'the founder is not told the transcript was read in parts');
  assert.equal(seen.length, parts.length);
  assert.match(seen[0], new RegExp(`^Part 1 of ${parts.length}`));
  assert.equal(out.placements.filter((p) => p.kind === 'competitor_mention').length, 1, 'one competitor named in every part was kept once per part');
  assert.equal(out.placements.filter((p) => p.kind === 'segment').length, parts.length);
});

// ── the receipt names the fallback ──────────────────────────────────────────

test('the receipt names the model that answered, and the fallback when the first choice failed', async () => {
  const { env, calls } = world((model) => {
    if (model === MID) throw new Error('capacity');
    return { response: JSON.stringify({ placements: [
      { kind: 'icp_fit', payload: { fit: 'strong', reason: 'Owns the close' }, cite: { from: 4000, to: 12000 } },
    ] }) };
  });
  const out = await structureTranscript(env, { userId: ME, segments: SEGMENTS, context: CTX, step: 'structured' });
  assert.equal(out.ok, true);
  assert.deepEqual(calls, [MID, SMALL]);
  assert.equal(out.receipt.length, 1);
  assert.equal(out.receipt[0].model, SMALL, 'the receipt names the model that was asked, not the one that answered');
  assert.equal(out.receipt[0].fallback_used, true, 'the receipt does not say the fallback answered');
  assert.equal(out.receipt[0].step, 'structured');
});

test('a refused run stores nothing and says why', async () => {
  const { env } = world(() => { throw new Error('down'); });
  const out = await structureTranscript(env, { userId: ME, segments: SEGMENTS, context: CTX, step: 're_structured' });
  assert.equal(out.ok, false);
  assert.equal(out.receipt[0].step, 're_structured');
});

// ── an accepted placement equals a hand-typed row ───────────────────────────

test('accepted pain severity, ICP fit and evidence write the same rows the manual routes write', async () => {
  const { env, db } = world();
  const parsed = await seed(env, [
    { kind: 'pain_severity', payload: { phrase: 'Reconcile by hand', severity: 'real' }, cite: { from: 4000, to: 12000 } },
    { kind: 'icp_fit', payload: { fit: 'partial', reason: 'Small team' }, cite: { from: 4000, to: 12000 } },
    { kind: 'evidence', payload: { hypothesis_id: 31, pain_group_id: 41, direction: 'supports', strength: 'pattern' }, cite: { from: 4000, to: 12000 } },
  ], 101);
  assert.equal(parsed.placements.length, 3);
  const ids = rowsOf(db, 'validate_proposals', 'id').map((r: any) => r.id);
  for (const id of ids) {
    const r = await call(env, structure, 'POST', `/placements/${id}/accept`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }

  // The same three facts typed by hand, on interview 102 and a second link.
  assert.equal((await call(env, founderValidate, 'PUT', '/interviews/102/pain-severity', { phrase: 'Reconcile by hand', severity: 'real' })).status, 200);
  assert.equal((await call(env, founderValidate, 'PATCH', '/interviews/102/evidence', { icp_fit: 'partial' })).status, 200);
  db.prepare('DELETE FROM hypothesis_pain_links').run();
  assert.equal((await call(env, founderValidate, 'POST', '/hypotheses/31/links', { direction: 'supports', pain_group_id: 41 })).status, 201);
  const manualLink = rowsOf(db, 'hypothesis_pain_links', 'hypothesis_id, pain_group_id, direction');
  db.prepare('DELETE FROM hypothesis_pain_links').run();
  db.prepare("UPDATE validate_proposals SET status = 'pending' WHERE kind = 'evidence'").run();
  assert.equal((await call(env, structure, 'POST', `/placements/${ids[2]}/accept`)).status, 200);

  const sev = rowsOf(db, 'interview_pain_severities', 'interview_id, phrase_norm, severity');
  assert.deepEqual(sev.map(({ interview_id, ...rest }: any) => rest)[0], sev.map(({ interview_id, ...rest }: any) => rest)[1],
    'an accepted severity is not the row the manual route writes');
  assert.deepEqual(sev.map((r: any) => r.interview_id).sort(), [101, 102]);
  const fit = db.prepare('SELECT id, icp_fit FROM discovery_interviews WHERE id IN (101, 102) ORDER BY id').all();
  assert.deepEqual(fit.map((r: any) => r.icp_fit), ['partial', 'partial']);
  assert.deepEqual(rowsOf(db, 'hypothesis_pain_links', 'hypothesis_id, pain_group_id, direction'), manualLink,
    'an accepted evidence placement is not the link the manual route writes');
});

test('the manual routes and the accept path share one writer each', () => {
  const route = readFileSync(new URL('../src/routes/founder_validate.ts', import.meta.url), 'utf8');
  for (const fn of ['upsertPainSeverity(', 'setInterviewIcpFit(', 'insertHypothesisLink(']) {
    assert.ok(route.includes(fn), `founder_validate.ts no longer calls ${fn}`);
  }
  assert.doesNotMatch(route, /INSERT INTO interview_pain_severities|INSERT INTO hypothesis_pain_links|SET icp_fit = \?/,
    'founder_validate.ts kept its own copy of a write');
});

// ── edit then accept ────────────────────────────────────────────────────────

test('edit then accept writes the edit and keeps the model\'s payload; a bad edit writes nothing', async () => {
  const { env, db } = world();
  await seed(env, [{ kind: 'icp_fit', payload: { fit: 'strong', reason: 'Owns the close' }, cite: { from: 4000, to: 12000 } }]);
  const id = rowsOf(db, 'validate_proposals', 'id')[0].id;
  const bad = await call(env, structure, 'POST', `/placements/${id}/accept`, { payload: { fit: 'amazing', reason: 'x' } });
  assert.equal(bad.status, 422);
  assert.equal(db.prepare('SELECT icp_fit FROM discovery_interviews WHERE id = 101').get().icp_fit, null);
  assert.equal(db.prepare('SELECT status FROM validate_proposals WHERE id = ?').get(id).status, 'pending');

  const ok = await call(env, structure, 'POST', `/placements/${id}/accept`, { payload: { fit: 'none', reason: 'Not the buyer' } });
  assert.equal(ok.status, 200);
  assert.equal(db.prepare('SELECT icp_fit FROM discovery_interviews WHERE id = 101').get().icp_fit, 'none');
  const row = db.prepare('SELECT payload_json, edited_payload_json, status FROM validate_proposals WHERE id = ?').get(id);
  assert.deepEqual(JSON.parse(row.payload_json), { fit: 'strong', reason: 'Owns the close' });
  assert.deepEqual(JSON.parse(row.edited_payload_json), { fit: 'none', reason: 'Not the buyer' });
  assert.equal(row.status, 'accepted');
  assert.equal((await call(env, structure, 'POST', `/placements/${id}/accept`)).status, 409, 'a placement was accepted twice');
});

test('two accepts racing write once, and a refuting placement is stored as a contradicting link', async () => {
  const { env, db } = world();
  await seed(env, [{ kind: 'evidence', payload: { hypothesis_id: 31, pain_group_id: 42, direction: 'refutes', strength: 'measured' }, cite: { from: 12000, to: 20000 } }]);
  const id = rowsOf(db, 'validate_proposals', 'id')[0].id;
  const [a, b] = await Promise.all([
    call(env, structure, 'POST', `/placements/${id}/accept`),
    call(env, structure, 'POST', `/placements/${id}/accept`),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], 'two founders both accepted one placement');
  assert.deepEqual(rowsOf(db, 'hypothesis_pain_links', 'hypothesis_id, pain_group_id, direction').map((r: any) => ({ ...r })),
    [{ hypothesis_id: 31, pain_group_id: 42, direction: 'contradicts' }]);
});

// ── discard ─────────────────────────────────────────────────────────────────

test('a discarded placement writes nothing to any module', async () => {
  const { env, db } = world();
  await seed(env, [
    { kind: 'pain_severity', payload: { phrase: 'Reconcile by hand', severity: 'severe' }, cite: { from: 4000, to: 12000 } },
    { kind: 'icp_fit', payload: { fit: 'strong', reason: 'Owns the close' }, cite: { from: 4000, to: 12000 } },
    { kind: 'evidence', payload: { hypothesis_id: 31, pain_group_id: 41, direction: 'refutes', strength: 'anecdote' }, cite: { from: 4000, to: 12000 } },
  ]);
  const snapshot = () => JSON.stringify([
    rowsOf(db, 'interview_pain_severities', '*'),
    db.prepare('SELECT id, icp_fit, updated_at FROM discovery_interviews ORDER BY id').all(),
    rowsOf(db, 'hypothesis_pain_links', '*'),
  ]);
  const before = snapshot();
  for (const { id } of rowsOf(db, 'validate_proposals', 'id')) {
    assert.equal((await call(env, structure, 'POST', `/placements/${id}/discard`)).status, 200);
  }
  assert.equal(snapshot(), before, 'a discard wrote to a module');
  assert.deepEqual(rowsOf(db, 'validate_proposals', 'status').map((r: any) => r.status), ['discarded', 'discarded', 'discarded']);
  const id = rowsOf(db, 'validate_proposals', 'id')[0].id;
  assert.equal((await call(env, structure, 'POST', `/placements/${id}/accept`)).status, 409, 'a discarded placement could still be accepted');
});

// ── proposed-only kinds, ownership, the Lab ─────────────────────────────────

test('a market fact has no store: it stays proposed, and the review read says so', async () => {
  const w = withSession(world());
  await seed(w.env, [{ kind: 'market_fact', payload: { fact: 'Ledgerly costs too much', source: 'the interviewee' }, cite: { from: 12000, to: 20000 } }]);
  const id = rowsOf(w.db, 'validate_proposals', 'id')[0].id;
  const r = await call(w.env, structure, 'POST', `/placements/${id}/accept`);
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'writer_not_available');
  assert.equal(w.db.prepare('SELECT status FROM validate_proposals WHERE id = ?').get(id).status, 'pending');
  const read = await call(w.env, structure, 'GET', '/sessions/5/placements');
  assert.equal(read.json.runs[0].placements[0].can_accept, false, 'a proposed-only kind is not marked as such for the page');
});

test('segment, demand signal and competitor accept through #1472\'s writers', async () => {
  const w = withSession(world());
  await seed(w.env, [
    { kind: 'segment', payload: { name: 'Finance leads' }, cite: { from: 4000, to: 12000 } },
    { kind: 'demand_signal', payload: { signal: 'would_pay', detail: 'Would pay tomorrow' }, cite: { from: 20000, to: 26000 } },
    { kind: 'competitor_mention', payload: { name: 'Ledgerly', context: 'Too expensive' }, cite: { from: 12000, to: 20000 } },
  ]);
  const [seg, demand, comp] = rowsOf(w.db, 'validate_proposals', 'id').map((x: any) => x.id);

  assert.equal((await call(w.env, structure, 'POST', `/placements/${seg}/accept`)).status, 200);
  const segRow = w.db.prepare('SELECT id, name, source, source_ref FROM customer_segments').get();
  assert.deepEqual([segRow.name, segRow.source, segRow.source_ref], ['Finance leads', 'interview', 'session:5']);
  assert.equal(w.db.prepare('SELECT segment_id FROM discovery_interviews WHERE id = 101').get().segment_id, segRow.id,
    'the interview was not placed in the segment it named');

  assert.equal((await call(w.env, structure, 'POST', `/placements/${demand}/accept`)).status, 200);
  const sig = w.db.prepare('SELECT kind, status, source_kind, interview_id, session_id, note FROM demand_signals').get();
  assert.deepEqual({ ...sig }, { kind: 'would_pay', status: 'to_confirm', source_kind: 'session', interview_id: 101, session_id: 5, note: 'Would pay tomorrow' },
    'a proposed demand signal was counted before the founder confirmed it');

  // No competitor list on the project: D659's writer refuses, and the
  // placement stays proposed rather than being marked accepted.
  const refused = await call(w.env, structure, 'POST', `/placements/${comp}/accept`);
  assert.equal(refused.status, 409);
  assert.equal(refused.json.error, 'writer_refused');
  assert.equal(w.db.prepare('SELECT status FROM validate_proposals WHERE id = ?').get(comp).status, 'pending');

  w.db.prepare(`INSERT INTO competitor_analyses (id, project_id, user_id, inputs_json, status, created_at, updated_at)
                VALUES ('an-1', ${PROJECT}, ${ME}, '{}', 'ready', datetime('now'), datetime('now'))`).run();
  const ok = await call(w.env, structure, 'POST', `/placements/${comp}/accept`);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(w.db.prepare("SELECT COUNT(*) n FROM competitor_candidates WHERE name = 'Ledgerly'").get().n, 1);
  const cs = w.db.prepare('SELECT project_id, source_kind, signal_type FROM competitor_signals').get();
  assert.deepEqual({ ...cs }, { project_id: PROJECT, source_kind: 'session', signal_type: 'mention' });
});

test('another member cannot accept or discard; a Lab venture\'s member accepts into the rows the Lab reads', async () => {
  const { env, db } = world();
  await seed(env, [{ kind: 'icp_fit', payload: { fit: 'strong', reason: 'Owns the close' }, cite: { from: 4000, to: 12000 } }]);
  const id = rowsOf(db, 'validate_proposals', 'id')[0].id;
  assert.equal((await call(env, structure, 'POST', `/placements/${id}/accept`, undefined, OTHER)).status, 403);
  assert.equal((await call(env, structure, 'POST', `/placements/${id}/discard`, undefined, OTHER)).status, 403);

  await seed(env, [{ kind: 'icp_fit', payload: { fit: 'partial', reason: 'Pilot buyer' }, cite: { from: 4000, to: 12000 } }], 201, LAB_PROJECT);
  const labId = db.prepare('SELECT id FROM validate_proposals WHERE project_id = ?').get(LAB_PROJECT).id;
  assert.equal((await call(env, structure, 'POST', `/placements/${labId}/accept`, undefined, LAB)).status, 200);
  assert.equal(db.prepare('SELECT icp_fit FROM discovery_interviews WHERE id = 201').get().icp_fit, 'partial',
    'a Lab venture\'s accepted placement did not land on its discovery_interviews row');
});

test('a placement naming an interview of another project is refused and stays pending', async () => {
  const { env, db } = world();
  await seed(env, [{ kind: 'icp_fit', payload: { fit: 'strong', reason: 'x y' }, cite: { from: 4000, to: 12000 } }], 201, PROJECT);
  const id = rowsOf(db, 'validate_proposals', 'id')[0].id;
  const r = await call(env, structure, 'POST', `/placements/${id}/accept`);
  assert.equal(r.status, 409);
  assert.equal(db.prepare('SELECT icp_fit FROM discovery_interviews WHERE id = 201').get().icp_fit, null);
  assert.equal(db.prepare('SELECT status FROM validate_proposals WHERE id = ?').get(id).status, 'pending');
});

// ── ask and compare ─────────────────────────────────────────────────────────

test('an answer with no citation is refused; one with a citation names its passage', () => {
  assert.deepEqual(checkAnswer('{"answer":"They hate it.","cites":[]}', SEGMENTS), { ok: false, reason: 'no_citation' });
  assert.deepEqual(checkAnswer('{"answer":"They hate it.","cites":[{"from":90000,"to":91000}]}', SEGMENTS), { ok: false, reason: 'no_citation' });
  assert.deepEqual(checkAnswer('They hate it.', SEGMENTS), { ok: false, reason: 'unreadable' });
  const ok = checkAnswer('{"answer":"They reconcile by hand on Fridays.","cites":[{"from":4000,"to":12000}]}', SEGMENTS);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.cites, [{ from: 4000, to: 12000, quote: SEGMENTS[1].text }]);
});

test('two runs are aligned by module, each side keeping its own lines', () => {
  const a = [{ kind: 'icp_fit', id: 1 }, { kind: 'pain_severity', id: 2 }];
  const b = [{ kind: 'pain_severity', id: 3 }, { kind: 'pain_severity', id: 4 }, { kind: 'market_fact', id: 5 }];
  assert.deepEqual(alignRuns(a, b), [
    { module: 'customer_research', first: [a[0]], second: [] },
    { module: 'problem_discovery', first: [a[1]], second: [b[0], b[1]] },
    { module: 'market_intelligence', first: [], second: [b[2]] },
  ]);
});

test('segment, demand signal and competitor: an accepted placement writes the row the hand-entry form writes (S1 on #1471)', async () => {
  // Two fresh worlds: one accepts placements, one types the same facts into
  // #1472's manual routes. Compared without the columns that say WHERE a row
  // came from (ids, times, source, the session) — those differ by design.
  const strip = (rows: any[], drop: string[]) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k))));
  const ANALYSIS = `INSERT INTO competitor_analyses (id, project_id, user_id, inputs_json, status, created_at, updated_at)
                    VALUES ('an-1', ${PROJECT}, ${ME}, '{}', 'ready', datetime('now'), datetime('now'))`;

  const a = withSession(world());
  a.db.prepare(ANALYSIS).run();
  await seed(a.env, [
    { kind: 'segment', payload: { name: 'Finance leads' }, cite: { from: 4000, to: 12000 } },
    { kind: 'demand_signal', payload: { signal: 'would_pay', detail: 'Would pay tomorrow' }, cite: { from: 20000, to: 26000 } },
    { kind: 'competitor_mention', payload: { name: 'Ledgerly', context: 'Too expensive' }, cite: { from: 12000, to: 20000 } },
  ]);
  for (const { id } of rowsOf(a.db, 'validate_proposals', 'id')) {
    const r = await call(a.env, structure, 'POST', `/placements/${id}/accept`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }

  const b = world();
  b.db.prepare(ANALYSIS).run();
  const q = `?project=${PROJECT}`;
  const seg = await call(b.env, cycleValidate, 'POST', `/segments${q}`, { name: 'Finance leads' });
  assert.equal(seg.status, 201, JSON.stringify(seg.json));
  assert.equal((await call(b.env, cycleValidate, 'PUT', `/interviews/101/segment${q}`, { segment_id: seg.json.id })).status, 200);
  assert.equal((await call(b.env, cycleValidate, 'POST', `/demand-signals${q}`,
    { kind: 'would_pay', interview_id: 101, note: 'Would pay tomorrow', status: 'to_confirm' })).status, 201);
  assert.equal((await call(b.env, cycleValidate, 'POST', `/competitor-mentions${q}`,
    { name: 'Ledgerly', detail: 'Too expensive', signal_type: 'mention' })).status, 201);

  const time = ['id', 'created_at', 'updated_at'];
  const same = (sql: string, drop: string[], what: string) =>
    assert.deepEqual(strip(a.db.prepare(sql).all(), [...time, ...drop]), strip(b.db.prepare(sql).all(), [...time, ...drop]), what);
  same('SELECT * FROM customer_segments', ['source', 'source_ref'], 'an accepted segment is not the row the form writes');
  same('SELECT id, segment_id IS NOT NULL AS placed FROM discovery_interviews WHERE id = 101', [], 'the interview was not placed in its segment the same way');
  same('SELECT * FROM demand_signals', ['source_kind', 'session_id'], 'an accepted demand signal is not the row the form writes');
  same('SELECT name, category, summary FROM competitor_candidates', [], 'an accepted competitor is not the row the form adds');
  same('SELECT analysis_id, signal_type, label, detail, project_id, source_url FROM competitor_signals', [], 'an accepted mention is not the signal the form writes');
});

test('an accepted severity is stored as the canvas\'s own word, and an evidence link keeps its strength', async () => {
  const { env, db } = world();
  await seed(env, [
    { kind: 'pain_severity', payload: { phrase: 'Friday close', severity: 'mild' }, cite: { from: 4000, to: 12000 } },
    { kind: 'evidence', payload: { hypothesis_id: 31, pain_group_id: 41, direction: 'supports', strength: 'measured' }, cite: { from: 4000, to: 12000 } },
  ]);
  for (const { id } of rowsOf(db, 'validate_proposals', 'id')) assert.equal((await call(env, structure, 'POST', `/placements/${id}/accept`)).status, 200);
  assert.equal(db.prepare("SELECT severity FROM interview_pain_severities WHERE phrase_norm = 'friday close'").get().severity, 'mild');
  assert.equal(db.prepare('SELECT strength FROM hypothesis_pain_links').get().strength, 'measured');
});

test('the project context lists live hypotheses and pain groups only', async () => {
  const { env, db } = world();
  db.exec("INSERT INTO hypotheses (id, project_id, code, claim, retired_at) VALUES (32, 7, 'H2', 'Retired', '2026-01-01')");
  const ctx = await loadStructureContext(env, PROJECT);
  assert.deepEqual(ctx.hypotheses.map((h) => h.id), [31]);
  assert.deepEqual(ctx.painGroups.map((g) => g.id), [41, 42]);
  assert.deepEqual(mergePlacements([[], []]), []);
});

// ── the session routes: structure, compare, ask, the receipt ────────────────

/** A transcribed session on interview 101, its final transcript = SEGMENTS. */
function withSession(w: ReturnType<typeof world>, project = PROJECT, interview = 101) {
  w.db.prepare(`INSERT INTO interview_sessions (id, uid, interview_id, project_id, created_by_user_id, channel, status, consent_status)
                VALUES (5, 'sess-5', ?, ?, ?, 'video', 'transcribed', 'given')`).run(interview, project, ME);
  for (const seg of SEGMENTS) {
    w.db.prepare(`INSERT INTO interview_transcript_segments (session_id, source, start_ms, end_ms, speaker_label, text, model)
                  VALUES (5, 'final', ?, ?, ?, ?, 'whisper')`).run(seg.start, seg.end, seg.speaker, seg.text);
  }
  w.db.prepare(`INSERT INTO interview_transcript_segments (session_id, source, start_ms, end_ms, speaker_label, text)
                VALUES (5, 'live', 0, 99000, 'Me', 'a live draft that must never be read')`).run();
  return w;
}

const REPLY = JSON.stringify({ placements: [
  { kind: 'pain_severity', payload: { phrase: 'Reconcile by hand', severity: 'severe' }, cite: { from: 4000, to: 12000 } },
  { kind: 'competitor_mention', payload: { name: 'Ledgerly' }, cite: { from: 12000, to: 20000 } },
  { kind: 'icp_fit', payload: { fit: 'strong', reason: 'Owns the close' } },
] });

test('structure: one run over the final transcript stores the cited placements and a receipt line', async () => {
  const w = withSession(world((_m, input) => {
    assert.doesNotMatch(input.messages.at(-1).content, /live draft/, 'the live draft reached the model');
    return { response: REPLY };
  }));
  const r = await call(w.env, structure, 'POST', '/sessions/5/structure');
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.step, 'structured');
  assert.equal(r.json.stored, 2);
  assert.equal(r.json.dropped, 1, 'the uncited ICP placement was not counted as dropped');
  const rows = rowsOf(w.db, 'validate_proposals', 'kind, session_id, run_id, target_ref, status');
  assert.deepEqual(rows.map((x: any) => [x.kind, x.session_id, x.run_id, x.target_ref, x.status]), [
    ['pain_severity', 5, r.json.run_id, 'interview:101', 'pending'],
    ['competitor_mention', 5, r.json.run_id, 'interview:101', 'pending'],
  ]);
  assert.equal(w.db.prepare('SELECT status FROM interview_sessions WHERE id = 5').get().status, 'structured');
  const receipt = rowsOf(w.db, 'interview_structure_receipts', 'step, model, fallback_used, outcome, run_id');
  assert.deepEqual(receipt.map((x: any) => [x.step, x.model, x.fallback_used, x.outcome, x.run_id]), [['structured', MID, 0, 'ok', r.json.run_id]]);
});

test('compare: a second run is a re-structure with its own run_id, and the read aligns the two by module', async () => {
  let n = 0;
  const w = withSession(world(() => {
    n += 1;
    return { response: n === 1 ? REPLY : JSON.stringify({ placements: [
      { kind: 'pain_severity', payload: { phrase: 'Friday close', severity: 'real' }, cite: { from: 4000, to: 12000 } },
    ] }) };
  }));
  const a = await call(w.env, structure, 'POST', '/sessions/5/structure');
  const b = await call(w.env, structure, 'POST', '/sessions/5/structure', { model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast' });
  assert.equal(b.json.step, 're_structured');
  assert.notEqual(a.json.run_id, b.json.run_id);
  const read = await call(w.env, structure, 'GET', '/sessions/5/placements');
  assert.equal(read.status, 200);
  assert.deepEqual(read.json.runs.map((x: any) => x.run_id), [a.json.run_id, b.json.run_id]);
  assert.equal(read.json.compare.first, a.json.run_id);
  const pain = read.json.compare.modules.find((m: any) => m.module === 'problem_discovery');
  assert.deepEqual([pain.first.length, pain.second.length], [1, 1]);
  const comp = read.json.runs[0].placements.find((p: any) => p.kind === 'competitor_mention');
  assert.equal(comp.can_accept, true, 'a kind with a writer is marked proposed-only');
  assert.equal(comp.cite.quote, SEGMENTS[2].text);
  const steps = rowsOf(w.db, 'interview_structure_receipts', 'step').map((x: any) => x.step);
  assert.deepEqual(steps, ['structured', 're_structured']);
});

test('the session receipt names the fallback model when the first choice fails, beside the transcription lines', async () => {
  const w = withSession(world((model) => {
    if (model === MID) throw new Error('capacity');
    return { response: REPLY };
  }));
  w.db.prepare(`INSERT INTO interview_session_receipts (session_id, kind, model, audio_minutes, cost_microusd, outcome, created_at)
                VALUES (5, 'final', '@cf/openai/whisper-large-v3-turbo', 2, 1000, 'ok', '2000-01-01 00:00:00')`).run();
  assert.equal((await call(w.env, structure, 'POST', '/sessions/5/structure')).status, 201);
  const r = await call(w.env, sessionsApp, 'GET', '/sessions/5/receipt');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.items.map((x: any) => [x.kind, x.model, x.fallback_used]), [
    ['final', '@cf/openai/whisper-large-v3-turbo', 0],
    ['structured', SMALL, 1],
  ], 'the receipt does not name the fallback model, or misses the transcription line');
});

test('a refused run stores nothing, records the refusal and answers 503', async () => {
  const w = withSession(world(() => { throw new Error('down'); }));
  const r = await call(w.env, structure, 'POST', '/sessions/5/structure');
  assert.equal(r.status, 503);
  assert.equal(rowsOf(w.db, 'validate_proposals', 'id').length, 0);
  assert.deepEqual(rowsOf(w.db, 'interview_structure_receipts', 'outcome').map((x: any) => x.outcome), ['refused']);
  assert.equal(w.db.prepare('SELECT status FROM interview_sessions WHERE id = 5').get().status, 'transcribed');
});

test('ask: an answer with no citation is refused and not shown; a cited one is', async () => {
  let reply = '{"answer":"They seem frustrated.","cites":[]}';
  const w = withSession(world(() => ({ response: reply })));
  const refused = await call(w.env, structure, 'POST', '/sessions/5/ask', { question: 'How do they feel?' });
  assert.equal(refused.status, 422);
  assert.equal(refused.json.error, 'no_citation');
  assert.equal(refused.json.answer, undefined, 'an uncited answer was shown');
  reply = '{"answer":"By hand, every Friday.","cites":[{"from":4000,"to":12000}]}';
  const ok = await call(w.env, structure, 'POST', '/sessions/5/ask', { question: 'How do they reconcile?' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.cites, [{ from: 4000, to: 12000, quote: SEGMENTS[1].text }]);
  assert.deepEqual(rowsOf(w.db, 'interview_structure_receipts', 'step').map((x: any) => x.step), ['asked', 'asked']);
});

test('a session with no final transcript is not structured or asked; another member is refused', async () => {
  const w = world();
  w.db.prepare(`INSERT INTO interview_sessions (id, uid, interview_id, project_id, created_by_user_id, channel, status, consent_status)
                VALUES (5, 'sess-5', 101, ${PROJECT}, ${ME}, 'video', 'stopped', 'given')`).run();
  assert.equal((await call(w.env, structure, 'POST', '/sessions/5/structure')).status, 409);
  assert.equal((await call(w.env, structure, 'POST', '/sessions/5/ask', { question: 'x' })).status, 409);
  assert.equal((await call(w.env, structure, 'POST', '/sessions/5/structure', undefined, OTHER)).status, 403);
  assert.equal((await call(w.env, structure, 'GET', '/sessions/5/placements', undefined, OTHER)).status, 403);
  assert.equal((await call(w.env, structure, 'POST', '/sessions/999/structure')).status, 404);
});

test('a text-chat transcript with no end times still gives stable, citable spans', () => {
  const rows = [
    { start_ms: 0, end_ms: null, speaker_label: 'Me', text: 'Hi' },
    { start_ms: 60000, end_ms: null, speaker_label: 'Sam', text: 'We close books by hand.' },
    { start_ms: null, end_ms: null, speaker_label: 'Sam', text: 'Every Friday.' },
    { start_ms: null, end_ms: null, speaker_label: 'Me', text: '   ' },
  ];
  const a = toSegments(rows);
  assert.deepEqual(a.map((x) => [x.start, x.end]), [[0, 60000], [60000, 61000], [61000, 62000]]);
  assert.deepEqual(toSegments(rows), a, 'the same rows gave different spans');
  for (let i = 1; i < a.length; i += 1) assert.ok(a[i].start >= a[i - 1].end, 'spans overlap');
  // A recorded offset is never moved: the stored cite must match the segment row.
  assert.deepEqual(toSegments([{ start_ms: 0, end_ms: 5000, speaker_label: 'A', text: 'x' }, { start_ms: 3000, end_ms: 8000, speaker_label: 'B', text: 'y' }])
    .map((x) => [x.start, x.end]), [[0, 5000], [3000, 8000]]);
});
