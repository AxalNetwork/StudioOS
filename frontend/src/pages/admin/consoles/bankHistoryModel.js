/**
 * D1186 (#3115, part 5 of #2389) — Bank accounts › History as pure functions
 * (BNK5, BNK8b): every reveal and every change, newest first, from part 1's
 * `GET /api/admin/bank-accounts/history` (D1182).
 *
 * The read pins a `snapshot` on its first page; every later page sends it
 * back, so a reveal recorded while you page does not shift the rows. A new
 * search or filter starts again without it.
 *
 * MASKED ALWAYS. An account is its `account_masked` ("••••4821") or a dash;
 * the Worker never sends more. A reveal's reason is the text the Worker sends
 * (digits already redacted); the number revealed is never in it.
 */
import { ENTITY_SHORT, timeText } from './bankCashModel.js';

export const PER_PAGE = 25;
export const Q_MAX = 120;

/** The Event filter: the read's `kind`. */
export const KINDS = [['', 'Every event'], ['reveal', 'Reveals'], ['bank_account', 'Account changes'], ['mercury', 'Mercury connection']];
/** The Dates filter: the read's `range`. */
export const RANGES = [['all', 'All dates'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days']];
export const ENTITIES = [['', 'Every entity'], ['holdings', 'Holdings'], ['management', 'Management'], ['gp', 'GP'], ['fund', 'Fund I']];

/** An event's words, from its stored action. */
export const EVENT_WORDS = {
  bank_account_revealed: 'Reveal',
  bank_account_added: 'Added',
  bank_account_updated: 'Changed',
  bank_account_retired: 'Retired',
  mercury_connected: 'Mercury connected',
  mercury_token_replaced: 'Token replaced',
  mercury_disconnected: 'Mercury disconnected',
};
export const eventOf = (row) => EVENT_WORDS[row?.action] || (row?.kind === 'reveal' ? 'Reveal' : 'Recorded');

/** The query the read takes; empty values are left out by the client. */
export function queryOf(f, page, snapshot) {
  return { q: String(f?.q || '').trim().slice(0, Q_MAX) || null, kind: f?.kind || null, entity: f?.entity || null,
    range: f?.range && f.range !== 'all' ? f.range : null, page, per: PER_PAGE, snapshot: page > 1 ? snapshot || null : null };
}

/** True when any filter or search narrows the read. */
export const filtered = (f) => !!(String(f?.q || '').trim() || f?.kind || f?.entity || (f?.range && f.range !== 'all'));

/**
 * One row as the table draws it. `reason` is set only for an admin's
 * reveal, which opens to it ("Full reason").
 */
export function rowOf(r) {
  const event = eventOf(r);
  const reveal = r?.kind === 'reveal';
  let detail, reason = null;
  if (reveal && r.context === 'capital_call_line') {
    detail = `An LP revealed their own capital-call line${r.context_ref ? ` (line #${r.context_ref})` : ''}.`;
  } else if (reveal) {
    reason = typeof r.context_ref === 'string' && r.context_ref.trim() ? r.context_ref.trim() : null;
    detail = reason ? `‘${reason}’` : 'No reason recorded.';
  } else if (r?.detail_unreadable) {
    detail = 'The detail of this event could not be read. Its action, time and person are as recorded.';
  } else if (r?.kind === 'mercury') {
    detail = `${event} for ${ENTITY_SHORT[r.entity_key] || 'an entity not recorded'}.`;
  } else {
    detail = r?.account_label ? `${r.account_label}.` : 'Account label not recorded.';
  }
  return {
    id: r?.id,
    when: timeText(r?.time) || 'Time not recorded',
    event,
    reveal,
    entity: ENTITY_SHORT[r?.entity_key] || 'Not recorded',
    account: r?.account_masked || '—',
    by: r?.actor_name || 'Name not recorded',
    detail,
    reason,
  };
}

/** "1–25 of 61", or "0 events". */
export function countText(data) {
  const total = Number(data?.total);
  if (!Number.isSafeInteger(total) || total < 0) return 'Count not recorded';
  if (total === 0) return '0 events';
  const page = Number(data?.page) || 1, per = Number(data?.per) || PER_PAGE;
  const start = (page - 1) * per + 1, end = Math.min(total, page * per);
  return `${start}–${end} of ${total}`;
}
export const pagesOf = (data) => Math.max(1, Math.ceil((Number(data?.total) || 0) / (Number(data?.per) || PER_PAGE)));

export const HISTORY_EMPTY = { title: 'Nothing has been revealed or changed yet.', line: 'Every reveal and change will be listed here.' };
export const HISTORY_NO_MATCH = 'No event matches this search and these filters.';
export const HISTORY_FOOT = 'Reveals are recorded before the number is shown. A reveal that could not be recorded showed nothing. Names and account labels are as they are today.';
