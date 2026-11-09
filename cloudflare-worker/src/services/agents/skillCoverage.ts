/**
 * D4536 (#4536) — the skill catalogue's coverage, read for HQ's library response.
 *
 * Pure over aggregate rows, so the route reads it in a fixed number of queries and the counts are tested without D1.
 * Every figure is defined in `documentation/architecture/SKILL_ANALYTICS_METRICS.md` (source, grouping, denominator,
 * availability). Nothing here is a run: linked agents are adoption, never usage, and a measure with no source is
 * `{ available: false, reason }`, never 0.
 *
 * Published coverage reads each skill's CURRENT published version (`agent_skill_versions.roles_json` and
 * `taxonomy_json`), which is what an agent can attach and run. Draft completeness reads the working draft's tables.
 * A company skill is counted by scope and status only: no company slug, role or tag leaves this function.
 */
import { RADAR_AXES } from '../skillsTaxonomySchema.ts';

/** One `agent_skills` row with its aggregates; `slug` is null for a company skill. */
export type CoverageRow = {
  scope: 'hq' | 'company';
  status: 'draft' | 'published' | 'retired';
  slug: string | null;
  current_version: number;
  published_roles_json: string | null;
  published_tags_json: string | null;
  live_cases: number;
  draft_roles: number;
  draft_tags: number;
  review_requested: number;
};
export type AdoptionRow = { links: number; agents: number; behind_current: number; published_without_links: number };
export type Unavailable = { available: false; reason: string };

/** An area with fewer published skills than this, by primary tag, is `thin`; none at all is `none`. */
export const THIN_BELOW = 3;

const parse = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};

type Counts = { draft: number; published: number; retired: number; review_requested: number };
const counts = (): Counts => ({ draft: 0, published: 0, retired: 0, review_requested: 0 });

export function catalogueCoverage(rows: readonly CoverageRow[], ctx: {
  category: ReadonlyMap<string, string>;
  roleKeys: readonly string[];
  librarySlugs: readonly string[];
  adoption: AdoptionRow;
  /** HQ drafts whose required runs under the current evidence are not all recorded; null when this read did not compute them. */
  draftsWithoutCurrentEvaluation: number | null;
}) {
  const byScope = { hq: counts(), company: counts() };
  const byRole = new Map<string, number>(ctx.roleKeys.map((k) => [k, 0]));
  const byArea = new Map<string, { primary: number; any: number }>(RADAR_AXES.map((a) => [a.slug, { primary: 0, any: 0 }]));
  const byTag = new Map<string, { primary: number; secondary: number }>();
  const byLevel = new Map<string, number>();
  const drafts = { total: 0, without_cases: 0, without_roles: 0, without_tags: 0 };
  const hqSlugs = new Map<string, CoverageRow>();
  let untaggedPublished = 0;

  for (const r of rows) {
    const c = byScope[r.scope];
    c[r.status]++;
    if (r.status !== 'retired' && r.review_requested) c.review_requested++;
    if (r.scope !== 'hq') continue;
    if (r.slug) hqSlugs.set(r.slug, r);
    if (r.status === 'draft') {
      drafts.total++;
      if (!r.live_cases) drafts.without_cases++;
      if (!r.draft_roles) drafts.without_roles++;
      if (!r.draft_tags) drafts.without_tags++;
    }
    // Retired skills cannot be attached, so they cover nothing; a draft never published has no version to run.
    if (r.status !== 'published' || r.current_version < 1) continue;
    for (const role of new Set(parse<string[]>(r.published_roles_json, []))) {
      if (byRole.has(role)) byRole.set(role, byRole.get(role)! + 1);
    }
    const tags = parse<Array<{ slug: string; level: string }>>(r.published_tags_json, []);
    if (!tags.length) untaggedPublished++;
    const areas = new Set<string>();
    tags.forEach((t, i) => {
      const entry = byTag.get(t.slug) ?? { primary: 0, secondary: 0 };
      if (i === 0) entry.primary++; else entry.secondary++;
      byTag.set(t.slug, entry);
      const area = ctx.category.get(t.slug);
      if (area && byArea.has(area)) {
        if (i === 0) byArea.get(area)!.primary++;
        areas.add(area);
      }
    });
    if (tags[0]) byLevel.set(tags[0].level, (byLevel.get(tags[0].level) ?? 0) + 1);
    for (const a of areas) byArea.get(a)!.any++;
  }

  const library = new Set(ctx.librarySlugs);
  const sourceOnly = [...library].filter((s) => !hqSlugs.has(s)).sort();
  const seeded = [...library].filter((s) => hqSlugs.has(s));

  return {
    by_scope: byScope,
    by_role: ctx.roleKeys.map((role) => ({ role, published: byRole.get(role)! })),
    roles_without_published: ctx.roleKeys.filter((k) => byRole.get(k) === 0),
    by_area: RADAR_AXES.map((a) => {
      const n = byArea.get(a.slug)!;
      return { area: a.slug, label: a.label, published_primary: n.primary, published_any: n.any, coverage: n.primary === 0 ? 'none' : n.primary < THIN_BELOW ? 'thin' : 'covered' };
    }),
    thin_below: THIN_BELOW,
    by_tag: [...byTag].map(([slug, n]) => ({ slug, ...n })).sort((a, b) => a.slug.localeCompare(b.slug)),
    by_primary_level: Object.fromEntries([...byLevel].sort()),
    published_untagged: untaggedPublished,
    drafts: {
      ...drafts,
      without_current_evaluation: ctx.draftsWithoutCurrentEvaluation == null
        ? { available: false, reason: 'Computed on the full list only (read without ?page).' } as Unavailable
        : ctx.draftsWithoutCurrentEvaluation,
    },
    sources: {
      library_files: library.size,
      source_only: sourceOnly,
      seeded: seeded.length,
      seeded_published: seeded.filter((s) => hqSlugs.get(s)!.current_version >= 1).length,
      authored_in_store: [...hqSlugs.keys()].filter((s) => !library.has(s)).length,
    },
    adoption: {
      // Catalogue adoption: which agents pin a skill. Never a run count.
      links: ctx.adoption.links,
      agents: ctx.adoption.agents,
      pinned_behind_current: ctx.adoption.behind_current,
      published_without_links: ctx.adoption.published_without_links,
    },
    overlap: { available: false, reason: 'Overlap suggestions are not computed yet.' } as Unavailable,
    executions: { available: false, reason: 'Waits on a reliable run status (#4667).' } as Unavailable,
  };
}

export type CatalogueCoverage = ReturnType<typeof catalogueCoverage>;
