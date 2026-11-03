/**
 * D1612 (#3945, #3952), rebuilt to the v2 boards by #4224 (D4116) — the words
 * and every pure derivation behind Team › Skills: levels and the 8 areas (the
 * /studio radar), filters and sorts, the run cost line, natural fit, the
 * agent's radar, team coverage, assignment groups and the client-side preview
 * of a pasted SKILL.md.
 *
 * v2 has no roles: a skill sits in the area of its taxonomy tags, any skill
 * can go to any agent, and natural fit (the agent's persona's two areas,
 * D4117) only sorts a list. A Worker card still carries the roles it was
 * written for; `fromWorkerSkill` keeps them as `fit`, a hint, never a label.
 *
 * Nothing here reads anything. `fromWorkerLibrary` and `fromWorkerSkillPage`
 * turn the answers of `GET /api/teams/skills` and `GET /api/teams/skills/:uid`
 * (A1, #3951) into the shapes the screens draw.
 */
import { SKILL_AXES, SKILL_AXIS_ORDER } from '../../lib/assessmentMeta.js';
import { SKILL_AREAS, areaOf } from '../../lib/skillAreas.js';

/** The /studio seniority levels, 1–5 (migrations 089/090). Index 0 is "no level". */
export const LEVELS = ['', 'Aware', 'Working', 'Proficient', 'Advanced', 'Expert'];
const LEVEL_KEYS = LEVELS.map((l) => l.toLowerCase());

/** A level as a number 1–5, from a number or a level name; null when it is not one. */
export function levelOf(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 5 ? v : null;
  const i = LEVEL_KEYS.indexOf(String(v || '').trim().toLowerCase());
  return i >= 1 ? i : null;
}

/** The 8 radar categories, in the radar's order, with their labels. */
export const CATEGORIES = SKILL_AXIS_ORDER.map((slug) => ({ slug, label: SKILL_AXES[slug] }));
export const categoryLabel = (slug) => SKILL_AXES[slug] || null;

/**
 * v2 (#4224): the 8 areas of the /studio radar, in its order. `key` is the
 * address (`?tab=skills&area=finance`) and the persona's natural fit (D4117);
 * `axis` is the taxonomy's `category_slug`. Both come from the one table the
 * SkillEnergy image and the radar read (`lib/skillAreas.js`).
 */
export const AREAS = SKILL_AREAS.map((a) => ({ key: a.key, axis: a.axis, name: a.name }));

/** The area an address names (`finance`, `finance_ops` or `Finance`); null for anything else, an old role key included. */
export function areaFromParam(v) {
  const a = areaOf(v);
  return a ? AREAS.find((x) => x.key === a.key) : null;
}

/** The areas a skill sits in: each tag's area, once, in the radar's order. */
export function skillAreas(s) {
  const axes = new Set((Array.isArray(s?.taxonomy) ? s.taxonomy : []).map((t) => t?.category_slug));
  return AREAS.filter((a) => axes.has(a.axis));
}

/** SK0: how many of the skills read sit in each area (a skill in two areas counts in both). */
export function areaCounts(skills) {
  const list = Array.isArray(skills) ? skills : [];
  return Object.fromEntries(AREAS.map((a) => [a.key, list.filter((s) => skillAreas(s).some((x) => x.key === a.key)).length]));
}

/**
 * R5 (#4121): a skill's run cost, "$0.04 a run". No mounted Worker route
 * serves the figure yet, so every card reads null and draws "Not recorded",
 * never "$0". The builder of #4121 serves `run_cost_microusd` on the card; a
 * served zero is then a zero.
 */
export function runCostWords(s) {
  const m = s?.run_cost_microusd;
  if (!Number.isFinite(m) || m < 0) return null;
  return `$${(m / 1e6).toFixed(2)} a run`;
}

/** SK3: an agent's run-cost change if it took the skill. Not served yet (#4121), so null: "Not recorded". */
export function costChangeWords(agent) {
  const m = agent?.run_cost_change_microusd;
  if (!Number.isFinite(m)) return null;
  return `${m < 0 ? '−' : '+'}$${(Math.abs(m) / 1e6).toFixed(2)} a run`;
}

/**
 * v2 natural fit: the agent's persona fits one of the skill's areas (D4117's
 * `natural_fit`, two area keys). A hint only: it sorts, it never excludes.
 */
export function naturalFit(agent, skill) {
  const fit = Array.isArray(agent?.persona?.natural_fit) ? agent.persona.natural_fit : [];
  return skillAreas(skill).some((a) => fit.includes(a.key));
}

/**
 * SK3: every agent the read answered, the ones whose persona fits the skill
 * first. A Worker's `role_mismatch` is the D1612 rule v2 drops: it is not a
 * reason to grey an agent out. `personaOf(uid)` finds a persona the
 * assignable read does not carry (the Team's own agents list does).
 */
export function assignRows(agents, skill, personaOf = () => null) {
  return (Array.isArray(agents) ? agents : []).map((a) => {
    const withPersona = a?.persona ? a : { ...a, persona: personaOf(a?.uid) || null };
    const blocked = a?.blocked && a.blocked.code !== 'role_mismatch' ? a.blocked : null;
    return { ...a, persona: withPersona.persona, blocked, fit: naturalFit(withPersona, skill) };
  }).sort((x, y) => Number(y.fit) - Number(x.fit));
}

/** A taxonomy chip: "Capital / Network · Proficient" (the canvas's chip), the skill's own name as its title. */
export function tagChip(tag) {
  const level = LEVELS[levelOf(tag?.level) || 0];
  const cat = tag?.category_label || categoryLabel(tag?.category_slug) || tag?.skill_label || null;
  if (!cat || !level) return null;
  return { text: `${cat} · ${level}`, title: tag?.skill_label && tag.skill_label !== cat ? `${tag.skill_label} · ${level}` : undefined };
}

/**
 * D4120: what a skill's SkillEnergy image is drawn from — its slug, and the
 * area and level of its first taxonomy tag. Null when the skill has no tag
 * with both, so a card draws no image rather than a made-up area.
 */
export function energyOf(s) {
  const tag = (Array.isArray(s?.taxonomy) ? s.taxonomy : []).find((t) => SKILL_AXIS_ORDER.includes(t?.category_slug) && levelOf(t?.level));
  const slug = s?.slug || s?.uid;
  if (!tag || !slug) return null;
  return { slug: String(slug), area: tag.category_slug, level: levelOf(tag.level) };
}

export const OUTPUT_KINDS = [['draft', 'A draft for a person to accept'], ['record_change', 'A record change for a person to accept'], ['brief', 'A brief']];
export const outputWords = (s) => s?.output_label || (OUTPUT_KINDS.find(([k]) => k === s?.output_kind) || [])[1] || null;

/** "Used by N agents", the install count; a count the read did not make is null and draws "Not recorded". */
export function usedBy(n) {
  if (!Number.isFinite(n) || n < 0) return null;
  return `${n} ${n === 1 ? 'agent' : 'agents'}`;
}

/** The author line: "By Axal" or "By [Company]". */
export const authorLine = (s) => `By ${s?.author?.kind === 'axal' || s?.scope === 'hq' ? 'Axal' : (s?.author?.name || 'your company')}`;

export const SORTS = [['popular', 'Popular'], ['new', 'New'], ['az', 'A–Z']];

/**
 * The directory's area, search and sort, applied to what the read answered.
 * `area` is an area key or a radar slug. `fit` (a role key) keeps only the
 * skills written for it: the Add-an-agent step, while the Worker still pins a
 * skill to its roles. The tab never filters by it.
 */
export function directory(skills, { area = null, fit = null, q = '', sort = 'popular' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  let list = (Array.isArray(skills) ? skills : []).filter(Boolean);
  if (fit) list = list.filter((s) => (s.fit || []).includes(fit));
  const a = area ? areaOf(area) : null;
  if (area) list = list.filter((s) => !!a && (s.taxonomy || []).some((t) => t.category_slug === a.axis));
  if (needle) list = list.filter((s) => `${s.name || ''} ${s.description || ''}`.toLowerCase().includes(needle));
  const by = {
    popular: (a, b) => (Number.isFinite(b.used_by) ? b.used_by : -1) - (Number.isFinite(a.used_by) ? a.used_by : -1) || String(a.name).localeCompare(String(b.name)),
    new: (a, b) => String(b.published_at || b.updated_at || '').localeCompare(String(a.published_at || a.updated_at || '')) || String(a.name).localeCompare(String(b.name)),
    az: (a, b) => String(a.name).localeCompare(String(b.name)),
  }[sort] || null;
  return by ? [...list].sort(by) : list;
}

/** "From Axal" and "[Company]'s skills". */
export function groups(list) {
  const axal = list.filter((s) => s.scope === 'hq' || s.author?.kind === 'axal');
  return { axal, company: list.filter((s) => !axal.includes(s)) };
}

/** A possessive for a company name: "[Northwind Labs]’s skills". */
export const companySkillsTitle = (name) => `${name || 'Your company'}’s skills`;

/**
 * The agent's radar as SkillRadar's `skillVector` (slug → 0..5), from A2's
 * `radar.axes`. Null (no skills, or no read) draws "Not recorded"; an axis
 * with no tag is 0 on the drawing only, never listed as a level.
 */
export function radarVector(radar) {
  const axes = Array.isArray(radar?.axes) ? radar.axes : null;
  if (!axes || !axes.some((a) => levelOf(a.level))) return null;
  return Object.fromEntries(SKILL_AXIS_ORDER.map((slug) => [slug, levelOf(axes.find((a) => a.slug === slug)?.level) || 0]));
}

/** The radar's words beside it: the axes with a level, highest first. */
export function radarLines(radar) {
  const axes = Array.isArray(radar?.axes) ? radar.axes : [];
  return axes.map((a) => ({ label: a.label || categoryLabel(a.slug) || a.slug, level: levelOf(a.level) }))
    .filter((a) => a.level).sort((a, b) => b.level - a.level).map((a) => ({ label: a.label, text: LEVELS[a.level] }));
}

/** SK5: the radar after picking `adding` (cards with taxonomy tags), from the agent's radar now. */
export function previewRadar(radar, adding) {
  const now = radarVector(radar) || Object.fromEntries(SKILL_AXIS_ORDER.map((s) => [s, 0]));
  const next = { ...now };
  for (const s of adding || []) for (const t of s.taxonomy || []) {
    const lv = levelOf(t.level);
    if (lv && t.category_slug in next) next[t.category_slug] = Math.max(next[t.category_slug], lv);
  }
  return next;
}

/** SK8: each axis of team coverage, and whether it is a people gap covered only by agents. */
export function coverageRows(axes) {
  return SKILL_AXIS_ORDER.map((slug) => {
    const a = (Array.isArray(axes) ? axes : []).find((x) => x.slug === slug) || {};
    const people = levelOf(a.people_level);
    const agent = levelOf(a.agent_level);
    return { slug, label: a.label || categoryLabel(slug), people: people ? LEVELS[people] : null, agent: agent ? LEVELS[agent] : null, peopleGap: !people && !!agent };
  });
}

export function coverageSummary(rows) {
  const gaps = rows.filter((r) => r.peopleGap);
  if (!gaps.length) return null;
  return `${gaps.length === 1 ? 'One people gap' : `${gaps.length} people gaps`}: ${gaps.map((g) => g.label).join(', ')} ${gaps.length === 1 ? 'is' : 'are'} covered only by an agent.`;
}

/** SK3: agents grouped by company, the projects under each company after its own agents. */
export function assignGroups(agents) {
  const by = new Map();
  for (const a of Array.isArray(agents) ? agents : []) {
    const company = a?.scope?.company_name || 'Your company';
    if (!by.has(company)) by.set(company, []);
    by.get(company).push(a);
  }
  return [...by.entries()].map(([company, list]) => ({
    company,
    agents: [...list].sort((x, y) => (x.scope?.kind === 'project') - (y.scope?.kind === 'project') || String(x.scope?.project_name || '').localeCompare(String(y.scope?.project_name || ''))),
  }));
}

/** An agent's scope line: "Company" or "[Pilot app] · project". */
export const scopeLine = (scope) => (scope?.kind === 'project' ? `${scope.project_name || 'A project'} · project` : 'Company');
/** An agent's scope chip on its profile: "Acme Inc." or "Acme › Pilot app". */
export const scopeChip = (scope) => [scope?.company_name, scope?.kind === 'project' ? scope.project_name : null].filter(Boolean).join(' › ') || null;

/** Why an agent or a skill can't be picked, in words. */
export function blockedWords(blocked) {
  if (!blocked) return null;
  if (blocked.code === 'tool_not_approved') return `Needs the ${blocked.tool?.label || 'a'} read tool, which its sponsor hasn’t approved.`;
  // v2: any skill on any agent. Natural fit sorts; it never blocks.
  if (blocked.code === 'role_mismatch') return null;
  if (blocked.code === 'skill_retired') return 'Axal retired this skill.';
  return skillRefusalWords(blocked.code);
}

/** The Worker's skill refusals in words (A1, A2). */
export function skillRefusalWords(code, detail) {
  switch (code) {
    case 'not_manager': case 'not_member': return 'Only this team’s editors can do this.';
    case 'write_tool': return 'Write tools aren’t allowed: agents only read.';
    case 'tool_not_read_only': return detail ? `${detail} can change records. Skills may only use read-only tools.` : 'Skills may only use read-only tools: agents only read.';
    case 'needs_approval': return 'A second Super Admin approves this draft before it is published.';
    case 'golden_cases_failing': return 'This draft is below 9 of 10 golden-case runs, so it can’t be published yet.';
    case 'replacement_required': return 'An Axal skill is retired from HQ, with the skill that replaces it.';
    case 'unknown_taxonomy': return 'One of its taxonomy skills is not one of the /studio skills.';
    case 'no_steps': return 'A skill needs at least one step.';
    case 'too_long': return 'This SKILL.md is too long.';
    case 'invalid_skill': return `This skill can’t be saved. ${detail ? `Check ${detail}.` : 'Check each field.'}`;
    case 'slug_taken': return 'A skill with that name already exists here.';
    case 'version_changed': return 'Someone published this skill a moment ago. Reload it and try again.';
    case 'skill_retired': return 'Axal retired this skill. It keeps working at its pinned version.';
    case 'skill_suspended': return 'HQ suspended this skill. Agents don’t use it until a fixed version is published.';
    case 'role_mismatch': return 'This agent could not take it yet: the skill is still held to the agents it was written for.';
    case 'tool_not_approved': return detail ? `Needs the ${detail} read tool, which its sponsor hasn’t approved.` : 'That tool is not one its sponsor approved for read-only use.';
    case 'version_not_published': return 'Only a published version can be pinned.';
    default: return 'It could not be saved. Try again.';
  }
}

export const PROBLEM_FIELDS = { write_tool: 'tools', unknown_taxonomy: 'taxonomy', missing_taxonomy: 'taxonomy', no_steps: 'steps', too_long: 'markdown', missing_name: 'name' };

const MAX_MD = 32 * 1024;

/** Parses `[a, b]`, `{a: b}` or a bare scalar from one frontmatter line's value. */
function yamlValue(raw) {
  const v = String(raw || '').trim();
  if (v.startsWith('[') && v.endsWith(']')) return v.slice(1, -1).split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  if (v.startsWith('{') && v.endsWith('}')) {
    return Object.fromEntries(v.slice(1, -1).split(',').map((p) => p.split(':').map((x) => x.trim().replace(/^['"]|['"]$/g, ''))).filter((p) => p[0]));
  }
  return v.replace(/^['"]|['"]$/g, '');
}

/** A pasted `taxonomy:` value in words, "capital-network: proficient"; null when it names none. */
function taxonomyText(v) {
  if (Array.isArray(v)) return v.join(', ') || null;
  if (v && typeof v === 'object') return Object.entries(v).map(([k, l]) => `${k}: ${l}`).join(', ') || null;
  return v ? String(v) : null;
}

/**
 * SK4 "Paste a SKILL.md": a preview of what the Worker will parse, so the
 * sheet can show the frontmatter row by row and what will be refused. The
 * text is untrusted data; it is only ever drawn as text. The Worker's import
 * (A1) is the parse that counts; this one never saves anything.
 */
export function parseSkillMd(text) {
  const src = String(text || '');
  const problems = [];
  if (src.length > MAX_MD) problems.push('too_long');
  const m = /^\s*---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n([\s\S]*))?$/.exec(src);
  const front = {};
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const at = line.indexOf(':');
      if (at > 0) front[line.slice(0, at).trim()] = yamlValue(line.slice(at + 1));
    }
  }
  const body = m ? (m[2] || '') : src;
  const steps = body.split(/\r?\n/).map((l) => /^\s*\d+[.)]\s+(.+)$/.exec(l)?.[1]?.trim()).filter(Boolean);
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const tools = list(front.tools);
  const rows = [
    { key: 'name', value: front.name || null, ok: !!front.name },
    { key: 'taxonomy', value: taxonomyText(front.taxonomy), ok: !!taxonomyText(front.taxonomy) },
    { key: 'output', value: front.output || null, ok: !!front.output },
    { key: 'tools', value: tools.join(' · ') || null, ok: tools.every((t) => /\.read$/.test(t)) },
  ];
  if (!front.name) problems.push('missing_name');
  if (!taxonomyText(front.taxonomy)) problems.push('missing_taxonomy');
  if (tools.some((t) => !/\.read$/.test(t))) problems.push('write_tool');
  if (!steps.length) problems.push('no_steps');
  return { front, steps, rows, problems, writeTools: tools.filter((t) => !/\.read$/.test(t)) };
}

/** Words for a preview problem, beside the sheet's Save as draft. */
export function problemWords(code, parsed) {
  if (code === 'write_tool') {
    const t = parsed?.writeTools?.[0];
    return t ? `Write tools aren’t allowed: agents only read. Replace ${t} with ${t.replace(/\.[a-z_]+$/, '.read')}, or remove it.` : skillRefusalWords('write_tool');
  }
  if (code === 'missing_name') return 'It needs a name in its frontmatter.';
  if (code === 'missing_taxonomy') return 'It needs a taxonomy in its frontmatter: at least one /studio skill at a level, which sets its area.';
  return skillRefusalWords(code);
}

/** A safe file name for Download: the skill's slug, else its name, as `<slug>.skill.md`. */
export function skillFileName(s) {
  const base = String(s?.slug || s?.name || 'skill').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
  return `${base}.skill.md`;
}

/** "Update to v3" when the pinned version is behind the published one. */
export const updateLabel = (s) => (Number.isFinite(s?.pinned_version) && Number.isFinite(s?.current_version) && s.current_version > s.pinned_version ? `Update to v${s.current_version}` : null);

// ---------------------------------------------------------------- A1's answers (#3951), as the screens draw them

/** A tool key as the chip names it: `mercury.read` → "Mercury", `data_room.read` → "Data room". */
export function toolName(key) {
  const base = String(key || '').replace(/\.[a-z_]+$/i, '').replace(/[_-]+/g, ' ').trim();
  return base ? base[0].toUpperCase() + base.slice(1) : 'Tool';
}

/**
 * One card of `GET /api/teams/skills` (or `skill` of `GET /api/teams/skills/:uid`)
 * as the screens draw it. Its `roles` become `fit`, a hint the tab never
 * prints. A tag's area is the area table's short name.
 */
export function fromWorkerSkill(c) {
  if (!c || typeof c !== 'object') return null;
  const hq = c.scope === 'hq';
  return {
    uid: c.uid, slug: c.slug || null, scope: c.scope, status: c.status,
    version: Number.isFinite(c.version) ? c.version : null,
    author: hq ? { kind: 'axal' } : { kind: 'company', name: typeof c.author === 'string' && c.author ? c.author : null },
    name: c.name, description: c.purpose ?? c.description ?? null,
    steps: Array.isArray(c.steps) ? c.steps : [],
    tools: (Array.isArray(c.tools) ? c.tools : []).map((t) => (typeof t === 'string' ? { key: t, label: toolName(t) } : t)).filter(Boolean),
    output_kind: c.output_kind || null, output_label: c.output_label || null,
    fit: (Array.isArray(c.roles) ? c.roles : []).map((r) => (typeof r === 'string' ? r : r?.key)).filter(Boolean),
    taxonomy: (Array.isArray(c.tags) ? c.tags : Array.isArray(c.taxonomy) ? c.taxonomy : []).map((t) => ({
      skill_slug: t.slug ?? t.skill_slug, skill_label: t.label ?? t.skill_label ?? null,
      category_slug: t.category ?? t.category_slug ?? null,
      category_label: areaOf(t.category ?? t.category_slug)?.name || null,
      level: t.level,
    })),
    used_by: Number.isFinite(c.used_by) ? c.used_by : null,
    run_cost_microusd: Number.isFinite(c.run_cost_microusd) ? c.run_cost_microusd : null,
    updated_at: c.updated_at || null,
    can_write: !!c.can_write,
  };
}

/** `GET /api/teams/skills?company=` → `{ can_edit, figures, skills }`: Axal's and the company's, one list. */
export function fromWorkerLibrary(r) {
  const hq = (Array.isArray(r?.hq) ? r.hq : []).map(fromWorkerSkill).filter(Boolean);
  const co = (Array.isArray(r?.company?.skills) ? r.company.skills : []).map(fromWorkerSkill).filter(Boolean);
  return {
    can_edit: !!r?.company?.can_write,
    figures: { skills: { axal: hq.length, company: r?.company ? co.length : 0 }, agents_with_skills: null, updates_available: null },
    skills: [...hq, ...co],
  };
}

/** `GET /api/teams/skills/:uid` → `{ skill (with markdown and versions), can_edit }`. */
export function fromWorkerSkillPage(r) {
  const skill = fromWorkerSkill(r?.skill);
  if (!skill) return { skill: null, can_edit: false };
  const versions = (Array.isArray(r?.versions) ? r.versions : []).map((v) => ({ version: v.version, published_at: v.published_at, note: v.note || null }));
  return { skill: { ...skill, markdown: r.skill.skill_md ?? r.skill.markdown ?? null, versions }, can_edit: skill.can_write };
}
