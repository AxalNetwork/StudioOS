/**
 * D804 (#2241) — the "Request a change" sheet (canvas boards L5 and L8): a
 * panel on the right on a wide screen, the whole screen on a phone.
 *
 * Its chips map to D799's kinds (`CHANGE_CHIPS`): Seats sends a
 * `seat_increase`; Territory, Fee, Term and "A deal term" send a
 * `terms_change` carrying the term "As it stands" and what is asked. A deal
 * term is one the Worker accepts beyond the four ledger terms
 * (`requestable_terms`); D797's keys join that list when it merges, and until
 * then the chip says there is none to pick. It sends through D799's module and
 * nothing else; nothing changes until HQ answers.
 *
 * PREFILLED FROM THE TERMS TAB (D800): `/admin/my-licence/requests?change=<term>`
 * opens it on that term's chip (`requestChangeHref`).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { licenceRequestsApi } from '../../../lib/api/licenceRequests';
import { reportError } from '../../../lib/log';
import { CHANGE_CHIPS, asItStands, buildChangeRequest, chipForTerm, dealTerms, responseSentence } from './licenceTabsModel';

/** Where the Terms tab's "Request a change" points, for one term. */
export const requestChangeHref = (term) => `/admin/my-licence/requests?change=${encodeURIComponent(term || '')}`;

const INPUT = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900';
const upper = (v) => String(v).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** The sheet's frame: the whole screen on a phone, 460px on the right from `sm` up. */
export const SHEET_CLASS = 'fixed inset-0 z-50 flex flex-col overflow-auto bg-white shadow-2xl dark:bg-gray-900 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[460px] sm:border-l sm:border-gray-200 dark:sm:border-gray-800';

export default function RequestChangeSheet({
  open, prefillTerm = null, startChip = null, licence, sections, terms, requestable = [], seatTypes = [], responseHours = {},
  onClose, onSent, api = licenceRequestsApi,
}) {
  const [chip, setChip] = useState(() => startChip || chipForTerm(prefillTerm));
  const deals = useMemo(() => dealTerms(requestable), [requestable]);
  const [dealTerm, setDealTerm] = useState(() => (prefillTerm && deals.includes(prefillTerm) ? prefillTerm : ''));
  const [seatType, setSeatType] = useState(seatTypes[0] || 'founder');
  const [seats, setSeats] = useState('');
  const [asked, setAsked] = useState('');
  const [why, setWhy] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setChip(startChip || chipForTerm(prefillTerm)); setErr(''); } }, [open, prefillTerm, startChip]);
  if (!open) return null;

  const current = asItStands(chip, { licence, sections, dealTerm, terms });

  async function send(e) {
    e.preventDefault();
    const built = buildChangeRequest(chip, { asked, why, current, seatType, seats: seats === '' ? NaN : Number(seats), dealTerm });
    if (!built.ok) { setErr(built.message); return; }
    setBusy(true); setErr('');
    try {
      const row = await api.raise(built.body);
      onSent?.(row);
    } catch (e2) { reportError('licence_change_request_failed', e2); setErr(e2?.message || 'The request could not be sent. Nothing was sent.'); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 hidden bg-black/20 sm:block" aria-hidden="true" onClick={onClose} />
      <aside className={SHEET_CLASS} role="dialog" aria-modal="true" aria-label="Request a change" data-testid="request-change-sheet">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Request a change</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-gray-100"><X size={16} /></button>
        </div>
        <form onSubmit={send} className="flex-1 space-y-4 px-4 py-4">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">What to change</div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="What to change">
              {CHANGE_CHIPS.map((c) => (
                <button key={c.id} type="button" aria-pressed={chip === c.id} data-chip={c.id}
                  onClick={() => { setChip(c.id); setErr(''); }}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${chip === c.id
                    ? 'border-slate-400 bg-slate-100 text-slate-800 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100'
                    : 'border-gray-200 bg-white text-gray-600 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:text-gray-100'}`}>
                  {c.t}
                </button>
              ))}
            </div>
          </div>
          {chip === 'deal' && (
            deals.length
              ? (
                <label className="block text-xs text-gray-600 dark:text-gray-400">Deal term
                  <select className={`${INPUT} mt-0.5`} value={dealTerm} onChange={(e) => setDealTerm(e.target.value)}>
                    <option value="">Pick a term</option>
                    {deals.map((t) => <option key={t} value={t}>{upper(t)}</option>)}
                  </select>
                </label>
              )
              : <p className="text-xs text-gray-500" data-testid="no-deal-terms">No deal term can be requested yet: the terms schedule is not on this licence.</p>
          )}
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">As it stands · read-only</div>
            <div className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:bg-gray-950 dark:text-gray-300" data-testid="as-it-stands">{current}</div>
          </div>
          {chip === 'seats' ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-gray-600 dark:text-gray-400">Seat type
                <select className={`${INPUT} mt-0.5`} value={seatType} onChange={(e) => setSeatType(e.target.value)}>
                  {(seatTypes.length ? seatTypes : ['founder', 'investor', 'advisor', 'partner']).map((t) => <option key={t} value={t}>{upper(t)}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-600 dark:text-gray-400">More seats
                <input className={`${INPUT} mt-0.5`} inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} placeholder="20" />
              </label>
            </div>
          ) : null}
          <label className="block text-xs text-gray-600 dark:text-gray-400">What you are asking for
            <textarea className={`${INPUT} mt-0.5`} rows={2} maxLength={500} value={asked} onChange={(e) => setAsked(e.target.value)}
              placeholder={chip === 'seats' ? 'e.g. 20 more founder seats from 1 Dec' : 'What the term should become'} />
          </label>
          <label className="block text-xs text-gray-600 dark:text-gray-400">Why
            <textarea className={`${INPUT} mt-0.5`} rows={3} maxLength={4000} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="The reason HQ should agree" />
          </label>
          <p className="text-xs text-gray-600 dark:text-gray-400" data-testid="response-sentence">{responseSentence(chip, responseHours)}</p>
          {err && <p className="text-[11px] text-red-600" role="alert">{err}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">Send request</button>
            <button type="button" onClick={onClose} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">Cancel</button>
          </div>
        </form>
      </aside>
    </>
  );
}
