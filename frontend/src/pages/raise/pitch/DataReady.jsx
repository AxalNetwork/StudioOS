import React from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { GradeDot } from './SourcesBoards';
import { NOT_RECORDED } from './pitchStudioModel';
import { UNREADABLE_SHARE, readiness } from './sourcesModel';

/**
 * D1604 (#3716, pd1, pd9b, pd9c) — Data ready on the studio's home: how much
 * of what a deck draws on each area already records, from the one sources
 * read (`GET /api/decks/sources`, through `useDeckSources`).
 *
 * Each area is a bar (an image named "<area> <n>% ready") and its share, then
 * what it records, each with its grade, and the first slot nothing fills,
 * "Not recorded" with "Add in … ›" (never 0). Loading draws six skeleton
 * lines and no share; a failed read says "Your sources could not be read."
 * with Try again and draws no bar at all. PostHog, HubSpot and Linear rows
 * (#3880) and data-room rows (#3881) arrive through the same read.
 */

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const MUTED = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const LINK = 'text-[12px] font-bold text-axal-violet hover:underline dark:text-violet-300';
const GHOST = 'inline-flex min-h-[36px] items-center justify-center gap-2 self-start whitespace-nowrap rounded-[9px] border border-axal-hairline bg-white px-3.5 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

export const DATA_READY = 'Data ready';
export const SOURCES_FAILED = 'Your sources could not be read.';
export const NOTHING_YET = 'StudioOS has nothing a deck can draw on yet. Start with Validate › Customer research or connect Stripe.';

export default function DataReady({ sources }) {
  const status = sources?.status || 'loading';
  const rows = status === 'ok' ? readiness(sources.data?.items) : [];
  return (
    <section className={`${CARD} flex flex-col gap-3 p-4`} aria-busy={status === 'loading' ? 'true' : undefined} data-testid="pitch-studio-data-ready">
      <span className={EYE}>{DATA_READY}</span>
      {status === 'loading' || status === 'idle' ? (
        <div className="flex flex-col gap-2" data-testid="pitch-studio-data-ready-loading">
          <span className={MUTED}>Reading…</span>
          {Array.from({ length: 6 }, (_, i) => <span key={i} className="h-3 w-full animate-pulse rounded-full bg-axal-hairline dark:bg-gray-800" aria-hidden="true" />)}
        </div>
      ) : status === 'error' ? (
        <div role="alert" className="flex flex-col gap-2" data-testid="pitch-studio-data-ready-error">
          <span className={`text-[13px] font-bold ${INK}`}>{SOURCES_FAILED}</span>
          {sources.retry ? <button type="button" className={GHOST} onClick={sources.retry}><RefreshCw size={14} aria-hidden="true" /> Try again</button> : null}
        </div>
      ) : !rows.length ? (
        <span className={MUTED} data-testid="pitch-studio-data-ready-empty">{NOTHING_YET}</span>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2" data-testid="pitch-studio-data-ready-rows">
          {rows.map((r) => (
            <li key={r.id} className="flex min-w-0 flex-col gap-1.5" data-testid={`pitch-studio-ready-${r.id}`}>
              <div className="flex items-center gap-2">
                <span className={`w-[64px] flex-none text-[12.5px] font-bold ${INK}`}>{r.label}</span>
                {r.pc == null ? (
                  <span className={`flex-1 italic ${MUTED}`} data-testid={`pitch-studio-ready-unread-${r.id}`}>{UNREADABLE_SHARE}</span>
                ) : (
                  <>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800" role="img" aria-label={r.aria}>
                      <span className="block h-full rounded-full bg-axal-violet dark:bg-violet-400" style={{ width: `${r.pc}%` }} />
                    </span>
                    <span className="w-[38px] flex-none text-right font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{r.pc}%</span>
                  </>
                )}
              </div>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0 pl-[72px]">
                {r.lines.map((l) => (
                  <li key={l.key} className={`flex flex-wrap items-center gap-1.5 ${MUTED}`}>
                    <span className={INK}>{l.label}</span>
                    {l.missing ? (
                      <>
                        <span className="italic">· {NOT_RECORDED}</span>
                        {l.add ? <Link to={l.add.href} className={LINK} data-testid={`pitch-studio-ready-add-${r.id}`}>{l.add.text}</Link> : null}
                      </>
                    ) : (
                      <>
                        {l.value ? <span className="font-mono">{l.value}</span> : null}
                        <span className="inline-flex items-center gap-1">· <GradeDot grade={l.grade} />{l.grade}</span>
                      </>
                    )}
                  </li>
                ))}
                {r.unread ? <li className={MUTED}>{r.unread} could not be read.</li> : null}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
