// D801 (#2234) — every escalation kind's label, and the requests a licence's
// Administrator sends HQ (D799). The Worker's vocabulary is `ESCALATION_KINDS`
// in `rpc/hqOps.ts`; a kind this map does not name still reads, from its key.

/**
 * D799's four, as a sentence names them. The older kinds keep the words they
 * always had on the console (their key with spaces: "seat increase"), so a
 * page that reads them is unchanged.
 */
export const ESCALATION_KIND_LABELS = {
  renewal: 'renewal',
  terms_change: 'change of terms',
  delegate: 'delegate',
  non_renewal: 'notice of non-renewal',
};

/** D799's four new kinds, the ones the escalations console gains filters for. */
export const LICENCE_REQUEST_KINDS = ['renewal', 'terms_change', 'delegate', 'non_renewal'];

/**
 * What the licence's "Requests from the Administrator" panel lists: D799's four,
 * and `seat_increase`, which D799 gave the same request fields and the canvas
 * draws in the same list ("Seats · Founder +20").
 */
export const LICENCE_PANEL_KINDS = ['renewal', 'terms_change', 'seat_increase', 'delegate', 'non_renewal'];

export const escalationKindLabel = (kind) => ESCALATION_KIND_LABELS[kind] || String(kind || '').replace(/_/g, ' ');

const capitalised = (t) => String(t).replace(/^./, (c) => c.toUpperCase());

/** The console's filter choices: All, then each kind on the board with its count, D799's four always offered. */
export function kindFilters(items) {
  const counts = new Map();
  for (const it of items || []) counts.set(it.kind, (counts.get(it.kind) || 0) + 1);
  const kinds = [...new Set([...counts.keys(), ...LICENCE_REQUEST_KINDS])];
  return [
    { kind: '', label: 'All', count: (items || []).length },
    ...kinds.map((k) => ({ kind: k, label: capitalised(escalationKindLabel(k)), count: counts.get(k) || 0 })),
  ];
}

export const filterByKind = (items, kind) => (kind ? (items || []).filter((it) => it.kind === kind) : (items || []));

/** The canvas's word for each request (board L9, "Open requests"). */
const SUMMARY_WORDS = {
  seat_increase: 'Seats', terms_change: 'Change', delegate: 'Delegate', renewal: 'Renewal', non_renewal: 'Notice of non-renewal',
};

/** A request's one-line summary, from D799's `request` fields: "Seats · Founder +20". */
export function requestSummary(item) {
  const r = item?.request || {};
  const label = SUMMARY_WORDS[item?.kind] || capitalised(escalationKindLabel(item?.kind));
  switch (item?.kind) {
    case 'seat_increase':
      return r.seat_type ? `${label} · ${enumWord(r.seat_type)} +${r.seats ?? '?'}` : label;
    case 'delegate':
      return `${label} · ${r.name || r.email || 'not named'}`;
    case 'terms_change':
      return r.term ? `${label} · ${enumWord(r.term)}` : label;
    case 'renewal':
      return r.term_years ? `${label} · ${r.term_years} years` : label;
    default:
      return label;
  }
}

const enumWord = (v) => String(v).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * This licence's open requests of the panel's kinds. A request raised on HQ's
 * tier names the licence in `subject_ref` (D799); one raised by a branch is
 * matched by its branch code, when the licence has one.
 */
export function licenceRequests(items, licenceUid, branchCode = null) {
  return (items || []).filter((it) =>
    it.status === 'open'
    && LICENCE_PANEL_KINDS.includes(it.kind)
    && (it.subject_ref === licenceUid || (branchCode && it.branch_code === branchCode && it.branch_code !== 'hq')));
}

const DAY = 24 * 3600 * 1000;
const dayOf = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) : null);
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * A notice of non-renewal against the terms: given on the day HQ recorded it
 * (D799), due `noticeDays` before the licence renews. `in_time` is null when
 * either the notice period or the renewal date is not recorded.
 */
export function nonRenewalCheck(givenOn, renewsOn, noticeDays) {
  const given = dayOf(givenOn);
  const renews = dayOf(renewsOn);
  if (given === null) return { given_on: null, due_by: null, in_time: null, days_late: null };
  if (renews === null || noticeDays === null || noticeDays === undefined) {
    return { given_on: isoDay(given), due_by: null, in_time: null, days_late: null };
  }
  const due = renews - Number(noticeDays) * DAY;
  const late = Math.round((given - due) / DAY);
  return { given_on: isoDay(given), due_by: isoDay(due), in_time: late <= 0, days_late: late > 0 ? late : 0 };
}

/**
 * Where "Open terms" goes for a `terms_change`: a D797 term's own row on the
 * schedule, or the step that holds one of D799's four ledger terms.
 */
export function termTarget(term, scheduleKeys = []) {
  if (scheduleKeys.includes(term)) return { tab: 'schedule', key: term };
  return { tab: { fee: 'terms', term: 'terms', seats: 'seats', territory: 'territory' }[term] || 'schedule', key: null };
}

/** The term as HQ's ledger holds it, beside what the Administrator asks. */
export function termAsItStands(term, licence) {
  if (!licence) return null;
  switch (term) {
    case 'fee':
      return licence.annual_fee_cents === null || licence.annual_fee_cents === undefined
        ? 'Annual fee not recorded'
        : `Annual fee ${licence.currency || ''} ${(Number(licence.annual_fee_cents) / 100).toLocaleString('en-GB')}`.replace(/\s+/g, ' ');
    case 'term':
      return `${licence.term_years ? `${licence.term_years} years` : 'Term not recorded'}${licence.renews_on ? `, renews ${licence.renews_on}` : ''}`;
    case 'seats': {
      const s = Object.entries(licence.seats || {}).filter(([, n]) => Number(n) > 0);
      return s.length ? s.map(([k, n]) => `${enumWord(k)} ${n}`).join(' · ') : 'No seats licensed';
    }
    case 'territory':
      return (licence.territories || []).length ? licence.territories.join(', ') : 'No territory held';
    default:
      return null;
  }
}
