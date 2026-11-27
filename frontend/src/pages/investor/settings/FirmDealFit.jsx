/**
 * D6287 part 2 (#6287): "In your deal flow now" (canvas CS-18, CS-18B,
 * CS-19B, CS-25B). After a save, the deals in the firm's flow
 * (`GET /api/deals/flow`) with their fit to the saved thesis
 * (`GET /api/deals/fit`): Match, Outside, Not set or Not recorded per
 * criterion. The compare is this session's only: the fit read just before
 * Save against the one after it. The platform keeps no fit history, so a
 * reload starts without one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataState } from '../../../ui';
import { reportError } from '../../../lib/log';
import { FIT_KEYS, FIT_WORDS, fitFailure, fitMoves, fitRow, flowDeals } from './firmSettingsModel.js';

/** One fit read: the flow, then fit for its deals. Throws what the failing read threw. */
export async function readDealFit(client) {
  const flow = await client.dealFlow();
  const { deals, total } = flowDeals(flow);
  if (!deals.length) return { deals, total, fits: new Map(), at: new Date() };
  const res = await client.dealFit(deals.map((d) => d.id));
  const fits = new Map((Array.isArray(res?.items) ? res.items : []).map((item) => [String(item.deal_id), item]));
  return { deals, total, fits, at: new Date() };
}

export const BASELINE_WAIT_MS = 3000;

/**
 * The session's fit rounds. `prime()` starts the read that stands for
 * "before Save" (the editor calls it on the first edit); `beforeSave()` waits
 * for it and never throws; `afterSave(before)` opens the next round; and the
 * panel hands each good read back through `remember`, as the next "before".
 */
export function useDealFitSession(client) {
  const baseline = useRef(null);
  const [round, setRound] = useState(null);
  const prime = useCallback(() => {
    if (!baseline.current) baseline.current = readDealFit(client).catch(() => null);
  }, [client]);
  // A slow "before" read never holds the save: past BASELINE_WAIT_MS the round has no compare.
  const beforeSave = useCallback(() => {
    prime();
    let timer;
    const wait = new Promise((resolve) => { timer = setTimeout(() => resolve(null), BASELINE_WAIT_MS); });
    return Promise.race([baseline.current, wait]).finally(() => clearTimeout(timer));
  }, [prime]);
  const afterSave = useCallback((before) => {
    baseline.current = null;
    setRound((r) => ({ n: (r?.n || 0) + 1, before: before || null }));
  }, []);
  const remember = useCallback((result) => { baseline.current = Promise.resolve(result); }, []);
  return { round, prime, beforeSave, afterSave, remember };
}

const GLYPH = { match: '✓', outside: '⊘', not_set: '–', not_recorded: '○' };
const TONE = {
  match: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  outside: 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  not_set: 'border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300',
  not_recorded: 'border-dotted border-gray-400 bg-transparent text-gray-600 dark:border-gray-500 dark:text-gray-400',
};

export function FitChip({ state }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[state]}`} data-fit={state}>
      <i aria-hidden="true" className="not-italic">{GLYPH[state]}</i>{FIT_WORDS[state]}
    </span>
  );
}

const time = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const OUT = 'inline-flex min-h-[44px] items-center text-sm font-semibold text-violet-700 underline dark:text-violet-300';

function DealName({ deal }) {
  const name = deal.name || 'Name not recorded';
  return deal.canOpen
    ? <Link to={`/deals/${deal.id}`} className="font-semibold text-gray-900 underline dark:text-gray-100">{name}</Link>
    : <span className="font-semibold text-gray-900 dark:text-gray-100">{name}</span>;
}

function RowState({ row, onRetry }) {
  if (row.kind === 'unavailable') return <DataState state="refused" claim="You can no longer read this deal." />;
  return <DataState state="unavailable" claim="The fit inputs could not be read." onRetry={onRetry} retryLabel="Try again" />;
}

function Moves({ moves, names }) {
  if (moves === null) return <p className="text-xs text-gray-600 dark:text-gray-400">No earlier fit read this session to compare with.</p>;
  return (
    <div className="space-y-1 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm dark:border-violet-800 dark:bg-violet-950/30" data-testid="fit-compare">
      <p className="text-xs font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">Before and after this save · this session only</p>
      {moves.length === 0
        ? <p className="text-gray-800 dark:text-gray-200">No deal changed on sector, stage, region or cheque.</p>
        : (
          <ul className="space-y-0.5 text-gray-800 dark:text-gray-200">
            {moves.map((m) => (
              <li key={`${m.dealId}-${m.key}`}><b>{names.get(m.dealId) || 'Name not recorded'}</b>: {m.label} moved {FIT_WORDS[m.from]} → {FIT_WORDS[m.to]}</li>
            ))}
          </ul>
        )}
      <p className="text-xs text-gray-600 dark:text-gray-400">The platform keeps no fit history. Value weights are not part of fit.</p>
    </div>
  );
}

export default function FirmDealFit({ client, round, onRead }) {
  const [read, setRead] = useState({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setRead({ kind: 'loading' });
    readDealFit(client).then(
      (data) => { if (!alive) return; setRead({ kind: 'ok', data }); onRead?.(data); },
      (error) => { reportError('FirmSettings:fit', error); if (alive) setRead({ kind: fitFailure(error) }); },
    );
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.n, attempt]);
  const retry = () => setAttempt((n) => n + 1);

  const data = read.kind === 'ok' ? read.data : null;
  const moves = data && round?.before ? fitMoves(round.before.fits, data.fits) : null;
  const moved = new Set((moves || []).map((m) => m.dealId));
  const names = new Map((data?.deals || []).map((d) => [d.id, d.name]));

  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900" aria-labelledby="deal-fit-now" data-testid="deal-fit">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="deal-fit-now" className="text-base font-semibold text-gray-900 dark:text-gray-100">In your deal flow now</h2>
          {data ? (
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {data.total} {data.total === 1 ? 'deal' : 'deals'} in your flow
              {data.total > data.deals.length ? `, fit for the first ${data.deals.length}` : ''} · fit from your saved thesis, read {time(data.at)}
            </p>
          ) : null}
        </div>
        {data?.deals.length ? <div className="flex flex-wrap gap-1" aria-label="Fit legend">{Object.keys(FIT_WORDS).map((s) => <FitChip key={s} state={s} />)}</div> : null}
      </div>

      {read.kind === 'loading' ? (
        <div aria-busy="true" aria-label="Loading" className="space-y-2">
          {[0, 1, 2].map((i) => <i key={i} className="block h-4 rounded bg-gray-200 dark:bg-gray-700" />)}
        </div>
      ) : read.kind === 'unreadable' ? (
        <DataState state="unavailable" size="block" what="Thesis fit" claim="Your thesis was saved. Deal fit could not be read just now." onRetry={retry} retryLabel="Try again" />
      ) : read.kind === 'plan' ? (
        <div className="space-y-1 text-sm">
          <DataState state="refused" claim="Deal fit comes with the Professional plan. Your thesis is still saved and used when you upgrade." />
          <Link to="/account/billing" className={OUT}>See plans in Billing <span aria-hidden="true">›</span></Link>
        </div>
      ) : read.kind === 'refused' ? (
        <DataState state="refused" claim="Only the investor can use these personal deal-flow settings." />
      ) : data.deals.length === 0 ? (
        <DataState state="none" size="block">No deals in your flow yet.</DataState>
      ) : (
        <>
          <Moves moves={moves} names={names} />
          <table className="hidden w-full text-left text-sm md:table">
            <thead className="text-xs text-gray-600 dark:text-gray-400">
              <tr>
                <th scope="col" className="py-1 pr-2 font-medium">Deal</th>
                {FIT_KEYS.map(([key, label]) => <th key={key} scope="col" className="py-1 pr-2 font-medium">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.deals.map((deal) => {
                const row = fitRow(data.fits.get(deal.id));
                return (
                  <tr key={deal.id} className={`border-t border-gray-100 dark:border-gray-800 ${moved.has(deal.id) ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}>
                    <th scope="row" className="py-2 pr-2 font-normal">
                      <DealName deal={deal} />
                      {deal.sector ? <small className="block text-xs text-gray-600 dark:text-gray-400">{deal.sector}</small> : null}
                    </th>
                    {row.kind === 'criteria'
                      ? FIT_KEYS.map(([key]) => <td key={key} className="py-2 pr-2"><FitChip state={row.cells[key]} /></td>)
                      : <td colSpan={4} className="py-2"><RowState row={row} onRetry={retry} /></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ul className="space-y-2 md:hidden">
            {data.deals.map((deal) => {
              const row = fitRow(data.fits.get(deal.id));
              return (
                <li key={deal.id} className={`rounded-lg border border-gray-200 p-3 dark:border-gray-800 ${moved.has(deal.id) ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}>
                  <DealName deal={deal} />
                  {deal.sector ? <small className="block text-xs text-gray-600 dark:text-gray-400">{deal.sector}</small> : null}
                  {row.kind === 'criteria' ? (
                    <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                      {FIT_KEYS.map(([key, label]) => [
                        <dt key={`${key}-t`} className="text-gray-600 dark:text-gray-400">{label}</dt>,
                        <dd key={`${key}-d`}><FitChip state={row.cells[key]} /></dd>,
                      ])}
                    </dl>
                  ) : <div className="mt-2"><RowState row={row} onRetry={retry} /></div>}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <Link to="/deals" className={OUT}>See your deal flow <span aria-hidden="true">›</span></Link>
    </section>
  );
}
