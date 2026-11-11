/**
 * D4225 (#4225): seed the "From Axal" skill library into H2's lifecycle
 * (D4160). Each library skill (`skillLibrary.generated.ts`, built from
 * `skills/<slug>.md` and `skills/cases/<slug>.json`) becomes an Axal draft
 * with its golden cases; a second admin reviews it, its cases run on each
 * model, and only then is it published, through H2's routes. Nothing here
 * publishes, and no row is written as published.
 *
 * Idempotent by slug: a skill already in the library (draft, published or
 * retired) keeps its text. A draft gains only the cases whose IDENTITY no
 * live case has (D5336, `skillCaseIdentity.ts`): `case_id` + `revision` for a
 * scenario, `<slug>#<sha12>` for a golden case. A live or historical case is
 * never edited or replaced; a changed revision is a new case, which the
 * draft's review and evals then cover before any publish. A published or
 * retired skill gains nothing. A skill whose sources, or whose live cases plus
 * the new ones, exceed `CASES_MAX` is refused (`cases_max`).
 *
 * The library format: frontmatter `name` (the slug), `description`, `roles`,
 * `tools`, `output`, `taxonomy: {<skills.slug>: <level>}` and `version`, then
 * numbered steps. Its primary area and level come from the first taxonomy tag
 * that maps to a radar axis, using that tag's own level.
 */
import type { Env } from '../../types';
import { ROLES } from './catalogue';
import { checkDraft, type SkillDraft } from './skills';
import { CASES_MAX, checkCase } from './skillLifecycle';
import { caseIdentity, goldenName, storedCaseIdentity, type CaseIdentity } from './skillCaseIdentity';
import { SKILL_LIBRARY, type LibraryEntry } from './skillLibrary.generated';
import { aiAdminAuditStatement } from './adminAudit';
import { RADAR_AXES } from '../skillsTaxonomySchema';

const ROLE_KEYS: ReadonlySet<string> = new Set(ROLES.map((r) => r.key));

/** A display name from a slug: "board-meeting-brief" → "Board meeting brief". */
export const nameOfSlug = (slug: string) => slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

const flowList = (v: string | undefined): string[] | null => {
  const m = /^\[(.*)\]$/.exec((v ?? '').trim());
  return m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : null;
};
const flowMap = (v: string | undefined): Array<{ slug: string; level: string }> | null => {
  const m = /^\{(.*)\}$/.exec((v ?? '').trim());
  if (!m) return null;
  const out: Array<{ slug: string; level: string }> = [];
  for (const part of m[1].split(',')) {
    const [slug, level] = part.split(':').map((x) => x.trim());
    if (!slug || !level) return null;
    out.push({ slug, level });
  }
  return out;
};

/** A library SKILL.md read into `checkDraft`'s shape, or null when it is not one. Strict: only the library's own keys. */
export function readLibrarySkill(md: string): Record<string, unknown> | null {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(md);
  if (!m) return null;
  const front: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!kv || kv[1] in front) return null;
    front[kv[1]] = kv[2].trim();
  }
  const steps: string[] = [];
  for (const line of m[2].split('\n')) {
    if (!line.trim()) continue;
    const s = /^\d+\.\s+(\S.*)$/.exec(line);
    if (!s) return null;
    steps.push(s[1]);
  }
  const roles = flowList(front.roles); const tools = flowList(front.tools); const tags = flowMap(front.taxonomy);
  if (!front.name || !front.description || !roles || !tools || !tags) return null;
  return { slug: front.name, name: nameOfSlug(front.name), purpose: front.description, steps, tools, output_kind: front.output, tags, roles };
}

/** The skill's area and level: the first tag on a radar axis, and that tag's own level. */
export function areaOf(tags: ReadonlyArray<{ slug: string; level: string }>, categoryOf: (slug: string) => string | null) {
  for (const tag of tags) {
    const area = categoryOf(tag.slug);
    if (area && RADAR_AXES.some((axis) => axis.slug === area)) return { area, level: tag.level };
  }
  return { area: null, level: null };
}

export type SeedLine = { slug: string; outcome: 'created' | 'cases_added' | 'present' | 'refused'; code?: string; message?: string; cases?: number };

/** Every library skill checked against today's taxonomy and roles, without writing anything. */
export function checkLibrary(taxonomy: ReadonlySet<string>, entries: readonly LibraryEntry[] = SKILL_LIBRARY) {
  return entries.map((e) => {
    const raw = readLibrarySkill(e.skill_md);
    if (!raw) return { entry: e, ok: false as const, code: 'skill_md_invalid', message: `${e.slug}.md is not in the library format.` };
    const d = checkDraft(raw, { taxonomy, roleKeys: ROLE_KEYS });
    if (!d.ok) return { entry: e, ok: false as const, code: d.code, message: d.message };
    if (d.draft.slug !== e.slug) return { entry: e, ok: false as const, code: 'slug_invalid', message: `${e.slug}.md names ${d.draft.slug}.` };
    // A scenario is named by its own `name` (D5336); a golden case, which has none, by its slug.
    const cases = e.cases.map((k) => checkCase({ name: k.name ?? goldenName(e.slug), input: k.input, expect: k.expect }));
    const bad = cases.find((k) => !k.ok);
    if (bad && !bad.ok) return { entry: e, ok: false as const, code: bad.code, message: bad.message };
    if (!cases.length) return { entry: e, ok: false as const, code: 'case_missing', message: `${e.slug} has no golden case.` };
    if (cases.length > CASES_MAX) return { entry: e, ok: false as const, code: 'cases_max', message: `${e.slug} has ${cases.length} cases; a skill holds at most ${CASES_MAX} live cases.` };
    const ok = cases.filter((k): k is Extract<typeof k, { ok: true }> => k.ok)
      .map((k, i) => ({ ...k, case_id: e.cases[i].case_id ?? null, revision: e.cases[i].revision ?? null }));
    return { entry: e, ok: true as const, draft: d.draft as SkillDraft, cases: ok };
  });
}

/** One case row, with the source identity it was seeded from (D5336). */
const insertCase = (env: Env, skillId: number, k: { name: string; input: unknown; expect: unknown; id: CaseIdentity }, adminId: number) =>
  env.DB.prepare('INSERT INTO agent_skill_cases (uid, skill_id, name, input_json, expect_json, created_by, source_case_id, source_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(uid(), skillId, k.name, JSON.stringify(k.input), JSON.stringify(k.expect), adminId, k.id.case_id, k.id.revision);

const uid = () => { const b = new Uint8Array(16); crypto.getRandomValues(b); return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(''); };

/**
 * Create every library skill that is not in the library yet, as an Axal draft
 * with its golden cases, by `adminId`, and audit the run (H5's admin audit).
 * Returns one line per skill. Nothing is published.
 */
export async function seedLibrary(env: Env, adminId: number, reason: string, entries: readonly LibraryEntry[] = SKILL_LIBRARY): Promise<SeedLine[]> {
  const tax = ((await env.DB.prepare('SELECT slug FROM skills WHERE is_active = 1').all<{ slug: string }>()).results ?? []).map((r) => r.slug);
  const checked = checkLibrary(new Set(tax), entries);
  const lines: SeedLine[] = [];
  for (const c of checked) {
    if (!c.ok) { lines.push({ slug: c.entry.slug, outcome: 'refused', code: c.code, message: c.message }); continue; }
    const d = c.draft;
    const ids: CaseIdentity[] = await Promise.all(c.cases.map((k) => caseIdentity(d.slug, k)));
    const dup = ids.find((x, i) => ids.findIndex((y) => y.key === x.key) !== i);
    if (dup) { lines.push({ slug: d.slug, outcome: 'refused', code: 'case_identity_duplicate', message: `Two of ${d.slug}'s cases are ${dup.key}.` }); continue; }
    const cases = c.cases.map((k, i) => ({ ...k, id: ids[i] }));
    const existing = await env.DB.prepare("SELECT id, status FROM agent_skills WHERE scope = 'hq' AND company_id IS NULL AND slug = ?").bind(d.slug).first<{ id: number; status: string }>();
    if (existing) {
      // A draft the seed made, or one an admin started, keeps its text; it only gains the cases it lacks.
      if (existing.status !== 'draft') { lines.push({ slug: d.slug, outcome: 'present' }); continue; }
      const rows = (await env.DB.prepare('SELECT input_json, expect_json, source_case_id, source_revision FROM agent_skill_cases WHERE skill_id = ? AND removed_at IS NULL')
        .bind(existing.id).all<{ input_json: string; expect_json: string; source_case_id: string | null; source_revision: number | null }>()).results ?? [];
      const live = new Set((await Promise.all(rows.map((r) => storedCaseIdentity(d.slug, r)))).map((x) => x.key));
      // THE SKIP RULE: a case is added only when no live case has its identity.
      const add = cases.filter((k) => !live.has(k.id.key));
      if (!add.length) { lines.push({ slug: d.slug, outcome: 'present' }); continue; }
      if (rows.length + add.length > CASES_MAX) {
        lines.push({ slug: d.slug, outcome: 'refused', code: 'cases_max', message: `${d.slug} has ${rows.length} live cases; ${add.length} more would pass the ${CASES_MAX}-case limit.` });
        continue;
      }
      await env.DB.batch(add.map((k) => insertCase(env, existing.id, k, adminId)));
      lines.push({ slug: d.slug, outcome: 'cases_added', cases: add.length });
      continue;
    }
    const ins = await env.DB.prepare(
      `INSERT INTO agent_skills (uid, scope, company_id, slug, name, purpose, steps_json, allowed_tools_json, output_kind, created_by, updated_by)
       VALUES (?, 'hq', NULL, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id`,
    ).bind(uid(), d.slug, d.name, d.purpose, JSON.stringify(d.steps), JSON.stringify(d.tools), d.output_kind, adminId, adminId).first<{ id: number }>();
    if (!ins) { lines.push({ slug: d.slug, outcome: 'present' }); continue; }
    await env.DB.batch([
      ...d.tags.map((t) => env.DB.prepare('INSERT INTO agent_skill_tags (skill_id, taxonomy_skill_slug, level) VALUES (?, ?, ?)').bind(ins.id, t.slug, t.level)),
      ...d.roles.map((r) => env.DB.prepare('INSERT INTO agent_skill_roles (skill_id, role_key) VALUES (?, ?)').bind(ins.id, r)),
      ...cases.map((k) => insertCase(env, ins.id, k, adminId)),
    ]);
    lines.push({ slug: d.slug, outcome: 'created', cases: cases.length });
  }
  const created = lines.filter((l) => l.outcome === 'created').length;
  const added = lines.filter((l) => l.outcome === 'cases_added').length;
  if (created || added) {
    await aiAdminAuditStatement(env, {
      adminUserId: adminId, action: 'skills.library_seed', area: 'skills', subject: 'library:from-axal',
      before: null, after: { created, cases_added: added, slugs: lines.filter((l) => l.outcome === 'created' || l.outcome === 'cases_added').map((l) => l.slug) },
      reason,
    }).run();
  }
  return lines;
}
