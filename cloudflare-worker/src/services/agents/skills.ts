/**
 * D1612 (#3951, part A of #3945) — agent skills: what a skill may say, its
 * SKILL.md, whether an agent may be given it, and the agent's skills radar.
 *
 * Pure: no binding. `routes/team_skills.ts` reads and writes the tables
 * (migration 759) and calls these.
 *
 * ONE TAXONOMY (owner, 2026-11-01). A skill's tags are `skills.slug` rows of
 * the /studio taxonomy (migrations 089/090) with a seniority level, and an
 * agent's radar uses the 8 axes and the 0–5 scale a person's profile uses
 * (`SkillRadar`). An axis no skill tags is `{ available: false, reason: 'Not
 * recorded' }`, never 0.
 *
 * SKILL.md. A published version is stored as Markdown with YAML frontmatter
 * (`name`, `description`, `roles`, `tools`, `output`, `taxonomy`, `version`)
 * and the steps as an ordered list, the open Agent Skills convention.
 * `parseSkillMd` reads a pasted one as untrusted data: a small, strict reader
 * of exactly these keys, with no YAML features beyond them. The result is a
 * draft; nothing runs until an editor publishes it.
 */
import { RADAR_AXES, SENIORITY_LEVELS, type SeniorityLevel } from '../skillsTaxonomySchema';

export const OUTPUT_KINDS = ['draft', 'record_change', 'brief'] as const;
export type OutputKind = typeof OUTPUT_KINDS[number];
export const OUTPUT_LABELS: Record<OutputKind, string> = { draft: 'A draft', record_change: 'A record change', brief: 'A brief' };

export const NAME_MAX = 80;
export const PURPOSE_MAX = 300;
export const STEP_MAX = 400;
export const STEPS_MAX = 20;
export const TOOLS_MAX = 12;
export const TAGS_MAX = 12;
export const SKILL_MD_MAX = 20_000;
export const NOT_RECORDED = 'Not recorded';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const TOOL = /^[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,63}$/;
const LEVEL_SCORE: Record<SeniorityLevel, number> = { aware: 1, working: 2, proficient: 3, advanced: 4, expert: 5 };

export type Tag = { slug: string; level: SeniorityLevel };
export type SkillDraft = {
  slug: string; name: string; purpose: string; steps: string[]; tools: string[];
  output_kind: OutputKind; tags: Tag[]; roles: string[];
};
export type DraftCheck = { ok: true; draft: SkillDraft } | { ok: false; code: SkillRefusal; message: string };
export type SkillRefusal =
  | 'name_missing' | 'purpose_missing' | 'steps_invalid' | 'tools_invalid' | 'output_invalid'
  | 'tags_invalid' | 'tag_unknown' | 'roles_missing' | 'role_unknown' | 'slug_invalid' | 'skill_md_invalid';

export const SKILL_MESSAGES: Record<SkillRefusal, string> = {
  name_missing: `Give the skill a name of up to ${NAME_MAX} characters.`,
  purpose_missing: `Say what the skill does and when to use it, in up to ${PURPOSE_MAX} characters.`,
  steps_invalid: `Give between 1 and ${STEPS_MAX} steps, each up to ${STEP_MAX} characters.`,
  tools_invalid: `List up to ${TOOLS_MAX} read-only tools by name, such as hubspot.read_contacts.`,
  output_invalid: 'Choose what the skill proposes: a draft, a record change or a brief.',
  tags_invalid: `Tag the skill with 1 to ${TAGS_MAX} skills from the /studio taxonomy, each at a level: aware, working, proficient, advanced or expert.`,
  tag_unknown: 'One of the tags is not a skill in the /studio taxonomy.',
  roles_missing: 'A skill belongs to at least one agent role.',
  role_unknown: 'One of the roles is not an agent role.',
  slug_invalid: 'A skill\'s short name is lower-case letters, digits and hyphens, up to 64 characters.',
  skill_md_invalid: 'That SKILL.md could not be read. It needs frontmatter between --- lines with at least name and description, then the steps.',
};

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max + 1) : '');

/** A slug from a name: lower case, ASCII letters and digits, single hyphens. */
export function slugOf(name: string): string {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/g, '');
}

/**
 * Validate a draft as every writer must. `taxonomy` is the set of live
 * `skills.slug`; `roleKeys` the catalogue's roles.
 */
export function checkDraft(raw: any, ctx: { taxonomy: ReadonlySet<string>; roleKeys: ReadonlySet<string> }): DraftCheck {
  const no = (code: SkillRefusal): DraftCheck => ({ ok: false, code, message: SKILL_MESSAGES[code] });
  const b = raw && typeof raw === 'object' ? raw : {};
  const name = clean(b.name, NAME_MAX);
  if (!name || name.length > NAME_MAX) return no('name_missing');
  const purpose = clean(b.purpose ?? b.description, PURPOSE_MAX);
  if (!purpose || purpose.length > PURPOSE_MAX) return no('purpose_missing');
  const slug = b.slug == null || b.slug === '' ? slugOf(name) : String(b.slug);
  if (!SLUG.test(slug)) return no('slug_invalid');
  if (!Array.isArray(b.steps) || b.steps.length < 1 || b.steps.length > STEPS_MAX) return no('steps_invalid');
  const steps = b.steps.map((s: unknown) => clean(s, STEP_MAX));
  if (steps.some((s: string) => !s || s.length > STEP_MAX)) return no('steps_invalid');
  const toolsIn = b.tools ?? b.allowed_tools ?? [];
  if (!Array.isArray(toolsIn) || toolsIn.length > TOOLS_MAX || toolsIn.some((t: unknown) => typeof t !== 'string' || !TOOL.test(t))) return no('tools_invalid');
  const tools = [...new Set(toolsIn as string[])];
  const output = b.output_kind ?? b.output;
  if (!(OUTPUT_KINDS as readonly string[]).includes(output)) return no('output_invalid');
  const tagsIn = b.tags ?? b.taxonomy;
  if (!Array.isArray(tagsIn) || tagsIn.length < 1 || tagsIn.length > TAGS_MAX) return no('tags_invalid');
  const tags: Tag[] = [];
  for (const t of tagsIn) {
    if (!t || typeof t.slug !== 'string' || !(SENIORITY_LEVELS as readonly string[]).includes(t.level)) return no('tags_invalid');
    if (!ctx.taxonomy.has(t.slug)) return no('tag_unknown');
    if (!tags.some((x) => x.slug === t.slug)) tags.push({ slug: t.slug, level: t.level });
  }
  const rolesIn = b.roles;
  if (!Array.isArray(rolesIn) || rolesIn.length < 1) return no('roles_missing');
  if (rolesIn.some((r: unknown) => typeof r !== 'string' || !ctx.roleKeys.has(r))) return no('role_unknown');
  return { ok: true, draft: { slug, name, purpose, steps, tools, output_kind: output, tags, roles: [...new Set(rolesIn as string[])] } };
}

// ── SKILL.md ────────────────────────────────────────────────────────────────

/** A YAML scalar we write: always double-quoted, with quotes and backslashes escaped. */
const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export function toSkillMd(d: Pick<SkillDraft, 'name' | 'purpose' | 'steps' | 'tools' | 'output_kind' | 'tags' | 'roles'>, version: number): string {
  const lines = [
    '---',
    `name: ${q(d.name)}`,
    `description: ${q(d.purpose)}`,
    `version: ${version}`,
    `output: ${d.output_kind}`,
    `roles: [${d.roles.map(q).join(', ')}]`,
    `tools: [${d.tools.map(q).join(', ')}]`,
    'taxonomy:',
    ...d.tags.map((t) => `  - { slug: ${q(t.slug)}, level: ${t.level} }`),
    '---',
    '',
    `# ${d.name}`,
    '',
    d.purpose,
    '',
    '## Steps',
    '',
    ...d.steps.map((s, i) => `${i + 1}. ${s}`),
    '',
  ];
  return lines.join('\n');
}

/** One scalar: a double-quoted string (with \" and \\), or a bare word. */
function scalar(raw: string): string | null {
  const s = raw.trim();
  if (s.startsWith('"')) {
    const m = /^"((?:[^"\\]|\\.)*)"$/.exec(s);
    return m ? m[1].replace(/\\(["\\])/g, '$1') : null;
  }
  return /^[A-Za-z0-9_.\-/ ]{1,200}$/.test(s) ? s : null;
}

/** A flow list: [a, "b", c]. */
function list(raw: string): string[] | null {
  const s = raw.trim();
  if (!s.startsWith('[') || !s.endsWith(']')) return null;
  const inner = s.slice(1, -1).trim();
  if (!inner) return [];
  const parts = inner.match(/"(?:[^"\\]|\\.)*"|[^,]+/g) ?? [];
  const out: string[] = [];
  for (const p of parts) {
    if (!p.trim()) continue;
    const v = scalar(p);
    if (v == null) return null;
    out.push(v);
  }
  return out;
}

/**
 * Read a pasted SKILL.md into the shape `checkDraft` takes. Untrusted: only
 * the known keys, only scalars and flat lists; the steps are the numbered or
 * bulleted lines after the frontmatter. Null when it is not a SKILL.md.
 */
export function parseSkillMd(text: unknown): Record<string, unknown> | null {
  if (typeof text !== 'string' || text.length > SKILL_MD_MAX) return null;
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const out: Record<string, unknown> = {};
  const tags: Array<{ slug: string; level: string }> = [];
  let inTaxonomy = false;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const item = /^\s+-\s*\{\s*slug:\s*(.+?)\s*,\s*level:\s*(.+?)\s*\}\s*$/.exec(line);
    if (inTaxonomy && item) {
      const slug = scalar(item[1]); const level = scalar(item[2]);
      if (slug == null || level == null) return null;
      tags.push({ slug, level });
      continue;
    }
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!kv) return null;
    inTaxonomy = false;
    const [, key, value] = kv;
    if (key === 'taxonomy') { if (value.trim()) return null; inTaxonomy = true; continue; }
    if (key === 'roles' || key === 'tools') { const l = list(value); if (l == null) return null; out[key] = l; continue; }
    if (['name', 'description', 'output', 'version'].includes(key)) { const v = scalar(value); if (v == null) return null; out[key] = v; continue; }
    // An unknown key is ignored, never followed.
  }
  if (typeof out.name !== 'string' || typeof out.description !== 'string') return null;
  const steps = m[2].split(/\r?\n/).map((l) => /^\s*(?:\d+[.)]|[-*])\s+(.+)$/.exec(l)?.[1]?.trim()).filter((s): s is string => !!s);
  return { name: out.name, purpose: out.description, output_kind: out.output, roles: out.roles ?? [], tools: out.tools ?? [], tags, steps };
}

// ── Attaching to an agent ───────────────────────────────────────────────────

export type ToolGrant = { integration_uid: string; tool: string };

/** The skill's tools the agent's sponsor has not granted. Empty means it may be attached. */
export function missingTools(skillTools: readonly string[], grants: readonly ToolGrant[]): string[] {
  const granted = new Set(grants.map((g) => g.tool));
  return skillTools.filter((t) => !granted.has(t));
}

/** Why an agent may not be given a version, as the sentence the page shows; null when it may. */
export function attachRefusal(
  v: { roles: readonly string[]; tools: readonly string[]; status: string },
  agent: { role_key: string; role_label: string; grants: readonly ToolGrant[] },
): string | null {
  if (v.status === 'retired') return 'This skill is retired and cannot be added again.';
  if (!v.roles.includes(agent.role_key)) return `This skill is not one of the ${agent.role_label} role's skills.`;
  const missing = missingTools(v.tools, agent.grants);
  if (missing.length) return `Needs the ${missing.join(', ')} ${missing.length === 1 ? 'tool' : 'tools'}, which this agent's sponsor hasn't approved.`;
  return null;
}

// ── The radar ───────────────────────────────────────────────────────────────

export type Block<T> = { available: true; value: T } | { available: false; reason: string };

/**
 * The agent's 8-axis profile, on the person's 0–5 scale: per axis, the
 * highest level any attached skill tags in that category. `categoryOf` maps a
 * taxonomy slug to its axis.
 */
export function skillsRadar(tags: readonly Tag[], categoryOf: ReadonlyMap<string, string>): Array<{ slug: string; label: string; value: Block<number> }> {
  const best = new Map<string, number>();
  for (const t of tags) {
    const axis = categoryOf.get(t.slug);
    const score = LEVEL_SCORE[t.level];
    if (axis && score && score > (best.get(axis) ?? 0)) best.set(axis, score);
  }
  return RADAR_AXES.map((a) => ({
    slug: a.slug,
    label: a.label,
    value: best.has(a.slug) ? { available: true, value: best.get(a.slug)! } : { available: false, reason: NOT_RECORDED },
  }));
}
