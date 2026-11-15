// D4838 part PP04 (#5937) — the rules `/pipeline/proposals` draws as a follow-up list.
//
// Pure: no React and no API import, so a Node test drives them with plain rows from
// `GET /partner/pipeline/proposals`. Every figure here comes from a field that read
// returns; nothing is inferred from silence.
//
//   lastActivity(r)   the newest recorded thing on a proposal: its decision, its latest
//                     version, or the send. The send carries only `days_since_sent`.
//   nextAction(r)     what the firm can do next, and where in the sheet it is done.
//   activityOf(r)     the proposal's own timeline, from its recorded stamps.
//   sheetTabs(r)      the sheet's tabs, as the row's data allows.
//   proposalStrip(d)  the four strip tiles, over the read's own counts.
//
// OPENS ARE NOT RECORDED. The read says so (`read_receipts: 'none'`), so no rule here
// counts an unopened or an opened proposal, and the strip's Opened tile is always
// Not recorded. "No decision" is what the record shows about a sent proposal: a reply
// short of a decision is not recorded on the quote either.
import { NO_REPLY_DAYS, ok, winRateMetric } from './commandCentre.js';

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const time = (iso) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? null : t;
};

/** "Sent today" / "Sent 3 days ago", or null when the read sent no age. */
export function sentPhrase(days) {
  const n = num(days);
  if (n === null) return null;
  return n <= 0 ? 'Sent today' : `Sent ${plural(n, 'day')} ago`;
}

/**
 * The proposal's timeline, newest first. Dated events (versions, the decision) sort by
 * their stamp; the send has only an age, and it is always the first thing that happened,
 * so it goes last.
 */
export function activityOf(r) {
  if (!r) return [];
  const dated = [];
  for (const v of Array.isArray(r.versions) ? r.versions : []) {
    if (time(v.created_at) === null) continue;
    dated.push({ key: `v-${v.id ?? v.version}`, at: v.created_at, text: `v${v.version} recorded · ${v.change_summary || 'no summary'}` });
  }
  const decidedWord = { Won: 'Won', Lost: 'Lost', Withdrawn: 'Withdrawn' }[r.state];
  if (decidedWord && time(r.decided_at) !== null) {
    dated.push({ key: 'decided', at: r.decided_at, text: decidedWord });
  }
  dated.sort((a, b) => time(b.at) - time(a.at));
  const sent = sentPhrase(r.days_since_sent);
  return sent ? [...dated, { key: 'sent', at: null, days: num(r.days_since_sent), text: sent }] : dated;
}

/** The newest recorded event, or null (drawn Not recorded) when the row carries none. */
export function lastActivity(r) {
  const all = activityOf(r);
  return all.length ? all[0] : null;
}

/** True for a proposal sent and undecided for at least `NO_REPLY_DAYS` (the command centre's rule). */
export function isQuiet(r) {
  const days = num(r?.days_since_sent);
  return r?.status === 'submitted' && days !== null && days >= NO_REPLY_DAYS;
}

/** The State column: the read's own state word, with what the record adds to it. */
export function stateOf(r) {
  if (!r) return { word: null, detail: null };
  if (r.state === 'Sent') return { word: 'Sent', detail: 'no decision recorded' };
  if (r.state === 'Lost') return { word: 'Lost', detail: r.loss_reason ? null : 'no reason recorded', reason: r.loss_reason || null };
  return { word: r.state || null, detail: null };
}

/**
 * What to do next. `tab` names the sheet tab the action opens; `to` is a link out.
 * A withdrawn proposal asks for nothing, and says so rather than drawing a button.
 */
export function nextAction(r) {
  if (!r) return null;
  if (r.status === 'submitted' || r.state === 'Sent') {
    return { key: 'follow-up', label: 'Follow up', tab: 'overview', urgent: isQuiet(r) };
  }
  if (r.state === 'Lost') {
    return r.loss_reason
      ? { key: 'review', label: 'Review', tab: 'outcome' }
      : { key: 'reason', label: 'Record why it was lost', tab: 'outcome', urgent: true };
  }
  if (r.state === 'Won') {
    return r.engagement_id
      ? { key: 'delivery', label: 'Open Delivery', to: '/delivery/board' }
      : { key: 'review', label: 'Review', tab: 'outcome' };
  }
  if (r.state === 'Withdrawn') return { key: 'none', label: null, text: 'Nothing to do' };
  return null;
}

export const TAB_LABEL = Object.freeze({
  overview: 'Overview', proposal: 'Proposal', activity: 'Activity', versions: 'Versions', outcome: 'Outcome',
});

/**
 * The sheet's tabs, in the issue's order, as the row allows. Overview, Versions and
 * Outcome always apply: every proposal has a version trail (v1 is the proposal itself)
 * and a state. Proposal needs a price or a timeline; Activity needs one recorded event.
 */
export function sheetTabs(r) {
  if (!r) return [];
  const tabs = ['overview'];
  if (num(r.price_dollars) !== null || num(r.timeline_weeks) !== null) tabs.push('proposal');
  if (activityOf(r).length) tabs.push('activity');
  tabs.push('versions', 'outcome');
  return tabs;
}

/**
 * The strip: Open proposals · Opened · No decision 7+ days · Win rate.
 *
 * `quiet` counts the rows read, so a partial read says it is a floor. The other three
 * are the Worker's whole-book figures. The win rate is `commandCentre`'s, so the root
 * and this zone print one figure from one rule: "No decided quotes" when nothing is
 * decided, otherwise the rate with "won of decided".
 */
export function proposalStrip(d) {
  const items = Array.isArray(d?.items) ? d.items : [];
  const quiet = items.filter(isQuiet).length;
  const partial = Boolean(d?.remainder_error);
  const win = winRateMetric(ok(d || {}));
  return {
    open: { label: 'Open proposals', value: String(num(d?.live_count) ?? 0) },
    opened: { label: 'Opened', recorded: false, note: 'Nothing records a client open' },
    quiet: {
      label: `No decision · ${NO_REPLY_DAYS}+ days`,
      value: partial ? `${quiet}+` : String(quiet),
      note: partial ? 'of the proposals read; the rest did not load' : 'sent, not won, lost or withdrawn',
    },
    win: { label: 'Win rate', value: win.value, note: win.basis, decided: win.state === 'value' },
  };
}
