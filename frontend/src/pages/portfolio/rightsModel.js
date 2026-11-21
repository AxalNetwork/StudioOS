/**
 * D6868 (#6868, canvas PRM18 and PRM19 of `Portfolio v2 Rights and Request a Mark`): the pure model of Ownership &
 * rights on a company's Financials tab. No React, no fetch, no clock.
 *
 * It reads:
 *   - `GET /api/positions` — the caller's position: rounds, invested, the latest ownership as recorded;
 *   - `GET /api/reporting/companies/:uid` — the reporting duties this company owes the caller, and the route;
 *   - `GET /api/portfolio-rights/:uid` (D6868) — the six rights in order, each recorded with its document and
 *     clause or not, and the caller's own requests that HQ record one.
 *
 * A right with no row reads "Not recorded at closing", never "none" and never a right inferred from a template. When
 * no right and no duty is recorded the section says so plainly and offers "Ask HQ to record a right…" (PRM19 a).
 */
import { NOT_RECORDED, day, money, percent } from './portfolioModel';
import { ROUTE_WORDS } from '../investor/portfolioReportsModel';

export const RIGHT_TYPES = Object.freeze(['pro_rata', 'information_rights', 'board_seat', 'observer_seat', 'liquidation_preference', 'anti_dilution']);
export const RIGHT_WORDS = Object.freeze({
  pro_rata: 'Pro rata',
  information_rights: 'Information rights',
  board_seat: 'Board seat',
  observer_seat: 'Observer seat',
  liquidation_preference: 'Liquidation preference',
  anti_dilution: 'Anti-dilution',
});
export const NOT_RECORDED_AT_CLOSING = 'Not recorded at closing';
export const REQUEST_STATE_WORDS = Object.freeze({ open: 'Requested', recorded: 'Recorded', declined: 'Declined' });
export const DESCRIPTION_MAX = 2000;

/** What the rights read must carry to be read at all. */
export const RIGHTS_SHAPE = (v) => Array.isArray(v?.rights) && Array.isArray(v?.requests);

const isNum = (v) => v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v));

/**
 * The holding line (PRM18): the route, the rounds, the amount invested and the ownership as recorded. Each cell
 * that the book does not hold reads Not recorded with what is missing.
 */
export function holdingCells(position, route) {
  const rounds = isNum(position?.rounds) ? Number(position.rounds) : 0;
  const invested = money(position?.total_invested);
  const own = percent(position?.latest_ownership_pct);
  const asOf = day(position?.latest_date);
  return [
    {
      key: 'route',
      label: 'Holding route',
      value: route && route !== 'mixed' ? ROUTE_WORDS[route] || null : route === 'mixed' ? 'Several holdings' : null,
      note: route ? null : 'no reporting duty records how this is held',
    },
    {
      key: 'rounds',
      label: 'Rounds',
      value: rounds ? `${rounds} ${rounds === 1 ? 'round' : 'rounds'}` : null,
      note: position?.latest_round ? `latest: ${position.latest_round}` : rounds ? null : 'no round recorded',
    },
    { key: 'invested', label: 'Invested · USD', value: invested, note: invested ? 'gross' : 'no amount recorded' },
    {
      key: 'ownership',
      label: asOf ? `Ownership % · as recorded ${asOf}` : 'Ownership % · as recorded',
      value: own,
      note: own ? 'no basis stored' : 'no ownership recorded',
    },
  ];
}

/** The caller's open request for one right type, or null. */
export function openRequestFor(requests, type) {
  return (requests || []).find((q) => q?.type === type && q?.state === 'open') || null;
}

/** "Investors’ Rights Agreement §2.1 · signed 31 Mar 2026", or null. */
export function sourceLine(right) {
  if (!right?.recorded) return null;
  const doc = [right.document_title, right.clause].filter(Boolean).join(' ');
  const signed = day(right.signed_on);
  return { doc, signed: signed ? `signed ${signed}` : 'signing date not recorded' };
}

/**
 * The rights table's rows: the reporting duties row (from the duties read: a count, or the read's own state), then
 * the six rights in the Worker's order. `duties` is `{ state: 'ok', count }`, `{ state: 'loading' }` or
 * `{ state: 'unreadable' }`.
 */
export function rightsRows(value, duties) {
  const requests = value?.requests || [];
  const byType = new Map((value?.rights || []).map((x) => [x?.type, x]));
  const reporting = {
    key: 'reporting',
    label: 'Reporting duties',
    kind: 'duties',
    state: duties?.state === 'ok' ? (duties.count > 0 ? 'recorded' : 'none') : duties?.state || 'loading',
    count: duties?.state === 'ok' ? duties.count : null,
  };
  const rights = RIGHT_TYPES.map((type) => {
    const right = byType.get(type) || { type, recorded: false };
    const open = openRequestFor(requests, type);
    return {
      key: type,
      type,
      label: RIGHT_WORDS[type],
      kind: 'right',
      state: right.recorded ? 'recorded' : 'not_recorded',
      source: sourceLine(right),
      terms: right.recorded ? right.terms : null,
      open: open ? { uid: open.uid, since: day(open.created_at) } : null,
    };
  });
  return [reporting, ...rights];
}

/** True when the documents record nothing: no duty and no right (PRM19 a's measured None). */
export function nothingRecorded(rows) {
  return rows.every((r) => (r.kind === 'duties' ? r.state === 'none' : r.state === 'not_recorded'));
}

/** The right types the caller may ask HQ to record now: not recorded and with no open request. */
export function askableTypes(rows) {
  return rows.filter((r) => r.kind === 'right' && r.state === 'not_recorded' && !r.open).map((r) => r.type);
}

/** The caller's requests to record a right, newest first, in the page's words. */
export function requestRows(requests) {
  return (requests || []).slice()
    .sort((a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')))
    .map((q) => {
      const when = q.state === 'open' ? day(q.created_at) : day(q.answered_at);
      return {
        key: q.uid,
        right: RIGHT_WORDS[q.type] || NOT_RECORDED,
        described: q.description || NOT_RECORDED,
        state: q.state,
        stateText: `${REQUEST_STATE_WORDS[q.state] || NOT_RECORDED}${when ? ` · ${when}` : ''}`,
        note: q.state === 'declined' ? q.answer_note || null : null,
      };
    });
}

/** The form's own check before sending: null, or the sentence to show. */
export function askProblem({ type, description } = {}, allowed = RIGHT_TYPES) {
  if (!allowed.includes(type)) return 'Choose which right to record.';
  const d = String(description || '').trim();
  if (!d) return 'Say where the right is written: the document and its clause.';
  if (d.length > DESCRIPTION_MAX) return `Keep it to ${DESCRIPTION_MAX} characters.`;
  return null;
}

/** A refusal, read by its code; a Worker detail never reaches the page. */
const REFUSALS = Object.freeze({
  request_open: 'You already asked HQ to record this right. HQ answers it before you ask again.',
  not_held: 'This company is not one you hold, so HQ cannot record a right for you here.',
  investor_only: 'Only an investor can ask HQ to record a right.',
  bad_type: 'Choose which right to record.',
  description_required: 'Say where the right is written: the document and its clause.',
  description_too_long: `Keep it to ${DESCRIPTION_MAX} characters.`,
});
export function askRefusal(e) {
  return REFUSALS[e?.code] || 'The request was not sent. Nothing was recorded; try again.';
}

/* ---------------------------------------------------------------- HQ's side (the admin position sheet) */

/**
 * The admin read (`scope: 'all_holders'`) as HQ works it: open requests first, oldest first (the queue), then each
 * holder with their six rights, recorded or not, then answered requests, newest first.
 */
export function adminRightsOf(value) {
  const requests = Array.isArray(value?.requests) ? value.requests : [];
  const open = requests.filter((q) => q?.state === 'open').sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const answered = requests.filter((q) => q?.state !== 'open').sort((a, b) => String(b.answered_at || '').localeCompare(String(a.answered_at || '')));
  const rights = Array.isArray(value?.rights) ? value.rights : [];
  const holders = (Array.isArray(value?.holders) ? value.holders : []).map((hd) => ({
    id: hd.id,
    name: hd.name || 'Investor (name not recorded)',
    rights: RIGHT_TYPES.map((type) => {
      const r = rights.find((x) => x?.type === type && Number(x?.holder?.id) === Number(hd.id));
      return r ? { type, label: RIGHT_WORDS[type], recorded: true, right: r, source: sourceLine({ ...r, recorded: true }) } : { type, label: RIGHT_WORDS[type], recorded: false };
    }),
  }));
  return { open, answered, holders };
}

/** Who asked: their name, or "Investor (name not recorded)", never a guess. */
export const requesterWord = (q) => q?.requester?.name || 'Investor (name not recorded)';

/** The record form's own check before sending: null, or the sentence to show. */
export function recordProblem({ documentTitle, terms, signedOn } = {}) {
  if (!String(documentTitle || '').trim()) return 'Name the signed document the right is in.';
  if (!String(terms || '').trim()) return 'Say what the right grants, as the document says it.';
  if (signedOn && !/^\d{4}-\d{2}-\d{2}$/.test(signedOn)) return 'Give the signing date as YYYY-MM-DD.';
  return null;
}

const ADMIN_REFUSALS = Object.freeze({
  not_a_holder: 'That investor does not hold this company through a confirmed commitment.',
  request_answered: 'This request was answered meanwhile. The list is read again.',
  request_mismatch: 'That request is for another right or another holder.',
  note_required: 'Say why, in words the investor reads.',
  document_required: 'Name the signed document the right is in.',
  terms_required: 'Say what the right grants, as the document says it.',
  bad_signed_on: 'Give the signing date as YYYY-MM-DD.',
});
export function adminRefusal(e) {
  return ADMIN_REFUSALS[e?.code] || 'It was not saved. Nothing changed; try again.';
}
