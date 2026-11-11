/**
 * D4586 part 2 (#4586) — methodology v2's decision bar, on the shipped paths: the real evidence
 * reader (`services/validateEvidence.ts`), `recordDecision` and the Verdict record
 * (`services/records/verdict.ts`), on real SQLite with migration 202611091102. Covers the four
 * cases #4586 names: duplicate source links, unrelated-hypothesis evidence, missing experiment
 * results and genuinely distinct sources, and that a decision recorded before v2 keeps its meaning.
 * Every venture and person below is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/validate_decision_methodology_4586.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { recordDecision, decisionById, decisionMethod } from '../src/services/verdict.ts';
import { evidenceFor, experimentWord } from '../src/services/validateEvidence.ts';
import { verdictSpec, coverageLine, V1_REASON } from '../src/services/records/verdict.ts';
import { ensurePainGroupsSchema } from '../src/services/painGroups.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const SQL_DIR = resolve(process.cwd(), 'cloudflare-worker/sql');
const BASELINE = readFileSync(join(SQL_DIR, 'schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(join(SQL_DIR, 'migrations', file), 'utf8');
const FOUNDER = 10;
const P = 1;
const founder = { id: FOUNDER, role: 'founder', founder_id: 1001 } as any;

async function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  // verdict_d693's fixture: the tables migrations 440 to 464 alter, from the baseline.
  for (const t of ['users', 'projects', 'activity_logs', 'discovery_interviews', 'interview_pain_severities', 'pain_groups',
    'pain_group_aliases', 'hypotheses', 'hypothesis_pain_links', 'waitlist_signups', 'metric_targets', 'competitor_analyses',
    'competitor_candidates', 'competitor_sources', 'competitor_signals', 'validation_decisions', 'mvp_features', 'roadmap_okrs']) {
    db.exec(tableFromBaseline(BASELINE, t));
  }
  db.exec('ALTER TABLE projects ADD COLUMN icp_definition_meta TEXT');
  db.exec(sqlOf('255_hypothesis_verdict_history.sql'));
  db.exec(sqlOf('311_revenue_entries.sql').replace(/REFERENCES documents\(id\)/, ''));
  db.exec(sqlOf('440_validate_cycle_stores.sql'));
  db.exec(sqlOf('464_verdict_decisions.sql'));
  db.exec(sqlOf('459_cycle_activity_convention.sql'));
  db.exec(sqlOf('460_validate_record_stores.sql'));
  db.exec(sqlOf('202611091102_validate_decision_methodology.sql'));
  db.exec(`INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (${FOUNDER}, 'founder', 'Fay Founder', 'fay@example.test', 1, 1001)`);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Acme Dispatch', 1001)`);
  const env = { ENVIRONMENT: 'development', DB: d1Over(db) } as any;
  await ensurePainGroupsSchema(env);
  return { db, env };
}

const hypothesis = (db: any, code: string) =>
  Number((db.prepare('INSERT INTO hypotheses (project_id, code, claim) VALUES (?, ?, ?) RETURNING id').get(P, code, `${code} claim`) as any).id);
const interview = (db: any, name: string | null, company: string | null = null, pains: string[] = []) =>
  Number((db.prepare("INSERT INTO discovery_interviews (project_id, interviewee_name, interviewee_company, interview_date, pains_json) VALUES (?, ?, ?, '2026-10-01', ?) RETURNING id")
    .get(P, name ?? '', company, JSON.stringify(pains)) as any).id);
const link = (db: any, h: number, kind: string, ref: string | number, direction = 'supports') =>
  db.prepare('INSERT INTO hypothesis_evidence_links (uid, project_id, hypothesis_id, kind, ref_id, direction) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), P, h, kind, String(ref), direction);
const experiment = (db: any, h: number, title: string, status: string, result: string | null) =>
  Number((db.prepare('INSERT INTO hypothesis_experiments (uid, project_id, hypothesis_id, title, status, result) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .get(crypto.randomUUID(), P, h, title, status, result) as any).id);
const decide = async (env: any, scope: 'venture' | number, keys: string[]) =>
  recordDecision(env, founder, { id: P }, { decision: 'proceed', for: scope, reasoning: 'Our call', evidence: keys });
const ids = async (env: any) => (await evidenceFor({ env, projectId: P })).map((e) => e.id);

/** The Verdict record, as the record route draws it. */
async function record(env: any, id: number) {
  const spec = verdictSpec();
  const ctx = { env, projectId: P, user: founder, project: { id: P, founder_id: 1001 } } as any;
  const content = await spec.record!(ctx, String(id));
  const evidence = await spec.sections!.find((s) => s.key === 'evidence')!.read(ctx, String(id));
  return { content, evidence };
}

test('duplicate source links: five links to one interview are five relationships and one interview, and do not meet the bar', async () => {
  // Mutations checked: counting links instead of sources (state given); the record dropping excluded links.
  const { db, env } = await fixture();
  const h1 = hypothesis(db, 'H1');
  const themes = ['slow dispatch', 'late invoices', 'manual quotes', 'lost loads', 'idle trucks'];
  const iv = interview(db, 'Rae Carrier', null, themes);
  for (const t of themes) {
    const g = Number((db.prepare('INSERT INTO pain_groups (project_id, title) VALUES (?, ?) RETURNING id').get(P, t) as any).id);
    db.prepare("INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (?, ?, 'supports')").run(h1, g);
  }
  const keys = await ids(env);
  assert.equal(keys.length, 5, 'the reader gives one item per link');
  const r = await decide(env, h1, keys);
  assert.equal(r.state, 'withheld');
  assert.deepEqual([r.coverage.links, r.coverage.sources, r.coverage.counted, r.coverage.interviews, r.coverage.interviewees], [5, 1, 1, 1, 1]);
  // The decision's evidence holds the one counted piece; the four repeats are kept, with why.
  assert.equal((await decisionById(env, P, r.id))!.evidence_count, 1);
  const m = await decisionMethod(env, r.id);
  assert.deepEqual(m.excluded.map((x) => [x.source_key, x.reason]), Array(4).fill([`interview:${iv}`, 'duplicate_source']));
  const { content, evidence } = await record(env, r.id);
  assert.deepEqual(content.facts[4], {
    label: 'Counted (methodology v2)',
    value: '5 relationships · 1 source · 1 interview · 1 interviewee · organizations not recorded · 1 of 5 counted: 1 supporting, 0 contradicting',
  });
  assert.equal(evidence.rows.length, 5, 'every checked link stays visible');
  assert.deepEqual(evidence.rows.slice(1).map((x: any) => x.b), Array(4).fill('Not counted: same source as another link'));
});

test('genuinely distinct sources: five interviews from five people meet the bar, a contradiction counting like a supporter', async () => {
  // Mutations checked: contradicting sources left out of the bar (withheld); breadth read from links, not interviews.
  const { db, env } = await fixture();
  const h1 = hypothesis(db, 'H1');
  const people: [string, string][] = [['Ann', 'Haul Co'], ['Ben', 'Haul Co'], ['Cy', 'Fleetwise'], ['Di', 'Fleetwise'], ['Ed', 'Roadrun']];
  people.forEach(([name, co], i) => link(db, h1, 'interview', interview(db, name, co), i === 4 ? 'contradicts' : 'supports'));
  const r = await decide(env, h1, await ids(env));
  assert.equal(r.state, 'given');
  assert.deepEqual(
    [r.coverage.links, r.coverage.sources, r.coverage.counted, r.coverage.counted_supporting, r.coverage.counted_contradicting, r.coverage.interviewees, r.coverage.organizations],
    [5, 5, 5, 4, 1, 5, 3],
  );
  assert.deepEqual((await decisionMethod(env, r.id)).excluded, []);
  // Breadth is stored as counts; no name is in the decision's tables.
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM validation_decision_method').all()).includes('Haul Co'), false);
});

test('unrelated hypothesis evidence: a decision on H1 counts only H1\'s evidence; a venture decision counts every claim', async () => {
  // Mutations checked: the hypothesis match removed from decisionEvidenceV2 (H1 decision given).
  const { db, env } = await fixture();
  const h1 = hypothesis(db, 'H1');
  const h2 = hypothesis(db, 'H2');
  for (let i = 0; i < 5; i++) link(db, i < 3 ? h1 : h2, 'interview', interview(db, `P${i}`, 'Co'));
  const keys = await ids(env);
  const one = await decide(env, h1, keys);
  assert.equal(one.state, 'withheld');
  assert.deepEqual([one.coverage.counted, one.coverage.excluded.map((x) => x.reason)], [3, ['other_hypothesis', 'other_hypothesis']]);
  const { evidence } = await record(env, one.id);
  assert.deepEqual(evidence.rows.map((x: any) => x.b).slice(3), Array(2).fill('Not counted: evidence for another hypothesis'));
  const all = await decide(env, 'venture', keys);
  assert.deepEqual([all.state, all.coverage.counted], ['given', 5]);
});

test('missing experiment results: planned, running and done-without-result experiments are kept, marked incomplete and not counted', async () => {
  // Mutations checked: an experiment counted whatever its result; the reader's label back to the bare status.
  const { db, env } = await fixture();
  const h1 = hypothesis(db, 'H1');
  link(db, h1, 'experiment', experiment(db, h1, 'Pilot', 'planned', null));
  link(db, h1, 'experiment', experiment(db, h1, 'Pricing page', 'running', null));
  link(db, h1, 'experiment', experiment(db, h1, 'Fake door', 'done', '  '));
  link(db, h1, 'experiment', experiment(db, h1, 'Paid trial', 'done', '3 of 10 paid'));
  const items = await evidenceFor({ env, projectId: P });
  assert.deepEqual(items.map((e) => [e.label, e.observed]), [
    ['Pilot · Planned · no result yet', false],
    ['Pricing page · Running · no result yet', false],
    ['Fake door · Done · no result recorded', false],
    ['Paid trial · 3 of 10 paid', true],
  ]);
  const r = await decide(env, h1, items.map((e) => e.id));
  assert.deepEqual([r.state, r.coverage.counted], ['withheld', 1]);
  assert.deepEqual(r.coverage.excluded.map((x) => x.reason), Array(3).fill('no_observed_result'));
  assert.equal(experimentWord('done', null), 'Done · no result recorded');
  assert.equal(experimentWord('running', 'Lifted 4%'), 'Lifted 4%');
  // The form's options say the same, so its note can count as the Worker does.
  const ctx = { env, projectId: P, user: founder, project: { id: P, founder_id: 1001 } } as any;
  const opts: any = await verdictSpec().formOptions!(ctx, {});
  assert.deepEqual(opts.evidence.options.map((o: any) => o.observed), [false, false, false, true]);
  assert.ok(opts.evidence.options.every((o: any) => /^experiment:\d+$/.test(o.source)));
});

test('history keeps its meaning: a decision recorded before v2 is read as v1 and never recounted', async () => {
  // Mutations checked: the record recounting v1 rows into a v2 coverage line.
  const { db, env } = await fixture();
  db.exec(`INSERT INTO validation_decisions (id, project_id, decision, state, decided_by) VALUES (7, ${P}, 'proceed', 'given', ${FOUNDER})`);
  for (let i = 1; i <= 5; i++) {
    // Five links to one interview, counted as five under v1.
    db.exec(`INSERT INTO validation_decision_evidence (uid, decision_id, kind, ref_id, label, direction) VALUES ('v1-${i}', 7, 'interview', 'pain-${i}-3', 'Interview naming a theme', 'supports')`);
  }
  assert.equal((await decisionMethod(env, 7)).method, null);
  const { content } = await record(env, 7);
  assert.deepEqual(content.facts[2], { label: 'Evidence', value: '5 items' });
  assert.deepEqual(content.facts[4], { label: 'Counted', value: null, reason: V1_REASON });
  assert.equal(coverageLine(null), null);
});
