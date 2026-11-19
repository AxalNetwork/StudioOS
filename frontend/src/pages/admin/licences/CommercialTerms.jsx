/**
 * #4707 — the HQ licence page's commercial terms: seats. Moved out of `AdminLicences.jsx`
 * unchanged when the page was split by domain; the comments below are the
 * original ones. D4819: step 4's terms editor became the Terms section,
 * `TermsWorkspace.jsx` (read-only by default, amended in a reviewed session).
 *
 * D4819 part 11 (#5922) — board L11's Licensed seats card (`LicensedSeats`),
 * read-only, by profile, with In use Not recorded; the Seats tab keeps the
 * editor, which is not offered on a terminated licence.
 */
import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { SEAT_TYPES, n0 } from './licenceShared';
import { SEAT_USE_REASON, seatChangeOffer, seatRows } from '../licenceAccessModel';
import OutcomeNotice from '../../../components/OutcomeNotice';
import { describeOutcome, outcomeFromError } from '../../../lib/mutationOutcome';

/* ------------------------------------------------------------------ *
 * Steps 3 + 4                                                         *
 * ------------------------------------------------------------------ */

/**
 * D4819 part 5 (#5931) — the four seat fields, controlled, shared by `SeatEditor` here and New licence step 3
 * (`NewLicenceSteps.jsx`). `errors` is keyed `seat_<type>`; an error is shown on its field's own line and tied to
 * it with `aria-describedby`. Without `idPrefix` the fields render exactly as `SeatEditor` always drew them.
 */
export function SeatFields({ seats, onChange, errors = {}, idPrefix = null }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {SEAT_TYPES.map((t) => {
        const id = idPrefix ? `${idPrefix}-${t.k}` : undefined;
        const err = errors[`seat_${t.k}`];
        return (
          <div key={t.k}>
            <label htmlFor={id} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-gray-700 dark:text-gray-300">{t.label}</span>
              <input
                id={id} type="number" min="0" inputMode="numeric"
                className={`w-24 rounded-md border px-2 py-1 text-sm max-md:min-h-[44px] ${err ? 'border-red-600 dark:border-red-400' : 'border-gray-300 dark:border-gray-700'}`}
                value={seats[t.k]}
                aria-invalid={err ? 'true' : undefined}
                aria-describedby={err && id ? `${id}-e` : undefined}
                data-testid={idPrefix ? `${idPrefix}-${t.k}` : undefined}
                onChange={(e) => onChange(t.k, e.target.value)}
              />
            </label>
            {err && id ? <small id={`${id}-e`} className="mt-1 block text-xs text-red-700 dark:text-red-300"><span aria-hidden="true">✕ </span>{err}</small> : null}
          </div>
        );
      })}
    </div>
  );
}

const CELL_TONE = {
  value: 'text-gray-900 dark:text-gray-100',
  not_recorded: 'italic text-gray-500 dark:text-gray-400',
  unreadable: 'font-medium text-red-700 dark:text-red-300',
};

/**
 * L11 — licensed seats by profile. Licensed is the ledger's own count (a
 * profile with no seat row is Not recorded, never 0); In use is Not recorded
 * on every row because HQ does not attribute usage to a licence, and the foot
 * says so in operator words.
 */
export function LicensedSeats({ licence, onOpenTab }) {
  const rows = seatRows(licence);
  const change = seatChangeOffer(licence);
  return (
    <section data-testid="licence-seats"
      className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Licensed seats</h2>
        {change.offered && onOpenTab && (
          <button type="button" data-testid="licence-seats-change" onClick={() => onOpenTab('seats')}
            className="min-h-[44px] rounded-md border border-gray-300 px-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 sm:min-h-0 sm:py-1">
            Change seats
          </button>
        )}
      </div>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400">
            <th scope="col" className="pb-1.5 font-medium">Profile</th>
            <th scope="col" className="pb-1.5 text-right font-medium">Licensed</th>
            <th scope="col" className="pb-1.5 pl-3 font-medium">In use</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map((r) => (
            <tr key={r.key} data-testid={`licence-seat-${r.key}`}>
              <td className="py-2 text-gray-700 dark:text-gray-300">{r.profile}</td>
              <td className={`py-2 text-right tabular-nums ${CELL_TONE[r.licensedState]}`} data-absence={r.licensedState === 'value' ? undefined : r.licensedState.replace('_', '-')}>
                {r.licensed}
              </td>
              <td className={`py-2 pl-3 ${CELL_TONE.not_recorded}`} data-absence="not-recorded" title={SEAT_USE_REASON}>{r.inUse}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[12px] leading-relaxed text-gray-600 dark:text-gray-400" data-testid="licence-seats-foot">{SEAT_USE_REASON}</p>
      {!change.offered && (
        <p className="mt-2 text-[12px] text-gray-600 dark:text-gray-400" data-testid="licence-seats-change-why">{change.why}</p>
      )}
    </section>
  );
}

export function SeatEditor({ licence, onSaved }) {
  const [seats, setSeats] = useState(() => {
    const s = {};
    for (const t of SEAT_TYPES) s[t.k] = String(licence.seats?.[t.k] ?? 0);
    return s;
  });
  const [busy, setBusy] = useState(false);
  // D4706 — a save says how it ended; a failed one keeps what was typed.
  const [notice, setNotice] = useState(null);
  const total = SEAT_TYPES.reduce((a, t) => a + (Number(seats[t.k]) || 0), 0);

  async function save() {
    setBusy(true); setNotice(null);
    try {
      const out = {};
      for (const t of SEAT_TYPES) out[t.k] = Number(seats[t.k]) || 0;
      await api.licenceSetSeats(licence.uid, out);
      setNotice(describeOutcome('committed', { fallback: 'Seats saved.' }));
      onSaved?.();
    } catch (e) {
      reportError('licence_seats_failed', e);
      setNotice(outcomeFromError(e, 'The seats were not saved.'));
    } finally { setBusy(false); }
  }

  // D4819 part 11: the seats write does not land on a terminated licence, so the editor is not offered there.
  const change = seatChangeOffer(licence);
  if (!change.offered) {
    return (
      <div data-testid="licence-seat-editor-closed">
        <p className="text-sm text-gray-700 dark:text-gray-300">{change.why}</p>
        <LicensedSeats licence={licence} />
      </div>
    );
  }

  return (
    <div>
      <SeatFields seats={seats} onChange={(k, v) => setSeats((s) => ({ ...s, [k]: v }))} />
      <p className="mt-2 text-sm text-gray-600">{n0(total)} seats licensed.</p>
      <p className="mt-1 text-[11px] text-gray-500">
        Seats used is not shown: it needs every account to name its licence, and none does yet.
      </p>
      <button
        type="button" onClick={save} disabled={busy}
        className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : 'Save seats'}
      </button>
      <div className="mt-2"><OutcomeNotice notice={notice} testId="licence-seats-outcome" /></div>
    </div>
  );
}
