import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { thesisGroups } from './investorHomeModel';
import '../studio/tiles/investorHomeModules.css';

/**
 * D1424 (#3700, PH8, owner answer E) — the investor's thesis, as a band on
 * Investor Home linking to the Settings card where it is edited. Not a zone:
 * the thesis is one record, `investor_profiles.thesis_text`, read through
 * `GET /api/investor-profile/me` and written only by Settings' "My thesis"
 * editor (`/account/portfolio/settings`, `PUT /api/investor-profile/me`).
 *
 * Four states, none of them a guess:
 *   reading     "Reading your thesis…"
 *   unreadable  "Your thesis could not be read · Try again"
 *   empty       "No thesis set", muted, with the link to set it
 *   set         the thesis in the investor's own words, and "Edit in Settings ›"
 * An administrator's preview withholds investor records, so it draws nothing.
 *
 * D6129 (#6129, canvas D6126 SM16, SM22c, SM25A): the band grows the profile's
 * own recorded preferences as chips (sectors, stages, regions, ticket) and a
 * struck-through Excludes group, from the same read. Free text is never parsed
 * into a chip. A thesis with chips and no prose is set; with neither, it says
 * so and points to Settings, where fit on live deals is set too. On a phone the
 * chips after the fifth fold into "+n more".
 */
export const THESIS_HREF = '/account/portfolio/settings?from=home#my-thesis';

export function thesisBandState(read) {
  if (!read || read.status === 'loading') return { kind: 'reading' };
  if (read.status === 'error') return { kind: 'unreadable' };
  const text = String(read.profile?.thesis_text || '').trim();
  const groups = thesisGroups(read.profile);
  return text || groups.length ? { kind: 'set', text, groups } : { kind: 'empty' };
}

const BAND = 'flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-indigo-200 bg-indigo-50/60 px-4 py-3 dark:border-indigo-900 dark:bg-indigo-950/30';
const LINK = 'whitespace-nowrap text-[12.5px] font-semibold text-indigo-700 hover:underline dark:text-indigo-300';

const PHONE_CHIPS = 5;

function ThesisChips({ groups }) {
  const [open, setOpen] = useState(false);
  let n = 0;
  const total = groups.reduce((s, g) => s + g.chips.length, 0);
  return (
    <div className="ihs-crow" data-open={open ? 'true' : 'false'} data-testid="investor-thesis-chips">
      {groups.map((g) => (
        <span className="ihs-cg" key={g.label}>
          <span className="ihs-cgl">{g.label}</span>
          {g.chips.map((c) => {
            n += 1;
            return <span key={c} className={`ihs-chip${g.excluded ? ' ihs-x' : ''}${n > PHONE_CHIPS ? ' ihs-chip-extra' : ''}`} aria-label={g.excluded ? `Excluded: ${c}` : undefined}>{c}</span>;
          })}
        </span>
      ))}
      {total > PHONE_CHIPS && <button type="button" className="ihs-more" onClick={() => setOpen(true)}>+{total - PHONE_CHIPS} more</button>}
    </div>
  );
}

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
        {set && state.text && <p className="m-0 mt-1 line-clamp-2 text-[13px] leading-relaxed text-axal-ink dark:text-gray-100" data-testid="investor-thesis-text">{state.text}</p>}
        {set && state.groups?.length > 0 && <ThesisChips groups={state.groups} />}
        {!set && <p className="m-0 mt-1 text-[13px] text-axal-muted dark:text-gray-400" data-testid="investor-thesis-empty">No thesis set · Set it in Settings to see fit on live deals</p>}
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
