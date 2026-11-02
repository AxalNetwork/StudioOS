import { NOT_RECORDED } from '../../lib/absence';
import { ONE_OPEN, accessWord, timeOf } from '../../ui/reasonGate';

/**
 * D1464 (#4021): the founder's list of reasoned support reads on a record
 * opened once per reason (the Data room, Capital relationships). Pure, so the
 * tests read it without a page.
 *
 * One row: "<name> · <Studio admin|HQ>", the reason, "<when> · one open".
 * A name, kind, reason or time the Worker did not record says so; nothing is
 * invented. A list that could not be read is "Unreadable", never empty.
 */

export const SUPPORT_READS_TITLE = 'Support reads';
export const SUPPORT_READS_LINE = 'An admin gives a reason each time they open this. You see each open here.';
export const NO_READS = Object.freeze({
  'data-room': 'No admin has read your data room.',
  'capital-relationships': 'No admin has read your capital relationships.',
});
export const READS_UNREADABLE = 'Unreadable';

/** "1 Nov 2026, 20:31" (UTC, as recorded) or null when the time cannot be read. */
export function readWhen(value) {
  const ms = timeOf(value);
  if (ms == null) return null;
  const d = new Date(ms);
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** One read, as the founder's card draws it. */
export function supportReadRow(r) {
  const name = String(r?.reader?.name ?? '').trim();
  const kind = accessWord(r?.reader?.kind);
  const reason = String(r?.reason ?? '').replace(/\s+/g, ' ').trim();
  return {
    id: r?.id,
    who: `${name || NOT_RECORDED} · ${kind || NOT_RECORDED}`,
    reason: reason || NOT_RECORDED,
    when: `${readWhen(r?.created_at) || NOT_RECORDED} · ${ONE_OPEN}`,
  };
}

/** The Worker's page of reads, as rows; an answer that is not a list is not a read. */
export function supportReadRows(body) {
  if (!body || !Array.isArray(body.reads)) return null;
  return body.reads.map(supportReadRow);
}
