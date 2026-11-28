import { FUND } from '../../../lib/spinoutFundModel';
import React, { useState } from 'react';
import { spinoutLab } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { CARD, LBL, MONO } from './FundWorkspaceSupport';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';

const INVESTOR_TYPES = [
  ['individual', 'Individual / angel'],
  ['family_office', 'Family office'],
  ['fund_of_funds', 'Fund of funds'],
  ['institution', 'Institution'],
  ['corporate', 'Corporate / strategic'],
  ['other', 'Other'],
];

// Informational only — stated in the form and enforced nowhere, because these
// preferences do not restrict fund strategy.
const PREFERENCE_AREAS = [
  ['ai_infrastructure', 'AI infrastructure'],
  ['vertical_saas', 'Vertical SaaS'],
  ['fintech', 'Fintech'],
  ['healthtech', 'Healthtech'],
  ['climate', 'Climate'],
  ['deeptech', 'Deeptech'],
  ['marketplaces', 'Marketplaces'],
  ['security', 'Security'],
];

const TICKET_MIN = FUND.minTicketK * 1000;
const TICKET_MAX = 2_000_000;
const TICKET_STEP = 25_000;

const fmtTicket = (dollars) => (dollars >= 1_000_000
  ? `$${(dollars / 1_000_000).toFixed(dollars % 1_000_000 === 0 ? 0 : 2)}M`
  : `$${Math.round(dollars / 1000)}K`);


export default function LpApplicationForm({ loaded, existing, prefill, onSubmitted }) {
  const initial = existing ? null : prefill;
  const [investorType, setInvestorType] = useState(existing?.investor_type || initial?.investor_type || 'individual');
  const [ticket, setTicket] = useState(existing?.target_commitment ?? (initial ? initial.target_commitment ?? '' : 150_000));
  const [prefs, setPrefs] = useState(() => new Set(existing?.preference_areas || []));
  const [accredited, setAccredited] = useState(!!existing?.accredited);
  const [note, setNote] = useState(existing?.note || initial?.note || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const togglePref = (key) => setPrefs((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const submit = async () => {
    if (busy || !accredited) return;
    const commitment = Number(ticket);
    if (!Number.isFinite(commitment) || commitment < TICKET_MIN || commitment > TICKET_MAX) {
      setErr('Enter a target commitment from $50,000 to $2,000,000.');
      return;
    }
    setBusy(true); setErr('');
    try {
      const res = await spinoutLab.submitLpApplication({
        investor_type: investorType,
        target_commitment: commitment,
        preference_areas: [...prefs],
        accredited: true,
        note,
      });
      if (onSubmitted) onSubmitted(res?.application ?? null);
    } catch (e) {
      setErr(e?.message || 'Could not submit your application.');
      reportError('SpinoutLabLpWorkspacePage:apply', e);
    } finally {
      setBusy(false);
    }
  };

  // "Could not tell" is not "never applied": showing a fresh form to someone
  // whose status failed to load would invite a duplicate submission.
  if (!loaded) {
    return (
      <div className={`${CARD} flex items-center gap-3 p-6 text-[13px] text-gray-500 dark:text-gray-400`}>
        <AlertCircle size={16} className="flex-none text-amber-500" />
        Your application status could not be loaded, so the form is hidden to avoid a duplicate
        submission. Reload the page, or contact the fund team through <Link to="/help" className="font-semibold text-violet-700 dark:text-violet-400">the Help Center</Link>.
      </div>
    );
  }

  return (
    <div className={`${CARD} p-6`} data-testid="lp-application-form">
      <p className="m-0 text-[13px] leading-relaxed text-gray-600 dark:text-gray-400">
        Participation is limited to accredited investors under Rule 501 of Regulation D.
        Applications are reviewed individually within five business days; acceptance is selective
        and capacity-limited. Submitting an application creates no obligation on either side.
      </p>
      {initial && <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
        Review the answers filled from your profile. Confirm accreditation separately below.
      </p>}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <div className={LBL}>Investor type</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {INVESTOR_TYPES.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setInvestorType(key)}
                aria-pressed={investorType === key}
                className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                  investorType === key
                    ? 'border-violet-600 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-2">
            <div className={LBL}>Target commitment</div>
            <div className={`${MONO} text-[13px] font-bold text-gray-900 dark:text-gray-100`}>
              {ticket === '' ? 'Not entered' : initial ? `$${Number(ticket).toLocaleString('en-US')}` : fmtTicket(Number(ticket))}
            </div>
          </div>
          {initial ? <>
            <input type="number" min={TICKET_MIN} max={TICKET_MAX} step="any" value={ticket}
              onChange={(e) => setTicket(e.target.value)} aria-label="Target commitment (USD)"
              className="mt-3 min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 dark:border-gray-600 dark:bg-gray-900"
              data-testid="input-target-commitment" />
            {initial.target_out_of_range && <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
              The target you entered in onboarding was outside $50,000 to $2,000,000. Enter a new target here.
            </p>}
          </> : <input
            type="range"
            min={TICKET_MIN}
            max={TICKET_MAX}
            step={TICKET_STEP}
            value={ticket}
            onChange={(e) => setTicket(Number(e.target.value))}
            aria-label="Target commitment"
            className="mt-3 w-full accent-violet-600"
            data-testid="input-target-commitment"
          />}
          <div className="mt-1 flex justify-between text-[10.5px] text-gray-400 dark:text-gray-500">
            <span>{fmtTicket(TICKET_MIN)} minimum</span>
            <span>{fmtTicket(TICKET_MAX)}</span>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className={LBL}>
          Preference areas <span className="font-medium normal-case tracking-normal text-gray-400 dark:text-gray-500">(informational — does not restrict fund strategy)</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PREFERENCE_AREAS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => togglePref(key)}
              aria-pressed={prefs.has(key)}
              className={`rounded-full border px-3 py-1 text-[11.5px] font-semibold transition-colors ${
                prefs.has(key)
                  ? 'border-violet-600 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className="mt-5 flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          checked={accredited}
          onChange={(e) => setAccredited(e.target.checked)}
          // dark-mode-exempt: native checkbox border — the browser draws its
          // own dark-scheme control and a dark: override fights it.
          className="mt-0.5 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
          data-testid="checkbox-accredited"
        />
        I certify that I qualify as an accredited investor under Rule 501 of Regulation D, and that
        the information above is accurate.
      </label>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="Anything the fund team should know (optional)"
        aria-label="Note to the fund team"
        className="mt-4 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-[13px] text-gray-900 dark:text-gray-100"
      />

      {err && <p className="mt-3 text-[12px] text-red-600 dark:text-red-400">{err}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !accredited}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-[13px] font-bold text-white hover:bg-violet-700 disabled:opacity-50"
          data-testid="button-submit-lp-application"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          {busy ? 'Submitting…' : existing ? 'Update application' : 'Submit application'}
        </button>
        <Link to="/trust/me" className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-[13px] font-semibold text-gray-700 dark:text-gray-300">
          Complete identity verification
        </Link>
        {!accredited && (
          <span className="text-[11.5px] text-gray-400 dark:text-gray-500">
            Accreditation must be confirmed before submitting.
          </span>
        )}
      </div>

      {existing?.status === 'declined' && existing?.review_note && (
        <p className="mt-3 text-[12px] leading-relaxed text-gray-500 dark:text-gray-400">
          <span className="font-semibold">Previous decision:</span> {existing.review_note}
        </p>
      )}
    </div>
  );
}
