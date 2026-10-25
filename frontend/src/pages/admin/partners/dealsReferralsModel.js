/**
 * D951 (#2727) — Partner invitations part 8: Deals, one deal and Referrals on
 * the server reads. Pure, like `partnersDeskModel.js`, whose words it reuses.
 *
 *   · Deals: D926's list (`GET /api/admin/partners/deals`) with its filters,
 *     sort, pages and exact `total`, replacing Guard L's six capped lists;
 *     C5 "Terms ending" from the active deals, soonest end first.
 *   · One deal: D928's read (`GET …/deals/:id`): due diligence and its KYB
 *     section, each obligation's own state, the history with who terminated,
 *     and "Signed, deal not activated" with D925's Re-run activation.
 *   · Terminate (PI8c): D928's preview, "[n] members lose the grant this deal
 *     gave them."
 *   · Referrals: D928's cross-deal read (`GET …/redemptions`), replacing
 *     Guard F's fan-out: the four tiles, C6 and every redemption with the
 *     member's role; C4 is the Overview's own, from part 4's overview read. A rev-share window counts only while its deal is active,
 *     as D923 said, until the owner answers O-WIN.
 *   · PI11d on a phone: four state groups, "Ended" being term over,
 *     terminated and voided.
 *
 * "Founder Pro" is never drawn as a plan (O-TIER): tiers go through
 * `tiersText`, as everywhere on the desk.
 */
import {
  COUNT_CLAIM, DAY_MS, ENDING_SOON_DAYS, NOT_RECORDED, READING, ROWS_PER_PAGE, attributionWord, dataOf, day, dayOr,
  dealPartner, dealRow, isCoolOff, parseStamp, pausedLine, plural, tiersText,
} from './partnersDeskModel';

const nf = (n) => Number(n).toLocaleString('en-US');
const words = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** A read's failure in one sentence, a cool-off as paused (D923 §2). */
export function failedLine(read, what) {
  if (isCoolOff(read?.error)) return pausedLine(what);
  return `${what} could not be read.`;
}

/* ------------------------------------------------------------------ *
 * Deals (PI5) on D926's list
 * ------------------------------------------------------------------ */

/** The desk's sort keys, as D926 names them. */
export const DEAL_SORT_TO_SERVER = Object.freeze({ ends: 'ends_soonest', newest: 'newest', redemptions: 'most_redemptions', partner: 'partner' });

/**
 * D926's parameters for one page. No state chip means every state, which the
 * Worker reads as `all` (with no `status` it would read Active only).
 */
export function dealListParams({ q = '', states = [], type = '', endsWithin = '', hasRedemptions = false, sort = 'ends', page = 1, size = ROWS_PER_PAGE } = {}) {
  return {
    status: states.length ? [...states] : 'all',
    q: String(q || '').trim() || undefined,
    dealType: type || undefined,
    endsWithin: Number(endsWithin) > 0 ? Number(endsWithin) : undefined,
    hasRedemptions: Boolean(hasRedemptions) || undefined,
    sort: DEAL_SORT_TO_SERVER[sort] || DEAL_SORT_TO_SERVER.ends,
    limit: size,
    offset: Math.max(0, (Math.max(1, Number(page) || 1) - 1) * size),
  };
}

/** A paged reply, checked: rows and an exact total, or it is a failed read. */
export function pagedReply(reply, what) {
  const items = reply?.items;
  const total = Number(reply?.total);
  if (!Array.isArray(items) || !Number.isFinite(total)) throw new Error(`${what} did not come back as a page.`);
  return { items, total };
}

/** The pager's shape from one server page: `{ rows, page, pages, from, to, total }`. */
export function serverPage(data, page, size = ROWS_PER_PAGE) {
  const total = Number(data?.total) || 0;
  const rows = Array.isArray(data?.items) ? data.items : [];
  const pages = Math.max(1, Math.ceil(total / size));
  const at = Math.min(Math.max(1, Number(page) || 1), pages);
  const from = rows.length ? (at - 1) * size + 1 : 0;
  return { rows, page: at, pages, from, to: rows.length ? from + rows.length - 1 : 0, total };
}

/**
 * One Deals row from D926's list. Before signing, the Worker already gives
 * the partner the invitation's name and address (D926 §3), so those are used
 * whenever it sent them; otherwise the row falls back to the invitations read.
 */
export function serverDealRow(deal, opts = {}) {
  const row = dealRow(deal, opts);
  const name = String(deal?.partner_name || '').trim();
  const email = String(deal?.partner_email || '').trim();
  return name || email ? { ...row, partner: { name: name || email, email: email || NOT_RECORDED } } : { ...row, partner: dealPartner(deal, opts.invitations) };
}

/** PI11d's four state groups; "Ended" is term over, terminated and voided. */
export const PHONE_STATE_GROUPS = Object.freeze([
  { key: 'active', word: 'Active', states: ['active'] },
  { key: 'awaiting', word: 'Awaiting', states: ['awaiting_signature'] },
  { key: 'chosen', word: 'Offer chosen', states: ['proposed'] },
  { key: 'ended', word: 'Ended', states: ['expired', 'terminated', 'voided'] },
]);

/** The states a set of phone groups stands for. */
export const statesOfGroups = (groups) => PHONE_STATE_GROUPS.filter((g) => groups.includes(g.key)).flatMap((g) => g.states);

/** The phone groups a set of states lights: a group is on when every state in it is. */
export const groupsOfStates = (states) => PHONE_STATE_GROUPS.filter((g) => g.states.every((s) => states.includes(s))).map((g) => g.key);

/** How many filters the phone's "Filters · [n]" counts: a state set other than Active alone, a type, an end window. */
export function phoneFilterCount({ states = [], type = '', endsWithin = '' } = {}) {
  const defaultStates = states.length === 1 && states[0] === 'active';
  return (defaultStates ? 0 : 1) + (type ? 1 : 0) + (Number(endsWithin) > 0 ? 1 : 0);
}

/** The sheet's button: "Show [n] deals", from the Worker's exact count for what the sheet holds. */
export function showDealsLabel(read) {
  if (!read || read.status === 'loading') return 'Show deals';
  if (read.status === 'error') return 'Show deals';
  const n = Number(dataOf(read)?.total);
  return Number.isFinite(n) ? `Show ${plural(n, 'deal', 'deals')}` : 'Show deals';
}

/* ------------------------------------------------------------------ *
 * C5 "Terms ending"
 * ------------------------------------------------------------------ */

export const C5_FROM_DAYS = -20;
export const C5_TO_DAYS = 120;
export const C5_SHOWN = 12;
/** The active deals C5 reads: one page, soonest end first (D926's `ends_soonest`). */
export const C5_PARAMS = Object.freeze({ status: 'active', sort: 'ends_soonest', limit: 100 });

/**
 * C5: one bar per active deal from its start to its end, over −20…+120 days
 * from today, with a Today line; amber at 30 days or less. A deal is drawn
 * when its end falls inside the window. The stored dates are drawn, parsed as
 * UTC. An active deal past its end reads "Term ended, not yet closed".
 * "Showing [n] of [m]": n drawn, m the Worker's exact count of active deals.
 */
export function termsEnding(read, { now = Date.now() } = {}) {
  const base = { key: 'c5', title: 'Terms ending' };
  if (!read || (read.status === 'loading' && !dataOf(read))) return { ...base, state: 'loading' };
  if (read.status === 'error' && !dataOf(read)) return { ...base, state: 'unreadable', reason: `${failedLine(read, 'The active deals')} That is not a claim that no term is ending.` };
  const { items = [], total = 0 } = dataOf(read) || {};
  const undated = [];
  const inWindow = [];
  for (const d of items) {
    if (d?.status !== 'active') continue;
    const start = parseStamp(d.activated_at);
    const end = parseStamp(d.expires_at);
    if (end === null) { undated.push(d); continue; }
    const endDay = (end - now) / DAY_MS;
    if (endDay < C5_FROM_DAYS || endDay > C5_TO_DAYS) continue;
    const startDay = start === null ? null : (start - now) / DAY_MS;
    const past = end <= now;
    const left = past ? 0 : Math.ceil(endDay);
    const name = String(d.partner_name || '').trim() || String(d.partner_email || '').trim() || `Deal #${d.id}`;
    inWindow.push({
      key: String(d.id),
      dealId: d.id,
      label: name,
      start: startDay === null ? C5_FROM_DAYS : Math.max(C5_FROM_DAYS, startDay),
      startClipped: startDay === null || startDay < C5_FROM_DAYS,
      end: endDay,
      tone: left <= ENDING_SOON_DAYS ? 'amber' : 'violet',
      text: past ? 'Term ended, not yet closed' : plural(left, 'day', 'days'),
      endsOn: day(end),
      past,
    });
  }
  inWindow.sort((a, b) => a.end - b.end || Number(a.dealId) - Number(b.dealId));
  const rows = inWindow.slice(0, C5_SHOWN);
  const lines = [];
  if (undated.length) lines.push(`${plural(undated.length, 'active deal has', 'active deals have')} no end date recorded and ${undated.length === 1 ? 'is' : 'are'} not drawn.`);
  // The page is read soonest end first, so a full page whose last deal still ends inside the window may stop short of it.
  const last = items[items.length - 1];
  const lastEnd = parseStamp(last?.expires_at);
  if (items.length < total && lastEnd !== null && (lastEnd - now) / DAY_MS <= C5_TO_DAYS) lines.push(`Drawn from the first ${nf(items.length)} active deals by end date.`);
  if (read.status === 'error') lines.push('Could not refresh the active deals. This chart is from the last read.');
  const amber = inWindow.filter((r) => r.tone === 'amber').length;
  return {
    ...base,
    state: 'ready',
    showing: `Showing ${nf(rows.length)} of ${plural(Number(total) || 0, 'active deal', 'active deals')}`,
    chart: { type: 'terms', rows, from: C5_FROM_DAYS, to: C5_TO_DAYS },
    alt: rows.length
      ? `${plural(inWindow.length, 'active deal ends', 'active deals end')} between 20 days ago and 120 days from today; ${nf(amber)} within 30 days or past their end.`
      : 'No active deal ends between 20 days ago and 120 days from today.',
    legend: [{ label: 'Term', tone: 'violet' }, { label: '30 days or less', tone: 'amber' }],
    lines,
    foot: 'Each bar runs from the deal’s start to its stored end. The line is today.',
  };
}

/* ------------------------------------------------------------------ *
 * One deal (PI6) on D928's read
 * ------------------------------------------------------------------ */

/** The read's state: loading, a deal with no such id (404), could not be read, or ready. */
export function dealReadState(read) {
  if (!read || (read.status === 'loading' && !dataOf(read))) return { state: 'loading' };
  if (read.status === 'error' && !dataOf(read)) {
    return Number(read.error?.status) === 404 ? { state: 'none' } : { state: 'unreadable' };
  }
  const data = dataOf(read);
  if (!data?.deal) return { state: 'unreadable' };
  return { state: 'ready', data, stale: read.status === 'error' };
}

export const NO_SUCH_DEAL = 'There is no deal with this address.';

/** The KYB section's stored status, in words. "Cleared" waits for #2385's rule, so a completed section reads "Completed". */
const KYB_WORD = { pending: 'Waiting', assigned: 'Assigned', in_review: 'In review', completed: 'Completed', blocked: 'Blocked' };
const CASE_WORD = { open: 'Open', in_review: 'In review', completed: 'Completed', archived: 'Archived' };
export const kybWord = (s) => KYB_WORD[s] || (s ? words(s) : NOT_RECORDED);
export const caseWord = (s) => CASE_WORD[s] || (s ? words(s) : NOT_RECORDED);

/**
 * Due diligence: the case D928 matched to this deal and its KYB section. Two
 * cases that could be this deal's are both named, neither picked.
 */
export function dueDiligence(dd) {
  const one = (c) => ({ uid: c?.uid || null, text: caseWord(c?.status), opened: dayOr(c?.opened_at), kyb: c?.kyb ? kybWord(c.kyb.status) : 'No KYB section on this case' });
  switch (dd?.match) {
    case 'one': return { state: 'one', case: one(dd.case) };
    case 'none': return { state: 'none', text: 'No case on record since the deal was activated' };
    case 'ambiguous': return { state: 'ambiguous', text: 'More than one case could be this deal’s, so none is picked', cases: (dd.candidates || []).map(one) };
    case 'not_activated': return { state: 'not_activated', text: 'Opened when the deal is activated' };
    default: return { state: 'unknown', text: NOT_RECORDED };
  }
}

const OBLIGATION_WORD = {
  partner_msa_v1: 'Partner agreement', kyb_v1: 'KYB', kyc_v1: 'KYC', accreditation_v1: 'Accreditation', tos_v1: 'Terms of service', privacy_v1: 'Privacy',
};
const OBLIGATION_STATE = { pending: 'Outstanding', satisfied: 'Satisfied', waived: 'Waived', expired: 'Expired' };

/**
 * Each obligation's own state. A key never seeded reads "Not recorded", never
 * "Satisfied"; a waived one is listed; one not required says so.
 */
export function obligationRows(obligations) {
  if (obligations === null || obligations === undefined) return { state: 'none', text: 'None before signing: obligations are opened when the deal is signed' };
  if (!Array.isArray(obligations)) return { state: 'unreadable' };
  return {
    state: 'ready',
    rows: obligations.map((o) => ({
      key: String(o?.key),
      label: OBLIGATION_WORD[o?.key] || words(String(o?.key || '').replace(/_v\d+$/, '')),
      state: o?.recorded ? (OBLIGATION_STATE[o.status] || words(o.status) || NOT_RECORDED) : NOT_RECORDED,
      tone: o?.recorded && o.status === 'pending' && o.required !== false ? 'amber' : null,
      note: o?.recorded ? [o.required === false ? 'Not required' : null, day(o.expires_at) ? `Expires ${day(o.expires_at)}` : null].filter(Boolean).join(' · ') : 'Never opened for this member',
    })),
  };
}

const HISTORY_WORD = {
  created: 'Offer chosen', activation_failed: 'Activation failed', activated: 'Activated on signing', activation_retried: 'Activation re-run', terminated: 'Terminated',
};
const RETRY_OUTCOME = { activated: 'it activated the deal', failed: 'it failed', not_activated: 'it did not activate the deal' };

/** The history: each event, its day, and who did it where D928 records an actor. */
export function historyRows(history) {
  if (!Array.isArray(history)) return [];
  return history.map((h, i) => {
    const by = String(h?.by_name || '').trim() || (h?.by_user_id ? 'an admin whose name is not recorded' : null);
    const parts = [HISTORY_WORD[h?.kind] || words(h?.kind), dayOr(h?.at)];
    if (h?.kind === 'activation_retried' && RETRY_OUTCOME[h.outcome]) parts.push(RETRY_OUTCOME[h.outcome]);
    if ((h?.kind === 'terminated' || h?.kind === 'activation_retried')) parts.push(by ? `by ${by}` : 'by someone not recorded');
    if (h?.kind === 'terminated' && String(h.reason || '').trim()) parts.push(String(h.reason).trim());
    return { key: `${h?.kind}-${i}`, text: parts.join(' · '), tone: h?.kind === 'activation_failed' ? 'amber' : null };
  });
}

/** The agreement from D928's envelope block: signed, out since, voided, or not sent. */
export function agreementFromRead(data) {
  const deal = data?.deal || {};
  const env = data?.envelope || null;
  if (activationPending(data)) return { text: 'Signed, deal not activated', tone: 'amber' };
  if (deal.activated_at && ['active', 'terminated', 'expired'].includes(deal.status)) return { text: `Signed ${dayOr(deal.activated_at)}` };
  if (!env) return { text: deal.status === 'voided' ? 'Voided' : 'Not sent' };
  if (['voided', 'void', 'declined', 'rejected'].includes(env.status) || deal.status === 'voided') return { text: 'Voided' };
  if (env.status === 'completed') return { text: `Signed ${dayOr(env.completed_at)}` };
  if (['sent', 'partially_signed', 'delivered'].includes(env.status)) {
    const link = parseStamp(env.signing_link_expires_at);
    return { text: `Out for signature since ${dayOr(env.sent_at)}`, sub: link !== null ? `Signing link valid until ${day(link)}` : null };
  }
  return { text: 'Another state' };
}

/** "Signed, deal not activated": the agreement is complete, or activation failed, and the deal still awaits activation (D925). */
export function activationPending(data) {
  const deal = data?.deal;
  if (deal?.status !== 'awaiting_signature') return false;
  return data?.envelope?.status === 'completed' || Boolean(deal.activation_failed_at);
}

/** Re-run activation (D925's `POST …/activate`), saying what it does before the write. */
export const RERUN_TITLE = 'Re-run activation?';
export const RERUN_LINES = Object.freeze([
  'The partner signed, but the deal was not activated. This runs the activation again.',
  'It makes the deal active from today, grants the tiers the deal names and issues the referral code. A plan the partner pays for is kept.',
  'If it fails again, nothing changes and the failure stays on the deal.',
]);
export const RERUN_DONE = 'Activated. The deal is active.';

/** The re-run's refusals in one sentence each (D925: 409 when the deal is not waiting, 503 when it fails again). */
export function rerunRefusal(err) {
  const status = Number(err?.status);
  if (status === 409) return 'This deal is not waiting for activation of its signed agreement, so nothing was run.';
  if (status === 503) return 'Activation failed again. Nothing changed, and the failure is kept on the deal.';
  if (status === 423) return 'Changes are refused while this studio is paused. Reading still works.';
  return 'That did not go through. Try again.';
}

/* ------------------------------------------------------------------ *
 * Terminate (PI8c) on D928's preview
 * ------------------------------------------------------------------ */

/** The preview's lines, before the write: the partner's own grant, then who loses theirs. */
export function terminatePreviewLines(deal, read) {
  const who = String(deal?.partner_name || '').trim() || String(deal?.partner_email || '').trim() || `deal #${deal?.id}`;
  if (!read || (read.status === 'loading' && !dataOf(read))) return { state: 'loading', lines: [READING] };
  if (read.status === 'error' && !dataOf(read)) {
    return { state: 'unreadable', lines: [`${failedLine(read, 'Who would lose a grant')} That is not a claim that nobody would.`] };
  }
  const p = dataOf(read) || {};
  if (p.can_terminate === false) return { state: 'closed', lines: ['This deal is no longer active, so it cannot be terminated.'] };
  const lines = [];
  if (p.partner?.founder_still_granted || p.partner?.investor_still_granted) lines.push(`The tiers this deal granted ${who} end now.`);
  else if (p.partner) lines.push(`${who} no longer holds this deal’s grant, so their tiers do not change.`);
  const n = Number(p.members_losing);
  if (!Number.isFinite(n)) return { state: 'unreadable', lines: ['Who would lose a grant was not counted. That is not a claim that nobody would.'] };
  if (n === 0) lines.push('No member loses a grant this deal gave them.');
  else lines.push(`${plural(n, 'member loses', 'members lose')} the grant this deal gave them.`);
  const kept = Number(p.registered) - n;
  if (Number.isFinite(kept) && kept > 0) lines.push(`${plural(kept, 'other member', 'other members')} who registered with the code ${kept === 1 ? 'keeps their plan: they pay' : 'keep their plans: they pay'} for one, or no longer hold this deal’s grant.`);
  lines.push('This cannot be undone.');
  return { state: 'ready', lines, losing: n };
}

/* ------------------------------------------------------------------ *
 * Referrals (PI7) on D928's cross-deal read
 * ------------------------------------------------------------------ */

export const REDEMPTION_PAGE = 100;
/** The most pages one set is read through; past it the figures say what they cover. */
export const REDEMPTION_PAGES_MAX = 20;
export const REDEMPTION_CAP = REDEMPTION_PAGE * REDEMPTION_PAGES_MAX;
export const ATTRIBUTION_DAYS = 365;

/** `YYYY-MM-DD`, UTC, `days` before `now`. */
export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The sets Referrals reads, each with its own state: two counts, and every open window (the window tiles and C6). */
export function referralSets(now = Date.now()) {
  return {
    all: {},
    last90: { from: isoDay(now - 89 * DAY_MS) },
    windows: { window_within: ATTRIBUTION_DAYS, sort: 'window' },
  };
}

/** A count tile from one count read (its `total`). */
export function countTile(read, label) {
  if (!read || (read.status === 'loading' && !dataOf(read))) return { label, state: 'loading' };
  if (read.status === 'error' && !dataOf(read)) return { label, state: 'unreadable', reason: COUNT_CLAIM, figure: isCoolOff(read.error) ? 'Paused' : undefined };
  const n = Number(dataOf(read)?.total);
  if (!Number.isFinite(n)) return { label, state: 'unreadable', reason: COUNT_CLAIM };
  return { label, state: 'ready', n, value: nf(n) };
}

/**
 * The open rev-share windows on active deals, from the full window read. A
 * window on an ended deal is not counted (D923's rule until O-WIN).
 */
export function openWindows(read) {
  if (!read || (read.status === 'loading' && !dataOf(read))) return { state: 'loading' };
  if (read.status === 'error' && !dataOf(read)) return { state: 'unreadable', read };
  const { items = [], complete = true } = dataOf(read) || {};
  const open = items.filter((r) => r?.deal_status === 'active' && Number(r?.window_days_left) > 0);
  const ended = items.filter((r) => r?.deal_status !== 'active').length;
  return { state: 'ready', open, ended, complete };
}

/** The two window tiles: open, and closing within 30 days. */
export function windowTiles(read) {
  const w = openWindows(read);
  const open = { key: 'open', label: 'Rev-share windows open' };
  const closing = { key: 'closing', label: 'Closing within 30 days' };
  if (w.state === 'loading') return [{ ...open, state: 'loading' }, { ...closing, state: 'loading' }];
  if (w.state === 'unreadable') return [{ ...open, state: 'unreadable', reason: COUNT_CLAIM }, { ...closing, state: 'unreadable', reason: COUNT_CLAIM }];
  const soon = w.open.filter((r) => Number(r.window_days_left) <= ENDING_SOON_DAYS).length;
  const cover = w.complete ? null : `Counted over the first ${nf(REDEMPTION_CAP)} open windows.`;
  const figure = (n) => (w.complete ? nf(n) : `${nf(n)}+`);
  return [
    { ...open, state: 'ready', n: w.open.length, value: figure(w.open.length), sub: cover || 'On active deals only' },
    { ...closing, state: 'ready', n: soon, value: figure(soon), sub: cover },
  ];
}

/**
 * C6 "Rev-share windows closing": one bar per open window on an active deal,
 * days left of 365, amber at 30 or less, labelled "member · partner", soonest
 * first; "Showing [n] of [m]".
 */
export const C6_SHOWN = 12;
export function windowsClosing(read) {
  const base = { key: 'c6', title: 'Rev-share windows closing' };
  const w = openWindows(read);
  if (w.state === 'loading') return { ...base, state: 'loading' };
  if (w.state === 'unreadable') return { ...base, state: 'unreadable', reason: `${failedLine(w.read, 'The rev-share windows')} That is not a claim that none is open.` };
  const sorted = [...w.open].sort((a, b) => Number(a.window_days_left) - Number(b.window_days_left) || Number(a.id) - Number(b.id));
  const rows = sorted.slice(0, C6_SHOWN).map((r) => {
    const member = String(r.member_name || '').trim() || String(r.member_email || '').trim() || NOT_RECORDED;
    const partner = String(r.partner_name || '').trim() || String(r.partner_email || '').trim() || NOT_RECORDED;
    const left = Number(r.window_days_left);
    return { key: String(r.id), label: `${member} · ${partner}`, value: left, text: plural(left, 'day', 'days'), tone: left <= ENDING_SOON_DAYS ? 'amber' : 'violet' };
  });
  const lines = [];
  if (w.ended) lines.push(`${plural(w.ended, 'window on an ended deal is', 'windows on ended deals are')} not counted.`);
  if (!w.complete) lines.push(`Counted over the first ${nf(REDEMPTION_CAP)} open windows.`);
  const soon = w.open.filter((r) => Number(r.window_days_left) <= ENDING_SOON_DAYS).length;
  return {
    ...base,
    state: 'ready',
    showing: `Showing ${nf(rows.length)} of ${plural(w.open.length, 'open window', 'open windows')}`,
    chart: { type: 'hbar', rows, axis: `${ATTRIBUTION_DAYS} days`, max: ATTRIBUTION_DAYS, testIdPrefix: 'partners-c6' },
    alt: rows.length
      ? `${plural(w.open.length, 'rev-share window is', 'rev-share windows are')} open on active deals; ${nf(soon)} close within 30 days.`
      : 'No rev-share window is open on an active deal.',
    legend: [{ label: 'Days left of 365', tone: 'violet' }, { label: '30 days or less', tone: 'amber' }],
    lines,
    foot: 'A window is open for 365 days from the member’s registration, and only while its deal is active.',
  };
}

const ROLE_WORD = { founder: 'Founder', investor: 'Investor', partner: 'Partner', advisor: 'Advisor', exploring: 'Exploring', admin: 'Admin' };

/** A redemption's window from D928's `window_days_left`; an ended deal's is not counted (D923, until O-WIN). */
export function serverWindow(r) {
  if (r?.deal_type !== 'deal_sourcing_revshare') return { key: 'none', text: 'No window' };
  if (r?.deal_status !== 'active') return { key: 'ended', text: 'Deal ended' };
  const left = Number(r?.window_days_left);
  if (r?.window_days_left === null || r?.window_days_left === undefined || !Number.isFinite(left)) return { key: 'unknown', text: NOT_RECORDED };
  if (left <= 0) return { key: 'closed', text: 'Closed' };
  return { key: 'open', days: left, text: `${plural(left, 'day', 'days')} left` };
}

/** One row of Every redemption, from D928's cross-deal read, with the member's role. */
export function serverRedemptionRow(r) {
  return {
    key: String(r?.id),
    dealId: r?.deal_id,
    member: String(r?.member_name || '').trim() || String(r?.member_email || '').trim() || NOT_RECORDED,
    role: ROLE_WORD[r?.member_role] || (r?.member_role ? words(r.member_role) : NOT_RECORDED),
    partner: String(r?.partner_name || '').trim() || String(r?.partner_email || '').trim() || NOT_RECORDED,
    code: r?.referral_code || NOT_RECORDED,
    registered: dayOr(r?.redeemed_at),
    tiers: tiersText(r?.granted_tier_founder, r?.granted_tier_investor),
    grantedUntil: ['terminated', 'expired'].includes(r?.deal_status) ? 'Ended with the deal' : dayOr(r?.granted_until),
    attribution: attributionWord(r?.attribution_kind),
    window: serverWindow(r),
  };
}

/** The desk's Referrals sorts, as D928 names them; the ones it has no sort for are not offered. */
export const SERVER_REFERRAL_SORTS = Object.freeze([
  { key: 'newest', label: 'Newest registered' },
  { key: 'window', label: 'Window closing soonest' },
  { key: 'partner', label: 'Partner A–Z' },
]);

/** D928's parameters for one page of Every redemption. */
export function redemptionParams({ q = '', attribution = '', partner = '', closingWithin = '', from = '', to = '', deal = null, sort = 'newest', page = 1, size = ROWS_PER_PAGE } = {}) {
  return {
    q: String(q || '').trim() || undefined,
    attribution: attribution || undefined,
    partner: partner || undefined,
    deal: deal || undefined,
    window_within: Number(closingWithin) > 0 ? Number(closingWithin) : undefined,
    from: from || undefined,
    to: to || undefined,
    sort: SERVER_REFERRAL_SORTS.some((s) => s.key === sort) ? sort : 'newest',
    page: Math.max(1, Number(page) || 1),
    limit: size,
  };
}

/** The partner filter's options: each partner account that holds a deal, by name. */
export function partnerOptions(dealRows) {
  const seen = new Map();
  for (const d of dealRows || []) {
    if (d?.user_id === null || d?.user_id === undefined) continue;
    const name = String(d.partner_name || '').trim() || String(d.partner_email || '').trim();
    if (name && !seen.has(String(d.user_id))) seen.set(String(d.user_id), name);
  }
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}
