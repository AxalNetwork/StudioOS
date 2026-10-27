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
 * Since D1004 only Unclassified counts from it; Overview reads D999 below.
 */
import { PERSONAS } from '../../../lib/personas.js';

export const SEG_PATH = '/admin/persona-segments';
export const SEG_UNCLASSIFIED_PATH = '/admin/persona-segments/unclassified';
export const ACCOUNTS_PATH = '/admin/accounts';
export const CONTENT_PATH = '/admin/content';
export const SEG_TITLE = 'Persona segments';
export const PAGE_LINE = 'Who your members are within each profile, what each segment needs, and what you offer it.';
export const RAIL_NOTE = 'Eadwyn reads the segment counts on this page. Nothing changes until you act.';
/** D1004: a plain Admin's rail note. HQ writes the segment profiles (D997 §4). */
export const ADMIN_RAIL_NOTE = 'Eadwyn reads the segment counts on this page. HQ writes the segment profiles; nothing changes until you act.';
export const NOT_YET = 'Not read here yet';
export const LIST_CAP = 500;
export const LIST_FAILED = 'Persona segments could not be read. This is not a claim that no one has a segment.';

/** The moved notice, in the viewer's shell (#2378): Accounts for an Admin, Content for HQ. */
export function movedNotices(superAdmin) {
  return { personas: superAdmin ? 'Personas is now Persona segments, under Content.' : 'Personas is now Persona segments, under Accounts.' };
}

/** The page's tabs (D997 §1; D1006 adds Activity and, for HQ's Super Admin, Suggestions). */
export const TABS = [
  { key: 'overview', label: 'Overview', path: '' },
  { key: 'unclassified', label: 'Unclassified', path: '/unclassified' },
  { key: 'activity', label: 'Activity', path: '/activity' },
  { key: 'suggestions', label: 'Suggestions', path: '/suggestions', superAdmin: true },
];

export function tabOf(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  if (p === SEG_PATH) return 'overview';
  return TABS.find((t) => t.path && p === `${SEG_PATH}${t.path}`)?.key ?? null;
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

/** "How segments were set", in the canvas's words. */
const SOURCE_WORD = { router: 'Suggested at sign-up', self_select: 'Chosen by the member', admin_retag: 'Set by an admin' };
/** "How sure the sign-up suggestion was": D997's four bands (D999 counts them). */
export const BANDS = [
  { label: 'Under 50%', lo: 0, hi: 0.5 },
  { label: '50 to 69%', lo: 0.5, hi: 0.7 },
  { label: '70 to 89%', lo: 0.7, hi: 0.9 },
  { label: '90% and over', lo: 0.9, hi: Infinity },
];
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

// ---------------------------------------------------------------------------
// D1004 (#2819, part 7 of #2378) — Overview complete, on the reads parts 2 and
// 3 added. Overview no longer counts from the persona list:
//   - `seg`       GET /api/personas/admin/segments (D999): counts over every
//                 account but admins, each block `{ available: true, … }` or
//                 `{ available: false, reason }`. Not capped, so no Guard L.
//   - `profiles`  GET /api/personas/segments (D1000): each segment's name,
//                 profile, status and who they are, as HQ wrote them.
//   - `coverage`  GET /api/personas/segments/coverage (D1000): needs met,
//                 gaps and offers by kind.
// A block that could not be read says so; it is never drawn as zeros.
// ---------------------------------------------------------------------------

export const BLOCK_FAILED = 'Could not be read. This is not a claim that there are none.';
export const ALL_FAILED = 'Persona segments could not be read.';
export const ALL_FAILED_LINE = 'Try again. The sidebar, the tabs and Eadwyn still work.';
export const NOT_PER_PROFILE = 'Counted across every profile: the read does not split it by profile.';
export const SCOPE_LINE = 'Today only HQ-held accounts exist. Subsidiaries appear once they are deployed.';

/** A block the read could not answer: missing, or `available: false`. */
export const failed = (b) => !b || b.available === false;
const nf = (n) => Number(n).toLocaleString('en-US');

/** The profile filter: All, then the five profiles in the canvas's order. */
export const PROFILE_FILTERS = [{ role: 'all', label: 'All' }, ...PROFILES.map(({ role, label }) => ({ role, label }))];

/**
 * The four tiles. Under a profile filter, In a segment and No segment come
 * from that profile's group; Segment and profile differ and the admin moves
 * are counted across every profile, so they say so rather than show a number
 * that is not the profile's.
 */
export function overviewTiles(seg, profile = 'all') {
  const m = seg?.members; const byP = seg?.by_profile; const moves = seg?.moves_30d;
  const one = profile !== 'all';
  const group = one && !failed(byP) ? (byP.profiles || []).find((g) => g.profile === profile) : null;
  const tagged = one
    ? (failed(byP) ? { failed: true } : { value: (group?.members || 0) - (group?.no_segment || 0), sub: `of ${nf(group?.members || 0)} ${profileLabel(profile).toLowerCase()}` })
    : (failed(m) ? { failed: true } : {
      value: m.in_segment,
      sub: m.total ? `of ${nf(m.total)} members · ${Math.round((m.in_segment / m.total) * 100)}%` : 'No members yet',
      delta: m.new_30d ? `+${nf(m.new_30d)} in 30 days` : null,
    });
  const untagged = one
    ? (failed(byP) ? { failed: true } : { value: group?.no_segment || 0 })
    : (failed(m) ? { failed: true } : { value: m.no_segment });
  const differ = one ? { notPerProfile: true } : (failed(m) ? { failed: true } : { value: m.profile_differs, sub: 'Members whose account profile is not their segment’s.' });
  const moved = one ? { notPerProfile: true } : (failed(moves) ? { failed: true } : { value: moves.count });
  return { tagged, untagged, differ, moved };
}

/** The sub-account chips: LPs counted from approved applications; product testers are not recorded yet. */
export function subAccountChips(seg) {
  const s = seg?.sub_accounts;
  if (failed(s)) return { failed: true };
  return {
    lp: { total: s.lp?.total ?? 0, noSegment: s.lp?.no_segment ?? 0, bySegment: s.lp?.by_segment || {}, definition: s.lp?.definition || '' },
    productTester: s.product_tester?.recorded === false ? { recorded: false, reason: s.product_tester.reason } : { recorded: true },
  };
}

/** "Segments by profile" from D999's `by_profile`, in the shape the bars draw; Other only when it holds someone. */
export function segmentsByProfileRead(seg, profile = 'all') {
  const b = seg?.by_profile;
  if (failed(b)) return { failed: true, groups: [] };
  const toGroup = (g, p) => {
    const bars = (g.segments || []).map((s) => ({ id: s.id, label: segmentLabel(s.id), count: s.count }));
    return { role: p.role, label: p.label, tone: p.tone, bars, none: g.no_segment || 0, total: g.members || 0 };
  };
  const groups = PROFILES.map((p) => toGroup((b.profiles || []).find((g) => g.profile === p.role) || {}, p));
  if (b.other?.members) groups.push(toGroup(b.other, { role: null, label: 'Other', tone: 'muted' }));
  return { failed: false, groups: profile === 'all' ? groups : groups.filter((g) => g.role === profile) };
}

/** "How segments were set" from D999's `how_set`. */
export function howSetRead(seg) {
  const b = seg?.how_set;
  if (failed(b)) return { failed: true };
  const c = b.counts || {};
  return { failed: false, rows: Object.entries(SOURCE_WORD).map(([key, label]) => ({ key, label, count: c[key] || 0 })), other: c.not_recorded || 0 };
}

const BAND_KEYS = ['under_50', '50_69', '70_89', '90_up'];
/** "How sure the sign-up suggestion was" from D999's `confidence`; a missing confidence is counted apart. */
export function confidenceRead(seg) {
  const b = seg?.confidence;
  if (failed(b)) return { failed: true };
  const byKey = Object.fromEntries((b.bands || []).map((x) => [x.key, x.count]));
  return { failed: false, counts: BANDS.map((band, i) => ({ label: band.label, count: byKey[BAND_KEYS[i]] || 0 })), total: b.over || 0, unrecorded: b.not_recorded || 0 };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const weekLabel = (iso) => { const [, mo, d] = String(iso).split('-').map(Number); return `${d} ${MONTHS[mo - 1]}`; };

/**
 * "New segment tags per week" as D893's weekly line: eight Monday weeks, the
 * current week to date. A week before any segment was dated is null, a break
 * in the line; a quiet week after that is a real 0.
 */
export function weeklyRead(seg) {
  const b = seg?.weekly;
  if (failed(b)) return { failed: true };
  const weeks = b.weeks || [];
  const values = weeks.map((w) => (w.count === null || w.count === undefined ? null : Number(w.count)));
  const labels = weeks.map((w) => weekLabel(w.week_start));
  const last4 = values.slice(-4).filter((v) => v !== null);
  const now = values[values.length - 1];
  const summary = values.every((v) => v === null)
    ? 'No segment was given a date in these eight weeks.'
    : `${nf(last4.reduce((t, v) => t + v, 0))} members were given a segment in the last 4 weeks${now === null ? '' : `, ${nf(now)} of them this week to date`}.`;
  const alt = `Members given a segment per week from ${labels[0] || ''}: ${values.map((v, i) => `${v === null ? 'not recorded' : nf(v)}${i === values.length - 1 ? ' so far' : ''}`).join(', ')}.`;
  return { failed: false, chart: { type: 'line', values, labels }, summary, alt, undated: b.undated || 0 };
}

/** The card groups, in the canvas's order; `any` is "Any profile". */
export const CARD_GROUPS = [...PROFILES.map(({ role, label, tone }) => ({ role, label, tone })), { role: 'any', label: 'Any profile', tone: 'muted' }];
export const STATUS_WORD = { active: 'Active', draft: 'Draft', retired: 'Retired' };

/**
 * "Your segments": HQ's profiles (D1000) with D999's counts and D1000's needs.
 * Each part answers alone: a card says which of its figures could not be read.
 */
export function segmentCardsRead({ seg, profiles, coverage }, profile = 'all') {
  if (!profiles || profiles.failed) return { failed: true, groups: [] };
  const rows = failed(seg?.segments) ? null : new Map((seg.segments.rows || []).map((r) => [r.id, r]));
  const cov = coverage && !coverage.failed ? new Map((coverage.segments || []).map((s) => [s.key, s])) : null;
  const lp = subAccountChips(seg);
  const cards = (profiles.segments || []).map((p) => {
    const r = rows ? rows.get(p.key) : undefined;
    const c = cov ? cov.get(p.key) : undefined;
    const needs = !cov ? { failed: true } : !c || !c.needs?.recorded
      ? { recorded: false, reason: c?.needs?.reason || 'HQ has not written needs for this segment yet.' }
      : { recorded: true, top: c.needs.items?.[0]?.text || null, met: c.needs.met, total: c.needs.total, gaps: (c.needs.gaps || []).length };
    return {
      key: p.key, name: p.name, profile: p.profile, status: p.status, who: p.who || null,
      members: rows ? (r ? r.members : 0) : null,
      new30: rows && r ? r.new_30d : null,
      lp: lp.failed ? null : (lp.lp.bySegment[p.key] || 0),
      needs,
    };
  });
  const groups = CARD_GROUPS
    .filter((g) => profile === 'all' || g.role === profile)
    .map((g) => ({ ...g, cards: cards.filter((x) => x.profile === g.role) }));
  return { failed: false, membersFailed: !rows, groups };
}

/** The Advisors' empty group: how many advisors have no segment, from D999. */
export function advisorsWithout(seg) {
  const b = seg?.by_profile;
  if (failed(b)) return null;
  return (b.profiles || []).find((g) => g.profile === 'advisor')?.no_segment ?? 0;
}

export const OFFER_KINDS = [
  { key: 'programs', gap: 'program', label: 'Programs' },
  { key: 'perks', gap: 'perk', label: 'Perks' },
  { key: 'events', gap: 'events', label: 'Events' },
  { key: 'content', gap: 'content', label: 'Content' },
  { key: 'sidebar_links', gap: 'sidebar_link', label: 'Sidebar links' },
];

/**
 * "Needs and offers": one row per segment, gaps first. A cell is the number
 * of offers of that kind, "Gap" (with the number when there are some) where
 * a need asks for that kind and nothing of it answers, a dash where none is
 * offered and no need asks, and "Could not be read" for a store that failed.
 */
export function needsTable(coverage, { profile = 'all', q = '' } = {}) {
  if (!coverage || coverage.failed) return { failed: true, rows: [] };
  const s = String(q || '').trim().toLowerCase();
  const rows = (coverage.segments || []).map((x) => {
    const gapKinds = new Set(x.gap_kinds || []);
    const cells = OFFER_KINDS.map((k) => {
      const o = x.offers?.[k.key];
      if (failed(o)) return { kind: k.key, unreadable: true, text: 'Could not be read' };
      const n = Number(o.count) || 0;
      if (gapKinds.has(k.gap)) return { kind: k.key, gap: true, text: n ? `${n} · Gap` : 'Gap' };
      return { kind: k.key, text: n ? nf(n) : '—', count: n };
    });
    const needs = x.needs?.recorded
      ? { text: x.needs.met === null || x.needs.met === undefined ? `Unknown of ${x.needs.total}` : `${x.needs.met} of ${x.needs.total}`, recorded: true }
      : { text: 'Not recorded', recorded: false };
    const gaps = cells.filter((c) => c.gap).length + (x.needs?.recorded ? (x.needs.gaps || []).length : 0);
    return { key: x.key, name: x.name, profile: x.profile, status: x.status, cells, needs, gaps };
  });
  const shown = rows
    .filter((r) => profile === 'all' || r.profile === profile)
    .filter((r) => !s || r.name.toLowerCase().includes(s))
    .sort((a, b) => b.gaps - a.gaps || a.name.localeCompare(b.name));
  return { failed: false, rows: shown, total: rows.length };
}

/** The profile line under a needs row: the profile's name, and the status when it is not Active. */
export function profileLine(profile, status) {
  const label = profile === 'any' ? 'Any profile' : profileLabel(profile);
  return status && status !== 'active' ? `${label} · ${STATUS_WORD[status] || status}` : label;
}
