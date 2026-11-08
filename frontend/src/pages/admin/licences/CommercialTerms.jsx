/**
 * #4707 — the HQ licence page's commercial terms: seats and terms. Moved out of `AdminLicences.jsx`
 * unchanged when the page was split by domain; the comments below are the
 * original ones.
 */
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { bpsPercent as pct } from '../../../lib/bps';
import { reportError } from '../../../lib/log';
import { buildCoreSave, coreFormFrom, coreRevision, dirtyKeys, reconcileCoreForm } from '../../../lib/licenceCoreTermsForm';
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

export function TermsEditor({ licence, onSaved }) {
  // D4694 — the form remembers what it was last synced to (`base`) and the revision it read, so a save
  // sends only the fields the user changed, and a refresh of the licence (a renewal, another admin's
  // save) updates every field the user has not touched.
  const [st, setSt] = useState(() => ({ form: coreFormFrom(licence), base: coreFormFrom(licence), revision: coreRevision(licence), moved: [] }));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  // D4706 — a save says how it ended; a failed one keeps what was typed.
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    setSt((cur) => reconcileCoreForm(cur, licence));
  }, [licence]);
  const f = st.form;
  const dirty = dirtyKeys(st.form, st.base);
  const set = (k) => (e) => { const v = e.target.value; setSt((cur) => ({ ...cur, form: { ...cur.form, [k]: v } })); };

  async function save() {
    const built = buildCoreSave({ form: st.form, base: st.base, revision: st.revision, reason });
    if (!built.ok) { setErrors(built.errors); return; }
    setErrors({}); setBusy(true); setNotice(null);
    try {
      await api.licenceSetTerms(licence.uid, built.body);
      setReason('');
      setNotice(describeOutcome('committed', { fallback: 'Terms saved.' }));
      onSaved?.();
    } catch (e) {
      reportError('licence_terms_failed', e);
      if (e?.code === 'terms_conflict') {
        // Another save or a renewal got there first. Nothing was written; the page reloads the licence,
        // untouched fields update, and what was typed stays in the form to be checked and saved again.
        setNotice({ tone: 'error', text: e.message || 'These terms changed since you opened them, so nothing was saved. Check the fields and save again.' });
        onSaved?.();
      } else {
        setNotice(outcomeFromError(e, 'The terms were not saved.'));
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">Term (years)</span>
        <input type="number" min="1" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
          value={f.term_years} onChange={set('term_years')} />
      </label>
      <label className="text-sm">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">Annual fee</span>
        <div className="mt-1 flex gap-2">
          <input type="number" min="0" step="0.01" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
            value={f.annual_fee} onChange={set('annual_fee')} />
          <input className="w-20 rounded-md border border-gray-300 px-2 py-2 text-sm uppercase dark:border-gray-700"
            value={f.currency} onChange={set('currency')} maxLength={3} />
        </div>
      </label>
      <label className="text-sm">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">
          Revenue share (basis points)
        </span>
        <input type="number" min="0" max="10000" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
          value={f.revenue_share_bps} onChange={set('revenue_share_bps')} />
        <span className="text-[11px] text-gray-500">{pct(f.revenue_share_bps) || '—'}</span>
      </label>
      <label className="text-sm">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">
          Token split to HQ (basis points)
        </span>
        <input type="number" min="0" max="10000" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
          value={f.token_split_bps} onChange={set('token_split_bps')} />
        <span className="text-[11px] text-gray-500">{pct(f.token_split_bps) || '—'}</span>
      </label>
      <label className="text-sm">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">Starts</span>
        <input type="date" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
          value={f.starts_on} onChange={set('starts_on')} />
      </label>
      <label className="text-sm">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">First renewal</span>
        <input type="date" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
          value={f.renews_on} onChange={set('renews_on')} />
      </label>
      <div className="sm:col-span-2">
        {st.moved.length > 0 && (
          <p className="mb-2 text-[12px] text-amber-800" role="status" data-testid="licence-terms-moved">
            Changed elsewhere since you started editing: {st.moved.join(', ')}. Saving replaces the newer value with what you typed.
          </p>
        )}
        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wide text-gray-500">Why are the terms changing?</span>
          <textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700" data-testid="licence-terms-reason" />
        </label>
        {errors.reason && <p className="mt-1 text-[11px] text-red-600" role="alert">{errors.reason}</p>}
        {errors.form && <p className="mt-1 text-[11px] text-gray-600" role="status">{errors.form}</p>}
        {Object.entries(errors).filter(([k]) => k !== 'reason' && k !== 'form').map(([k, m]) => (
          <p key={k} className="mt-1 text-[11px] text-red-600" role="alert">{k.replace(/_/g, ' ')} {m}.</p>
        ))}
        <button type="button" onClick={save} disabled={busy || dirty.length === 0}
          className="mt-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          data-testid="licence-terms-save">
          {busy ? <Loader2 size={14} className="animate-spin" /> : 'Save terms'}
        </button>
        <div className="mt-2"><OutcomeNotice notice={notice} testId="licence-terms-outcome" /></div>
        <p className="mt-2 text-[11px] text-gray-500">
          Rates are stored as integer basis points, not as a fraction — 3500 is 35%. The same
          reason money is stored in cents: 0.35 is not exactly representable in binary floating
          point, and a revenue share is a contractual number.
        </p>
      </div>
    </div>
  );
}
