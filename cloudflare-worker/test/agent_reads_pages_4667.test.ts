/**
 * D4667 (#4667, second slice): continuation, periods and manually supplied evidence, through the real readers.
 * Synthetic records on the real migrated schema; nothing is read from a connector and no model runs.
 *
 *   · a page names the row the next one starts after; following it reads every row once, and only the walk that
 *     reached the end calls itself complete;
 *   · a period bounds both the rows and the count, so a period's total is never the whole history's;
 *   · a cursor from another project, another cycle or outside the period is refused, never widened;
 *   · a person's evidence meets a `manual:` input when it is well formed, and is refused, with the reason, when it
 *     is not; standing in for a record the platform could read, it leaves the brief conditional and says so.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { READERS, ReadPageError, readPages, type ReadContext } from '../src/services/agents/reads.ts';
import { preflight, suppliedProblem, SUPPLIED_TEXT_MAX } from '../src/services/agents/skillInputs.ts';

after(removeMigratedDatabases);
const NOW = Date.parse('2026-11-07T12:00:00Z');

function fixture() {
  const db = migratedDatabase();
  db.exec("INSERT INTO users(id, role, name, email, is_active) VALUES (2, 'founder', 'Synthetic Founder', 'synthetic-2@example.invalid', 1)");
  db.exec("INSERT INTO projects(id, name, founder_id, stage) VALUES (1, 'Synthetic venture', 2, 'seed'), (2, 'Other venture', 2, 'seed')");
  const env: any = { DB: d1Over(db) };
  const ctx = (page?: ReadContext['page'], projectId = 1): ReadContext => ({ scope: { kind: 'project', id: projectId, name: 'Synthetic venture', founder_id: 2, company_id: null } as any, agent: {} as any, projectId, page });
  const log = db.prepare("INSERT INTO activity_logs(project_id, user_id, action, details, entity_type, created_at) VALUES (?, 2, 'created', ?, ?, ?)");
  const add = (project: number, cycle: string, n: number, at: string) => { for (let i = 0; i < n; i += 1) log.run(project, `Synthetic ${cycle} ${at} ${i}`, `${cycle}.interviews`, at); };
  return { db, env, ctx, add, close: () => db.close() };
}

test('a page names where the next starts; following it reads all 45 rows once, and only the full walk is complete', async () => {
  const f = fixture();
  try {
    f.add(1, 'grow', 45, '2026-10-15 10:00:00');
    const first: any = await READERS['grow.records']!(f.env, f.ctx());
    assert.equal(first.records.length, 20);
    assert.deepEqual(first.coverage, { returned: 20, total: 45, omitted: 25, complete: false });
    assert.equal(first.page.next, first.records[19].ref, 'the next page starts after the last row of this one');
    const second: any = await READERS['grow.records']!(f.env, f.ctx({ after: first.page.next }));
    assert.equal(second.records.length, 20);
    assert.equal(new Set([...first.records, ...second.records].map((r: any) => r.ref)).size, 40, 'no row twice');
    const all: any = await readPages(f.env, 'grow.records', f.ctx());
    assert.equal(all.records.length, 45);
    assert.equal(new Set(all.records.map((r: any) => r.ref)).size, 45);
    assert.deepEqual([all.pages, all.next, all.coverage], [3, null, { returned: 45, total: 45, omitted: 0, complete: true }]);
    const cut: any = await readPages(f.env, 'grow.records', f.ctx(), { maxPages: 2 });
    assert.equal(cut.records.length, 40);
    assert.equal(cut.coverage.complete, false, 'a walk stopped by its bound is not complete');
    assert.ok(cut.next, 'and it says where to go on');
  } finally { f.close(); }
});

test('a period bounds the rows and the count: October\'s total is October\'s, never the whole history\'s', async () => {
  const f = fixture();
  try {
    f.add(1, 'grow', 3, '2026-09-30 23:00:00');
    f.add(1, 'grow', 4, '2026-10-01 00:00:01');
    f.add(1, 'grow', 2, '2026-10-31 23:59:00');
    f.add(1, 'grow', 5, '2026-11-01 08:00:00');
    const oct: any = await readPages(f.env, 'grow.records', f.ctx({ from: '2026-10-01', to: '2026-10-31' }));
    assert.deepEqual(oct.coverage, { returned: 6, total: 6, omitted: 0, complete: true });
    assert.deepEqual(oct.period, { from: '2026-10-01', to: '2026-10-31' });
    assert.ok(oct.records.every((r: any) => r.at >= '2026-10-01' && r.at < '2026-11-01'));
    for (const bad of [{ from: '2026-10' }, { to: '31/10/2026' }, { from: '2026-11-01', to: '2026-10-01' }, { from: "2026-10-01' OR 1=1" }]) {
      await assert.rejects(READERS['grow.records']!(f.env, f.ctx(bad as any)), (e: any) => e instanceof ReadPageError && e.code === 'invalid_page', JSON.stringify(bad));
    }
  } finally { f.close(); }
});

test('a cursor from another project, another cycle or outside the period is refused, never widened to the history', async () => {
  const f = fixture();
  try {
    f.add(1, 'grow', 25, '2026-10-15 10:00:00');
    f.add(1, 'build', 25, '2026-10-15 10:00:00');
    f.add(2, 'grow', 25, '2026-10-15 10:00:00');
    const mine: any = await READERS['grow.records']!(f.env, f.ctx());
    const other: any = await READERS['grow.records']!(f.env, f.ctx(undefined, 2));
    const build: any = await READERS['build.records']!(f.env, f.ctx());
    const refused = (e: any) => e instanceof ReadPageError && e.code === 'unknown_cursor';
    await assert.rejects(READERS['grow.records']!(f.env, f.ctx({ after: other.page.next })), refused, 'another project\'s row');
    await assert.rejects(READERS['grow.records']!(f.env, f.ctx({ after: build.page.next })), refused, 'another cycle\'s row');
    await assert.rejects(READERS['grow.records']!(f.env, f.ctx({ after: mine.page.next, from: '2026-11-01' })), refused, 'a row outside the period');
    await assert.rejects(READERS['grow.records']!(f.env, f.ctx({ after: 'activity:1' })), (e: any) => e instanceof ReadPageError && e.code === 'invalid_page');
  } finally { f.close(); }
});

test('manual evidence: a well-formed record meets a manual input; a bad one is refused with its reason; standing in for a record it is conditional', async () => {
  const f = fixture();
  try {
    assert.equal(suppliedProblem({ ref: 'manual:policy-2026', recorded_at: '2026-11-01', text: 'Synthetic review policy.' }, NOW), null);
    assert.match(suppliedProblem({ ref: 'policy', recorded_at: '2026-11-01', text: 'x' }, NOW)!, /reference/);
    assert.match(suppliedProblem({ ref: 'manual:p', recorded_at: '', text: 'x' }, NOW)!, /recorded date/);
    assert.match(suppliedProblem({ ref: 'manual:p', recorded_at: '2027-01-01', text: 'x' }, NOW)!, /future/);
    assert.match(suppliedProblem({ ref: 'manual:p', recorded_at: '2026-11-01', text: '  ' }, NOW)!, /empty/);
    assert.match(suppliedProblem({ ref: 'manual:p', recorded_at: '2026-11-01', text: 'x'.repeat(SUPPLIED_TEXT_MAX + 1) }, NOW)!, /longer/);

    const policy = { ref: 'manual:policy-2026', recorded_at: '2026-11-01', text: 'Synthetic review policy.' };
    const risk = await preflight(f.env, 'contract-risk-issue-spotting', f.ctx(), undefined, NOW, undefined, { 'manual:review_policy': policy });
    const p = risk!.inputs.find((i) => i.read === 'manual:review_policy')!;
    assert.deepEqual([p.status, p.source, p.ref], ['available', 'manual', 'manual:policy-2026']);
    const none = await preflight(f.env, 'contract-risk-issue-spotting', f.ctx(), undefined, NOW);
    assert.equal(none!.inputs.find((i) => i.read === 'manual:review_policy')!.status, 'missing');
    const bad = await preflight(f.env, 'contract-risk-issue-spotting', f.ctx(), undefined, NOW, undefined, { 'manual:review_policy': { ...policy, recorded_at: 'soon' } });
    const b = bad!.inputs.find((i) => i.read === 'manual:review_policy')!;
    assert.deepEqual([b.status, b.reason], ['missing', 'supplied_invalid']);
    assert.match(b.note!, /recorded date/);

    // A person's record where the platform has a reader for the input but nothing in it: partial, and the brief says so.
    const pipe = await preflight(f.env, 'customer-interview-summary', f.ctx(), { 'validate.transcripts': async () => null } as any, NOW, { 'validate.transcripts': 'typed_record' } as any,
      { 'validate.transcripts': { ref: 'manual:call-notes', recorded_at: '2026-11-02', text: 'Synthetic notes.' } });
    const t = pipe!.inputs[0];
    assert.deepEqual([t.status, t.reason, t.source], ['partial', 'manual', 'manual']);
    assert.equal(pipe!.state, 'conditional');
    assert.ok(pipe!.limits.some((l) => l.includes('Supplied by a person')), 'the brief names where the figure came from');
  } finally { f.close(); }
});
