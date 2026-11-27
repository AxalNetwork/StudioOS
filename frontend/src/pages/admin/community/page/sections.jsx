/**
 * D4820 (#4820) — The Community page's v2 sections: Build your community (a genuinely empty Community) and Additional insights (the figures no store records, behind one row).
 * Nothing here decides anything. Manage Community's doors stay in AdminCommunity.jsx, as literal links the shell's reachability guards read there.
 */
import React, { useState } from 'react';
import { BUILD_LINE, BUILD_TITLE, NOT_RECORDED, insightsLabel } from '../communityModel';
import { CARD, EYE, GHOST, PRIMARY, SUB } from './parts';
import { Link } from 'react-router-dom';

/** CM04a: what a genuinely empty Community shows in place of the analytics. */
export function BuildCommunity() {
  return (
    <section className={`${CARD} flex flex-col gap-3 px-[18px] py-5`} data-testid="community-build" aria-labelledby="community-h-build">
      <span className={EYE}>Get started</span>
      <h2 id="community-h-build" className="m-0 text-[18px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{BUILD_TITLE}</h2>
      <p className={`m-0 max-w-xl ${SUB}`}>{BUILD_LINE}</p>
      <span className="flex flex-wrap gap-2.5">
        <Link to="/admin/events" className={PRIMARY} data-testid="community-build-event">Create an event</Link>
        <Link to="/admin/circles" className={GHOST} data-testid="community-build-circle">Create a circle</Link>
      </span>
    </section>
  );
}

/**
 * D4820: every figure no store records, behind one row that expands to say
 * why each is not recorded. Never a zero, never an estimate. `lead`, when
 * given, is the one line before the count (the empty Community's).
 */
export function AdditionalInsights({ lead }) {
  const [open, setOpen] = useState(false);
  const label = insightsLabel(NOT_RECORDED.length);
  return (
    <section className="flex flex-col gap-2 rounded-[12px] border border-dashed border-axal-hairline px-[18px] py-3 dark:border-gray-700" data-testid="community-additional-insights">
      <button type="button" aria-expanded={open} aria-controls="community-insights-list" onClick={() => setOpen((x) => !x)}
        className="flex min-h-[32px] max-md:min-h-[44px] w-full items-center justify-between gap-3 text-left text-[13px] font-bold text-axal-ink dark:text-gray-100" data-testid="community-insights-toggle">
        <span>{lead ? `${lead} · ${label}` : label}</span>
        <span className="text-[12px] text-axal-violet dark:text-violet-300">{open ? 'Hide ▴' : 'Show ▾'}</span>
      </button>
      {open ? (
        <ul id="community-insights-list" className="m-0 flex list-none flex-col gap-2 p-0">
          {NOT_RECORDED.map((n) => (
            <li key={n.key} className="flex flex-col gap-0.5" data-testid={`community-unrecorded-${n.key}`}>
              <span className="flex items-baseline gap-2">
                <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{n.title}</span>
                <span className={EYE}>Not recorded</span>
              </span>
              <span className={SUB}>{n.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
