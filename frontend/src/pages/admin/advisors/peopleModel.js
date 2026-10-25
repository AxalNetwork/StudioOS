/**
 * D978 (#2764) — People (AP3) and the person drawer (AP4, AP9c) on Advisors &
 * Partners. Pure, so the tab, the drawer and their tests share it.
 *
 * THE READS ARE PART 1'S AND PART 4'S. The table is `GET /api/admin/network/
 * people` (D973): search, filters, sort and pages run on the server, and every
 * column is a block, `{ available, recorded, value | reason }`. The drawer is
 * D973's `GET …/people/:ref` beside D976's standing read `GET …/people/:userId`,
 * which carries the stage, the pause and the directory switch.
 *
 * A BLOCK IS NEVER A ZERO. A failed block reads "Unreadable" with its reason,
 * a value no store holds reads "Not recorded" with its reason, and only a
 * block that was read draws a value (D973's rule, AGENTS.md's).
 */

import { parseStamp } from '../../../ui/parseStamp.js';
import { AP_PATH } from './apModel.js';
import { NOT_RECORDED } from '../../../lib/absence.js';

export const PEOPLE_PATH = `${AP_PATH}/people`;
export const personPath = (ref) => `${PEOPLE_PATH}/${encodeURIComponent(ref)}`;
export const PAGE_SIZE = 25;
export const EXPORT_PAGE = 100;
export const UNREADABLE = 'Unreadable';
export { NOT_RECORDED };

// ---------------------------------------------------------------- blocks

/** A block's value when it was read, else undefined. */
export const take = (b) => (b && b.available && b.recorded ? b.value : undefined);

/**
 * One cell: `ready` with its words, or `unreadable` / `unrecorded` with the
 * block's reason. `fmt` turns a read value into words.
 */
export function cell(b, fmt = (v) => String(v)) {
  if (!b || typeof b !== 'object') return { state: 'unreadable', text: UNREADABLE, reason: 'This column was not in the answer.' };
  if (!b.available) return { state: 'unreadable', text: UNREADABLE, reason: b.reason || 'It could not be read. Try again.' };
  if (!b.recorded) return { state: 'unrecorded', text: NOT_RECORDED, reason: b.reason || 'No store records this.' };
  return { state: 'ready', text: fmt(b.value) };
}

/**
 * One of D976's standing blocks, whose shape is its own: `{ available: true,
 * ...fields }` when read, `{ recorded: false, reason }` when no store holds
 * it, `{ available: false, reason }` when the read failed.
 */
export function standingCell(b, fmt) {
  if (!b || typeof b !== 'object') return { state: 'unreadable', text: UNREADABLE, reason: 'This was not in the answer.' };
  if (b.recorded === false) return { state: 'unrecorded', text: NOT_RECORDED, reason: b.reason || 'No store records this.' };
  if (b.available !== true) return { state: 'unreadable', text: UNREADABLE, reason: b.reason || 'It could not be read. Try again.' };
  return { state: 'ready', text: fmt(b) };
}

// ---------------------------------------------------------------- words

export const KIND_LABELS = { advisor: 'Advisor', operating_partner: 'Operating partner', deck_only: 'Deck only' };
export const kindWord = (k) => KIND_LABELS[k] || NOT_RECORDED;

const STAGE_WORDS = { onboarding: 'Onboarding', active: 'Active', paused: 'Paused', ended: 'Ended' };
export const stageWord = (s) => STAGE_WORDS[s] || NOT_RECORDED;

const HOST_WORDS = { approved: '✓ Approved', pending: '◷ Waiting', declined: 'Declined', withdrawn: 'Withdrawn', removed: 'Removed' };
const LANE_WORDS = { drafting: 'Drafting', proposed: 'Proposed', signed: 'Signed', renewal_due: 'Renewal due', ended: 'Ended', other: 'Other' };
export const laneWord = (l) => LANE_WORDS[l] || l;

/** "fundraising_finance" → "Fundraising finance"; the read's own strings otherwise. */
const words = (s) => {
  const t = String(s ?? '').replace(/_/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

export const usd = (cents) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: cents % 100 ? 2 : 0 })}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A stamp as "12 Mar 2027", in UTC: D1's zone-less stamps are UTC (`parseStamp`). */
export function dayWord(stamp) {
  const ms = parseStamp(stamp);
  if (ms == null) return null;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** How long ago, in the canvas's short words: "3 h", "2 d", "1 w", "4 mo". */
export function agoWord(stamp, now) {
  const ms = parseStamp(stamp);
  if (ms == null) return null;
  const mins = Math.max(0, Math.floor((now - ms) / 60_000));
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  if (days < 60) return `${Math.floor(days / 7)} w ago`;
  return `${Math.floor(days / 30)} mo ago`;
}

/** The deck column. A roster card says where it reaches; a member says what the read says. */
export function deckWord(d) {
  // D1125 (#3005) reads a member's linked card; `null` is a member the roster holds no card for.
  if (d == null) return 'No deck card';
  if (!d.shown) return 'Hidden from the deck';
  if (d.reach === 'profile') return `On the slide · ${d.position}`;
  if (d.reach === 'named') return 'Name only';
  if (d.reach === 'counted') return 'Counted only';
  return 'Hidden from the deck';
}

const dealWord = (d) => {
  const end = dayWord(d.ends_at);
  return `${words(d.type) || 'Deal'}${end ? ` · ends ${end}` : ' · no end date recorded'}`;
};

/** Every column of one row, as words. */
export function rowOf(p, now) {
  const firm = p.firm && p.firm.available && p.firm.recorded && p.firm.value === null
    ? { state: 'ready', text: p.kind === 'operating_partner' ? 'No firm' : '—', warn: p.kind === 'operating_partner' }
    : cell(p.firm, (f) => (f.source === 'roster_text' ? `${f.name} (deck card)` : f.name));
  const skills = cell(p.skills, (list) => (list.length ? `${list.slice(0, 2).join(' · ')}${list.length > 2 ? ` +${list.length - 2}` : ''}` : 'None listed'));
  const host = cell(p.lab_host, (list) => (list.length ? HOST_WORDS[list[list.length - 1].status] || words(list[list.length - 1].status) : '—'));
  const sessions = cell(p.sessions_90d, (s) => String(s.total));
  const rating = cell(p.rating, (r) => (r.count ? `${Number(r.average).toFixed(1)} (${r.count})` : 'No ratings yet'));
  const terms = p.kind === 'operating_partner'
    ? cell(p.active_deals, (list) => (list.length ? dealWord(list[0]) : 'No deal yet'))
    : p.kind === 'advisor' ? cell(p.hourly_rate, (r) => `${usd(r.amount_cents)}/h`) : { state: 'ready', text: '—' };
  return {
    ref: p.ref,
    name: p.name || 'Name not recorded',
    headline: cell(p.headline),
    kind: kindWord(p.kind),
    firm,
    skills,
    stage: cell(p.stage, stageWord),
    profile: cell(p.profile_check, words),
    kyc: cell(p.kyc, words),
    host,
    sessions,
    rating,
    terms,
    deck: cell(p.deck, deckWord),
    lastActive: cell(p.last_active, (s) => agoWord(s, now) || NOT_RECORDED),
  };
}

// ---------------------------------------------------------------- the query

/** The filters this tab offers, in the canvas's order. Stage is not filterable yet (§ the read refuses it). */
export const FILTERS = [
  { key: 'kind', label: 'Kind' },
  { key: 'skill', label: 'Skill' },
  { key: 'sector', label: 'Sector' },
  { key: 'lab_host', label: 'Lab host' },
  { key: 'profile_check', label: 'Profile check' },
  { key: 'kyc', label: 'KYC' },
  { key: 'on_deck', label: 'On the deck' },
  { key: 'firm_attached', label: 'Firm attached' },
  { key: 'active_deal', label: 'Has an active deal' },
];
export const SORTS = [
  { key: 'name_asc', label: 'Name A–Z' },
  { key: 'name_desc', label: 'Name Z–A' },
  { key: 'firm_asc', label: 'Firm A–Z' },
  { key: 'sessions_desc', label: 'Most sessions' },
  { key: 'rating_desc', label: 'Highest rating' },
  { key: 'last_active_desc', label: 'Last active' },
];
const YES_NO = [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }];
const HOST_OPTIONS = ['pending', 'approved', 'declined', 'withdrawn', 'removed'].map((v) => ({ value: v, label: words(v) }));

/** Each filter's choices, from the read's own `filters` (stored values only). */
export function filterOptions(key, filters) {
  if (key === 'kind') return Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }));
  if (key === 'lab_host') return HOST_OPTIONS;
  if (['on_deck', 'firm_attached', 'active_deal'].includes(key)) return YES_NO;
  const stored = Array.isArray(filters?.[key]) ? filters[key] : [];
  const opts = stored.map((v) => ({ value: v, label: words(v) }));
  return key === 'profile_check' || key === 'kyc' ? [...opts, { value: 'not_recorded', label: NOT_RECORDED }] : opts;
}

/** The URL's search params as the tab's state: q, each filter, sort and page (1-based). */
export function stateOf(search) {
  const p = new URLSearchParams(search || '');
  const filters = {};
  for (const f of FILTERS) { const v = p.get(f.key); if (v) filters[f.key] = v; }
  const sort = SORTS.some((s) => s.key === p.get('sort')) ? p.get('sort') : 'name_asc';
  const page = Math.max(1, Number.parseInt(p.get('page') || '1', 10) || 1);
  return { q: (p.get('q') || '').slice(0, 200), filters, sort, page };
}

/** The state back to a search string, leaving defaults out. */
export function searchOf({ q, filters, sort, page }) {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  for (const f of FILTERS) if (filters?.[f.key]) p.set(f.key, filters[f.key]);
  if (sort && sort !== 'name_asc') p.set('sort', sort);
  if (page > 1) p.set('page', String(page));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** What the people read is asked. */
export function queryOf({ q, filters, sort, page }, limit = PAGE_SIZE) {
  return { ...(q ? { q } : {}), ...filters, sort, limit, offset: (page - 1) * limit };
}

/** "1–25 of 82", with an unknown total said as one. */
export function pageLine(offset, count, total) {
  if (!count) return total == null ? 'None on this page; the total is unknown' : `0 of ${total.toLocaleString('en-US')}`;
  const span = `${(offset + 1).toLocaleString('en-US')}–${(offset + count).toLocaleString('en-US')}`;
  return total == null ? `${span} of an unknown total` : `${span} of ${total.toLocaleString('en-US')}`;
}

export const activeFilterCount = (state) => Object.keys(state.filters || {}).length + (state.q ? 1 : 0);

// ---------------------------------------------------------------- the CSV

export const CSV_COLUMNS = [
  ['Name', (r) => r.name], ['Kind', (r) => r.kind], ['Headline', (r) => r.headline.text], ['Firm', (r) => r.firm.text],
  ['Skills', (r) => r.skills.text], ['Stage', (r) => r.stage.text], ['Profile check', (r) => r.profile.text],
  ['KYC', (r) => r.kyc.text], ['Lab host', (r) => r.host.text], ['Sessions, 90 days', (r) => r.sessions.text],
  ['Rating', (r) => r.rating.text], ['Terms', (r) => r.terms.text], ['Deck', (r) => r.deck.text], ['Last active', (r) => r.lastActive.text],
];

/** One CSV field: quoted, and a leading formula character neutralised. */
export function csvField(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** The CSV of these people. Every cell is its column's words, so a missing value reads "Not recorded", never 0. */
export function csvOf(people, now) {
  const rows = people.map((p) => rowOf(p, now));
  const head = CSV_COLUMNS.map(([h]) => csvField(h)).join(',');
  return [head, ...rows.map((r) => CSV_COLUMNS.map(([, f]) => csvField(f(r))).join(','))].join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- bulk add to the deck roster

/** Each picked person as a deck card, or why not. Deck-only names are already on the roster. */
export function deckDrafts(people, roster) {
  const linked = new Map();
  for (const r of roster || []) if (r?.linked_user?.id != null) linked.set(Number(r.linked_user.id), r);
  return people.map((p) => {
    if (p.kind === 'deck_only') return { ref: p.ref, name: p.name, skip: 'Already on the deck roster.' };
    if (p.user_id != null && linked.has(Number(p.user_id))) return { ref: p.ref, name: p.name, skip: 'Already has a deck card linked to their account.' };
    const firm = take(p.firm);
    return {
      ref: p.ref,
      name: p.name,
      payload: {
        name: p.name || '',
        kind: p.kind === 'operating_partner' ? 'partner' : 'advisor',
        role: take(p.headline) || null,
        company: firm?.source === 'account_link' ? firm.name : null,
        bio: null,
        linkedin_url: null,
        skills: [],
        is_active: false,
        ...(p.user_id != null ? { linked_user_id: Number(p.user_id) } : {}),
      },
    };
  });
}

/** One person's drawer card for "Add to deck roster": the deck card dialog, filled in. */
export function deckDraftOf(p) {
  const [d] = deckDrafts([p], []);
  if (!d.payload) return null;
  return {
    draft: {
      name: d.payload.name, kind: d.payload.kind, role: d.payload.role || '', company: d.payload.company || '',
      bio: '', linkedin_url: '', skills: [], is_active: false,
      linked_user: p.user_id != null ? { id: Number(p.user_id), name: p.name } : null,
    },
  };
}

// ---------------------------------------------------------------- the drawer's standing

/** The links to where each standing is decided. Nothing is decided in the drawer. */
export const DECIDED = {
  profile: { text: 'Decided in Approvals', to: '/admin/approvals' },
  kyc: { text: 'Decided in KYC', to: '/admin/kyc' },
  host: { text: 'Decided in the Spin-Out Lab', to: '/admin/programs/spinout-lab/hosts' },
  cohorts: { text: 'Manage in Programs', to: '/admin/programs/mentor-cohorts' },
  deck: { text: 'Edit on Deck roster', to: `${AP_PATH}/deck` },
  account: { text: 'Open in Accounts', to: '/admin/accounts/all' },
};

/** The public advisor directory, from D976's `directory`. */
export function directoryWord(dir, paused) {
  if (!dir) return null;
  if (dir.hidden_by_admin) return paused ? 'Hidden by an admin, and while paused' : 'Hidden by an admin';
  if (!dir.listed) return paused ? 'Hidden while paused' : 'Not listed';
  return 'Listed';
}

/** What the drawer may offer, from the person and their standing. */
export function controlsOf(person, standing) {
  if (!person || person.kind === 'deck_only' || person.user_id == null || !standing) return { pause: null, directory: null };
  const paused = Boolean(standing.pause?.paused);
  const pause = standing.stage === 'ended' ? null : paused ? 'resume' : 'pause';
  const dir = person.kind === 'advisor' && person.advisor_id != null && standing.directory && typeof standing.directory.listed === 'boolean'
    ? (standing.directory.hidden_by_admin ? 'show' : 'hide') : null;
  return { pause, directory: dir };
}

/** Each control's dialog: what it changes, said before anything is written (AP9c). */
export function dialogCopy(act, person) {
  const who = person?.name || 'This person';
  const advisor = person?.kind === 'advisor';
  switch (act) {
    case 'pause':
      return {
        title: `Pause ${who}?`,
        body: advisor
          ? 'They stay a member. New bookings stop and they are hidden from the advisor directory and Spin-Out Lab office hours until you resume. Bookings already made stay.'
          : 'They stay a member, and their stage reads Paused. Nothing else changes: partner office hours, the Lab’s partner hosts and the partner directory belong to their firm.',
        reason: true, button: 'Pause', busy: 'Pausing…',
      };
    case 'resume':
      return {
        title: `Resume ${who}?`,
        body: advisor
          ? 'Bookings open again, and they return to Spin-Out Lab office hours. They return to the advisor directory unless an admin hid them from it.'
          : 'Their stage leaves Paused. Nothing else changes.',
        reason: true, button: 'Resume', busy: 'Resuming…',
      };
    case 'hide':
      return {
        title: `Hide ${who} from the advisor directory?`,
        body: 'They leave the public advisor directory only. They stay bookable and stay in Spin-Out Lab office hours. This is not a pause.',
        reason: false, button: 'Hide from directory', busy: 'Hiding…',
      };
    case 'show':
      return {
        title: `Show ${who} in the advisor directory?`,
        body: 'They return to the public advisor directory. While they are paused, they stay hidden until resumed.',
        reason: false, button: 'Show in directory', busy: 'Showing…',
      };
    default:
      return null;
  }
}

export const REASON_MAX = 1000;

const REFUSALS = {
  reason_required: 'Write a reason first. It is kept with the pause.',
  already_paused: 'They are already paused. Refresh to see since when.',
  ended: 'They have left the network, so there is nothing to pause.',
  not_paused: 'They are not paused. Refresh to see their stage.',
  not_an_advisor: 'Only an advisor with an advisor profile is listed in the advisor directory.',
  already_hidden: 'They are already hidden from the advisor directory.',
  not_hidden: 'They are not hidden from the advisor directory.',
};
/** A refused write in words. */
export function refusalWord(e) {
  const code = e?.code || e?.data?.error;
  return REFUSALS[code] || e?.message || 'It could not be saved. Try again.';
}

/** What a pause did, from the write's `effects`. */
const EFFECT_WORDS = {
  advisor_bookings_stop: 'new bookings stop',
  advisor_directory_hidden: 'they are hidden from the advisor directory',
  lab_office_hours_hidden: 'they are hidden from Spin-Out Lab office hours',
};
export function effectsLine(effects) {
  const list = (Array.isArray(effects) ? effects : []).map((e) => EFFECT_WORDS[e] || words(e));
  return list.length ? `Paused: ${list.join(', ')}.` : 'Paused. Nothing else changes for this account.';
}
