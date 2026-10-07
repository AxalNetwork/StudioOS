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
export const JOIN_NOTE = 'Joining adds the company to your portfolio and research views, and lets you open a diligence case on it. '
  + 'It does not open the room’s documents; only an invited or committed investor reads them.';

const PLAN_LABEL = { free: 'Free', professional: 'Professional', institutional: 'Institutional' };

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
  if (q.upgrade_to === 'professional' && q.upgrade_cap) {
    return `${head} Professional raises this to ${q.upgrade_cap}. Institutional is unlimited.`;
  }
  if (q.upgrade_to === 'institutional') return `${head} Institutional is unlimited.`;
  return head;
}

/** The empty, "Not recorded" and "Unreadable" lines each screen draws. */
export const STATES = {
  pipeline: {
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
export const INVITE_STATUS = { invited: 'Invited', interested: 'Interested', passed: 'Passed' };

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

/** "12,500.00" or "12500" → 1250000 cents; NaN for anything that is not a positive amount. */
export function amountToCents(raw) {
  const s = String(raw ?? '').replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return Number.NaN;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return cents > 0 ? cents : Number.NaN;
}

/** Cents as money, to the cent: 1250000 → "$12,500.00". */
export function centsMoney(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  return `$${(n / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
