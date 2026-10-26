/**
 * D1005 (#2820, part 8 of #2378) — one segment's page and SEG4's Move dialog.
 * Pure: no React, no fetch.
 *
 * THE PAGE is `/admin/persona-segments/:key`, with three tabs: Profile (the
 * address itself), `/members` and `/activity` (SEG2, SEG3, SEG8). Its reads:
 *   - `profile`     GET /api/personas/segments/:key (D1000): the segment as HQ wrote it;
 *   - `seg`         GET /api/personas/admin/segments (D999): its member count and sub-accounts;
 *   - `completion`  GET /api/personas/segments/:key/completion (D1128): who answered every question;
 *   - `answers`     GET /api/personas/segments/:key/answers (D1001): the sign-up answers, as counts;
 *   - `archetypes`  GET /api/personas/segments/:key/archetypes (D1001): how they work, as counts;
 *   - `coverage`    GET /api/personas/segments/coverage (D1000): its needs and what answers them;
 *   - `members`     GET /api/personas/admin/members?segment=:key (D1002), a page at a time;
 *   - `activity`    GET /api/personas/admin/activity?segment=:key (D1002, filtered by D1005).
 * Each answers alone. A count from 1 to 4 comes back suppressed and reads
 * "<5"; one the read does not hold reads "Not recorded", never 0. Profile
 * shows counts only; names appear only in the Members list.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';
import { PROFILES, SEG_PATH, STATUS_WORD, failed, profileLabel } from './segModel.js';

const nf = (n) => Number(n).toLocaleString('en-US');

/* ------------------------------------------------------------------ *
 * The addresses
 * ------------------------------------------------------------------ */

export const SEGMENT_TABS = [
  { key: 'profile', label: 'Profile', path: '' },
  { key: 'members', label: 'Members', path: '/members' },
  { key: 'activity', label: 'Activity', path: '/activity' },
];
/** Words under the base that are tabs or pages of their own, never a segment. */
const RESERVED = new Set(['new', 'unclassified', 'activity', 'suggestions']);
const KEY = /^[a-z0-9_]{1,64}$/;

export const segmentHref = (key, tab = 'profile') => `${SEG_PATH}/${encodeURIComponent(key)}${SEGMENT_TABS.find((t) => t.key === tab)?.path ?? ''}`;

/** `{ key, tab }` for one segment's page, or null for any other address. */
export function segmentTabOf(pathname) {
  const rest = String(pathname || '').replace(/\/+$/, '').slice(SEG_PATH.length);
  const m = /^\/([^/]+)(?:\/(members|activity))?$/.exec(rest);
  if (!m || !String(pathname || '').startsWith(`${SEG_PATH}/`)) return null;
  const key = decodeURIComponent(m[1]);
  if (RESERVED.has(key) || !KEY.test(key)) return null;
  return { key, tab: m[2] || 'profile' };
}

/* ------------------------------------------------------------------ *
 * Counts
 * ------------------------------------------------------------------ */

export const SMALL = '<5';

/** A D1001/D1128 cell `{ count, suppressed }` in words: "<5", the number, or "Not recorded". */
export function cellText(c) {
  if (c && c.suppressed) return SMALL;
  if (!c || c.count === null || c.count === undefined || !Number.isFinite(Number(c.count))) return NOT_RECORDED;
  return nf(c.count);
}
const cellCount = (c) => (c && !c.suppressed && Number.isFinite(Number(c?.count)) ? Number(c.count) : null);

/** The profile's tone and label, from D997's fixed colours. */
export const profileTone = (role) => PROFILES.find((p) => p.role === role)?.tone || 'muted';
export const profileWord = (role) => (role === 'any' ? 'Any profile' : profileLabel(role));
export const statusWord = (s) => STATUS_WORD[s] || s || NOT_RECORDED;

/**
 * SEG2's four tiles: Members and the 30-day change (D999), Sub-accounts (D999's
 * LP count for this segment, not added to the total; product testers are not
 * recorded yet), Still Explorers (members here whose profile is still
 * Explorer) and Answered every question (D1128).
 */
export function profileTiles({ seg, completion }, key) {
  const segFailed = !seg || seg.status === 'error' || failed(seg?.data?.segments);
  const row = segFailed ? null : (seg.data.segments.rows || []).find((r) => r.id === key) || null;
  const members = segFailed
    ? { key: 'members', label: 'Members', failed: true }
    : { key: 'members', label: 'Members', value: nf(row ? row.members : 0), sub: row && row.new_30d ? `+${nf(row.new_30d)} in 30 days` : '' };
  const subs = segFailed ? null : seg.data.sub_accounts;
  const sub = segFailed || failed(subs)
    ? { key: 'sub', label: 'Sub-accounts', failed: true }
    : {
      key: 'sub', label: 'Sub-accounts',
      value: `LP ${nf(Number(subs.lp?.by_segment?.[key]) || 0)}`,
      sub: subs.product_tester?.recorded === false ? `not added to the total. Product testers: ${NOT_RECORDED.toLowerCase()}.` : 'not added to the total',
    };
  const explorers = segFailed
    ? { key: 'explorers', label: 'Still Explorers', failed: true }
    : { key: 'explorers', label: 'Still Explorers', value: nf(row ? row.still_explorers ?? 0 : 0), sub: row && !row.still_explorers && row.members && row.profile ? `every member here is ${article(profileLabel(row.profile).replace(/s$/, ''))}` : '' };
  let answered;
  if (!completion || completion.status === 'loading') answered = { key: 'answered', label: 'Answered every question', loading: true };
  else if (completion.status === 'error') answered = { key: 'answered', label: 'Answered every question', failed: true };
  else if (!completion.data?.recorded) answered = { key: 'answered', label: 'Answered every question', value: NOT_RECORDED, sub: completion.data?.reason || '' };
  else answered = { key: 'answered', label: 'Answered every question', value: `${cellText(completion.data.answered)} of ${cellText(completion.data.members)}`, sub: '' };
  return [members, sub, explorers, answered];
}

/** "What they told us at sign-up": each question as bars, "Not answered" hollow, never a name. */
export function answersView(read) {
  if (!read || read.status === 'loading') return { status: 'loading' };
  if (read.status === 'error' || !Array.isArray(read.data?.questions)) return { status: 'failed' };
  return {
    status: 'ready',
    questions: read.data.questions.map((q) => {
      const bars = q.type === 'text'
        ? [{ label: 'Answered', text: cellText(q.answered), count: cellCount(q.answered) }]
        : (q.buckets || []).map((b) => ({ label: b.label, text: cellText(b), count: cellCount(b) }));
      bars.push({ label: 'Not answered', text: cellText(q.not_recorded), count: cellCount(q.not_recorded), hollow: true });
      return { key: q.key, prompt: q.prompt, open: q.type === 'text', bars, max: Math.max(1, ...bars.map((b) => b.count ?? 0)) };
    }),
  };
}

/** "How they work": each displayed working style with its count, those with none recorded hollow. */
export function archetypesView(read) {
  if (!read || read.status === 'loading') return { status: 'loading' };
  if (read.status === 'error' || !Array.isArray(read.data?.archetypes)) return { status: 'failed' };
  const bars = read.data.archetypes
    .map((a) => ({ label: a.label, text: cellText(a), count: cellCount(a), suppressed: Boolean(a.suppressed) }))
    .filter((b) => b.suppressed || (b.count ?? 0) > 0);
  bars.push({ label: 'Not recorded', text: cellText(read.data.not_recorded), count: cellCount(read.data.not_recorded), hollow: true });
  return { status: 'ready', bars, max: Math.max(1, ...bars.map((b) => b.count ?? 0)), profiled: cellText(read.data.profiled) };
}

/** "Needs and what answers them": HQ's needs (D1000) with what each is answered by. */
export function needsView(profile) {
  const needs = Array.isArray(profile?.needs) ? profile.needs : [];
  if (!needs.length) return { recorded: false, reason: 'HQ has not written needs for this segment yet.' };
  return {
    recorded: true,
    items: needs.map((n) => ({
      id: n.id, text: n.text,
      answered: (n.answered_by || []).map((a) => `${ANSWER_KIND[a.kind] || a.kind}${a.ref ? `: ${a.ref}` : ''}`),
    })),
  };
}
const ANSWER_KIND = { program: 'Program', perk: 'Perk', events: 'Events', content: 'Content', sidebar_link: 'Sidebar link' };

/* ------------------------------------------------------------------ *
 * Members (SEG3)
 * ------------------------------------------------------------------ */

export const HOW_SET = [
  { key: 'router', label: 'Suggested at sign-up' },
  { key: 'self_select', label: 'Chosen by the member' },
  { key: 'admin_retag', label: 'Set by an admin' },
  { key: 'not_recorded', label: NOT_RECORDED },
];
export const CONF_BANDS = [
  { key: 'under_50', label: 'Under 50%' },
  { key: '50_69', label: '50 to 69%' },
  { key: '70_89', label: '70 to 89%' },
  { key: '90_up', label: '90% and over' },
];
export const ACTIVE = [
  { key: '7d', label: 'In 7 days' },
  { key: '30d', label: 'In 30 days' },
  { key: '90d', label: 'In 90 days' },
  { key: 'never', label: 'Never' },
];
export const MEMBER_SORTS = [
  { key: 'given', label: 'Tagged, newest first' },
  { key: 'joined', label: 'Joined, newest first' },
  { key: 'last_active', label: 'Last active, newest first' },
  { key: 'name', label: 'Name, A to Z' },
];

/** The members read's parameters for one segment, from the page's filters; an empty filter is left out. */
export function membersParams(key, f = {}) {
  return {
    segment: key, q: f.q && f.q.trim().length >= 2 ? f.q.trim() : undefined,
    profile: f.profile || undefined, how_set: f.how_set || undefined, band: f.band || undefined, sub: f.sub || undefined,
    answered: f.answered || undefined, active: f.active || undefined, sort: f.sort || 'given', page: f.page > 1 ? f.page : undefined,
  };
}

const day = (s) => {
  const t = Date.parse(String(s || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(s || '')) ? '' : 'Z'));
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null;
};

/** One member's row: who, profile, sub-accounts, how set, confidence (a suggestion at sign-up only), tagged on, last active. */
export function memberRow(m) {
  const subs = m?.sub_accounts || {};
  const subText = subs.lp === null && subs.tester === null ? NOT_RECORDED
    : [subs.lp ? 'LP' : null, subs.tester ? 'Product tester' : null].filter(Boolean).join(' · ') || '—';
  return {
    id: m.user_id,
    name: m.name || m.email || NOT_RECORDED,
    email: m.name && m.email ? m.email : null,
    profile: profileLabel(m.profile),
    profileRole: m.profile,
    differs: m.profile_differs === true,
    sub: subText,
    howSet: HOW_SET.find((h) => h.key === m.how_set)?.label || NOT_RECORDED,
    confidence: m.how_set === 'router' && typeof m.confidence === 'number' ? `${Math.round(m.confidence * 100)}%` : '—',
    tagged: day(m.given_at) || NOT_RECORDED,
    lastActive: day(m.last_active) || 'Never',
    segment: m.segment || null,
  };
}

/** "1–25 of 61", the read's own total. */
export function rangeText(read) {
  const total = Number(read?.total) || 0;
  if (!total) return '0 of 0';
  const size = Number(read.page_size) || 25;
  const start = (Number(read.page) - 1) * size + 1;
  return `${nf(start)}–${nf(Math.min(total, start + size - 1))} of ${nf(total)}`;
}

/* ------------------------------------------------------------------ *
 * Activity (SEG8, this segment's)
 * ------------------------------------------------------------------ */

export const ACTIVITY_KINDS = [
  { key: 'move', label: 'Moves' },
  { key: 'signup', label: 'Sign-up choices' },
  { key: 'segment_edit', label: 'Segment edits' },
];
const who = (p) => (p?.name ? p.name : 'An admin');

/** One activity row in words, as SEG8 draws it; names are the members' and admins' own, from the read. */
export function activityRow(r, key) {
  const member = r.member?.name || 'A member';
  let text;
  if (r.kind === 'move') {
    text = r.to?.key === key
      ? `${who(r.actor)} moved ${member} into ${r.to?.name || 'this segment'}${r.from ? ` from ${r.from.name}` : ''}.`
      : `${who(r.actor)} moved ${member} out to ${r.to?.name || 'another segment'}.`;
  } else if (r.kind === 'signup') {
    text = `${member} ${r.detail?.how_set === 'router' ? 'was suggested' : 'chose'} ${r.to?.name || 'this segment'} at sign-up${r.detail?.second ? ' as a second segment' : ''}.`;
  } else if (r.kind === 'segment_edit') {
    const fields = Array.isArray(r.detail?.fields) ? r.detail.fields : [];
    text = `${who(r.actor)} edited ${fields.length ? fields.join(', ') : 'the segment'}${r.detail?.reason ? `: ${r.detail.reason}` : '.'}`;
  } else {
    text = `${who(r.actor)} asked ${member} to finish their profile.`;
  }
  return { text, kind: ACTIVITY_KINDS.find((k) => k.key === r.kind)?.label || r.kind, when: day(r.at) || NOT_RECORDED };
}

/* ------------------------------------------------------------------ *
 * SEG4: the Move dialog
 * ------------------------------------------------------------------ */

export const ADMIN_REFUSAL = 'Only a super admin can move an admin account.';

/**
 * What the Move dialog says for `members` (each `{ user_id, name, email,
 * profile, is_admin, segment }`) moving to `target` (a segment profile), by
 * D1002's move: a member already in it is left as they are, an admin account
 * needs a Super Admin, a retired segment takes no one.
 */
export function moveView({ members = [], target = null, superAdmin = false }) {
  const list = members.filter(Boolean);
  const one = list.length === 1 ? list[0] : null;
  const title = one ? `Move ${one.name || one.email || 'this member'} to another segment` : `Move ${nf(list.length)} members to another segment`;
  const admins = list.filter((m) => m.is_admin || m.profile === 'admin');
  if (admins.length && !superAdmin) return { title, blocked: ADMIN_REFUSAL, canMove: false };
  const now = one
    ? one.segment ? `${one.segment.name}${one.howSet ? ` · ${one.howSet}` : ''}${one.confidence && one.confidence !== '—' ? ` · ${one.confidence}` : ''}` : 'No segment'
    : `${nf(list.length)} members`;
  if (!target) return { title, now, canMove: false, changes: [] };
  const already = list.filter((m) => m.segment?.key === target.key);
  if (already.length === list.length) {
    return { title, now, canMove: false, same: one ? `Already in ${target.name}. Nothing to change.` : `All ${nf(list.length)} are already in ${target.name}. Nothing to change.`, changes: [] };
  }
  if (target.status === 'retired') return { title, now, canMove: false, refusal: `${target.name} is retired, so it takes no new members.`, changes: [] };
  const differs = target.profile && target.profile !== 'any' ? list.filter((m) => m.profile && m.profile !== target.profile) : [];
  const info = one
    ? `${one.name || 'This member'} is ${article(profileWord(one.profile).replace(/s$/, ''))}. ${target.name} is ${target.profile === 'any' ? 'open to any profile' : `${article(profileWord(target.profile).replace(/s$/, ''))} segment`}.`
    : differs.length ? `${nf(differs.length)} of them ${differs.length === 1 ? 'has' : 'have'} a profile ${target.name} is not for.` : null;
  const changes = [
    `Their sidebar shows ${target.name}’s links.`,
    `${target.name}’s questions are asked next time they open their profile.`,
    'Logged under your name.',
  ];
  if (already.length) changes.unshift(`${nf(already.length)} already in ${target.name} ${already.length === 1 ? 'stays' : 'stay'} as they are.`);
  return { title, now, canMove: true, info, differs: differs.length > 0, changes };
}
const article = (w) => `${/^[AEIOU]/.test(w) ? 'an' : 'a'} ${w}`;

/** The line after a move: D1002's results counted in words. */
export function movedLine(reply, targetName) {
  const r = Array.isArray(reply?.results) ? reply.results : [];
  const n = (o) => r.filter((x) => x.outcome === o).length;
  const moved = n('moved');
  const parts = [moved ? (r.length === 1 ? `Moved to ${targetName}.` : `Moved ${nf(moved)} of ${nf(r.length)} to ${targetName}.`) : `No one was moved to ${targetName}.`];
  if (n('unchanged')) parts.push(`${nf(n('unchanged'))} ${n('unchanged') === 1 ? 'was' : 'were'} already in it.`);
  if (n('super_admin_required')) parts.push(`${nf(n('super_admin_required'))} ${n('super_admin_required') === 1 ? 'is an admin account' : 'are admin accounts'}, which only a super admin can move.`);
  if (n('user_not_found')) parts.push(`${nf(n('user_not_found'))} no longer ${n('user_not_found') === 1 ? 'exists' : 'exist'}.`);
  if (n('failed')) parts.push(`${nf(n('failed'))} could not be moved. Try again.`);
  return { text: parts.join(' '), moved };
}
