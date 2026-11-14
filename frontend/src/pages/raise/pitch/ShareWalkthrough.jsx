import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { deckShareWalkthroughApi } from '../../../lib/api/deckShareWalkthrough.js';
import { reportError } from '../../../lib/log';
import {
  HIDE, NEXT, PLAY_FAILED, PREVIOUS, TRY_AGAIN, UNREADABLE, WALKTHROUGH_TITLE, WATCH,
  captionLine, playlist, readProblem, summaryLine, walkthroughState,
} from './shareWalkthroughModel';

/**
 * D5791 (#5791) — the walkthrough the founder attached to this investor link,
 * played card by card with its captions (`routes/deck_share_walkthrough.ts`).
 * Drawn only when the link has one attached; nothing attached draws nothing,
 * and so does HQ's switch off. A read that fails says so, with Try again.
 */

const SECTION = 'deck-print-cta mx-auto my-6 flex max-w-4xl flex-col gap-2 px-4';
const LABEL = 'font-mono text-[10.5px] uppercase tracking-[.07em] text-gray-500 dark:text-slate-400';
const BTN = 'inline-flex min-h-[38px] items-center justify-center rounded-lg px-4 text-sm font-semibold';
const QUIET = `${BTN} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800`;

export default function ShareWalkthrough({ token, slides }) {
  const [read, setRead] = useState({ status: 'loading', takes: [] });
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);

  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    setRead({ status: 'loading', takes: [] });
    deckShareWalkthroughApi.read(token)
      .then((r) => { if (alive) setRead(walkthroughState(r)); })
      .catch((e) => {
        if (!alive) return;
        const problem = readProblem(e);
        if (problem === 'unreadable') reportError('ShareWalkthrough:read', e);
        setRead({ status: problem, takes: [] });
      });
    return () => { alive = false; };
  }, [token, tick]);

  const items = useMemo(() => playlist(read.takes, slides), [read.takes, slides]);
  const retry = useCallback(() => setTick((n) => n + 1), []);

  if (read.status === 'unreadable') {
    return (
      <section className={SECTION} data-testid="share-walkthrough-unreadable" aria-label={WALKTHROUGH_TITLE}>
        <span className={LABEL}>{WALKTHROUGH_TITLE}</span>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
          <span role="alert" className="text-[13px] text-gray-700 dark:text-slate-300">{UNREADABLE}</span>
          <button type="button" className={QUIET} onClick={retry} data-testid="share-walkthrough-retry">{TRY_AGAIN}</button>
        </div>
      </section>
    );
  }
  if (read.status !== 'ok' || !items.length) return null;

  const i = Math.min(at, items.length - 1);
  return (
    <section className={SECTION} data-testid="share-walkthrough" aria-label={WALKTHROUGH_TITLE}>
      <span className={LABEL}>{WALKTHROUGH_TITLE}</span>
      {!open ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
          <button type="button" className={`${BTN} bg-violet-600 text-white hover:bg-violet-700`} onClick={() => setOpen(true)} data-testid="share-walkthrough-watch">{WATCH}</button>
          <span className="text-[12.5px] text-gray-600 dark:text-slate-400">{summaryLine(items)}</span>
        </div>
      ) : (
        <Player token={token} items={items} i={i} onMove={setAt} onClose={() => setOpen(false)} />
      )}
    </section>
  );
}

/** One card's take, its caption under it, and the cards before and after. Ending a take moves to the next. */
function Player({ token, items, i, onMove, onClose }) {
  const [ms, setMs] = useState(0);
  const [failed, setFailed] = useState(false);
  const item = items[i];
  const { take } = item;
  useEffect(() => { setMs(0); setFailed(false); }, [take.uid]);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900" data-testid="share-walkthrough-player">
      <span className="text-[12.5px] font-semibold text-gray-900 dark:text-slate-100" data-testid="share-walkthrough-card">
        {item.label} <span className="ml-1 font-normal text-gray-500 dark:text-slate-400">· {i + 1} of {items.length}</span>
      </span>
      {failed ? <p role="alert" className="m-0 text-[13px] text-gray-700 dark:text-slate-300" data-testid="share-walkthrough-play-failed">{PLAY_FAILED}</p> : (
        <video key={take.uid} controls playsInline autoPlay preload="metadata" src={deckShareWalkthroughApi.mediaUrl(token, take.uid)}
          className="aspect-video w-full rounded-[10px] bg-black" aria-label={`${WALKTHROUGH_TITLE}: ${item.label}`}
          onTimeUpdate={(e) => setMs(Math.round((e.currentTarget?.currentTime || 0) * 1000))}
          onEnded={() => { if (i < items.length - 1) onMove(i + 1); }}
          onError={() => setFailed(true)} data-testid="share-walkthrough-video" />
      )}
      <span className="min-h-[1.5em] rounded-[6px] bg-gray-900 px-3 py-1.5 text-center text-[14px] text-gray-100 dark:bg-slate-800" aria-live="polite" data-testid="share-walkthrough-caption">
        {captionLine(take, ms) || ' '}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={QUIET} onClick={() => onMove(i - 1)} disabled={i <= 0} data-testid="share-walkthrough-prev">{PREVIOUS}</button>
        <button type="button" className={QUIET} onClick={() => onMove(i + 1)} disabled={i >= items.length - 1} data-testid="share-walkthrough-next">{NEXT}</button>
        <button type="button" className={QUIET} onClick={onClose} data-testid="share-walkthrough-hide">{HIDE}</button>
      </div>
    </div>
  );
}
