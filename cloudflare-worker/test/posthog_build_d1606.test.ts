/**
 * D1606 (#3731, #2409 part 4) — PostHog into Build: tracked metrics, flag
 * facts, "Link flag to a must-have?", "Mark Done?" after 14 days at 100%, a
 * roadmap item's PostHog KPI in words, and Operating systems' Tools line.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/posthog_build_d1606.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ADMIN, COFOUNDER, FOUNDER, P, PH, appFor, call, fixture } from './_posthog_cycle_fixture.ts';
import { INSIGHT_A } from './_posthog_mcp_fake.mjs';
import { SHIPPED_DAYS, fullSince, posthogKpiTexts, syncBuild, toolsLine } from '../src/services/posthog/build.ts';
import { landFact } from '../src/services/posthog/metrics.ts';

const n = (db: any, sql: string, ...a: unknown[]) => Number((db.prepare(sql).get(...a) as any).n);
const sync = (app: any, env: any, who = FOUNDER) => call(app, env, who, 'POST', '/api/cycles/build/posthog/sync', { project: P });
const TODAY = '2026-10-31';
const daysAgo = (k: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - k * 86_400_000).toISOString().slice(0, 10);

function mustHave(db: any, id = 30, title = 'Onboarding v2', project = P) {
  db.prepare("INSERT INTO mvp_features (id, project_id, title, delivery_status, is_must_have) VALUES (?, ?, ?, 'In Progress', 1)").run(id, project, title);
}
/** Reads that answer one flag at a rollout, and nothing else. */
const flagReads = (rollout: number, active = true): any => new Proxy({}, {
  get: (_t, k: string) => async () => (k === 'flags' ? [{ id: '3', key: 'new-onboarding', name: 'New onboarding', active, rollout_percentage: rollout }] : []),
});

test('the sync: tracked metrics and each flag\'s state land; an unlinked flag waits as "Link to a must-have?"', async () => {
  const { env, fake, db } = await fixture();
  const app = appFor(fake);
  const t = await call(app, env, FOUNDER, 'POST', '/api/cycles/build/posthog/tracked', { project: P, module: 'prototype_mvp', insight_short_id: INSIGHT_A, role: 'activation' });
  assert.equal(t.status, 200);
  const r = await sync(app, env);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((db.prepare("SELECT value FROM posthog_metric_facts WHERE fact_key = ?").get(`metric:${t.body.tracked.uid}`) as any).value, 1240);
  const flag = db.prepare("SELECT module, value, value_json FROM posthog_metric_facts WHERE kind = 'flag_state'").get() as any;
  assert.equal(flag.module, 'prototype_mvp');
  assert.equal(flag.value, 25);
  assert.deepEqual(JSON.parse(flag.value_json), { key: 'new-onboarding', active: true, rollout: 25, feature_id: null });
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM posthog_proposals WHERE kind = 'flag_link'"), 1);
  for (const who of [COFOUNDER, ADMIN]) assert.equal((await sync(app, env, who)).status, 403);
  assert.equal(fake.forbiddenCalls().length, 0);
});

test('Link a flag: the must-have is the founder\'s; once linked, its chip reads the flag and no link is proposed again', async () => {
  const { env, fake, db } = await fixture();
  const app = appFor(fake);
  mustHave(db);
  db.exec("INSERT INTO projects (id, name, founder_id) VALUES (9, 'Elsewhere', 1002)");
  mustHave(db, 31, 'Not theirs', 9);
  await sync(app, env);
  const id = (db.prepare("SELECT id FROM posthog_proposals WHERE kind = 'flag_link'").get() as any).id;
  const at = (b: Record<string, unknown>) => call(app, env, FOUNDER, 'POST', `/api/cycles/build/posthog/proposals/${id}/accept`, { project: P, ...b });
  assert.equal((await at({})).body.error, 'feature_required', 'the must-have is never guessed');
  assert.equal((await at({ feature_id: 31 })).status, 404, 'another venture\'s must-have');
  const ok = await at({ feature_id: 30 });
  assert.equal(ok.body.target_ref, 'mvp_features:30');
  await sync(app, env);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM posthog_proposals WHERE kind = 'flag_link'"), 1, 'not proposed again');
  const read = await call(app, env, FOUNDER, 'GET', `/api/cycles/build/posthog?project=${P}&module=prototype_mvp`);
  assert.deepEqual(read.body.flags.map((f: any) => [f.feature_id, f.key, f.rollout, f.active]), [[30, 'new-onboarding', 25, true]]);
  assert.deepEqual(read.body.must_haves.map((m: any) => m.id), [30], 'only this venture\'s must-haves');
});

test(`Mark Done: proposed after ${SHIPPED_DAYS} days active at 100%, never after a break; Accept moves the must-have to Done`, async () => {
  const { env, fake, db } = await fixture();
  const app = appFor(fake);
  mustHave(db);
  const ctx = { integrationId: PH, projectId: P, userId: FOUNDER, today: TODAY };
  db.prepare("INSERT INTO posthog_proposals (integration_id, project_id, module, kind, source_key, status, target_ref) VALUES (?, ?, 'prototype_mvp', 'flag_link', 'flag:3', 'accepted', 'mvp_features:30')").run(PH, P);
  const at = (k: number, rollout: number, active = true) => landFact(env, ctx, { module: 'prototype_mvp', kind: 'flag_state', fact_key: 'flag:3', period: daysAgo(k), value: rollout, value_json: { key: 'new-onboarding', active, rollout }, as_of: daysAgo(k) });
  await at(20, 100); await at(8, 50); await at(7, 100);
  await syncBuild(env, flagReads(100), ctx);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM posthog_proposals WHERE kind = 'flag_shipped'"), 0, 'a break restarts the 14 days');
  db.prepare("DELETE FROM posthog_metric_facts WHERE period = ?").run(daysAgo(8));
  await at(15, 100);
  db.prepare("UPDATE posthog_metric_facts SET value = 100 WHERE period = ?").run(daysAgo(20));
  await syncBuild(env, flagReads(100), ctx);
  const p = db.prepare("SELECT id, payload_json FROM posthog_proposals WHERE kind = 'flag_shipped'").get() as any;
  assert.ok(p, 'proposed after 14 days at 100%');
  assert.equal(JSON.parse(p.payload_json).feature_id, 30);
  const ok = await call(app, env, FOUNDER, 'POST', `/api/cycles/build/posthog/proposals/${p.id}/accept`, { project: P });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((db.prepare('SELECT delivery_status FROM mvp_features WHERE id = 30').get() as any).delivery_status, 'Done');
  await syncBuild(env, flagReads(100), ctx);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM posthog_proposals WHERE kind = 'flag_shipped'"), 1, 'a Done must-have is not proposed again');
  // An inactive flag at 100% is not shipped.
  assert.equal(fullSince([{ period: daysAgo(20), value: 100, active: false }]), null);
  assert.equal(fullSince([{ period: daysAgo(20), value: 100, active: true }, { period: daysAgo(3), value: 100, active: true }]), daysAgo(20));
});

test('a roadmap item\'s PostHog KPI reads its value and source, or why it has none; Operating systems gets one Tools line', async () => {
  const { env, fake, db } = await fixture();
  const app = appFor(fake);
  const t = await call(app, env, FOUNDER, 'POST', '/api/cycles/build/posthog/tracked', { project: P, module: 'product_roadmap', insight_short_id: INSIGHT_A, role: 'active_users' });
  const kpi = t.body.tracked.kpi;
  assert.equal((await posthogKpiTexts(env, P)).get(kpi), 'Weekly active users · Not recorded');
  await sync(app, env);
  assert.match((await posthogKpiTexts(env, P)).get(kpi)!, /^Weekly active users 1,240 · From PostHog, as of \d{4}-\d{2}-\d{2}$/);
  const route = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/cycle_build.ts'), 'utf8');
  assert.match(route, /moves: \[i\.feedback_theme, kpiWords\(i\.kpi_key\)\]/, 'the roadmap row reads the words, not the key');
  const tools = await toolsLine(env, P);
  assert.equal(tools!.project, 'Lumen web app');
  assert.equal(tools!.region, 'EU');
  assert.ok(tools!.last_synced);
  assert.deepEqual(tools!.syncs.map((s) => s.section), ['build']);
  const os = await call(app, env, COFOUNDER, 'GET', `/api/cycles/build/posthog?project=${P}&module=operating_systems`);
  assert.equal(os.body.tools.project, 'Lumen web app');
  assert.ok(!JSON.stringify(os.body.tools).includes('Weekly'), 'counts only on the Tools line');
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM project_core_systems"), 0, 'decision D (a): no core system is added');
});

test('a must-have already Done by hand is never proposed as shipped', async () => {
  const { env, db } = await fixture();
  db.prepare("INSERT INTO mvp_features (id, project_id, title, delivery_status, is_must_have) VALUES (30, ?, 'Onboarding v2', 'Done', 1)").run(P);
  db.prepare("INSERT INTO posthog_proposals (integration_id, project_id, module, kind, source_key, status, target_ref) VALUES (?, ?, 'prototype_mvp', 'flag_link', 'flag:3', 'accepted', 'mvp_features:30')").run(PH, P);
  const ctx = { integrationId: PH, projectId: P, userId: FOUNDER, today: TODAY };
  await landFact(env, ctx, { module: 'prototype_mvp', kind: 'flag_state', fact_key: 'flag:3', period: daysAgo(20), value: 100, value_json: { key: 'new-onboarding', active: true, rollout: 100 }, as_of: daysAgo(20) });
  await syncBuild(env, flagReads(100), ctx);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM posthog_proposals WHERE kind = 'flag_shipped'"), 0);
});
