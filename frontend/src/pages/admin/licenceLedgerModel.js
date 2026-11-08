/**
 * D4819 (#4819), Build part 1 — the HQ licence ledger's operating summary, as
 * pure functions over the three reads the page already makes: the ledger page
 * (`GET /api/admin/licences`), the summary (`/summary`) and each loaded
 * licence's open requests (`/:uid/requests`). Nothing here reads anything
 * else, so nothing here can claim a state those reads do not carry.
 *
 * THREE MEANINGS, NEVER ZERO (canvas board L19):
 *   - None          the read succeeded and there is genuinely nothing;
 *   - Not recorded  no authoritative value is on the record;
 *   - Unavailable   the read failed, so the value is unknown.
 * A fourth, Not instrumented, is a fact no ledger read carries at all (the
 * agreement's state, the branch's sync, the licence's invoices). It is said
 * as that, never as 0 and never as None.
 */
import { daysTo } from '../../lib/notices';

/** How near a renewal has to be before it needs HQ: the canvas's "renew in the next 90 days". */
export const RENEWAL_WINDOW_DAYS = 90;

/** The licence statuses the ledger reads, in its own order, with the words the counts line uses. */
export const LEDGER_STATUSES = Object.freeze([
  ['active', 'active'],
  ['suspended', 'suspended'],
  ['pending_activation', 'pending activation'],
  ['draft', 'draft'],
  ['terminated', 'terminated'],
]);
export const STATUS_KEYS = Object.freeze(LEDGER_STATUSES.map(([k]) => k));
export const statusFromParam = (param) => (STATUS_KEYS.includes(param) ? param : '');

/** The canvas's sections, in its order. The detail slice draws them; today each opens the tab below. */
export const LICENCE_SECTIONS = Object.freeze(['overview', 'terms', 'agreement', 'access', 'operations', 'history']);

/**
 * A ledger row's state for one cell: `{ state, label }`, where `state` is one
 * of `value | none | not_recorded | unavailable | not_instrumented | reading`.
 */
const cell = (state, label) => ({ state, label });

/** How far off a licence's renewal is, or null when it has no date or is not running. */
export function renewalDays(l) {
  if (!l?.renews_on || !['active', 'suspended'].includes(l.status)) return null;
  return daysTo(l.renews_on);
}

/** True when the licence renews within the window, or is already past its date. */
export function renewalApproaching(l) {
  const d = renewalDays(l);
  return d !== null && d <= RENEWAL_WINDOW_DAYS;
}

export function territoryCell(l) {
  const t = Array.isArray(l?.territories) ? l.territories : null;
  if (!t) return cell('unavailable', 'Unavailable');
  return t.length ? cell('value', t.join(' · ')) : cell('none', 'None');
}

export function renewalCell(l) {
  if (!l?.renews_on) return cell('not_recorded', 'Not recorded');
  const d = renewalDays(l);
  if (d !== null && d < 0) return cell('overdue', `${l.renews_on} · ${-d}d overdue`);
  if (d !== null && d <= RENEWAL_WINDOW_DAYS) return cell('due', `${l.renews_on} · in ${d}d`);
  return cell('value', l.renews_on);
}

/**
 * One licence's open requests, from what `/:uid/requests` answered:
 * `undefined` (not read yet), `{ ok: true, total }` or `{ ok: false }`.
 */
export function requestsCell(read) {
  if (!read) return cell('reading', 'Reading…');
  if (!read.ok) return cell('unavailable', 'Unavailable');
  if (!read.total) return cell('none', 'None');
  return cell('value', `${read.total} waiting`);
}

/** The columns the ledger read does not carry, and the section of the licence that does. */
export const NOT_ON_LEDGER = Object.freeze({
  agreement: { label: 'Agreement', section: 'agreement' },
  branch: { label: 'Branch', section: 'operations' },
  billing: { label: 'Billing', section: 'fee-invoices' },
});
export const notInstrumentedCell = () => cell('not_instrumented', 'Not instrumented');

/**
 * What one licence needs from HQ, as far as the reads tell: `{ items, complete }`.
 * `complete` is false when its requests could not be read, so a row with no
 * known item never reads as needing nothing.
 */
export function attentionOf(l, read) {
  const items = [];
  if (renewalApproaching(l)) items.push('renewal');
  if (read?.ok && read.total > 0) items.push('requests');
  return { items, complete: Boolean(read?.ok) };
}

export function attentionCell(l, read) {
  const a = attentionOf(l, read);
  const n = a.items.length;
  const said = `${n} ${n === 1 ? 'item' : 'items'}`;
  if (!read) return n ? cell('value', said) : cell('reading', 'Reading…');
  if (!a.complete) return n ? cell('value', `${said} · requests Unavailable`) : cell('unavailable', 'Unavailable');
  return n ? cell('value', said) : cell('none', 'None');
}

/**
 * The Needs HQ items the reads can compute, each a filter of the table. The
 * three the canvas also draws (agreements incomplete, branch out of sync,
 * overdue invoice) need reads the ledger does not make; `NOT_INSTRUMENTED`
 * names them so the page says so instead of showing a 0.
 */
export const NEEDS = Object.freeze([
  {
    key: 'requests',
    title: 'Requests waiting',
    label: (n) => `${n} ${n === 1 ? 'request' : 'requests'} waiting`,
    matches: (l, read) => Boolean(read?.ok && read.total > 0),
  },
  {
    key: 'renewal',
    title: 'Renewals approaching',
    label: (n) => `${n} ${n === 1 ? 'renewal' : 'renewals'} approaching`,
    matches: (l) => renewalApproaching(l),
  },
]);
export const NEED_KEYS = Object.freeze(NEEDS.map((n) => n.key));
export const NOT_INSTRUMENTED = Object.freeze(['Agreements incomplete', 'Branch out of sync', 'Overdue invoices']);

/** The `?needs=` value as the list of keys it names, in NEEDS order; anything unknown is dropped. */
export function needsFromParam(param) {
  const asked = String(param || '').split(',').map((s) => s.trim());
  return NEED_KEYS.filter((k) => asked.includes(k));
}
export const needsToParam = (keys) => (keys.length ? NEED_KEYS.filter((k) => keys.includes(k)).join(',') : null);

/**
 * The Needs HQ summary over the loaded rows: one entry per NEEDS item with its
 * `count`, or `state: 'unavailable'` when an input it needs could not be read.
 * Requests count only once every loaded row's read has answered; until then
 * the item is `reading`, never a partial count dressed as the whole.
 */
export function needsSummary(rows, reads) {
  const list = Array.isArray(rows) ? rows : [];
  return NEEDS.map((n) => {
    if (n.key === 'requests') {
      if (list.some((l) => reads?.[l.uid] && !reads[l.uid].ok)) return { key: n.key, state: 'unavailable', label: `${n.title} · Unavailable` };
      if (list.some((l) => !reads?.[l.uid])) return { key: n.key, state: 'reading', label: `${n.title} · Reading…` };
    }
    const count = list.filter((l) => n.matches(l, reads?.[l.uid])).length;
    return count
      ? { key: n.key, state: 'value', count, label: n.label(count) }
      : { key: n.key, state: 'none', count: 0, label: `${n.title} · None` };
  });
}

/** The rows every chosen Needs HQ item matches (all of them, so two chips narrow). */
export function filterByNeeds(rows, reads, keys) {
  const list = Array.isArray(rows) ? rows : [];
  if (!keys?.length) return list;
  const chosen = NEEDS.filter((n) => keys.includes(n.key));
  return list.filter((l) => chosen.every((n) => n.matches(l, reads?.[l.uid])));
}

/**
 * The counts line from the summary's `counts`: "12 licences · 9 active ·
 * 1 suspended · 2 draft". Active, suspended and draft are always said (the
 * canvas's line); pending activation and terminated only when there are any.
 * Null when the counts are not a number, so the caller says Unavailable.
 */
export function countsLine(counts) {
  const total = Number(counts?.total);
  if (!counts || !Number.isFinite(total)) return null;
  const by = counts.by_status || {};
  const parts = LEDGER_STATUSES
    .filter(([k]) => ['active', 'suspended', 'draft'].includes(k) || Number(by[k]) > 0)
    .map(([k, word]) => `${Number(by[k]) || 0} ${word}`);
  return { total, head: `${total} ${total === 1 ? 'licence' : 'licences'}`, parts };
}

/**
 * True when the ledger holds no licence at all. Without a filter the page's own
 * total says so; with one, only the summary can (a filter that matches nothing
 * is not an empty ledger). Unknown counts are not zero.
 */
export function ledgerIsEmpty({ total, filtered, summaryTotal }) {
  if (!filtered) return total === 0;
  return summaryTotal === 0;
}

/**
 * Canvas section (or an existing tab key) → the tab the detail pane opens.
 * The canvas's six sections are the detail slice's; until then each opens the
 * nearest existing tab, and a tab's own key opens itself.
 */
const SECTION_TAB = Object.freeze({
  overview: 'entity',
  terms: 'terms',
  agreement: 'contract',
  access: 'admins',
  operations: 'deploy',
  history: 'history',
});

export function tabForSection(section, tabKeys) {
  const s = String(section || '').trim().toLowerCase();
  if (SECTION_TAB[s]) return SECTION_TAB[s];
  if (Array.isArray(tabKeys) && tabKeys.includes(s)) return s;
  return SECTION_TAB.overview;
}
