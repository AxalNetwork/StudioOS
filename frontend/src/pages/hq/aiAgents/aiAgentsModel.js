/**
 * D4137 (#4137) — HQ › AI agents, the words and rules the page draws by.
 *
 * Pure, for the Node test. The page (`HqAiAgentsPage.jsx`) reads the admin
 * routes under `/api/admin/ai-agents` (H1–H5: the roster, the From Axal skills,
 * company skills, the policy, runs, spend and the audit) and draws a board with
 * the build task that switches it on only while that task has not landed. All
 * five have (`BUILD[key].live`); the words here stay as they are. The lifecycle
 * rules are in `skillLifecycleModel.js`, the policy's in `policyModel.js`, and the
 * words for every refusal in `refusals.js`.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';
import { REASON_MIN, wordsFor } from './refusals.js';

/** The four tabs and their addresses (SA0–SA8). Overview is the landing tab. */
export const BASE = '/hq/ai-agents';
export const TABS = [
  { key: 'overview', label: 'Overview', to: BASE },
  { key: 'roster', label: 'Roster', to: `${BASE}/roster` },
  { key: 'skills', label: 'Skills library', to: `${BASE}/skills` },
  { key: 'operations', label: 'Operations', to: `${BASE}/operations` },
];

/** The second row under Skills library and under Operations. */
export const SUBTABS = {
  skills: [
    { key: 'axal', label: 'From Axal', to: `${BASE}/skills` },
    { key: 'companies', label: 'Company skills', to: `${BASE}/skills/companies` },
  ],
  operations: [
    { key: 'runs', label: 'Runs', to: `${BASE}/operations` },
    { key: 'spend', label: 'Spend', to: `${BASE}/operations/spend` },
    { key: 'policies', label: 'Policies', to: `${BASE}/operations/policies` },
    { key: 'audit', label: 'Audit', to: `${BASE}/operations/audit` },
  ],
};

/**
 * Which board an address opens. Unknown sub-paths fall back to their tab, so a
 * stale link never lands on a blank page.
 *   /hq/ai-agents                         → overview
 *   /hq/ai-agents/roster[/:agent]         → roster (agent detail when a key is given)
 *   /hq/ai-agents/skills[/companies]      → skills · axal | companies
 *   /hq/ai-agents/skills/:uid/edit        → skills · editor
 *   /hq/ai-agents/operations[/spend|/policies|/audit] → operations · …
 */
export function viewFor(pathname = '') {
  const rest = String(pathname).replace(/\/+$/, '').slice(BASE.length).split('/').filter(Boolean);
  const [tab, a, b] = rest;
  if (tab === 'roster') return { tab: 'roster', sub: a ? 'agent' : 'list', agent: a ? decodeURIComponent(a) : null };
  if (tab === 'skills') {
    if (a === 'companies') return { tab: 'skills', sub: 'companies' };
    if (a && b === 'edit') return { tab: 'skills', sub: 'editor', skill: decodeURIComponent(a) };
    return { tab: 'skills', sub: 'axal' };
  }
  if (tab === 'operations') return { tab: 'operations', sub: ['spend', 'policies', 'audit'].includes(a) ? a : 'runs' };
  return { tab: 'overview', sub: null };
}

/**
 * The build tasks behind the boards (#4137 H1–H5). `live: false` until the
 * task lands its routes; the page says "Not switched on yet" and names the
 * issue, and draws no control the server would only refuse. All five are live
 * since #4739 wired H2's review, golden cases, evals and retire.
 */
export const BUILD = {
  H1: { issue: 4158, live: true, what: 'The roster admin API', boards: 'SA1, SA2' },
  H2: { issue: 4160, live: true, what: 'Review, golden cases and retire for From Axal skills', boards: 'SA3 actions, SA4' },
  H3: { issue: 4161, live: true, what: 'Company skills moderation', boards: 'SA5' },
  H4: { issue: 4162, live: true, what: 'Platform AI policy and the kill switch', boards: 'SA6' },
  H5: { issue: 4163, live: true, what: 'Runs, spend and the admin audit', boards: 'SA0 tiles, SA7, SA8' },
};

export const notYet = (key) => {
  const b = BUILD[key];
  return `Not switched on yet. ${b.what} arrives with #${b.issue}.`;
};

/** A figure no store holds reads "Not recorded", never 0 (the one definition, `lib/absence.js`). */
export { NOT_RECORDED };
export const shown = (v, fmt = String) => (v == null || (typeof v === 'number' && !Number.isFinite(v)) ? NOT_RECORDED : fmt(v));
export const usd = (n) => `$${Number(n).toFixed(2)}`;

/** The 8 areas, in the SkillRadar's order (`RADAR_AXES` slugs), with the canvas's short names. */
export const AREAS = [
  { slug: 'product', label: 'Product' },
  { slug: 'engineering', label: 'Engineering' },
  { slug: 'design', label: 'Design' },
  { slug: 'gtm_sales', label: 'GTM' },
  { slug: 'marketing_brand', label: 'Marketing' },
  { slug: 'finance_ops', label: 'Finance' },
  { slug: 'legal_compliance', label: 'Legal' },
  { slug: 'capital_network', label: 'Capital' },
];
const AREA_LABEL = Object.fromEntries(AREAS.map((a) => [a.slug, a.label]));

/** The proficiency ladder's words, rank 1..5 (`PROFICIENCY` in skillsTaxonomySchema). */
const LEVELS = ['Aware', 'Working', 'Proficient', 'Advanced', 'Expert'];
const levelWord = (l) => {
  if (typeof l === 'number') return LEVELS[l - 1] ?? null;
  if (typeof l === 'string' && l) return l[0].toUpperCase() + l.slice(1);
  return null;
};

/** A skill's area: the category most of its tags sit in (ties in radar order). */
export function areaOf(card) {
  if (card?.area?.slug) return card.area.slug;
  const counts = new Map();
  for (const t of card?.tags ?? []) if (t.category) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
  let best = null;
  for (const a of AREAS) if ((counts.get(a.slug) ?? 0) > (best ? counts.get(best) : 0)) best = a.slug;
  return best;
}

/** Its level: the highest tag level in its area. */
export function levelOf(card) {
  if (card?.level) return card.level;
  const area = areaOf(card);
  const ranks = (card?.tags ?? []).filter((t) => t.category === area).map((t) => (typeof t.level === 'number' ? t.level : LEVELS.findIndex((w) => w.toLowerCase() === String(t.level).toLowerCase()) + 1)).filter((n) => n > 0);
  return ranks.length ? levelWord(Math.max(...ranks)) : null;
}

/** SA3's status chip: a skill is a draft, in review, published or retired. */
export const STATUS = {
  draft: { label: 'Draft', tone: 'draft' },
  in_review: { label: 'In review', tone: 'review' },
  published: { label: 'Published', tone: 'published' },
  retired: { label: 'Retired', tone: 'muted' },
};
export const statusOf = (s) => STATUS[s] ?? { label: s ? String(s) : NOT_RECORDED, tone: 'muted' };

/**
 * One SA3 row from a library card (`GET /api/admin/ai-agents/skills`). A skill
 * with no golden cases or no eval run reads "Not recorded", never a pass count.
 */
export function skillRow(card) {
  const area = areaOf(card);
  return {
    uid: card.uid,
    name: card.name || card.slug || 'Untitled skill',
    slug: card.slug ?? null,
    area: area ? AREA_LABEL[area] : NOT_RECORDED,
    level: levelOf(card) ?? NOT_RECORDED,
    version: card.version ? `v${card.version}` : 'Not published',
    status: statusOf(card.status),
    agents: shown(card.agents ?? card.used_by),
    tools: (card.tools ?? []).map((t) => (typeof t === 'string' ? t : t.label ?? t.key)).filter(Boolean),
    golden: card.golden ? `${card.golden.pass} / ${card.golden.total}` : NOT_RECORDED,
    lastEval: card.last_eval ?? NOT_RECORDED,
  };
}

/** SA3's area tiles: per area, its skills and how many are a draft or in review. */
export function areaTiles(cards = []) {
  return AREAS.map((a) => {
    const mine = cards.filter((c) => areaOf(c) === a.slug);
    const draft = mine.filter((c) => c.status === 'draft').length;
    const review = mine.filter((c) => c.status === 'in_review').length;
    const extra = [review ? `${review} in review` : null, draft ? `${draft} draft` : null].filter(Boolean).join(' · ');
    return { ...a, count: mine.length, line: `${mine.length} skill${mine.length === 1 ? '' : 's'}${extra ? ` · ${extra}` : ''}` };
  });
}

/** SA0's KPI tiles. The page fills the rest from H5's overview; a tile with no figure reads "Not recorded". */
export function overviewTiles({ hqSkills = null } = {}) {
  const published = Array.isArray(hqSkills) ? hqSkills.filter((s) => s.status === 'published').length : null;
  return [
    { key: 'agents', label: 'Agents active', value: NOT_RECORDED, note: notYet('H5') },
    { key: 'skills', label: 'Skills published', value: shown(published), note: published == null ? 'Could not be read.' : 'From Axal. Company skills are on their own tab.' },
    { key: 'runs', label: 'Runs this week', value: NOT_RECORDED, note: notYet('H5') },
    { key: 'spend', label: 'AI spend this month', value: NOT_RECORDED, note: notYet('H5') },
    { key: 'accepted', label: 'Proposals accepted', value: NOT_RECORDED, note: notYet('H5') },
    { key: 'failed', label: 'Runs failed', value: NOT_RECORDED, note: notYet('H5') },
  ];
}

/** SA1's columns, in the canvas's order. */
export const ROSTER_COLUMNS = ['Agent', 'Top values', 'Risk · natural fit', 'Status', 'Teams', 'Runs 30d', 'Spend 30d', 'Accepted'];

// ─── SA1 / SA2 · Roster (H1, #4158) ─────────────────────────────────────────

/** Every change on this panel takes a reason of at least 10 characters (the Worker refuses a shorter one). */
export { REASON_MIN };
export const reasonOk = (r) => String(r ?? '').trim().length >= REASON_MIN;

/** Risk 1 (most cautious) … 5 (boldest), the canvas's words. */
export const RISK_WORDS = ['', 'Cautious', 'Careful', 'Balanced', 'Bold', 'Very bold'];
export const riskWord = (r) => RISK_WORDS[r] || NOT_RECORDED;

/** The Worker's area keys (`personas.ts` AREAS) with the canvas's short names. */
const FIT_LABEL = { product: 'Product', engineering: 'Engineering', design: 'Design', gtm: 'GTM', marketing: 'Marketing', finance: 'Finance', legal: 'Legal', capital: 'Capital' };
export const fitLabel = (k) => FIT_LABEL[k] ?? String(k ?? '');
export const valueLabel = (k) => (k ? String(k)[0].toUpperCase() + String(k).slice(1) : '');
/** The 6 Axal values, in `FIT_V2_VALUES` order. */
export const VALUE_KEYS = ['integrity', 'stewardship', 'curiosity', 'resilience', 'collaboration', 'ambition'];

/** A persona's status chip. Hidden: out of the gallery, teams keep it. Retired: out of the gallery and paused everywhere. */
export const PERSONA_STATUS = {
  offered: { label: 'Offered', tone: 'published' },
  hidden: { label: 'Hidden', tone: 'draft' },
  retired: { label: 'Retired', tone: 'muted' },
};
export const personaStatus = (s) => PERSONA_STATUS[s] ?? { label: NOT_RECORDED, tone: 'muted' };

const pctWord = (v) => `${Number(v).toFixed(Number.isInteger(v) ? 0 : 1)}%`;
const countWord = (v) => Number(v).toLocaleString('en-US');

/** One SA1 row from `GET /admin/ai-agents/roster`. Every usage figure the Worker sent as null reads "Not recorded". */
export function rosterRow(p) {
  const u = p?.usage ?? {};
  return {
    key: p.key,
    name: p.name,
    tagline: p.tagline,
    avatar: p.avatar,
    topValues: (p.top_values ?? []).map(valueLabel),
    risk: riskWord(p.risk),
    fit: (p.natural_fit ?? []).map(fitLabel),
    status: personaStatus(p.status),
    teams: shown(u.teams, countWord),
    runs: shown(u.runs, countWord),
    spend: shown(u.spend_usd, usd),
    accepted: shown(u.accepted_pct, pctWord),
    failed: shown(u.failed_pct, pctWord),
  };
}

/** SA1's counts line: "16 agents · 15 offered · 1 hidden · 0 retired". */
export const rosterCounts = (c) => (c ? `${c.total} agents · ${c.offered} offered · ${c.hidden} hidden · ${c.retired} retired` : NOT_RECORDED);

/** SA1's filters: search by name or tagline, status, natural fit and a top value. */
export function filterRoster(personas = [], { q = '', status = '', fit = '', value = '' } = {}) {
  const needle = q.trim().toLowerCase();
  return personas.filter((p) => (!needle || `${p.name} ${p.tagline}`.toLowerCase().includes(needle))
    && (!status || p.status === status)
    && (!fit || (p.natural_fit ?? []).includes(fit))
    && (!value || (p.top_values ?? []).includes(value)));
}

/** A team in SA2's "Teams using" list: company › project, by name. */
export const teamLine = (t) => [t?.company || NOT_RECORDED, t?.project].filter(Boolean).join(' › ');

/** SA2's history: what changed, in words, and before → after. */
const ACTION_WORDS = {
  'cohort.add': 'Added to cohort', 'cohort.remove': 'Removed from cohort',
  'persona.offer': 'Offered in the gallery', 'persona.hide': 'Hidden from the gallery', 'persona.retire': 'Retired',
  'persona.rename': 'Name changed', 'persona.identity': 'Identity changed', 'persona.defaults': 'Defaults for teams changed',
};
export const actionWord = (a) => ACTION_WORDS[a] ?? a;
const brief = (v) => {
  if (v == null) return NOT_RECORDED;
  if (typeof v !== 'object') return String(v);
  return Object.entries(v).filter(([k]) => k !== 'trademark_checked')
    .map(([k, x]) => `${k.replace(/_usd$/, '').replace(/_/g, ' ')}: ${x == null ? NOT_RECORDED : /_usd$/.test(k) ? usd(x) : x}`).join(' · ');
};
export const historyLine = (h) => `${brief(h?.before)} → ${brief(h?.after)}`;

/** The identity fields SA2 edits. Values, risk and natural fit are shown and never sent. */
export const IDENTITY_FIELDS = ['name', 'tagline', 'story', 'goal', 'avatar'];
/** What an identity form would change: only the fields that differ, trimmed. */
export function identityChanges(persona, draft) {
  const out = {};
  for (const k of IDENTITY_FIELDS) {
    const v = String(draft?.[k] ?? '').trim();
    if (v && v !== persona?.[k]) out[k] = v;
  }
  return out;
}
/** SA2b · Save changes: a reason, and the trademark check when the name changes. */
export const saveArmed = ({ changes, reason, trademark }) => Object.keys(changes ?? {}).length > 0 && reasonOk(reason) && (!('name' in (changes ?? {})) || trademark === true);
/** Hide or Retire: a reason. */
export const statusArmed = ({ reason }) => reasonOk(reason);
/** Defaults: an offered model, two caps above zero, the start no higher than the maximum, and a reason. */
export function defaultsArmed({ model, start, max, reason }) {
  const s = Number(start), m = Number(max);
  return Boolean(model) && Number.isFinite(s) && Number.isFinite(m) && s > 0 && m > 0 && s <= m && reasonOk(reason);
}

/** SA2b's retire dialog: what retiring does, with the teams that use it. */
export function retireLines(p) {
  const n = p?.usage?.teams;
  const who = n == null ? 'The teams that use this agent' : `${countWord(n)} team${n === 1 ? '' : 's'} use ${p.name}`;
  return [`${who}. Open proposals stay decidable, and ${p.name} stops running at once.`, `${p.name} leaves the gallery. The history and audit stay.`];
}

/** The Worker's refusal codes, in the page's words. Anything else shows the Worker's own sentence. */
const REFUSALS = {
  values_fixed: 'Values, risk and natural fit cannot be changed.',
  reason_required: `Say why, in at least ${REASON_MIN} characters.`,
  trademark_unchecked: 'Tick "Trademark check done" before changing the name.',
  name_taken: 'Another agent already has that name.',
  no_change: 'Nothing here differs from what teams see now.',
  start_above_max: 'Teams cannot start above the maximum cap.',
  model_not_offered: 'That model is not offered.',
  cap_above_platform: 'That cap is above the platform maximum.',
};
export const rosterRefusal = (e) => wordsFor(REFUSALS, e, 'That change was not saved.');
/** SA5's columns. */
export const COMPANY_COLUMNS = ['Skill', 'Company', 'Author', 'Area', 'Tools', 'Status'];
/** SA7's columns. */
export const RUN_COLUMNS = ['Time', 'Agent', 'Skills', 'Team', 'Model', 'Tokens', 'Cost', 'Status', 'Proposal'];
/** SA8's columns. */
export const AUDIT_COLUMNS = ['When', 'Who', 'Action', 'What', 'Before → after', 'Reason'];

/** SA6 · Guardrails: the three platform rules and the check that enforces each. */
export const GUARDRAILS = [
  { rule: 'Never “advisor” or “advice” on AI surfaces', check: 'Wording check on every output before it is proposed' },
  { rule: 'Legal and Capital skills explain or draft, never decide', check: 'Output-kind check: no decision fields' },
  { rule: 'No invented figures', check: 'Every figure must match a record, or it reads “Not recorded”' },
];

/** SA6 · Caps: the four limits the policy will hold. */
export const CAPS = ['Platform monthly budget', 'Default team cap', 'Maximum team cap', 'Per-run ceiling'];

/**
 * SA6b · Pause all AI agents. The confirmation is the word PAUSE exactly and a
 * reason; both are required before the button arms (H4 enforces the same on
 * the Worker).
 */
export const PAUSE_WORD = 'PAUSE';
export const pauseArmed = ({ typed, reason }) => typed === PAUSE_WORD && reasonOk(reason);

/** SA6b's banner, the sentence every team sees while agents are paused. */
export const PAUSED_BANNER = 'AI agents are paused by Axal VC HQ. You can still read and decide proposals. Agents resume when HQ turns them back on.';

/** The panel's promise, under the title on every tab. */
export const SUBTITLE = 'The agents and skills every team is offered, the caps and models they run on, and how they are used. Every change is logged with your name and a reason.';
