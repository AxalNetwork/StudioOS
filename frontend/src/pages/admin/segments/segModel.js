/**
 * D997 (#2378) — Persona segments at /admin/persona-segments, as pure
 * functions: the addresses and tabs, the moved notices, and the blocks built
 * from the reads that exist today. No React here, so `node --test` loads it.
 *
 * The reads (D997 §2):
 *   - `list`  GET /api/personas/admin/list — accounts with their primary
 *             persona (`persona_id, confidence` 0–1, `source`, `updated_at`)
 *             and `role`, newest accounts first, LIMIT 500. Admins are in it;
 *             every count here leaves them out. A D1 error is a 5xx.
 *   - the taxonomy, `lib/personas.js` (the Worker's twelve, mirrored and held
 *             equal by a test): label, who they are, questions, sidebar links.
 *
 * Guard L (D923): the list comes back at its cap of 500 when there are more
 * accounts, so every figure from it then says it covers the newest 500.
 */
import { PERSONAS } from '../../../lib/personas.js';

export const SEG_PATH = '/admin/persona-segments';
export const SEG_UNCLASSIFIED_PATH = '/admin/persona-segments/unclassified';
export const ACCOUNTS_PATH = '/admin/held/accounts';
export const CONTENT_PATH = '/admin/content';
export const SEG_TITLE = 'Persona segments';
export const PAGE_LINE = 'Who your members are within each profile, what each segment needs, and what you offer it.';
export const RAIL_NOTE = 'Eadwyn reads the segment counts on this page. Nothing changes until you act.';
export const NOT_YET = 'Not read here yet';
export const LIST_CAP = 500;
export const LIST_FAILED = 'Persona segments could not be read. This is not a claim that no one has a segment.';

/** The moved notice, in the viewer's shell (#2378): Accounts for an Admin, Content for HQ. */
export function movedNotices(superAdmin) {
  return { personas: superAdmin ? 'Personas is now Persona segments, under Content.' : 'Personas is now Persona segments, under Accounts.' };
}

/** The tabs this integration draws (D997 §1). Activity, Suggestions and one segment's page wait for their parts. */
export const TABS = [
  { key: 'overview', label: 'Overview', path: '' },
  { key: 'unclassified', label: 'Unclassified', path: '/unclassified' },
];

export function tabOf(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  if (p === SEG_PATH) return 'overview';
  if (p === SEG_UNCLASSIFIED_PATH) return 'unclassified';
  return null;
}

/** The profiles, in the canvas's order and colours. `exploring` is Explorers; an unknown role is Other. */
export const PROFILES = [
  { role: 'founder', label: 'Founders', tone: 'violet' },
  { role: 'investor', label: 'Investors', tone: 'sky' },
  { role: 'advisor', label: 'Advisors', tone: 'amber' },
  { role: 'partner', label: 'Operating Partners', tone: 'emerald' },
  { role: 'exploring', label: 'Explorers', tone: 'muted' },
];
const PROFILE_OF = Object.fromEntries(PROFILES.map((p) => [p.role, p]));
export const profileLabel = (role) => PROFILE_OF[role]?.label || 'Other';

const LABEL = Object.fromEntries(PERSONAS.map((p) => [p.id, p.label]));
/** A segment's name; a stored id the taxonomy does not know is shown as itself, marked. */
export const segmentLabel = (id) => LABEL[id] || `${id} (not in the taxonomy)`;

/** The members counted here: every account but admins. */
export function members(users) {
  return (users || []).filter((u) => u.role !== 'admin');
}

/** Whether the list came back at its cap, so it is not every account. */
export const capped = (users) => (users || []).length >= LIST_CAP;
export const scopeLine = (users) => (capped(users)
  ? `Counted over the newest ${LIST_CAP} accounts: the list stops there, so these are not every member.`
  : null);

/** The KPI tiles that exist today: in a segment and no segment, over members. */
export function tiles(users) {
  const m = members(users);
  const tagged = m.filter((u) => u.persona_id).length;
  return {
    members: m.length,
    tagged,
    untagged: m.length - tagged,
    pct: m.length ? Math.round((tagged / m.length) * 100) : null,
  };
}

/**
 * "Segments by profile": for each profile, a bar per segment its members hold
 * (by count), then the hollow "No segment" bar. The profile is the member's
 * account role, not the persona's own `role_alignment`, which part 1 fixes.
 */
export function segmentsByProfile(users) {
  const m = members(users);
  const groups = [...PROFILES, { role: null, label: 'Other', tone: 'muted' }].map((p) => {
    const inRole = m.filter((u) => (p.role ? u.role === p.role : !PROFILE_OF[u.role]));
    const by = new Map();
    for (const u of inRole) if (u.persona_id) by.set(u.persona_id, (by.get(u.persona_id) || 0) + 1);
    const bars = [...by.entries()].map(([id, n]) => ({ id, label: segmentLabel(id), count: n }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return { role: p.role, label: p.label, tone: p.tone, bars, none: inRole.length - bars.reduce((t, b) => t + b.count, 0), total: inRole.length };
  });
  // "Other" (no role, or a role this page does not know) is drawn only when it holds someone.
  return groups.filter((g) => g.role || g.total);
}

/** "How segments were set", in the canvas's words. */
const SOURCE_WORD = { router: 'Suggested at sign-up', self_select: 'Chosen by the member', admin_retag: 'Set by an admin' };
export function howSet(users) {
  const m = members(users).filter((u) => u.persona_id);
  const rows = Object.entries(SOURCE_WORD).map(([key, label]) => ({ key, label, count: m.filter((u) => u.source === key).length }));
  const other = m.filter((u) => !SOURCE_WORD[u.source]).length;
  return { rows, other };
}

/** "How sure the sign-up suggestion was": members whose segment was suggested at sign-up, by band. */
export const BANDS = [
  { label: 'Under 50%', lo: 0, hi: 0.5 },
  { label: '50 to 69%', lo: 0.5, hi: 0.7 },
  { label: '70 to 89%', lo: 0.7, hi: 0.9 },
  { label: '90% and over', lo: 0.9, hi: Infinity },
];
export function confidenceBands(users) {
  const m = members(users).filter((u) => u.persona_id && u.source === 'router');
  // A confidence nothing stored is not 0%: it is counted apart, never in "Under 50%".
  const known = (u) => u.confidence !== null && u.confidence !== undefined && u.confidence !== '' && Number.isFinite(Number(u.confidence));
  const counts = BANDS.map((b) => ({ label: b.label, count: m.filter((u) => known(u) && Number(u.confidence) >= b.lo && Number(u.confidence) < b.hi).length }));
  const unrecorded = m.filter((u) => !known(u)).length;
  return { counts, total: m.length, unrecorded };
}

/** "Your segments": every segment in the taxonomy with its member count and who they are. */
export function segmentCards(users) {
  const m = members(users);
  return PERSONAS.map((p) => ({
    id: p.id,
    label: p.label,
    who: p.short_description || null,
    count: m.filter((u) => u.persona_id === p.id).length,
    questions: (p.follow_up_questions || []).length,
  }));
}

/** Unclassified: members with no segment, newest accounts first, with counts by profile. */
export function unclassified(users) {
  const rows = members(users).filter((u) => !u.persona_id);
  const byProfile = PROFILES.map((p) => ({ ...p, count: rows.filter((u) => u.role === p.role).length }));
  const other = rows.filter((u) => !PROFILE_OF[u.role]).length;
  return { rows, byProfile, other };
}

/** Search over name and email from two characters. */
export function searchMembers(rows, q) {
  const s = String(q || '').trim().toLowerCase();
  if (s.length < 2) return rows || [];
  return (rows || []).filter((u) => [u.name, u.email].some((v) => String(v || '').toLowerCase().includes(s)));
}
