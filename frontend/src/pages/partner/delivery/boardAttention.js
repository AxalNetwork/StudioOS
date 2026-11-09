// D4822 (#4822) — Delivery Board v2's reading of one engagement row: why it needs attention, what to do next,
// its progress and its mode in words. Pure over the row `GET /api/partner-delivery/board` answers, so every
// state is tested without a page.
//
// ATTENTION IS FACTS, NEVER A SCORE. A row needs attention for what the record shows: an open milestone past its
// date, an open blocker, scope drift the firm recorded, no owner, or a health the firm's own read rated at risk
// or blocked. An unrated engagement is NOT attention-worthy for that alone: "Not rated" is drawn on its own, and
// silence never becomes red, green or zero. Nothing here infers a client read (no product sets `opened_at`).
//
// A REPORT NOT YET SENT IS A NEXT ACTION, NOT AN ALARM. No reporting cadence is stored, so "due" would be a date
// nobody agreed; the row says the period's report is not sent and offers drafting it, and nothing more.

export const HEALTH_WORD = { on_track: 'On track', at_risk: 'At risk', blocked: 'Blocked' };
export const NOT_RATED = 'Not rated';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const monthName = (period) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
};

/** A closed engagement (cancelled, or every seat revoked) needs no action on the board. */
export function isClosed(row) {
  return Boolean(row?.cancelled_at) || row?.seat_state === 'revoked';
}

/** The supported reasons this row needs attention, most urgent first. Empty: it needs none. */
export function attentionReasons(row) {
  if (!row || isClosed(row)) return [];
  const out = [];
  if (row.open_blockers > 0) {
    out.push({ key: 'blocker', text: row.open_blockers_client_side > 0
      ? `${plural(row.open_blockers, 'blocker')} open · ${row.open_blockers_client_side} on the client’s side`
      : `${plural(row.open_blockers, 'blocker')} open` });
  }
  if (row.milestones_overdue > 0) out.push({ key: 'overdue', text: `${plural(row.milestones_overdue, 'milestone')} overdue` });
  if (row.scope_state === 'drift') out.push({ key: 'scope', text: 'Scope drift recorded' });
  if (row.owner_user_id == null) out.push({ key: 'owner', text: 'Owner unassigned' });
  // The firm's own read rated it badly for a reason none of the above names (e.g. retained hours over scope).
  if ((row.health === 'at_risk' || row.health === 'blocked') && !out.some((r) => r.key === 'blocker' || r.key === 'overdue')) {
    const why = (row.health_reasons || []).find(Boolean);
    out.push({ key: 'health', text: why ? `${HEALTH_WORD[row.health]} · ${why}` : HEALTH_WORD[row.health] });
  }
  return out;
}

export const needsAttention = (row) => attentionReasons(row).length > 0;

/** The one next action the row shows, from the most urgent reason; then the period's report; then nothing. */
export function nextAction(row) {
  if (!row) return null;
  if (isClosed(row)) return { text: row.cancelled_at ? 'Engagement cancelled' : 'Seat revoked by the client', quiet: true };
  const reasons = attentionReasons(row);
  const first = reasons[0];
  if (first?.key === 'blocker') return { text: row.open_blockers_client_side > 0 ? 'Follow up with the client on the open blocker' : 'Clear the open blocker', why: reasons.map((r) => r.text).join(' · '), zone: 'health' };
  if (first?.key === 'overdue') return { text: `Re-plan the ${plural(row.milestones_overdue, 'overdue milestone')}`, why: reasons.map((r) => r.text).join(' · '), zone: 'health' };
  if (first?.key === 'scope') return { text: 'Review the scope drift', why: reasons.map((r) => r.text).join(' · '), zone: 'health' };
  if (first?.key === 'owner') return { text: 'Assign an owner', why: reasons.map((r) => r.text).join(' · '), zone: 'health' };
  if (first?.key === 'health') return { text: 'Review health', why: first.text, zone: 'health' };
  const month = monthName(row.report_period);
  if (row.report_state === 'draft') return { text: `Review the ${month || 'current'} report and mark it sent`, zone: 'status-reports' };
  if (row.report_state == null && month) return { text: `Draft the ${month} report`, zone: 'status-reports', quiet: true };
  return { text: 'Nothing needs action', quiet: true };
}

/** Progress in the mode's own measure; null when nothing is recorded to measure. */
export function progressText(row) {
  if (!row) return null;
  if (row.mode === 'project') return row.milestone_count ? `${row.milestones_done} / ${row.milestone_count} milestones` : null;
  if (row.seat_state === 'revoked') return 'Seat revoked';
  const h = Number(row.hours_this_period ?? 0);
  const per = row.hours_period ? (String(row.hours_period).includes('Q') ? 'this quarter' : 'this month') : 'this period';
  return row.hours_cap != null ? `${h}h / ${row.hours_cap}h ${per}` : `${h}h ${per} · no retained-hours cap`;
}

const dollars = (n) => (n >= 1000 ? `$${Math.round(n / 100) / 10}k`.replace('.0k', 'k') : `$${Math.round(n)}`);

/** "Project · $48k" or "Embedded seat · $9k / mo"; the value only when one is recorded. */
export function modeValue(row) {
  if (row?.mode === 'embedded') {
    return row.recurring_monthly_cents != null ? `Embedded seat · ${dollars(row.recurring_monthly_cents / 100)} / mo` : 'Embedded seat';
  }
  return row?.price != null ? `Project · ${dollars(Number(row.price))}` : 'Project';
}

/** The four view counts the segmented control shows. */
export function boardCounts(items) {
  const list = items || [];
  return {
    attention: list.filter(needsAttention).length,
    all: list.length,
    project: list.filter((r) => r.mode === 'project').length,
    embedded: list.filter((r) => r.mode === 'embedded').length,
  };
}

export function matchesView(row, view, query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (q && !String(row.client || '').toLowerCase().includes(q)) return false;
  if (view === 'attention') return needsAttention(row);
  if (view === 'project') return row.mode === 'project';
  if (view === 'embedded') return row.mode === 'embedded';
  return true;
}

/**
 * The page's one contextual primary action: no engagement → Open Pipeline; something needs attention → Review
 * attention; otherwise a period report not yet sent → Draft status report; otherwise none.
 */
export function primaryAction(items) {
  const list = items || [];
  if (!list.length) return { key: 'pipeline', label: 'Open Pipeline', to: '/pipeline/proposals' };
  if (list.some(needsAttention)) return { key: 'attention', label: 'Review attention' };
  if (list.some((r) => !isClosed(r) && r.report_state !== 'sent')) return { key: 'report', label: 'Draft status report', to: '/delivery/status-reports' };
  return null;
}

/** The view the board opens on: Attention when anything needs it, else All. */
export const defaultView = (items) => ((items || []).some(needsAttention) ? 'attention' : 'all');
