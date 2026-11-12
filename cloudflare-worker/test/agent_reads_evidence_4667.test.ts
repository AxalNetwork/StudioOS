/**
 * D4667 (#4667): the first ten skills' inputs, through the real readers.
 * Synthetic records on the real migrated schema; nothing is read from a connector and no model runs.
 *
 *   · a 21-record history says 20 of 21 were supplied and 1 left out: no complete-period total is inferred;
 *   · an overlong record says its text was clipped; every row has a stable, scope-bound reference;
 *   · an answer over the limit drops whole rows and says how many, or says it is incomplete: never a JSON substring;
 *   · an unknown count is unavailable, not zero; empty-but-complete, missing, unavailable and unreadable differ;
 *   · each of the ten skills gets a preflight through the actual readers, and none is ready on evidence the readers
 *     do not carry.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { coverageOf, READ_MAX, READER_PROVIDES, READERS, readOne, type ReadContext } from '../src/services/agents/reads.ts';
import { FIRST_TEN_SLUGS, inputMatrix, pathsFor, preflight, STALE_DAYS } from '../src/services/agents/skillInputs.ts';

after(removeMigratedDatabases);
const NOW = Date.parse('2026-11-07T12:00:00Z');

function fixture() {
  const db = migratedDatabase();
  db.exec("INSERT INTO users(id, role, name, email, is_active) VALUES (2, 'founder', 'Synthetic Founder', 'synthetic-2@example.invalid', 1)");
  db.exec("INSERT INTO projects(id, name, founder_id, stage) VALUES (1, 'Synthetic venture', 2, 'seed'), (2, 'Other venture', 2, 'seed')");
  const env: any = { DB: d1Over(db) };
  const ctx = (projectId: number | null = 1): ReadContext => ({ scope: { kind: 'project', id: projectId ?? 1, name: 'Synthetic venture', founder_id: 2, company_id: null }, agent: {} as any, projectId });
  const log = db.prepare("INSERT INTO activity_logs(project_id, user_id, action, details, entity_type, created_at) VALUES (?, 2, 'created', ?, ?, ?)");
  const add = (project: number, cycle: string, n: number, details = 'Synthetic record', at = '2026-11-01 10:00:00') => {
    for (let i = 0; i < n; i += 1) log.run(project, `${details} ${i}`, `${cycle}.interviews`, at);
  };
  return { db, env, ctx, add, close: () => db.close() };
}

test('a 21-record history supplies 20 and says 1 was left out; the total is counted, never inferred from the page', async () => {
  const f = fixture();
  try {
    f.add(1, 'validate', 21);
    f.add(2, 'validate', 5); // another project's records are not this scope's
    const r: any = await readOne(f.env, 'validate.records', f.ctx());
    assert.equal(r.data.records.length, 20);
    assert.deepEqual(r.data.coverage, { returned: 20, total: 21, omitted: 1, complete: false });
    assert.equal(new Set(r.data.records.map((x: any) => x.ref)).size, 20, 'every row has its own reference');
    assert.ok(r.data.records.every((x: any) => /^activity:[a-f0-9]{32}$/.test(x.ref)), 'a stable id, not a row number');
    f.add(1, 'build', 3);
    const small: any = await readOne(f.env, 'build.records', f.ctx());
    assert.deepEqual(small.data.coverage, { returned: 3, total: 3, omitted: 0, complete: true });
    assert.deepEqual(coverageOf(0, null), { returned: 0, total: null, omitted: null, complete: false }, 'an unknown count is not 0');
  } finally { f.close(); }
});

test('an overlong record says its text was clipped; a short one does not', async () => {
  const f = fixture();
  try {
    f.add(1, 'grow', 1, 'x'.repeat(500));
    f.add(1, 'grow', 1, 'short');
    const r: any = await readOne(f.env, 'grow.records', f.ctx());
    const long = r.data.records.find((x: any) => x.summary.length === 300);
    const short = r.data.records.find((x: any) => x.summary.startsWith('short'));
    assert.equal(long.clipped, true);
    assert.equal(short.clipped, undefined);
  } finally { f.close(); }
});

test('an answer over the limit keeps its typed shape and counts what was dropped; one that cannot be shortened says it is incomplete', async () => {
  const f = fixture();
  try {
    const rows = Array.from({ length: 40 }, (_, i) => ({ ref: `activity:${String(i).padStart(32, '0')}`, summary: 'y'.repeat(400) }));
    const big = { 'big.read': async () => ({ records: rows, coverage: coverageOf(40, 40) }) };
    const r: any = await readOne(f.env, 'big.read', f.ctx(), big);
    assert.equal(r.truncated, true);
    assert.ok(Array.isArray(r.data.records), 'still a list of rows, not a string');
    assert.ok(new TextEncoder().encode(JSON.stringify(r.data)).length <= READ_MAX);
    assert.equal(r.data.records.length + r.data.omitted_for_size.records, 40, 'every dropped row is counted');
    assert.ok(r.data.records.every((x: any) => x.summary.length === 400), 'no row is cut in half');
    const blob = { 'blob.read': async () => ({ text: 'z'.repeat(READ_MAX * 2) }) };
    const b: any = await readOne(f.env, 'blob.read', f.ctx(), blob);
    assert.deepEqual([b.incomplete, b.reason, b.data], [true, 'too_large', null]);
    assert.equal(typeof b.data, 'object', 'never a substring of the JSON');
  } finally { f.close(); }
});

test('an unknown count is unavailable, not zero, and the preflight says so', async () => {
  const f = fixture();
  try {
    f.add(1, 'build', 3);
    const real = f.env.DB.prepare.bind(f.env.DB);
    f.env.DB = { ...f.env.DB, prepare: (sql: string) => { if (/COUNT\(\*\)/.test(sql)) throw new Error('synthetic count failure'); return real(sql); } };
    const r: any = await readOne(f.env, 'build.records', f.ctx());
    assert.deepEqual(r.data.coverage, { returned: 3, total: null, omitted: null, complete: false });
    const p = await preflight(f.env, 'monthly-investor-update', f.ctx(), READERS, NOW);
    const build = p!.inputs.find((i) => i.read === 'build.records')!;
    assert.deepEqual([build.status, build.note], ['partial', 'How many records exist could not be counted.']);
  } finally { f.close(); }
});

test('empty-but-complete, missing, unavailable, unreadable, stale and partial are different answers', async () => {
  const f = fixture();
  try {
    const status = async (readers: any, ctx = f.ctx(), slug = 'monthly-investor-update', read = 'build.records') =>
      (await preflight(f.env, slug, ctx, readers, NOW))!.inputs.find((i) => i.read === read)!.status;
    assert.equal(await status(READERS), 'empty', 'complete and empty: nothing recorded');
    assert.equal(await status({ ...READERS, 'build.records': async () => null }), 'absent_optional', 'no such record, and the skill can do without');
    const { 'build.records': _gone, ...without } = READERS;
    assert.equal(await status(without), 'unavailable_reader');
    assert.equal(await status({ ...READERS, 'build.records': async () => { throw new Error('boom'); } }), 'unreadable');
    f.add(1, 'build', 3, 'old', '2026-01-01 10:00:00');
    assert.equal(await status(READERS), 'stale', `newest record older than ${STALE_DAYS} days`);
    f.add(1, 'build', 21, 'fresh', '2026-11-05 10:00:00');
    assert.equal(await status(READERS), 'partial', 'more records than were supplied');
    assert.equal(await status(READERS, f.ctx(null)), 'partial', 'no project: the count is unavailable, not 0');
  } finally { f.close(); }
});

test('the ten skills: an input matrix, and a preflight through the actual readers for complete and for missing evidence', async () => {
  const f = fixture();
  try {
    assert.deepEqual(FIRST_TEN_SLUGS, ['cash-runway-snapshot', 'board-meeting-brief', 'monthly-investor-update', 'lp-quarterly-letter-draft', 'contract-clause-extraction',
      'contract-risk-issue-spotting', 'safe-convertible-instrument-review', 'legal-due-diligence-coordination', 'pipeline-health-diagnostics', 'customer-interview-summary']);
    const matrix = inputMatrix();
    assert.equal(matrix.length, 10);
    assert.ok(matrix.every((m) => m.inputs.length > 0 && m.paths), 'every skill names its inputs and its paths');
    assert.equal(pathsFor('no-such-skill'), null);
    // The records the supplied readers can give: every cycle has recent activity, the project exists.
    for (const cycle of ['validate', 'build', 'raise', 'grow']) f.add(1, cycle, 4, 'Recorded activity', '2026-11-03 10:00:00');
    const results: Record<string, any> = {};
    for (const slug of FIRST_TEN_SLUGS) {
      const full = (await preflight(f.env, slug, f.ctx(), READERS, NOW))!;
      const none = (await preflight(f.env, slug, f.ctx(null), READERS, NOW))!;
      results[slug] = { full: full.state, none: none.state };
      assert.notEqual(full.state, 'ready', `${slug}: the built readers do not carry its typed evidence, so it is not ready`);
      assert.equal(none.state, 'not_ready', `${slug}: with no project it cannot run`);
      assert.ok(full.limits.length > 0, `${slug}: what is missing is named`);
      const carried = ['cash-runway-snapshot', 'board-meeting-brief', 'monthly-investor-update', 'legal-due-diligence-coordination', 'pipeline-health-diagnostics', 'customer-interview-summary'].includes(slug);
      assert.equal(full.paths.default_context, carried ? 'supported' : 'unsupported', `${slug}: which paths can supply its required evidence`);
      assert.equal(full.paths.manual, 'approved_tool_reads_not_exercised_here');
    }
    // Balances and burn have typed readers now (agent_typed_readers_4667); this fixture's agent has no sponsor, so both
    // are withheld. The board KPI reader also requires a venture sponsor.
    const cash = (await preflight(f.env, 'cash-runway-snapshot', f.ctx(), READERS, NOW))!;
    assert.deepEqual(cash.inputs.map((i) => [i.read, i.status]), [['mercury.balances', 'withheld'], ['grow.burn', 'withheld']]);
    const board = (await preflight(f.env, 'board-meeting-brief', f.ctx(), READERS, NOW))!;
    assert.equal(board.inputs.find((i) => i.read === 'grow.board_metrics')!.status, 'withheld');
    const interview = (await preflight(f.env, 'customer-interview-summary', f.ctx(), READERS, NOW))!;
    assert.equal(interview.state, 'not_ready', 'a transcript the sponsor may not read leaves nothing to summarise');
    const risk = (await preflight(f.env, 'contract-risk-issue-spotting', f.ctx(), READERS, NOW))!;
    assert.ok(risk.inputs.find((i) => i.read === 'manual:review_policy')!.note!.includes('A person supplies this'));
    // The gate is not hard-wired shut: readers that DECLARE typed records, answering fresh and complete, make it ready.
    const typed: any = { ...READERS };
    for (const read of ['mercury.balances', 'grow.burn']) typed[read] = async () => ({ records: [{ ref: 'x', at: '2026-11-05 10:00:00' }], coverage: coverageOf(1, 1) });
    const provides = { ...READER_PROVIDES, 'mercury.balances': 'typed_record', 'grow.burn': 'typed_record' };
    const ready = (await preflight(f.env, 'cash-runway-snapshot', f.ctx(), typed, NOW, provides))!;
    assert.deepEqual([ready.state, ready.limits], ['ready', []]);
    const lies = (await preflight(f.env, 'cash-runway-snapshot', f.ctx(), typed, NOW, { ...provides, 'grow.burn': 'activity_summaries' } as any))!;
    assert.equal(lies.state, 'not_ready', 'a reader that does not declare the shape cannot make a skill ready by answering');
  } finally { f.close(); }
});
