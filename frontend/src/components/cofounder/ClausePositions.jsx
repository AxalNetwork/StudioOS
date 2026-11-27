// Each party's own position on one clause of the generated draft — D354.
//
// Every party is listed with what THEY recorded, or "Not recorded". Only the
// signed-in party gets the two buttons and the note, and they write that
// party's own row: the request carries no user id, and the Worker refuses a
// body that names someone else's. A party with no account on file cannot
// record anything, and the row says why.
import React, { useState } from 'react';
import { Check, AlertTriangle, Loader2 } from 'lucide-react';
import { Unrecorded } from '../../ui';

const LABEL = { accepted: 'Accepted', needs_alignment: 'Needs alignment' };
const TONE = {
  accepted: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30',
  needs_alignment: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30',
};

export default function ClausePositions({ clauseKey, rows, canRecord, onRecord }) {
  const mine = rows.find((r) => r.is_you) || null;
  const [note, setNote] = useState(mine?.note || '');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const record = async (position) => {
    setBusy(position);
    setError('');
    try {
      await onRecord(clauseKey, position, note);
    } catch (e) {
      setError(e?.message || 'Your position was not saved.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-gray-100 dark:border-gray-800 px-3 py-2.5" data-testid={`clause-positions-${clauseKey}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1.5">Each founder’s position</div>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.party_index} className="flex items-center justify-between gap-2 text-[11.5px]" data-testid={`clause-position-${clauseKey}-${r.party_index}`}>
            <span className="text-gray-700 dark:text-gray-200 truncate">{r.name}{r.is_you ? ' (you)' : ''}</span>
            {r.position ? (
              <span className={`text-[10.5px] font-semibold rounded-full px-2 py-0.5 ${TONE[r.position]}`} title={r.note || undefined}>{LABEL[r.position]}</span>
            ) : r.has_account ? (
              <Unrecorded reason="This founder has not recorded a position on this clause." />
            ) : (
              <Unrecorded reason="No account matches this founder's email on the draft, so they cannot record a position. Regenerate the draft with their account email.">No account on file</Unrecorded>
            )}
          </li>
        ))}
      </ul>
      {canRecord && mine && (
        <div className="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-gray-800">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note — what would you change?"
            data-testid={`input-position-note-${clauseKey}`}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-[12px] text-gray-900 dark:text-gray-50 mb-2"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => record('accepted')}
              disabled={busy != null}
              data-testid={`button-accept-${clauseKey}`}
              className="inline-flex items-center gap-1 text-[11.5px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 rounded-lg px-3 py-1.5"
            >
              {busy === 'accepted' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Accept term
            </button>
            <button
              type="button"
              onClick={() => record('needs_alignment')}
              disabled={busy != null}
              data-testid={`button-needs-alignment-${clauseKey}`}
              className="inline-flex items-center gap-1 text-[11.5px] font-bold text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 disabled:opacity-40 rounded-lg px-3 py-1.5"
            >
              {busy === 'needs_alignment' ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />} Needs alignment
            </button>
          </div>
          {error && <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1.5" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
