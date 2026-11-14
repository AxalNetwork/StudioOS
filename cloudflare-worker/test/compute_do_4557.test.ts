/** D4557: real host wrapper with transactional synthetic storage and native Container control faults. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PythonComputeContainer } from '../../agent-compute/worker.ts';

function world() {
  const rows = new Map<string, unknown>([['job_uid', 'a'.repeat(32)], ['host', { state: 'running', boot_attempted: true, cleanup_required: true, deadline: 10, sponsor: { member_id: 71 } }],
    ['security', new Map([['synthetic', { revoked: false, nonces: new Map([['nonce', {}]]) }]])]]);
  let fails = false, running = true, remains = false, stops = 0, alarms = 1;
  const storage: any = { async get(key: string) { return structuredClone(rows.get(key)); }, async put(key: string, value: unknown) { rows.set(key, structuredClone(value)); },
    async delete(keys: string[]) { for (const key of keys) rows.delete(key); }, async deleteAlarm() { alarms = 0; },
    async transaction(fn: (value: unknown) => Promise<unknown>) { const prior = structuredClone(rows); try { return await fn(storage); } catch (error) { rows.clear(); for (const [k,v] of prior) rows.set(k,v); throw error; } } };
  const container = { async destroy() { stops++; if (fails) throw Error('synthetic'); if (!remains) running = false; }, async inspect() { return running ? { image: 'unverified' } : null; } };
  const host = new PythonComputeContainer({ storage, container } as any, { COMPUTE_ENABLED: 'off' } as any);
  const call = (path: string) => host.fetch(new Request('https://private' + path, { method: 'POST', body: JSON.stringify({ job_uid: 'a'.repeat(32) }) }));
  return { rows, call, host, fail: (value: boolean) => { fails = value; }, remains: () => { remains = true; }, counts: () => ({ stops, alarms }) };
}

test('teardown requires no broker, policy, secret or admission flag; unknown termination keeps its retry fence', async () => {
  const w = world(); w.fail(true);
  assert.equal((await w.call('/cancel')).status, 200);
  assert.equal((w.rows.get('host') as any).cleanup_required, true);
  const run = (w.rows.get('security') as Map<string, any>).get('synthetic');
  assert.equal(run.revoked, true); assert.equal(run.nonces.size, 0);
  w.fail(false); await w.call('/cancel');
  assert.equal((w.rows.get('host') as any).cleanup_required, false);
  assert.equal(w.counts().stops, 2);
});

test('erasure retains an opaque replay tombstone, clears scoped metadata and alarms, and refuses resurrection', async () => {
  const w = world(); w.fail(true); assert.equal((await w.call('/forget')).status, 503);
  assert.equal(w.rows.has('security'), true); assert.equal(w.rows.has('forgotten'), false);
  w.fail(false); assert.equal((await w.call('/forget')).status, 200);
  assert.equal(w.rows.has('host'), false); assert.equal(w.rows.has('security'), false); assert.equal(w.rows.get('forgotten'), true);
  assert.equal(w.counts().alarms, 0);
  assert.equal((await w.call('/dispatch')).status, 503);
  await w.host.alarm(); assert.equal(w.counts().stops, 2);
});


test('a terminal record still requires fresh native stop confirmation before erasure', async () => {
  const w = world(); const row = w.rows.get('host') as any; row.state = 'succeeded'; row.cleanup_required = false;
  w.fail(true); assert.equal((await w.call('/forget')).status, 503);
  assert.equal(w.rows.has('host'), true); assert.equal(w.rows.has('forgotten'), false);
  w.fail(false); assert.equal((await w.call('/forget')).status, 200);
  assert.equal(w.rows.has('host'), false);
});


test('a successful native destroy call with an observed survivor is still unconfirmed', async () => {
  const w = world(); w.remains();
  await w.call('/cancel');
  assert.equal((w.rows.get('host') as any).cleanup_required, true);
  assert.equal((await w.call('/forget')).status, 503);
  assert.equal(w.rows.has('forgotten'), false);
});
