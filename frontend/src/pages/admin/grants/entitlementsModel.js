/**
 * D5059 (#5059) — program entitlements from held user licences, as pure functions over the Worker's reads
 * (`GET /api/admin/program-entitlements`, `/licences/:uid`). No React here, so `node --test` loads it alone.
 *
 * FOUR COLUMNS, NEVER ONE (Licences v2 addendum L37's Programs card): Eligible, Granted, In force, Source licence.
 * Eligibility is the licence type's rule; the grant is HQ's; in force also needs every blocker cleared (an
 * agreement, a valid licence). What blocks a program is said under it in the Worker's own sentence. An agreement
 * the Worker could not read is Not recorded or Unreadable, never drawn as signed. Nothing here reads a role.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';

export const HOLDERS_PATH = '/admin/licences/programs/holders';
export const userLicencePath = (uid) => `/admin/licences/programs/licence/${encodeURIComponent(uid)}`;
export { NOT_RECORDED };

/** The filter chips: all, then the four user licence types in the Worker's order. */
export const LICENCE_TYPES = [
  { key: 'all', label: 'All' },
  { key: 'founder', label: 'Founder' },
  { key: 'investor', label: 'Investor' },
  { key: 'operating_partner', label: 'Operating Partner' },
  { key: 'advisor', label: 'Advisor' },
];
export const typeLabel = (key) => LICENCE_TYPES.find((t) => t.key === key)?.label ?? key;

const STATUS = {
  in_force: { word: 'In force', tone: 'ok' },
  granted_not_in_force: { word: 'Not in force', tone: 'warn' },
  eligible_not_granted: { word: 'Not granted', tone: 'neutral' },
  paused: { word: 'Paused', tone: 'warn' },
  ended: { word: 'Ended', tone: 'neutral' },
  not_eligible: { word: 'Not eligible', tone: 'danger' },
};
export const statusOf = (p) => STATUS[p?.status] ?? { word: NOT_RECORDED, tone: 'neutral' };

/** The Granted cell: the grant's own state, or "Not granted". */
export function grantWord(p) {
  if (!p?.grant) return 'Not granted';
  return { granted: 'Granted', paused: 'Paused', ended: 'Ended' }[p.grant.state] ?? NOT_RECORDED;
}

/** The In force cell's word: "In force", or "Not in force" for anything granted that waits, else a dash. */
export function inForceWord(p) {
  if (p?.in_force) return 'In force';
  if (p?.grant && p.grant.state === 'granted') return 'Not in force';
  return '—';
}

/**
 * The Source licence cell. On a licence's own page, "This licence" when it sources the program, followed by any
 * other licence that does; elsewhere, each source's ref and type. No valid source reads "No valid licence", and
 * names the held licence that would have been one (suspended, terminated …).
 */
export function sourceWords(p, thisUid = null) {
  const sources = p?.sources || [];
  if (!sources.length) {
    const held = (p?.held_not_valid || []).map((h) => `${h.licence_ref} · ${h.status}`);
    return held.length ? [`No valid licence (${held.join(', ')})`] : ['No valid licence'];
  }
  return sources.map((s) => (thisUid && s.licence_uid === thisUid ? 'This licence' : `${s.licence_ref} · ${s.licence_type_label}`));
}

/** The blockers, in the Worker's sentences. */
export const blockerLines = (p) => (p?.blockers || []).map((b) => b.sentence);

/** The agreement read's honesty line, or null when the store answered. */
export function agreementsNote(state) {
  if (state === 'not_recorded') return 'Program licence agreements are not recorded here, so no agreement-required program is shown in force.';
  if (state === 'unreadable') return 'Program licence agreements could not be read, so no agreement-required program is shown in force.';
  return null;
}

/** The query the filters send: blank and "all" are left out. */
export function filterQuery({ type = 'all', q = '', program = '' } = {}) {
  const out = {};
  if (type && type !== 'all') out.licence_type = type;
  if (String(q).trim()) out.q = String(q).trim();
  if (program) out.program = program;
  return out;
}
