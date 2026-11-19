/**
 * D6863 (#6863, canvas D6053, boards RAC16 to RAC28) — the words and rules of
 * a call's follow-through, as pure functions the page and its tests share:
 * the filter chips and who can be ticked (RAC16, RAC17), the Remind sheet and
 * its result, the Export sheet's Included and Withheld columns and the dated
 * export row (RAC18, RAC19), the copied banner and carried fields of a new
 * call (RAC20, RAC21), and the conflicts a recorded commitment meets (RAC22,
 * RAC23).
 *
 * D7513 (#7513): step 3 of a call started from a closed one, pre-ticked from
 * that call's chosen recipients (RAC20C, RAC20D), and the address of the moved
 * line on Capital relationships › Commitments (RAC22C).
 *
 * AN INDICATED AMOUNT IS NEVER COMMITTED (D653): it is always labelled
 * "Indicated, not committed". A matching investor stays "Matching investor"
 * until they respond. Nothing the read lacks is drawn as zero.
 */
import { formatMinor, parseMinor } from '../../lib/money.js';
import { longDay, shortDay } from './raiseCallModel';

import { NOT_RECORDED } from '../../lib/absence.js';
export { NOT_RECORDED };
export const INDICATED_HEADER = 'Indicated (USD), not committed';
export const OWNER_ONLY_FT = 'Only the venture’s owner can remind or export.';
export const NO_EMAIL = 'The same in-app notice as the send. Nothing about who else was asked, amounts or other responses. No email is sent.';
export const RECORD_WARNING = 'Only record what the investor has signed or wired. Indicated amounts are never counted.';

/** Typed USD text in cents, or null when it cannot be read exactly (never guessed, never 0 for blank). */
export function minorOf(text) {
  const r = parseMinor(String(text ?? ''), 'USD');
  return r && r.ok ? r.minor : null;
}

export const usd = (cents) => (cents == null || !Number.isFinite(Number(cents)) ? NOT_RECORDED : formatMinor(Number(cents), 'USD', { locale: 'en-US', trimWhole: true }));

/* ------------------------------------------------------------- Remind */

export const FT_FILTERS = Object.freeze([
  ['not_opened', 'Not opened'],
  ['opened_unanswered', 'Opened, not answered'],
  ['not_delivered', 'Not delivered'],
  ['all', 'All recipients'],
]);
export const DEFAULT_FILTER = Object.freeze(['not_opened', 'opened_unanswered']);

/** The count a chip shows: measured from the read, never guessed. */
export function chipCount(d, key) {
  const c = d?.counts || {};
  const n = key === 'all' ? c.recipients : c[key];
  return Number.isFinite(n) ? n : null;
}

/** Toggle one chip; All clears the others and shows everyone. */
export function toggleFilter(active, key) {
  if (key === 'all') return active.includes('all') ? [...DEFAULT_FILTER] : ['all'];
  const set = new Set(active.filter((k) => k !== 'all'));
  if (set.has(key)) set.delete(key); else set.add(key);
  return set.size ? FT_FILTERS.map(([k]) => k).filter((k) => set.has(k)) : ['all'];
}

export function visibleRecipients(d, active) {
  const all = d?.recipients || [];
  if (active.includes('all')) return all;
  return all.filter((r) => active.includes(r.group));
}

export function recipientLabel(r) {
  if (r.named && r.name) return r.name;
  return `Matching investor${r.reasons?.[0] ? ` · ${r.reasons[0]}` : ''}`;
}
export const originLabel = (r) => (r.origin === 'chosen' ? 'Chosen' : r.named ? 'Matching · responded' : 'Matching · not named until they respond');

export const selectable = (r) => !r.block;

/** Why a row's checkbox is off, in words (never by colour alone). */
export function blockLine(r) {
  switch (r.block) {
    case 'limit': return 'Reminded twice · limit reached';
    case 'too_soon': return r.next_reminder_from ? `Next reminder from ${shortDay(r.next_reminder_from)}` : 'Too soon to remind again';
    case 'responded': return 'Responded';
    case 'account_unavailable': return 'Account not active';
    default: return null;
  }
}
export const blockGlyph = (r) => (r.block === 'limit' ? '⦸' : r.block === 'too_soon' ? '◷' : r.block ? '⦸' : '');

export function lastRemindedLabel(r, limit = 2) {
  if (!r.last_reminded_at) return 'Never';
  return `${shortDay(r.last_reminded_at) || NOT_RECORDED} · ${r.reminder_count} of ${limit}`;
}

/** The Remind sheet's "Who" lines, from the ticked rows. */
export function remindWho(d, selectedIds) {
  const chosen = (d?.recipients || []).filter((r) => selectedIds.includes(r.recipient_id));
  const line = (group, label) => {
    const rows = chosen.filter((r) => r.group === group);
    if (!rows.length) return null;
    const unnamed = rows.filter((r) => !r.named).length;
    return { label, count: rows.length, named: rows.length - unnamed, unnamed };
  };
  return [line('opened_unanswered', 'Opened, not answered'), line('not_opened', 'Not opened'), line('not_delivered', 'Not delivered')].filter(Boolean);
}
export const whoText = (w) => `${w.count} · ${w.named} named${w.unnamed ? `, ${w.unnamed} matching investor${w.unnamed === 1 ? '' : 's'} (not named)` : ''}`;

/** Who reaches the limit with this reminder: the sheet names them before Remind. */
export function reachingLimit(d, selectedIds, limit = 2) {
  return (d?.recipients || []).filter((r) => selectedIds.includes(r.recipient_id) && r.reminder_count === limit - 1).map(recipientLabel);
}

const REASONS = {
  responded: 'already responded',
  limit: 'reminded twice · limit reached',
  too_soon: 'too soon to remind again',
  account_unavailable: 'Not delivered · account not active',
  not_delivered: 'Not delivered',
  call_changed: 'the call changed',
};
/** RAC17's result line and its "not reminded" sentences. */
export function remindResult(res) {
  if (!res) return null;
  const nameOf = (x) => x.name || 'A matching investor';
  const head = `${res.reminded} of ${res.asked} ${res.asked === 1 ? 'was' : 'were'} reminded on Axal.`;
  const rest = (res.not_reminded || []).map((x) => `${nameOf(x)} was not reminded: ${REASONS[x.reason] || x.reason}.`);
  return { head, rest, tone: res.reminded === res.asked ? 'ok' : 'partial' };
}

/** Everyone answered: measured zeros, never missing data. */
export function nothingToRemind(d) {
  const c = d?.counts;
  return !!c && c.recipients > 0 && c.not_opened === 0 && c.opened_unanswered === 0 && c.not_delivered === 0;
}

/* ------------------------------------------------------------- Export */

export function exportIncluded(d) {
  const rs = d?.recipients || [];
  const named = rs.filter((r) => r.named);
  const responded = named.filter((r) => r.responded_at);
  const indicated = named.reduce((s, r) => s + (r.commitment_cents || 0), 0);
  return [
    'Call name, terms and the counsel approval date',
    `Each named recipient: opened, data room and responded dates (${named.length} named · ${responded.length} responded)`,
    `Indicated amounts, each marked “Indicated, not committed” · ${usd(indicated)} in total`,
    'Questions, counted with how many are answered',
    'The export date and who made it',
  ];
}
export function exportWithheld(d) {
  const unnamed = (d?.recipients || []).filter((r) => !r.named).length;
  return [`${unnamed} matching investor${unnamed === 1 ? '' : 's'}, not named (counted only)`, 'Investor emails', 'Eadwyn’s notes and proposals'];
}
export const hasResponses = (d) => (d?.counts?.responded || 0) > 0;

/** RAC18B's dated export row. */
export function exportRow(e, callName) {
  return {
    file: `${callName} · ${e.scope === 'terms' ? 'terms' : 'responses'} · ${longDay(e.exported_at) || NOT_RECORDED}`,
    format: e.format === 'pdf' ? 'PDF · for counsel' : 'CSV · for the cap table',
    by: e.exported_by_name ? `${e.exported_by_name}${e.exported_by_you ? ' (you)' : ''}` : NOT_RECORDED,
    when: e.exported_at ? `${shortDay(e.exported_at)} ${String(e.exported_at).slice(11, 16)}` : NOT_RECORDED,
    marked: e.questions_state === 'unreadable' ? { tone: 'partial', text: 'Questions could not be read' } : e.scope === 'terms' ? { tone: 'ok', text: 'Terms only' } : { tone: 'ok', text: 'Complete' },
  };
}

/* ------------------------------------------------------ A new call (RAC20) */

export const CARRIED_FIELDS = Object.freeze([
  ['amount_cents', 'Amount'], ['instrument', 'Instrument'], ['minimum_cheque_cents', 'Minimum cheque'],
  ['valuation_cap_cents', 'Valuation cap'], ['discount_bps', 'Discount'], ['pre_money_cents', 'Pre-money'],
  ['terms', 'Plain terms'], ['data_room_project_uid', 'Data room'],
]);
export const NOT_CARRIED_LINES = Object.freeze([
  'Close date: re-enter it.',
  'Counsel approval: a new call always needs counsel again.',
  'Deck version: choose the deck in the next step; the closed call’s version is not reused.',
  'Matching investors: re-matched when you preview the audience, never copied.',
]);

export function copiedBanner(call) {
  const closed = shortDay(call?.closed_at);
  return `Copied from ${call?.name || 'the closed call'}${closed ? `, closed ${closed}` : ''}. Edit anything below. Nothing is sent; this is a draft.`;
}

/** The step 1 form, seeded from the closed call. The name and close date are the founder's to enter. */
export function successorSeed(call) {
  return {
    name: '', target_close: '',
    amount: centsText(call?.amount_cents), minimum: centsText(call?.minimum_cheque_cents),
    terms: call?.terms || '', instrument: call?.instrument || 'safe',
  };
}
function centsText(cents) {
  if (cents == null) return '';
  return formatMinor(Number(cents), 'USD', { locale: 'en-US', trimWhole: true }).replace(/[^0-9.]/g, '');
}

/** The body for `startFromClosed`, or the first problem with the form. */
export function successorBody(form, call, today) {
  const name = String(form.name || '').trim();
  if (!name) return { error: 'Give the new call a name.' };
  if (name === String(call?.name || '').trim()) return { error: 'Give the new call its own name.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.target_close || '') || form.target_close < today) return { error: 'Choose a close date, today or later.' };
  const amount = minorOf(form.amount);
  const minimum = minorOf(form.minimum);
  if (amount == null || amount <= 0) return { error: 'Type the amount in USD.' };
  if (minimum == null || minimum <= 0 || minimum > amount) return { error: 'The minimum cheque is above zero and no more than the amount.' };
  if (!String(form.terms || '').trim()) return { error: 'Write the plain terms.' };
  return { body: { name, target_close: form.target_close, amount_cents: amount, minimum_cheque_cents: minimum, terms: String(form.terms).trim() } };
}

/** RAC21: on, off with its reason, or not drawn (no closed call). */
export function startNewState(d) {
  if (!d?.start_new) return { show: false };
  return { show: true, on: !!d.start_new.on, reason: d.start_new.sentence || null };
}

/* ------------------------- Step 3 of a call started from a closed one (D7513) */

/** RAC20C's chips over the closed call's chosen recipients, in the canvas's order. */
export const SOURCE_FILTERS = Object.freeze([
  ['all', 'All chosen'], ['responded', 'Responded'], ['did_not_respond', 'Did not respond'], ['not_delivered', 'Not delivered'],
]);
export const SOURCE_ON = Object.freeze({ responded: 'Responded', did_not_respond: 'Did not respond', not_delivered: 'Not delivered' });
/** The Today chip, from the Worker's `today`. */
export const SOURCE_TODAY = Object.freeze({ verified: 'Verified', not_verified: 'Not verified', not_active: 'Not active', not_in_pipeline: 'Not in pipeline' });
/** Why a chosen investor of the closed call cannot be ticked today, from the Worker's `today`. */
export const SOURCE_WHY = Object.freeze({
  not_verified: 'No longer verified on Axal',
  not_active: 'Account no longer active on Axal',
  not_in_pipeline: 'No longer in your pipeline',
});
export const SOURCE_OWNER_ONLY = 'The audience is set by the venture’s owner. You can see who is ticked. Only the owner can change it (D1222).';
export const SOURCE_REMATCH = 'Matching investors are re-matched when you preview the audience, never copied from the closed call.';

/**
 * The prospects step 3 ticks from the closed call: each chosen recipient the
 * Worker marks `ticked` (still a verified investor in this pipeline). Null when
 * nothing was read, or when the draft already records its own chosen audience,
 * which always wins over the closed call.
 */
export function sourceTicks(data, page) {
  if (!Array.isArray(data?.rows)) return null;
  if ((page?.recipients || []).some((r) => r.origin === 'chosen')) return null;
  return [...new Set(data.rows.filter((r) => r.ticked === true && Number.isSafeInteger(r.prospect_id)).map((r) => r.prospect_id))];
}

/** The closed call's rows under one chip. */
export function sourceRows(data, filter = 'all') {
  const rows = data?.rows || [];
  return filter === 'all' ? rows : rows.filter((r) => r.on_source === filter);
}

/** A chip's count, the Worker's; null (Not recorded) when the read has none. */
export function sourceChip(data, key) {
  const n = key === 'all' ? data?.counts?.chosen : data?.counts?.[key];
  return Number.isFinite(n) ? n : null;
}

/** "Showing 8 of 18 · 16 ticked": the ticks are the sheet's own, so a change shows at once. */
export function sourceFooter(data, shown, chosen) {
  const rows = data?.rows || [];
  const ticked = rows.filter((r) => r.prospect_id != null && (chosen || []).includes(r.prospect_id)).length;
  return `Showing ${shown.length} of ${rows.length} · ${ticked} ticked`;
}

/** The address of the moved line on Capital relationships › Commitments (RAC22C), with the line it names. */
export function commitmentsHref(projectId, prospectId) {
  const q = new URLSearchParams();
  if (projectId != null) q.set('project_id', String(projectId));
  if (Number.isSafeInteger(Number(prospectId)) && Number(prospectId) > 0) q.set('recorded', String(prospectId));
  const s = q.toString();
  return `/raise/capital-relationships/commitments${s ? `?${s}` : ''}`;
}

/* ------------------------------------------ Record a commitment (RAC22, 23) */

/** What Record a commitment meets on this response's pipeline line. */
export function lineConflict(r) {
  if (!r?.named || !r.responded_at) return { kind: 'not_responded', off: true, text: 'Only a response can be recorded.' };
  if (!r.in_pipeline || !r.line) return { kind: 'no_line', off: true, text: 'Not in Capital relationships yet. There is no line to record against.' };
  if (r.line.currency && r.line.currency !== 'USD') return { kind: 'other_currency', off: true, text: `The line is in ${r.line.currency}; the round is in USD. Listed, never added to the USD total.` };
  if (r.line.status === 'wired') return { kind: 'already_wired', off: true, text: `Already recorded as Wired · ${usd(r.line.amount_cents)}. A response never overwrites it.` };
  if (r.line.status === 'signed') return { kind: 'signed', off: false, onlyWired: true, text: `Recorded as Signed · ${usd(r.line.amount_cents)}. Record Wired when the money arrives.` };
  return { kind: 'ok', off: false };
}

/** The line's state as the responses table shows it. */
export function lineLabel(r) {
  const c = lineConflict(r);
  if (c.kind === 'no_line') return { tone: 'muted', text: 'Not in Capital relationships' };
  if (c.kind === 'other_currency') return { tone: 'muted', text: 'Other currency' };
  if (r.line?.status === 'wired') return { tone: 'ok', text: 'Wired · counted' };
  if (r.line?.status === 'signed') return { tone: 'ok', text: 'Signed · counted' };
  return { tone: 'draft', text: 'Indicated · Soft · not counted' };
}

/** The typed amount in cents, or null while it is blank or not a number. Never 0 for blank. */
export function typedCents(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const n = minorOf(s);
  return n != null && n > 0 ? n : null;
}
export function differs(typed, indicated) {
  return typed != null && indicated != null && typed !== indicated;
}
export function indicatedLine(r, callName) {
  if (r?.commitment_cents == null) return { amount: null, text: `Indicated ${NOT_RECORDED.toLowerCase()} through ${callName}` };
  return { amount: r.commitment_cents, text: `Indicated ${usd(r.commitment_cents)}${r.committed_at ? ` on ${shortDay(r.committed_at)}` : ''} through ${callName}` };
}

/** A refusal's own sentence, or a fallback that never blames the founder. */
export function sentenceOf(e, fallback = 'This could not be saved. Try again.') {
  if (e?.status === 403 || e?.code === 'owner_only') return OWNER_ONLY_FT;
  if (e?.code === 'call_changed') return 'Someone else changed this call. Reload to see it; nothing you typed was lost.';
  return (e?.message && e?.status && e.status < 500) ? e.message : fallback;
}
