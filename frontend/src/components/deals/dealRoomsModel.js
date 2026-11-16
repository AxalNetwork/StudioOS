/**
 * D6151 (#6151, canvas D6141 boards DE19 to DE24): what `/deals/rooms` draws, from its four reads.
 *
 *   deals        GET /api/deals                       the live list: status, round, confirmed total, can_read, is_member
 *   quota        GET /api/deals/dealroom/quota        the room allowance, counted across every firm
 *   invitations  GET /api/deals/invitations/mine      this firm's invitations: status and date
 *   flow         GET /api/deals/flow                  my deal flow: each deal's stage
 *
 * Each read is its own: one that fails turns its column Unreadable on every row, never "Not invited"
 * or "Not in my deal flow". The three ◇ columns of DE19 (NDA, my commitment, changed since opened)
 * are not drawn: no list read serves them (D6141, owner answer A: the build ships without them).
 *
 * Pure: no React, no I/O.
 */
import { dealMoney } from './dealMoney';
import { roomAccess } from './dealRoomCopy';
import { NOT_RECORDED } from '../../lib/absence';
const COMPANY = { applied: 'Applied', scored: 'Scored', active: 'Active', funded: 'Funded' };
const PROCESS = { sourcing: 'Sourcing', screening: 'Screening', diligence: 'Diligence', commit: 'Commit', closing: 'Closing', passed: 'Passed' };
const INVITATION = { invited: 'Invited', interested: 'Interested', passed: 'Passed' };
const PLAN = { free: 'Free', plus: 'Plus', professional: 'Professional', institutional: 'Institutional' };
const INSTRUMENT = { safe: 'SAFE', priced: 'Priced', convertible: 'Convertible note', note: 'Convertible note' };

/** A read in one of three states; `data` only when it was read. */
export const readOf = (state) => (state?.error ? 'unreadable' : state?.loading && state?.data == null ? 'loading' : 'ready');

/** "28 Oct" from a stored stamp, or null. */
export function shortDay(stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(stamp || ''));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** A live deal is one the list shows: every status but rejected (D6141: rejected deals are not listed). */
export const isLive = (d) => Boolean(d) && String(d.status || '') !== 'rejected' && Boolean(COMPANY[String(d.status || '')]);

/**
 * One row of DE19, from the deal and the two side reads. `invitations` and `flow` are
 * `{ state, byDeal }`: a read that failed leaves its column Unreadable.
 */
export function roomRow(d, { invitations, flow }) {
  const currency = /^[A-Z]{3}$/.test(String(d.currency || '')) ? d.currency : 'USD';
  const ask = Number(d.target_raise) > 0 ? d.target_raise : Number(d.amount) > 0 ? d.amount : null;
  const instrument = INSTRUMENT[String(d.instrument || '').toLowerCase()] || (d.instrument ? String(d.instrument) : null);
  const confirmed = Number.isFinite(Number(d.capital_committed)) ? dealMoney(Number(d.capital_committed), currency) : null;
  const member = Boolean(Number(d.is_member));

  let invitation;
  if (invitations.state === 'unreadable') invitation = { kind: 'unreadable', text: 'Unreadable' };
  else if (invitations.state === 'loading') invitation = { kind: 'loading', text: 'Reading…' };
  else {
    const inv = invitations.byDeal.get(Number(d.id));
    if (inv && INVITATION[inv.status]) invitation = { kind: inv.status, text: INVITATION[inv.status], day: shortDay(inv.responded_at || inv.created_at) };
    else if (member) invitation = { kind: 'requested', text: 'Invitation requested', day: null, note: 'No date in the list' };
    else invitation = { kind: 'none', text: 'Not invited' };
  }

  let process;
  if (flow.state === 'unreadable') process = { kind: 'unreadable', text: 'Unreadable' };
  else if (flow.state === 'loading') process = { kind: 'loading', text: 'Reading…' };
  else {
    const stage = flow.byDeal.get(Number(d.id));
    process = stage && PROCESS[stage] ? { kind: 'stage', stage, text: PROCESS[stage] } : { kind: 'none', text: 'Not in my deal flow' };
  }

  return {
    id: Number(d.id),
    name: d.project_name || `Deal #${d.id}`,
    sector: d.project_sector || null,
    company: COMPANY[String(d.status)] || NOT_RECORDED,
    process,
    round: { ask: ask == null ? null : dealMoney(Number(ask), currency), instrument, confirmed },
    invitation,
    access: roomAccess(d),
    member,
  };
}

/** `{ state, byDeal }` for the invitations read: one invitation per deal, the newest. */
export function invitationsIndex(state) {
  const s = readOf(state);
  const byDeal = new Map();
  if (s === 'ready') for (const inv of Array.isArray(state.data) ? state.data : []) {
    const id = Number(inv?.deal_id);
    if (Number.isFinite(id) && !byDeal.has(id)) byDeal.set(id, inv);
  }
  return { state: s, byDeal };
}

/** `{ state, byDeal }` for the flow read: each deal's stage in my flow. */
export function flowIndex(state) {
  const s = readOf(state);
  const byDeal = new Map();
  if (s === 'ready') for (const item of Array.isArray(state.data?.items) ? state.data.items : []) {
    const id = Number(item?.deal_id);
    if (Number.isFinite(id)) byDeal.set(id, item.stage);
  }
  return { state: s, byDeal };
}

/**
 * DE20's allowance line, from the quota read. `used` counts every firm (what a request is refused
 * on); `member_deal_ids` are this firm's rooms. A quota that was not read is Unreadable, never 0.
 */
export function allowanceView(state) {
  if (state?.loading && !state?.quota) return { kind: 'loading', text: 'Reading your room allowance…' };
  if (state?.error || !state?.quota) return { kind: 'unreadable', lead: 'Room allowance could not be read.', text: 'Requesting still checks it.' };
  const q = state.quota;
  const plan = PLAN[q.tier] ? `${PLAN[q.tier]} plan` : null;
  const here = Array.isArray(q.member_deal_ids) ? q.member_deal_ids.length : null;
  if (q.unlimited) return { kind: 'unlimited', lead: 'Unlimited rooms', plan, text: `${q.used} room${q.used === 1 ? '' : 's'} in use, all your firms` };
  const used = Number(q.used); const cap = Number(q.cap);
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : null;
  if (q.full) return { kind: 'full', lead: 'Allowance full', pct, text: fullSentence(q) };
  return {
    kind: 'within', lead: `${used} of ${cap} room${cap === 1 ? '' : 's'} used`, plan, pct,
    text: here == null ? 'Counted across all your firms' : `Counted across all your firms · ${here} under this firm`,
  };
}

/** "You are in 2 of 2 rooms on the Plus plan. Leave a room, or move to Professional for 5." (DE20). */
export function fullSentence(q) {
  const plan = PLAN[q?.tier] || 'your';
  const head = `You are in ${q.used} of ${q.cap} room${Number(q.cap) === 1 ? '' : 's'} on the ${plan} plan.`;
  const next = PLAN[q?.upgrade_to];
  if (!next) return `${head} Leave a room to request another.`;
  if (q.upgrade_to === 'institutional' || q.upgrade_cap == null) return `${head} Leave a room, or move to ${next}. ${next} is unlimited.`;
  return `${head} Leave a room, or move to ${next} for ${q.upgrade_cap}.`;
}

/** DE21: one empty board per view, each with its one action. */
export const EMPTY_VIEW = Object.freeze({
  all: { text: 'No live deals right now.', action: 'Go to Deal flow', to: '/deals' },
  open: { text: 'No deal is open to you yet. An invitation or a commitment opens one.', action: 'Show all live deals', view: 'all' },
  requested: { text: 'You have not asked into any deal room.', action: 'Show all live deals', view: 'all' },
});

/** DE22: a list read refused for want of the Investor licence is not "unreadable". */
export const NO_LICENCE = { title: 'Deal rooms are for investors.', body: 'An admin can grant the Investor licence.' };

/**
 * DE22's refusals and failures for Request, Leave and Add, each naming the room. `e` is the thrown
 * request error (`code`, `status`, `message`); `quota` is the re-read allowance for the 402.
 */
export function actionRefusal(kind, name, e, quota) {
  const code = e?.code || e?.data?.code || e?.data?.error || null;
  if (kind === 'request' && (code === 'quota_dealrooms_exhausted' || code === 'quota_exceeded' || e?.status === 402)) {
    return { tone: 'warn', title: `Your request for ${name} was not recorded: your allowance filled meanwhile.`, body: quota ? fullSentence(quota) : null, action: 'plans' };
  }
  if (kind === 'request' && (code === 'room_requested_for_other_firm' || e?.status === 409)) {
    return { tone: 'warn', title: 'This room was requested under another firm. Leave it from that firm before requesting it here.', body: null, action: 'switch' };
  }
  if (kind === 'add' && (code === 'already_in_flow' || e?.status === 409)) {
    return { tone: 'info', title: 'This deal is already in your deal flow.', body: 'The row shows its stage once the list is read again.', action: null };
  }
  if (kind === 'request') return { tone: 'bad', title: `Your invitation request for ${name} could not be recorded. Nothing changed.`, body: null, action: 'retry' };
  if (kind === 'leave') return { tone: 'bad', title: `You could not leave the ${name} room. You are still in it.`, body: null, action: 'retry' };
  return { tone: 'bad', title: `${name} could not be added to your deal flow.`, body: null, action: 'retry' };
}

/**
 * DE20: with the allowance full, Request an invitation stays on a refused row and opens this
 * instead of the review: nothing is sent, and the full sentence names the next plan.
 */
export function fullRefusal(quota) {
  return { tone: 'warn', title: 'Allowance full', body: fullSentence(quota), action: 'plans' };
}

/** DE22's saving line for each action. */
export function savingLine(kind, name) {
  if (kind === 'request') return `Requesting ${name}…`;
  if (kind === 'leave') return `Leaving the ${name} room…`;
  return `Adding ${name} to your deal flow…`;
}
