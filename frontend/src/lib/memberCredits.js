/**
 * D633 (#1391, Q2) — the pure half of HQ · Team → a member's credits
 * (`hq-credits` in design/canvases/integrated/ops-data.js).
 *
 * The ledger comes from `GET /perks/admin/credits/:userId`; an adjustment goes
 * through D608's `POST /perks/admin/credits`. Every number here is read.
 */

export const REASON_MIN = 10;
export const NOTE_MAX = 500;
export const DELTA_MAX = 100000;
export const PAGE_SIZE = 25;

export const SOURCES = [
  { id: 'all', label: 'All sources' },
  { id: 'adjustment', label: 'Adjustment' },
  { id: 'reward', label: 'Reward' },
  { id: 'perk', label: 'Perk' },
  { id: 'taken_back', label: 'Taken back' },
];

export const PERIODS = [
  { id: 'all', label: 'Any time', days: null },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
  { id: '365', label: 'Last 12 months', days: 365 },
];

/** What a ledger line is, in the canvas's words, and the group it filters under. */
export function sourceOf(line) {
  const ref = String(line?.source_ref || '');
  const key = String(line?.rule_key || '');
  if (ref.startsWith('revoke:')) return { label: 'Taken back', group: 'taken_back' };
  if (line?.kind === 'spend') return { label: 'Perk claimed', group: 'perk' };
  if (line?.kind === 'refund') return { label: 'Perk refunded', group: 'perk' };
  if (key === 'manual' || (!key && line?.kind === 'admin_adjust')) return { label: 'Adjustment', group: 'adjustment' };
  if (key === 'task_approved') return { label: 'Task approved', group: 'reward' };
  if (key.startsWith('bug_')) return { label: 'Bug bounty', group: 'reward' };
  if (key.startsWith('feature_shipped_')) return { label: 'Feature shipped', group: 'reward' };
  if (key.startsWith('lab:')) return { label: 'Lab milestone', group: 'reward' };
  return { label: line?.kind === 'grant' ? 'Grant' : 'Adjustment', group: line?.kind === 'grant' ? 'reward' : 'adjustment' };
}

/** "+10" or "−25", the canvas's sign. */
export const changeText = (delta) => (Number(delta) > 0 ? `+${Number(delta)}` : `−${Math.abs(Number(delta))}`);

const dayMs = 86400000;
const stamp = (s) => Date.parse(String(s || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(s || '')) ? '' : 'Z'));

export function filterLedger(ledger, { q = '', source = 'all', period = 'all' } = {}, now = Date.now()) {
  const needle = q.trim().toLowerCase();
  const days = PERIODS.find((p) => p.id === period)?.days ?? null;
  return (ledger || []).filter((l) => {
    if (source !== 'all' && sourceOf(l).group !== source) return false;
    if (days !== null) {
      const t = stamp(l.created_at);
      if (!Number.isFinite(t) || t < now - days * dayMs) return false;
    }
    if (!needle) return true;
    return [l.note, l.source_ref, l.rule_key, sourceOf(l).label].some((v) => String(v ?? '').toLowerCase().includes(needle));
  });
}

export function pageOf(list, page = 1, size = PAGE_SIZE) {
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const at = Math.min(Math.max(1, page), pages);
  const rows = list.slice((at - 1) * size, at * size);
  const count = total === 0 ? '0 of 0' : `${(at - 1) * size + 1}–${(at - 1) * size + rows.length} of ${total}`;
  return { rows, page: at, pages, total, count };
}

/** A fresh idempotency key per opened form: the same submission sent twice is refused, not paid twice. */
export function newSourceRef(rand = () => Math.random().toString(36).slice(2, 10), now = Date.now()) {
  return `hq:${now.toString(36)}:${rand()}`;
}

/**
 * The adjustment as the Worker takes it, or the sentence the page refuses it
 * with before sending.
 */
export function planAdjust({ userId, amount, reason, note, sourceRef }) {
  const raw = String(amount ?? '').trim().replace(/^\+/, '').replace('−', '-');
  const delta = raw === '' ? NaN : Number(raw);
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > DELTA_MAX) {
    return { error: `Enter a whole number of credits, not zero: +10 to add, −10 to take away (at most ${DELTA_MAX.toLocaleString('en-US')}).` };
  }
  const why = String(reason ?? '').trim();
  if (why.length < REASON_MIN) return { error: `Say why, in at least ${REASON_MIN} characters. It is kept in the audit log.` };
  const told = String(note ?? '').trim();
  if (told.length > NOTE_MAX) return { error: `The note the member sees is at most ${NOTE_MAX} characters.` };
  return { body: { user_id: userId, delta, reason: why, note: told || undefined, source_ref: sourceRef } };
}

/** The Worker's refusal, as the canvas's titled sentence. */
export function adjustRefusal(err) {
  const code = err?.code || err?.data?.error;
  const bal = err?.data?.balance;
  if (code === 'would_overdraw') {
    return { title: 'Balance would go below zero', text: Number.isFinite(Number(bal)) ? `The member has ${bal} credits. Nothing was changed.` : (err?.message || 'Nothing was changed.') };
  }
  if (code === 'user_not_found') return { title: 'Unknown member', text: 'No account matches this id. Nothing was changed.' };
  if (code === 'already_recorded') return { title: 'Same change sent twice', text: 'This adjustment was already recorded. The second one was ignored.' };
  if (err?.status === 403) return { title: 'Super Admin only', text: 'Only the Super Admin adjusts credits. Nothing was changed.' };
  return { title: 'Not saved', text: err?.message || 'The adjustment could not be saved. Nothing was changed.' };
}

/** Save an adjustment. `{ ok: true, result }` or `{ ok: false, refusal: { title, text } }`. */
export async function submitAdjust(form, adjust) {
  const plan = planAdjust(form);
  if (plan.error) return { ok: false, refusal: { title: 'Not sent', text: plan.error } };
  try {
    return { ok: true, result: await adjust(plan.body) };
  } catch (e) {
    return { ok: false, refusal: adjustRefusal(e), cause: e };
  }
}
