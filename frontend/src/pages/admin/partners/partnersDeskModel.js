/**
 * D923 (#2370) — Partner invitations: the desk's words and rules. Pure: no
 * React, no fetch, so the tests read them without a browser.
 *
 * The canvas is the owner's "Partner invitations" (PI1–PI12). The desk draws
 * only the blocks whose reads exist, each truthfully; the rest is D923 §6's
 * nine parts, and this file grows a rule when its read lands.
 *
 * WHAT IS READ (D923 §2; R-numbers are D923's):
 *   R1  `GET /api/admin/partners/invitations`, newest 200 by first send;
 *   R2  `GET /api/admin/partners/deals?status=`, once per state, 200 each;
 *   R3  `GET /api/admin/partners/deals/top?status=all&limit=5`;
 *   R4  `GET /api/admin/partners/deals/:id/redemptions`, at most 500;
 *   R5  `GET /api/admin/contracts/partner-deals`, every deal, no cap;
 *   R6  `GET /api/admin/partners/links`, 500 accounts;
 *   R7  `GET /api/legal/esign/:id`, one envelope;
 *   R8  `GET /api/legal/esign/templates/partner_services`;
 *   R9  `GET /api/dd/cases?subject_type=partner`, newest 200;
 *   R10 `trustScoreBatch([user_id])`;
 *   R11 `GET /api/admin/users?q=<email>`, 100 rows;
 *   R12 `GET /api/profiling/admin/:email`, only when the admin asks.
 *
 * THE WORDS FOR WHAT IS NOT KNOWN, kept apart (D923 §2):
 *   "Not recorded"       no store holds it;
 *   "Not read here yet"  it is stored, but no read returns it yet;
 *   "Not in this read"   the record is outside a list that stopped at its cap;
 *   "Could not be read"  the read failed;
 *   "Paused after a recent account recovery"  R5, R7, R8 or R9 answered 423.
 * A real zero is drawn as 0, but only where every read it covers succeeded.
 */

import { NOT_RECORDED, titleCase } from '../../../lib/absence.js';
import { parseStamp } from '../../../ui/parseStamp.js';

export { NOT_RECORDED, parseStamp };

/* ------------------------------------------------------------------ *
 * Addresses (D923 §1)
 * ------------------------------------------------------------------ */

export const DESK_PATH = '/admin/partner-invitations';
export const INVITATIONS_PATH = '/admin/partner-invitations/invitations';
export const DEALS_PATH = '/admin/partner-invitations/deals';
export const REFERRALS_PATH = '/admin/partner-invitations/referrals';
export const FIRM_LINKS_PATH = '/admin/partner-invitations/firm-links';
/** The old address. App.jsx redirects it to `MOVED_PATH`. */
export const OLD_PATH = '/admin/partners';
export const MOVED = 'partners';
export const MOVED_PATH = `${DESK_PATH}?moved=${MOVED}`;
/** Community's own address since D930 (#2367); `/admin/held/community` only redirects there. */
export const COMMUNITY_PATH = '/admin/community';
export const CONTRACTS_TEMPLATES_PATH = '/admin/contracts?tab=templates';
export const CONTRACTS_PAYOUTS_PATH = '/admin/contracts?tab=partner-deals';
export const PROFILES_PATH = '/admin?tab=profiles';

export const TITLE = 'Partner invitations';
export const LINE = 'Bring operating partners in, see where each invitee stands, and keep their deals healthy.';
export const MOVED_LINE = 'Partner invitations has a new address. Update your bookmark.';

/** The tab strip (PI1). Firm links has an address and no tab (D923 §1). */
export const TABS = [
  { key: 'overview', label: 'Overview', path: DESK_PATH },
  { key: 'invitations', label: 'Invitations', path: INVITATIONS_PATH },
  { key: 'deals', label: 'Deals', path: DEALS_PATH },
  { key: 'referrals', label: 'Referrals', path: REFERRALS_PATH },
];

/** The Worker's `parseInt`: a record id is a positive whole number. */
export const isRecordId = (id) => /^[1-9]\d*$/.test(String(id ?? ''));

/** A segment that cannot be decoded (`%E0`, `50%`) stays raw, fails `isRecordId`, and opens no record: never a crash. */
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

/** What a path opens: the tab, and the record drawn over it. */
export function routeFor(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '');
  if (path === FIRM_LINKS_PATH) return { tab: 'firm-links', record: null };
  const hit = TABS.find((t) => t.path === path);
  if (hit) return { tab: hit.key, record: null };
  const m = /^\/admin\/partner-invitations\/(invitations|deals)\/([^/]+)$/.exec(path);
  if (m) return { tab: m[1], record: { kind: m[1] === 'invitations' ? 'invitation' : 'deal', id: safeDecode(m[2]) } };
  return { tab: 'overview', record: null };
}

export const tabPath = (tab) => (tab === 'firm-links' ? FIRM_LINKS_PATH : (TABS.find((t) => t.key === tab) || TABS[0]).path);
export const invitationHref = (id) => `${INVITATIONS_PATH}/${encodeURIComponent(id)}`;
export const dealHref = (id) => `${DEALS_PATH}/${encodeURIComponent(id)}`;
export const referralsForDeal = (id) => `${REFERRALS_PATH}?deal=${encodeURIComponent(id)}`;
export const envelopeHref = (id) => `/legal/send?envelope=${encodeURIComponent(id)}`;

/** `?moved=partners`: the visitor came by the old address (PI9f). */
export const cameFromOldAddress = (search) => new URLSearchParams(search || '').get('moved') === MOVED;

export function withoutMoved(search) {
  const q = new URLSearchParams(search || '');
  q.delete('moved');
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** `?deal=<id>` on Referrals narrows it to one deal. */
export function dealFromSearch(search) {
  const id = new URLSearchParams(search || '').get('deal');
  return isRecordId(id) ? id : null;
}

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

export const NOT_READ_YET = 'Not read here yet';
export const NOT_IN_READ = 'Not in this read';
export const COULD_NOT_READ = 'Could not be read';
export const PAUSED = 'Paused after a recent account recovery';
export const READING = 'Reading…';
export const NOT_REACHED = 'Not reached';
export const NO_NAME = 'No name given';

const nf = (n) => Number(n).toLocaleString('en-US');
export const plural = (n, one, many) => `${nf(n)} ${n === 1 ? one : many}`;

/** The claim a failed list is not: `Unreadable` prints "{what} could not be read." before it. */
export const LIST_CLAIM = 'A failed list is not a claim that there are none.';
export const COUNT_CLAIM = 'That is not a claim that the count is zero.';

const lower = (s) => `${String(s).charAt(0).toLowerCase()}${String(s).slice(1)}`;
/**
 * A 423 `recovery_cool_off_active`, said as such. Its subject is "Reading
 * [what]", so the verb holds for "the envelope" and "the due-diligence cases"
 * alike.
 */
export const pausedLine = (what) => `Reading ${lower(what)} is paused after a recent account recovery. It resumes when the 24-hour cool-off ends.`;

/* ------------------------------------------------------------------ *
 * Time: D1's zone-less stamps are UTC (`parseStamp`)
 * ------------------------------------------------------------------ */

export const DAY_MS = 86_400_000;
/** `INVITE_TTL_DAYS` in `admin_partners.ts`: create and resend both set `expires_at` to now + 14 days. */
export const INVITE_TTL_DAYS = 14;
/** "Ending soon" on this page (D923 §2). The branch home's 60-day count is its own figure. */
export const ENDING_SOON_DAYS = 30;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A stored time (or epoch ms) as its UTC day, '3 Oct 2026', or null when there is none. */
export function day(value) {
  const ms = typeof value === 'number' ? value : parseStamp(value);
  if (ms === null || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export const dayOr = (value, fallback = NOT_RECORDED) => day(value) || fallback;

/* ------------------------------------------------------------------ *
 * The reads, and Guard L
 * ------------------------------------------------------------------ */

/**
 * A read as the hook holds it: `{ status: 'loading' | 'ready' | 'error',
 * data, error }`. A read that failed after an earlier success keeps that
 * success's `data` (it is stale): its rows stay on screen only under a "Could
 * not refresh" line (D923 §2).
 */
export const dataOf = (read) => (read && read.data !== undefined && read.data !== null ? read.data : null);
export const isLoading = (read) => !read || (read.status === 'loading' && dataOf(read) === null);
export const isFailed = (read) => Boolean(read) && read.status === 'error' && dataOf(read) === null;
export const isStale = (read) => Boolean(read) && read.status === 'error' && dataOf(read) !== null;
/**
 * A stale read being read again: the hook keeps its rows, marks it
 * `refreshing` and sets its status to `loading` (a read that last answered
 * keeps `ready`). Until the reply its rows are still the ones from before the
 * failed refresh, so the page is as unsure as when it was stale.
 */
export const isRetrying = (read) => Boolean(read?.refreshing) && read.status === 'loading' && dataOf(read) !== null;
export const listOf = (read) => (Array.isArray(dataOf(read)) ? dataOf(read) : null);
/** A 423 `recovery_cool_off_active`: R5, R7, R8 and R9 pause for 24 hours after an account recovery. */
export const isCoolOff = (error) => Number(error?.status) === 423 && (error?.code === 'recovery_cool_off_active' || error?.data?.error === 'recovery_cool_off_active');

/**
 * GUARD L (D923 §2). A list that returns exactly its cap is incomplete, so a
 * figure drawn from it says what it covers ("200+", "within the newest 200",
 * "of the first 500") and is never drawn as a total.
 */
export const CAPS = Object.freeze({ invitations: 200, deals: 200, redemptions: 500, links: 500, cases: 200, users: 100 });
export const atCap = (list, cap) => Array.isArray(list) && list.length >= cap;
export const capped = (n, isCapped) => (isCapped ? `${nf(n)}+` : nf(n));
export const WITHIN_INVITATIONS = 'Within the newest 200 by first send';
export const WITHIN_DEALS = 'Counted over the newest 200 deals in each state';

/* ------------------------------------------------------------------ *
 * Deal types, states, tiers and term (D923 §2)
 * ------------------------------------------------------------------ */

export const DEAL_TYPES = [
  { key: 'equity_partnership', word: 'Equity partnership' },
  { key: 'services_partnership', word: 'Services partnership' },
  { key: 'deal_sourcing_revshare', word: 'Deal-sourcing revenue share' },
  { key: 'capital_partnership', word: 'Capital partnership' },
  { key: 'custom', word: 'Custom' },
];

/** The canvas's type word. A raw key such as `deal_sourcing_revshare` never shows. */
export function dealTypeWord(type) {
  const hit = DEAL_TYPES.find((d) => d.key === type);
  if (hit) return hit.word;
  return type ? 'Another deal type' : 'Deal type not recorded';
}

/** "the Services partnership", "the custom deal": a type inside a sentence. */
const typeInSentence = (type) => (type === 'custom' ? 'custom deal' : dealTypeWord(type));

/** The six states, in the canvas's order. A raw state such as `awaiting_signature` never shows. */
export const DEAL_STATES = [
  { key: 'proposed', word: 'Offer chosen, not sent', tone: 'amber', glyph: '◆' },
  { key: 'awaiting_signature', word: 'Awaiting signature', tone: 'amber', glyph: '✎' },
  { key: 'active', word: 'Active', tone: 'green', glyph: '✓' },
  { key: 'expired', word: 'Term over', tone: 'muted', glyph: '–' },
  { key: 'terminated', word: 'Terminated', tone: 'red', glyph: '✕' },
  { key: 'voided', word: 'Voided', tone: 'muted', glyph: '–' },
];
export const DEAL_STATE_KEYS = DEAL_STATES.map((s) => s.key);
/** Codes redeem only while a deal is active, so only these states can hold redemptions (Guard F). */
export const REDEEMING_STATES = ['active', 'terminated', 'expired'];

export function dealState(status) {
  return DEAL_STATES.find((s) => s.key === status) || { key: status || 'unknown', word: status ? 'Another state' : 'State not recorded', tone: 'muted', glyph: '·' };
}

/**
 * Tiers (D923 §2, O-TIER). The stored founder grant, `founder_pro`, is on no
 * founder ladder (`requireTier.ts`: free, growth, studio), and an unknown tier
 * ranks as free, so "Founder Pro" is never drawn as a plan: the page draws
 * the stored investor tier and "Founder grant: no plan".
 */
const FOUNDER_PLAN = { growth: 'Founder Growth', studio: 'Founder Studio' };
const INVESTOR_TIER = { free: 'Investor Free', professional: 'Investor Professional', institutional: 'Investor Institutional' };
export const FOUNDER_NO_PLAN = 'Founder grant: no plan';

export function tierWords(founder, investor) {
  const out = [];
  if (investor) out.push(INVESTOR_TIER[investor] || `Investor ${titleCase(investor)}`);
  if (founder) out.push(FOUNDER_PLAN[founder] || FOUNDER_NO_PLAN);
  return out;
}

export const tiersText = (founder, investor) => tierWords(founder, investor).join(' · ') || 'No tier granted';

/**
 * Term (D923 §2, O-MONTH). The stored start and end are drawn, never an end
 * computed from months: the Worker counts a month as 30 days.
 */
export function termText(deal) {
  if (deal?.status === 'voided') return 'Never started';
  const start = day(deal?.activated_at);
  if (!start) return deal?.status === 'proposed' || deal?.status === 'awaiting_signature' ? 'Starts on signing' : NOT_RECORDED;
  return `${start} – ${day(deal?.expires_at) || 'end not recorded'}`;
}

/**
 * Days left. Amber at 30 or under; "Ended [date]" once over. An active deal
 * past its end, before the 04:40 UTC sweep closes it, reads "Term ended, not
 * yet closed": never negative days.
 */
export function daysLeft(deal, now) {
  const end = parseStamp(deal?.expires_at);
  switch (deal?.status) {
    case 'active': {
      if (end === null) return { text: NOT_RECORDED };
      if (end <= now) return { text: 'Term ended, not yet closed', tone: 'amber', past: true };
      const days = Math.ceil((end - now) / DAY_MS);
      return { text: plural(days, 'day', 'days'), days, tone: days <= ENDING_SOON_DAYS ? 'amber' : null };
    }
    case 'expired': return { text: end === null ? 'Ended' : `Ended ${day(end)}` };
    case 'terminated': return { text: day(deal.terminated_at) ? `Ended ${day(deal.terminated_at)}` : 'Ended' };
    case 'proposed':
    case 'awaiting_signature': return { text: 'Starts on signing' };
    case 'voided': return { text: 'Never started' };
    default: return { text: NOT_RECORDED };
  }
}

/**
 * The days-used bar on one deal (PI6): its length is the stored end minus the
 * stored start. The days left round up, as `daysLeft` does, so the record and
 * its Deals row never differ by a day; the days used are the rest.
 */
export function daysUsed(deal, now) {
  const start = parseStamp(deal?.activated_at);
  const end = parseStamp(deal?.expires_at);
  if (start === null || end === null || end <= start) return null;
  const total = Math.round((end - start) / DAY_MS);
  const stop = deal?.status === 'terminated' ? (parseStamp(deal?.terminated_at) ?? now) : now;
  const left = Math.min(total, Math.max(0, Math.ceil((end - stop) / DAY_MS)));
  const used = total - left;
  return { total, used, left, fraction: total ? used / total : 0 };
}

/* ------------------------------------------------------------------ *
 * GUARD I — the stage word (D923 §2)
 * ------------------------------------------------------------------ */

export const STEPS = ['Sent', 'Opened', 'Profile done', 'Offers shown', 'Offer chosen', 'Agreement out', 'Signed'];
const STORED_STEP = { sent: 1, viewed: 2, profiled: 3, proposed: 4, selected: 5, finalized: 6, signed: 7 };
const STEP_KEY = ['', 'sent', 'viewed', 'profiled', 'proposed', 'selected', 'finalized', 'signed'];
const STEP_TONE = ['', 'muted', 'muted', 'violet', 'violet', 'violet', 'amber', 'green'];
const STEP_GLYPH = ['', '↑', '◉', '✓', '◇', '◆', '✎', '✓'];

/** R1's stored status in the canvas's words (D923 §2's table). */
export const STAGE_WORDS = Object.freeze({
  sent: 'Sent', viewed: 'Opened', profiled: 'Profile done', proposed: 'Offers shown',
  selected: 'Offer chosen', finalized: 'Agreement out', signed: 'Signed', revoked: 'Revoked',
});

/** A stored `expired` has one meaning: the agreement was signed after the link lapsed, and the deal was voided. */
export const STORED_EXPIRED_WORD = 'Signed after the link lapsed · deal voided';
export const LAG_WORD = 'Stage may lag';
/** Create stamps `created_at` in whole seconds just after it computes `expires_at`; a minute's slack keeps that apart from a resend. */
export const RESENT_SLACK_MS = 60_000;

/**
 * A row was resent when `expires_at` minus 14 days is later than
 * `created_at`: both create and resend set `expires_at` to now + 14 days, and
 * resend writes no date of its own. Returns the last send, or null.
 */
export function resentAt(inv) {
  const expires = parseStamp(inv?.expires_at);
  const created = parseStamp(inv?.created_at);
  if (expires === null || created === null) return null;
  const last = expires - INVITE_TTL_DAYS * DAY_MS;
  return last - created > RESENT_SLACK_MS ? last : null;
}

/** Lapsed: the link's `expires_at` has passed and the invitation is not Signed or Revoked (R1's `is_expired`). */
export function isLapsed(inv, now) {
  const status = inv?.status;
  if (status === 'signed' || status === 'revoked' || status === 'expired') return false;
  if (typeof inv?.is_expired === 'boolean') return inv.is_expired;
  const expires = parseStamp(inv?.expires_at);
  return expires !== null && expires < now;
}

/** Whether R2 `proposed` holds a deal for this invitation: found, absent, unsure (failed, stale or at its cap) or loading. */
export function proposedFor(invId, proposedRead) {
  const list = listOf(proposedRead);
  if (list) {
    if (list.some((d) => String(d?.invitation_id) === String(invId))) return 'found';
    return atCap(list, CAPS.deals) || isStale(proposedRead) ? 'unsure' : 'absent';
  }
  return isLoading(proposedRead) ? 'loading' : 'unsure';
}

/**
 * One invitation's stage. Today's Worker writes `sent` over every stage on a
 * resend, so the page repairs what it can until part 1 stops the overwrite:
 *   · a row with an `envelope_id` that is not Signed, Revoked or a stored
 *     `expired` is at least Agreement out (R1 proves this with no cap);
 *   · a deal in R2 `proposed` with this `invitation_id` lifts it to Offer
 *     chosen. When that list failed or is at its cap, a resent row below Offer
 *     chosen says "Stage may lag";
 *   · Profile done and Offers shown cannot be repaired until part 1.
 * Lapsed keeps the dots at the stage reached, as the canvas draws Mara.
 */
export function stageOf(inv, { proposed = null, now = Date.now() } = {}) {
  const status = String(inv?.status || '');
  const resent = resentAt(inv);
  const base = { resent, lapsed: false, mayLag: false, repaired: false };
  if (status === 'revoked') return { ...base, key: 'revoked', word: 'Revoked', stageWord: 'Revoked', tone: 'red', glyph: '✕', step: null, closed: true };
  if (status === 'expired') return { ...base, key: 'expired', word: STORED_EXPIRED_WORD, stageWord: STORED_EXPIRED_WORD, tone: 'muted', glyph: '✕', step: null, closed: true };
  if (status === 'signed') return { ...base, key: 'signed', word: 'Signed', stageWord: 'Signed', tone: 'green', glyph: '✓', step: 7, closed: true };
  let step = STORED_STEP[status] ?? null;
  const lapsed = isLapsed(inv, now);
  if (step === null) {
    const word = status ? 'Stage not recognised' : 'Stage not recorded';
    return { ...base, key: 'unknown', word, stageWord: word, tone: 'muted', glyph: '·', step: null, closed: false, lapsed };
  }
  let repaired = false;
  let mayLag = false;
  if (inv?.envelope_id && step < 6) { step = 6; repaired = true; }
  if (step < 5) {
    const p = proposedFor(inv?.id, proposed);
    if (p === 'found') { step = 5; repaired = true; } else if (p === 'unsure' && resent !== null) mayLag = true;
  }
  const stageWord = STEPS[step - 1];
  return {
    ...base, key: STEP_KEY[step], stageWord, word: lapsed ? 'Lapsed' : stageWord, tone: lapsed ? 'amber' : STEP_TONE[step],
    glyph: lapsed ? '◷' : STEP_GLYPH[step], step, closed: false, lapsed, repaired, mayLag,
  };
}

/** The seven dots' text label, so the dots are never the only label (D923 §3). */
export function dotsLabel(stage) {
  if (!stage || stage.step === null) return stage?.word || 'Stage not recorded';
  return `Step ${stage.step} of 7: ${STEPS[stage.step - 1]}${stage.lapsed ? ', link lapsed' : ''}`;
}

export const nameOf = (inv) => String(inv?.recipient_name || '').trim() || NO_NAME;
/** The name inside a sentence, or the address when no name was given. */
export const whoOf = (inv) => String(inv?.recipient_name || '').trim() || String(inv?.recipient_email || '').trim() || 'this invitee';

/* ------------------------------------------------------------------ *
 * The agreement-ready rule (D923 §2)
 * ------------------------------------------------------------------ */

/** The five fields finalize fills (`partner_onboarding.ts`). */
export const FINALIZE_FILLS = Object.freeze(['partner_name', 'partner_email', 'effective_date', 'deal_type', 'term_months']);
/** R8 refuses with these when the template has no body or its store cannot be read. */
export const TEMPLATE_REFUSALS = Object.freeze(['template_has_no_body', 'template_unreadable']);

/**
 * The Partner Services agreement cannot be sent yet when R8 refuses (no body,
 * or the template cannot be read), or when it lists a field finalize leaves
 * empty: a sender field outside the five finalize fills, or any
 * `counterparty.*` field, which this flow never fills. When R8 itself fails
 * any other way, nothing is said either way (`unknown`). Part 5's signal
 * replaces this rule.
 */
export function agreementReady(read) {
  if (isLoading(read)) return { state: 'loading' };
  if (isFailed(read)) {
    const code = read.error?.code || read.error?.data?.code || null;
    if (TEMPLATE_REFUSALS.includes(code)) return { state: 'not_ready', why: code };
    return { state: 'unknown' };
  }
  const fields = dataOf(read)?.fields;
  if (!Array.isArray(fields)) return { state: 'unknown' };
  const unfilled = fields
    .map((f) => ({ key: String(f?.key || ''), by: f?.filled_by }))
    .filter((f) => f.key.startsWith('counterparty.') || (f.by === 'sender' && !FINALIZE_FILLS.includes(f.key)))
    .map((f) => f.key);
  return unfilled.length ? { state: 'not_ready', why: 'fields', fields: unfilled } : { state: 'ready' };
}

export const AGREEMENT_BANNER = 'The Partner Services agreement is not ready. Invitees who choose an offer cannot sign until it is completed in Contracts.';
export const AGREEMENT_NOT_READY = 'The Partner Services agreement is not ready, so it cannot be sent yet. Nothing has been sent. The chosen offer is kept.';

/* ------------------------------------------------------------------ *
 * Invitations (PI2)
 * ------------------------------------------------------------------ */

/**
 * What the invitee is offered. `buildProposals` offers the first three stored
 * types, so the distinct types among those are drawn; any other type reads
 * "Not offered to the invitee". An empty list is the Worker's parse fallback
 * (create refuses zero types), so it reads "Could not be read".
 */
export function offeredTypes(inv) {
  const raw = Array.isArray(inv?.allowed_deal_types) ? inv.allowed_deal_types.map(String) : [];
  const valid = raw.filter((t) => DEAL_TYPES.some((d) => d.key === t));
  if (!valid.length) return { unreadable: true, shown: [], others: [] };
  const shown = [...new Set(valid.slice(0, 3))];
  const others = [...new Set(valid.slice(3))].filter((t) => !shown.includes(t));
  return { unreadable: false, shown, others };
}

export const NOT_OFFERED = 'Not offered to the invitee';
export const AGREEMENT_LAPSE_WARNING = 'A signature now would be voided. Resend renews the link.';
export const LINK_LAPSED = 'Link lapsed. Resend to renew it.';

/** Expires: the date, "Lapsed [date]" (with the Agreement-out warning), or "Closed". */
export function expiresCell(inv, stage) {
  if (stage.closed) return { text: 'Closed' };
  if (stage.lapsed) return { text: day(inv?.expires_at) ? `Lapsed ${day(inv.expires_at)}` : 'Lapsed', tone: 'amber', warn: stage.step === 6 ? AGREEMENT_LAPSE_WARNING : null };
  return { text: dayOr(inv?.expires_at) };
}

/** One table row, from R1's own fields and Guard I. */
export function invitationRow(inv, { proposed = null, now = Date.now() } = {}) {
  const stage = stageOf(inv, { proposed, now });
  return {
    id: inv?.id,
    name: nameOf(inv),
    named: Boolean(String(inv?.recipient_name || '').trim()),
    email: String(inv?.recipient_email || '').trim() || NOT_RECORDED,
    offered: offeredTypes(inv),
    stage,
    invitedBy: String(inv?.invited_by_name || '').trim() || NOT_RECORDED,
    sent: dayOr(inv?.created_at),
    resent: stage.resent !== null ? day(stage.resent) : null,
    opened: day(inv?.viewed_at) || 'Not opened',
    expires: expiresCell(inv, stage),
    dealId: inv?.resulting_deal_id ?? null,
    member: inv?.resulting_user_id !== null && inv?.resulting_user_id !== undefined,
    link: inv?.link || null,
    actions: stage.closed ? ['open'] : ['copy', 'resend', 'revoke'],
  };
}

/** The stage chips (multi-select, Lapsed included). A lapsed row answers to Lapsed, as its pill says. */
export const STAGE_CHIPS = [
  ...STEPS.map((word, i) => ({ key: STEP_KEY[i + 1], word })),
  { key: 'lapsed', word: 'Lapsed' },
  { key: 'revoked', word: 'Revoked' },
];
const chipOf = (stage) => (stage.lapsed ? 'lapsed' : stage.key);

export const INVITATION_SORTS = [
  { key: 'newest', label: 'Newest sent' },
  { key: 'oldest-open', label: 'Oldest open first' },
  { key: 'expires', label: 'Expires soonest' },
  { key: 'name', label: 'Name A–Z' },
  { key: 'stage', label: 'Stage' },
];
export const SENT_WITHIN = [7, 30, 90, 365];

const byCreatedDesc = (a, b) => (parseStamp(b.inv.created_at) ?? -Infinity) - (parseStamp(a.inv.created_at) ?? -Infinity);
const isOpenRow = (r) => !r.row.stage.closed;
const stageRank = (stage) => (stage.closed ? (stage.key === 'signed' ? 8 : 10) : stage.lapsed ? 9 : stage.step ?? 11);

/**
 * Search (name or email), stage chips, the type offered, the inviter and the
 * first send, over the loaded rows, then the sort. Below the cap these are
 * exact; at it they cover the newest 200 by first send (Guard L).
 */
export function filterInvitations(rows, { q = '', stages = [], type = '', invitedBy = '', sentWithin = '', sort = 'newest', now = Date.now() } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const chips = new Set(stages);
  const within = Number(sentWithin) > 0 ? now - Number(sentWithin) * DAY_MS : null;
  const out = rows.filter(({ inv, row }) => {
    if (needle && !`${row.named ? row.name : ''} ${row.email}`.toLowerCase().includes(needle)) return false;
    if (chips.size && !chips.has(chipOf(row.stage))) return false;
    if (type && !row.offered.shown.includes(type)) return false;
    if (invitedBy && row.invitedBy !== invitedBy) return false;
    if (within !== null) {
      const sent = parseStamp(inv.created_at);
      if (sent === null || sent < within) return false;
    }
    return true;
  });
  const sorters = {
    newest: byCreatedDesc,
    'oldest-open': (a, b) => (isOpenRow(b) - isOpenRow(a)) || -byCreatedDesc(a, b),
    expires: (a, b) => (isOpenRow(b) - isOpenRow(a)) || ((parseStamp(a.inv.expires_at) ?? Infinity) - (parseStamp(b.inv.expires_at) ?? Infinity)),
    name: (a, b) => a.row.name.localeCompare(b.row.name, 'en', { sensitivity: 'base' }) || a.row.email.localeCompare(b.row.email),
    stage: (a, b) => stageRank(a.row.stage) - stageRank(b.row.stage) || byCreatedDesc(a, b),
  };
  return [...out].sort(sorters[sort] || byCreatedDesc);
}

export const ROWS_PER_PAGE = 25;

export function pageOf(rows, page, size = ROWS_PER_PAGE) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(Math.max(1, page), pages);
  const from = rows.length ? (at - 1) * size + 1 : 0;
  const to = Math.min(at * size, rows.length);
  return { rows: rows.slice(from ? from - 1 : 0, to), page: at, pages, from, to, total: rows.length };
}

/** "1–25 of 42"; at the cap, "1–25 of 42 within the newest 200…". */
export function rangeText({ from, to, total }, cover = null) {
  if (!total) return 'None';
  return `${nf(from)}–${nf(to)} of ${nf(total)}${cover ? ` · ${cover.charAt(0).toLowerCase()}${cover.slice(1)}` : ''}`;
}

/** The empty line after a search, in the canvas's words; at the cap it says what it covers. */
export function noMatchLine(q, isCapped) {
  const s = String(q || '').trim();
  if (s) return isCapped ? `None of the newest 200 match ‘${s}’.` : `No invitation matches ‘${s}’.`;
  return 'No invitation matches these filters.';
}

/* ------------------------------------------------------------------ *
 * Deals (PI5), from the six R2 lists under Guard L
 * ------------------------------------------------------------------ */

/**
 * The six lists as one: their rows, and which lists are loading, being read
 * again (`refreshing`; `retrying` when that follows a failed refresh), failed,
 * stale or at their cap. A deal that changed
 * state can sit in two lists read at different moments (an old `active` and a
 * fresh `terminated`), so each id is kept once: the copy from a list that
 * answered beats a stale or still-refreshing one, then the later read wins.
 */
export function dealsUnion(deals, states = DEAL_STATE_KEYS) {
  const out = { rows: [], loading: [], failed: [], capped: [], stale: [], refreshing: [], retrying: [] };
  const byId = new Map();
  for (const s of states) {
    const read = deals?.[s];
    const list = listOf(read);
    if (list) {
      const fresh = isStale(read) || read?.refreshing ? 0 : 1;
      const at = Number(read?.at) || 0;
      for (const row of list) {
        const key = String(row?.id);
        const prev = byId.get(key);
        if (!prev || fresh > prev.fresh || (fresh === prev.fresh && at > prev.at)) byId.set(key, { row, fresh, at });
      }
      if (atCap(list, CAPS.deals)) out.capped.push(s);
      if (isStale(read)) out.stale.push(s);
      if (read?.refreshing) out.refreshing.push(s);
      if (isRetrying(read)) out.retrying.push(s);
    } else if (isLoading(read)) out.loading.push(s);
    else out.failed.push(s);
  }
  out.rows = [...byId.values()].map((v) => v.row);
  return out;
}

/** R5 answered 423 `recovery_cool_off_active`: its figures come from the six lists until the cool-off ends (D923 §2). */
export const contractsPaused = (contracts) => isFailed(contracts) && isCoolOff(contracts.error);
export const CONTRACTS_PAUSED = 'Reading every deal from Contracts is paused after a recent account recovery, so the deal lists are counted instead.';

/** The Deals tab's count: R5's `total` when it answers, else the six lists' sum under Guard L. */
export function dealsCount(contracts, deals) {
  const c = dataOf(contracts);
  if (c && Array.isArray(c.items) && Number.isFinite(Number(c.total))) return { text: nf(c.total), title: 'Every deal, in every state' };
  if (isLoading(contracts)) return null;
  const u = dealsUnion(deals);
  if (u.loading.length || u.failed.length) return null;
  const title = u.capped.length ? WITHIN_DEALS : 'Every deal, in every state';
  return {
    text: u.capped.length ? capped(u.rows.length, true) : nf(u.rows.length),
    title: contractsPaused(contracts) ? `${title}. ${CONTRACTS_PAUSED}` : title,
  };
}

/**
 * A partner's name and address. Before signing they come from the invitation,
 * by `invitation_id`. "Not recorded" only when R1 answered on its latest read:
 * a list whose refresh failed (or that is read again after one) did not hold
 * an invitation newer than its last good read, so it is no claim either way.
 */
export function dealPartner(deal, invitations) {
  if (deal?.user_id !== null && deal?.user_id !== undefined && (deal.partner_name || deal.partner_email)) {
    return { name: String(deal.partner_name || '').trim() || String(deal.partner_email), email: deal.partner_email || NOT_RECORDED };
  }
  const via = invitationForDeal(deal, invitations);
  if (via.state === 'ready') return { name: nameOf(via.inv), email: via.inv.recipient_email || NOT_RECORDED, inv: via.inv };
  const name = { missing: NOT_IN_READ, none: NOT_RECORDED, loading: READING }[via.state] || COULD_NOT_READ;
  return { name, email: null };
}

/** The invitation a deal came from, by `invitation_id`, from R1; `none` only when R1 answered on its latest read (`dealPartner`). */
export function invitationForDeal(deal, invitations) {
  const list = listOf(invitations);
  const inv = list?.find((i) => String(i?.id) === String(deal?.invitation_id));
  if (inv) return { state: 'ready', inv };
  if (isRetrying(invitations)) return { state: 'loading' };
  if (isStale(invitations)) return { state: 'unreadable' };
  if (list) return { state: atCap(list, CAPS.invitations) ? 'missing' : 'none' };
  return { state: isLoading(invitations) ? 'loading' : 'unreadable' };
}

/**
 * The Due diligence column from R9, matched on `subject_id = user_id`: Open,
 * Not opened before signing, Archived, or "No case on record" below R9's cap.
 * "Cleared" waits for #2385; a stored `completed` reads "Completed".
 */
export function ddFor(deal, cases) {
  if (deal?.user_id === null || deal?.user_id === undefined) return { text: 'Not opened before signing' };
  const list = listOf(cases);
  if (!list) {
    if (isLoading(cases)) return { text: READING };
    return { text: isCoolOff(cases?.error) ? PAUSED : COULD_NOT_READ, failed: true };
  }
  const hit = list.find((c) => String(c?.subject_id) === String(deal.user_id));
  if (hit) {
    if (hit.status === 'open' || hit.status === 'in_review') return { text: 'Open', uid: hit.uid, open: true };
    if (hit.status === 'archived') return { text: 'Archived', uid: hit.uid };
    if (hit.status === 'completed') return { text: 'Completed', uid: hit.uid };
    return { text: 'Another state', uid: hit.uid };
  }
  return { text: atCap(list, CAPS.cases) ? NOT_IN_READ : 'No case on record' };
}

export const LAPSED_BEFORE_SIGNING = 'Lapsed before signing · Resend to continue';

/** One Deals row: the deal's own fields, its partner, its case, and the one cross-check D923 draws. */
export function dealRow(deal, { invitations = null, cases = null, now = Date.now() } = {}) {
  const unsigned = deal?.status === 'proposed' || deal?.status === 'awaiting_signature';
  const via = invitationForDeal(deal, invitations);
  const count = Number(deal?.redemptions_count);
  return {
    id: deal?.id,
    partner: dealPartner(deal, invitations),
    type: dealTypeWord(deal?.deal_type),
    tiers: tiersText(deal?.granted_tier_founder, deal?.granted_tier_investor),
    term: termText(deal),
    daysLeft: daysLeft(deal, now),
    code: deal?.referral_code || null,
    redemptions: deal?.referral_code ? (Number.isFinite(count) ? nf(count) : NOT_RECORDED) : null,
    state: dealState(deal?.status),
    dd: ddFor(deal, cases),
    lapsed: unsigned && via.state === 'ready' && isLapsed(via.inv, now) ? LAPSED_BEFORE_SIGNING : null,
  };
}

export const DEAL_SORTS = [
  { key: 'ends', label: 'Ends soonest' },
  { key: 'newest', label: 'Newest' },
  { key: 'redemptions', label: 'Most redemptions' },
  { key: 'partner', label: 'Partner A–Z' },
];
export const ENDS_WITHIN = [30, 60, 90];

/** Search (partner, email or code), state chips (Active on by default), type, ends within, has redemptions, sort. */
export function filterDeals(rows, { q = '', states = ['active'], type = '', endsWithin = '', hasRedemptions = false, sort = 'ends', now = Date.now() } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const chips = new Set(states);
  const horizon = Number(endsWithin) > 0 ? now + Number(endsWithin) * DAY_MS : null;
  const out = rows.filter(({ deal, row }) => {
    if (needle && ![row.partner.name, row.partner.email, deal.referral_code].some((v) => String(v || '').toLowerCase().includes(needle))) return false;
    if (chips.size && !chips.has(deal.status)) return false;
    if (type && deal.deal_type !== type) return false;
    if (horizon !== null) {
      const end = parseStamp(deal.expires_at);
      if (deal.status !== 'active' || end === null || end > horizon) return false;
    }
    if (hasRedemptions && !(Number(deal.redemptions_count) > 0)) return false;
    return true;
  });
  const end = (r) => (r.deal.status === 'active' ? parseStamp(r.deal.expires_at) ?? Infinity : Infinity);
  const sorters = {
    ends: (a, b) => end(a) - end(b) || (parseStamp(b.deal.created_at) ?? -Infinity) - (parseStamp(a.deal.created_at) ?? -Infinity),
    newest: (a, b) => (parseStamp(b.deal.created_at) ?? -Infinity) - (parseStamp(a.deal.created_at) ?? -Infinity),
    redemptions: (a, b) => (Number(b.deal.redemptions_count) || 0) - (Number(a.deal.redemptions_count) || 0),
    partner: (a, b) => a.row.partner.name.localeCompare(b.row.partner.name, 'en', { sensitivity: 'base' }),
  };
  return [...out].sort(sorters[sort] || sorters.ends);
}

/** The empty line on Deals; the canvas's own sentence for Active ending within N days. */
export function noDealLine({ q = '', states = [], endsWithin = '' } = {}) {
  if (!String(q || '').trim() && states.length === 1 && states[0] === 'active' && Number(endsWithin) > 0) return `No active deals ending within ${endsWithin} days.`;
  return 'No deal matches these filters.';
}

/** Top deals by redemptions (R3), with deals that have none left out. */
export const topDealRows = (items) => (items || []).filter((d) => Number(d?.redemptions_count) > 0);

/* ------------------------------------------------------------------ *
 * GUARD F — sums over a fan-out (D923 §2)
 * ------------------------------------------------------------------ */

/**
 * The deals with redemptions, and whether that set is complete: from R5
 * (`redemption_count > 0`, uncapped), else from the three lists that can hold
 * redemptions (active, terminated, expired). A failed list makes the set
 * unreadable; a list at its cap makes it incomplete.
 */
export function redemptionDealSet(contracts, deals) {
  const c = dataOf(contracts);
  if (c && Array.isArray(c.items) && c.complete !== false) {
    return { state: 'ready', complete: true, deals: c.items.filter((r) => Number(r?.redemption_count) > 0).map((r) => ({ id: String(r.id), count: Number(r.redemption_count) })) };
  }
  if (isLoading(contracts)) return { state: 'loading' };
  const u = dealsUnion(deals, REDEEMING_STATES);
  if (u.loading.length) return { state: 'loading' };
  if (u.failed.length) return { state: 'unreadable' };
  return { state: 'ready', complete: !u.capped.length, deals: u.rows.filter((r) => Number(r?.redemptions_count) > 0).map((r) => ({ id: String(r.id), count: Number(r.redemptions_count) })) };
}

/**
 * The fan-out's rows (one R4 call per deal in the set). A figure over them is
 * exact only when all three hold: the deal set is complete, every call
 * succeeded, and each call's rows number that deal's uncapped count. A failed
 * call makes every figure "Could not be read for [k] of [m] deals", never a
 * smaller number.
 */
export function fanOut(set, calls) {
  if (!set || set.state === 'loading') return { state: 'loading' };
  if (set.state === 'unreadable') return { state: 'unreadable', text: COULD_NOT_READ, claim: 'The deal lists it counts over did not answer.' };
  const m = set.deals.length;
  const failed = [];
  const items = [];
  const short = [];
  const firstOnly = [];
  let waiting = 0;
  for (const d of set.deals) {
    const read = calls?.get?.(d.id);
    if (read?.status === 'error') { failed.push(d.id); continue; }
    // A call being read again keeps its last rows, so a refresh does not blank the figure.
    const data = dataOf(read);
    if (!data) { waiting += 1; continue; }
    const rows = Array.isArray(data.items) ? data.items : [];
    for (const it of rows) items.push({ ...it, dealId: d.id, deal: data.deal || null });
    if (rows.length !== d.count) {
      short.push(d.id);
      if (rows.length >= CAPS.redemptions) firstOnly.push(d.id);
    }
  }
  if (failed.length) {
    return {
      state: 'unreadable', k: failed.length, m,
      text: `Could not be read for ${nf(failed.length)} of ${plural(m, 'deal', 'deals')}`,
      claim: `${nf(failed.length)} of ${plural(m, 'deal', 'deals')} did not answer, so no partial sum is drawn.`,
    };
  }
  if (waiting) return { state: 'loading' };
  return { state: 'ready', items, m, complete: set.complete, short, firstOnly, exact: set.complete && !short.length };
}

export const FIRST_500 = 'First 500 for this deal';

/** A count over the fan-out's rows, under Guard F. A sum with nothing to cover is a real 0. */
export function fanFigure(fan, count) {
  if (!fan || fan.state === 'loading') return { state: 'loading' };
  // The figure itself says it, never a smaller number (D923 §2).
  if (fan.state === 'unreadable') return { state: 'unreadable', figure: fan.text, reason: fan.claim };
  const n = count(fan.items);
  if (fan.exact) return { state: 'ready', n, value: nf(n) };
  let sub;
  if (!fan.complete) sub = `${WITHIN_DEALS}.`;
  else if (fan.firstOnly.length) sub = `Counted over the first 500 redemptions of ${plural(fan.firstOnly.length, 'deal', 'deals')}.`;
  else sub = 'A deal’s count changed while it was read.';
  return { state: 'ready', n, value: `${nf(n)}+`, sub, exact: false };
}

const isRevshareDeal = (deal) => deal?.deal_type === 'deal_sourcing_revshare';

/**
 * A redemption's rev-share window. A window counts as open only while its deal
 * is active (O-WIN), so an ended deal's reads "Deal ended". A plain referral
 * has "No window".
 */
export function windowOf(item) {
  if (!isRevshareDeal(item?.deal) && item?.attribution_kind !== 'deal_sourcing_revshare') return { key: 'none', text: 'No window' };
  if (item?.deal?.status !== 'active') return { key: 'ended', text: 'Deal ended' };
  const left = Number(item?.revshare_window_remaining_days);
  if (item?.revshare_window_remaining_days === null || item?.revshare_window_remaining_days === undefined || !Number.isFinite(left)) return { key: 'unknown', text: NOT_RECORDED };
  if (left <= 0) return { key: 'closed', text: 'Closed' };
  return { key: 'open', days: left, text: `${plural(left, 'day', 'days')} left` };
}

const within = (value, now, days) => {
  const at = parseStamp(value);
  return at !== null && at <= now && at > now - days * DAY_MS;
};
export const countLast90 = (now) => (items) => items.filter((it) => within(it.redeemed_at, now, 90)).length;
export const countOpenWindows = (items) => items.filter((it) => windowOf(it).key === 'open').length;
export const countClosing30 = (items) => items.filter((it) => { const w = windowOf(it); return w.key === 'open' && w.days <= ENDING_SOON_DAYS; }).length;

/** Redemptions, all time: R5's uncapped counts, else the three lists' sum under Guard L. */
export function allTimeRedemptions(contracts, deals) {
  const c = dataOf(contracts);
  // A row whose count is not a number makes the sum unreadable, never a smaller number.
  const sum = (rows, key) => (rows.every((r) => Number.isFinite(Number(r?.[key])) && r?.[key] !== null && r?.[key] !== '')
    ? rows.reduce((a, r) => a + Number(r[key]), 0) : null);
  if (c && Array.isArray(c.items) && c.complete !== false) {
    const n = sum(c.items, 'redemption_count');
    if (n !== null) return { state: 'ready', n, value: nf(n) };
  }
  if (isLoading(contracts)) return { state: 'loading' };
  const u = dealsUnion(deals, REDEEMING_STATES);
  if (u.loading.length) return { state: 'loading' };
  if (u.failed.length) return { state: 'unreadable', reason: COUNT_CLAIM };
  const n = sum(u.rows, 'redemptions_count');
  if (n === null) return { state: 'unreadable', reason: COUNT_CLAIM };
  const paused = contractsPaused(contracts) ? { cover: CONTRACTS_PAUSED, paused: true } : {};
  return u.capped.length ? { state: 'ready', n, value: capped(n, true), sub: `${WITHIN_DEALS}.`, exact: false, ...paused } : { state: 'ready', n, value: nf(n), ...paused };
}

/* ------------------------------------------------------------------ *
 * Referrals (PI7)
 * ------------------------------------------------------------------ */

export const ATTRIBUTIONS = [
  { key: 'referral', word: 'Referral' },
  { key: 'deal_sourcing_revshare', word: 'Deal-sourcing revenue share' },
];
export const attributionWord = (k) => ATTRIBUTIONS.find((a) => a.key === k)?.word || NOT_RECORDED;

const ENDED_DEAL = new Set(['terminated', 'expired']);

/** One redemption row. `dealRows` (the six lists) give an ended deal's end date, which R4 does not carry. */
export function redemptionRow(item, dealRows = []) {
  const deal = item?.deal || {};
  const listed = dealRows.find((d) => String(d?.id) === String(item?.dealId)) || null;
  let grantedUntil;
  if (ENDED_DEAL.has(deal.status)) {
    const ended = deal.status === 'terminated' ? listed?.terminated_at : deal.expires_at;
    grantedUntil = day(ended) ? `Ended with the deal ${day(ended)}` : 'Ended with the deal';
  } else grantedUntil = dayOr(item?.granted_until);
  return {
    key: `${item?.dealId}:${item?.id}`,
    dealId: item?.dealId,
    member: String(item?.redeemer_name || '').trim() || String(item?.redeemer_email || '').trim() || NOT_RECORDED,
    role: NOT_READ_YET,
    partner: String(deal.partner_name || '').trim() || String(deal.partner_email || '').trim() || NOT_RECORDED,
    code: deal.referral_code || NOT_RECORDED,
    registered: dayOr(item?.redeemed_at),
    tiers: tiersText(item?.granted_tier_founder, item?.granted_tier_investor),
    grantedUntil,
    attribution: attributionWord(item?.attribution_kind),
    window: windowOf(item),
  };
}

export const REFERRAL_SORTS = [
  { key: 'newest', label: 'Newest registered' },
  { key: 'oldest', label: 'Oldest registered' },
  { key: 'closing', label: 'Window closing soonest' },
  { key: 'member', label: 'Member A–Z' },
];
export const CLOSING_WITHIN = [30, 60, 90];

const dayStart = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? Date.parse(`${s}T00:00:00Z`) : null);

export function filterRedemptions(items, { q = '', attribution = '', partner = '', closingWithin = '', from = '', to = '', deal = null, sort = 'newest' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const start = dayStart(from);
  const end = dayStart(to) === null ? null : dayStart(to) + DAY_MS;
  const out = items.filter((it) => {
    const r = it.row;
    if (deal && String(it.item.dealId) !== String(deal)) return false;
    if (needle && ![r.member, r.partner, r.code].some((v) => String(v).toLowerCase().includes(needle))) return false;
    if (attribution && it.item.attribution_kind !== attribution) return false;
    if (partner && r.partner !== partner) return false;
    if (Number(closingWithin) > 0 && !(r.window.key === 'open' && r.window.days <= Number(closingWithin))) return false;
    const at = parseStamp(it.item.redeemed_at);
    if (start !== null && (at === null || at < start)) return false;
    if (end !== null && (at === null || at >= end)) return false;
    return true;
  });
  const at = (x) => parseStamp(x.item.redeemed_at) ?? -Infinity;
  const left = (x) => (x.row.window.key === 'open' ? x.row.window.days : Infinity);
  const sorters = {
    newest: (a, b) => at(b) - at(a),
    oldest: (a, b) => at(a) - at(b),
    closing: (a, b) => left(a) - left(b) || at(b) - at(a),
    member: (a, b) => a.row.member.localeCompare(b.row.member, 'en', { sensitivity: 'base' }),
  };
  return [...out].sort(sorters[sort] || sorters.newest);
}

export const PAYOUTS_LINE = 'Payouts are handled in Contracts.';
/** The Worker's rule, said without promising a payout for a window whose deal has ended (O-WIN is the owner's). */
export const PAYOUTS_NOTE = 'Contracts settles a payout only while its partner deal is active.';

/* ------------------------------------------------------------------ *
 * Overview (PI1)
 * ------------------------------------------------------------------ */

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const stateOfRead = (read, reason = LIST_CLAIM) => (isLoading(read) ? { state: 'loading' } : { state: 'unreadable', reason });

/** Tile row 1, from R1 under Guards L and I. */
export function invitationTiles(invitations, { proposed = null, now = Date.now() } = {}) {
  const keys = [['open', 'Open invitations'], ['lapsed', 'Lapsed, not closed'], ['signed90', 'Signed, last 90 days'], ['median', 'Days from first send to signed']];
  const list = listOf(invitations);
  if (!list) return keys.map(([key, label]) => ({ key, label, ...stateOfRead(invitations) }));
  const cover = atCap(list, CAPS.invitations) ? WITHIN_INVITATIONS : null;
  const rows = list.map((inv) => ({ inv, stage: stageOf(inv, { proposed, now }) }));
  const open = rows.filter((r) => !r.stage.closed && !r.stage.lapsed);
  const lapsed = rows.filter((r) => r.stage.lapsed);
  const oldest = open.map((r) => parseStamp(r.inv.created_at)).filter((x) => x !== null).sort((a, b) => a - b)[0];
  const signed = list.filter((inv) => inv?.status === 'signed');
  const signed90 = signed.filter((inv) => within(inv.signed_at, now, 90));
  const spans = signed.map((inv) => [parseStamp(inv.created_at), parseStamp(inv.signed_at)]).filter(([a, b]) => a !== null && b !== null && b >= a).map(([a, b]) => (b - a) / DAY_MS);
  const mid = median(spans);
  return [
    { key: 'open', label: 'Open invitations', state: 'ready', value: nf(open.length), sub: oldest !== undefined ? `oldest first sent ${day(oldest)}` : null, cover },
    { key: 'lapsed', label: 'Lapsed, not closed', state: 'ready', value: nf(lapsed.length), tone: 'amber', sub: 'link expired before signing', cover },
    { key: 'signed90', label: 'Signed, last 90 days', state: 'ready', value: nf(signed90.length), cover },
    mid === null
      ? { key: 'median', label: 'Days from first send to signed', state: 'ready', value: 'None signed yet', words: true, cover }
      : { key: 'median', label: 'Days from first send to signed', state: 'ready', value: nf(Math.round(mid)), sub: `median, over the last ${nf(spans.length)} signed`, cover },
  ];
}

/** Tile row 2: deals from R2 under Guard L, redemptions under Guard F, and the email tile as "Not read here yet". */
export function dealTiles({ deals, invitations, fan, now = Date.now() }) {
  const tiles = [];
  const active = listOf(deals?.active);
  if (!active) tiles.push({ key: 'active', label: 'Active deals', ...stateOfRead(deals?.active) });
  else {
    const soon = active.filter((d) => { const end = parseStamp(d?.expires_at); return end !== null && end > now && end <= now + ENDING_SOON_DAYS * DAY_MS; }).length;
    const past = active.filter((d) => { const end = parseStamp(d?.expires_at); return end !== null && end <= now; }).length;
    tiles.push({
      key: 'active', label: 'Active deals', state: 'ready', value: capped(active.length, atCap(active, CAPS.deals)),
      sub: `${nf(soon)} end within 30 days`, subTone: soon > 0 ? 'amber' : null,
      extra: past ? (past === 1 ? '1 is past its end, not yet closed' : `${nf(past)} are past their end, not yet closed`) : null,
      cover: atCap(active, CAPS.deals) ? `${WITHIN_DEALS}.` : null,
    });
  }
  const awaiting = listOf(deals?.awaiting_signature);
  if (!awaiting) tiles.push({ key: 'awaiting', label: 'Awaiting signature', ...stateOfRead(deals?.awaiting_signature) });
  else {
    const inv = listOf(invitations);
    let sub = null;
    // A deal whose invitation is outside R1's newest 200, or past a refresh that failed, cannot be checked for a lapse (Guard L): it is counted and said, never dropped.
    let unseen = 0;
    if (!inv && !isLoading(invitations)) sub = 'Lapsed invitations could not be checked';
    else if (inv) {
      let lapsed = 0;
      for (const d of awaiting) {
        const via = invitationForDeal(d, invitations);
        if (via.state === 'ready' && isLapsed(via.inv, now)) lapsed += 1;
        else if (via.state === 'missing' || via.state === 'unreadable' || via.state === 'loading') unseen += 1;
      }
      if (lapsed) sub = `${capped(lapsed, unseen > 0)} whose invitation has lapsed`;
    }
    const cover = [atCap(awaiting, CAPS.deals) ? `${WITHIN_DEALS}.` : null, unseen ? `${nf(unseen)} whose invitation is not in this read.` : null].filter(Boolean).join(' ') || null;
    tiles.push({ key: 'awaiting', label: 'Awaiting signature', state: 'ready', value: capped(awaiting.length, atCap(awaiting, CAPS.deals)), sub, subTone: sub && sub.endsWith('lapsed') ? 'amber' : null, cover });
  }
  const r90 = fanFigure(fan, countLast90(now));
  tiles.push({ key: 'redemptions90', label: 'Referral redemptions, 90 days', ...r90 });
  tiles.push({ key: 'emails', label: 'Emails not delivered', state: 'note', note: { text: NOT_READ_YET, reason: 'Whether each invitation email went out is kept only in the audit log, which no read here returns yet.' } });
  return tiles;
}

/** The first-use state (PI9b), drawn only when R1 succeeded and holds no invitation at all. */
export const EMPTY_TITLE = 'No partner invitations yet.';
export const EMPTY_LINE = 'Invite an operating partner to start. They answer a short profile, choose an offer, and sign.';
export const isFirstUse = (invitations) => { const list = listOf(invitations); return Boolean(list) && list.length === 0 && !isStale(invitations); };

export const NEEDS_YOU_SHOWN = 7;

/**
 * Needs you (PI1). Only the rows whose data exists are drawn: lapsed
 * invitations, invitations at Offer chosen while the agreement cannot be sent
 * yet, deals ending within 30 days, unattached partner accounts, and
 * rev-share windows closing within 30 days. A source that could not be read
 * is listed as such, never as "nothing needs you". A source at its cap says
 * what it covered (`cover`, Guard L): R1 drops its oldest rows first, which
 * are the ones most likely lapsed, and R2 `active` drops the deals that end
 * first. The undelivered-email and due-diligence rows wait for parts 1 and 5.
 */
export const NEEDS_COVER_INVITATIONS = `Lapsed invitations and chosen offers are checked ${lower(WITHIN_INVITATIONS)}.`;
export const NEEDS_COVER_ACTIVE = 'Deals ending are checked over the newest 200 active deals.';

export function needsYou({ invitations, deals, links, template, fan, now = Date.now() }) {
  const rows = [];
  const failed = [];
  const cover = [];
  let loading = false;
  const proposed = deals?.proposed;
  const inv = listOf(invitations);
  const ready = agreementReady(template);
  if (inv) {
    if (atCap(inv, CAPS.invitations)) cover.push({ key: 'invitations', text: NEEDS_COVER_INVITATIONS });
    const staged = inv.map((i) => ({ inv: i, stage: stageOf(i, { proposed, now }) }));
    for (const { inv: i, stage } of staged.filter((s) => s.stage.lapsed)) {
      let text = `The invitation to ${whoOf(i)} lapsed on ${dayOr(i.expires_at)} at ${stage.stageWord}.`;
      if (stage.resent !== null) text += ` Resent ${day(stage.resent)}.`;
      if (stage.mayLag) text += ` ${LAG_WORD}.`;
      rows.push({ key: `lapsed-${i.id}`, kind: 'Lapsed', text, action: { label: 'Resend', resend: i } });
    }
    if (ready.state === 'not_ready') {
      for (const { inv: i } of staged.filter((s) => !s.stage.lapsed && !s.stage.closed && s.stage.step === 5)) {
        rows.push({ key: `agreement-${i.id}`, kind: 'Agreement', text: `${whoOf(i)} chose an offer, but the agreement cannot be sent yet: the Partner Services agreement is not ready.`, action: { label: 'Open in Contracts', to: CONTRACTS_TEMPLATES_PATH } });
      }
    } else if (ready.state === 'loading') loading = true;
  } else if (isLoading(invitations)) loading = true;
  else failed.push({ key: 'invitations', what: 'The invitations' });

  const active = listOf(deals?.active);
  if (active) {
    if (atCap(active, CAPS.deals)) cover.push({ key: 'active', text: NEEDS_COVER_ACTIVE });
    const soon = active
      .map((d) => ({ d, end: parseStamp(d?.expires_at) }))
      .filter(({ end }) => end !== null && end > now && end <= now + ENDING_SOON_DAYS * DAY_MS)
      .sort((a, b) => a.end - b.end);
    for (const { d, end } of soon) {
      rows.push({ key: `ending-${d.id}`, kind: 'Term ending', dealId: d.id, text: `The ${typeInSentence(d.deal_type)} with ${dealPartner(d, invitations).name} ends on ${day(end)}.`, action: { label: 'Open deal', to: dealHref(d.id) } });
    }
  } else if (isLoading(deals?.active)) loading = true;
  else failed.push({ key: 'active', what: 'The active deals' });

  const l = dataOf(links);
  if (l && Array.isArray(l.accounts)) {
    const n = l.accounts.filter((a) => a?.partner_id === null || a?.partner_id === undefined).length;
    if (n > 0) {
      const text = atCap(l.accounts, CAPS.links)
        ? `${plural(n, 'partner account', 'partner accounts')} of the first 500 ${n === 1 ? 'is' : 'are'} not attached to a firm.`
        : `${plural(n, 'partner account is', 'partner accounts are')} not attached to a firm.`;
      rows.push({ key: 'firms', kind: 'Firms', text, action: { label: 'Open firm links', to: FIRM_LINKS_PATH } });
    }
  } else if (isLoading(links)) loading = true;
  else failed.push({ key: 'links', what: 'The partner accounts' });

  const closing = fanFigure(fan, countClosing30);
  if (closing.state === 'ready') {
    if (closing.n > 0) rows.push({ key: 'revshare', kind: 'Rev-share', text: `${closing.value} rev-share ${closing.n === 1 ? 'window closes' : 'windows close'} within 30 days.`, action: { label: 'Open Referrals', to: REFERRALS_PATH } });
  } else if (closing.state === 'loading') loading = true;
  else failed.push({ key: 'revshare', what: 'Rev-share windows', reason: closing.reason });

  return { rows, failed, cover, settled: !loading };
}

/* ------------------------------------------------------------------ *
 * The tab strip's counts (D923 §1): exact, or saying what they cover
 * ------------------------------------------------------------------ */

export function tabCounts({ invitations, deals, contracts, needs }) {
  const list = listOf(invitations);
  const all = allTimeRedemptions(contracts, deals);
  let overview = null;
  if (needs?.settled) {
    const covered = Boolean(needs.cover?.length);
    const notes = [needs.failed.length ? 'some sources could not be read' : null, covered ? 'some lists stop at their cap' : null].filter(Boolean);
    overview = { text: capped(needs.rows.length, covered), amber: needs.rows.length > 0, title: notes.length ? `Rows drawn in Needs you; ${notes.join('; ')}` : 'Rows in Needs you' };
  }
  const referralsTitle = all.exact === false ? `Redemptions, all time · ${WITHIN_DEALS}` : 'Redemptions, all time';
  return {
    overview,
    invitations: list ? { text: capped(list.length, atCap(list, CAPS.invitations)), title: atCap(list, CAPS.invitations) ? `${WITHIN_INVITATIONS}; there may be more` : 'Every invitation' } : null,
    deals: dealsCount(contracts, deals),
    referrals: all.state === 'ready' ? { text: all.value, title: all.paused ? `${referralsTitle}. ${CONTRACTS_PAUSED}` : referralsTitle } : null,
  };
}

/* ------------------------------------------------------------------ *
 * One invitation (PI3)
 * ------------------------------------------------------------------ */

/**
 * A record is found in the loaded lists (or one this page read for its
 * address). One outside them is "Not in this read" (D923 §1), with its reason:
 * `missing` when the list stopped at its cap, so the record may lie past it;
 * `none` when the list is complete, or the address is no record id at all, so
 * no invitation has it. A list whose refresh failed is `unreadable`, never
 * either claim.
 *
 * `extra` holds the rows read for one address, each as a read (`useRead`'s
 * shape). A copy from a read that answered beats one whose refresh failed;
 * a record drawn from a failed refresh is `stale`, and says so (D923 §2).
 */
export function findInvitation(id, invitations, extra = null) {
  if (!isRecordId(id)) return { state: 'none' };
  const list = listOf(invitations);
  const adopted = extra?.get?.(String(id)) || null;
  const hits = [[list?.find((i) => String(i?.id) === String(id)), invitations], [dataOf(adopted), adopted]].filter(([row]) => row);
  const [hit, from] = hits.find(([, read]) => !isStale(read)) || hits[0] || [];
  if (hit) return { state: 'ready', inv: hit, stale: isStale(from) };
  if (isLoading(invitations) || invitations?.refreshing) return { state: 'loading' };
  if (invitations?.status === 'error') return { state: 'unreadable' };
  return { state: atCap(list, CAPS.invitations) ? 'missing' : 'none' };
}

export const MISSING_INVITATION = 'This invitation is not among the newest 200 read. The Worker has no single-invitation read until part 4.';
export const MISSING_DEAL = 'This deal is not in the deal lists read. The Worker has no single-deal read until part 5.';
export const NO_INVITATION = 'No invitation in the list has this address.';
export const NO_DEAL = 'No deal in the lists has this address.';

/**
 * The deal an invitation led to, in any of the six lists, by `invitation_id`
 * or `resulting_deal_id`; a live deal before a voided one. While a list is
 * read again a deal can be between two of them (a revoke moves it from
 * `proposed` to `voided`), so the answer waits for every list.
 */
export function dealForInvitation(inv, deals) {
  const u = dealsUnion(deals);
  const mine = u.rows.filter((d) => String(d?.invitation_id) === String(inv?.id) || (inv?.resulting_deal_id != null && String(d?.id) === String(inv.resulting_deal_id)));
  const hit = mine.find((d) => d.status !== 'voided') || mine[0];
  if (hit) return { state: 'ready', deal: hit };
  if (u.loading.length || u.refreshing.length) return { state: 'loading' };
  if (u.failed.length || u.stale.length) return { state: 'unreadable' };
  if (u.capped.length) return { state: 'missing' };
  return { state: 'none' };
}

const ENVELOPE_OUT = new Set(['sent', 'partially_signed']);
const ENVELOPE_VOID = new Set(['void', 'voided', 'rejected', 'declined']);

/**
 * R7's signing link: while the envelope is out, live until its recipient's
 * `token_expires_at`, then expired. A signed, voided or other envelope has no
 * open link, whatever its recipients' dates say.
 */
export function signingLink(envelope, now) {
  if (isLoading(envelope)) return { state: 'loading' };
  if (isFailed(envelope)) return { state: isCoolOff(envelope.error) ? 'paused' : 'unreadable' };
  const status = dataOf(envelope)?.status;
  if (status === 'completed') return { state: 'signed' };
  if (ENVELOPE_VOID.has(status)) return { state: 'voided' };
  if (!ENVELOPE_OUT.has(status)) return { state: 'other' };
  const recipients = Array.isArray(dataOf(envelope)?.recipients) ? dataOf(envelope).recipients : [];
  const open = recipients.find((r) => r?.status !== 'signed') || recipients[0];
  const until = parseStamp(open?.token_expires_at);
  if (until === null) return { state: 'none' };
  return until > now ? { state: 'live', day: day(until) } : { state: 'expired', day: day(until) };
}

const failedText = (read) => (isCoolOff(read?.error) ? PAUSED : COULD_NOT_READ);

/** The progress list (PI3): the record's own dates, R2's first choice and R7's envelope. */
export function progressRows(inv, stage, dealHit, envelope) {
  const sent = dayOr(inv?.created_at);
  let chosen;
  if (dealHit.state === 'ready') chosen = day(dealHit.deal.created_at) ? `First chosen ${day(dealHit.deal.created_at)}` : NOT_RECORDED;
  else if (dealHit.state === 'loading') chosen = READING;
  else if (dealHit.state === 'unreadable') chosen = COULD_NOT_READ;
  else if (dealHit.state === 'missing') chosen = stage.closed || (stage.step !== null && stage.step >= 5) ? NOT_IN_READ : NOT_REACHED;
  else chosen = stage.step !== null && stage.step >= 5 ? NOT_RECORDED : NOT_REACHED;
  let out;
  if (!inv?.envelope_id) out = NOT_REACHED;
  else if (isLoading(envelope)) out = READING;
  else if (isFailed(envelope)) out = failedText(envelope);
  else out = dayOr(dataOf(envelope)?.created_at);
  return [
    { key: 'sent', label: 'Sent', value: stage.resent !== null ? `${sent} · resent ${day(stage.resent)}` : sent },
    { key: 'opened', label: 'Opened', value: day(inv?.viewed_at) || 'Not opened' },
    { key: 'profiled', label: 'Profile done', value: NOT_READ_YET, unread: true },
    { key: 'offers', label: 'Offers shown', value: NOT_READ_YET, unread: true },
    { key: 'chosen', label: 'Offer chosen', value: chosen },
    { key: 'agreement', label: 'Agreement out', value: out },
    { key: 'signed', label: 'Signed', value: day(inv?.signed_at) || NOT_REACHED },
  ];
}

/** The link's own line under Progress: valid until, lapsed on, or closed. */
export function linkLine(inv, stage) {
  if (stage.closed) return { text: 'Closed' };
  if (stage.lapsed) return { text: `Lapsed on ${dayOr(inv?.expires_at)}`, tone: 'amber', warn: stage.step === 6 ? AGREEMENT_LAPSE_WARNING : null };
  return { text: `Link valid until ${dayOr(inv?.expires_at)}` };
}

/** The agreement, in the record's words: Not sent, Out for signature since [date], Signed [date] or Voided. */
export function agreementLine(inv, envelope) {
  if (!inv?.envelope_id) return { text: 'Not sent' };
  if (isLoading(envelope)) return { text: READING };
  if (isFailed(envelope)) return { text: failedText(envelope), failed: true };
  const env = dataOf(envelope);
  if (env?.status === 'completed') return { text: `Signed ${dayOr(env.completed_at || inv?.signed_at)}` };
  if (ENVELOPE_VOID.has(env?.status)) return { text: 'Voided' };
  if (ENVELOPE_OUT.has(env?.status)) return { text: `Out for signature since ${dayOr(env.created_at)}` };
  return { text: 'Another state' };
}

/** The stored proposal's label and summary: the Worker's words, which are what the invitee chose (O-OFFER). */
export function proposalOf(deal) {
  const p = deal?.proposal;
  if (!p || typeof p !== 'object' || !Object.keys(p).length) return null;
  const terms = p.terms && typeof p.terms === 'object' && !Array.isArray(p.terms)
    ? Object.entries(p.terms).map(([k, v]) => ({ key: k, label: titleCase(k), value: String(v) }))
    : [];
  return { label: String(p.label || '').trim() || dealTypeWord(deal.deal_type), summary: String(p.summary || '').trim() || null, terms };
}

/** Their answers (R12), read only when the admin asks: each read is logged. */
export const ANSWERS_LOGGED = 'Reading their answers is logged in the admin activity log, with your name.';
export const ANSWER_FACTS = [
  ['full_name', 'Name'], ['organization', 'Organisation'], ['role_title', 'Role'], ['expertise', 'Expertise'], ['sectors', 'Sectors'],
  ['geography', 'Geography'], ['capacity_per_month', 'Time each month'], ['capital_capacity_usd', 'Capital they could commit'], ['motivation', 'Why they want in'], ['prior_deals', 'Prior deals'],
];
const PROFILE_CHECK = { pending: 'Waiting', verified: 'Verified', rejected: 'Rejected' };

export function answersOf(read, inv) {
  if (!read) return { state: 'idle' };
  if (isLoading(read)) return { state: 'loading' };
  if (isFailed(read)) {
    if (Number(read.error?.status) === 404) return { state: 'none', text: 'No answers yet' };
    return { state: 'unreadable' };
  }
  const p = dataOf(read);
  if (String(p?.invitation_id ?? '') !== String(inv?.id)) return { state: 'other', text: 'No answers for this invitation' };
  const money = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? `$${Number(v).toLocaleString('en-US')}` : null);
  return {
    state: 'ready',
    facts: ANSWER_FACTS.map(([key, label]) => {
      const raw = key === 'capital_capacity_usd' ? money(p?.[key]) : String(p?.[key] ?? '').trim() || null;
      return { key, label, value: raw || 'Not answered' };
    }),
    check: PROFILE_CHECK[p?.admin_status] || (p?.admin_status ? 'Another state' : NOT_RECORDED),
  };
}

/* ------------------------------------------------------------------ *
 * One deal (PI6)
 * ------------------------------------------------------------------ */

/**
 * One deal, from the six lists (`findInvitation`'s states). A write moves a
 * deal between lists, which are read again one by one: until every list has
 * answered the deal may be in neither copy, so that reads as loading, and a
 * list whose refresh failed as unreadable, never "not in this read".
 */
export function findDeal(id, deals) {
  if (!isRecordId(id)) return { state: 'none' };
  const u = dealsUnion(deals);
  const hit = u.rows.find((d) => String(d?.id) === String(id));
  if (hit) return { state: 'ready', deal: hit };
  if (u.loading.length || u.refreshing.length) return { state: 'loading' };
  if (u.failed.length || u.stale.length) return { state: 'unreadable' };
  return { state: u.capped.length ? 'missing' : 'none' };
}

/** The deal's agreement (PI6): "Signed [date]", "Out for signature since [date]" from R7, or "Not sent". */
export function dealAgreementLine(deal, envelope) {
  if (deal?.activated_at && (deal.status === 'active' || ENDED_DEAL.has(deal.status))) return { text: `Signed ${dayOr(deal.activated_at)}` };
  if (!deal?.envelope_id) return { text: deal?.status === 'voided' ? 'Voided' : 'Not sent' };
  if (isLoading(envelope)) return { text: READING };
  if (isFailed(envelope)) return { text: failedText(envelope), failed: true };
  const env = dataOf(envelope);
  if (deal.status === 'awaiting_signature' && env?.status === 'completed') return { text: 'Signed, deal not activated', tone: 'amber' };
  if (ENVELOPE_VOID.has(env?.status) || deal.status === 'voided') return { text: 'Voided' };
  if (ENVELOPE_OUT.has(env?.status)) return { text: `Out for signature since ${dayOr(env.created_at)}` };
  if (env?.status === 'completed') return { text: `Signed ${dayOr(env.completed_at)}` };
  return { text: 'Another state' };
}

/** `tos_v1` and `privacy_v1` are seeded for every partner at activation (`services/trust.ts`), so they are named too. */
const OBLIGATION_WORD = {
  tos_v1: 'Terms of service', privacy_v1: 'Privacy', partner_msa_v1: 'Partner agreement', kyb_v1: 'KYB', kyc_v1: 'KYC', accreditation_v1: 'Accreditation',
};
const obligationWord = (k) => OBLIGATION_WORD[k] || titleCase(String(k || '').replace(/_v\d+$/, ''));

/** Obligations (R10): "Outstanding: [keys]"; with none required, "No obligations recorded", never "None outstanding". */
export function obligationsLine(read, userId) {
  if (userId === null || userId === undefined) return { text: 'None before signing: obligations are opened when the deal is signed' };
  if (isLoading(read)) return { text: READING };
  if (isFailed(read)) return { text: COULD_NOT_READ, failed: true };
  const s = (Array.isArray(dataOf(read)?.scores) ? dataOf(read).scores : []).find((x) => String(x?.user_id) === String(userId));
  if (!s || !Array.isArray(s.missing) || !Number.isFinite(Number(s.required_total))) return { text: COULD_NOT_READ, failed: true };
  if (Number(s.required_total) === 0) return { text: 'No obligations recorded' };
  if (!s.missing.length) return { text: `Outstanding: none of the ${plural(Number(s.required_total), 'required obligation', 'required obligations')}` };
  return { text: `Outstanding: ${s.missing.map(obligationWord).join(', ')}` };
}

/** The last ten redeemers on one deal (R4). The count comes from the row, never from R4. */
export function lastRedeemers(read, deal, size = 10) {
  if (isLoading(read)) return { state: 'loading' };
  if (isFailed(read)) return { state: 'unreadable' };
  const items = Array.isArray(dataOf(read)?.items) ? dataOf(read).items : [];
  const revshare = isRevshareDeal(deal);
  return {
    state: 'ready',
    rows: items.slice(0, size).map((it) => {
      const w = windowOf({ ...it, deal });
      return {
        key: it.id,
        name: String(it.redeemer_name || '').trim() || String(it.redeemer_email || '').trim() || NOT_RECORDED,
        line: `${dayOr(it.redeemed_at)} · ${tiersText(it.granted_tier_founder, it.granted_tier_investor)}`,
        right: revshare ? w.text : (ENDED_DEAL.has(deal?.status) ? 'Ended with the deal' : `Granted until ${dayOr(it.granted_until)}`),
      };
    }),
    firstOnly: items.length >= CAPS.redemptions && Number(deal?.redemptions_count) > items.length,
  };
}

/* ------------------------------------------------------------------ *
 * The dialogs say only what the Worker does (D923 §3)
 * ------------------------------------------------------------------ */

/**
 * Whether resend renews the agreement's signing link (D924): it does while the
 * envelope is out and the invitee's own recipient row is still pending, and
 * then it emails that link; otherwise it sends the onboarding email.
 */
function signaturePending(inv, envelope) {
  const env = dataOf(envelope);
  if (!ENVELOPE_OUT.has(env?.status)) return false;
  const email = String(inv?.recipient_email || '').trim().toLowerCase();
  return (Array.isArray(env?.recipients) ? env.recipients : [])
    .some((r) => r?.status === 'pending' && String(r?.recipient_email || '').trim().toLowerCase() === email);
}

const ONBOARDING_INSTEAD = 'so no signing link is renewed. Resending sends the onboarding email instead.';

/**
 * PI8a. Line one is the renewed link; line two depends on the stage. Resend
 * keeps the stored stage at every step (D924). At Agreement out the line says
 * what the Worker does, read from R7 as the dialog opens; it is not a claim
 * about the write, which `resentResult` reads from the reply alone.
 */
export function resendCopy(inv, stage, envelope, now) {
  const who = whoOf(inv);
  const until = day(now + INVITE_TTL_DAYS * DAY_MS);
  const lines = [`The link gets a new 14 days, until ${until}.`];
  if (stage.step === 5) lines.push(`${who}’s chosen offer is kept.`);
  else if (stage.step === 3 || stage.step === 4) lines.push(`Their answers are kept. The stage stays at ${stage.stageWord}.`);
  else if (stage.step === 6) {
    const link = inv?.envelope_id ? signingLink(envelope, now) : { state: 'no_envelope' };
    if (['live', 'expired', 'none'].includes(link.state) && signaturePending(inv, envelope)) {
      lines.push(`The agreement’s signing link is renewed too, until ${until}, and the email carries it.`);
    } else if (link.state === 'signed') lines.push(`The agreement already sent is signed, ${ONBOARDING_INSTEAD}`);
    else if (link.state === 'voided') lines.push(`The agreement already sent was voided, ${ONBOARDING_INSTEAD}`);
    else if (link.state === 'loading') lines.push('Reading whether the agreement is still out for signature…');
    else if (link.state === 'paused') lines.push(`${pausedLine('The agreement’s envelope')} Until then, whether its signing link is renewed too is not shown.`);
    else if (link.state === 'unreadable') lines.push('The agreement’s envelope could not be read, so whether its signing link is renewed too is not known.');
    else lines.push(`No signature from ${who} is pending on the agreement, ${ONBOARDING_INSTEAD}`);
  }
  return { title: `Resend the invitation to ${who}?`, lines };
}

export const RESENT_SENT = 'Sent.';
export const RESENT_NOT_SENT = 'Not sent. Copy the link instead.';

/**
 * The resend result, from the reply alone. The Worker's reply is `{ ok,
 * email_sent, link, expires_at }` whether it renewed the agreement's signing
 * link or sent the onboarding email instead (the envelope can change while
 * the dialog is open), so the result says nothing about a renewal. When no
 * email went, the reply's `link` (the invitation's own) is offered to copy.
 * #2723 (part 4) adds a `signing_link` answer to this reply; part 7 (#2726)
 * reads it.
 */
export function resentResult(reply) {
  return reply?.email_sent === true ? { text: RESENT_SENT, sent: true } : { text: RESENT_NOT_SENT, sent: false, copy: true };
}

/**
 * PI8b. The long variant when there is an `envelope_id` or a deal row; also
 * when R2's `proposed` or `awaiting_signature` list failed, could not refresh
 * (or is being read again after that), is loading or is at its cap, because a
 * deal row may then be out of sight: the long one when unsure.
 */
export function revokeVariant(inv, deals) {
  if (inv?.envelope_id) return 'long';
  const u = dealsUnion(deals, ['proposed', 'awaiting_signature']);
  if (u.rows.some((d) => String(d?.invitation_id) === String(inv?.id))) return 'long';
  if (u.failed.length || u.stale.length || u.retrying.length || u.capped.length || u.loading.length) return 'long';
  return 'short';
}

export function revokeCopy(inv, variant) {
  return {
    title: `Revoke ${whoOf(inv)}’s invitation?`,
    body: variant === 'short'
      ? 'The link stops working. This cannot be undone.'
      : 'The link stops working. The chosen offer, and any agreement out for signature, are voided. This cannot be undone.',
  };
}

/** D925's `failures`: the steps of a write's cascade that did not complete. Only their `step` is read; no exception text is ever printed. */
const failuresOf = (reply) => (Array.isArray(reply?.failures) ? reply.failures : []);
/** `void_envelope`: the envelope's own update failed, so that agreement is not voided. */
export const REVOKE_PARTIAL = 'Some agreements could not be voided. Check them in Contracts.';
/** `decline_recipients` runs only after the envelope was voided: the agreement is voided, its signers' rows are not all declined. */
export const REVOKE_UNDECLINED = 'An agreement was voided, but its signers were not all marked declined. Check it in Contracts.';
export const REVOKE_UNDECLINED_MANY = 'Some agreements were voided, but their signers were not all marked declined. Check them in Contracts.';
/** `revoke_cascade`: the voiding could not run or be finished, whether or not there was an offer or an agreement to void. */
export const REVOKE_CASCADE_FAILED = 'Any chosen offer or agreement out for signature could not be voided. Check them in Contracts.';
/** A step this page does not know yet. */
export const REVOKE_OTHER = 'Some of the voiding did not complete. Check the agreements in Contracts.';

/**
 * The revoke result. The voided counts show only when above zero: a zero is
 * never read as "nothing was voided". Each cascade step that failed (D925) is
 * said beside the counts, for what that step means.
 */
export function revokedLine(reply) {
  const parts = ['Invitation revoked.'];
  const deals = Number(reply?.voided_deals);
  const envelopes = Number(reply?.voided_envelopes);
  if (deals > 0) parts.push(`${plural(deals, 'deal', 'deals')} voided.`);
  if (envelopes > 0) parts.push(`${plural(envelopes, 'agreement', 'agreements')} voided.`);
  const steps = failuresOf(reply).map((f) => f?.step);
  const undeclined = steps.filter((s) => s === 'decline_recipients').length;
  if (steps.includes('void_envelope')) parts.push(REVOKE_PARTIAL);
  if (undeclined) parts.push(undeclined === 1 ? REVOKE_UNDECLINED : REVOKE_UNDECLINED_MANY);
  if (steps.includes('revoke_cascade')) parts.push(REVOKE_CASCADE_FAILED);
  if (steps.some((s) => !['void_envelope', 'decline_recipients', 'revoke_cascade'].includes(s))) parts.push(REVOKE_OTHER);
  return parts.join(' ');
}

export const REASON_MAX = 500;
export const TERMINATED = 'Deal terminated.';
export const TERMINATE_PARTIAL = 'Some tier changes did not complete, so the partner or a member may still hold this deal’s grant.';

/**
 * The terminate result (D925's reply). `members_revoked` counts the distinct
 * members whose tiers changed, so it is said as members' tiers, above zero
 * only; the pre-write count stays the row's `redemptions_count`.
 */
export function terminatedLine(reply) {
  const parts = [TERMINATED];
  const members = Number(reply?.members_revoked);
  if (members > 0) parts.push(`${plural(members, 'member’s', 'members’')} tiers revoked.`);
  if (failuresOf(reply).length) parts.push(TERMINATE_PARTIAL);
  return parts.join(' ');
}

/** A result with a failed step is drawn amber. */
export const partialWrite = (reply) => failuresOf(reply).length > 0;

/** PI8c. The count is the row's `redemptions_count`; the reply's revoked counts are not turned into member counts. */
export function terminateCopy(deal) {
  const who = String(deal?.partner_name || '').trim() || String(deal?.partner_email || '').trim() || `deal #${deal?.id}`;
  const n = Number(deal?.redemptions_count);
  let members;
  if (!Number.isFinite(n)) members = `Members who registered with ${who}’s code and are still on the grant it gave lose it.`;
  else if (n === 0) members = `No member registered with ${who}’s code.`;
  else members = `${plural(n, 'member', 'members')} registered with ${who}’s code. Those still on the grant it gave lose it.`;
  return {
    title: `Terminate the ${typeInSentence(deal?.deal_type)} with ${who}?`,
    lines: [`The tiers this deal granted ${who} end now, where they are still the deal’s grant.`, members, 'This cannot be undone.'],
  };
}

export const terminateReady = (reason) => String(reason || '').trim().length > 0;

/* ------------------------------------------------------------------ *
 * New invitation (PI4, PI4d, PI4n)
 * ------------------------------------------------------------------ */

/** The Worker's own test (`admin_partners.ts`), so the checks run on what it would accept. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isCompleteEmail = (s) => EMAIL_RE.test(String(s || '').trim().toLowerCase());
export const NAME_MAX = 200;
export const MESSAGE_MAX = 2000;
/** O-CAP: at most three types per invitation; the Worker enforces it in part 1. */
export const TYPE_CAP = 3;
export const NEW_TITLE = 'New invitation';
export const NEW_SUB = 'The invitee gets a private link by email.';
export const TYPE_NOTE = 'Pick up to three. The invitee sees one offer per type.';
export const TYPE_FULL = 'Three are picked; clear one to choose this.';
export const TERMS_NOT_READ = 'Terms not read here yet';
export const CAPITAL_NOTE = 'Needs KYC and accreditation after signing.';
export const MESSAGE_HINT = 'Shown in the email and at the start of the onboarding chat.';
export const LINK_FOOT = 'The link is valid for 14 days. Resending gives a new 14 days.';
export const counter = (n, max) => `${nf(n)} / ${nf(max)}`;

export function toggleType(picked, key) {
  if (picked.includes(key)) return picked.filter((k) => k !== key);
  return picked.length >= TYPE_CAP ? picked : [...picked, key];
}

const ROLE_WORD = { admin: 'Admin', founder: 'Founder', partner: 'Operating Partner', investor: 'Investor', advisor: 'Advisor', exploring: 'Explorer' };
const roleWord = (r) => ROLE_WORD[r] || (r ? titleCase(r) : 'role not recorded');

/** O-DUP: an exact, open match in R1 is warned about, not refused. A failed check says it could not check. */
export function duplicateCheck(read, email) {
  if (!read || isLoading(read)) return { state: 'loading' };
  if (read.status === 'error') return { state: 'failed', text: 'Could not check for an open invitation.' };
  const want = String(email || '').trim().toLowerCase();
  const hit = (listOf(read) || []).find((i) => String(i?.recipient_email || '').toLowerCase() === want && !['signed', 'revoked', 'expired'].includes(i?.status));
  return hit ? { state: 'found', inv: hit, text: `An open invitation to this address exists, sent ${dayOr(hit.created_at)}. Open it instead?` } : { state: 'clear' };
}

/** R11, an exact match on the client. "and adds the partner deal" waits for part 2: until then, signing replaces a paid plan. */
export function memberCheck(read, email) {
  if (!read || isLoading(read)) return { state: 'loading' };
  if (read.status === 'error') return { state: 'failed', text: 'Could not check whether this address belongs to a member.' };
  const data = dataOf(read);
  const rows = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
  const want = String(email || '').trim().toLowerCase();
  const hit = rows.find((u) => String(u?.email || '').toLowerCase() === want);
  if (hit) return { state: 'found', text: `This address belongs to a member (${roleWord(hit.role)}). Signing keeps their role.` };
  if (atCap(rows, CAPS.users)) return { state: 'failed', text: 'This address matched more accounts than one read returns, so membership could not be checked.' };
  return { state: 'clear' };
}

export function createdLines(reply, email) {
  return reply?.email_sent === true
    ? { sent: `Invitation sent to ${email}.`, notSent: null }
    : { sent: null, notSent: 'The email was not sent. Copy the link and send it yourself.' };
}

export const COPIED = 'Copied';
/** The failed copy names what was being copied: a link, or a referral code. */
export const copyFailed = (noun = 'link') => `Copy failed. Select the ${noun} and copy it.`;
export const COPY_FAILED = copyFailed('link');

/* ------------------------------------------------------------------ *
 * Firm links (off the canvas; #2369 takes it in part 9)
 * ------------------------------------------------------------------ */

export function firmCounts(data) {
  const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
  const firms = Array.isArray(data?.firms) ? data.firms : [];
  const attached = accounts.filter((a) => a?.partner_id !== null && a?.partner_id !== undefined).length;
  const accountsCapped = atCap(accounts, CAPS.links);
  const firmsCapped = atCap(firms, CAPS.links);
  return {
    text: `${nf(attached)} attached · ${nf(accounts.length - attached)} not · ${firmsCapped ? `${capped(firms.length, true)} firms` : plural(firms.length, 'firm', 'firms')} on record`,
    cover: accountsCapped ? 'Counted over the first 500 partner accounts.' : null,
  };
}

export const FIRM_LINKS_NOTE = 'Most unattached accounts need nothing done here: a partner sign-in with no firm gets one created and linked the next time it loads the app. This is for the account that belongs to a firm already on this list under a different address. That one can only be joined by hand, and the change is recorded in the admin audit log.';

export function firmChangeCopy(account, firm, current) {
  const who = String(account?.name || '').trim() || String(account?.email || '').trim() || 'this account';
  const firmName = (f) => String(f?.company || f?.name || '').trim() || 'its firm';
  return firm
    ? { title: `Attach ${who} to ${firmName(firm)}?`, body: `Every partner page ${who} opens then belongs to ${firmName(firm)}. The change is recorded in the admin audit log.`, action: 'Attach' }
    : { title: `Detach ${who} from ${current ? firmName(current) : 'its firm'}?`, body: `${who} then has no firm until one is attached. The change is recorded in the admin audit log.`, action: 'Detach' };
}

export const firmSavedLine = (reply) => (reply?.partner_id ? `Attached to ${reply.firm_name || 'the firm'}.` : 'Detached from its firm.');

/* ------------------------------------------------------------------ *
 * Refusals: one sentence in place, inside the dialog (D923 §3)
 * ------------------------------------------------------------------ */

export const FROZEN = 'Changes are refused while HQ has paused your admin access. Reading still works.';
export const INVITATION_CLOSED = 'This invitation is already signed or revoked.';
export const DEAL_NOT_ACTIVE = 'This deal is no longer active, so it cannot be terminated.';
export const TRY_AGAIN = 'That did not go through. Try again.';

export function refusalText(err, kind = 'invitation') {
  const status = Number(err?.status);
  const code = err?.code || err?.data?.code || null;
  if (code === 'admin_frozen' || (status === 423 && code !== 'branch_suspended')) return FROZEN;
  if (code === 'branch_suspended') return 'This studio’s licence is suspended, so changes are paused until HQ lifts it.';
  if (status === 409) return kind === 'deal' ? DEAL_NOT_ACTIVE : INVITATION_CLOSED;
  if (status === 404) {
    if (kind === 'deal') return 'This deal no longer exists.';
    if (kind === 'firm') return 'That account or firm no longer exists.';
    return 'This invitation no longer exists.';
  }
  if (status === 400) {
    const msg = String(err?.message || '');
    if (kind === 'create') return /email/i.test(msg) ? 'Enter a valid email address.' : 'Pick at least one deal type.';
    if (kind === 'deal') return 'Type a reason.';
    if (kind === 'firm') return /partner account/i.test(msg) ? 'Only a partner account can be attached to a firm.' : 'That account or firm could not be used.';
  }
  return TRY_AGAIN;
}
