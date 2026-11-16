import test from 'node:test';
import assert from 'node:assert/strict';
import { readDailyReservations, reservationName } from '../../scripts/landing-bot/feeder-budget.mjs';

const day = '2026-11-15';
const now = day + 'T12:00:00Z';
const base = { day, now, runId: 2, attempt: 1 };
const run = (id, override = {}) => ({
  id, run_attempt: 1, path: '.github/workflows/landing-feeder.yml@main', head_branch: 'main',
  event: 'schedule', status: 'completed', conclusion: 'success', created_at: now, ...override,
});
const artifact = (runId, attempt, slots) => ({
  id: runId * 100 + attempt, name: reservationName({ day, runId, attempt, slots }), expired: false,
});
const job = (state, override = {}) => ({
  id: 9, name: 'Feed the merge queue', run_attempt: 1, status: 'completed', conclusion: 'success',
  steps: [{ name: 'Reserve daily queue slots', conclusion: state }], ...override,
});

function reader({ runs = [run(1), run(2)], artifacts = {}, jobs = {}, bulk = [], corrupt = () => {}, paths = [] } = {}) {
  return async path => {
    assert.ok(!path.startsWith('/'));
    paths.push(path);
    const url = new URL(path, 'https://example.com');
    const p = url.searchParams;
    assert.equal(p.get('per_page'), '100');
    let key, rows;
    if (url.pathname === '/actions/workflows/landing-feeder.yml/runs') {
      assert.equal(p.get('branch'), 'main');
      assert.equal(p.get('created'), day + 'T00:00:00Z..' + day + 'T23:59:59Z');
      key = 'workflow_runs'; rows = runs;
    } else if (url.pathname === '/actions/artifacts') {
      key = 'artifacts'; rows = bulk;
    } else {
      const found = /^\/actions\/runs\/(\d+)\/(?:attempts\/(\d+)\/)?(artifacts|jobs)$/.exec(url.pathname);
      assert.ok(found, path);
      key = found[3];
      rows = (key === 'artifacts' ? artifacts : jobs)[found[1]] ?? [];
      if (key === 'jobs') rows = rows.filter(job => job.run_attempt === Number(found[2]));
    }
    const start = (Number(p.get('page')) - 1) * 100;
    const result = { total_count: rows.length, [key]: rows.slice(start, start + 100) };
    corrupt(key, result, start);
    return result;
  };
}

test('counts every reservation including failed runs and earlier attempts; ignores other workflows and refs', async () => {
  const runs = [run(1, { run_attempt: 2, conclusion: 'failure' }), run(2), run(3, { head_branch: 'topic' }),
    run(4, { event: 'pull_request' }), run(5, { path: '.github/workflows/other.yml' })];
  const get = reader({ runs, artifacts: { 1: [artifact(1, 1, 2), artifact(1, 2, 3)], 3: [artifact(3, 1, 5)] } });
  assert.deepEqual(await readDailyReservations({ ...base, get }), { used: 5, availableForCurrentRun: 0 });
});

test('a write requires its own exact reservation; overlapping attempts cannot spend twice', async () => {
  const get = reader({ artifacts: { 2: [artifact(2, 1, 3)] }, jobs: { 1: [job('skipped')] } });
  assert.deepEqual(await readDailyReservations({ ...base, get, expectedSlots: 3 }), { used: 3, availableForCurrentRun: 3 });
  await assert.rejects(readDailyReservations({ ...base, get, expectedSlots: 2 }), /does not match/);
  await assert.rejects(readDailyReservations({ ...base, get }), /does not match/);
  await assert.rejects(readDailyReservations({ ...base, get, attempt: 2 }), /rerun/);
});

test('a day of sweeps charges only its own workflow artifacts in bulk, including zero-slot receipts', async () => {
  const paths = [];
  const runs = Array.from({ length: 104 }, (_, index) => run(index + 1));
  const bulk = runs.map(r => ({ ...artifact(r.id, 1, r.id === 2 ? 2 : 0), workflow_run: { id: r.id } }));
  bulk.push({ ...artifact(155, 1, 300), workflow_run: { id: 155 } });
  const get = reader({ runs, bulk, paths });
  assert.deepEqual(await readDailyReservations({ ...base, get, expectedSlots: 2 }), { used: 2, availableForCurrentRun: 2 });
  assert.equal(paths.length, 4);
  assert.ok(paths.every(path => !path.includes('/attempts/')));
});

test('detects disappeared reservations, missing attempts, and malformed names instead of refunding capacity', async () => {
  for (const data of [
    { jobs: { 1: [job('success')] } },
    { jobs: { 1: [] } },
    { runs: [run(1, { run_attempt: 2 }), run(2)], jobs: { 1: [job('skipped', { run_attempt: 2 })] } },
    { artifacts: { 1: [{ ...artifact(1, 1, 1), name: 'landing-feed-malformed' }] } },
    { artifacts: { 1: [artifact(1, 1, 1), { ...artifact(1, 1, 2), id: 999 }] } },
  ]) {
    await assert.rejects(readDailyReservations({ ...base, get: reader(data) }));
  }
});

test('refuses missing/duplicate pages or search ceiling; handles pagination and rejects a UTC rollover', async () => {
  const runs = Array.from({ length: 102 }, (_, index) => run(index + 1, { head_branch: index === 1 ? 'main' : 'topic' }));
  assert.deepEqual(await readDailyReservations({ ...base, get: reader({ runs }) }), { used: 0, availableForCurrentRun: 0 });
  for (const corrupt of [
    (key, result) => { if (key === 'workflow_runs') result.total_count = 1000; },
    (key, result, start) => { if (key === 'workflow_runs' && start) result.workflow_runs[0] = runs[0]; },
    (key, result, start) => { if (key === 'workflow_runs' && start) result.total_count--; },
    (key, result, start) => { if (key === 'workflow_runs' && !start) result.workflow_runs.pop(); },
  ]) {
    await assert.rejects(readDailyReservations({ ...base, get: reader({ runs, corrupt }) }));
  }
  let timeReads = 0;
  const get = reader({ runs: [run(2)] });
  await assert.rejects(readDailyReservations({ ...base, get, now: () => (++timeReads === 1 ? now : '2026-11-16') }), /UTC day/);
  await assert.rejects(readDailyReservations({ ...base, get: reader({ runs: [run(2, { created_at: '2026-11-14' })] }) }), /outside/);
  await assert.rejects(readDailyReservations({ ...base, get: reader({ runs: [] }) }), /missing/);
});
