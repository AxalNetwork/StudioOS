import React, { useEffect, useState } from 'react';
import { availability } from './deckV2Adapter';
import { LATER } from './deckV2Model';
import { LIVE_LATER, buildingLine, elapsedLine } from './oneClickModel';

/**
 * D1604 (#3716, pd2b, plan §3.3) — the build's progress, honest about main.
 *
 * `POST /api/decks/generate` is synchronous: every card arrives together when
 * the run answers. So this draws the cards the build will write, a polite
 * live region that says it is building, and the time so far. It draws no
 * per-area rows and no Stop: a press that cannot stop must not be drawn.
 *
 * The per-area rows, Stop (Esc) and "You can close this page" come with the
 * batch runtime (`deckV2Adapter.batch`, #3753); until then that line is
 * greyed "Coming later", titled with the adapter's reason.
 */

const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';

export default function BuildProgress({ cards = null, titles = [], startedAt = null, testId = 'pitch-build-progress' }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt == null) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  const live = availability('batch');
  return (
    <section className="flex flex-col gap-2.5" aria-busy="true" data-testid={testId}>
      <span className={`text-[14px] font-extrabold ${INK}`}>Building your deck</span>
      <span role="status" aria-live="polite" className={MUTED} data-testid={`${testId}-line`}>{buildingLine(cards)}</span>
      {startedAt != null ? <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" aria-hidden="true">{elapsedLine(now - startedAt)}</span> : null}
      {titles.length ? (
        <ol className="m-0 grid list-none grid-cols-1 gap-1 p-0 sm:grid-cols-2" data-testid={`${testId}-cards`}>
          {titles.map((t, i) => (
            <li key={`${t}-${i}`} className="flex items-center gap-2 rounded-[8px] border border-axal-hairline px-2.5 py-1.5 text-[12px] dark:border-gray-700">
              <span className="font-mono text-[11px] text-axal-muted dark:text-gray-400">{String(i + 1).padStart(2, '0')}</span>
              <span className={INK}>{t}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <span className={MUTED}>The cards arrive together when the build finishes. Nothing is saved until you accept them.</span>
      {live && live.available !== true ? (
        <span className="flex items-center justify-between gap-2 text-[11.5px] text-axal-muted dark:text-gray-500" title={live.reason} data-testid={`${testId}-live-later`}>
          <span>{LIVE_LATER}</span><span className="font-mono text-[10px]">{LATER}</span>
        </span>
      ) : null}
    </section>
  );
}
