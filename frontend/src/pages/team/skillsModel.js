/**
 * D1612 (#3945, #3952, boards SK0–SK9) — the words and every pure derivation
 * behind Team › Skills: levels and categories (the /studio taxonomy), filters
 * and sorts, the agent's radar, team coverage, assignment groups and the
 * client-side preview of a pasted SKILL.md.
 *
 * Nothing here reads anything. The shapes are the ones A1 (#3951) and A2
 * (#3956) answer; until they land the adapter answers unavailable and the
 * screens never call these on invented data.
 */
import { SKILL_AXES, SKILL_AXIS_ORDER } from '../../lib/assessmentMeta.js';

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

/** A taxonomy chip: "Capital / Network · Proficient" (the canvas's chip), the skill's own name as its title. */
export function tagChip(tag) {
  const level = LEVELS[levelOf(tag?.level) || 0];
  const cat = tag?.category_label || categoryLabel(tag?.category_slug) || tag?.skill_label || null;
  if (!cat || !level) return null;
  return { text: `${cat} · ${level}`, title: tag?.skill_label && tag.skill_label !== cat ? `${tag.skill_label} · ${level}` : undefined };
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

/** The directory's filter, search and sort, applied to what the read answered (the Worker may also apply them). */
export function directory(skills, { role = null, category = null, q = '', sort = 'popular' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  let list = (Array.isArray(skills) ? skills : []).filter(Boolean);
  if (role) list = list.filter((s) => (s.roles || []).includes(role));
  if (category) list = list.filter((s) => (s.taxonomy || []).some((t) => t.category_slug === category));
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
  if (blocked.code === 'role_mismatch') return 'It is not a skill of this agent’s role.';
  if (blocked.code === 'skill_retired') return 'Axal retired this skill.';
  return skillRefusalWords(blocked.code);
}

/** The Worker's skill refusals in words (A1, A2). */
export function skillRefusalWords(code, detail) {
  switch (code) {
    case 'not_manager': case 'not_member': return 'Only this team’s editors can do this.';
    case 'write_tool': return 'Write tools aren’t allowed: agents only read.';
    case 'unknown_role': return 'Choose one of the agent roles.';
    case 'unknown_taxonomy': return 'One of its taxonomy skills is not one of the /studio skills.';
    case 'no_steps': return 'A skill needs at least one step.';
    case 'too_long': return 'This SKILL.md is too long.';
    case 'invalid_skill': return `This skill can’t be saved. ${detail ? `Check ${detail}.` : 'Check each field.'}`;
    case 'slug_taken': return 'A skill with that name already exists here.';
    case 'version_changed': return 'Someone published this skill a moment ago. Reload it and try again.';
    case 'skill_retired': return 'Axal retired this skill. It keeps working at its pinned version.';
    case 'role_mismatch': return 'An agent can only be given skills of its own role.';
    case 'tool_not_approved': return detail ? `Needs the ${detail} read tool, which its sponsor hasn’t approved.` : 'That tool is not one its sponsor approved for read-only use.';
    case 'version_not_published': return 'Only a published version can be pinned.';
    default: return 'It could not be saved. Try again.';
  }
}

export const PROBLEM_FIELDS = { write_tool: 'tools', unknown_role: 'roles', unknown_taxonomy: 'taxonomy', no_steps: 'steps', too_long: 'markdown', missing_name: 'name' };

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

/**
 * SK7 "Paste a SKILL.md": a preview of what the Worker will parse, so the
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
    { key: 'roles', value: list(front.roles).join(', ') || null, ok: list(front.roles).length > 0 },
    { key: 'output', value: front.output || null, ok: !!front.output },
    { key: 'tools', value: tools.join(' · ') || null, ok: tools.every((t) => /\.read$/.test(t)) },
  ];
  if (!front.name) problems.push('missing_name');
  if (!list(front.roles).length) problems.push('unknown_role');
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
  return skillRefusalWords(code);
}

/** A safe file name for Download: the skill's slug, else its name, as `<slug>.skill.md`. */
export function skillFileName(s) {
  const base = String(s?.slug || s?.name || 'skill').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
  return `${base}.skill.md`;
}

/** "Update to v3" when the pinned version is behind the published one. */
export const updateLabel = (s) => (Number.isFinite(s?.pinned_version) && Number.isFinite(s?.current_version) && s.current_version > s.pinned_version ? `Update to v${s.current_version}` : null);
