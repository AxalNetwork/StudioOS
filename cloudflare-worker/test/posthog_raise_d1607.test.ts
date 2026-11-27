/**
 * D1607 (#3731, #2409 part 5) — PostHog into Raise: the Raise sync, Traction
 * proof's read lines (the score unchanged), and `active_users` in the
 * narrative and deck consistency check, naming both sources.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/posthog_raise_d1607.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COFOUNDER, FOUNDER, P, PH, appFor, call, fixture } from './_posthog_cycle_fixture.ts';
import { INSIGHT_A } from './_posthog_mcp_fake.mjs';
import { FIGURES, FIGURE_LABEL, NARRATIVE_CHECK_FIGURES, checkInputs, computeReadiness, consistencyCheck, parseStatedFigures } from '../src/services/raiseCycle.ts';
import { FIGURE_KINDS } from '../src/services/narrative/claims.ts';
import { landFact, track } from '../src/services/posthog/metrics.ts';
import { posthogFigure } from '../src/services/posthog/raise.ts';

const sync = (app: any, env: any, who = FOUNDER) => call(app, env, who, 'POST', '/api/cycles/raise/posthog/sync', { project: P });
const traction = async (env: any) => (await computeReadiness(env, P)).find((s) => s.key === 'traction')!;

test('active users is a figure a claim states, read only beside its words', () => {
  assert.ok(FIGURES.includes('active_users'));
  assert.ok(!(NARRATIVE_CHECK_FIGURES as readonly string[]).includes('active_users'), 'readiness never scores it (decision E, a)');
  assert.equal(FIGURE_LABEL.active_users, 'Active users');
  assert.deepEqual(FIGURE_KINDS.active_users, []);
  const v = (t: string) => parseStatedFigures('traction', t).filter((s) => s.figure === 'active_users').map((s) => s.value);
  assert.deepEqual(v('We have 1,240 weekly active users.'), [1240]);
  assert.deepEqual(v('MAU of 3,000 and growing'), [3000]);
  assert.deepEqual(v('We have 1,240 users.'), [], 'a bare count is not active users');
});

test('the Raise sync lands the module\'s tracked metrics; only the serving member syncs', async () => {
  const { env, fake, db } = await fixture();
  const app = appFor(fake);
  const t = await call(app, env, FOUNDER, 'POST', '/api/cycles/raise/posthog/tracked', { project: P, module: 'fundraising_readiness', insight_short_id: INSIGHT_A, role: 'active_users' });
  assert.equal(t.status, 200);
  const r = await sync(app, env);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((db.prepare('SELECT value FROM posthog_metric_facts WHERE fact_key = ?').get(`metric:${t.body.tracked.uid}`) as any).value, 1240);
  assert.equal((await sync(app, env, COFOUNDER)).status, 403);
});

test('Traction proof: PostHog\'s active users and retention are read lines marked Shown; the score is unchanged', async () => {
  const { env, db } = await fixture();
  const before = await traction(env);
  const ctx = { integrationId: PH, projectId: P };
  const users = await track(env, { integrationId: PH, projectId: P, userId: FOUNDER, insight: { short_id: INSIGHT_A, name: 'Weekly active users' }, role: 'active_users', module: 'fundraising_readiness' });
  const ret = await track(env, { integrationId: PH, projectId: P, userId: FOUNDER, insight: { short_id: 'Ret12345', name: 'Week-4 retention' }, role: 'retention', module: 'fundraising_readiness' });
  await landFact(env, ctx, { module: 'fundraising_readiness', kind: 'metric', fact_key: `metric:${users.uid}`, period: '2026-10-30', value: 1240, as_of: '2026-10-30' });
  await landFact(env, ctx, { module: 'fundraising_readiness', kind: 'metric', fact_key: `metric:${ret.uid}`, period: '2026-10-30', value: 22, as_of: '2026-10-30' });
  const after = await traction(env);
  assert.equal(after.score, before.score, 'decision E (a): PostHog never moves the score');
  assert.equal(after.evidence, before.evidence);
  const lines = after.reads.filter((r) => r.a.endsWith('From PostHog'));
  assert.deepEqual(lines.map((r) => [r.a, r.b, r.c]), [
    ['Active users · From PostHog', '1,240 · Weekly active users · as of 2026-10-30', 'Shown'],
    ['Retention · From PostHog', '22% · Week-4 retention · as of 2026-10-30', 'Shown'],
  ]);
  assert.ok(lines.every((r) => r.note === 'Shown beside the score; it does not change it.'));
  // No PostHog figure, no line: never a 0.
  db.prepare('DELETE FROM posthog_metric_facts').run();
  assert.equal((await traction(env)).reads.filter((r) => r.a.endsWith('From PostHog')).length, 0);
});

test('the consistency check: a stated user count against PostHog\'s is a mismatch that names both sources', async () => {
  const { env } = await fixture();
  const ctx = { integrationId: PH, projectId: P };
  const users = await track(env, { integrationId: PH, projectId: P, userId: FOUNDER, insight: { short_id: INSIGHT_A, name: 'Weekly active users' }, role: 'active_users', module: 'investor_narrative' });
  await landFact(env, ctx, { module: 'investor_narrative', kind: 'metric', fact_key: `metric:${users.uid}`, period: '2026-10-26', value: 1180, as_of: '2026-10-26' });
  await landFact(env, ctx, { module: 'investor_narrative', kind: 'metric', fact_key: `metric:${users.uid}`, period: '2026-10-30', value: 1240, as_of: '2026-10-30' });
  await env.DB.prepare("INSERT INTO spinout_deck_overrides (project_id, version, field_key, value) VALUES (?, 1, 'traction', 'We have 2,000 weekly active users.')").bind(P).run();
  const { stated, metrics } = await checkInputs(env, P, 1);
  assert.deepEqual(metrics.active_users, { value: 1240, source: 'From PostHog · Weekly active users · as of 2026-10-30' }, 'the latest fact, with its source');
  const [m] = consistencyCheck(stated, metrics).filter((x) => x.figure === 'active_users');
  assert.deepEqual(m, { figure: 'active_users', stated_value: 2000, stated_source: 'Narrative · traction', metric_value: 1240, metric_source: 'From PostHog · Weekly active users · as of 2026-10-30' });
  assert.equal(consistencyCheck([{ figure: 'active_users', value: 1250, source: 'Narrative · traction' }], metrics).length, 0, 'within 2% agrees');
  // The readiness score never counts it: the narrative item is unchanged by a PostHog mismatch.
  const narrative = (await computeReadiness(env, P)).find((x) => x.key === 'narrative')!;
  assert.equal(narrative.score, null, 'nothing scored is compared, though PostHog disagrees');
});

test('a figure is the founder\'s "active users" metric only, never another role\'s, and none without a value', async () => {
  const { env } = await fixture();
  const ctx = { integrationId: PH, projectId: P };
  const signups = await track(env, { integrationId: PH, projectId: P, userId: FOUNDER, insight: { short_id: INSIGHT_A, name: 'Active sign-ups' }, role: 'new_users', module: 'pitch_deck' });
  await landFact(env, ctx, { module: 'pitch_deck', kind: 'metric', fact_key: `metric:${signups.uid}`, period: '2026-10-30', value: 90, as_of: '2026-10-30' });
  assert.equal(await posthogFigure(env, P, 'active_users'), null, 'an insight named "active" is not active users unless the founder said so');
  const { metrics } = await checkInputs(env, P, 1);
  assert.equal(metrics.active_users, undefined);
});

test('two "active users" metrics: the one read most recently is the figure', async () => {
  const { env } = await fixture();
  const ctx = { integrationId: PH, projectId: P };
  const a = await track(env, { integrationId: PH, projectId: P, userId: FOUNDER, insight: { short_id: 'Old11111', name: 'Monthly active users' }, role: 'active_users', module: 'pitch_deck' });
  const b = await track(env, { integrationId: PH, projectId: P, userId: FOUNDER, insight: { short_id: 'New22222', name: 'Weekly active users' }, role: 'active_users', module: 'pitch_deck' });
  await landFact(env, ctx, { module: 'pitch_deck', kind: 'metric', fact_key: `metric:${a.uid}`, period: '2026-09-30', value: 4000, as_of: '2026-09-30' });
  await landFact(env, ctx, { module: 'pitch_deck', kind: 'metric', fact_key: `metric:${b.uid}`, period: '2026-10-30', value: 1240, as_of: '2026-10-30' });
  const f = await posthogFigure(env, P, 'active_users');
  assert.deepEqual([f?.value, f?.name], [1240, 'Weekly active users']);
});
