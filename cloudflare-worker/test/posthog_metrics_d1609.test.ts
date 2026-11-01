/**
 * D1609 (#3731, #2409 part 2) — PostHog's metrics foundation: tracked
 * metrics, the `posthog-<uid>` KPI family, facts that stay deleted,
 * proposals, the module read, and `posthog` as a connected source.
 *
 * The database is the baseline plus every numbered migration above the
 * cutoff, schema only, as deck_sources_d896.test.ts builds one. PostHog is
 * `_posthog_mcp_fake.mjs`; no test reaches a real host. Every person,
 * venture and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/posthog_metrics_d1609.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { createPosthogCycleRouter, createPosthogRouter } from '../src/routes/posthog.ts';
import { CONNECTED_METRIC_SOURCES, isConnectedSource } from '../src/routes/progress.ts';
import { enterKpi, isKpiKey, kpiKeys, kpiRows, KpiRefused } from '../src/services/growKpis.ts';
import {
  DISCONNECTED, HAND_ENTRY_REFUSED, NOT_RECORDED, POSTHOG_MODULES, ROLES, landFact, proposeOnce, registerAcceptor, unitOf,
} from '../src/services/posthog/metrics.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { INSIGHT_A, PROJECT_A, POSTHOG_MCP_URL, posthogFake } from './_posthog_mcp_fake.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const FOUNDER = 10, COFOUNDER = 11, OTHER = 20, ADMIN = 30;
const P = 1, P_OTHER = 2, COMPANY = 77, PH = 40;
const TODAY = Date.parse('2026-10-31T12:00:00Z');

const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

async function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const add = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  add.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  add.run(COFOUNDER, 'founder', 'Cy Cofounder', 'cy@example.test', 1003);
  add.run(OTHER, 'founder', 'Oz Other', 'oz@example.test', 1002);
  add.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null);
  db.exec(`INSERT INTO projects (id, name, founder_id, company_id) VALUES (${P}, 'Kestrel Labs', 1001, ${COMPANY}), (${P_OTHER}, 'Beta Works', 1002, 88)`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${P}, ${COFOUNDER}, 'cofounder', 'accepted')`);
  db.exec(`INSERT INTO user_company_links (uid, company_id, user_id) VALUES ('u1', ${COMPANY}, ${FOUNDER}), ('u2', ${COMPANY}, ${COFOUNDER}), ('u3', 88, ${OTHER})`);
  const fake = posthogFake();
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const uid = 'int-posthog-fixture-0001';
  const creds = { access_token: fake.signedIn(), client_key: 'mcp_client:posthog:fixture', resource: POSTHOG_MCP_URL, scopes: ['insight:read'], expires_at: Date.now() + 3_600_000 };
  db.prepare("INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type, credentials_enc) VALUES (?, ?, ?, 'posthog', 'active', 'oauth_mcp', ?)")
    .run(PH, uid, FOUNDER, await encryptCredentials(env, uid, creds));
  db.prepare('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, ?, 1)').run(PH, COMPANY);
  db.prepare('INSERT INTO posthog_project_links (uid, integration_id, project_id, posthog_project_id, posthog_project_name, region, linked_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('link-1', PH, P, PROJECT_A, 'Lumen web app', 'EU', FOUNDER);
  return { db, env, fake, uid };
}

function appFor(fake: any) {
  const app = new Hono<any>();
  app.route('/api/connectors', createPosthogRouter({ fetcher: fake.fetch }));
  app.route('/api/cycles', createPosthogCycleRouter({ fetcher: fake.fetch }));
  app.onError((e: any, c) => c.json({ detail: String(e?.message || '') }, 500));
  return app;
}

async function call(app: Hono<any>, env: any, who: number, method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}) {
  const role = who === ADMIN ? 'admin' : 'founder';
  const token = await new SignJWT({ user_id: who, role, ...extra }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
    }, env));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}

async function tracked(app: Hono<any>, env: any, role = 'active_users', module = 'revenue_and_traction', section = 'grow') {
  const r = await call(app, env, FOUNDER, 'POST', `/api/cycles/${section}/posthog/tracked`, { project: P, module, insight_short_id: INSIGHT_A, role });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.tracked as { uid: string; kpi: string; unit: string };
}

test('track a metric: the owner picks one of the linked project\'s saved insights and says what it measures', async () => {
  const { env, fake, uid, db } = await fixture();
  const app = appFor(fake);
  const list = await call(app, env, FOUNDER, 'GET', `/api/connectors/${uid}/posthog-insights?project=${P}`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.insights.map((i: any) => i.short_id), [INSIGHT_A]);
  assert.ok(fake.sent.some((s: any) => s.project === PROJECT_A), 'the insights are the linked project\'s');
  const t = await tracked(app, env);
  assert.equal(t.kpi, `posthog-${t.uid}`);
  assert.equal(t.unit, 'count');
  const row = db.prepare('SELECT role, module, insight_name, created_by FROM posthog_tracked_metrics WHERE uid = ?').get(t.uid) as any;
  assert.deepEqual({ ...row }, { role: 'active_users', module: 'revenue_and_traction', insight_name: 'Weekly active users', created_by: FOUNDER });
  // Refusals, each before anything is written.
  const no = (b: any) => call(app, env, FOUNDER, 'POST', '/api/cycles/grow/posthog/tracked', { project: P, module: 'revenue_and_traction', insight_short_id: INSIGHT_A, role: 'active_users', ...b });
  assert.equal((await no({ insight_short_id: 'Zz999999' })).body.error, 'insight_not_found');
  assert.equal((await no({ role: 'revenue' })).body.error, 'invalid_role');
  assert.equal((await no({ module: 'experiments' })).body.error, 'invalid_module', 'a Validate module is not Grow\'s');
  assert.equal((await call(app, env, COFOUNDER, 'POST', '/api/cycles/grow/posthog/tracked', { project: P, module: 'revenue_and_traction', insight_short_id: INSIGHT_A, role: 'other' })).body.error, 'not_your_posthog');
  assert.equal((await call(app, env, FOUNDER, 'POST', '/api/cycles/grow/posthog/tracked', { project: P, module: 'revenue_and_traction', insight_short_id: INSIGHT_A, role: 'other' }, { impersonated_by: ADMIN })).status, 403);
  assert.equal((await call(app, env, OTHER, 'GET', `/api/connectors/${uid}/posthog-insights?project=${P}`)).status, 404, 'another member never lists this PostHog');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM posthog_tracked_metrics').get() as any).n, 1);
  assert.deepEqual(unitOf('activation'), 'pct');
  assert.ok(ROLES.includes('sessions'));
});

test('the posthog-<uid> KPI family: read from PostHog facts only; Not recorded, never 0; a hand entry is refused', async () => {
  const { env, fake, db } = await fixture();
  const t = await tracked(appFor(fake), env);
  assert.ok((await kpiKeys(env, P)).includes(t.kpi));
  assert.equal(await isKpiKey(env, P, t.kpi), true);
  assert.equal(await isKpiKey(env, P_OTHER, t.kpi), false, 'another venture\'s PostHog metric is not its KPI');
  assert.equal(await isKpiKey(env, P, 'posthog-0123456789abcdef0123456789abcdef'), false);

  let row = (await kpiRows(env, P, TODAY)).find((r) => r.id === t.kpi)!;
  assert.deepEqual({ value: row.value, source: row.source, reason: row.reason, kpi: row.kpi }, { value: null, source: null, reason: NOT_RECORDED, kpi: 'Weekly active users' });

  const ctx = { integrationId: PH, projectId: P };
  await landFact(env, ctx, { module: 'revenue_and_traction', kind: 'metric', fact_key: `metric:${t.uid}`, period: '2026-09-28', value: 1150, as_of: '2026-09-28' });
  await landFact(env, ctx, { module: 'revenue_and_traction', kind: 'metric', fact_key: `metric:${t.uid}`, period: '2026-10-26', value: 1240, as_of: '2026-10-30' });
  row = (await kpiRows(env, P, TODAY)).find((r) => r.id === t.kpi)!;
  assert.deepEqual({ value: row.value, source: row.source, as_of: row.as_of, change: row.change_30d, unit: row.unit, reason: row.reason },
    { value: 1240, source: 'posthog', as_of: '2026-10-30', change: 90, unit: 'count', reason: null });

  await assert.rejects(enterKpi(env, P, FOUNDER, { kpi: t.kpi, value: 5, as_of: '2026-10-30' }),
    (e: any) => e instanceof KpiRefused && e.sentence === HAND_ENTRY_REFUSED && e.status === 400);
  await assert.rejects(enterKpi(env, P, FOUNDER, { kpi: 'mrr', value: 5, as_of: '2026-10-30', source: 'posthog' }), (e: any) => e instanceof KpiRefused && e.field === 'source');
  const n = (sql: string) => (db.prepare(sql).get() as any).n;
  assert.equal(n("SELECT COUNT(*) AS n FROM project_metrics"), 0, 'no PostHog row in project_metrics');
  assert.equal(n("SELECT COUNT(*) AS n FROM custom_kpi_values"), 0, 'no PostHog row in custom_kpi_values');
});

test('a broken or gone connection reads Not recorded: PostHog is disconnected, even with facts kept', async () => {
  const { env, fake, db } = await fixture();
  const t = await tracked(appFor(fake), env);
  await landFact(env, { integrationId: PH, projectId: P }, { module: 'revenue_and_traction', kind: 'metric', fact_key: `metric:${t.uid}`, period: '2026-10-26', value: 1240, as_of: '2026-10-30' });
  db.prepare("UPDATE integrations SET status = 'error' WHERE id = ?").run(PH);
  const row = (await kpiRows(env, P, TODAY)).find((r) => r.id === t.kpi)!;
  assert.deepEqual({ value: row.value, reason: row.reason, source: row.source }, { value: null, reason: DISCONNECTED, source: null });
  db.prepare('DELETE FROM posthog_project_links').run();
  assert.equal((await kpiRows(env, P, TODAY)).find((r) => r.id === t.kpi)!.reason, DISCONNECTED);
});

test('a fact the team deletes stays deleted when PostHog lands it again; another venture\'s fact is not found', async () => {
  const { env, fake, db } = await fixture();
  const app = appFor(fake);
  const ctx = { integrationId: PH, projectId: P };
  const f = { module: 'experiments', kind: 'experiment_result' as const, fact_key: 'experiment:7', period: 'current', value: 3.1, label: 'Shorter onboarding', as_of: '2026-10-30' };
  assert.equal(await landFact(env, ctx, f), 'written');
  assert.equal(await landFact(env, ctx, { ...f, value: 3.4 }), 'updated');
  const id = (db.prepare('SELECT id FROM posthog_metric_facts').get() as any).id;
  assert.equal((await call(app, env, OTHER, 'DELETE', `/api/cycles/validate/posthog/facts/${id}?project=${P}`)).status, 403);
  assert.equal((await call(app, env, COFOUNDER, 'DELETE', `/api/cycles/validate/posthog/facts/${id}?project=${P}`)).status, 200, 'any team member who may write deletes');
  assert.equal(await landFact(env, ctx, { ...f, value: 9 }), 'kept_deleted');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM posthog_metric_facts').get() as any).n, 0);
  const ledger = db.prepare("SELECT local_id, kind FROM connector_fed_items WHERE integration_id = ?").get(PH) as any;
  assert.deepEqual({ ...ledger }, { local_id: null, kind: 'posthog_experiment_result' });
  assert.equal((await call(app, env, FOUNDER, 'DELETE', `/api/cycles/validate/posthog/facts/${id}?project=${P}`)).body.error, 'fact_not_found');
  await assert.rejects(landFact(env, ctx, { ...f, module: 'cap_table' }), /invalid_module/);
});

test('From PostHog: the venture\'s team reads it; nobody else; no link says so; the connection uid only for its own member', async () => {
  const { env, fake, db, uid } = await fixture();
  const app = appFor(fake);
  const t = await tracked(app, env);
  const own = await call(app, env, FOUNDER, 'GET', `/api/cycles/grow/posthog?project=${P}&module=revenue_and_traction`);
  assert.equal(own.status, 200);
  assert.deepEqual(own.body.link, { linked: true, active: true, mine: true, uid });
  assert.deepEqual(own.body.tracked.map((m: any) => [m.uid, m.value, m.reason]), [[t.uid, null, NOT_RECORDED]]);
  const mate = await call(app, env, COFOUNDER, 'GET', `/api/cycles/grow/posthog?project=${P}&module=revenue_and_traction`);
  assert.equal(mate.status, 200);
  assert.deepEqual(mate.body.link, { linked: true, active: true, mine: false });
  for (const who of [OTHER, ADMIN]) {
    const r = await call(app, env, who, 'GET', `/api/cycles/grow/posthog?project=${P}&module=revenue_and_traction`);
    assert.equal(r.status, 403, String(who));
    assert.equal(r.body.error, 'team_only');
  }
  assert.equal((await call(app, env, FOUNDER, 'GET', `/api/cycles/grow/posthog?project=${P}&module=experiments`)).body.error, 'invalid_module');
  db.prepare('DELETE FROM posthog_project_links').run();
  assert.deepEqual((await call(app, env, FOUNDER, 'GET', `/api/cycles/grow/posthog?project=${P}&module=revenue_and_traction`)).body.link, { linked: false, active: false, mine: false });
});

test('proposals: proposed once, Dismiss keeps it decided, Accept runs its kind\'s acceptor or answers not_ready', async () => {
  const { env, fake, db } = await fixture();
  const app = appFor(fake);
  const ctx = { integrationId: PH, projectId: P };
  const p = { module: 'product_improvement', kind: 'survey_feedback' as const, source_key: 'svy-1:resp-1', payload: { title: 'We would pay if it synced with our calendar.' } };
  assert.equal(await proposeOnce(env, ctx, p), 'proposed');
  assert.equal(await proposeOnce(env, ctx, p), 'refreshed');
  const id = (db.prepare('SELECT id FROM posthog_proposals').get() as any).id;
  const at = (verb: string, who = FOUNDER) => call(app, env, who, 'POST', `/api/cycles/grow/posthog/proposals/${id}/${verb}`, { project: P });
  assert.equal((await at('accept')).body.error, 'not_ready', 'no part has registered an acceptor yet');
  assert.equal((await at('dismiss', COFOUNDER)).body.error, 'not_your_posthog');
  assert.equal((await at('dismiss')).status, 200);
  assert.equal((await at('dismiss')).body.error, 'proposal_decided');
  assert.equal(await proposeOnce(env, ctx, p), 'decided', 'a dismissed proposal is never proposed again');

  const q = { ...p, source_key: 'svy-1:resp-2' };
  await proposeOnce(env, ctx, q);
  const id2 = (db.prepare("SELECT id FROM posthog_proposals WHERE source_key = 'svy-1:resp-2'").get() as any).id;
  registerAcceptor({ kind: 'survey_feedback', async accept() { return { target_ref: 'product_feedback:9' }; } });
  const ok = await call(app, env, FOUNDER, 'POST', `/api/cycles/grow/posthog/proposals/${id2}/accept`, { project: P });
  assert.deepEqual(ok.body, { ok: true, target_ref: 'product_feedback:9' });
  assert.deepEqual({ ...(db.prepare('SELECT status, target_ref, decided_by FROM posthog_proposals WHERE id = ?').get(id2) as any) }, { status: 'accepted', target_ref: 'product_feedback:9', decided_by: FOUNDER });
  const logged = db.prepare("SELECT details FROM activity_logs WHERE action LIKE 'posthog_proposal_%'").all() as any[];
  for (const l of logged) assert.doesNotMatch(l.details, /calendar|pay/, 'only ids are logged');
});

test('stop tracking: the metric and its facts go, and its KPI key is no longer the venture\'s', async () => {
  const { env, fake, db } = await fixture();
  const app = appFor(fake);
  const t = await tracked(app, env);
  await landFact(env, { integrationId: PH, projectId: P }, { module: 'revenue_and_traction', kind: 'metric', fact_key: `metric:${t.uid}`, period: '2026-10-26', value: 1240, as_of: '2026-10-30' });
  assert.equal((await call(app, env, OTHER, 'DELETE', `/api/cycles/grow/posthog/tracked/${t.uid}?project=${P}`)).status, 403);
  assert.equal((await call(app, env, COFOUNDER, 'DELETE', `/api/cycles/grow/posthog/tracked/${t.uid}?project=${P}`)).status, 200);
  assert.equal(await isKpiKey(env, P, t.kpi), false);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM posthog_metric_facts').get() as any).n, 0);
  assert.equal((await call(app, env, FOUNDER, 'DELETE', `/api/cycles/grow/posthog/tracked/${t.uid}?project=${P}`)).body.error, 'metric_not_found');
});

test('posthog is a connected source and a definition source; nothing PostHog writes project_metrics or custom_kpi_values', () => {
  assert.ok(CONNECTED_METRIC_SOURCES.includes('posthog'));
  assert.equal(isConnectedSource(' PostHog '), true, 'a typed snapshot claiming PostHog is refused');
  const progress = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/progress.ts'), 'utf8');
  assert.match(progress, /const DEFINITION_SOURCES = new Set\(\['manual', 'stripe', 'derived', 'posthog'\]\);/);
  const code = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const p of ['cloudflare-worker/src/services/posthog/metrics.ts', 'cloudflare-worker/src/routes/posthog.ts']) {
    assert.doesNotMatch(code(p), /INSERT INTO (project_metrics|custom_kpi_values)|UPDATE (project_metrics|custom_kpi_values)/, p);
    assert.doesNotMatch(code(p), /\$\{[^}]*\}[^`]*\b(FROM|WHERE|INSERT|UPDATE)\b/, `${p}: no interpolated SQL`);
  }
  assert.deepEqual(Object.keys(POSTHOG_MODULES).sort(), ['demand_signals', 'experiments', 'fundraising_readiness', 'investor_narrative', 'operating_systems', 'pitch_deck', 'product_improvement', 'product_roadmap', 'prototype_mvp', 'revenue_and_traction']);
});
