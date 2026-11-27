/**
 * D606 (#1107, #1108) — the screens of the owner's Eadwyn Tickets canvas
 * (`design/canvases/integrated/Eadwyn Tickets.dc.html`):
 *
 *   T1, T1b  /hq/review — the Super Admin's review queue: feature requests,
 *            and suggested tasks with an audience picker (D544's routes).
 *   T2       the Eadwyn chat's Tasks panel: the approved community tasks and
 *            the member's own suggestions with their state (D545).
 *   T3       the Eadwyn chat's My tickets panel: each ticket's bounty or
 *            review, and the credit balance (D542, D540).
 *
 * Pure helpers, so every state renders in a test. The chips are D604's
 * (`ticketScreens.js`): a priority or a type reads the same on every ticket
 * surface.
 */
import { toUtcInstant } from './notices';

// ---------------------------------------------------------------------------
// T1, T1b — the review queue
// ---------------------------------------------------------------------------

/** The Worker's floor for a decision's reason (`REVIEW_REASON_MIN`, D544). */
export const REASON_MIN = 10;
/** Rows a queue page shows: the canvas's "1–25 of [N]". */
export const QUEUE_PAGE = 25;

export const QUEUE_TABS = [
  { id: 'features', label: 'Feature requests' },
  { id: 'tasks', label: 'Suggested tasks' },
];

/** `?tab=tasks` opens T1b; anything else opens T1. */
export const tabFromSearch = (search) => (new URLSearchParams(search || '').get('tab') === 'tasks' ? 'tasks' : 'features');

/** Who an approved task is published to, in the Worker's order (`AUDIENCES`, D544). */
export const AUDIENCES = [
  { id: 'all', label: 'All users' },
  { id: 'founder', label: 'Founders' },
  { id: 'investor', label: 'Investors' },
  { id: 'advisor', label: 'Advisors' },
  { id: 'partner', label: 'Partners' },
  { id: 'explorer', label: 'Explorers' },
];
export const audienceLabel = (id) => AUDIENCES.find((a) => a.id === id)?.label || String(id || '');

export const DATE_WINDOWS = [
  { id: '', label: 'Any date' },
  { id: '7', label: 'Last 7 days' },
  { id: '30', label: 'Last 30 days' },
  { id: 'older', label: 'Older than 30 days' },
];

export const NO_QUEUE_FILTERS = Object.freeze({ query: '', priority: '', window: '' });
export const hasQueueFilters = (f) => Object.values(f || {}).some((v) => String(v || '').trim() !== '');

const RANK = { urgent: 0, high: 1, medium: 2, low: 3 };

function ageDays(value, now) {
  const iso = toUtcInstant(value);
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? (now - t) / 86_400_000 : null;
}

/** Title search, priority and date window. A row with no readable date matches no window. */
export function matchesQueue(item, f = NO_QUEUE_FILTERS, now = Date.now()) {
  const q = String(f.query || '').trim().toLowerCase();
  if (q && !String(item?.title || '').toLowerCase().includes(q)) return false;
  if (f.priority && item?.priority !== f.priority) return false;
  if (f.window) {
    const age = ageDays(item?.created_at, now);
    if (age === null) return false;
    if (f.window === 'older' ? age <= 30 : age > Number(f.window)) return false;
  }
  return true;
}

/** Most pressing first, as the canvas draws them; the oldest first within a priority. */
export function sortQueue(items) {
  return [...(items || [])].sort((a, b) => {
    const r = (RANK[a?.priority] ?? 4) - (RANK[b?.priority] ?? 4);
    if (r) return r;
    return String(toUtcInstant(a?.created_at) || '').localeCompare(String(toUtcInstant(b?.created_at) || ''));
  });
}

/**
 * One page of a filtered queue, and its count line. `total` is the Worker's
 * number waiting; the page reads the oldest 200, so past that the line still
 * names the true number and `partial` says only some are loaded.
 */
export function queueView(items, { filters = NO_QUEUE_FILTERS, page = 1, total = null, now = Date.now() } = {}) {
  const loaded = Array.isArray(items) ? items : [];
  const matched = sortQueue(loaded.filter((x) => matchesQueue(x, filters, now)));
  const pages = Math.max(1, Math.ceil(matched.length / QUEUE_PAGE));
  const p = Math.min(Math.max(1, Number(page) || 1), pages);
  const rows = matched.slice((p - 1) * QUEUE_PAGE, p * QUEUE_PAGE);
  const filtered = hasQueueFilters(filters);
  const of = filtered ? matched.length : Math.max(Number(total) || 0, loaded.length);
  const label = rows.length ? `${(p - 1) * QUEUE_PAGE + 1}–${(p - 1) * QUEUE_PAGE + rows.length} of ${of}` : `0 of ${of}`;
  const partial = Number(total) > loaded.length
    ? `The oldest ${loaded.length} of ${total} waiting are loaded. Decide some to reach the rest.`
    : null;
  return { rows, page: p, pages, label, partial, matched: matched.length };
}

/** A tab's count: the number waiting once read, and nothing while loading or unreadable. */
export const tabCount = (read) => (read?.status === 'ready' ? Number(read.data?.total ?? read.data?.count ?? 0) : null);

/**
 * What approving a task pays, from the rules (`GET /api/community-tasks/rewards`).
 *   on          the rule is on and pays credits
 *   off         the rule is switched off: approving pays nothing
 *   none        no rule, or one that pays nothing
 *   unreadable  the rules could not be read
 */
export function taskReward(read) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status !== 'ready') return { state: 'unreadable' };
  const rule = read.data?.rewards?.task_approved;
  if (!rule) return { state: 'none' };
  if (rule.active === false) return { state: 'off' };
  const n = Number(rule.credits);
  return Number.isFinite(n) && n > 0 ? { state: 'on', credits: n } : { state: 'none' };
}

/** The canvas's button: "Approve · +10 credits" on a task when the rule pays. */
export function approveLabel(tab, reward) {
  return tab === 'tasks' && reward?.state === 'on' ? `Approve · +${reward.credits} credits` : 'Approve';
}

/** The line under a task's Approve when the button cannot name a reward. */
export function rewardNote(reward) {
  switch (reward?.state) {
    case 'off': return 'The task reward is switched off in the credit rules, so approving pays nothing.';
    case 'none': return 'No task reward is set in the credit rules, so approving pays nothing.';
    case 'unreadable': return 'What approving pays could not be read. The grant follows the credit rules either way.';
    default: return null;
  }
}

/** The confirm panel's sentence (the canvas's "Approve · confirm"). */
export function approveCopy(tab, item, { audience = 'all', reward } = {}) {
  const title = item?.title ? `“${item.title}”` : 'this request';
  if (tab !== 'tasks') return `Sends ${title} to the build queue. The requester sees “Approved” on their ticket.`;
  const pays = reward?.state === 'on'
    ? ` and rewards the suggester ${reward.credits} credits`
    : '';
  return `Publishes ${title} to the Task list of ${audienceLabel(audience).toLowerCase()}${pays}.`;
}

/** A typed reason is long enough to send. */
export const reasonReady = (text) => String(text || '').trim().length >= REASON_MIN;
export const reasonHint = (text) => {
  const n = String(text || '').trim().length;
  return n >= REASON_MIN ? null : `At least ${REASON_MIN} characters (${n} so far). It is recorded with the decision.`;
};

const LABEL_LINES = {
  added: (decision) => `The GitHub issue is labelled feature:${decision}.`,
  no_issue: () => 'It has no GitHub issue to label.',
  not_configured: () => 'GitHub is not configured here, so no label was added.',
  failed: () => 'The GitHub label could not be added; the decision is recorded all the same.',
};

/** What a decision did, in the route's own facts: the label, the notice, the reward. */
export function decisionOutcome(tab, decision, res) {
  const told = (who) => (res?.notified ? `The ${who} was told in their inbox.` : `The ${who} could not be told in their inbox.`);
  if (tab !== 'tasks') {
    const head = decision === 'approved' ? 'Approved. It goes to the build queue.' : 'Declined, with your reason.';
    const label = LABEL_LINES[res?.label_status]?.(decision) || null;
    return [head, label, told('requester')].filter(Boolean).join(' ');
  }
  if (decision === 'declined') return `Declined, with your reason. ${told('suggester')}`;
  const r = res?.reward;
  const pay = r?.status === 'granted'
    ? `The suggester was paid ${r.credits} credit${Number(r.credits) === 1 ? '' : 's'}.`
    : r?.status === 'already_granted'
      ? 'The suggester had already been paid for it.'
      : `No credits were paid: ${String(r?.message || 'the grant was refused.').replace(/\.?$/, '.')}`;
  return `Approved and published to ${audienceLabel(res?.audience).toLowerCase()}. ${pay}`;
}

/** A refusal's own message; 409 says someone decided it first. */
export function decisionRefusal(err) {
  if (err?.status === 409) return `${err.message || 'This was already decided.'} Reload the queue to see where it stands.`;
  return err?.message || 'The decision could not be saved. Nothing was changed.';
}

// ---------------------------------------------------------------------------
// T2 — the Tasks panel
// ---------------------------------------------------------------------------

/**
 * A suggestion's state chip. An approved one names what its grant paid (the
 * ledger, D606), never what the rule says today.
 */
export function suggestionLine(s) {
  switch (s?.status) {
    case 'pending': return { text: 'Pending review', tone: 'amber' };
    case 'declined': return { text: 'Declined', tone: 'red', reason: s.decline_reason || null };
    case 'approved': {
      const r = s.reward;
      if (r?.credits_unreadable) return { text: 'Approved · credits could not be read', tone: 'green' };
      if (r?.revoked) return { text: 'Approved · credits taken back', tone: 'amber' };
      const n = Number(r?.credits);
      if (r && r.credits != null && Number.isFinite(n) && n > 0) return { text: `Approved · +${n} credits`, tone: 'green' };
      return { text: 'Approved · no credits paid', tone: 'green' };
    }
    default: return null;
  }
}

/** One line from a task's text, for the card. */
export function taskLine(body, max = 140) {
  const line = String(body || '').replace(/\s+/g, ' ').trim();
  if (!line) return null;
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** "Start" puts the task to Eadwyn: the chat's "help me with" opens an explanation. */
export const startPrompt = (task) => `Help me with ${String(task?.title || '').trim()}`;

/** The note under "Suggest a task", with the reward when the rule pays one. */
export function suggestNote(rewardsRead) {
  const r = taskReward(rewardsRead);
  const base = '“Suggest a task” opens the ticket form with Type set to Task.';
  return r.state === 'on' ? `${base} An approved suggestion earns ${r.credits} credits.` : base;
}

// ---------------------------------------------------------------------------
// T3 — My tickets
// ---------------------------------------------------------------------------

/** Rows the panel lists before "All tickets". */
export const PANEL_TICKETS = 5;

/** The member's tickets, most recently active first. */
export function panelTickets(rows, limit = PANEL_TICKETS) {
  const at = (t) => String(toUtcInstant(t?.updated_at || t?.created_at) || '');
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => at(b).localeCompare(at(a))).slice(0, limit);
}

/** The balance card: a number once read, withheld (never 0) when it could not be. */
export function balanceLine(read) {
  if (!read || read.status === 'loading') return { state: 'loading', text: 'Reading your balance…' };
  if (read.status !== 'ready') return { state: 'unreadable', text: 'Your balance could not be read. It is withheld, not zero.' };
  const n = Number(read.data?.balance);
  if (!Number.isFinite(n)) return { state: 'unreadable', text: 'Your balance could not be read. It is withheld, not zero.' };
  return { state: 'ready', text: `${n} credit${n === 1 ? '' : 's'}` };
}

const TIERS = [['bug_high', 'High'], ['bug_medium', 'Medium'], ['bug_low', 'Low']];

/**
 * What a fixed bug earns, by the tier it is graded at, from today's rules.
 * The canvas tied the amounts to the ticket's priority; the tier is the
 * grader's, set when the fix is verified (D542), so the note says that.
 */
export function bountyRatesNote(rewardsRead) {
  if (!rewardsRead || rewardsRead.status === 'loading') return null;
  if (rewardsRead.status !== 'ready') return 'What a fixed bug earns could not be read just now.';
  const parts = TIERS.map(([key, label]) => {
    const rule = rewardsRead.data?.rewards?.[key];
    if (!rule) return `${label}: not set`;
    if (rule.active === false) return `${label}: not paid now`;
    return `${label} +${Number(rule.credits)}`;
  });
  return `A confirmed bug earns credits when the fix ships, by the tier it is graded at: ${parts.join(', ')}.`;
}
