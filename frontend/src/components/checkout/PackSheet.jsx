import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Lock, X } from 'lucide-react';
import { api as mainApi } from '../../lib/api';
import { aiBudgetApi } from '../../lib/api/aiBudget';
import { topUpRows } from '../../pages/account/usageModel';
import { notifyTokensAdded } from '../../lib/aiTokens';
import { SECURE_LINE, SELLER_LINE, declineFamily, newNonce, refusalView } from './checkoutModel';
import { CardFormBoundary, SHEET_BAR, SHEET_SCROLL_PAD, STRIPE_BRIDGE, backdropClose, useDialog } from './CheckoutSheet';
import {
  HISTORY_EMPTY, HISTORY_EMPTY_LINE, HISTORY_MORE, HISTORY_TITLE, NOTHING_ON_SALE, PACK_PROMO, PACK_RATE, PACK_TITLE, PACKS_UNREADABLE,
  CUSTOM_KEY, CUSTOM_LABEL, PICK_ANOTHER, RUNS_TOGGLE, autoReloadView, backLabel, balanceLine, countFrames, customPack, customRangeLine, holdRule, intentBody, keepsReading, landingView,
  packRule, packTotals, packsView, startingPack,
} from './packModel';

/**
 * D1287 (#3370, part 2 of #2452) — the checkout sheet's pack mode, "Add
 * tokens" (canvas CRP2–CRP5, CRP7, CRP8, CRP15, CRP17). Models' Add tokens
 * and each pack's Buy open it in place, on that pack; a pack lands in the
 * balance without leaving the page.
 *
 *   - Add tokens: the packs as radio rows with their offers, the balance
 *     before and after, the totals, auto-reload's state (read only, D794),
 *     and the payment column as D1053 draws it.
 *   - Pay sends `POST /api/orders/intent` exactly one pack line, then confirms
 *     the order's PaymentIntent with the card form. A pack rule the Worker
 *     refuses (D755 §5, D790) is drawn on the pack's row with Pay disabled; a
 *     decline is one of D1053's five families of words.
 *   - Then `GET /api/orders/:ref` is read until its `ai_topup` is credited:
 *     "Payment received. Adding …" while it waits, "Your tokens are on their
 *     way." past an hour (no retry), and "Tokens added." with the balance
 *     counting up only on `credited`, which only the webhook writes (D755 §6).
 *   - History: `GET /api/ai-budget/history`, with "Show AI runs".
 *
 * Its reads are `reads`, so a test can answer them, and `bridge` is the
 * Stripe side, as on the plan sheet.
 */

const EYE = 'font-mono text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-[44px] w-full items-center justify-center rounded-[9px] px-4 text-[14px] font-bold';
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-60`;
const LINK = 'inline-flex min-h-[44px] items-center text-[13px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 sm:min-h-0';
const MONO = 'font-mono tabular-nums';
const ALERT = 'flex flex-col gap-1 rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200';
const RULE = 'mt-1 block rounded-[8px] border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12.5px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200';

export const PACK_READS = {
  topUp: () => aiBudgetApi.topUp(),
  mine: () => aiBudgetApi.mine(),
  autoReload: () => aiBudgetApi.autoReloadState(),
  history: (opts) => aiBudgetApi.history(opts),
  intent: (body) => mainApi.createOrderIntent(body),
  order: (ref) => mainApi.getOrder(ref),
};
export const PACK_POLL_MS = 2_000;
const FRAME_MS = 40;

/** One read, its state, and Try again. */
function useRead(load, deps) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRead({ status: 'loading', data: null });
    Promise.resolve().then(load).then((data) => { if (live) setRead({ status: 'ready', data }); }, (error) => { if (live) setRead({ status: 'unreadable', data: null, error }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...read, retry: useCallback(() => setTick((n) => n + 1), []) };
}

const stillMotion = () => {
  try {
    if (typeof document !== 'undefined' && document.hidden) return true;
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch { return true; }
};

/** CRP3: the balance counting up from old to new; screen readers hear the final figure only. */
function CountingBalance({ fromMicro, toMicro }) {
  const [frames] = useState(() => countFrames(fromMicro, toMicro, 20, { still: stillMotion() }));
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (frames.length < 2) return undefined;
    const t = setInterval(() => setAt((i) => { if (i >= frames.length - 1) { clearInterval(t); return i; } return i + 1; }), FRAME_MS);
    return () => clearInterval(t);
  }, [frames]);
  const final = frames[frames.length - 1] ?? null;
  if (!final) return <span className={SUB} data-testid="pack-balance-unread">Your new balance couldn’t be read just now. It is on Usage.</span>;
  return (
    <span className="flex flex-col">
      <span className={EYE}>Token balance</span>
      <span aria-hidden="true" className={`${MONO} text-[28px] font-extrabold text-axal-ink dark:text-gray-100`} data-testid="pack-balance-count">{frames[at]}</span>
      <span className="sr-only" role="status" data-testid="pack-balance-final">{`Your token balance is ${final}.`}</span>
    </span>
  );
}

/** CRP3, CRP4: after Pay, the order's answer. */
function Landing({ order, view, fromMicro, paid, from, onClose, onHistory }) {
  if (view.key === 'credited') {
    return (
      <div className="flex flex-col items-start gap-3 px-6 py-6" data-testid="pack-accepted">
        <Check size={22} aria-hidden="true" className="text-axal-positive" />
        <h3 className="m-0 text-[18px] font-extrabold text-axal-ink dark:text-gray-100">{view.title}</h3>
        <CountingBalance fromMicro={fromMicro} toMicro={view.balanceMicro} />
        {view.bonus && <p className="m-0 text-[13px] font-bold text-axal-positive" data-testid="pack-bonus">{view.bonus}</p>}
        <dl className="m-0 grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]" data-testid="pack-receipt">
          <dt className={SUB}>Paid</dt><dd className={`m-0 ${MONO}`}>{paid || 'Not recorded'}</dd>
          <dt className={SUB}>Order</dt><dd className={`m-0 ${MONO}`}>{order?.order_ref || 'Not recorded'}</dd>
          <dt className={SUB}>Receipt</dt><dd className="m-0">Receipt sent to your email.</dd>
        </dl>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <button type="button" className={`${PRIMARY} sm:w-auto`} onClick={onClose} data-testid="pack-back">{backLabel(from)}</button>
          <button type="button" className={LINK} onClick={onHistory} data-testid="pack-see-history">See history</button>
          <button type="button" className={LINK} onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }
  if (view.key === 'overdue') {
    return (
      <div className="flex flex-col items-start gap-2 px-6 py-6" data-testid="pack-overdue">
        <h3 className="m-0 text-[18px] font-extrabold text-axal-ink dark:text-gray-100">{view.title}</h3>
        <p className={`m-0 ${SUB}`}>{view.line}</p>
        <Link to="/account/usage" className={LINK} onClick={onClose}>Open Usage ›</Link>
        <p className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">{view.sub}</p>
      </div>
    );
  }
  if (view.key === 'refunded' || view.key === 'disputed') {
    return (
      <div className="flex flex-col items-start gap-2 px-6 py-6" data-testid={`pack-${view.key}`}>
        <h3 className="m-0 text-[18px] font-extrabold text-axal-ink dark:text-gray-100">{view.title}</h3>
        <p className={`m-0 ${SUB}`}>{view.line}</p>
        <Link to="/account/usage" className={LINK} onClick={onClose}>Open Usage ›</Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2 px-6 py-6" role="status" data-testid="pack-landing">
      <h3 className="m-0 text-[18px] font-extrabold text-axal-ink dark:text-gray-100">{view.key === 'waiting' ? view.title : 'Payment received.'}</h3>
      <p className={`m-0 ${SUB}`}>{view.key === 'waiting' ? view.line : 'Adding your tokens to your balance…'}</p>
      <p className={`m-0 ${SUB}`}>This usually takes a few seconds.</p>
    </div>
  );
}

/** CRP8: the member's own top-ups, newest first; "Show AI runs" adds each run. */
function History({ reads, onClose }) {
  const [runs, setRuns] = useState(false);
  const read = useRead(() => reads.history({ runs, limit: 20 }), [runs]);
  const rows = read.status === 'ready' ? topUpRows(read.data) : null;
  return (
    <div className="flex flex-col gap-3 px-5 py-5" data-testid="pack-history">
      <div className="flex items-center justify-between gap-3">
        <span className={EYE}>{HISTORY_TITLE}</span>
        <label className="flex min-h-[44px] items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100 sm:min-h-0">
          <input type="checkbox" checked={runs} onChange={() => setRuns((r) => !r)} data-testid="pack-history-runs" />{RUNS_TOGGLE}
        </label>
      </div>
      {read.status === 'loading' && <span className="block h-24 animate-pulse rounded-[10px] bg-axal-ground dark:bg-gray-800" data-testid="pack-history-loading" />}
      {read.status === 'unreadable' && (
        <div className="flex flex-col items-start gap-1" role="alert" data-testid="pack-history-unreadable">
          <span className="text-[13px] text-axal-ink dark:text-gray-100">Your top-ups couldn’t be read just now. Your balance is unaffected.</span>
          <button type="button" className={LINK} onClick={read.retry}>Try again</button>
        </div>
      )}
      {rows && !rows.length && (
        <div className="flex flex-col gap-1 rounded-[10px] border border-dashed border-axal-hairline px-4 py-4 dark:border-gray-700" data-testid="pack-history-empty">
          <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{HISTORY_EMPTY}</span>
          <span className={SUB}>{HISTORY_EMPTY_LINE}</span>
        </div>
      )}
      {rows && rows.length > 0 && (
        <>
          <table className="hidden w-full text-left text-[13px] sm:table" data-testid="pack-history-table">
            <thead><tr className={EYE}><th className="py-1.5 font-bold">Date</th><th className="py-1.5 font-bold">What</th><th className="py-1.5 text-right font-bold">Amount</th><th className="py-1.5 font-bold">Order or page</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`pack-history-${r.kind}`}>
                  <td className={`py-2 ${SUB}`}>{r.when || 'Not recorded'}</td>
                  <td className="py-2 text-axal-ink dark:text-gray-100">{r.label}{r.kind === 'pending' ? <span className={`ml-1.5 ${SUB}`}>{r.note}</span> : null}</td>
                  <td className={`py-2 text-right ${MONO}`}>{r.amount ?? 'Not recorded'}</td>
                  <td className={`py-2 ${MONO} ${SUB}`}>{r.order || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="m-0 flex list-none flex-col p-0 sm:hidden" data-testid="pack-history-cards">
            {rows.map((r) => (
              <li key={r.key} className="flex items-baseline justify-between gap-2 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-800">
                <span className="flex min-w-0 flex-col"><span className="text-[13px] text-axal-ink dark:text-gray-100">{r.label}</span><span className={SUB}>{[r.when, r.order].filter(Boolean).join(' · ')}</span></span>
                <span className={`${MONO} text-[13px]`}>{r.amount ?? 'Not recorded'}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Link to="/account/usage#top-ups" className={LINK} onClick={onClose}>{HISTORY_MORE}</Link>
    </div>
  );
}

export default function PackSheet({ pack: wanted = null, from = 'Models', onClose, reads = PACK_READS, bridge = STRIPE_BRIDGE, pollMs = PACK_POLL_MS }) {
  const close = () => onClose?.();
  const box = useDialog(close);
  const [tab, setTab] = useState('add');

  const packs = useRead(() => reads.topUp(), []);
  const me = useRead(() => reads.mine(), []);
  const reload = useRead(() => reads.autoReload(), []);
  const view = packsView(packs);
  const [chosen, setChosen] = useState(null);
  useEffect(() => { if (view.status === 'ready' && chosen === null) setChosen(startingPack(view.rows, wanted, view.custom)); }, [view.status, view.rows, view.custom, wanted, chosen]);
  // D1366: the custom amount, typed in whole dollars; a pack only once it is in range.
  const [customText, setCustomText] = useState('');
  const custom = customPack(view.custom, customText);
  const pack = chosen === CUSTOM_KEY ? custom.pack : view.rows.find((r) => r.key === chosen) || null;
  const balanceMicro = me.status === 'ready' && Number.isSafeInteger(me.data?.balance_microusd) ? me.data.balance_microusd : null;

  const [card, setCard] = useState(undefined);
  const onCardReady = useCallback((api) => setCard(api), []);
  const [phase, setPhase] = useState('form');
  const [rules, setRules] = useState({});
  const [failure, setFailure] = useState(null);
  const [intent, setIntent] = useState(null);
  const nonce = useRef(newNonce());
  const locked = phase === 'processing';
  const hold = holdRule(view.onHold);
  const rule = hold || (pack ? rules[pack.key] : null);

  // After Pay: read the order until its tokens are credited, refunded or disputed.
  const [order, setOrder] = useState(null);
  useEffect(() => {
    if (phase !== 'landing' || !intent?.order_ref) return undefined;
    let live = true;
    let timer = null;
    const poll = () => {
      reads.order(intent.order_ref).then((r) => {
        if (!live) return;
        const o = r?.order || null;
        setOrder(o);
        if (keepsReading(landingView(o))) timer = setTimeout(poll, pollMs);
      }, () => { if (live) timer = setTimeout(poll, pollMs); });
    };
    poll();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [phase, intent, pollMs, reads]);

  const pay = async () => {
    if (locked || !pack || rule) return;
    setFailure(null);
    if (!card) { setFailure({ view: refusalView({ code: 'stripe_not_configured' }) }); return; }
    setPhase('processing');
    const s = await card.submit();
    if (s.error) { setPhase('form'); return; }
    let res;
    try {
      res = await reads.intent(intentBody(pack, nonce.current));
    } catch (e) {
      const r = packRule(e);
      if (r) setRules((m) => ({ ...m, [pack.key]: r }));
      else setFailure({ view: refusalView(e) });
      setPhase('form');
      return;
    }
    if (!res?.client_secret || res.free) { setFailure({ view: refusalView({}) }); setPhase('form'); return; }
    const r = await card.confirm(res.client_secret);
    if (r?.error) { setIntent(res); setFailure({ view: declineFamily(r.error), decline: true }); setPhase('form'); return; }
    setIntent(res);
    setOrder(null);
    setPhase('landing');
  };

  const CardForm = bridge.CardForm;
  const totals = packTotals(pack, intent);
  const landing = landingView(order);
  // D1363: once the tokens are credited, the page that was refused for them continues.
  useEffect(() => { if (phase === 'landing' && landing.key === 'credited') notifyTokensAdded(); }, [phase, landing.key]);
  const auto = autoReloadView(reload, view.rows);
  const paid = intent ? totals.find((t) => t.key === 'due')?.value : null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 sm:items-center" data-testid="pack-backdrop" {...backdropClose(close, locked)}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="pack-title" tabIndex={-1}
        className={`relative flex max-h-full w-full flex-col overflow-y-auto bg-white outline-none dark:bg-gray-900 sm:max-h-[88vh] sm:max-w-[880px] sm:rounded-[16px] ${SHEET_SCROLL_PAD}`}
        data-testid="pack-sheet">
        <div className={SHEET_BAR} data-testid="pack-bar">
        <div className="flex items-center justify-between border-b border-axal-hairline px-5 py-2 dark:border-gray-700">
          <div className="flex items-center gap-1" role="tablist" aria-label="Add tokens">
            {[['add', PACK_TITLE], ['history', HISTORY_TITLE]].map(([k, t]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} id={k === 'add' ? 'pack-title' : undefined} onClick={() => setTab(k)} disabled={locked} data-testid={`pack-tab-${k}`}
                className={`min-h-[44px] rounded-[8px] px-3 text-[15px] font-extrabold tracking-[-.02em] ${tab === k ? 'text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`}>{t}</button>
            ))}
          </div>
          <button type="button" aria-label="Close" onClick={close} data-testid="pack-close" className="grid h-11 w-11 place-items-center rounded-[9px] text-axal-muted hover:bg-axal-ground dark:text-gray-400 dark:hover:bg-gray-800"><X size={18} aria-hidden="true" /></button>
        </div>
        </div>
        {tab === 'history' ? <History reads={reads} onClose={close} />
          : phase === 'landing' ? <Landing order={order} view={landing} fromMicro={balanceMicro} paid={paid} from={from} onClose={close} onHistory={() => setTab('history')} />
            : (
              <div className="grid gap-6 px-5 pt-5 sm:grid-cols-[400px_1fr] sm:pb-5">
                <div className="flex flex-col gap-3.5" data-testid="pack-summary">
                  <span className={EYE}>AI tokens</span>
                  <p className={`m-0 ${SUB}`}>{PACK_RATE}</p>
                  {view.status === 'loading' && <span className="block h-32 animate-pulse rounded-[10px] bg-axal-ground dark:bg-gray-800" data-testid="pack-rows-loading" />}
                  {view.status === 'unreadable' && (
                    <div className="flex flex-col items-start gap-1" role="alert" data-testid="pack-rows-unreadable">
                      <span className="text-[13px] text-axal-ink dark:text-gray-100">{PACKS_UNREADABLE}</span>
                      <button type="button" className={LINK} onClick={packs.retry}>Try again</button>
                    </div>
                  )}
                  {view.status === 'none' && <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="pack-rows-none">{NOTHING_ON_SALE}</p>}
                  {view.status === 'ready' && (
                    <div className="flex flex-col gap-2" role="radiogroup" aria-label="Token packs" data-testid="pack-rows">
                      {view.rows.map((r) => {
                        const on = r.key === chosen;
                        const own = hold || rules[r.key];
                        return (
                          <label key={r.key} className={`flex min-h-[44px] cursor-pointer flex-col rounded-[10px] border px-3.5 py-2.5 ${on ? 'border-axal-violet bg-axal-lavender/40 dark:border-violet-500 dark:bg-violet-950/30' : 'border-axal-hairline dark:border-gray-700'}`} data-testid={`pack-row-${r.key}`}>
                            <span className="flex items-center gap-2.5">
                              <input type="radio" name="pack" checked={on} disabled={locked} onChange={() => { setChosen(r.key); setFailure(null); setIntent(null); }} data-testid={`pack-pick-${r.key}`} />
                              <span className="flex-1 text-[13.5px] font-bold text-axal-ink dark:text-gray-100">{r.label}</span>
                              <span className={`${MONO} text-[13.5px] font-bold text-axal-ink dark:text-gray-100`}>{r.price}</span>
                            </span>
                            {r.offers.length > 0 && (
                              <span className="mt-1 flex flex-wrap gap-1.5 pl-6">
                                {r.offers.map((o) => <span key={o} className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">{o}</span>)}
                              </span>
                            )}
                            {on && own && <span className={RULE} role="alert" data-testid={`pack-rule-${own.code}`}>{own.line}</span>}
                          </label>
                        );
                      })}
                      {view.custom && (() => {
                        const on = chosen === CUSTOM_KEY;
                        const own = hold || rules[CUSTOM_KEY];
                        const pick = () => { setChosen(CUSTOM_KEY); setFailure(null); setIntent(null); };
                        return (
                          <label className={`flex min-h-[44px] cursor-pointer flex-col rounded-[10px] border px-3.5 py-2.5 ${on ? 'border-axal-violet bg-axal-lavender/40 dark:border-violet-500 dark:bg-violet-950/30' : 'border-axal-hairline dark:border-gray-700'}`} data-testid="pack-row-custom">
                            <span className="flex items-center gap-2.5">
                              <input type="radio" name="pack" checked={on} disabled={locked} onChange={pick} data-testid="pack-pick-custom" />
                              <span className="flex-1 text-[13.5px] font-bold text-axal-ink dark:text-gray-100">{CUSTOM_LABEL}</span>
                              <span className="flex items-center gap-1">
                                <span className={`${MONO} text-[13.5px] font-bold text-axal-ink dark:text-gray-100`} aria-hidden="true">$</span>
                                <input type="text" inputMode="numeric" autoComplete="off" aria-label="Custom amount in dollars" placeholder={String(view.custom.minDollars)}
                                  value={customText} disabled={locked} onFocus={pick} onChange={(e) => { setCustomText(e.target.value); pick(); }} data-testid="pack-custom-amount"
                                  className={`${MONO} h-9 w-24 rounded-[8px] border border-axal-hairline bg-white px-2 text-right text-[13.5px] font-bold text-axal-ink outline-none focus:border-axal-violet dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100`} />
                              </span>
                            </span>
                            <span className={`mt-1 pl-6 ${SUB}`} data-testid="pack-custom-range">{customRangeLine(view.custom)}</span>
                            {on && custom.problem && <span className={RULE} role="alert" data-testid="pack-custom-problem">{custom.problem}</span>}
                            {on && own && <span className={RULE} role="alert" data-testid={`pack-rule-${own.code}`}>{own.line}</span>}
                          </label>
                        );
                      })()}
                    </div>
                  )}
                  {pack && <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="pack-balance-line">{balanceLine(balanceMicro, pack)}</p>}
                  {pack && (
                    <div className="flex flex-col gap-1 border-t border-axal-hairline pt-3 dark:border-gray-700" data-testid="pack-totals">
                      {totals.map((t) => (
                        <div key={t.key} className={`flex justify-between gap-3 text-[13px] ${t.strong ? 'font-bold text-axal-ink dark:text-gray-100' : ''}`} data-testid={`pack-total-${t.key}`}>
                          <span>{t.label}</span>
                          {t.value ? <span className={MONO}>{t.value}</span> : <span className="text-right italic text-axal-muted dark:text-gray-400">{t.reason}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  <p className={`m-0 ${SUB}`} data-testid="pack-promo">{PACK_PROMO}</p>
                  {auto.key !== 'loading' && (
                    <p className={`m-0 ${SUB}`} data-testid={`pack-auto-reload-${auto.key}`}>
                      {auto.line}{' '}<Link to="/account/billing#auto-reload" className={LINK} onClick={close}>{auto.link}</Link>
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-3.5" data-testid="pack-payment">
                  <span className={EYE}>Payment</span>
                  {pack && (
                    <CardFormBoundary>
                      <Suspense fallback={<span className="block h-[150px] animate-pulse rounded-[10px] bg-axal-ground dark:bg-gray-800" data-testid="pack-card-loading" />}>
                        <CardForm mode="payment" amount={pack.cents} currency={pack.currency} onReady={onCardReady} />
                      </Suspense>
                    </CardFormBoundary>
                  )}
                  {card === null && <p className={`m-0 ${SUB}`} data-testid="pack-not-set-up">Payments aren’t set up here. Nothing can be bought here yet. You were not charged.</p>}
                  {failure && (
                    <div className={ALERT} role="alert" data-testid={failure.decline ? `pack-decline-${failure.view.key}` : `pack-refused-${failure.view.key}`}>
                      <span className="font-bold">{failure.view.title}</span>
                      <span>{failure.view.line}</span>
                      {failure.decline && <span className="flex gap-3"><button type="button" className={LINK} onClick={pay} data-testid="pack-decline-retry">Try again</button></span>}
                    </div>
                  )}
                  <div className="sticky bottom-0 -mx-5 flex flex-col gap-1.5 border-t border-axal-hairline bg-white px-5 py-3 dark:border-gray-700 dark:bg-gray-900 sm:static sm:mx-0 sm:border-0 sm:p-0" data-testid="pack-pay-bar">
                    <button type="button" className={PRIMARY} onClick={pay} disabled={locked || !pack || !!rule || !card} data-testid="pack-pay">
                      {locked ? 'Processing…' : pack ? `Pay ${totals.find((t) => t.key === 'due')?.value ?? pack.price}` : 'Pay'}
                    </button>
                    {/* D1365: a way out beside Pay, on every screen size; none while a payment is taken. */}
                    {!locked && <button type="button" className={`${LINK} self-center`} onClick={close} data-testid="pack-cancel">Cancel</button>}
                    {rule && <p className={`m-0 ${SUB}`} data-testid="pack-pay-blocked">{PICK_ANOTHER}</p>}
                    {locked && <p className="m-0 text-[12.5px] font-bold text-axal-ink dark:text-gray-100" data-testid="pack-processing">Don’t close this window.</p>}
                  </div>
                  <p className={`m-0 flex items-start gap-1.5 pb-5 sm:pb-0 ${SUB}`}><Lock size={13} aria-hidden="true" className="mt-0.5 shrink-0" />{SECURE_LINE} {SELLER_LINE}</p>
                </div>
              </div>
            )}
      </div>
    </div>
  );
}
