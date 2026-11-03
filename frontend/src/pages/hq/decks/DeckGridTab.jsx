import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '../../../ui';
import { adminDeckGridApi } from '../../../lib/api/adminDeckGrid';
import { reportError } from '../../../lib/log';
import {
  BUDGET_LINE, DAY_CHOICES, FUNNEL_LINE, GRID_LINE, NOT_RECORDED, UNREADABLE,
  acceptRows, budgetCard, ceilingLine, gridRows, kpiTiles, quoteBands,
} from './deckGridModel';

/**
 * D1537 (#3786, deck v2 B10) — HQ › Decks › Grid health (`view="grid"`) and
 * Funnel (`view="funnel"`), on the HQ admin pattern of AI models (no canvas
 * draws these pages; S1, 2026-11-02).
 *
 *   Grid health  the error budget card, today's ceiling (D1510), and the
 *                elements × models table: steps, error rate, p95 against its
 *                target, cost, fallbacks, drift and the eval score.
 *   Funnel       the KPI tiles (3+ generations, first share, 4-week
 *                retention), quote conversion by price band, and the accept
 *                rate per element and model.
 *
 * HQ admins only (the routes check). A read that fails says so with Try again,
 * never as an empty table or a 0; a figure the Worker could not read is
 * Not recorded.
 */

const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const TH = 'sticky top-0 bg-white px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-axal-muted dark:bg-gray-900 dark:text-gray-400';
const TD = 'px-2 py-2 align-top text-[13px] text-axal-ink dark:text-gray-100';
const BTN = 'rounded-lg border border-axal-hairline px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200';
const SELECT = 'rounded-md border border-axal-hairline bg-white px-2 py-1 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const TONE = { over: 'text-red-700 dark:text-red-300', ok: 'text-emerald-700 dark:text-emerald-300', none: '' };

function useRead(load, deps) {
  const [reply, setReply] = useState(undefined);
  const [tick, setTick] = useState(0);
  const retry = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let live = true;
    setReply(undefined);
    load().then((v) => { if (live) setReply(v); }, (e) => {
      if (e?.status !== 403) reportError('hq-deck-grid:read', e);
      if (live) setReply(e?.status === 403 ? { refused: true } : null);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  return [reply, retry];
}

function Unreadable({ what, retry, testId }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] text-red-700 dark:text-red-300" data-testid={testId}>
      <span><strong>Could not be read.</strong> {what} did not load. That is not the same as there being none.</span>
      <button type="button" className={BTN} onClick={retry}>Try again</button>
    </div>
  );
}

function Days({ days, setDays }) {
  return (
    <label className={`${MUTED} flex items-center gap-2`}>
      <span>Window</span>
      <select className={SELECT} value={days} onChange={(e) => setDays(Number(e.target.value))} data-testid="hq-deck-grid-days">
        {DAY_CHOICES.map((d) => <option key={d} value={d}>Last {d} days</option>)}
      </select>
    </label>
  );
}

function GridHealth() {
  const [days, setDays] = useState(30);
  const [reply, retry] = useRead(() => adminDeckGridApi.grid(days), [days]);
  const [gen] = useRead(() => adminDeckGridApi.generation(days), [days]);
  if (reply === undefined) return <Card><p className={MUTED} role="status" data-testid="hq-deck-grid-reading">Reading…</p></Card>;
  if (reply === null) return <Card><Unreadable what="The Grid's health" retry={retry} testId="hq-deck-grid-unreadable" /></Card>;
  if (reply.refused) return <Card><p className={MUTED} data-testid="hq-deck-grid-refused">Only an HQ admin can see the Grid's health.</p></Card>;
  const rows = gridRows(reply);
  const budget = budgetCard(reply.budget);
  return (
    <div className="space-y-4" data-testid="hq-deck-grid">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-bold text-axal-ink dark:text-gray-100">Error budget · 28 days</h3>
            <p className={MUTED}>{BUDGET_LINE}</p>
          </div>
          <p className={MUTED} data-testid="hq-deck-grid-ceiling">Today's ceiling: {gen && !gen.refused ? ceilingLine(gen) : NOT_RECORDED}</p>
        </div>
        {budget === null ? <p className={MUTED} data-testid="hq-deck-grid-budget-unreadable">{UNREADABLE}.</p>
          : budget.empty ? <p className={`${MUTED} mt-2`} data-testid="hq-deck-grid-budget-empty">{budget.line}</p>
            : (
              <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="hq-deck-grid-budget">
                <div><dt className={MUTED}>Succeeded</dt><dd className="text-[15px] font-bold">{budget.success}</dd></div>
                <div><dt className={MUTED}>Budget used</dt><dd className="text-[15px] font-bold">{budget.used}</dd></div>
                <div><dt className={MUTED}>Last hour</dt><dd className={`text-[13px] font-semibold ${budget.alerting ? 'text-red-700 dark:text-red-300' : ''}`} data-testid="hq-deck-grid-last-hour">{budget.lastHour}</dd></div>
                <div><dt className={MUTED}>Budget</dt><dd className="text-[13px]">{budget.budget}</dd></div>
              </dl>
            )}
      </Card>
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className={MUTED}>{GRID_LINE}</p>
          <Days days={days} setDays={setDays} />
        </div>
        {rows === null ? <Unreadable what="The metrics" retry={retry} testId="hq-deck-grid-rows-unreadable" />
          : !rows.length ? <p className={MUTED} data-testid="hq-deck-grid-empty">No generation step finished in this window.</p>
            : (
              <div className="max-h-[36rem] overflow-auto">
                <table className="w-full" data-testid="hq-deck-grid-table">
                  <thead>
                    <tr>
                      {['Element', 'Model', 'Steps', 'Error rate', 'p95', 'Cost', 'Fallbacks', 'Eval score', 'Drift'].map((h) => <th key={h} className={TH}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`hq-deck-grid-row-${r.key}`}>
                        <td className={TD}><span className="font-semibold">{r.element}</span><br /><span className={MUTED}>{r.kind}</span></td>
                        <td className={TD}>{r.model}</td>
                        <td className={TD}>{r.steps}</td>
                        <td className={TD}>{r.errorRate}</td>
                        <td className={`${TD} font-semibold ${TONE[r.p95Tone]}`} title={`Target ${r.target}`}>{r.p95}<br /><span className={`${MUTED} font-normal`}>target {r.target}</span></td>
                        <td className={TD}>{r.cost}</td>
                        <td className={TD}>{r.fallbacks}</td>
                        <td className={TD}><span className={MUTED}>{r.evalScore}</span></td>
                        <td className={TD}>{r.drift ? <span className="font-semibold text-amber-700 dark:text-amber-300">{r.drift}</span> : <span className={MUTED} aria-label="no drift">–</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </Card>
    </div>
  );
}

function Funnel() {
  const [days, setDays] = useState(30);
  const [reply, retry] = useRead(() => adminDeckGridApi.funnel(days), [days]);
  if (reply === undefined) return <Card><p className={MUTED} role="status" data-testid="hq-deck-funnel-reading">Reading…</p></Card>;
  if (reply === null) return <Card><Unreadable what="The funnel" retry={retry} testId="hq-deck-funnel-unreadable" /></Card>;
  if (reply.refused) return <Card><p className={MUTED} data-testid="hq-deck-funnel-refused">Only an HQ admin can see the funnel.</p></Card>;
  const tiles = kpiTiles(reply);
  const bands = quoteBands(reply);
  const accept = acceptRows(reply);
  return (
    <div className="space-y-4" data-testid="hq-deck-funnel">
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className={MUTED}>{FUNNEL_LINE}</p>
          <Days days={days} setDays={setDays} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {tiles.map((t) => (
            <div key={t.key} className="rounded-xl border border-axal-hairline p-3 dark:border-gray-800" data-testid={`hq-deck-kpi-${t.key}`}>
              <p className={MUTED}>{t.label}</p>
              <p className="text-[20px] font-bold text-axal-ink dark:text-gray-100">{t.value}</p>
              {t.sub ? <p className={MUTED}>{t.sub}</p> : null}
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <h3 className="mb-2 text-[14px] font-bold text-axal-ink dark:text-gray-100">Quote conversion by price band</h3>
        {bands === null ? <p className={MUTED} data-testid="hq-deck-bands-unreadable">{UNREADABLE}.</p> : (
          <table className="w-full" data-testid="hq-deck-bands">
            <thead><tr>{['Band', 'Shown', 'Confirmed', 'Conversion'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
            <tbody>
              {bands.map((b) => (
                <tr key={b.label} className="border-t border-axal-hairline dark:border-gray-800">
                  <td className={TD}>{b.label}</td><td className={TD}>{b.shown}</td><td className={TD}>{b.confirmed}</td><td className={TD}>{b.conversion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card>
        <h3 className="mb-2 text-[14px] font-bold text-axal-ink dark:text-gray-100">Accept rate per element and model</h3>
        {accept === null ? <p className={MUTED} data-testid="hq-deck-accept-unreadable">{UNREADABLE}.</p>
          : !accept.length ? <p className={MUTED}>No proposal in this window.</p> : (
            <table className="w-full" data-testid="hq-deck-accept">
              <thead><tr>{['Element', 'Model', 'Proposals', 'Decided', 'Accept rate'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
              <tbody>
                {accept.map((a) => (
                  <tr key={a.key} className="border-t border-axal-hairline dark:border-gray-800">
                    <td className={TD}>{a.element}</td><td className={TD}>{a.model}</td><td className={TD}>{a.proposals}</td><td className={TD}>{a.decided}</td><td className={TD}>{a.rate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>
    </div>
  );
}

export default function DeckGridTab({ view }) {
  return view === 'funnel' ? <Funnel /> : <GridHealth />;
}
