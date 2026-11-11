/**
 * D1605 (#3731, #2409 part 3) — PostHog into Validate: the founder-pressed
 * sync, survey marks, and Accept through Validate's own writers.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/posthog_validate_d1605.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ADMIN, COFOUNDER, FOUNDER, OTHER, P, PH, appFor, call, fixture } from './_posthog_cycle_fixture.ts';
import { INSIGHT_A, PERSON, SURVEY_A } from './_posthog_mcp_fake.mjs';
import { acceptProposal, dismissProposal, latestOf } from '../src/services/posthog/metrics.ts';
import { answerTo, experimentSummary, overviewOf, syncValidate } from '../src/services/posthog/validate.ts';
import { DEMAND_SOURCES, addEvidence } from '../src/services/validateWriters.ts';

const n = (db: any, sql: string, ...a: unknown[]) => Number((db.prepare(sql).get(...a) as any).n);

/**
 * D4627 (#4627) — makes the FIRST matching statement's `run`/`first`/`all`
 * throw, then every later call (including a retry re-running the SAME SQL)
 * goes through for real. Stands in for the write dying mid-request: a crash,
 * a dropped connection, a D1 500, between two of the coordinator's writes.
 */
function flaky(DB: any, matches: (sql: string) => boolean, timesToFail = 1) {
  let left = timesToFail;
  return {
    prepare(sql: string) {
      const real = DB.prepare(sql);
      if (!matches(sql)) return real;
      const api: any = {
        bind(...a: any[]) { real.bind(...a); return api; },
        all: async () => { if (left > 0) { left -= 1; throw new Error('injected failure'); } return real.all(); },
        first: async (c?: string) => { if (left > 0) { left -= 1; throw new Error('injected failure'); } return real.first(c); },
        run: async () => { if (left > 0) { left -= 1; throw new Error('injected failure'); } return real.run(); },
        // `addEvidence` writes its INSERT through `env.DB.batch(...)`, which
        // calls `runSync()` on each statement rather than `run()` — this
        // mirrors the same left-counter logic, synchronously.
        runSync: () => { if (left > 0) { left -= 1; throw new Error('injected failure'); } return real.runSync(); },
      };
      return api;
    },
    batch: (stmts: any[]) => DB.batch(stmts),
    exec: (sql: string) => DB.exec(sql),
  };
}

async function trackIn(app: any, env: any, module: string, role = 'conversion') {
  const r = await call(app, env, FOUNDER, 'POST', '/api/cycles/validate/posthog/tracked', { project: P, module, insight_short_id: INSIGHT_A, role });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.tracked.uid as string;
}
const sync = (app: any, env: any, who = FOUNDER, extra: Record<string, unknown> = {}) => call(app, env, who, 'POST', '/api/cycles/validate/posthog/sync', { project: P }, extra);

function hypothesis(db: any, id = 5, code = 'H2') {
  db.prepare("INSERT INTO hypotheses (id, project_id, code, claim) VALUES (?, ?, ?, 'Short onboarding raises activation')").run(id, P, code);
}

test('the sync: tracked metrics, the web overview, experiment results and survey counts land as facts; the waitlist never changes', async () => {
  const { env, fake, db } = await fixture();
  const app = appFor(fake);
  const uid = await trackIn(app, env, 'demand_signals');
  db.exec(`INSERT INTO waitlist_signups (project_id, email, created_at) VALUES (${P}, 'signup@example.test', '2026-10-01')`);
  const before = n(db, 'SELECT COUNT(*) AS n FROM waitlist_signups');
  const r = await sync(app, env);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.partial, false);
  const fact = (key: string) => db.prepare('SELECT module, kind, value, value_json FROM posthog_metric_facts WHERE fact_key = ?').get(key) as any;
  assert.deepEqual({ ...fact(`metric:${uid}`), value_json: undefined }, { module: 'demand_signals', kind: 'metric', value: 1240, value_json: undefined });
  const web = fact('web:7d');
  assert.equal(web.value, 820);
  assert.deepEqual(JSON.parse(web.value_json), { visitors: 820, sessions: 1104 });
  const ex = fact('experiment:7');
  assert.equal(ex.module, 'experiments');
  assert.equal(ex.value, 900);
  assert.doesNotMatch(ex.value_json, /distinct|d-3/, 'no visit or person identifier is stored');
  assert.equal(fact(`survey:${SURVEY_A}`).value, 46);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM posthog_proposals WHERE kind = 'experiment_evidence'"), 1);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM posthog_proposals WHERE kind = 'survey_signal'"), 0, 'a question nobody marked proposes nothing');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM waitlist_signups'), before, 'a funnel never changes the waitlist count');
  assert.ok((db.prepare('SELECT last_synced_at FROM integrations WHERE id = ?').get(PH) as any).last_synced_at);
  for (const who of [COFOUNDER, OTHER, ADMIN]) assert.equal((await sync(app, env, who)).status, 403, String(who));
  assert.equal((await sync(app, env, FOUNDER, { impersonated_by: ADMIN })).status, 403);
  assert.equal(fake.forbiddenCalls().length, 0);
});

test('marks: the owner marks a question; its answers become signals to confirm, with no respondent identity', async () => {
  const { env, fake, db } = await fixture();
  const app = appFor(fake);
  const list = await call(app, env, FOUNDER, 'GET', `/api/cycles/validate/posthog/surveys?project=${P}`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.surveys[0].questions.map((q: any) => [q.id, q.mark]), [['q1', null]]);
  assert.equal((await call(app, env, FOUNDER, 'PUT', `/api/cycles/validate/posthog/surveys/${SURVEY_A}/marks`, { project: P, question_id: 'qX', mark: 'would_pay' })).body.error, 'invalid_question');
  assert.equal((await call(app, env, FOUNDER, 'PUT', `/api/cycles/validate/posthog/surveys/${SURVEY_A}/marks`, { project: P, question_id: 'q1', mark: 'guess' })).body.error, 'invalid_mark');
  assert.equal((await call(app, env, COFOUNDER, 'PUT', `/api/cycles/validate/posthog/surveys/${SURVEY_A}/marks`, { project: P, question_id: 'q1', mark: 'would_pay' })).status, 403);
  assert.equal((await call(app, env, FOUNDER, 'PUT', `/api/cycles/validate/posthog/surveys/${SURVEY_A}/marks`, { project: P, question_id: 'q1', mark: 'would_pay' })).status, 200);
  await sync(app, env);
  const p = db.prepare("SELECT module, payload_json FROM posthog_proposals WHERE kind = 'survey_signal'").get() as any;
  assert.equal(p.module, 'demand_signals');
  const payload = JSON.parse(p.payload_json);
  assert.equal(payload.answer, 'We\'d pay if it synced with our calendar.');
  assert.equal(payload.mark, 'would_pay');
  assert.doesNotMatch(p.payload_json, new RegExp(`d-4|s-2|203\\.0\\.113|${PERSON.replace('.', '\\.')}`), 'no distinct_id, session_id, IP or email');
  // Accept writes a demand signal, who empty, from PostHog, to confirm.
  const id = (db.prepare("SELECT id FROM posthog_proposals WHERE kind = 'survey_signal'").get() as any).id;
  const ok = await call(app, env, FOUNDER, 'POST', `/api/cycles/validate/posthog/proposals/${id}/accept`, { project: P });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const sig = db.prepare('SELECT kind, who, source_kind, status, note, signal_date FROM demand_signals').get() as any;
  assert.deepEqual({ ...sig }, { kind: 'would_pay', who: null, source_kind: 'posthog', status: 'to_confirm', note: 'We\'d pay if it synced with our calendar.', signal_date: '2026-10-21' });
  assert.ok(DEMAND_SOURCES.includes('posthog'));
  // Clearing the mark proposes nothing more.
  await call(app, env, FOUNDER, 'PUT', `/api/cycles/validate/posthog/surveys/${SURVEY_A}/marks`, { project: P, question_id: 'q1', mark: null });
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM posthog_survey_marks'), 0);
});

test('D5352: a survey-signal retry after the target write reuses the proposal-keyed demand signal', async () => {
  const { env, fake, db } = await fixture();
  const app = appFor(fake);
  assert.equal((await call(app, env, FOUNDER, 'PUT', `/api/cycles/validate/posthog/surveys/${SURVEY_A}/marks`, {
    project: P, question_id: 'q1', mark: 'would_pay',
  })).status, 200);
  await sync(app, env);
  const proposal = db.prepare("SELECT id FROM posthog_proposals WHERE kind = 'survey_signal'").get() as any;
  const at = () => call(app, env, FOUNDER, 'POST', `/api/cycles/validate/posthog/proposals/${proposal.id}/accept`, { project: P });

  env.DB = flaky(env.DB, (sql: string) => sql.includes('SET target_ref = ?'), 1);
  const first = await at();
  assert.equal(first.status, 503, JSON.stringify(first.body));
  const target = db.prepare('SELECT id, source_proposal_id FROM demand_signals').get() as any;
  assert.equal(target.source_proposal_id, proposal.id, 'the surviving target is addressable by its proposal');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM demand_signals'), 1);
  assert.equal((db.prepare('SELECT status FROM posthog_proposals WHERE id = ?').get(proposal.id) as any).status, 'pending');

  const second = await at();
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM demand_signals'), 1, 'the retry must not duplicate the demand signal');
  const decided = db.prepare('SELECT status, target_ref FROM posthog_proposals WHERE id = ?').get(proposal.id) as any;
  assert.deepEqual({ ...decided }, { status: 'accepted', target_ref: `demand_signals:${target.id}` });
});

test('Accept an experiment: the hypothesis and direction are the founder\'s, never guessed; it lands as measured evidence', async () => {
  const { env, fake, db } = await fixture();
  const app = appFor(fake);
  hypothesis(db);
  await sync(app, env);
  const id = (db.prepare("SELECT id FROM posthog_proposals WHERE kind = 'experiment_evidence'").get() as any).id;
  const at = (b: Record<string, unknown>) => call(app, env, FOUNDER, 'POST', `/api/cycles/validate/posthog/proposals/${id}/accept`, { project: P, ...b });
  assert.equal((await at({})).body.error, 'hypothesis_required');
  assert.equal((await at({ hypothesis_id: 5 })).body.error, 'direction_required', 'direction is never inferred');
  assert.equal((await at({ hypothesis_id: 999, direction: 'supports' })).status, 404, 'another venture\'s or a missing hypothesis');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM hypothesis_experiments'), 0, 'nothing written before a valid Accept');
  const ok = await at({ hypothesis_id: 5, direction: 'contradicts' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const ex = db.prepare('SELECT id, title, method, target FROM hypothesis_experiments').get() as any;
  assert.deepEqual({ title: ex.title, method: ex.method, target: ex.target }, { title: 'Shorter onboarding', method: 'PostHog experiment', target: 'Flag short-onboarding' });
  const link = db.prepare('SELECT kind, ref_id, direction, strength FROM hypothesis_evidence_links').get() as any;
  assert.deepEqual({ ...link }, { kind: 'experiment', ref_id: String(ex.id), direction: 'contradicts', strength: 'measured' });
  assert.equal(ok.body.target_ref, `hypothesis_experiments:${ex.id}`);
  // Synced again: the decided proposal is not proposed again, and a deleted result stays deleted.
  const fid = (db.prepare("SELECT id FROM posthog_metric_facts WHERE fact_key = 'experiment:7'").get() as any).id;
  await call(app, env, FOUNDER, 'DELETE', `/api/cycles/validate/posthog/facts/${fid}?project=${P}`);
  const again = await sync(app, env);
  assert.equal(again.body.kept_deleted, 1);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM posthog_metric_facts WHERE fact_key = 'experiment:7'"), 0);
  assert.equal(n(db, "SELECT COUNT(*) AS n FROM posthog_proposals WHERE kind = 'experiment_evidence' AND status = 'pending'"), 0);
});

test('D4627: two overlapping accepts of the same experiment proposal resolve to one experiment and one evidence link', async () => {
  // THE ISSUE'S OWN REPRO SHAPE: the actual coordinator (`acceptProposal`),
  // a real store, two concurrent calls — called directly rather than
  // through HTTP, so nothing about JWT verification's own async scheduling
  // can accidentally serialize the two calls and hide the race. Every D1
  // call in this fixture is `async`, so two in-flight calls genuinely
  // interleave at each `await`, the same way two Workers requests
  // interleave on one D1 connection. Before D4627 this produced two writer
  // calls and two successful responses for one proposal (confirmed below,
  // under the mutation check); the fix claims the row BEFORE calling the
  // acceptor, so a losing caller never reaches it at all.
  const { env, fake, db } = await fixture();
  const app = appFor(fake);
  hypothesis(db);
  await sync(app, env);
  const id = (db.prepare("SELECT id FROM posthog_proposals WHERE kind = 'experiment_evidence'").get() as any).id;
  const ctx = { integrationId: PH, projectId: P, userId: FOUNDER };
  const body = { hypothesis_id: 5, direction: 'contradicts' };
  const results = await Promise.allSettled([acceptProposal(env, ctx, id, body), acceptProposal(env, ctx, id, body)]);
  const landed = results.filter((r) => r.status === 'fulfilled' && typeof r.value === 'object') as PromiseFulfilledResult<any>[];
  const decided = results.filter((r) => r.status === 'fulfilled' && r.value === 'decided');
  assert.equal(landed.length, 1, `exactly one caller should land a write: ${JSON.stringify(results)}`);
  assert.equal(decided.length, 1, `the loser should see 'decided', not write again: ${JSON.stringify(results)}`);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM hypothesis_experiments'), 1, 'two accepts wrote two experiments before D4627');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM hypothesis_evidence_links'), 1);
  const row = db.prepare("SELECT status, target_ref FROM posthog_proposals WHERE id = ?").get(id) as any;
  assert.equal(row.status, 'accepted');
  assert.equal(row.target_ref, landed[0].value.target_ref);
});

test('D4627: a failure between creating the experiment and linking it as evidence reverts to pending, and a retry lands on the SAME experiment', async () => {
  // The issue's "PostHog concurrent acceptance" evidence: "the experiment
  // acceptor creates an experiment and its evidence link before that final
  // transition". This is the window between those two writes.
  const { env, fake, db } = await fixture();
  const app = appFor(fake);
  hypothesis(db);
  await sync(app, env);
  const id = (db.prepare("SELECT id FROM posthog_proposals WHERE kind = 'experiment_evidence'").get() as any).id;
  const at = () => call(app, env, FOUNDER, 'POST', `/api/cycles/validate/posthog/proposals/${id}/accept`, { project: P, hypothesis_id: 5, direction: 'contradicts' });

  env.DB = flaky(env.DB, (sql: string) => sql.includes('INSERT INTO hypothesis_evidence_links'), 1);
  const first = await at();
  assert.equal(first.status, 503, JSON.stringify(first.body));
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM hypothesis_experiments'), 1, 'addExperiment already ran and must still be there');
  const ex1 = db.prepare('SELECT id, uid FROM hypothesis_experiments').get() as any;
  assert.equal(ex1.uid, `posthog-proposal-${id}`, 'the orphan experiment is addressable by the proposal that made it');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM hypothesis_evidence_links'), 0, 'the injected failure means no evidence link exists yet');
  assert.equal((db.prepare('SELECT status FROM posthog_proposals WHERE id = ?').get(id) as any).status, 'pending',
    'reverted — never left "accepted" over an untracked target');

  const second = await at();
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM hypothesis_experiments'), 1, 'the retry must land on the SAME experiment, not a second orphan');
  const ex2 = db.prepare('SELECT id FROM hypothesis_experiments').get() as any;
  assert.equal(ex2.id, ex1.id);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM hypothesis_evidence_links'), 1);
  const link = db.prepare('SELECT ref_id FROM hypothesis_evidence_links').get() as any;
  assert.equal(link.ref_id, String(ex1.id));
  assert.equal(second.body.target_ref, `hypothesis_experiments:${ex1.id}`);
});

test('D4627: a failure after the experiment and its evidence are written, before the proposal completes, is recoverable without a duplicate', async () => {
  // The third recoverable window the acceptance criteria name: the writes
  // are both real and correct already; only the coordinator's own final
  // write (marking the proposal `accepted`) is what fails.
  const { env, fake, db } = await fixture();
  const app = appFor(fake);
  hypothesis(db);
  await sync(app, env);
  const id = (db.prepare("SELECT id FROM posthog_proposals WHERE kind = 'experiment_evidence'").get() as any).id;
  const at = () => call(app, env, FOUNDER, 'POST', `/api/cycles/validate/posthog/proposals/${id}/accept`, { project: P, hypothesis_id: 5, direction: 'contradicts' });

  env.DB = flaky(env.DB, (sql: string) => sql.includes("SET target_ref = ?"), 1);
  const first = await at();
  assert.equal(first.status, 503, JSON.stringify(first.body));
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM hypothesis_experiments'), 1, 'the real writes already happened');
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM hypothesis_evidence_links'), 1);
  assert.equal((db.prepare('SELECT status FROM posthog_proposals WHERE id = ?').get(id) as any).status, 'pending');

  const second = await at();
  assert.equal(second.status, 200, JSON.stringify(second.body));
  // `addExperiment`'s upsert and `addEvidence`'s own upsert both make the
  // retry a no-op repeat rather than a second row of either kind.
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM hypothesis_experiments'), 1);
  assert.equal(n(db, 'SELECT COUNT(*) AS n FROM hypothesis_evidence_links'), 1);
  assert.equal((db.prepare('SELECT status, target_ref FROM posthog_proposals WHERE id = ?').get(id) as any).status, 'accepted');
});

test('D4627: accept versus dismiss settle on one outcome — the loser answers decided, not ok', async () => {
  // Direct coordinator calls, as above: HTTP's own JWT verification is
  // asynchronous and can serialize two requests enough to hide a race that
  // two bare calls to `acceptProposal`/`dismissProposal` do not.
  const { env, fake, db } = await fixture();
  const app = appFor(fake);
  hypothesis(db);
  await sync(app, env);
  const id = (db.prepare("SELECT id FROM posthog_proposals WHERE kind = 'experiment_evidence'").get() as any).id;
  const ctx = { integrationId: PH, projectId: P, userId: FOUNDER };
  const [a, d] = await Promise.all([
    acceptProposal(env, ctx, id, { hypothesis_id: 5, direction: 'contradicts' }),
    dismissProposal(env, ctx, id),
  ]);
  // Whichever wins the claim, the other must see "already decided" — never
  // both reporting success, which would be an orphan target (accept won,
  // dismiss also said ok) or a silently undone accept (dismiss won after
  // accept had already written).
  const outcomes = [typeof a === 'string' ? a : 'landed', d].sort();
  assert.deepEqual(outcomes, ['decided', 'landed'], JSON.stringify({ a, d }));
  const status = (db.prepare('SELECT status FROM posthog_proposals WHERE id = ?').get(id) as any).status;
  assert.ok(status === 'accepted' || status === 'dismissed', status);
  // Coherent either way: an accepted proposal has its experiment and link; a
  // dismissed one has neither — never one accepted with nothing written, or
  // an experiment sitting under a dismissed proposal.
  const experiments = n(db, 'SELECT COUNT(*) AS n FROM hypothesis_experiments');
  assert.equal(experiments, status === 'accepted' ? 1 : 0, `status ${status} but ${experiments} experiments`);
});

test('a tracked PostHog metric is metric evidence once PostHog has given it a value', async () => {
  const { env, fake, db } = await fixture();
  const app = appFor(fake);
  hypothesis(db);
  const uid = await trackIn(app, env, 'experiments', 'activation');
  const add = () => addEvidence(env, { projectId: P, userId: FOUNDER, hypothesisId: 5, kind: 'metric', ref_id: `posthog-${uid}`, direction: 'supports' });
  await assert.rejects(add(), /No value is recorded/);
  // A fact with no value is not a value.
  db.prepare("INSERT INTO posthog_metric_facts (integration_id, project_id, module, kind, fact_key, period, value, as_of) VALUES (?, ?, 'experiments', 'metric', ?, '2026-10-01', NULL, '2026-10-01')").run(PH, P, `metric:${uid}`);
  await assert.rejects(add(), /No value is recorded/);
  await sync(app, env);
  assert.match((await add()).link, /^evidence-\d+$/);
  await assert.rejects(addEvidence(env, { projectId: P, userId: FOUNDER, hypothesisId: 5, kind: 'metric', ref_id: 'posthog-0123456789abcdef0123456789abcdef' }), /No value is recorded/);
});

test('a rate limit ends the sync as partly synced and reads nothing more; a section with no sync says so', async () => {
  const { env, fake, db } = await fixture();
  const app = appFor(fake);
  const read: string[] = [];
  const limited = Object.assign(new Error('posthog_rate_limited'), { code: 'rate_limited' });
  const stub: any = new Proxy({}, { get: (_t, k: string) => async () => { read.push(k); if (k === 'webOverview') throw limited; return []; } });
  const ctx = { integrationId: PH, projectId: P, userId: FOUNDER, today: '2026-10-31' };
  const r = await syncValidate(env, stub, ctx);
  assert.equal(r.partial, true);
  assert.deepEqual(read, ['webOverview'], 'nothing is read after the limit');
  // A web overview with no visitors lands with no value, never 0.
  const noVisitors: any = new Proxy({}, { get: (_t, k: string) => async () => (k === 'webOverview' ? { results: [{ key: 'sessions', value: 5 }] } : []) });
  await syncValidate(env, noVisitors, ctx);
  const web = db.prepare("SELECT value, value_json FROM posthog_metric_facts WHERE fact_key = 'web:7d'").get() as any;
  assert.equal(web.value, null);
  assert.deepEqual(JSON.parse(web.value_json), { sessions: 5 });
  fake.state.status = 429;
  assert.equal((await sync(app, env)).status, 429, 'a limit before the session opens is PostHog asking us to wait');
  fake.state.status = null;
  // D1608: every section now registers its sync; the route still refuses a section with none (`no_sync`).
  const { syncFor } = await import('../src/services/posthog/metrics.ts');
  for (const s of ['validate', 'build', 'raise', 'grow'] as const) assert.ok(syncFor(s), s);
});

test('the parsers: latest value, funnel conversion, experiment summary, web overview and answers by question', () => {
  assert.equal(latestOf({ results: [{ data: [3, 7, 11] }] }), 11);
  assert.equal(latestOf({ results: [{ count: 400 }, { count: 120 }, { count: 17 }] }), 4.3, 'a funnel is its conversion, last over first');
  assert.equal(latestOf({ results: [] }), null);
  assert.equal(latestOf({ results: [{ count: 0 }, { count: 0 }] }), null, 'no first step is no conversion, never 0%');
  assert.deepEqual(experimentSummary({ variants: [{ key: 'control', exposure: 880 }, { key: 'test', exposure: 900, uplift: 3.1 }], significant: true }),
    { variants: [{ key: 'control', exposure: 880, uplift: null }, { key: 'test', exposure: 900, uplift: 3.1 }], exposures: 1780, significant: true });
  assert.deepEqual(experimentSummary({}), { variants: [], exposures: null, significant: null }, 'no exposure is not 0 exposures');
  assert.deepEqual(overviewOf({ results: [{ key: 'visitors', value: 820 }, { key: 'email', value: 1 }] }), { visitors: 820 });
  assert.equal(answerTo({ $survey_response: 'yes' }, 'q1', 0), 'yes');
  assert.equal(answerTo({ $survey_response_q2: 'later' }, 'q2', 1), 'later');
  assert.equal(answerTo({ $survey_response: 'yes' }, 'q2', 1), null, 'the first answer is not the second question\'s');
  const code = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/posthog/validate.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /console\.(log|warn|error)/, 'nothing PostHog sent is logged');
  assert.doesNotMatch(code, /waitlist_signups/);
});
