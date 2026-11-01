/**
 * D1612 (#3952, part C of #3945) — the Skills tab's pure rules: the category
 * chips, the sort, the radar vector and its "Not recorded" axes, why an agent
 * is greyed out in "Assign to agents…", the agents grouped by company and
 * project, and the SKILL.md file name. No fetch: the screens read through
 * `agentsAdapter.js`.
 *
 * ONE TAXONOMY. The 8 categories are /studio's (`SKILL_AXES` in
 * `lib/assessmentMeta.js`), the levels are a person's, and the radar is the
 * same `SkillRadar` a person's profile draws.
 */
import { SKILL_AXES, SKILL_AXIS_ORDER } from '../../lib/assessmentMeta.js';

export const CATEGORIES = [['', 'All'], ...SKILL_AXIS_ORDER.map((slug) => [slug, SKILL_AXES[slug]])];
export const SORTS = [['popular', 'Popular'], ['new', 'New'], ['az', 'A–Z']];
export const LEVELS = [['aware', 'Aware'], ['working', 'Working'], ['proficient', 'Proficient'], ['advanced', 'Advanced'], ['expert', 'Expert']];
export const OUTPUT_KINDS = [['draft', 'A draft'], ['record_change', 'A record change'], ['brief', 'A brief']];

export const SKILLS_UNREAD = 'Skills could not be read';
export const NOT_RECORDED = 'Not recorded';

export const levelWord = (level) => (LEVELS.find(([k]) => k === level) || [])[1] || level;
export const outputWord = (kind) => (OUTPUT_KINDS.find(([k]) => k === kind) || [])[1] || kind;
/** "Investor reporting · Proficient": a taxonomy tag as its chip reads. */
export const tagChip = (t) => `${t.label || t.slug} · ${levelWord(t.level)}`;
/** "Used by 3 agents"; a count the Worker gave, never a guess. */
export const usedByWords = (n) => (Number.isFinite(n) ? `Used by ${n} ${n === 1 ? 'agent' : 'agents'}` : NOT_RECORDED);

/**
 * The radar's vector for `SkillRadar` and whether any axis is recorded. A
 * "Not recorded" axis is left out of the vector rather than set to 0, and a
 * radar with no recorded axis is not drawn at all.
 */
export function radarVector(radar) {
  const vector = {};
  const missing = [];
  for (const axis of Array.isArray(radar) ? radar : []) {
    if (axis?.value?.available) vector[axis.slug] = axis.value.value;
    else if (axis?.slug) missing.push(axis.label || axis.slug);
  }
  return { vector, recorded: Object.keys(vector).length > 0, missing };
}

/**
 * Why an agent is greyed out for a skill in "Assign to agents…", or null. The
 * Worker decides again on save; this only says so before the click, in the
 * same words.
 */
export function assignHint(skill, agent) {
  if (!skill || !agent) return null;
  if (agent.status === 'removed') return 'This agent was removed.';
  const roles = (skill.roles || []).map((r) => r.key || r);
  if (!roles.includes(agent.role_key)) return `This skill is not one of the ${agent.role_name || agent.role_key} role's skills.`;
  const granted = new Set((agent.tools || []).map((t) => t.tool));
  const missing = (skill.tools || []).filter((t) => !granted.has(t));
  if (missing.length) return `Needs the ${missing.join(', ')} ${missing.length === 1 ? 'tool' : 'tools'}, which this agent's sponsor hasn't approved.`;
  return null;
}

/**
 * Agents grouped as SK3 draws them: the company's own, then each project with
 * its agents. `agents` are the team list's rows (`scope_kind`, `project`).
 */
export function groupAgents(agents, companyName) {
  const own = [];
  const projects = new Map();
  for (const a of Array.isArray(agents) ? agents : []) {
    if (a.scope_kind === 'project' && a.project) {
      const p = projects.get(a.project.id) || { id: a.project.id, name: a.project.name, agents: [] };
      p.agents.push(a);
      projects.set(a.project.id, p);
    } else own.push(a);
  }
  return { company: companyName || null, agents: own, projects: [...projects.values()] };
}

/** `draft-the-monthly-investor-update.skill.md`: what Download saves. */
export function skillFileName(skill) {
  const base = String(skill?.slug || skill?.name || 'skill').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
  return `${base}.skill.md`;
}

/** The library's two groups, each a block the page can draw honestly. */
export function libraryGroups(value) {
  return {
    hq: Array.isArray(value?.hq) ? value.hq : [],
    company: value?.company ? { name: value.company.name, skills: Array.isArray(value.company.skills) ? value.company.skills : [], canWrite: !!value.company.can_write } : null,
    canWriteHq: !!value?.can_write_hq,
  };
}

/** A draft as the editor sheet sends it: trimmed steps, no empty step, tags with a level. */
export function draftBody(form) {
  return {
    name: String(form.name || '').trim(),
    purpose: String(form.purpose || '').trim(),
    steps: (form.steps || []).map((s) => String(s || '').trim()).filter(Boolean),
    tools: (form.tools || []).filter(Boolean),
    output_kind: form.output_kind,
    roles: (form.roles || []).filter(Boolean),
    tags: (form.tags || []).filter((t) => t && t.slug && t.level).map((t) => ({ slug: t.slug, level: t.level })),
  };
}

/** Move step `i` by `d` (-1 up, +1 down), as "drag to reorder" does from the keyboard. */
export function moveStep(steps, i, d) {
  const j = i + d;
  if (j < 0 || j >= steps.length) return steps;
  const next = steps.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
