/**
 * D4667 (#4667, third slice, owner's answer A): the four read keys of their own (`grow.burn`, `raise.pipeline`,
 * `validate.transcripts`, `raise.diligence`), through the real readers on the real migrated schema, as the agent's
 * sponsor. Synthetic records only; no model runs.
 *
 *   · each answers typed records with a stable reference, scoped to its venture, and is withheld from a sponsor
 *     outside the venture's team, with none of its data;
 *   · a field the source does not record (a prospect's stage-change date) is named missing and leaves the input
 *     partial, never guessed;
 *   · an interview without recording consent carries its consent and speakers but not its words, and leaves the
 *     transcript input partial;
 *   · each skill these keys serve gets a complete-input and a missing or partial-input preflight through them.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { readOne, READERS, type ReadContext } from '../src/services/agents/reads.ts';
import { READ_KEYS } from '../src/services/agents/catalogue.ts';
import { pathsFor, preflight } from '../src/services/agents/skillInputs.ts';

after(removeMigratedDatabases);
const NOW = Date.now();
const today = new Date(NOW).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);

function fixture() {
  const db = migratedDatabase();
  db.exec("INSERT INTO founders(id, name, email) VALUES (7, 'Synthetic Founder', 'synthetic-7@example.invalid')");
  db.exec(`INSERT INTO users(id, role, name, email, is_active, founder_id) VALUES
    (2, 'founder', 'Synthetic Founder', 'synthetic-2@example.invalid', 1, 7),
    (3, 'founder', 'Synthetic Outsider', 'synthetic-3@example.invalid', 1, NULL),
    (4, 'admin', 'Synthetic Reviewer', 'synthetic-4@example.invalid', 1, NULL)`);
  db.exec("INSERT INTO projects(id, name, founder_id, stage) VALUES (1, 'Synthetic venture', 7, 'seed'), (2, 'Other venture', NULL, 'seed')");
  const env: any = { DB: d1Over(db) };
  const ctx = (sponsor = 2, projectId = 1): ReadContext => ({
    scope: { kind: 'project', id: projectId, name: 'Synthetic venture', founder_id: 7, company_id: null } as any,
    agent: { sponsor_user_id: sponsor } as any, projectId,
  });
  return { db, env, ctx, close: () => db.close() };
}
const keysOf = (v: any) => Object.keys(v).sort();

test('the four keys are catalogue reads, so a rule book names them on purpose', () => {
  for (const k of ['grow.burn', 'raise.pipeline', 'validate.transcripts', 'raise.diligence']) {
    assert.ok(READ_KEYS.includes(k as never), k);
    assert.equal(typeof READERS[k], 'function', k);
  }
});

test('board metrics use scoped KPI values, recorded units and a bounded period', async () => {
  const f = fixture();
  try {
    f.db.exec(`INSERT INTO custom_kpis(id, uid, project_id, label, unit, currency) VALUES
      (11, 'customers', 1, 'Paying customers', 'count', NULL),
      (12, 'sales', 1, 'Sales', 'money', 'USD'),
      (13, 'other', 2, 'Other venture metric', 'count', NULL)`);
    const value = f.db.prepare('INSERT INTO custom_kpi_values(uid, kpi_id, as_of, value, value_cents) VALUES (?, ?, ?, ?, ?)');
    value.run('current', 11, today, 0, null);
    value.run('sales-today', 12, today, null, 1500);
    value.run('older', 11, daysAgo(45), 37, null);
    value.run('outside', 13, today, 999, null);
    const ctx = { ...f.ctx(), page: { from: daysAgo(14), to: today } };
    const result = await readOne(f.env, 'grow.board_metrics', ctx);
    assert.deepEqual((result.data as any).records.map(row => [row.ref, row.value, row.unit, row.currency]), [
      ['custom_kpi_value:sales-today', 1500, 'cents', 'USD'],
      ['custom_kpi_value:current', 0, 'count', null],
    ]);
    assert.deepEqual((result.data as any).coverage, { returned: 2, total: 2, omitted: 0, complete: true });
    assert.deepEqual(keysOf((await readOne(f.env, 'grow.board_metrics', f.ctx(3))).data), ['reason', 'withheld']);
    const board = await preflight(f.env, 'board-meeting-brief', ctx, READERS, NOW);
    assert.equal(board!.inputs.find(input => input.read === 'grow.board_metrics')!.status, 'available');
    assert.notEqual(board!.state, 'not_ready');
    const missing = await preflight(f.env, 'board-meeting-brief', {
      ...ctx, page: { from: daysAgo(35), to: daysAgo(20) },
    }, READERS, NOW);
    assert.equal(missing!.inputs.find(input => input.read === 'grow.board_metrics')!.status, 'empty');
    assert.equal(missing!.state, 'not_ready');
    f.db.exec("UPDATE custom_kpis SET currency = NULL WHERE uid = 'sales'");
    const partial = await preflight(f.env, 'board-meeting-brief', ctx, READERS, NOW);
    assert.equal(partial!.inputs.find(input => input.read === 'grow.board_metrics')!.status, 'partial');
    await assert.rejects(readOne(f.env, 'grow.board_metrics', { ...ctx, page: { ...ctx.page, after: 'custom_kpi_value:current' } }), { code: 'invalid_page' });
  } finally { f.close(); }
});

test('grow.burn: net burn by snapshot date in cents for the team; an empty period is empty; an outsider is withheld', async () => {
  const f = fixture();
  try {
    const m = f.db.prepare('INSERT INTO project_metrics(project_id, snapshot_date, net_burn, source) VALUES (?, ?, ?, ?)');
    m.run(1, daysAgo(70), 41000.5, null);
    m.run(1, daysAgo(40), 42000, 'mercury');
    m.run(1, daysAgo(10), 43000, 'mercury');
    m.run(2, daysAgo(10), 999999, null);
    const r: any = await readOne(f.env, 'grow.burn', f.ctx());
    assert.deepEqual(r.data.records.map((x: any) => [x.amount, x.unit, x.currency, x.source]), [[4_300_000, 'cents', null, 'mercury'], [4_200_000, 'cents', null, 'mercury'], [4_100_050, 'cents', null, 'typed']]);
    assert.ok(r.data.records.every((x: any) => /^project_metric:\d+$/.test(x.ref)));
    assert.deepEqual(r.data.coverage, { returned: 3, total: 3, omitted: 0, complete: true });
    assert.deepEqual(keysOf((await readOne(f.env, 'grow.burn', f.ctx(3))).data), ['reason', 'withheld']);
    const cash = await preflight(f.env, 'cash-runway-snapshot', f.ctx(), READERS, NOW);
    assert.equal(cash!.inputs.find((i) => i.read === 'grow.burn')!.status, 'available');
    f.db.exec('DELETE FROM project_metrics WHERE project_id = 1');
    const none = await preflight(f.env, 'cash-runway-snapshot', f.ctx(), READERS, NOW);
    assert.equal(none!.inputs.find((i) => i.read === 'grow.burn')!.status, 'empty');
    assert.equal(none!.state, 'not_ready', 'no burn recorded: nothing to compute a runway from');
  } finally { f.close(); }
});

test('raise.pipeline: stage, amount and currency per prospect; the stage-change date is named missing, so the input is partial', async () => {
  const f = fixture();
  try {
    // As the app writes it: `amount` in dollars, which migration 607's trigger mirrors into `amount_cents`.
    f.db.exec(`INSERT INTO raise_prospects(uid, project_id, name, email, firm, stage, amount, currency, updated_at) VALUES
      ('p1', 1, 'Synthetic Investor', 'investor@example.invalid', 'Synthetic Fund', 'meeting', 250000, 'USD', '${today} 09:00:00'),
      ('p2', 1, 'Second Investor', NULL, 'Second Fund', 'committed', 150000, 'EUR', '${today} 08:00:00'),
      ('p3', 2, 'Elsewhere', NULL, 'Other Fund', 'meeting', 1, 'USD', '${today} 08:00:00')`);
    const r: any = await readOne(f.env, 'raise.pipeline', f.ctx());
    assert.deepEqual(r.data.records.map((x: any) => [x.ref, x.stage, x.amount, x.currency, x.stage_changed_at]),
      [['raise_prospect:p1', 'meeting', 25_000_000, 'USD', null], ['raise_prospect:p2', 'committed', 15_000_000, 'EUR', null]]);
    assert.ok(!JSON.stringify(r.data).includes('investor@example.invalid'), 'never an email');
    assert.deepEqual(r.data.missing_fields, ['stage_changed_at']);
    const pipe = await preflight(f.env, 'pipeline-health-diagnostics', f.ctx(), READERS, NOW);
    const input = pipe!.inputs.find((i) => i.read === 'raise.pipeline')!;
    assert.deepEqual([input.status, input.note], ['partial', 'Not recorded at the source: stage_changed_at.']);
    assert.equal(pipe!.state, 'conditional');
    assert.ok(pipe!.limits.some((l) => l.includes('stage_changed_at')), 'the brief names what it cannot know');
    assert.deepEqual(keysOf((await readOne(f.env, 'raise.pipeline', f.ctx(3))).data), ['reason', 'withheld']);
    f.db.exec('DELETE FROM raise_prospects WHERE project_id = 1');
    const empty = await preflight(f.env, 'pipeline-health-diagnostics', f.ctx(), READERS, NOW);
    assert.deepEqual([empty!.inputs.find((i) => i.read === 'raise.pipeline')!.status, empty!.state], ['empty', 'not_ready']);
  } finally { f.close(); }
});

test('validate.transcripts: the final transcript with its speakers and consent; no consent, no words, and the input is partial', async () => {
  const f = fixture();
  try {
    f.db.exec("INSERT INTO discovery_interviews(id, project_id, interviewee_name) VALUES (1, 1, 'Synthetic Interviewee'), (2, 1, 'Second Interviewee'), (3, 2, 'Elsewhere')");
    f.db.exec(`INSERT INTO interview_sessions(id, uid, interview_id, project_id, created_by_user_id, channel, consent_status, consent_method, consent_at, started_at) VALUES
      (1, 's1', 1, 1, 2, 'video', 'given', 'verbal', '${today} 09:00:00', '${today} 09:00:00'),
      (3, 's3', 3, 2, 2, 'video', 'given', 'verbal', '${today} 09:00:00', '${today} 09:00:00')`);
    const seg = f.db.prepare('INSERT INTO interview_transcript_segments(session_id, source, start_ms, end_ms, speaker_label, text) VALUES (?, ?, ?, ?, ?, ?)');
    seg.run(1, 'live', 0, 900, 'Speaker 1', 'a live draft');
    seg.run(1, 'final', 0, 1000, 'Interviewer', 'What slows you down?');
    seg.run(1, 'final', 1000, 2000, 'Interviewee', 'Reconciling invoices by hand.');
    seg.run(3, 'final', 0, 1000, 'Someone', 'another venture');
    const r: any = await readOne(f.env, 'validate.transcripts', f.ctx());
    assert.equal(r.data.records.length, 1);
    const s = r.data.records[0];
    assert.equal(s.ref, 'interview_session:s1');
    assert.deepEqual(s.consent, { status: 'given', method: 'verbal', at: `${today} 09:00:00` });
    assert.deepEqual(s.speakers, ['Interviewer', 'Interviewee']);
    assert.deepEqual(s.segments.map((x: any) => x.text), ['What slows you down?', 'Reconciling invoices by hand.'], 'the final transcript, not the live draft');
    const ok = await preflight(f.env, 'customer-interview-summary', f.ctx(), READERS, NOW);
    assert.deepEqual([ok!.inputs[0].status, ok!.state], ['available', 'ready']);

    f.db.exec(`INSERT INTO interview_sessions(id, uid, interview_id, project_id, created_by_user_id, channel, consent_status, started_at) VALUES (2, 's2', 2, 1, 2, 'phone', 'not_recorded', '${today} 10:00:00')`);
    seg.run(2, 'final', 0, 1000, 'Interviewee', 'words recorded without consent');
    const r2: any = await readOne(f.env, 'validate.transcripts', f.ctx());
    const s2 = r2.data.records.find((x: any) => x.ref === 'interview_session:s2');
    assert.deepEqual([s2.consent.status, s2.segments, s2.speakers], ['not_recorded', null, ['Interviewee']]);
    assert.ok(!JSON.stringify(r2.data).includes('without consent'), 'none of its words');
    const part = await preflight(f.env, 'customer-interview-summary', f.ctx(), READERS, NOW);
    assert.deepEqual([part!.inputs[0].status, part!.state], ['partial', 'conditional']);
    assert.match(part!.limits[0], /without their words/);
    assert.deepEqual(keysOf((await readOne(f.env, 'validate.transcripts', f.ctx(3))).data), ['reason', 'withheld']);
  } finally { f.close(); }
});

test('raise.diligence: workstreams and the requests the venture was sent, open questions marked; no reviewer notes or ids', async () => {
  const f = fixture();
  try {
    f.db.exec(`INSERT INTO dd_cases(id, uid, subject_type, subject_id, subject_label, owner_user_id, status, notes_enc, target_ic_date) VALUES
      (1, 'c1', 'project', 1, 'Synthetic venture', 4, 'open', 'ENCRYPTED-NOTE', '${daysAgo(-14)}'),
      (2, 'c2', 'project', 2, 'Other venture', 4, 'open', NULL, NULL)`);
    f.db.exec(`INSERT INTO dd_sections(case_id, section_key, title, status, assignee_user_id, verdict, reviewer_notes_enc, blocking) VALUES
      (1, 'legal', 'Legal', 'in_review', 4, 'warn', 'ENCRYPTED-REVIEW', 1), (1, 'finance', 'Finance', 'pending', NULL, NULL, NULL, 0)`);
    f.db.exec(`INSERT INTO dd_requests(case_id, title, state, due_date, responded_at, created_at) VALUES
      (1, 'Signed SAFE', 'requested', '${daysAgo(-7)}', NULL, '${today} 09:00:00'),
      (1, 'Incorporation papers', 'received', NULL, '${today} 10:00:00', '${today} 09:00:00'),
      (2, 'Elsewhere', 'requested', NULL, NULL, '${today} 09:00:00')`);
    const r: any = await readOne(f.env, 'raise.diligence', f.ctx());
    assert.deepEqual(r.data.workstreams.map((w: any) => [w.key, w.status, w.assigned, w.blocking]), [['legal', 'in_review', true, true], ['finance', 'pending', false, false]]);
    assert.deepEqual(r.data.records.map((x: any) => [x.title, x.state, x.open]), [['Signed SAFE', 'requested', true], ['Incorporation papers', 'received', false]]);
    assert.ok(r.data.records.every((x: any) => /^dd_request:c1:\d+$/.test(x.ref)));
    const text = JSON.stringify(r.data);
    for (const secret of ['ENCRYPTED-NOTE', 'ENCRYPTED-REVIEW', 'warn', 'Elsewhere']) assert.ok(!text.includes(secret), secret);
    const dd = await preflight(f.env, 'legal-due-diligence-coordination', f.ctx(), READERS, NOW);
    assert.equal(dd!.inputs.find((i) => i.read === 'raise.diligence')!.status, 'available');
    assert.deepEqual(keysOf((await readOne(f.env, 'raise.diligence', f.ctx(3))).data), ['reason', 'withheld']);
    f.db.exec('DELETE FROM dd_requests; DELETE FROM dd_sections; DELETE FROM dd_cases');
    const none = await preflight(f.env, 'legal-due-diligence-coordination', f.ctx(), READERS, NOW);
    assert.deepEqual([none!.inputs.find((i) => i.read === 'raise.diligence')!.status, none!.state], ['empty', 'not_ready']);
    assert.equal(pathsFor('legal-due-diligence-coordination')!.default_context, 'supported');
  } finally { f.close(); }
});
