/**
 * D4559 (#4559) — platform capacity on HQ · Platform. The rules held here:
 *
 *   1. A metric that could not be read is `unavailable` with `value: null`
 *      and level `unknown`, distinct from a measured zero, and the overall
 *      level never reads `ok` while one is unknown (an outage is not health).
 *   2. D1 size is bytes from D1's own metadata, divided by a limit in bytes:
 *      no mixed units. Thresholds hold at their boundaries and hysteresis
 *      keeps a raised level until the value falls clear of it.
 *   3. Queue oldest-message age is computed from the binding's timestamp;
 *      an empty queue is "none waiting", and clock skew is unavailable.
 *   4. The payload names no member, company, tenant, secret or SQL.
 *   5. The route is Super Admin only and reads nothing but bindings.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/platform_capacity_d4559.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  GB, D1_LIMIT_BYTES_DEFAULT, D1_WARN_BYTES_DEFAULT, D1_CRIT_BYTES_DEFAULT, D1_HYSTERESIS_BYTES,
  QUEUE_AGE_WARN_S, levelFor, overallLevel, d1Policy, readD1Size, readQueue, readPlatformCapacity,
} from '../src/services/platformCapacity.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const NOW = new Date('2026-11-06T12:00:00Z');

function d1(sizeAfter: unknown, opts: { throws?: boolean; hang?: boolean } = {}) {
  return {
    prepare: (sql: string) => ({
      run: async () => {
        assert.equal(sql, 'SELECT 1');
        if (opts.throws) throw new Error('D1_ERROR: secret detail');
        if (opts.hang) return new Promise(() => {});
        return { meta: { size_after: sizeAfter } };
      },
    }),
  };
}
const queue = (m: unknown, throws = false) => ({ metrics: async () => { if (throws) throw new Error('nope'); return m; }, send: async () => {} });

const T = { warning: 5, critical: 8, hysteresis: 1, basis: '' };

test('levelFor: boundaries are inclusive and null is unknown, never ok', () => {
  assert.equal(levelFor(null, T), 'unknown');
  assert.equal(levelFor(NaN, T), 'unknown');
  assert.equal(levelFor(0, T), 'ok');
  assert.equal(levelFor(4.999, T), 'ok');
  assert.equal(levelFor(5, T), 'warning');
  assert.equal(levelFor(7.999, T), 'warning');
  assert.equal(levelFor(8, T), 'critical');
});

test('levelFor: hysteresis holds a raised level until the value clears it, then recovers', () => {
  assert.equal(levelFor(7.5, T, 'critical'), 'critical');
  assert.equal(levelFor(6.99, T, 'critical'), 'warning');
  assert.equal(levelFor(4.5, T, 'warning'), 'warning');
  assert.equal(levelFor(4.5, T, 'critical'), 'warning');
  assert.equal(levelFor(3.99, T, 'warning'), 'ok');
  // With no previous level, plain thresholds: no hold invented.
  assert.equal(levelFor(4.5, T), 'ok');
});

test('overallLevel: worst wins, and unknown keeps the whole from reading ok', () => {
  assert.equal(overallLevel(['ok', 'ok']), 'ok');
  assert.equal(overallLevel(['ok', 'unknown']), 'unknown');
  assert.equal(overallLevel(['unknown', 'warning']), 'warning');
  assert.equal(overallLevel(['warning', 'critical']), 'critical');
  assert.equal(overallLevel([]), 'unknown');
});

test('d1Policy: defaults are 10 / 5 / 7.5 decimal GB, overrides must be whole bytes in order', () => {
  const p = d1Policy({});
  assert.deepEqual([p.limit, p.warning, p.critical], [10 * GB, 5 * GB, 7.5 * GB]);
  assert.equal(p.limit_basis, 'default');
  assert.match(String(p.note), /unconfirmed/);
  const o = d1Policy({ PLATFORM_D1_LIMIT_BYTES: '5000000000', PLATFORM_D1_WARN_BYTES: '2000000000', PLATFORM_D1_CRIT_BYTES: '4000000000' } as any);
  assert.deepEqual([o.limit, o.warning, o.critical, o.limit_basis], [5 * GB, 2 * GB, 4 * GB, 'override']);
  for (const bad of [{ PLATFORM_D1_WARN_BYTES: '9000000000' }, { PLATFORM_D1_CRIT_BYTES: '11000000000' }, { PLATFORM_D1_LIMIT_BYTES: '-1', PLATFORM_D1_CRIT_BYTES: '1' }]) {
    const b = d1Policy(bad as any);
    assert.deepEqual([b.limit, b.warning, b.critical], [D1_LIMIT_BYTES_DEFAULT, D1_WARN_BYTES_DEFAULT, D1_CRIT_BYTES_DEFAULT], JSON.stringify(bad));
  }
  // A non-numeric override is not a number of bytes and is not used.
  assert.equal(d1Policy({ PLATFORM_D1_LIMIT_BYTES: '10GB' } as any).limit, D1_LIMIT_BYTES_DEFAULT);
});

test('D1 size: bytes from size_after, ratio is bytes over bytes, levels at the policy sizes', async () => {
  const at = async (bytes: number) => (await readD1Size({ DB: d1(bytes) } as any)).size;
  const r = await readD1Size({ DB: d1(323_485_696) } as any);
  assert.equal(r.size.value, 323_485_696);
  assert.equal(r.size.unit, 'bytes');
  assert.equal(r.size.availability, 'measured');
  assert.equal(r.size.level, 'ok');
  assert.equal(r.used.unit, 'ratio');
  assert.equal(r.used.value, 323_485_696 / (10 * GB));
  assert.equal((await at(5 * GB - 1)).level, 'ok');
  assert.equal((await at(5 * GB)).level, 'warning');
  assert.equal((await at(7.5 * GB)).level, 'critical');
  assert.ok(D1_HYSTERESIS_BYTES > 0 && D1_HYSTERESIS_BYTES < GB);
});

test('D1 size: missing, zero-less, failing and hanging sources are unavailable, not zero', async () => {
  const cases: Array<[string, any, RegExp]> = [
    ['no binding', {}, /not present/],
    ['no size', { DB: d1(undefined) }, /without a database size/],
    ['size 0 is not a database size', { DB: d1(0) }, /without a database size/],
    ['string size', { DB: d1('300') }, /without a database size/],
    ['throws', { DB: d1(1, { throws: true }) }, /could not be read/],
    ['hangs', { DB: d1(1, { hang: true }) }, /did not answer in time/],
  ];
  for (const [name, env, reason] of cases) {
    const r = await readD1Size(env, 20);
    assert.equal(r.size.value, null, name);
    assert.equal(r.size.availability, 'unavailable', name);
    assert.equal(r.size.level, 'unknown', name);
    assert.match(String(r.size.reason), reason, name);
    assert.equal(r.used.value, null, name);
    assert.doesNotMatch(String(r.size.reason), /secret detail/, `${name}: a raw error never leaves`);
  }
});

test('queue: backlog and oldest age match the binding fixture, with levels on age', async () => {
  const oldest = new Date(NOW.getTime() - (QUEUE_AGE_WARN_S + 30) * 1000);
  const [count, bytes, age] = await readQueue({ JOB_QUEUE: queue({ backlogCount: 42, backlogBytes: 8192, oldestMessageTimestamp: oldest }) } as any, 'JOB_QUEUE', NOW);
  assert.deepEqual([count.key, count.value, count.unit], ['queue.job.backlog_messages', 42, 'messages']);
  assert.deepEqual([bytes.value, bytes.unit], [8192, 'bytes']);
  assert.deepEqual([age.key, age.value, age.unit, age.level], ['queue.job.oldest_age_seconds', QUEUE_AGE_WARN_S + 30, 'seconds', 'warning']);
});

test('queue: an empty queue is none waiting; skew, outage and absence are unavailable', async () => {
  const empty = await readQueue({ AGENT_QUEUE: queue({ backlogCount: 0, backlogBytes: 0 }) } as any, 'AGENT_QUEUE', NOW);
  assert.equal(empty[0].value, 0);
  assert.equal(empty[0].availability, 'measured');
  assert.equal(empty[2].availability, 'none_waiting');
  assert.equal(empty[2].value, null);
  assert.equal(empty[2].level, 'ok');

  const backlogNoTime = await readQueue({ AGENT_QUEUE: queue({ backlogCount: 3, backlogBytes: 10 }) } as any, 'AGENT_QUEUE', NOW);
  assert.equal(backlogNoTime[2].availability, 'unavailable');

  const skew = await readQueue({ JOB_QUEUE: queue({ backlogCount: 1, backlogBytes: 1, oldestMessageTimestamp: new Date(NOW.getTime() + 60_000) }) } as any, 'JOB_QUEUE', NOW);
  assert.equal(skew[2].availability, 'unavailable');
  assert.match(String(skew[2].reason), /ahead of this Worker's clock/);

  for (const env of [{}, { JOB_QUEUE: { send: async () => {} } }, { JOB_QUEUE: queue(null, true) }, { JOB_QUEUE: queue({}) }]) {
    const ms = await readQueue(env as any, 'JOB_QUEUE', NOW);
    for (const m of ms) {
      assert.equal(m.value, null);
      assert.equal(m.level, 'unknown');
      assert.equal(m.availability, 'unavailable');
    }
  }
});

test('the whole read: a dead source keeps the overall level from ok, and nothing private leaves', async () => {
  const healthy = await readPlatformCapacity({
    DB: d1(300_000_000),
    JOB_QUEUE: queue({ backlogCount: 0, backlogBytes: 0 }),
    AGENT_QUEUE: queue({ backlogCount: 0, backlogBytes: 0 }),
  } as any, NOW);
  assert.equal(healthy.level, 'ok');
  assert.equal(healthy.observed_at, NOW.toISOString());
  assert.equal(healthy.scope, 'hq');
  assert.ok(healthy.bindings.some((b) => b.name === 'DB' && b.present));
  assert.ok(healthy.bindings.some((b) => b.name === 'FILES' && !b.present));

  const outage = await readPlatformCapacity({ DB: d1(1, { throws: true }), JOB_QUEUE: queue({ backlogCount: 0, backlogBytes: 0 }), AGENT_QUEUE: queue({ backlogCount: 0, backlogBytes: 0 }) } as any, NOW);
  assert.equal(outage.level, 'unknown');

  // The figures and their reasons: no address, id, SQL or credential word.
  const text = JSON.stringify([healthy.metrics, outage.metrics]);
  for (const forbidden of [/@/, /user_id|company_id|tenant_id|email/i, /SELECT/, /token|secret|password/i]) {
    assert.doesNotMatch(text, forbidden);
  }
  // The binding list is names and kinds only, never a resource id.
  for (const b of healthy.bindings) assert.deepEqual(Object.keys(b).sort(), ['kind', 'name', 'present']);
  for (const m of healthy.metrics) assert.equal(m.scope, 'deployment');
});

test('the route is Super Admin only, no-store, and the service calls no network', () => {
  const route = readFileSync(join(ROOT, 'cloudflare-worker/src/routes/admin_platform.ts'), 'utf8');
  const block = route.slice(route.indexOf("r.get('/capacity'"));
  assert.match(block, /await requireSuperAdmin\(c\)/);
  assert.match(block, /private, no-store/);
  const svc = readFileSync(join(ROOT, 'cloudflare-worker/src/services/platformCapacity.ts'), 'utf8');
  assert.doesNotMatch(svc, /fetch\(|api\.cloudflare\.com|CLOUDFLARE_[A-Z_]*TOKEN/);
});
