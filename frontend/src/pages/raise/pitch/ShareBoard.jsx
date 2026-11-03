import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { deckSlideAnalyticsApi } from '../../../lib/api/deckSlideAnalytics';
import { posthogApi } from '../../../lib/api/posthog';
import { reportError } from '../../../lib/log';
import { figureText } from '../../cycles/fromPosthogModel';
import {
  NDA_FILTERS, NDA_LINE, NO_LINKS, NO_VIEWS, UNREADABLE,
  boardState, dailyBars, dropRows, dropTitle, funnelRows, posthogLine,
} from './shareBoardModel';
import { NOT_RECORDED } from './pitchStudioModel';

/**
 * D4254 P4 (#4272, ps7, ps7x, ps7b) — Share & analytics, the top of the tile:
 * the version filter and the NDA line, views per day (NDA-gated against open
 * links, first views marked, 30 days), the two funnels side by side, where
 * readers drop off on a version against the one before it, and the PostHog line.
 * Everything comes from the daily read (D4272); the investors table below it is
 * StudioAnalytics' own.
 */

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const SELECT = 'min-h-[36px] rounded-[9px] border border-axal-hairline bg-white px-2.5 text-[12.5px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const BTN = 'inline-flex min-h-[36px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3.5 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const SKEL = 'animate-pulse rounded-[9px] bg-axal-hairline dark:bg-gray-800';

export default function ShareBoard({ deckId, projectId, versions = [] }) {
  const [version, setVersion] = useState('');
  const [nda, setNda] = useState('all');
  const [read, setRead] = useState({ status: 'idle', data: null });
  const [ph, setPh] = useState({ status: 'idle', data: null });

  const load = useCallback(() => {
    if (deckId == null) return () => {};
    let alive = true;
    setRead({ status: 'loading', data: null });
    deckSlideAnalyticsApi.daily(deckId, { version, nda }).then(
      (data) => { if (alive) setRead({ status: 'ok', data }); },
      (e) => { if (alive) setRead({ status: 'error', data: null }); reportError('share-board:daily', e); },
    );
    return () => { alive = false; };
  }, [deckId, version, nda]);
  useEffect(() => load(), [load]);

  useEffect(() => {
    if (projectId == null) return undefined;
    let alive = true;
    setPh({ status: 'loading', data: null });
    posthogApi.fromPosthog('raise', projectId, 'pitch_deck').then(
      (data) => { if (alive) setPh({ status: 'ok', data }); },
      // A failed PostHog read is neutral: it says so in one line and nothing else changes.
      () => { if (alive) setPh({ status: 'error', data: null }); },
    );
    return () => { alive = false; };
  }, [projectId]);

  const state = boardState(read);
  const d = read.data;
  const line = posthogLine(ph);

  return (
    <section className="flex flex-col gap-3.5" data-testid="share-board">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={`m-0 ${MUTED}`} data-testid="share-board-nda-line">{NDA_LINE}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="share-board-version">Version</label>
          <select id="share-board-version" className={SELECT} value={version} onChange={(e) => setVersion(e.target.value)} data-testid="share-board-version">
            <option value="">All versions</option>
            {versions.filter((v) => v?.version != null).map((v) => <option key={v.id ?? v.version} value={String(v.version)}>{`v${v.version}`}</option>)}
          </select>
          <label className="sr-only" htmlFor="share-board-nda">Links</label>
          <select id="share-board-nda" className={SELECT} value={nda} onChange={(e) => setNda(e.target.value)} data-testid="share-board-nda">
            {NDA_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
      </div>

      {state === 'loading' ? (
        <div className="flex flex-col gap-3.5" data-testid="share-board-loading"><div className={`${SKEL} h-40`} /><div className={`${SKEL} h-32`} /></div>
      ) : state === 'unreadable' ? (
        <div className={`${CARD} flex flex-wrap items-center justify-between gap-3 p-4`} data-testid="share-board-unreadable">
          <span className={MUTED}>{UNREADABLE}</span>
          <button type="button" className={BTN} onClick={load}>Try again</button>
        </div>
      ) : state === 'no-links' ? (
        <div className={`${CARD} p-6 text-center ${MUTED}`} data-testid="share-board-no-links">{NO_LINKS}</div>
      ) : (
        <>
          <ViewsPerDay days={d.days} empty={state === 'no-views'} />
          <div className="grid gap-3.5 md:grid-cols-2" data-testid="share-board-funnels">
            <Funnel title="NDA links" funnel={d.funnels?.nda} gated testId="share-board-funnel-nda" />
            <Funnel title="No-NDA links" funnel={d.funnels?.open} gated={false} testId="share-board-funnel-open" />
          </div>
          <DropOff dropoff={d.dropoff} />
        </>
      )}

      {line ? (
        <p className={`m-0 ${MUTED}`} data-testid={`share-board-posthog-${line.kind}`}>
          {line.kind === 'connect' ? <>{line.text} <Link to="/account/connectors" className="font-semibold text-axal-violet dark:text-violet-300">Open Connectors</Link></> : null}
          {line.kind === 'neutral' ? line.text : null}
          {line.kind === 'tracked' ? <>{line.text}: {line.tracked.map((t) => `${t.name} ${figureText(t.value, t.unit)}`).join(' · ')}</> : null}
        </p>
      ) : null}
    </section>
  );
}

export function ViewsPerDay({ days, empty }) {
  const bars = dailyBars(days);
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-2 p-4`} data-testid="share-board-daily">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={`text-[14px] font-extrabold ${INK}`}>Views per day</span>
        <span className="flex gap-3 text-[11.5px] text-axal-muted dark:text-gray-400">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-axal-violet dark:bg-violet-400" />NDA links</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-teal-500 dark:bg-teal-400" />Open links</span>
          <span>● first view</span>
        </span>
      </div>
      {empty ? <p className={`m-0 ${MUTED}`} data-testid="share-board-no-views">{NO_VIEWS}</p> : (
        <div className="flex h-36 items-end gap-[3px] overflow-x-auto pt-3" role="img"
          aria-label={bars.filter((b) => b.nda || b.open).map((b) => `${b.date}: ${b.nda} on NDA links, ${b.open} on open links${b.first ? `, ${b.first} first` : ''}`).join('; ') || 'No views in this range'}>
          {bars.map((b) => (
            <div key={b.date} className="flex min-w-[8px] flex-1 flex-col items-center justify-end gap-0.5" title={`${b.date} · ${b.nda} NDA · ${b.open} open`} data-testid={`share-board-day-${b.date}`}>
              {b.first ? <span className="text-[8px] leading-none text-axal-ink dark:text-gray-100" aria-hidden>●</span> : null}
              <span className="w-full rounded-t-[2px] bg-teal-500 dark:bg-teal-400" style={{ height: `${b.openPct}%` }} />
              <span className="w-full bg-axal-violet dark:bg-violet-400" style={{ height: `${b.ndaPct}%` }} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function Funnel({ title, funnel, gated, testId }) {
  const rows = funnelRows(funnel, gated);
  return (
    <section className={`${CARD} flex flex-col gap-2.5 p-4`} data-testid={testId}>
      <span className={`text-[14px] font-extrabold ${INK}`}>{title}</span>
      {rows.map((r) => (
        <div key={r.key} className="flex flex-col gap-1">
          <div className="flex justify-between text-[12.5px]">
            <span className={INK}>{r.label}</span>
            <span className="font-mono text-axal-muted dark:text-gray-400" data-testid={`${testId}-${r.key}`}>{r.n == null ? r.note : String(r.n)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800">
            <div className={`h-2 rounded-full ${gated ? 'bg-axal-violet dark:bg-violet-400' : 'bg-teal-500 dark:bg-teal-400'}`} style={{ width: `${r.width}%` }} />
          </div>
        </div>
      ))}
    </section>
  );
}

export function DropOff({ dropoff }) {
  const cur = dropRows(dropoff?.current);
  const prev = new Map(dropRows(dropoff?.previous).map((r) => [r.index, r]));
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-2 p-4`} data-testid="share-board-dropoff">
      <span className={`text-[14px] font-extrabold ${INK}`}>{dropTitle(dropoff)}</span>
      {!cur.length ? <p className={`m-0 ${MUTED}`}>{NOT_RECORDED}</p> : (
        <div className="flex flex-col gap-1.5">
          {cur.map((r) => (
            <div key={r.index} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 text-[12.5px]" data-testid={`share-board-drop-${r.index}`}>
              <span className={`truncate ${INK}`}>{r.title}</span>
              <span className="font-mono text-axal-muted dark:text-gray-400">
                {r.seconds == null ? NOT_RECORDED : `${r.seconds}s`}
                {prev.get(r.index)?.seconds != null ? ` · was ${prev.get(r.index).seconds}s` : ''}
              </span>
              <span className="w-[72px] text-right font-mono text-axal-muted dark:text-gray-400">{r.drop == null ? '' : `−${r.drop}% after`}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
