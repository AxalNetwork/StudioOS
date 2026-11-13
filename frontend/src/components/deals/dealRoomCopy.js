import { dealMoney } from './dealMoney';
import { parseMinor } from '../../lib/money.js';
/**
 * D630 (#1388) — the deal room's words, in one place.
 *
 * The Ops canvas (`design/canvases/integrated/ops-data.js`, screens
 * `dr-pipeline`, `dr-header`, `dr-invites`, `dr-transfers`, `sp-references`
 * and `sy-close`) holds each screen's labels, states and refusals. The
 * screens read them from here so a sentence is written once, and the tests
 * render the components against the same strings.
 *
 * Pure: no React, no I/O.
 */

/** What joining does, and what it does not. Both the list and the header say it. */
export const ROOM_ACCESS_REQUIRED = 'An invitation or commitment is needed to open this deal.';
export const ROOM_ACCESS_UNREADABLE = 'Deal access could not be confirmed.';
export const ROOM_REQUEST_CONFIRM = 'This records your invitation request for the selected firm. Nobody is notified automatically. It does not grant access to the deal or diligence.';
export const ROOM_LEAVE_CONFIRM = 'This removes your room request. It does not withdraw a commitment or change anyone else’s access. Nobody is notified.';

/** D4815: what a completed Leave says once the room has re-read (Scope → Review → Result). */
export const ROOM_LEFT = 'You left this room. Your invitation request is removed; nothing else changed.';

/** The deal rooms page's result line, naming the room, after a confirmed request or Leave. */
export function roomResult(kind, name) {
  return kind === 'left'
    ? `You left the ${name} room. Your invitation request is removed; nothing else changed.`
    : `Your invitation request for ${name} is recorded. Access starts after an invitation or commitment.`;
}

/**
 * D4815 (#4815, canvas DX1b) — a deal room's access, in the three states the
 * canvas keeps apart. `can_read` is the Worker's answer: `true` opens the deal,
 * `false` is refused, and anything else (absent, malformed) is UNREADABLE: the
 * page cannot say whether this investor may open it, so it offers Try again,
 * never Request an invitation.
 */
export function roomAccess(d) {
  if (d?.can_read === true) return 'open';
  if (d?.can_read === false) return 'refused';
  return 'unreadable';
}

/**
 * The deal rooms page's three views (D4815): every live deal, the ones this
 * investor may open, and the ones they asked into. `test` is over one live deal.
 */
export const ROOM_FILTERS = Object.freeze([
  { key: 'all', label: 'All live deals', test: () => true },
  { key: 'open', label: 'You can open', test: (d) => roomAccess(d) === 'open' },
  { key: 'requested', label: 'Requested', test: (d) => Boolean(Number(d?.is_member)) },
]);

/** What each view says when it holds nothing; a list that was not read never reaches these. */
export const ROOM_FILTER_EMPTY = Object.freeze({
  open: 'No deal is open to you yet. An invitation or a commitment opens one.',
  requested: 'You have not asked into any deal room.',
});

/** Counts per view, or null when the list was not read: an unread list never counts 0. */
export function roomFilterCounts(deals) {
  if (!Array.isArray(deals)) return null;
  return Object.fromEntries(ROOM_FILTERS.map((f) => [f.key, deals.filter(f.test).length]));
}

export const JOIN_NOTE = 'Requesting an invitation records your interest. It does not grant access to the deal or diligence. Only an invited or committed investor can read them.';

const PLAN_LABEL = { free: 'Free', plus: 'Plus', professional: 'Professional', institutional: 'Institutional' };

/**
 * The quota line: "3 of 5 deal rooms", or "Unlimited". Null for a quota that
 * was not read — the caller draws "Unreadable", never a zero.
 */
export function quotaLine(q) {
  if (!q) return null;
  if (q.unlimited) return 'Unlimited deal rooms';
  return `${q.used} of ${q.cap} deal room${q.cap === 1 ? '' : 's'}`;
}

/**
 * What a full quota says, naming the plan that raises it. From the server's
 * `upgrade_to` / `upgrade_cap` (or a join's 402 body, which names the plan the
 * same way), so no cap is typed here.
 */
export function quotaFullLine(q) {
  if (!q || q.unlimited) return null;
  const plan = PLAN_LABEL[q.tier] || 'your';
  const head = `Your ${plan} plan is full: you are in ${q.used} of ${q.cap} deal room${q.cap === 1 ? '' : 's'}. Leave one, or change plan.`;
  // D1334: Free's next plan is Plus.
  if (q.upgrade_to === 'plus' && q.upgrade_cap) {
    return `${head} Plus raises this to ${q.upgrade_cap}. Professional raises it further; Institutional is unlimited.`;
  }
  if (q.upgrade_to === 'professional' && q.upgrade_cap) {
    return `${head} Professional raises this to ${q.upgrade_cap}. Institutional is unlimited.`;
  }
  if (q.upgrade_to === 'institutional') return `${head} Institutional is unlimited.`;
  return head;
}

/** The empty, "Not recorded" and "Unreadable" lines each screen draws. */
export const STATES = {
  pipeline: {
    intro: 'Live deals, your invitation requests and the room allowance on your plan.',
    empty: 'No deal is open to join yet.',
    unread: 'The pipeline could not be read just now.',
    nrRound: 'Round size: the company has not recorded one.',
    quotaUnread: 'Your deal-room quota could not be read just now.',
  },
  invites: {
    empty: 'Nobody has been invited into this room yet.',
    unread: 'Invitations could not be read just now.',
    nrAnswered: 'Not recorded: this investor has not answered yet.',
  },
  transfers: {
    empty: 'No wire has been recorded for this round.',
    unread: 'Transfers could not be read just now.',
    nrFirm: 'Not recorded: the transfer was recorded without a firm.',
  },
  references: {
    empty: 'No reference has been scheduled.',
    unread: 'References could not be read just now.',
    nrConsent: 'Not recorded: consent is not yet given.',
    nrScheduled: 'Not recorded: no time has been set.',
  },
  syndicates: {
    empty: 'No syndicate is linked to this company.',
    unread: 'Syndicates could not be read just now.',
    nrTarget: 'Not recorded: no target has been set for this syndicate.',
    noMembers: 'No member has committed yet.',
  },
};

/** Invitation status, as the canvas words it. */
export const INVITE_STATUS = { requested: 'Invitation requested', invited: 'Invited', interested: 'Interested', passed: 'Passed' };

/** Reference status, as the canvas words it. */
export const REFERENCE_STATUS = {
  scheduled: 'Scheduled',
  recorded: 'Recorded',
  transcribed: 'Transcribed',
  summarized: 'Summarised',
  cancelled: 'Cancelled',
};

/** Recording, transcript and summary: the Worker stubs all three (D609's 501s). */
export const REFERENCE_ARTEFACTS = ['Recording', 'Transcript', 'Summary'];
export const NOT_AVAILABLE_YET = 'Not available yet';

/** The syndicate's three statuses, in order. */
export const SYNDICATE_FLOW = [
  { key: 'open', label: 'Open' },
  { key: 'funded', label: 'Funded' },
  { key: 'closed', label: 'Closed' },
];

export const SYNDICATE_CLOSE_CONFIRM = {
  title: 'Close this syndicate?',
  body: 'Its status becomes Closed. Members are not notified. Only the creator or an admin can do this.',
};

/**
 * A refused "Record a transfer", as the sentence the form prints: a title and
 * the line under it. `e` is the thrown request error (`code`, `data`,
 * `message`); a client-side check passes a code alone.
 */
export function transferRefusal(e) {
  const code = e?.code || null;
  if (code === 'open_conditions_block_transfer') {
    const n = Number(e?.data?.open_conditions);
    return {
      code,
      title: Number.isInteger(n) && n > 0
        ? `${n} open condition${n === 1 ? '' : 's'}`
        : 'An open condition you cannot see',
      body: 'A transfer cannot be recorded while closing conditions are open. Resolve them in the commit room. Nothing was recorded.',
    };
  }
  if (code === 'transfer_gate_unreadable') {
    return { code, title: 'The closing check could not be read', body: 'Try again. Nothing was recorded.' };
  }
  if (code === 'transfer_amount_invalid') {
    return { code, title: 'Invalid amount', body: 'Enter a positive amount, to the cent. Nothing was recorded.' };
  }
  if (code === 'transfer_firm_required') {
    return { code, title: 'No firm given', body: 'Choose the firm the wire is for in the company switcher, then record it again. Nothing was recorded.' };
  }
  return { code, title: 'The transfer was not recorded', body: e?.message || 'Try again. Nothing was recorded.' };
}

/**
 * "12,500.00" or "12500" → the deal currency's minor units (1250000 in USD, 12500 in JPY, 12500000 in KWD); NaN for
 * anything that is not a positive amount that currency can hold (D5373).
 */
export function amountToCents(raw, currency = 'USD') {
  const s = String(raw ?? '').replace(/[,\s]/g, '');
  const r = /^\d+(\.\d+)?$/.test(s) ? parseMinor(s, currency) : { ok: false };
  return r.ok && r.minor > 0 ? r.minor : Number.NaN;
}

/** Cents as money, to the cent: 1250000 → "$12,500.00". */
export function centsMoney(cents, currency = 'USD') {
  return dealMoney(cents, currency, true);
}

/** A stored timestamp as "12 Oct 2026, 09:41" (UTC), or null when absent or unparseable. */
export function whenLine(ts) {
  if (!ts) return null;
  const raw = String(ts);
  const iso = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `${date}, ${time}`;
}
