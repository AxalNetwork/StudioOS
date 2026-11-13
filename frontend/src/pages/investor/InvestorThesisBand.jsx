import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';

/**
 * D1424 (#3700, PH8, owner answer E) — the investor's thesis, as a band on
 * Investor Home linking to the Settings card where it is edited. Not a zone:
 * the thesis is one record, `investor_profiles.thesis_text`, read through
 * `GET /api/investor-profile/me` and written only by Settings' "My thesis"
 * card (`/account/security-privacy`, `PUT /api/investor-profile/me`).
 *
 * Four states, none of them a guess:
 *   reading     "Reading your thesis…"
 *   unreadable  "Your thesis could not be read · Try again"
 *   empty       "No thesis set", muted, with the link to set it
 *   set         the thesis in the investor's own words, and "Edit in Settings ›"
 * An administrator's preview withholds investor records, so it draws nothing.
 */
export const THESIS_HREF = '/account/security-privacy';

export function thesisBandState(read) {
  if (!read || read.status === 'loading') return { kind: 'reading' };
  if (read.status === 'error') return { kind: 'unreadable' };
  const text = String(read.profile?.thesis_text || '').trim();
  return text ? { kind: 'set', text } : { kind: 'empty' };
}

const BAND = 'flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-indigo-200 bg-indigo-50/60 px-4 py-3 dark:border-indigo-900 dark:bg-indigo-950/30';
const LINK = 'whitespace-nowrap text-[12.5px] font-semibold text-indigo-700 hover:underline dark:text-indigo-300';

export function ThesisBandView({ state, onRetry }) {
  if (state.kind === 'reading') {
    return <section className={BAND} aria-busy="true" data-testid="investor-thesis-band"><p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">Reading your thesis…</p></section>;
  }
  if (state.kind === 'unreadable') {
    return (
      <section className={BAND} data-testid="investor-thesis-band">
        <p role="status" className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="investor-thesis-unreadable">
          Your thesis could not be read ·{' '}
          <button type="button" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300" onClick={onRetry}>Try again</button>
        </p>
      </section>
    );
  }
  const set = state.kind === 'set';
  return (
    <section className={BAND} data-testid="investor-thesis-band" data-state={state.kind}>
      <div className="min-w-0 flex-1">
        <p className="m-0 font-mono text-[10px] font-bold uppercase tracking-[.08em] text-indigo-700 dark:text-indigo-300">Your thesis</p>
        {set
          ? <p className="m-0 mt-1 line-clamp-2 text-[13px] leading-relaxed text-axal-ink dark:text-gray-100" data-testid="investor-thesis-text">{state.text}</p>
          : <p className="m-0 mt-1 text-[13px] text-axal-muted dark:text-gray-400" data-testid="investor-thesis-empty">No thesis set</p>}
      </div>
      <Link to={THESIS_HREF} className={LINK} data-testid="investor-thesis-edit">{set ? 'Edit in Settings ›' : 'Set it in Settings ›'}</Link>
    </section>
  );
}

export default function InvestorThesisBand() {
  const [read, setRead] = useState({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const retry = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    setRead({ status: 'loading' });
    Promise.resolve().then(() => api.getInvestorProfile()).then(
      (r) => { if (live) setRead({ status: 'ready', profile: r?.profile || null }); },
      (e) => { reportError('InvestorThesisBand', e); if (live) setRead({ status: 'error' }); },
    );
    return () => { live = false; };
  }, [tick]);
  return <ThesisBandView state={thesisBandState(read)} onRetry={retry} />;
}
