/**
 * D1608 (#3731, #2409 part 6) — PostHog into Grow: tracked metrics as KPI
 * rows with no hand entry, product retention apart from revenue retention,
 * survey scores, and "Add as customer feedback" with no name or email.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/posthog_grow_d1608.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ADMIN, COFOUNDER, FOUNDER, OTHER, P, PH, appFor, call, fixture } from './_posthog_cycle_fixture.ts';
import { INSIGHT_A, PERSON, SURVEY_A } from './_posthog_mcp_fake.mjs';
import { cohortsOf, surveyFigures, syncGrow } from '../src/services/posthog/grow.ts';
import { track } from '../src/services/posthog/metrics.ts';

const n = (db: any, sql: string, ...a: unknown[]) => Number((db.prepare(sql).get(...a) as any).n);
const sync = (app: any, env: any, who = FOUNDER) => call(app, env, who, 'POST', '/api/cycles/grow/posthog/sync', { project: P });

test('the Grow sync: tracked metrics and each survey\'s figures land; a feedback answer waits only for a marked question', async () => {
  const { env, fake, db } = await fixture();
  const app = appFor(fake);
  const t = await call(app, env, FOUNDER, 'POST', '/api/cycles/grow/posthog/tracked', { project: P, module: 'revenue_and_traction', insight_short_id: INSIGHT_A, role: 'active_users' });
  assert.equal(t.status, 200);
  const r = await sync(app, env);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((db.prepare('SELECT value FROM posthog_metric_facts WHERE fact_key = ?').get(`metric:${t.body.tracked.uid}`) as any).value, 1240);
  const s = db.prepare("SELECT module, period, value, value_json FROM posthog_metric_facts WHERE kind = 'survey_stats' AND module = 'product_improvement'").get() as any;
  assert.match(s.period, /^\d{4}-\d{2}$/, 'one figure per survey per month');
  assert.equal(s.value, null, 'no NPS or average stated, so no score: never 0');
  assert.deepEqual(JSON.parse(s.value_json), { responses: 46, shown: 400, nps: null, average: null });
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM posthog_proposals WHERE kind = 'survey_feedback'"), 0, 'no question marked feedback');
  await call(app, env, FOUNDER, 'PUT', `/api/cycles/validate/posthog/surveys/${SURVEY_A}/marks`, { project: P, question_id: 'q1', mark: 'would_pay' });
  await sync(app, env);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM posthog_proposals WHERE kind = 'survey_feedback'"), 0, 'a "would pay" question is never feedback');
  for (const who of [COFOUNDER, ADMIN]) assert.equal((await sync(app, env, who)).status, 403);
  // No PostHog figure lands in revenue's stores.
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM project_metrics'), 0);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM custom_kpi_values'), 0);
});

test('Add as customer feedback: a marked answer lands as source customer, with no name, email or company', async () => {
  const { env, fake, db } = await fixture();
  const app = appFor(fake);
  assert.equal((await call(app, env, FOUNDER, 'PUT', `/api/cycles/validate/posthog/surveys/${SURVEY_A}/marks`, { project: P, question_id: 'q1', mark: 'feedback' })).status, 200);
  await sync(app, env);
  const p = db.prepare("SELECT id, module, payload_json FROM posthog_proposals WHERE kind = 'survey_feedback'").get() as any;
  assert.equal(p.module, 'product_improvement');
  assert.doesNotMatch(p.payload_json, new RegExp(`d-4|s-2|203\\.0\\.113|${PERSON.replace('.', '\\.')}`));
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM posthog_proposals WHERE kind = 'survey_signal'"), 0, 'feedback is not a demand signal');
  assert.equal((await call(app, env, COFOUNDER, 'POST', `/api/cycles/grow/posthog/proposals/${p.id}/accept`, { project: P })).status, 403);
  const ok = await call(app, env, FOUNDER, 'POST', `/api/cycles/grow/posthog/proposals/${p.id}/accept`, { project: P, from_name: 'Should not land', from_email: 'nobody@example.test' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const fb = db.prepare('SELECT body, source, from_name, from_email, from_company FROM product_feedback').get() as any;
  assert.deepEqual({ ...fb }, { body: 'We\'d pay if it synced with our calendar.', source: 'customer', from_name: null, from_email: null, from_company: null });
  assert.match(ok.body.target_ref, /^product_feedback:/);
});

test('product retention by first-seen week lands apart from revenue retention and churn', async () => {
  const { env, db } = await fixture();
  const m = await track(env, { integrationId: PH, projectId: P, userId: FOUNDER, insight: { short_id: 'Ret12345', name: 'Week-4 retention' }, role: 'retention', module: 'revenue_and_traction' });
  const users = await track(env, { integrationId: PH, projectId: P, userId: FOUNDER, insight: { short_id: 'Wau12345', name: 'Weekly active users' }, role: 'active_users', module: 'revenue_and_traction' });
  const reads: any = new Proxy({}, { get: (_t, k: string) => async () => (k === 'runInsight' ? { results: [
    { date: '2026-09-28T00:00:00Z', values: [{ count: 200 }, { count: 84 }, { count: 62 }] },
    { date: '2026-10-05T00:00:00Z', values: [{ count: 180 }, { count: 70 }, {}] },
    { date: 'not a date', values: [{ count: 5 }] },
  ] } : []) });
  const r = await syncGrow(env, reads, { integrationId: PH, projectId: P, userId: FOUNDER, today: '2026-10-31' });
  assert.equal(r.partial, false);
  const f = db.prepare('SELECT module, value, value_json FROM posthog_metric_facts WHERE fact_key = ?').get(`retention:${m.uid}`) as any;
  assert.equal(f.module, 'revenue_and_traction');
  assert.equal(f.value, null, 'a cohort table is not one number');
  assert.deepEqual(JSON.parse(f.value_json).cohorts, [
    { week: '2026-09-28', size: 200, pct: [42, 31] },
    { week: '2026-10-05', size: 180, pct: [38.9, null] },
  ]);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM project_metrics WHERE monthly_churn_pct IS NOT NULL'), 0, 'never written to churn');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM posthog_metric_facts WHERE fact_key = ?', `retention:${users.uid}`), 0, 'only a retention metric has cohorts');
});

test('the venture\'s team alone reads Grow\'s PostHog; a PostHog KPI row offers no Enter by hand', async () => {
  const { env, fake } = await fixture();
  const app = appFor(fake);
  for (const module of ['revenue_and_traction', 'product_improvement']) {
    assert.equal((await call(app, env, COFOUNDER, 'GET', `/api/cycles/grow/posthog?project=${P}&module=${module}`)).status, 200);
    for (const who of [OTHER, ADMIN]) assert.equal((await call(app, env, who, 'GET', `/api/cycles/grow/posthog?project=${P}&module=${module}`)).status, 403, `${who} ${module}`);
  }
  const rec = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/records/grow.ts'), 'utf8');
  assert.match(rec, /if \(!DERIVED\.has\(id\) && !id\.startsWith\('posthog-'\)\) \{/);
  assert.match(rec, /'From PostHog\. This figure comes from PostHog\.'/);
});

test('the parsers: cohorts never invent a 0; a survey score is PostHog\'s own', () => {
  assert.deepEqual(cohortsOf({ results: [{ label: '2026-10-05', values: [0, 3] }] }), [], 'a cohort of no one is no cohort');
  assert.deepEqual(cohortsOf({}), []);
  assert.deepEqual(surveyFigures({ responses: 46, nps: 31 }), { responses: 46, shown: null, nps: 31, average: null });
  assert.deepEqual(surveyFigures({ response_count: 10, scores: { average: 4.2 } }), { responses: 10, shown: null, nps: null, average: 4.2 });
});
