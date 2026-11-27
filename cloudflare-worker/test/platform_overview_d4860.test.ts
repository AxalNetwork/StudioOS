/**
 * D4860 (#4860) — what HQ · Platform v2's overview needs from the Worker.
 *
 *   1. The Stripe webhook's newest success, newest failure and the failures
 *      after the newest success, so the overview can say whether the webhook
 *      is PROVEN healthy rather than reading "0 not 2xx" as health.
 *   2. `GET /api/admin/platform-build`: the commit and environment this
 *      Worker carries, Super Admin only, and never a deploy time it cannot
 *      read.
 *
 * The webhook reader runs on real SQLite with the baseline's own
 * `activity_logs` DDL, as payments_change_log_d1011 does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  STRIPE_WEBHOOK_PATH, CONSECUTIVE_FAILURE_CAP, readWebhookDeliveries,
} from '../src/services/stripeWebhookDeliveries.ts';
import buildRoutes, { platformBuild, DEPLOYED_AT_REASON, mount } from '../src/routes/admin_platform_build.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
      };
      return api;
    },
  };
}
function logDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(ddl('activity_logs'));
  const ins = db.prepare('INSERT INTO activity_logs (action, endpoint, status_code, latency_ms, created_at) VALUES (?, ?, ?, ?, ?)');
  return { db, add: (code: number | null, at: string, endpoint = STRIPE_WEBHOOK_PATH) => ins.run('http_post', endpoint, code, 20, at) };
}
const NOW = new Date('2026-11-07T14:22:00Z');
const readW = async (db: InstanceType<typeof DatabaseSync>) => (await readWebhookDeliveries({ DB: makeD1(db) } as any, NOW)) as any;

test('the newest success, the newest failure, and the failures after the newest success', async () => {
  const { db, add } = logDb();
  add(404, '2026-10-14 03:12:00');
  add(200, '2026-11-02 22:31:00');
  add(500, '2026-11-07 13:50:00');
  add(null, '2026-11-07 13:55:00'); // no status: neither a success nor a failure
  add(500, '2026-11-07 14:00:00');
  add(200, '2026-11-07 14:01:00', '/api/projects'); // another endpoint never counts
  const w = await readW(db);
  assert.equal(w.available, true);
  assert.deepEqual(w.last_success, { status_code: 200, at: '2026-11-02 22:31:00' });
  assert.deepEqual(w.last_failure, { status_code: 500, at: '2026-11-07 14:00:00' });
  assert.equal(w.consecutive_failures, 2);
  assert.equal(w.consecutive_failures_capped, false);
});

test('a webhook whose newest delivery succeeded has no failure run, and its old failure is still named', async () => {
  const { db, add } = logDb();
  add(404, '2026-10-14 03:12:00');
  add(200, '2026-11-02 22:31:00');
  const w = await readW(db);
  assert.equal(w.consecutive_failures, 0);
  assert.deepEqual(w.last_failure, { status_code: 404, at: '2026-10-14 03:12:00' });
  // Silence: nothing in 24 h, and still no failure. The reader says both, and
  // the overview (not this reader) decides that is Stale.
  assert.equal(w.deliveries, 0);
  assert.equal(w.not_2xx, 0);
});

test('a webhook that never succeeded counts every failure, and an empty log has neither stamp', async () => {
  const { db, add } = logDb();
  add(500, '2026-11-07 12:00:00');
  add(503, '2026-11-07 12:30:00');
  add(500, '2026-11-07 13:00:00');
  const w = await readW(db);
  assert.equal(w.last_success, null);
  assert.equal(w.consecutive_failures, 3);
  const empty = await readW(logDb().db);
  assert.equal(empty.last_success, null);
  assert.equal(empty.last_failure, null);
  assert.equal(empty.consecutive_failures, 0);
});

test('the failure run is bounded, and says so when it reaches the cap', async () => {
  const { db, add } = logDb();
  db.exec('BEGIN');
  for (let i = 0; i < CONSECUTIVE_FAILURE_CAP + 5; i++) add(500, '2026-11-07 12:00:00');
  db.exec('COMMIT');
  const w = await readW(db);
  assert.equal(w.consecutive_failures, CONSECUTIVE_FAILURE_CAP);
  assert.equal(w.consecutive_failures_capped, true);
});

test('an unreadable log is unreadable, never a run of zero', async () => {
  const w = (await readWebhookDeliveries({ DB: makeD1(new DatabaseSync(':memory:')) } as any, NOW)) as any;
  assert.equal(w.available, false);
  assert.equal(w.consecutive_failures, undefined);
});

test('the build route says the commit the deploy stamped, and nothing it was not given', () => {
  const sha = '8f3a2c1d4e5f60718293a4b5c6d7e8f901234567';
  const b = platformBuild({ WORKER_DEPLOY_VERSION: sha, ENVIRONMENT: 'production' } as any);
  assert.equal(b.commit, sha);
  assert.equal(b.environment, 'production');
  assert.equal(b.deployed_at, null);
  assert.equal(b.deployed_at_reason, DEPLOYED_AT_REASON);
  const bare = platformBuild({ WORKER_DEPLOY_VERSION: '', ENVIRONMENT: undefined } as any);
  assert.equal(bare.commit, null);
  assert.match(bare.commit_basis, /not recorded/);
  assert.equal(bare.environment, null);
  // Only a commit is echoed: anything else in the var is not.
  assert.equal(platformBuild({ WORKER_DEPLOY_VERSION: '<script>', ENVIRONMENT: 'x y' } as any).commit, null);
  assert.equal(platformBuild({ WORKER_DEPLOY_VERSION: '<script>', ENVIRONMENT: 'x y' } as any).environment, null);
});

test('the build route mounts itself and is Super Admin only', async () => {
  assert.equal(mount.path, '/api/admin/platform-build');
  assert.match(read('cloudflare-worker/src/routes/_registry.ts'), /import \{ mount as admin_platform_buildMount \} from '\.\/admin_platform_build';/);
  const src = read('cloudflare-worker/src/routes/admin_platform_build.ts');
  assert.match(src, /r\.get\('\/', async \(c\) => \{\n  await requireSuperAdmin\(c\);/);
  // Unauthenticated: the guard throws before any answer.
  const res = await buildRoutes.request('/', {}, { WORKER_DEPLOY_VERSION: 'abcdef1', ENVIRONMENT: 'production', DB: makeD1(new DatabaseSync(':memory:')) } as any);
  assert.notEqual(res.status, 200);
});

test('the frontend method has its mounted route', () => {
  const mod = read('frontend/src/lib/api/platformBuild.js');
  assert.match(mod, /request\('\/admin\/platform-build'\)/);
  assert.match(read('frontend/src/lib/apiModules.generated.js'), /export \* from '\.\/api\/platformBuild\.js';/);
});
