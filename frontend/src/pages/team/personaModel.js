/**
 * D4119 (#4119, Roster R3 of #4116) — the 16 AI agent personas as the Team
 * screens draw them: the gallery's filters, search and Compare, the card's
 * top values and risk scale, "On your team", and the avatar's alt text.
 *
 * The personas are R1's (`GET /api/teams/personas`, D4117): a key, a single
 * name, a tagline, a goal, a personality, a story, a risk from 1 to 5, the six
 * Axal values scored 0..1 with the top three named, and a natural fit of two
 * areas. Nothing here invents a persona or a value; a field the read did not
 * carry is "Not recorded".
 *
 * NO JOB TITLE (D4117 §6, D4116 §4). The Worker still keys an agent's rule
 * book by a role (D4117 §5), so the add flow still sends a `role_key`, but no
 * screen names a role by its title (CTO, CFO …): `WORK_LABEL` names each by
 * the work it covers, and `rolesFor` orders them for a persona.
 *
 * Pure: no React, no request.
 */

import { NOT_RECORDED } from '../../lib/absence.js';
import { archetypeMeta } from '../../lib/assessmentMeta.js';

export { NOT_RECORDED };

// Editorial matches for the built-in personas, based on their published profiles.
// Studio owns the labels. Persona keys survive HQ renames and team role changes.
const STUDIO_ARCHETYPE_BY_PERSONA = new Map([
  ['vesta', 'mt_accountability_anchor'],
  ['orrin', 'inv_disciplined_allocator'],
  ['ilyse', 'fo_rocketeer'],
  ['kade', 'pt_growth_catalyst'],
  ['sylva', 'fo_missionary'],
  ['solen', 'inv_hands_on_partner'],
  ['tessaly', 'pt_systems_builder'],
  ['corvane', 'fo_architect'],
  ['juno', 'pt_embedded_operator'],
  ['brann', 'mt_craft_master'],
  ['seren', 'pt_strategic_connector'],
  ['corin', 'inv_network_amplifier'],
  ['ryssa', 'inv_thesis_backer'],
  ['draxen', 'fo_maverick'],
  ['elara', 'mt_sage_guide'],
  ['aurel', 'inv_hands_on_partner'],
]);

export function personaArchetypeLabel(persona) {
  return archetypeMeta(STUDIO_ARCHETYPE_BY_PERSONA.get(persona?.key))?.label ?? null;
}

/** The six Axal values, in `FIT_V2_VALUES` order (D4117 §1). The persona read carries its own legend; this is the order. */
export const VALUE_ORDER = ['integrity', 'stewardship', 'curiosity', 'resilience', 'collaboration', 'ambition'];

/** The eight areas, in the SkillRadar's order (D4117 §3). */
export const AREA_LABEL = Object.freeze({
  product: 'Product', engineering: 'Engineering', design: 'Design', gtm: 'GTM',
  marketing: 'Marketing', finance: 'Finance', legal: 'Legal', capital: 'Capital',
});
export const AREA_ORDER = Object.keys(AREA_LABEL);

/** The risk scale (D4117: 1 most cautious … 5 boldest), as the card's one line draws it. */
export const RISK_WORDS = Object.freeze({ 1: 'Most cautious', 2: 'Cautious', 3: 'Balanced', 4: 'Bold', 5: 'Boldest' });
export const RISK_FILTERS = [
  { value: '', label: 'Any risk' },
  { value: 'cautious', label: 'Cautious (1–2)' },
  { value: 'balanced', label: 'Balanced (3)' },
  { value: 'bold', label: 'Bold (4–5)' },
];
const RISK_BAND = { cautious: [1, 2], balanced: [3], bold: [4, 5] };

/**
 * The work each internal role key covers, never its job title (D4117 §5, §6).
 * The Worker's role names are titles ("CTO", "CFO"), so the screens never draw them.
 */
export const WORK_LABEL = Object.freeze({
  ceo: 'Company direction',
  cto: 'Engineering',
  cpo: 'Product',
  cfo: 'Finance',
  cmo: 'Marketing and growth',
  sales: 'Sales and partnerships',
  coo: 'Operations',
  general_counsel: 'Legal',
  people: 'People',
  research_analyst: 'Research',
  investor_relations: 'Investor relations',
});
/** The work a role key covers; a key outside the catalogue (a custom role) reads its own name. */
export const workLabel = (roleKey, ownName = null) => WORK_LABEL[roleKey] || String(ownName || '').trim() || NOT_RECORDED;

/** The persona each role's agents wore before #4117 (D4117 §4, `ROLE_PERSONA`): a persona's first suggested area of work. */
export const PERSONA_ROLE = Object.freeze({
  solen: 'ceo', corvane: 'cto', juno: 'cpo', orrin: 'cfo', kade: 'cmo', seren: 'sales',
  tessaly: 'coo', vesta: 'general_counsel', elara: 'people', ryssa: 'research_analyst', aurel: 'investor_relations',
});
/** The role whose work each area is nearest, for a persona with no role of its own. */
const AREA_ROLE = Object.freeze({
  product: 'cpo', engineering: 'cto', design: 'cpo', gtm: 'sales', marketing: 'cmo', finance: 'cfo', legal: 'general_counsel', capital: 'investor_relations',
});

/**
 * The areas of work (role keys) a persona's agent can be added for, best first:
 * its own role, then the roles of its natural fit, then the rest. Advisory only:
 * any persona can take any area (D4116 §2.3); natural fit only sorts.
 */
export function rolesFor(persona, roleKeys = Object.keys(WORK_LABEL)) {
  const first = [PERSONA_ROLE[persona?.key], ...(Array.isArray(persona?.natural_fit) ? persona.natural_fit.map((a) => AREA_ROLE[a]) : [])];
  const out = [];
  for (const k of [...first, ...roleKeys]) if (k && roleKeys.includes(k) && !out.includes(k)) out.push(k);
  return out;
}

/** A value's label from the read's legend, else its key in words. */
export function valueLabel(key, legend = []) {
  const hit = (Array.isArray(legend) ? legend : []).find((v) => v.key === key);
  if (hit?.label) return hit.label;
  const s = String(key || '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : NOT_RECORDED;
}

/** The card's three value chips: the persona's top values, in its own order. */
export const topValueChips = (persona, legend) => (Array.isArray(persona?.top_values) ? persona.top_values.slice(0, 3).map((k) => ({ key: k, label: valueLabel(k, legend) })) : []);

/** The risk line: "Bold · 4 of 5", or "Not recorded". */
export function riskLine(persona) {
  const r = Number(persona?.risk);
  return RISK_WORDS[r] ? `${RISK_WORDS[r]} · ${r} of 5` : NOT_RECORDED;
}

/** Natural fit in words: "Finance and Legal". */
export function fitLine(persona) {
  const fit = Array.isArray(persona?.natural_fit) ? persona.natural_fit.map((a) => AREA_LABEL[a]).filter(Boolean) : [];
  return fit.length ? fit.join(' and ') : NOT_RECORDED;
}

/**
 * The avatar's alt text: "[Name], [tagline]" (D4116 R3 note). The fallback
 * with initials indicates when a portrait is unavailable.
 */
export function avatarAlt(persona, { portrait = false } = {}) {
  const name = String(persona?.name || '').trim() || 'An AI agent';
  const tag = String(persona?.tagline || '').trim();
  return `${name}${tag ? `, ${tag}` : ''}${portrait ? '' : ' (portrait not added yet)'}`;
}

/** Pronouns from the persona's gender (the canvas's "She/her", "He/him"); none when not recorded. */
export const pronouns = (p) => (p?.gender === 'woman' ? 'She/her' : p?.gender === 'man' ? 'He/him' : null);

export const initialsOf = (name) => String(name || '').trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || '·';

/** The persona keys already on this team (its live agents' personas). */
export function onTeamKeys(agents) {
  return new Set((Array.isArray(agents) ? agents : []).filter((a) => a?.status !== 'removed').map((a) => a?.persona?.key).filter(Boolean));
}

/** The gallery's filter options, from the read: top value, natural fit and risk (no philosophy, no outlook). */
export function filterOptions(personas, legend) {
  const values = VALUE_ORDER.filter((k) => (personas || []).some((p) => (p.top_values || []).includes(k)));
  const areas = AREA_ORDER.filter((a) => (personas || []).some((p) => (p.natural_fit || []).includes(a)));
  return {
    value: [{ value: '', label: 'Any top value' }, ...values.map((k) => ({ value: k, label: valueLabel(k, legend) }))],
    fit: [{ value: '', label: 'Any natural fit' }, ...areas.map((a) => ({ value: a, label: AREA_LABEL[a] }))],
    risk: RISK_FILTERS,
  };
}

/**
 * The gallery: the personas that match the search and every filter, in the
 * read's order, each with `on_team`. Search reads the name, tagline, goal and
 * personality. A persona on the team is kept, marked, never hidden.
 */
export function gallery(personas, { q = '', value = '', fit = '', risk = '' } = {}, onTeam = new Set()) {
  const needle = String(q || '').trim().toLowerCase();
  return (Array.isArray(personas) ? personas : []).filter((p) => {
    if (value && !(p.top_values || []).includes(value)) return false;
    if (fit && !(p.natural_fit || []).includes(fit)) return false;
    if (risk && !(RISK_BAND[risk] || []).includes(Number(p.risk))) return false;
    if (!needle) return true;
    return [p.name, p.tagline, p.goal, p.personality].some((s) => String(s || '').toLowerCase().includes(needle));
  }).map((p) => ({ ...p, on_team: onTeam.has(p.key) }));
}

/** The gallery's count line: "16 agents" / "3 of 16 agents". */
export function galleryCount(shown, all) {
  const n = shown.length; const t = (all || []).length;
  return n === t ? `${t} agent${t === 1 ? '' : 's'}` : `${n} of ${t} agents`;
}

/** Compare holds two or three personas; a fourth replaces nothing and is refused. */
export const COMPARE_MAX = 3;
export function toggleCompare(keys, key) {
  const list = Array.isArray(keys) ? keys : [];
  if (list.includes(key)) return list.filter((k) => k !== key);
  return list.length >= COMPARE_MAX ? list : [...list, key];
}

/** Compare's rows: each persona's values (0..1, in the six's order), risk and natural fit, side by side. */
export function compareRows(personas, legend) {
  const ps = Array.isArray(personas) ? personas : [];
  return [
    ...VALUE_ORDER.map((k) => ({
      key: k, label: valueLabel(k, legend),
      cells: ps.map((p) => {
        const v = Number(p?.values?.[k]);
        return { value: Number.isFinite(v) ? v : null, top: (p.top_values || []).includes(k) };
      }),
    })),
    { key: 'risk', label: 'Risk', cells: ps.map((p) => ({ text: riskLine(p) })) },
    { key: 'fit', label: 'Natural fit', cells: ps.map((p) => ({ text: fitLine(p) })) },
  ];
}

/**
 * The values block (shared with people's Axal behavioral values): one bar per
 * value, 0..1, the top three highlighted for an agent. A value the read did
 * not score is null, drawn "Not recorded", never a 0-width bar.
 */
export function agentValueBars(persona, legend) {
  const top = new Set(Array.isArray(persona?.top_values) ? persona.top_values : []);
  return VALUE_ORDER.map((k) => {
    const v = Number(persona?.values?.[k]);
    const hit = (Array.isArray(legend) ? legend : []).find((x) => x.key === k);
    return { key: k, label: valueLabel(k, legend), description: hit?.description || '', score: Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null, top: top.has(k) };
  });
}

/** The caption under an agent's values: they are fixed (D4119; owner revision 2026-11-02). */
export const fixedCaption = (name) => `Fixed · part of who ${String(name || '').trim() || 'this agent'} is`;

/**
 * Job titles and value systems no agent screen may draw (D4117 §1, §6). The
 * tests read every rendered agent surface against this list.
 */
export const FORBIDDEN_TITLES = ['CEO', 'CTO', 'CFO', 'CPO', 'CMO', 'COO', 'Chief of staff', 'Head of Sales', 'Head of People', 'General counsel'];
export const FORBIDDEN_VALUES = ['Hedonism', 'Power', 'Conformity', 'Tradition', 'Universalism', 'Benevolence', 'Self-direction', 'Stimulation', 'Achievement', 'Security', 'Guardian', 'Explorer', 'philosophy', 'trade-off'];
