/**
 * D5786 (#5786) — Platform readings scoped to one subsidiary, for HQ's scope switcher (#5757).
 *
 * Pinned, on synthetic fixtures only (codes `fr` and `de`, example.test users):
 *   - HQ-wide: `/summary` keeps its shape and carries no scope; the scoped read is a separate route;
 *   - two subsidiaries read independently: one healthy, one with a failing database, each from its own binding, its own
 *     registry row and its own traffic row; neither reading borrows the other's or HQ's;
 *   - a missing observation: a registered branch with no binding, no stored check and no traffic read is Unknown,
 *     never Healthy, and every signal says why;
 *   - traffic: its own row, a true zero when Analytics Engine answered without one, and unavailable (not zero) when the
 *     read failed or the branch fell off a full page;
 *   - refused scope: anonymous 401, plain Admin 403, `hq` and a malformed code 400, an unknown code 404, and nothing is
 *     read for a refused scope;
 *   - an HQ-wide reading never stands in: HQ's jobs, dead letters and telemetry probe are named as unavailable or
 *     HQ-only for a subsidiary and are not read;
 *   - the body carries no worker name, database name, hostname or account data.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/platform_scope_5786.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  HQ_ONLY_SIGNALS, SCOPED_SIGNALS, ScopeRefused, TRAFFIC_ROW_CAP, UNAVAILABLE_SIGNALS, judgeScope, listScopes, readScope, trafficFor,
  type ScopeReaders,
} from '../src/services/platformScope.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const NOW = new Date('2026-11-13T12:00:00Z');
const AS_OF = '2026-11-13T11:59:00.000Z';
const WINDOW = { range: { from: '2026-10-14 00:00:00', to: '2026-11-13 23:59:59' }, window_minutes: 43_200 };

/** A registry over an in-memory map: the same three columns' worth the service selects. */
function registryDb(rows: Array<Record<string, unknown>> | 'unreadable') {
  return {
    prepare(sql: string) {
      return {
        all: async () => {
          if (rows === 'unreadable') throw new Error('no such table: licence_deployments');
          assert.match(sql, /FROM licence_deployments/);
          return { results: rows };
        },
        bind() { return this; },
      };
    },
  };
}

const healthOf = (db_ok: boolean, version: string) => ({ ok: db_ok, db_ok, deploy_version: version, licence_status: 'active', licence_pushed_at: AS_OF, branch: 'x', as_of: AS_OF });

const trafficRows = (rows: Array<Record<string, unknown>>) => async () => ({ available: true, as_of: AS_OF, rows: rows as any, ...WINDOW });

const REG = [
  { licence_uid: 'lic_fr_0001', code: 'fr', status: 'worker_live', last_health_at: '2026-11-13 11:00:00', last_health_ok: 1 },
  { licence_uid: 'lic_de_0002', code: 'de', status: 'worker_live', last_health_at: '2026-11-13 11:00:00', last_health_ok: 0 },
  { licence_uid: 'lic_es_0003', code: 'es', status: 'requested', last_health_at: null, last_health_ok: null },
];

function envOf(registry: Parameters<typeof registryDb>[0] = REG, bindings: Record<string, unknown> = {}) {
  return { DB: registryDb(registry), ...bindings } as any;
}

const readers = (over: Partial<ScopeReaders> = {}): ScopeReaders => ({
  live: async (_env, code) => ({ code, binding: `BRANCH_${code.toUpperCase()}`, status: 'ok', data: healthOf(code !== 'de', `v-${code}`), as_of: AS_OF }),
  traffic: trafficRows([
    { branch: 'hq', hits: 9000, avg_latency_ms: 40, p95_ms: 120, errors_5xx: 90, error_rate_pct: 1 },
    { branch: 'fr', hits: 400, avg_latency_ms: 50, p95_ms: 140, errors_5xx: 0, error_rate_pct: 0 },
    { branch: 'de', hits: 200, avg_latency_ms: 70, p95_ms: 300, errors_5xx: 10, error_rate_pct: 5 },
  ]),
  ...over,
});

// ── two subsidiaries, read independently ─────────────────────────────────

test('two subsidiaries read independently: fr healthy, de degraded, each from its own keys', async () => {
  const env = envOf();
  const fr = await readScope(env, 'fr', { readers: readers(), now: NOW });
  const de = await readScope(env, 'de', { readers: readers(), now: NOW });

  assert.deepEqual(fr.scope, { kind: 'subsidiary', code: 'fr', licence_uid: 'lic_fr_0001', registry_status: 'worker_live', bound: false });
  assert.equal(fr.state, 'healthy');
  assert.deepEqual(fr.detected, []);
  assert.deepEqual(fr.unknown, []);
  assert.equal(fr.signals.live_health.deploy_version, 'v-fr');
  assert.equal(fr.signals.traffic.hits, 400, 'fr reads its own row, not HQ\'s 9000 nor the total');
  assert.equal(fr.signals.stored_check.ok, true);

  assert.equal(de.state, 'degraded');
  assert.deepEqual(de.detected.map((d) => [d.key, d.severity]), [['branch:de', 'medium']]);
  assert.equal(de.signals.live_health.db_ok, false);
  assert.equal(de.signals.live_health.deploy_version, 'v-de');
  assert.equal(de.signals.traffic.hits, 200);
  assert.equal(de.signals.traffic.error_rate_pct, 5);
  assert.equal(de.signals.stored_check.ok, false);
  // One incident per branch: the live answer and the stored check agree, so it is not said twice.
  assert.equal(de.detected.length, 1);

  for (const r of [fr, de]) {
    for (const s of SCOPED_SIGNALS) {
      const b = (r.signals as any)[s.key];
      assert.ok(['ready', 'unavailable', 'not_deployed'].includes(b.availability), s.key);
      assert.equal(b.source, s.source);
      assert.ok('observed_at' in b);
    }
    assert.equal(r.observed_at, NOW.toISOString());
  }
});

test('the live reader is asked for the requested code only', async () => {
  const asked: string[] = [];
  await readScope(envOf(), 'fr', { readers: readers({ live: async (_e, code) => { asked.push(code); return { code, binding: 'BRANCH_FR', status: 'ok', data: healthOf(true, 'v'), as_of: AS_OF }; } }), now: NOW });
  assert.deepEqual(asked, ['fr']);
});

test('a stored check that is old, with a healthy live answer, is a low note that does not lower the state', async () => {
  const reg = [{ licence_uid: 'lic_fr_0001', code: 'fr', status: 'worker_live', last_health_at: '2026-11-10 11:00:00', last_health_ok: 1 }];
  const r = await readScope(envOf(reg), 'fr', { readers: readers(), now: NOW });
  assert.deepEqual(r.detected.map((d) => [d.key, d.severity]), [['branch_check:fr', 'low']]);
  assert.equal(r.state, 'healthy');
});

// ── a missing observation ─────────────────────────────────────────────────

test('a missing observation is Unknown, never Healthy, and every signal says why', async () => {
  const r = await readScope(envOf(), 'es', {
    readers: readers({
      live: async (_e, code) => ({ code, binding: 'BRANCH_ES', status: 'not_deployed', reason: 'No binding.' }),
      traffic: async () => ({ available: false, reason: 'Analytics Engine did not answer.', as_of: AS_OF, rows: [], ...WINDOW }),
    }),
    now: NOW,
  });
  assert.equal(r.state, 'unknown');
  assert.deepEqual(r.detected, []);
  assert.equal(r.signals.live_health.availability, 'not_deployed');
  assert.equal(r.signals.live_health.db_ok, null);
  assert.equal(r.signals.stored_check.availability, 'unavailable');
  assert.equal(r.signals.stored_check.ok, null);
  assert.equal(r.signals.traffic.availability, 'unavailable');
  assert.equal(r.signals.traffic.hits, null, 'an unread count is null, never 0');
  assert.deepEqual(r.unknown.map((u) => u.signal), ['Branch health', 'Traffic']);
  for (const u of r.unknown) assert.ok(u.reason.length > 10);
});

test('a live branch that does not answer is Unknown, even with a fresh ok stored check', async () => {
  const r = await readScope(envOf(), 'fr', {
    readers: readers({ live: async (_e, code) => ({ code, binding: 'BRANCH_FR', status: 'unreadable', reason: 'BRANCH_FR.health timed out', timed_out: true }) }),
    now: NOW,
  });
  assert.equal(r.state, 'unknown');
  assert.equal(r.signals.live_health.timed_out, true);
  assert.equal(r.signals.stored_check.ok, true);
});

test('a reader that throws becomes its own signal\'s unavailable state', async () => {
  const r = await readScope(envOf(), 'fr', {
    readers: readers({ live: async () => { throw new Error('boom'); }, traffic: async () => { throw new Error('boom'); } }),
    now: NOW,
  });
  assert.equal(r.state, 'unknown');
  assert.equal(r.signals.live_health.availability, 'unavailable');
  assert.equal(r.signals.traffic.availability, 'unavailable');
  assert.doesNotMatch(JSON.stringify(r), /boom/);
});

// ── traffic ───────────────────────────────────────────────────────────────

test('traffic: own row, a true zero, a failed read and a full page are four different answers', () => {
  const ok = { available: true, as_of: AS_OF, rows: [{ branch: 'fr', hits: 3, avg_latency_ms: 1, p95_ms: 2, errors_5xx: 0, error_rate_pct: 0 }], ...WINDOW };
  assert.equal(trafficFor('fr', ok).hits, 3);
  const zero = trafficFor('de', ok);
  assert.deepEqual([zero.availability, zero.hits, zero.p95_ms], ['ready', 0, null]);
  const down = trafficFor('fr', { available: false, reason: 'not read', as_of: AS_OF, rows: [], ...WINDOW });
  assert.deepEqual([down.availability, down.hits, down.reason], ['unavailable', null, 'not read']);
  const full = { ...ok, rows: Array.from({ length: TRAFFIC_ROW_CAP }, (_, i) => ({ branch: `b${i}x`, hits: 1, avg_latency_ms: 1, p95_ms: 1, errors_5xx: 0, error_rate_pct: 0 })) };
  const off = trafficFor('fr', full);
  assert.deepEqual([off.availability, off.hits], ['unavailable', null]);
  assert.equal(trafficFor('fr', null).availability, 'unavailable');
});

// ── refused scopes ────────────────────────────────────────────────────────

test('refused scopes: hq and malformed codes are invalid, an unknown code is unknown, and nothing is read', async () => {
  let reads = 0;
  const counting = readers({ live: async () => { reads += 1; throw new Error('x'); }, traffic: async () => { reads += 1; throw new Error('x'); } });
  for (const bad of ['hq', 'HQ', '', 'f', 'fr;drop', '../fr', 'a'.repeat(17), '1fr']) {
    await assert.rejects(readScope(envOf(), bad, { readers: counting, now: NOW }), (e: unknown) => e instanceof ScopeRefused && e.code === 'invalid_scope', bad);
  }
  await assert.rejects(readScope(envOf(), 'it', { readers: counting, now: NOW }), (e: unknown) => e instanceof ScopeRefused && e.code === 'unknown_scope');
  await assert.rejects(readScope(envOf('unreadable'), 'it', { readers: counting, now: NOW }), (e: unknown) => e instanceof ScopeRefused && e.code === 'unknown_scope');
  assert.equal(reads, 0);
});

test('a bound branch with no registry row is a scope, and its stored check is unavailable', async () => {
  const env = envOf([], { BRANCH_IT: { health: async () => healthOf(true, 'v-it') } });
  const r = await readScope(env, 'it', { readers: { live: readers().live, traffic: readers().traffic }, now: NOW });
  assert.deepEqual([r.scope.bound, r.scope.licence_uid, r.scope.registry_status], [true, null, null]);
  assert.equal(r.signals.stored_check.availability, 'unavailable');
});

// ── HQ-wide readings never stand in ───────────────────────────────────────

test('HQ-only and unavailable signals are named for a subsidiary and never judge it', async () => {
  const r = await readScope(envOf(), 'fr', { readers: readers(), now: NOW });
  assert.deepEqual(r.unavailable.map((s) => s.signal), UNAVAILABLE_SIGNALS.map((s) => s.name));
  assert.deepEqual(r.hq_only.map((s) => s.signal), HQ_ONLY_SIGNALS.map((s) => s.name));
  for (const s of [...UNAVAILABLE_SIGNALS, ...HQ_ONLY_SIGNALS]) assert.ok(!(s.key in r.signals), `${s.key} is not a scoped signal`);
  // The three groups do not overlap: a signal is one of the three for a subsidiary.
  const keys = [...SCOPED_SIGNALS, ...UNAVAILABLE_SIGNALS, ...HQ_ONLY_SIGNALS].map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
  const svc = readFileSync(join(ROOT, 'cloudflare-worker/src/services/platformScope.ts'), 'utf8');
  assert.doesNotMatch(svc, /readPlatformSummary|readJobsSummary|readDlqSummary|readTelemetryHealth|probeTelemetry/);
});

test('judgeScope: a scope with no attributable reading cannot be healthy', () => {
  const none = { availability: 'unavailable' as const, observed_at: null, source: 's', reason: 'r' };
  const { detected, unknown } = judgeScope({
    code: 'fr', now: NOW, registryStatus: 'worker_live',
    live: { ...none, db_ok: null, deploy_version: null, licence_status: null },
    check: { ...none, ok: null, checked_at: null },
    traffic: { ...none, window: null, hits: null, errors_5xx: null, error_rate_pct: null, p95_ms: null, avg_latency_ms: null },
  });
  assert.deepEqual(detected, []);
  assert.ok(unknown.length >= 2);
});

test('listScopes: registry rows and bindings by code; an unreadable registry still lists the bound branches and says so', async () => {
  const both = await listScopes(envOf(REG, { BRANCH_FR: { health() {} }, BRANCH_IT: { health() {} } }));
  assert.equal(both.registry_available, true);
  assert.deepEqual(both.scopes.map((s) => [s.code, s.licence_uid, s.bound]), [['de', 'lic_de_0002', false], ['es', 'lic_es_0003', false], ['fr', 'lic_fr_0001', true], ['it', null, true]]);
  const down = await listScopes(envOf('unreadable', { BRANCH_FR: { health() {} } }));
  assert.equal(down.registry_available, false);
  assert.match(down.registry_reason!, /could not be read/);
  assert.deepEqual(down.scopes.map((s) => s.code), ['fr']);
});

// ── the mounted routes ────────────────────────────────────────────────────

test('the mounted routes: refused callers and scopes, scoped readings, HQ-wide summary unchanged, no infrastructure ids', async () => {
  const { Hono } = await import('hono');
  const { SignJWT } = await import('jose');
  const { migratedDatabase, removeMigratedDatabases } = await import('./_storage_schema.ts');
  const { d1Over } = await import('./_d1_sqlite.mjs');
  const { AUTH_ERROR_STATUSES } = await import('../src/util/authErrors.ts');
  const { withThrownResponses } = await import('../src/util/thrownResponse.ts');
  const { default: adminPlatform } = await import('../src/routes/admin_platform.ts');
  const SECRET = 'synthetic-platform-scope-signing-key-'.repeat(2);
  try {
    const db = migratedDatabase();
    db.exec(`
      INSERT INTO users(id,name,email,role,is_active) VALUES (44,'Staff','staff@example.test','admin',1),(66,'Hq','hq@example.test','admin',1);
      INSERT INTO super_admins(user_id) VALUES (66);
      INSERT INTO licence_deployments(licence_uid, code, hostname, worker_name, d1_name, status, last_health_at, last_health_ok)
        VALUES ('lic_fr_0001','fr','fr.example.test','studioos-fr-synthetic','studioos-fr-db-synthetic','worker_live','2026-11-13 11:00:00',1),
               ('lic_de_0002','de','de.example.test','studioos-de-synthetic','studioos-de-db-synthetic','worker_live','2026-11-13 11:00:00',1),
               ('lic_es_0003','es','es.example.test','studioos-es-synthetic','studioos-es-db-synthetic','requested',NULL,NULL);
    `);
    const env: any = {
      JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db),
      BRANCH_FR: { health: async () => healthOf(true, 'v-fr') },
      BRANCH_DE: { health: async () => healthOf(false, 'v-de') },
    };
    const app = new Hono<any>();
    app.route('/api/admin/platform', adminPlatform);
    app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
    const call = async (who: number | null, path: string) => {
      const headers: Record<string, string> = {};
      if (who !== null) {
        const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
        headers.Authorization = `Bearer ${jwt}`;
      }
      return withThrownResponses(() => app.request(`https://unit.test/api/admin/platform${path}`, { headers }, env));
    };

    for (const path of ['/scopes', '/scopes/fr']) {
      assert.equal((await call(null, path)).status, 401, `${path}: no session is refused`);
      assert.equal((await call(44, path)).status, 403, `${path}: a plain Admin is refused`);
    }
    assert.equal((await call(66, '/scopes/hq')).status, 400);
    assert.equal((await call(66, '/scopes/Not%20A%20Code')).status, 400);
    const unknown = await call(66, '/scopes/it');
    assert.equal(unknown.status, 404);
    assert.equal(((await unknown.json()) as any).code, 'unknown_scope');

    const list = await call(66, '/scopes');
    assert.equal(list.status, 200);
    assert.equal(list.headers.get('cache-control'), 'private, no-store');
    const listed: any = await list.json();
    assert.deepEqual(listed.scopes.map((s: any) => s.code), ['de', 'es', 'fr']);

    const fr: any = await (await call(66, '/scopes/fr')).json();
    const de: any = await (await call(66, '/scopes/de')).json();
    const es: any = await (await call(66, '/scopes/es')).json();
    // No Analytics Engine credentials here, so traffic is unavailable and every scope is at best Unknown.
    assert.equal(fr.signals.traffic.availability, 'unavailable');
    assert.equal(fr.signals.traffic.hits, null);
    assert.equal(fr.signals.live_health.deploy_version, 'v-fr');
    assert.equal(fr.state, 'unknown');
    assert.equal(de.signals.live_health.db_ok, false);
    assert.equal(de.state, 'degraded', 'a failing database outranks an unknown');
    assert.equal(es.signals.live_health.availability, 'not_deployed');
    assert.equal(es.state, 'unknown');

    const text = JSON.stringify([listed, fr, de, es]);
    assert.doesNotMatch(text, /studioos-|example\.test|worker_name|d1_name|hostname|rpc_secret/);

    // HQ-wide: the summary is the same route with the same keys, and carries no scope.
    const summary: any = await (await call(66, '/summary')).json();
    for (const k of ['integrations', 'jobs', 'monitoring', 'broadcast', 'switches', 'reads', 'health']) assert.ok(k in summary, k);
    assert.ok(!('scope' in summary));
  } finally {
    removeMigratedDatabases();
  }
});

test('the scoped routes are Super Admin only and no-store, in source', () => {
  const route = readFileSync(join(ROOT, 'cloudflare-worker/src/routes/admin_platform.ts'), 'utf8');
  for (const head of ["r.get('/scopes',", "r.get('/scopes/:code',"]) {
    const block = route.slice(route.indexOf(head), route.indexOf('});', route.indexOf(head)));
    assert.match(block, /await requireSuperAdmin\(c\)/, head);
    assert.match(block, /private, no-store/, head);
  }
});
