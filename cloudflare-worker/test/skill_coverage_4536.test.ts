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
 * The route's two reads and the fixed query count are tested in hq_skill_lifecycle_d4160.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/skill_coverage_4536.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THIN_BELOW, catalogueCoverage, type CoverageRow } from '../src/services/agents/skillCoverage.ts';

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

test('linked agents are adoption, and executions and overlap are unavailable rather than zero', () => {
  const c = cover([row()], { adoption: { links: 4, agents: 3, behind_current: 1, published_without_links: 0 } });
  assert.deepEqual(c.adoption, { links: 4, agents: 3, pinned_behind_current: 1, published_without_links: 0 });
  for (const m of [c.executions, c.overlap]) {
    assert.equal(m.available, false);
    assert.ok(m.reason.length > 0);
    assert.ok(!('count' in m) && !('value' in m), 'no number stands in for a missing measure');
  }
  assert.match(c.executions.reason, /#4667/);
});

test('#3851\'s proposal acceptance board is not reused or relabelled as skill quality', () => {
  for (const f of ['../src/services/agents/skillCoverage.ts', '../src/routes/admin_hq_skills.ts']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /from '[^']*\/evaluation(\.ts)?'/, `${f} imports #3851's evaluation board`);
    assert.doesNotMatch(src, /evaluateScope|rateRole|acceptance_rate|ai_rail_proposals/, `${f} reads #3851's proposal metrics`);
  }
});
