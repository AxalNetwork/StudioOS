import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { deckRehearsalsApi } from '../../../lib/api/deckRehearsals.js';
import { reportError } from '../../../lib/log';
import { BUDGET_TICK, NO_REHEARSALS, PER_CARD_LINE, REHEARSALS_UNREAD, REHEARSAL_COLUMNS, cardBars, rehearsalRow } from './scriptTileModel';

/**
 * D4270 (#4270, ps4c) — Rehearsals under Script & rehearsal: each run of the
 * deck version (the founder's own, D1580), its date, its duration against the
 * target, words a minute, filler words, cards over budget and notes covered.
 * Open shows its per-card timing bars, where the black tick is the card's
 * budget. Every figure is the report's; a run without one reads Not recorded.
 */

const BTN = 'inline-flex min-h-[28px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] px-2.5 text-[11.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const CELL = 'px-2 py-2 text-left text-[12.5px] tabular-nums';
const OVER = 'font-bold text-amber-800 dark:text-amber-300';

export default function RehearsalsTab({ deckId, deckTitle }) {
  const [list, setList] = useState({ status: deckId == null ? 'none' : 'loading', data: null });
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    if (deckId == null) { setList({ status: 'none', data: null }); return () => {}; }
    let live = true;
    setList({ status: 'loading', data: null });
    deckRehearsalsApi.list(deckId)
      .then((data) => { if (live) setList({ status: 'ok', data }); })
      .catch((e) => { if (live) setList({ status: 'error', data: null }); reportError('pitch-script:rehearsals', e); });
    return () => { live = false; };
  }, [deckId]);
  useEffect(() => load(), [load]);

  const openRun = (uid, label) => {
    setOpen({ uid, label, status: 'loading', report: null });
    deckRehearsalsApi.read(deckId, uid)
      .then((res) => setOpen((o) => (o?.uid === uid ? { ...o, status: 'ok', report: res?.rehearsal?.report ?? null } : o)))
      .catch((e) => { setOpen((o) => (o?.uid === uid ? { ...o, status: 'error' } : o)); reportError('pitch-script:rehearsal', e); });
  };

  if (list.status === 'none') return <div className={`${CARD} p-6 ${MUTED}`} data-testid="pitch-rehearsals-no-deck">{NO_REHEARSALS}</div>;
  if (list.status === 'loading') return <div className="h-32 w-full animate-pulse rounded-[12px] bg-axal-hairline dark:bg-gray-800" aria-hidden="true" data-testid="pitch-rehearsals-loading" />;
  if (list.status === 'error') {
    return (
      <div className={`${CARD} flex flex-col items-start gap-2.5 p-5`} data-testid="pitch-rehearsals-error">
        <span className={`text-[13.5px] font-bold ${INK}`}>{REHEARSALS_UNREAD}</span>
        <button type="button" className={GHOST} onClick={load}><RefreshCw size={14} aria-hidden="true" /> Try again</button>
      </div>
    );
  }
  const rows = (list.data?.rehearsals || []).map(rehearsalRow);

  return (
    <div className="flex flex-col gap-4">
      <section className={`${CARD} flex flex-col gap-2 p-5`} aria-labelledby="pitch-rehearsals-title" data-testid="pitch-rehearsals">
        <div className="flex flex-col gap-0.5">
          <h2 id="pitch-rehearsals-title" className={`m-0 text-[16px] font-extrabold ${INK}`}>Rehearsals</h2>
          <span className={MUTED} data-testid="pitch-rehearsals-line">{rows.length} {rows.length === 1 ? 'run' : 'runs'} of {deckTitle || 'your deck'}</span>
        </div>
        {rows.length === 0 ? <p className={`m-0 ${MUTED}`} data-testid="pitch-rehearsals-empty">{NO_REHEARSALS}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-b border-axal-hairline dark:border-gray-700">
                  {REHEARSAL_COLUMNS.map((h) => <th key={h} scope="col" className={`${CELL} text-[11px] font-bold uppercase tracking-[.04em] text-axal-muted dark:text-gray-400`}>{h}</th>)}
                  <th scope="col" className={CELL}><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.uid} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`pitch-rehearsal-${r.uid}`}>
                    <td className={`${CELL} ${INK}`}>{r.date}</td>
                    <td className={`${CELL} ${r.over ? OVER : INK}`} data-testid={`pitch-rehearsal-duration-${r.uid}`}>{r.duration}</td>
                    <td className={`${CELL} ${INK}`}>{r.wpm}</td>
                    <td className={`${CELL} ${INK}`}>{r.fillers}</td>
                    <td className={`${CELL} ${INK}`}>{r.cards_over}</td>
                    <td className={`${CELL} ${INK}`}>{r.notes}</td>
                    <td className={CELL}>
                      {r.failed ? <span className={MUTED}>Failed</span> : (
                        <button type="button" className={GHOST} onClick={() => openRun(r.uid, r.date)} aria-expanded={open?.uid === r.uid} data-testid={`pitch-rehearsal-open-${r.uid}`}>Open</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {open ? (
        <section className={`${CARD} flex flex-col gap-2 p-5`} aria-labelledby="pitch-rehearsal-cards-title" data-testid="pitch-rehearsal-cards">
          <div className="flex flex-col gap-0.5">
            <h3 id="pitch-rehearsal-cards-title" className={`m-0 text-[15px] font-extrabold ${INK}`}>{open.label} · per card</h3>
            <span className={MUTED}>{PER_CARD_LINE}</span>
          </div>
          {open.status === 'loading' ? <div className="h-24 animate-pulse rounded-[9px] bg-axal-hairline dark:bg-gray-800" aria-hidden="true" /> : null}
          {open.status === 'error' ? <p className={`m-0 ${MUTED}`} role="status">That rehearsal could not be read.</p> : null}
          {open.status === 'ok' ? (
            <>
              <ol className="m-0 flex list-none flex-col gap-2 p-0">
                {cardBars(open.report).map((c) => (
                  <li key={c.card} className="grid grid-cols-[24px_minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-3" data-testid={`pitch-rehearsal-card-${c.card}`}>
                    <span className="text-[11.5px] tabular-nums text-axal-muted dark:text-gray-400">{c.card}</span>
                    <span className={`truncate text-[12.5px] font-semibold ${INK}`}>{c.title}</span>
                    <span className="relative h-2.5 rounded-full bg-axal-ground dark:bg-gray-800" aria-hidden="true">
                      <span className={`absolute inset-y-0 left-0 rounded-full ${c.over ? 'bg-amber-500' : 'bg-axal-violet'}`} style={{ width: `${c.bar}%` }} />
                      <span className="absolute -top-1 bottom-[-4px] w-[2px] bg-axal-ink dark:bg-gray-100" style={{ left: `${c.tick}%` }} />
                    </span>
                    <span className={`text-[12px] tabular-nums ${c.over ? OVER : 'text-axal-muted dark:text-gray-400'}`}>{c.line}</span>
                  </li>
                ))}
              </ol>
              <p className={`m-0 ${MUTED}`}>{BUDGET_TICK}</p>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
