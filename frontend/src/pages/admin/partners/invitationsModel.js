/**
 * D950 (#2726, part 7 of #2370) — Invitations complete: the words and rules
 * for the Invitations tab on part 3's server list (D926), one invitation on
 * part 4's read (D927), and New invitation on part 4's offer preview and part
 * 3's lookup. Pure: no React, no fetch.
 *
 * WHAT CHANGED FROM D923. The tab no longer filters R1's newest 200 on the
 * client (Guard L) nor repairs the stage after a resend (Guard I): since part
 * 1 (D924) a resend keeps the stored stage, so the stored stage is the stage
 * reached, and the server pages, filters and counts every invitation. A
 * record reads its own row, so "Not in this read" goes too.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';
import { parseStamp } from '../../../ui/parseStamp.js';
import {
  COULD_NOT_READ, DEAL_TYPES, NOT_REACHED, ROWS_PER_PAGE, STEPS, day, dayOr, dealTypeWord, invitationRow, isFailed, isLoading,
  dataOf, isCoolOff, PAUSED, whoOf,
} from './partnersDeskModel.js';

const nf = (n) => Number(n).toLocaleString('en-US');

/* ------------------------------------------------------------------ *
 * The list, on the server (D926)
 * ------------------------------------------------------------------ */

/** The tab's sort keys (D923's words) and the Worker's. */
export const SERVER_SORTS = Object.freeze({
  newest: 'newest', 'oldest-open': 'oldest_open', expires: 'expires_soonest', name: 'name', stage: 'stage',
});
/** One request per filter change: a change waits this long, and a newer one replaces it. */
export const LIST_DEBOUNCE_MS = 300;
/** The export's page: the Worker's largest asked-for page (D926 §4). */
export const EXPORT_PAGE = 100;

/**
 * The tab's filters as `adminPartners.listInvitations`' options. Every filter
 * is the Worker's: `q` (name or email), `stage` (Lapsed included, computed on
 * each read), `deal_type` (among the first three offered), `invited_by` (a
 * user id), `sent_within` (days) and the sort; the page is `limit`/`offset`.
 */
export function listQuery({ q = '', stages = [], type = '', invitedBy = '', sentWithin = '', sort = 'newest', page = 1 } = {}, size = ROWS_PER_PAGE) {
  const opts = { sort: SERVER_SORTS[sort] || 'newest', limit: size, offset: Math.max(0, (Math.max(1, Number(page) || 1) - 1) * size) };
  const needle = String(q || '').trim();
  if (needle) opts.q = needle;
  if (stages.length) opts.stage = [...stages];
  if (type) opts.dealType = type;
  if (/^[1-9]\d*$/.test(String(invitedBy || ''))) opts.invitedBy = Number(invitedBy);
  if (Number(sentWithin) > 0) opts.sentWithin = Number(sentWithin);
  return opts;
}

/** The same filters with no page: what the export reads, page by page. */
export const exportQuery = (filters) => {
  const { limit: _l, offset: _o, ...rest } = listQuery(filters, EXPORT_PAGE);
  return rest;
};

export const filtersOn = ({ q = '', stages = [], type = '', invitedBy = '', sentWithin = '' } = {}) =>
  Boolean(String(q || '').trim() || stages.length || type || invitedBy || sentWithin);

/** A list reply checked whole: rows and an exact total, or a failed read, never an empty one. */
export function listReply(reply) {
  if (!Array.isArray(reply?.items) || !Number.isFinite(Number(reply?.total))) {
    throw new Error('The invitations did not come back as a list with a total.');
  }
  return { items: reply.items, total: Number(reply.total) };
}

/** One server page in the Pager's shape: the total is the Worker's, never the page's length. */
export function serverPage(data, page, size = ROWS_PER_PAGE) {
  const total = Number(data?.total) || 0;
  const rows = Array.isArray(data?.items) ? data.items : [];
  const pages = Math.max(1, Math.ceil(total / size));
  const at = Math.min(Math.max(1, Number(page) || 1), pages);
  const from = rows.length ? (at - 1) * size + 1 : 0;
  const to = rows.length ? from + rows.length - 1 : 0;
  return { rows, page: at, pages, from, to, total };
}

/** The empty line after a server search: exact, so it never says what it covered. */
export function noServerMatch(q) {
  const s = String(q || '').trim();
  return s ? `No invitation matches ‘${s}’.` : 'No invitation matches these filters.';
}

/**
 * "Invited by" offers the admins who sent an invitation the page has read (R1
 * and the page shown), by user id, which is what the Worker filters on. A row
 * from before `invited_by_user_id` was returned is left out.
 */
export function invitersOf(...lists) {
  const by = new Map();
  for (const list of lists) {
    for (const inv of list || []) {
      const id = inv?.invited_by_user_id;
      if (id === null || id === undefined || !/^[1-9]\d*$/.test(String(id))) continue;
      const name = String(inv?.invited_by_name || '').trim() || `Admin #${id}`;
      if (!by.has(String(id))) by.set(String(id), name);
    }
  }
  return [...by].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/* ------------------------------------------------------------------ *
 * The Email column (D924's send columns)
 * ------------------------------------------------------------------ */

/**
 * Part 1's reasons for a send that did not go, in words. The same words as
 * the Overview's (D929, #2851 `SEND_REASONS`); once both are on `main` one
 * list should serve both.
 */
export const SEND_REASON_WORDS = Object.freeze({
  suppressed: 'the address is suppressed',
  not_configured: 'email is not set up',
  refused: 'the mail service refused it',
  failed: 'the send failed',
});
export const NOT_RECORDED_SEND = 'Sent before send results were recorded, so whether it went is not known.';

/**
 * Sent, Not sent with its reason, or Not recorded for a row from before
 * migration 547 (its result was never stored). Sent means Gmail accepted it,
 * never Delivered (D924).
 */
export function emailCell(inv) {
  const ok = inv?.last_send_ok;
  const last = day(inv?.last_sent_at);
  if (ok === 1 || ok === true) return { key: 'sent', text: 'Sent', title: last ? `Sent ${last}` : 'Sent', reason: null };
  if (ok === 0 || ok === false) {
    const reason = SEND_REASON_WORDS[inv?.last_send_reason] || 'no reason was recorded';
    return { key: 'not_sent', text: 'Not sent', title: `Not sent${last ? ` ${last}` : ''}: ${reason}`, reason };
  }
  return { key: 'not_recorded', text: NOT_RECORDED, title: NOT_RECORDED_SEND, reason: null };
}

/** The record's line: the latest send and how many sends there were. */
export function sendLine(inv) {
  const cell = emailCell(inv);
  const count = Number(inv?.send_count);
  const sends = Number.isFinite(count) && count > 0 ? ` · ${count === 1 ? '1 send' : `${nf(count)} sends`}` : '';
  if (cell.key === 'sent') return { ...cell, line: `Latest send: Sent${day(inv?.last_sent_at) ? ` ${day(inv.last_sent_at)}` : ''}${sends}` };
  if (cell.key === 'not_sent') return { ...cell, line: `Latest send: Not sent${day(inv?.last_sent_at) ? ` ${day(inv.last_sent_at)}` : ''}, because ${cell.reason}${sends}` };
  return { ...cell, line: `Latest send: ${NOT_RECORDED}. ${NOT_RECORDED_SEND}` };
}

/* ------------------------------------------------------------------ *
 * Export CSV
 * ------------------------------------------------------------------ */

/** The columns. The invitation link and its token are never among them. */
export const CSV_COLUMNS = Object.freeze([
  'Name', 'Email', 'Offered', 'Stage', 'Latest send', 'Send reason', 'Sends', 'Invited by', 'First sent', 'Opened', 'Expires', 'Deal',
]);

/** A cell a spreadsheet would read as a formula is prefixed with ', and every cell is quoted. */
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** One row, from the server's fields only. `link` and `token` are never read. */
export function csvRow(inv, now = Date.now()) {
  const row = invitationRow(inv, { now, repair: false });
  const email = emailCell(inv);
  return [
    row.named ? row.name : '',
    row.email,
    row.offered.unreadable ? COULD_NOT_READ : row.offered.shown.map(dealTypeWord).join('; '),
    row.stage.word,
    email.text,
    email.reason || '',
    Number.isFinite(Number(inv?.send_count)) ? String(Number(inv.send_count)) : '',
    row.invitedBy,
    row.sent,
    row.opened,
    row.expires.text,
    row.dealId !== null && row.dealId !== undefined ? `#${row.dealId}` : '',
  ];
}

export function toCsv(items, now = Date.now()) {
  return [CSV_COLUMNS, ...items.map((inv) => csvRow(inv, now))].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export const csvName = (now = Date.now()) => `partner-invitations-${new Date(now).toISOString().slice(0, 10)}.csv`;
export const EXPORT_FAILED = 'The export could not be read in full, so no file was made. Try again.';
export const exportingLine = (done, total) => (Number.isFinite(total) ? `Reading ${nf(done)} of ${nf(total)}…` : 'Reading the invitations…');

/* ------------------------------------------------------------------ *
 * One invitation (D927's read)
 * ------------------------------------------------------------------ */

/** The read checked whole: an invitation row, or a failed read. */
export function detailReply(reply) {
  if (!reply || typeof reply !== 'object' || !reply.invitation || reply.invitation.id === undefined) {
    throw new Error('The invitation did not come back.');
  }
  return reply;
}

/** A block of the read: `ready` with its fields, or `unreadable` with the Worker's reason. */
export function blockOf(block) {
  if (!block || typeof block !== 'object') return { state: 'unreadable', reason: null };
  if (block.available === false) return { state: 'unreadable', reason: block.reason || null };
  return { state: 'ready', block };
}

/** The read's state for a block that is still waiting on it. */
export function detailState(read) {
  if (isLoading(read)) return 'loading';
  if (isFailed(read)) return isCoolOff(read.error) ? 'paused' : 'unreadable';
  return 'ready';
}

const STEP_ROWS = [
  { key: 'sent', label: STEPS[0], step: 1 },
  { key: 'opened', label: STEPS[1], step: 2 },
  { key: 'profile_done', label: STEPS[2], step: 3 },
  { key: 'offers_shown', label: STEPS[3], step: 4 },
  { key: 'offer_chosen', label: STEPS[4], step: 5 },
  { key: 'agreement_out', label: STEPS[5], step: 6 },
  { key: 'signed', label: STEPS[6], step: 7 },
];

/**
 * The seven step dates (D927 §3). A date with no row reads "Not recorded" when
 * the stage shows the step was reached, else "Not reached", never a zero.
 * Offer chosen carries the first choice and, when it differs, the latest.
 */
export function stepRows(steps, stage) {
  const b = blockOf(steps);
  return STEP_ROWS.map((s) => {
    if (b.state !== 'ready') return { key: s.key, label: s.label, value: COULD_NOT_READ, failed: true };
    // A closed invitation (signed, revoked, a stored `expired`) keeps no stage reached, so a step with
    // no row is only "Not recorded": "Not reached" would be a guess. An open one says Not reached past its stage.
    const reached = stage?.closed ? true : stage?.step !== null && stage?.step !== undefined && s.step <= stage.step;
    if (s.key === 'offer_chosen') {
      const first = day(b.block.offer_chosen_first);
      const latest = day(b.block.offer_chosen_latest);
      if (!first) return { key: s.key, label: s.label, value: reached ? NOT_RECORDED : NOT_REACHED, missing: reached };
      const changed = latest && parseStamp(b.block.offer_chosen_latest) !== parseStamp(b.block.offer_chosen_first);
      return { key: s.key, label: s.label, value: changed ? `First ${first} · latest ${latest}` : first };
    }
    const v = day(b.block[s.key]);
    if (v) return { key: s.key, label: s.label, value: v };
    // A revoked invitation was never signed: that one is known.
    if (s.key === 'signed' && stage?.key === 'revoked') return { key: s.key, label: s.label, value: NOT_REACHED };
    return { key: s.key, label: s.label, value: reached ? NOT_RECORDED : NOT_REACHED, missing: reached };
  });
}

/** "What we offered": the offers the invitee saw, or why none are shown. */
export function offersSeen(block, inv) {
  const b = blockOf(block);
  if (b.state !== 'ready') return { state: 'unreadable', reason: b.reason };
  if (!b.block.shown || !Array.isArray(b.block.offers)) {
    return { state: 'not_shown', text: `${whoOf(inv)} has not asked for offers yet, so none were made. Offers are built from their answers when they do.` };
  }
  return { state: 'ready', offers: b.block.offers.map(offerCard) };
}

/** An offer as a card: its label, summary, terms and the grant it carries. */
export function offerCard(p) {
  const terms = p?.terms && typeof p.terms === 'object' && !Array.isArray(p.terms)
    ? Object.entries(p.terms).map(([k, v]) => ({ key: k, label: termLabel(k), value: String(v) }))
    : [];
  return {
    type: p?.deal_type || null,
    label: String(p?.label || '').trim() || dealTypeWord(p?.deal_type),
    summary: String(p?.summary || '').trim() || null,
    terms,
    term: Number(p?.term_months) > 0 ? `${nf(Number(p.term_months))} months` : null,
    dependent: Array.isArray(p?.profile_dependent) ? [...new Set(p.profile_dependent.map((d) => DEPENDENT_WORDS[d?.what]).filter(Boolean))] : [],
  };
}

const TERM_WORDS = {
  equity_pct: 'Equity', time_commitment: 'Time', board_observer: 'Board observer', rate: 'Rate',
  equity_for_services_band: 'Equity for services', minimum_engagements_per_year: 'Engagements a year',
};
const termLabel = (k) => TERM_WORDS[k] || String(k).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** D927 §4: the phrases a real offer takes from the invitee's answers. */
const DEPENDENT_WORDS = {
  equity_hours: 'The hours come from their answers.',
  capital_commitment: 'The capital commitment comes from their answers.',
  capital_tier: 'The investor tier depends on the capital they commit.',
  custom_text: 'The custom terms come from their answers.',
};

/** The chosen deal, from the read: its offer and its agreement. */
export function chosenDeal(block) {
  const b = blockOf(block);
  if (b.state !== 'ready') return { state: 'unreadable', reason: b.reason };
  if (!b.block.deal) return { state: 'none' };
  const deal = b.block.deal;
  return { state: 'ready', deal, offer: deal.proposal && typeof deal.proposal === 'object' ? offerCard({ ...deal.proposal, deal_type: deal.proposal.deal_type || deal.deal_type }) : null, envelope: b.block.envelope || null };
}

/** The refusals' codes in words (`partner_onboarding.ts` and D923 §2's rule). */
const REFUSAL_WORDS = {
  template_fields_unfilled: 'the agreement names fields the send leaves empty',
  template_has_no_body: 'the Partner Services template has no body',
  template_unreadable: 'the Partner Services template could not be read',
};

/** "Could not be sent": each recorded attempt the agreement refused, now that an attempt is recorded. */
export function refusalLines(block) {
  const b = blockOf(block);
  if (b.state !== 'ready') return { state: 'unreadable', reason: b.reason };
  const items = Array.isArray(b.block.items) ? b.block.items : [];
  return {
    state: 'ready',
    lines: items.map((r, i) => {
      const why = REFUSAL_WORDS[r?.code] || 'a reason that was not recorded';
      const fields = Array.isArray(r?.fields) && r.fields.length ? ` (${r.fields.join(', ')})` : '';
      return { key: `${r?.at || ''}:${i}`, text: `Could not be sent ${dayOr(r?.at)}: ${why}${fields}.` };
    }),
  };
}

const ACTION_WORDS = { created: 'Sent', resent: 'Resent', revoked: 'Revoked' };
const EMAIL_WORDS = (sent) => (sent === true ? 'email sent' : sent === false ? 'email not sent' : 'email result not recorded');
const SIGNING_WORDS = {
  renewed: 'the signing link was renewed and mailed',
  not_renewed: 'renewing the signing link failed, so the link already sent still stands',
};

/**
 * The history (D927 §3), oldest first: who did what and when, with the send
 * result, merged with the signing-link renewals from the envelope's trail. A
 * resend from before part 4 has no `signing_link` answer and says nothing of it.
 */
export function historyLines(block) {
  const b = blockOf(block);
  if (b.state !== 'ready') return { state: 'unreadable', reason: b.reason };
  const items = (Array.isArray(b.block.items) ? b.block.items : []).map((it, i) => {
    const who = String(it?.by || '').trim() || 'an admin not recorded';
    const verb = ACTION_WORDS[it?.action] || 'Changed';
    let detail = '';
    if (it?.action === 'revoked') detail = it?.reason ? ` · reason: ${it.reason}` : ' · no reason given';
    else {
      detail = ` · ${EMAIL_WORDS(it?.email_sent)}`;
      if (it?.action === 'resent' && 'signing_link' in (it || {})) {
        detail += it.signing_link === null ? ' · no signature was pending, so the onboarding email went' : SIGNING_WORDS[it.signing_link] ? ` · ${SIGNING_WORDS[it.signing_link]}` : '';
      }
    }
    return { key: `a:${i}`, at: parseStamp(it?.at), text: `${verb} by ${who} · ${dayOr(it?.at)}${detail}` };
  });
  const renewals = (Array.isArray(b.block.signing_link_renewals) ? b.block.signing_link_renewals : []).map((r, i) => {
    const who = String(r?.by || '').trim() || 'an admin not recorded';
    const what = r?.renewed ? 'Signing link renewed' : r?.previous_link_restored ? 'Signing link renewal failed; the earlier link was restored' : 'Signing link renewal failed';
    return { key: `r:${i}`, at: parseStamp(r?.at), text: `${what} by ${who} · ${dayOr(r?.at)}` };
  });
  const lines = [...items, ...renewals].sort((a, b2) => (a.at ?? Infinity) - (b2.at ?? Infinity));
  return { state: 'ready', lines };
}

/** The message the admin wrote, or that none was written. */
export const messageOf = (inv) => String(inv?.personal_message || '').trim() || null;
export const NO_MESSAGE = 'No message was written for this invitation.';

/* ------------------------------------------------------------------ *
 * New invitation: the offer preview (D927 §4) and the lookup (D926 §5)
 * ------------------------------------------------------------------ */

/**
 * The preview offers only the first three types it is asked for, so the five
 * cards are read in two asks (the first three, then the last two) and joined
 * by type. A card with no offer back says so.
 */
export const PREVIEW_ASKS = Object.freeze([DEAL_TYPES.slice(0, 3).map((t) => t.key), DEAL_TYPES.slice(3).map((t) => t.key)]);

export function previewReply(replies) {
  const by = new Map();
  for (const r of replies) {
    if (!Array.isArray(r?.offers)) throw new Error('The offer preview did not come back.');
    for (const o of r.offers) if (o?.deal_type) by.set(o.deal_type, offerCard(o));
  }
  return by;
}

/** One card's preview: the offer, reading, could not be read, or none for that type. */
export function previewFor(read, type) {
  if (isLoading(read)) return { state: 'loading' };
  if (isFailed(read)) return { state: 'unreadable' };
  const card = dataOf(read)?.get?.(type);
  return card ? { state: 'ready', card } : { state: 'none' };
}
export const PREVIEW_NOTE = 'The invitee sees these terms, with the parts marked below filled from their answers.';
export const PREVIEW_FAILED = 'The terms could not be read. The invitation can still be sent.';

const ROLE_WORD = { admin: 'Admin', founder: 'Founder', partner: 'Operating Partner', investor: 'Investor', advisor: 'Advisor', exploring: 'Explorer' };
const roleWord = (r) => ROLE_WORD[r] || (r ? String(r).replace(/^./, (c) => c.toUpperCase()) : 'role not recorded');

/**
 * The two warnings from one lookup (D926 §5). O-DUP is a warning, never a
 * refusal. Since part 2 (D925) activation no longer lowers a paid plan, so
 * the member sentence says the deal is added.
 */
export function lookupChecks(read) {
  if (!read || isLoading(read)) return { dup: { state: 'loading' }, member: { state: 'loading' } };
  if (read.status === 'error') {
    return {
      dup: { state: 'failed', text: 'Could not check for an open invitation.' },
      member: { state: 'failed', text: 'Could not check whether this address belongs to a member.' },
    };
  }
  const data = dataOf(read) || {};
  const open = data.open_invitation;
  const dup = open && open.id !== undefined && open.id !== null
    ? { state: 'found', id: open.id, text: `An open invitation to this address exists, sent ${dayOr(open.created_at)}. Open it instead?` }
    : { state: 'clear' };
  const member = data.member
    ? { state: 'found', text: `This address belongs to a member (${roleWord(data.member.role)}). Signing keeps their role and adds the partner deal.` }
    : { state: 'clear' };
  return { dup, member };
}

/* ------------------------------------------------------------------ *
 * Resend's result (D927 §5)
 * ------------------------------------------------------------------ */

export const RESENT_RENEWED = 'Sent. The agreement’s signing link was renewed and the email carries it.';
export const RESENT_NOT_RENEWED = 'Not sent. Renewing the signing link failed, so the link already in their inbox still stands.';
export const RESENT_ONBOARDING = 'Sent. No signature was pending, so the onboarding email went instead.';
export const RESENT_PLAIN = 'Sent.';
export const RESENT_NOT_SENT_LINK = 'Not sent. Copy the link instead.';

/**
 * The result from the reply alone (`admin_partners.ts` resend). `signing_link`
 * is `'renewed'` (the renewal email went, so `email_sent` is true),
 * `'not_renewed'` (it failed and the earlier link was restored, so
 * `email_sent` is false) or `null` (no partner signature was pending, so the
 * onboarding email went, or did not). A reply with no `signing_link` key, from
 * before part 4, says only whether it was sent. Copy is offered only when the
 * onboarding link is what the invitee needs.
 */
export function resendResult(reply) {
  const has = Boolean(reply) && typeof reply === 'object' && 'signing_link' in reply;
  if (has && reply.signing_link === 'renewed') return { text: RESENT_RENEWED, sent: true };
  if (has && reply.signing_link === 'not_renewed') return { text: RESENT_NOT_RENEWED, sent: false, copy: false };
  if (reply?.email_sent === true) return { text: has ? RESENT_ONBOARDING : RESENT_PLAIN, sent: true };
  return { text: RESENT_NOT_SENT_LINK, sent: false, copy: true };
}

export { PAUSED };
