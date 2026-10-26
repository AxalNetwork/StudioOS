/**
 * D1253 (#2428) — the scope strip and the scorecard panel (SC1, SC6), shared by
 * the deal page's Scorecard tab, the Deal flow table and the founder's
 * `/raise/scorecard`. Until `/api/venture-scores` lands (part 3) every scope is
 * unread: the strip is a muted outline and each row says "Not read here yet",
 * never a bar or a number of zero.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { METHOD, NOT_YET, SCOPES, WAITS, barText, stripBar, unreadScopes } from './scorecardModel';

export function ScorecardWait({ id }) {
  return (
    <div className="flex flex-col gap-1" data-testid={`scorecard-wait-${id}`}>
      <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">{WAITS[id]}</p>
    </div>
  );
}

/** The scope strip: eleven 4px bars, 2px apart, 20px tall at 100, no numbers. `locked` is the whole strip outlined. */
export function ScopeStrip({ scopes = unreadScopes(), locked = false }) {
  const unread = scopes.every((s) => stripBar(s).kind === 'unread');
  const label = locked ? 'Scorecard locked' : unread ? `Scorecard: ${NOT_YET}` : scopes.map(barText).join('; ');
  return (
    <span role="img" aria-label={label} title={label} className={`inline-flex h-5 items-end gap-[2px] ${locked || unread ? 'rounded border border-dashed border-gray-300 px-0.5 dark:border-gray-600' : ''}`} data-testid={locked ? 'scope-strip-locked' : unread ? 'scope-strip-unread' : 'scope-strip'}>
      {scopes.map((s) => {
        const b = locked ? { kind: 'unread' } : stripBar(s);
        if (b.kind === 'bar') return <span key={s.key} className="w-1 rounded-sm bg-violet-600 dark:bg-violet-400" style={{ height: `${b.height}px`, opacity: b.opacity }} />;
        if (b.kind === 'dashed') return <span key={s.key} className="w-1 border-b border-dashed border-gray-400" />;
        if (b.kind === 'dot') return <span key={s.key} className="mb-0.5 h-1 w-1 rounded-full bg-gray-300 dark:bg-gray-600" />;
        return <span key={s.key} className="h-px w-1 bg-gray-200 dark:bg-gray-700" />;
      })}
    </span>
  );
}

/** SC1's panel: the eleven scopes in order, each unread until the read lands, and the method's door. */
export default function VentureScorecard({ audience = 'investor' }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="venture-scorecard">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h2 className="m-0 text-[15px] font-bold">Venture scorecard</h2>
          <ScopeStrip />
        </div>
        <Link to={METHOD} className="text-[13px] font-semibold text-violet-700 underline dark:text-violet-300" data-testid="scorecard-method-link">How scoring works</Link>
      </header>
      <ul className="m-0 flex list-none flex-col divide-y divide-gray-100 p-0 dark:divide-gray-800">
        {SCOPES.map((s) => (
          <li key={s.key} className="flex items-center justify-between py-2 text-[13.5px]" data-testid={`scorecard-scope-${s.key}`}>
            <span className="font-semibold">{s.label}</span>
            <span className="text-[12px] text-axal-muted">{NOT_YET}</span>
          </li>
        ))}
      </ul>
      <ScorecardWait id="scores" />
      {audience === 'founder' ? <><ScorecardWait id="founder" /><ScorecardWait id="sharing" /><ScorecardWait id="trajectory" /></> : <ScorecardWait id="weighting" />}
    </section>
  );
}
