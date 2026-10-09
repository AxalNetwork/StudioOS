/**
 * D658 (#1471) — an interview turned into Validate placements, and decided.
 *
 * What the issue asks the tests to prove:
 *   · a placement without a citation is never stored;
 *   · an accepted placement and a hand-typed row produce identical module rows;
 *   · a discarded placement writes nothing;
 *   · the receipt names the fallback model when the first choice fails;
 *   · an answer with no citation is refused.
 * Plus: a long transcript is split and merged, never cut; a kind whose writer
 * has not merged stays proposed; an edit is validated as strictly as the
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
  storedSeverity,
  segmentsInSpan,
  type Segment,
} from '../src/services/interviewStructuring.ts';
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
  for (const m of ['106_pain_groups.sql', '211_founder_validate_evidence.sql', '214_validate_proposals.sql',
    '246_fills_the_blanks_everywhere.sql', '439_validate_proposals_structuring.sql']) {
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
  assert.equal((await call(env, founderValidate, 'PUT', '/interviews/102/pain-severity', { phrase: 'Reconcile by hand', severity: storedSeverity('real') })).status, 200);
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

test('a kind whose writer has not merged stays proposed and says so', async () => {
  const { env, db } = world();
  await seed(env, [
    { kind: 'segment', payload: { name: 'Finance leads' }, cite: { from: 4000, to: 12000 } },
    { kind: 'demand_signal', payload: { signal: 'would_pay' }, cite: { from: 20000, to: 26000 } },
    { kind: 'competitor_mention', payload: { name: 'Ledgerly' }, cite: { from: 12000, to: 20000 } },
    { kind: 'market_fact', payload: { fact: 'Ledgerly costs too much', source: 'the interviewee' }, cite: { from: 12000, to: 20000 } },
  ]);
  for (const { id } of rowsOf(db, 'validate_proposals', 'id')) {
    const r = await call(env, structure, 'POST', `/placements/${id}/accept`);
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'writer_not_available');
  }
  assert.deepEqual(rowsOf(db, 'validate_proposals', 'status').map((r: any) => r.status), ['pending', 'pending', 'pending', 'pending']);
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

test('severity keeps the canvas\'s three words and stores on today\'s two-level scale', () => {
  assert.equal(storedSeverity('severe'), 'need');
  assert.equal(storedSeverity('real'), 'need');
  assert.equal(storedSeverity('mild'), 'nice');
});

test('the project context lists live hypotheses and pain groups only', async () => {
  const { env, db } = world();
  db.exec("INSERT INTO hypotheses (id, project_id, code, claim, retired_at) VALUES (32, 7, 'H2', 'Retired', '2026-01-01')");
  const ctx = await loadStructureContext(env, PROJECT);
  assert.deepEqual(ctx.hypotheses.map((h) => h.id), [31]);
  assert.deepEqual(ctx.painGroups.map((g) => g.id), [41, 42]);
  assert.deepEqual(mergePlacements([[], []]), []);
});
