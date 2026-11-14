/**
 * #4707 — the HQ licence page's commercial terms: seats. Moved out of `AdminLicences.jsx`
 * unchanged when the page was split by domain; the comments below are the
 * original ones. D4819: step 4's terms editor became the Terms section,
 * `TermsWorkspace.jsx` (read-only by default, amended in a reviewed session).
 */
import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { SEAT_TYPES, n0 } from './licenceShared';
import OutcomeNotice from '../../../components/OutcomeNotice';
import { describeOutcome, outcomeFromError } from '../../../lib/mutationOutcome';

/* ------------------------------------------------------------------ *
 * Steps 3 + 4                                                         *
 * ------------------------------------------------------------------ */

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

  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-2">
        {SEAT_TYPES.map((t) => (
          <label key={t.k} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-gray-700 dark:text-gray-300">{t.label}</span>
            <input
              type="number" min="0"
              className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
              value={seats[t.k]}
              onChange={(e) => setSeats((s) => ({ ...s, [t.k]: e.target.value }))}
            />
          </label>
        ))}
      </div>
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
