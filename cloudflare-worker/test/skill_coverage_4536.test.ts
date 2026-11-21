/**
 * D4536 (#4536) — the skill catalogue's coverage block, pure over aggregate rows (`services/agents/skillCoverage.ts`).
 *
 * What is held:
 *   - published coverage reads the CURRENT published version's roles and tags; a draft, a retired skill and a skill
 *     with no version cover nothing;
 *   - a company skill is counted by scope and status only: nothing else of it reaches the response;
 *   - an area is none / thin / covered by its published primary tags against THIN_BELOW;
 *   - source-library files, seeded skills and published skills are three different counts;
 *   - linked agents are adoption, and executions are unavailable: neither is a run count;
 *   - a measure with no source is `{ available: false, reason }`, and an observed zero stays 0;
 *   - #3851's proposal-acceptance board (`evaluation.ts`) is not read or relabelled.
 *
 * D4536-p2 (#5969), `publishedEvaluation`:
 *   - a version with no rows is not evaluated (`available: false`), never 0 of 0; an observed zero is 0;
 *   - a required model with no result is named; the latest row per version, case and model counts once;
 *   - regressions use skillEvalCompare's comparability rule; time to resolve one is unavailable;
 *   - campaign coverage is #4668's progress, never full on one batch;
 *   - the route's reads name the published history only.
 *
 * The route's reads and the fixed query count are tested in hq_skill_lifecycle_d4160.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/skill_coverage_4536.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  THIN_BELOW, catalogueCoverage, publishedEvaluation,
  type CampaignCoverageRow, type CoverageRow, type PublishedVersionRow, type VersionEvalRow,
} from '../src/services/agents/skillCoverage.ts';

const CATEGORY = new Map([['investor_reporting', 'finance_ops'], ['cash_mgmt', 'finance_ops'], ['eng_frontend', 'engineering']]);
const ROLE_KEYS = ['ceo', 'cfo', 'cto'];
const NO_PINS = { links: 0, agents: 0, behind_current: 0, published_without_links: 0 };
const row = (o: Partial<CoverageRow> = {}): CoverageRow => ({
  scope: 'hq', status: 'published', slug: 'runway', current_version: 1,
  published_roles_json: JSON.stringify(['cfo']), published_tags_json: JSON.stringify([{ slug: 'investor_reporting', level: 'proficient' }]),
  live_cases: 1, draft_roles: 1, draft_tags: 1, review_requested: 0, ...o,
});
const cover = (rows: CoverageRow[], o: Partial<Parameters<typeof catalogueCoverage>[1]> = {}) =>
  catalogueCoverage(rows, { category: CATEGORY, roleKeys: ROLE_KEYS, librarySlugs: [], adoption: NO_PINS, draftsWithoutCurrentEvaluation: 0, ...o });

test('an empty catalogue reads observed zeros, every role uncovered and every area none', () => {
  const c = cover([]);
  assert.deepEqual(c.by_scope.hq, { draft: 0, published: 0, retired: 0, review_requested: 0 });
  assert.deepEqual(c.roles_without_published, ROLE_KEYS);
  assert.ok(c.by_area.length === 8 && c.by_area.every((a) => a.coverage === 'none' && a.published_primary === 0));
  assert.deepEqual(c.by_tag, []);
  assert.equal(c.drafts.without_current_evaluation, 0, 'an observed zero stays 0');
});

test('published coverage reads the current version only: a draft, a retired skill and an unversioned one cover nothing', () => {
  const c = cover([
    row(),
    row({ slug: 'draft-only', status: 'draft', current_version: 0, published_roles_json: null, published_tags_json: null }),
    row({ slug: 'old', status: 'retired', published_roles_json: JSON.stringify(['ceo']) }),
    // Mutation checked: dropping the `current_version < 1` guard counts this one for cto and this test fails.
    row({ slug: 'broken', current_version: 0, published_roles_json: JSON.stringify(['cto']) }),
  ]);
  assert.deepEqual(c.by_role, [{ role: 'ceo', published: 0 }, { role: 'cfo', published: 1 }, { role: 'cto', published: 0 }]);
  assert.deepEqual(c.roles_without_published, ['ceo', 'cto']);
  assert.deepEqual([c.by_scope.hq.published, c.by_scope.hq.draft, c.by_scope.hq.retired], [2, 1, 1]);
});

test('a role listed twice in a version counts once, and an unknown role is not invented', () => {
  const c = cover([row({ published_roles_json: JSON.stringify(['cfo', 'cfo', 'not_a_role']) })]);
  assert.deepEqual(c.by_role.map((r) => r.published), [0, 1, 0]);
  assert.ok(!c.by_role.some((r) => r.role === 'not_a_role'));
});

test('areas are none / thin / covered by published primary tags; a secondary tag reaches `published_any` only', () => {
  const tags = (...s: string[]) => JSON.stringify(s.map((slug) => ({ slug, level: 'working' })));
  const fin = Array.from({ length: THIN_BELOW }, (_, i) => row({ slug: `f${i}`, published_tags_json: tags('investor_reporting', 'eng_frontend') }));
  const c = cover([...fin, row({ slug: 'e', published_tags_json: tags('eng_frontend') })]);
  const area = (s: string) => c.by_area.find((a) => a.area === s)!;
  assert.deepEqual([area('finance_ops').coverage, area('finance_ops').published_primary], ['covered', THIN_BELOW]);
  // Mutation checked: counting a secondary tag as primary makes engineering `covered` and this fails.
  assert.deepEqual([area('engineering').coverage, area('engineering').published_primary, area('engineering').published_any], ['thin', 1, THIN_BELOW + 1]);
  assert.equal(area('design').coverage, 'none');
  assert.deepEqual(c.by_tag, [{ slug: 'eng_frontend', primary: 1, secondary: THIN_BELOW }, { slug: 'investor_reporting', primary: THIN_BELOW, secondary: 0 }]);
  assert.deepEqual(c.by_primary_level, { working: THIN_BELOW + 1 });
});

test('a published skill with no tags is counted as untagged, not in any area', () => {
  const c = cover([row({ published_tags_json: '[]' }), row({ slug: 'bad', published_tags_json: 'not json' })]);
  assert.equal(c.published_untagged, 2);
  assert.ok(c.by_area.every((a) => a.published_any === 0));
});

test('drafts without cases, roles or tags are counted; current evaluation is unavailable on a paged read', () => {
  const d = (o: Partial<CoverageRow>) => row({ status: 'draft', current_version: 0, published_roles_json: null, published_tags_json: null, ...o });
  const c = cover([d({ slug: 'a', live_cases: 0 }), d({ slug: 'b', draft_roles: 0, draft_tags: 0 }), d({ slug: 'c' }), row()], { draftsWithoutCurrentEvaluation: null });
  assert.deepEqual({ ...c.drafts, without_current_evaluation: undefined }, { total: 3, without_cases: 1, without_roles: 1, without_tags: 1, without_current_evaluation: undefined });
  assert.deepEqual(Object.keys(c.drafts.without_current_evaluation as object).sort(), ['available', 'reason']);
  assert.equal((c.drafts.without_current_evaluation as any).available, false);
});

test('an open review is counted, and never on a retired skill', () => {
  const c = cover([row({ review_requested: 1 }), row({ slug: 'r', status: 'retired', review_requested: 1 })]);
  assert.equal(c.by_scope.hq.review_requested, 1);
});

test('a company skill is counted by scope and status, and nothing else of it is read', () => {
  const co = row({ scope: 'company', slug: null, published_roles_json: null, published_tags_json: null, live_cases: 0, draft_roles: 0, draft_tags: 0 });
  const c = cover([co, { ...co, status: 'draft' }], { librarySlugs: ['runway'] });
  assert.deepEqual(c.by_scope.company, { draft: 1, published: 1, retired: 0, review_requested: 0 });
  assert.deepEqual(c.by_scope.hq, { draft: 0, published: 0, retired: 0, review_requested: 0 });
  // Mutation checked: letting a company draft into `drafts` makes total 1 and this fails.
  assert.equal(c.drafts.total, 0);
  assert.deepEqual(c.roles_without_published, ROLE_KEYS);
  assert.deepEqual(c.sources.source_only, ['runway']);
});

test('library files, seeded skills and published skills are three counts', () => {
  const c = cover([row({ slug: 'runway' }), row({ slug: 'board-brief', status: 'draft', current_version: 0 }), row({ slug: 'authored-here' })],
    { librarySlugs: ['runway', 'board-brief', 'not-seeded'] });
  assert.deepEqual(c.sources, { library_files: 3, source_only: ['not-seeded'], seeded: 2, seeded_published: 1, authored_in_store: 1 });
});

test('linked agents are adoption, and coverage serves no execution count of its own', () => {
  const c = cover([row()], { adoption: { links: 4, agents: 3, behind_current: 1, published_without_links: 0 } });
  assert.deepEqual(c.adoption, { links: 4, agents: 3, pinned_behind_current: 1, published_without_links: 0 });
  assert.equal(c.executions.available, false);
  assert.ok(!('count' in c.executions) && !('value' in c.executions), 'no number stands in for a missing measure');
  assert.match(c.executions.reason, /D4536-p4/, 'executions are served beside coverage, from completed runs');
});

// ── D4536-p2 (#5969): publishedEvaluation, the published versions' evaluation ─────────────────────────────

const M1 = 'model-one', M2 = 'model-two', SHA = 'a'.repeat(64), EV = 3;
const NOW = new Date('2026-11-15T12:00:00Z');
const ver = (o: Partial<PublishedVersionRow> = {}): PublishedVersionRow => ({
  skill_uid: 's1', version: 1, case_keys: ['k1'], required_models: [M1], models_source: 'version_evidence', ...o,
});
const ev = (o: Partial<VersionEvalRow> = {}): VersionEvalRow => ({
  kind: 'latest', skill_uid: 's1', version: 1, case_key: 'k1', model_id: M1, result: 'pass', run_at: '2026-11-15 09:00:00',
  evaluator_version: EV, case_sha256: SHA, ...o,
});
const evaluate = (v: PublishedVersionRow[], r: VersionEvalRow[], campaign: Parameters<typeof publishedEvaluation>[2]['campaign'] = null) =>
  publishedEvaluation(v, r, { currentEvaluatorVersion: EV, now: NOW, campaign });

test('D4536-p2: a version with no rows is not evaluated, never 0 of 0; an observed zero is a number', () => {
  const none = evaluate([ver()], []);
  assert.deepEqual(none.versions, { published: 1, evaluated: 0, unevaluated: 1, unevaluated_skills: ['s1'] });
  for (const m of [none.results, none.freshness, none.identity, none.skills[0].results, none.skills[0].regressions, none.regressions.since_previous_run]) {
    assert.equal((m as any).available, false);
    assert.ok(!('pass' in (m as object)) && !('fail' in (m as object)), 'no count stands in for a missing measure');
  }
  assert.deepEqual([none.required.units, none.required.recorded, none.required.missing], [1, 0, 1]);
  // Rows exist and none failed: fail is an observed 0, not a missing measure.
  const seen = evaluate([ver()], [ev()]);
  assert.deepEqual(seen.results, { pass: 1, fail: 0, not_run: 0 });
  assert.deepEqual(seen.skills[0].results, { pass: 1, fail: 0, not_run: 0 });
  assert.equal(seen.versions.unevaluated, 0);
});

test('D4536-p2: a required model with no result is named, apart from the models that ran', () => {
  const e = evaluate([ver({ case_keys: ['k1', 'k2'], required_models: [M1, M2] })], [ev(), ev({ case_key: 'k2', result: 'fail' })]);
  const s = e.skills[0];
  assert.deepEqual(s.required.models_without_result, [M2]);
  assert.deepEqual(s.required.missing, [{ case_key: 'k1', model_id: M2 }, { case_key: 'k2', model_id: M2 }]);
  assert.deepEqual([e.required.units, e.required.recorded, e.required.missing, e.required.models_without_result, e.required.versions_incomplete], [4, 2, 2, 1, 1]);
  assert.deepEqual(s.by_model, { [M1]: { pass: 1, fail: 1, not_run: 0 } });
});

test('D4536-p2: a unit counts once, the latest; rows of another version or skill are not this version\'s', () => {
  const e = evaluate([ver({ version: 2 })], [
    ev({ version: 2, result: 'pass', run_at: '2026-11-14 09:00:00' }),
    // Mutation checked: keeping the first row seen instead of the later one → pass 1, fail 0 and this fails.
    ev({ version: 2, result: 'fail', run_at: '2026-11-15 09:00:00' }),
    ev({ version: 3, result: 'not_run' }),
    ev({ skill_uid: 'other', version: 2, result: 'not_run' }),
  ]);
  assert.deepEqual(e.results, { pass: 0, fail: 1, not_run: 0 });
  assert.equal(e.skills[0].cases.length, 1);
});

test('D4536-p2: regressions follow skillEvalCompare: same case text, model and evaluator, or not comparable', () => {
  const v = ver({ version: 2 });
  const prior = (o: Partial<VersionEvalRow>) => ev({ kind: 'prior', version: 2, run_at: '2026-11-14 09:00:00', ...o });
  const regressed = evaluate([v], [prior({}), ev({ version: 2, result: 'fail' })]);
  assert.equal(regressed.regressions.since_previous_run.regressed, 1);
  assert.equal(regressed.skills[0].regressions.since_previous_run, 1);
  // The evaluator moved between the runs: not a regression, said as evaluator_changed.
  // Mutation checked: comparing results without pairOutcome (pass → fail alone) counts it and this fails.
  const judged = evaluate([v], [prior({ evaluator_version: EV - 1 }), ev({ version: 2, result: 'fail' })]);
  assert.deepEqual([judged.regressions.since_previous_run.regressed, judged.regressions.since_previous_run.evaluator_changed], [0, 1]);
  const text = evaluate([v], [prior({ case_sha256: 'b'.repeat(64) }), ev({ version: 2, result: 'fail' })]);
  assert.deepEqual([text.regressions.since_previous_run.regressed, text.regressions.since_previous_run.case_changed], [0, 1]);
  // Against the previous version's latest rows.
  const release = evaluate([v], [ev({ version: 1 }), ev({ version: 2, result: 'fail' })]);
  assert.equal(release.skills[0].regressions.since_previous_version, 1);
  assert.equal((release.regressions.since_previous_version as any).regressed, 1);
  // v1 has no previous version: unavailable, not zero.
  assert.equal((evaluate([ver()], [ev()]).regressions.since_previous_version as any).available, false);
  assert.equal(evaluate([ver()], [ev()]).skills[0].regressions.since_previous_version, null);
  assert.equal(release.regressions.time_to_resolve.available, false);
});

test('D4536-p2: freshness is the time since the latest run; identity names the evaluator and unrecorded case text', () => {
  const e = evaluate([ver(), ver({ skill_uid: 's2' })], [
    ev({ run_at: '2026-11-15 09:00:00' }),
    ev({ skill_uid: 's2', run_at: '2026-11-13 12:00:00', evaluator_version: null, case_sha256: null }),
  ]);
  assert.deepEqual(e.freshness, { newest_run_at: '2026-11-15 09:00:00', hours_since_newest: 3, oldest_last_run_at: '2026-11-13 12:00:00', hours_since_oldest: 48 });
  assert.deepEqual(e.skills.map((s) => s.hours_since_last_run), [3, 48]);
  assert.deepEqual(e.identity, {
    current_evaluator_version: EV, evaluator_versions: [EV],
    rows_on_current_evaluator: 1, rows_on_other_evaluator: 0, rows_evaluator_not_recorded: 1, rows_case_text_not_recorded: 1,
  });
  assert.deepEqual((e.skills[1].identity as any), { evaluator_versions: [], on_current_evaluator: false, evaluator_not_recorded: 1, case_text_not_recorded: 1 });
});

test('D4536-p2: campaign coverage is #4668 progress; one batch is never full coverage', () => {
  const camp = (o: Partial<CampaignCoverageRow>): CampaignCoverageRow => ({
    uid: 'c'.repeat(32), status: 'complete', started_at: '2026-11-14 09:00:00', finished_at: '2026-11-14 10:00:00',
    total: 2, done: 2, skipped: 0, pending: 0, published_not_done: 0, ...o,
  });
  const full = (o: Partial<CampaignCoverageRow>) => (evaluate([ver()], [ev()], camp(o)).campaign as any).full_coverage;
  assert.equal(full({}), true);
  assert.equal(full({ status: 'running', done: 1, pending: 1, finished_at: null }), false, 'a first batch');
  // Mutation checked: dropping the published_not_done term reads a stale campaign as full and this fails.
  assert.equal(full({ published_not_done: 1 }), false, 'a version published since the campaign started');
  assert.equal(full({ status: 'cancelled' }), false);
  assert.equal((evaluate([ver()], [ev()], null).campaign as any).available, false);
  assert.equal((evaluate([ver()], [ev()], 'unreadable').campaign as any).available, false);
});

test('D4536-p2: the route\'s published reads name the published history only, never the draft history or a proposal table', () => {
  const src = readFileSync(new URL('../src/routes/admin_hq_skills.ts', import.meta.url), 'utf8');
  for (const name of ['PUBLISHED_VERSIONS_SQL', 'PUBLISHED_EVALS_SQL', 'LATEST_CAMPAIGN_SQL']) {
    const m = new RegExp(`const ${name} = \`([^\`]*)\``).exec(src);
    assert.ok(m, `${name} is a literal`);
    assert.doesNotMatch(m![1], /agent_skill_eval_results|draft_hash|evidence_hash|proposal/i, `${name} reads another history`);
  }
  assert.match(/const PUBLISHED_EVALS_SQL = `([^`]*)`/.exec(src)![1], /FROM agent_skill_version_evals/);
  const svc = readFileSync(new URL('../src/services/agents/skillCoverage.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(svc, /prepare\(/, 'the measures are pure; the route reads');
});

test('#3851\'s proposal acceptance board is not reused or relabelled as skill quality', () => {
  for (const f of ['../src/services/agents/skillCoverage.ts', '../src/routes/admin_hq_skills.ts']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /from '[^']*\/evaluation(\.ts)?'/, `${f} imports #3851's evaluation board`);
    assert.doesNotMatch(src, /evaluateScope|rateRole|acceptance_rate|ai_rail_proposals/, `${f} reads #3851's proposal metrics`);
  }
});
