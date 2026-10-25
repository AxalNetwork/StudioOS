import { parseStamp } from '../../../ui/parseStamp.js';
import { NOT_RECORDED } from '../../../lib/absence.js';

/**
 * D989 (#2380), D994 (#2805) — Partner profiles at /admin/partner-profiles,
 * as pure functions: the address and tabs, the moved notice, and the blocks
 * built from the reads. No React here, so `node --test` loads it alone.
 *
 * The reads (D990, `lib/api/partnerProfiles.js`; each answers alone):
 *   - `counts`  GET /api/admin/partner-profiles/counts — the Waiting tile and
 *               its bands, the Drafts it leaves out, and twelve weeks of
 *               captured profiles, and the envelopes out for signature (D993).
 *               "Verified in 30 days" and each week's verified and rejected
 *               say why they are not recorded (part 2).
 *   - `list`    GET /api/admin/partner-profiles — one page of profiles, with
 *               search, filters and a sort, and `totals` over the filtered
 *               set. Each row carries its reference, `created_at`, `status`
 *               (Draft apart from Waiting), `sources`, `account`,
 *               `identity_check` and its first agreement's `envelope` (D993).
 *               Each read is logged (D625).
 *
 * A Draft is a profile with nothing to review yet: it is not in the queue,
 * nor in the Waiting tile, nor in Approvals lane 7 (D990 §2).
 */

export const PP_PATH = '/admin/partner-profiles';
export const PP_ALL_PATH = '/admin/partner-profiles/all';
export const APPROVALS_PATH = '/admin/held/approvals';
export const PP_TITLE = 'Partner profiles';
export const PAGE_LINE = 'Check who each new member and partner says they are, then verify or reject, and send their first agreement.';
export const RAIL_NOTE = 'Eadwyn reads the profiles on this page. Nothing changes until you act.';
export const NOT_GIVEN = 'Not given';
export { NOT_RECORDED };
export const LIST_FAILED = 'We could not load partner profiles.';
export const LIST_FAILED_SUB = 'This is not a sign that there are none.';
export const COUNTS_FAILED = 'Could not be read';
export const PAGE_SIZE = 25;
/** Amber from 72 hours (#2805; D953's shared age bands). */
export const OVERDUE_HOURS = 72;
/** Part 2 records who reviewed a profile and when (D990 §3 refuses the filter and sort until then). */
export const REVIEWED_WAITS = 'Who reviewed a profile, and when, is recorded from Partner profiles part 2.';
export const CHANGED_WAITS = 'A profile changed after it was verified is flagged from Partner profiles part 2.';
/** The summary read pages through the whole list for the categories chart, up to this many rows. */
export const SUMMARY_CAP = 1000;

/** The old address's sentence (#2375's "moved" form). */
export const MOVED_NOTICES = {
  profiles: 'The Admin Console has moved: Partner profiles now lives under Approvals.',
};

/** The tabs (D989 §1). One profile's own address comes with part 6. */
export const TABS = [
  { key: 'review', label: 'To review', path: '' },
  { key: 'all', label: 'All profiles', path: '/all' },
];

export function tabOf(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  if (p === PP_PATH) return 'review';
  if (p === PP_ALL_PATH) return 'all';
  return null;
}

/** The canvas's status words. A status the Worker should never store is not drawn as one of them. */
const STATUS_WORD = { draft: 'Draft', pending: 'Waiting', verified: 'Verified', rejected: 'Rejected' };
export const statusWord = (s) => STATUS_WORD[s] || NOT_RECORDED;
/** The status chips on All profiles, in the canvas's order, and the list filter each sets. */
export const STATUS_CHIPS = [
  { key: 'all', label: 'All', total: 'total' },
  { key: 'pending', label: 'Waiting', total: 'pending' },
  { key: 'verified', label: 'Verified', total: 'verified' },
  { key: 'rejected', label: 'Rejected', total: 'rejected' },
  { key: 'draft', label: 'Drafts', total: 'draft' },
];

/** Where a profile came from (D990 §2), in the canvas's words. */
const SOURCE_WORD = { chat: 'Onboarding chat', invitation: 'Partner invitation', eadwyn: 'Eadwyn questions' };
export const SOURCES = [
  { key: 'chat', label: SOURCE_WORD.chat },
  { key: 'invitation', label: SOURCE_WORD.invitation },
  { key: 'eadwyn', label: SOURCE_WORD.eadwyn },
  { key: 'none', label: 'None recorded' },
];
export function sourceWords(sources) {
  const words = (sources || []).map((s) => SOURCE_WORD[s]).filter(Boolean);
  return words.length ? words : ['None recorded'];
}

/** Founder track, in the canvas's words. */
export function trackWord(t) {
  if (t === 'Spin-Out (New)') return 'Spin-Out';
  if (t === 'Strategic Scale (Existing)') return 'Strategic Scale';
  return null;
}

/** Whether a founder's company exists yet: 1, 0, or not answered. */
export function incorporatedWord(v) {
  if (v === 1 || v === true) return 'Incorporated';
  if (v === 0 || v === false) return 'Not incorporated';
  return 'Not answered';
}

/** A role, as the Account column and the canvas's profile pills name it. */
const ROLE_WORD = { founder: 'Founder', investor: 'Investor', advisor: 'Advisor', partner: 'Operating Partner', exploring: 'Explorer', admin: 'Admin' };
export const roleWord = (r) => ROLE_WORD[r] || (r ? String(r) : null);

/** The account a profile belongs to: none yet, or its role, and an Explorer's suggested role. */
export function accountView(account) {
  if (!account) return { has: false, text: 'No account yet', sub: null };
  const sub = account.exploring && account.suggested_role ? `Suggested: ${roleWord(account.suggested_role)}` : null;
  return { has: true, text: roleWord(account.role) || NOT_RECORDED, sub };
}

/** The identity check in KYC & KYB's words; no account means no check to show. */
const ID_TONE = { not_started: 'quiet', pending: 'amber', approved: 'green', rejected: 'red' };
export function identityView(check) {
  if (!check) return { has: false, text: '—', tip: 'No account yet', tone: 'quiet' };
  return { has: true, text: check.label || NOT_RECORDED, tip: 'Opens this person’s case in KYC & KYB', tone: ID_TONE[check.state] || 'quiet' };
}

/**
 * How long a profile has waited, from `created_at` (UTC, `parseStamp`):
 * "45m", "20h", "4d". Amber from 72 hours. No stamp is "—", never "0h".
 */
export function ageOf(createdAt, now = Date.now()) {
  const at = parseStamp(createdAt);
  if (at == null) return { text: '—', tip: 'When it arrived is not recorded.', over: false, hours: null };
  const mins = Math.max(0, Math.floor((now - at) / 60000));
  const hours = mins / 60;
  const text = mins < 60 ? `${mins}m` : hours < 48 ? `${Math.floor(hours)}h` : `${Math.floor(hours / 24)}d`;
  const long = mins < 60 ? `${mins} minute${mins === 1 ? '' : 's'}` : hours < 48 ? `${Math.floor(hours)} hour${Math.floor(hours) === 1 ? '' : 's'}` : `${Math.floor(hours / 24)} days`;
  return { text, tip: `Waiting ${long}`, over: hours >= OVERDUE_HOURS, hours };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A captured date, "20 Oct 2026", in UTC as D1 stores it; "—" when absent. */
export function dayOf(stamp) {
  const at = parseStamp(stamp);
  if (at == null) return '—';
  const d = new Date(at);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "3 Oct", a short UTC day for an envelope's line. */
function shortDay(stamp) {
  const at = parseStamp(stamp);
  if (at == null) return null;
  const d = new Date(at);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * The envelope a profile's first agreement went out in (D993), in PRF2's
 * words: "Out for signature since 3 Oct", "Signed 5 Oct", "Not delivered",
 * "Declined", "Voided". No agreement, or no envelope, is null.
 */
export function envelopeLine(env) {
  if (!env || !env.state) return null;
  if (env.state === 'out') return `${env.label || 'Out for signature'}${shortDay(env.sent_at) ? ` since ${shortDay(env.sent_at)}` : ''}`;
  if (env.state === 'signed') return `${env.label || 'Signed'}${shortDay(env.signed_at) ? ` ${shortDay(env.signed_at)}` : ''}`;
  return env.label || NOT_RECORDED;
}

/** One row of either table, ready to draw. */
export function rowView(r, now = Date.now()) {
  const founder = r.persona === 'Founder';
  const status = r.status || null;
  return {
    ref: r.ref || null,
    email: r.email,
    name: r.user_name || r.full_name || null,
    category: r.persona || null,
    track: founder ? trackWord(r.founder_track) || 'Track not given' : null,
    incorporated: founder ? incorporatedWord(r.company_established) : null,
    entity: r.legal_entity_name || null,
    entityType: r.legal_entity_name ? (r.entity_type || null) : null,
    agreement: r.agreement_type || 'Not sent',
    envelope: r.agreement_type ? envelopeLine(r.envelope) : null,
    envelopeAmber: r.envelope?.state === 'not_delivered',
    sources: sourceWords(r.sources),
    account: accountView(r.account),
    identity: identityView(r.identity_check),
    age: ageOf(r.created_at, now),
    captured: dayOf(r.created_at),
    status: statusWord(status),
    statusKey: STATUS_WORD[status] ? status : 'other',
  };
}

/** "1–25 of 64", from the list's own page and totals. */
export function pageLabel(page, pageSize, total) {
  const n = Number(total) || 0;
  if (!n) return '0 of 0';
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(n, page * pageSize);
  return `${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} of ${n.toLocaleString('en-US')}`;
}
export const pagesOf = (pageSize, total) => Math.max(1, Math.ceil((Number(total) || 0) / pageSize));

/**
 * The four tiles (PRF1) from the counts read. Each says one of: its figure (a
 * measured 0 shows as 0), "Could not be read" when the read or its block
 * failed, or "Not recorded" with the reason the Worker gave.
 */
export function tilesOf(counts) {
  if (counts.status === 'loading') return null;
  const data = counts.status === 'ready' ? counts.data : null;
  const block = (b) => (!data ? { kind: 'failed' } : !b || !b.available ? { kind: 'not_recorded', reason: b?.reason || null } : null);
  const w = data?.waiting;
  const waitingBad = !data ? { kind: 'failed' } : !w || !w.available ? { kind: 'failed', reason: w?.reason || null } : null;
  const now = data?.as_of ? Date.parse(data.as_of) : Date.now();
  return {
    waiting: waitingBad || {
      kind: 'num', value: w.count,
      sub: w.count ? `oldest ${ageOf(w.oldest_at, now).tip.replace('Waiting ', '')}` : 'nothing waiting',
    },
    past72: waitingBad || {
      kind: 'num', value: w.over_72h, amber: w.over_72h > 0,
      sub: `${(w.count - w.over_24h).toLocaleString('en-US')} under 24h · ${(w.over_24h - w.over_72h).toLocaleString('en-US')} under 72h`,
    },
    verified30: block(data?.verified_30d) || { kind: 'num', value: data.verified_30d.count },
    out: block(data?.envelopes_out) || {
      kind: 'num', value: data.envelopes_out.count,
      sub: data.envelopes_out.not_delivered > 0 ? `${data.envelopes_out.not_delivered.toLocaleString('en-US')} not delivered` : 'sent from this page',
    },
    drafts: waitingBad ? null : w.drafts,
  };
}

/** "3 Aug", a week's Monday, for the chart's axis. */
function weekLabel(iso) {
  const [, m, d] = String(iso).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/**
 * "Profiles captured and decided, per week" (PRF2) as a grouped-columns spec:
 * captured each week, and verified and rejected as null (drawn dashed, "not
 * recorded") until part 2 records decision dates. The last week is this one,
 * to date.
 */
export function weeklyChart(weekly) {
  if (!weekly || !weekly.available || !Array.isArray(weekly.weeks) || !weekly.weeks.length) return null;
  const decided = weekly.verified_available === true;
  return {
    type: 'grouped',
    series: [{ label: 'Captured', tone: 'violet' }, { label: 'Verified', tone: 'sky' }, { label: 'Rejected', tone: 'amber' }],
    rows: weekly.weeks.map((w, i) => ({
      label: weekLabel(w.week_start),
      values: [w.captured ?? null, decided ? (w.verified ?? null) : null, decided ? (w.rejected ?? null) : null],
      toDate: i === weekly.weeks.length - 1,
    })),
    decided,
    reason: decided ? null : weekly.verified_reason || null,
    thisWeek: weekly.weeks[weekly.weeks.length - 1].captured,
  };
}

/** The weekly chart's alt sentence. */
export function weeklyAlt(chart) {
  const caps = chart.rows.map((r) => r.values[0]).filter((v) => v != null);
  const lo = caps.length ? Math.min(...caps) : 0;
  const hi = caps.length ? Math.max(...caps) : 0;
  return `Profiles per week for ${chart.rows.length} weeks. Captured runs from ${lo} to ${hi} a week; ${chart.decided ? 'verified and rejected are drawn beside it' : 'verified and rejected are not recorded yet'}. This week ${chart.thisWeek} so far.`;
}

/**
 * "Onboarding categories" (PRF2): one bar per category, by count, Founder
 * split into its two tracks. Rows with no category are a separate line, never
 * a bar.
 */
export function categoryBars(rows) {
  const by = new Map();
  let none = 0;
  for (const r of rows || []) {
    if (!r.persona) { none += 1; continue; }
    const b = by.get(r.persona) || { category: r.persona, count: 0, spinout: 0, scale: 0, untracked: 0 };
    b.count += 1;
    if (r.persona === 'Founder') {
      const t = trackWord(r.founder_track);
      if (t === 'Spin-Out') b.spinout += 1;
      else if (t === 'Strategic Scale') b.scale += 1;
      else b.untracked += 1;
    }
    by.set(r.persona, b);
  }
  const bars = [...by.values()].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  return { bars, none, max: bars.reduce((m, b) => Math.max(m, b.count), 0) };
}

/** The categories as a stacked-bars spec (`ui/Charts.jsx`); a bar opens the list filtered to it. */
export function categoryChart(rows) {
  const { bars, none } = categoryBars(rows);
  return {
    type: 'stackbars',
    head: 'Onboarding category',
    clickable: true,
    testIdPrefix: 'pp-cat',
    parts: [{ key: 'spinout', label: 'Spin-Out' }, { key: 'scale', label: 'Strategic Scale' }, { key: 'untracked', label: 'Track not given' }, { key: 'profiles', label: 'Profiles' }],
    rows: bars.map((b) => ({
      key: b.category.replace(/[^\w]+/g, '-').toLowerCase(),
      category: b.category,
      label: b.category,
      total: b.category === 'Founder' && (b.spinout || b.scale) ? `${b.count} · ${b.spinout} + ${b.scale}` : String(b.count),
      parts: b.category === 'Founder'
        ? [
          { key: 'spinout', label: 'Spin-Out', value: b.spinout, tone: 'violet', aria: `Show founders on Spin-Out: ${b.spinout}` },
          { key: 'scale', label: 'Strategic Scale', value: b.scale, tone: 'sky', aria: `Show founders on Strategic Scale: ${b.scale}` },
          { key: 'untracked', label: 'Track not given', value: b.untracked, tone: 'muted', aria: `Show founders with no track: ${b.untracked}` },
        ]
        : [{ key: 'profiles', label: 'Profiles', value: b.count, tone: 'violet', aria: `Show ${b.category} profiles: ${b.count}` }],
    })),
    none,
    alt: `Profiles by onboarding category: ${bars.map((b) => `${b.category} ${b.count}`).join(', ')}${none ? `, no category captured ${none}` : ''}.`,
  };
}

/** The filters All profiles draws, in the canvas's order. Reviewed by waits for part 2. */
export const FILTERS = ['source', 'category', 'founder_track', 'entity_type', 'agreement', 'has_account', 'identity', 'captured'];
export const IDENTITY_STATES = [
  { key: 'not_started', label: 'Not started' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'no_account', label: 'No account yet' },
];
export const SORTS = {
  review: [{ key: 'waiting', label: 'Waiting longest' }, { key: 'newest', label: 'Newest' }, { key: 'name', label: 'Name' }],
  all: [{ key: 'newest', label: 'Newest' }, { key: 'waiting', label: 'Waiting longest' }, { key: 'name', label: 'Name' }],
};

/**
 * The list read's parameters for a tab and its choices. To review is the
 * waiting profiles only (Drafts are their own status); All profiles takes the
 * status chip. An empty choice is left out.
 */
export function listParams(tab, f) {
  const p = {
    q: String(f.q || '').trim().length >= 2 ? String(f.q).trim() : null,
    sort: f.sort || (tab === 'review' ? 'waiting' : 'newest'),
    page: f.page > 1 ? f.page : null,
    page_size: PAGE_SIZE,
    source: f.source || null,
    category: f.category || null,
    founder_track: f.founder_track || null,
  };
  if (tab === 'review') return { ...p, status: 'pending' };
  return {
    ...p,
    status: f.status && f.status !== 'all' ? f.status : null,
    entity_type: f.entity_type || null,
    agreement: f.agreement || null,
    has_account: f.has_account || null,
    identity: f.identity || null,
    captured_from: f.captured_from || null,
    captured_to: f.captured_to || null,
  };
}

/** How many filters are set, for "Clear filters". */
export function filtersSet(tab, f) {
  const keys = tab === 'review' ? ['source', 'category', 'founder_track'] : [...FILTERS.filter((k) => k !== 'captured'), 'captured_from', 'captured_to'];
  return keys.filter((k) => f[k]).length;
}

/** A failed read's Details line: the status and the Worker's code, never the stack. */
export function failureRef(err) {
  if (!err) return null;
  const parts = [err.status ? `HTTP ${err.status}` : null, err.code || null].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'The request did not reach the server.';
}
