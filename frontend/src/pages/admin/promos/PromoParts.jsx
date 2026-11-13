/**
 * D1270 (#2381) — the parts of HQ › Platform › Promo codes that are not the
 * list itself: the Usage tab (PRM7) and one code's drawer at its address
 * (PRM2), over the list (`../consoles/PromoCodesConsole.jsx`).
 *
 * D1276 (#3302): Usage reads `GET /api/admin/promos/usage` for the range in
 * the address. Its five blocks arrive apart (`{ available, reason }`): each is
 * drawn, said empty in the canvas's words, or failed with Try again on its
 * own, so one failed block never blanks the tab. Each chart has View as table.
 *
 * D1275 (#3301): the drawer is complete — a lightbox with Overview,
 * Redemptions and History, read from `GET /api/admin/promos/:id`, `/:id/
 * redemptions` (with Stripe's own count) and `/:id/history` (D1274). Each tab
 * is its own read: one failing never blanks the others.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { adminPromosApi } from '../../../lib/api/adminPromos.js';
import { promoUsageApi } from '../../../lib/api/promoUsage.js';
import { reportError } from '../../../lib/log';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Chart, ChartTable, Legend, actionGhost, actionPrimary } from '../../../ui';
import {
  ACTION_WORD, NOT_YET, RANGES, SOURCES, STATE_WORD, WAITS, appliesWord, blockState, codeHref, currencyRows, dayWord, discountWord,
  durationWord, historyRow, limitWord, minuteWord, nearEndRows, nearEndSentence, periodWord, productsChart, rangeProblem,
  redeemedLines, redemptionRow, rowActions, topCodesChart, usageHref, usageRangeOf, usageTiles, weekChart,
} from './promoModel';
import { memberPays, draftFrom } from './promoWizard';
import Sheet from '../../../ui/Sheet.jsx';

const box = 'flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const MUTED = 'text-axal-muted dark:text-gray-400';

export function PromoWait({ id }) {
  return (
    <div className="flex flex-col gap-1" data-testid={`promo-wait-${id}`}>
      <span className="w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">{WAITS[id]}</p>
    </div>
  );
}

const CHIP = 'rounded-full border px-3 py-1 text-[12.5px] font-semibold';
const CHIP_ON = 'border-violet-600 bg-violet-50 text-violet-800 dark:border-[#a78bfa] dark:bg-violet-950 dark:text-violet-100';
const CHIP_OFF = 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200';
const DATE = 'rounded-lg border border-axal-hairline bg-white px-2 py-1 text-[12.5px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

/** The range chips; Custom opens two days and Apply. The range lives in the address. */
function RangeBar({ range, onRange }) {
  const [custom, setCustom] = useState(range.key === 'custom');
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [problem, setProblem] = useState(null);
  const apply = () => {
    const p = rangeProblem(from, to);
    setProblem(p);
    if (!p) onRange({ key: 'custom', from, to });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Range">
        {RANGES.map((r) => {
          const on = custom ? r.key === 'custom' : range.key === r.key;
          return (
            <button key={r.key} type="button" aria-pressed={on} className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`} data-testid={`promo-usage-range-${r.key}`}
              onClick={() => { if (r.key === 'custom') setCustom(true); else { setCustom(false); setProblem(null); onRange({ key: r.key }); } }}>{r.label}</button>
          );
        })}
      </div>
      {custom && (
        <div className="flex flex-wrap items-end gap-2 text-[12.5px]" data-testid="promo-usage-custom">
          <label className="flex flex-col gap-0.5 font-semibold">First day<input type="date" className={DATE} value={from} onChange={(e) => setFrom(e.target.value)} data-testid="promo-usage-from" /></label>
          <label className="flex flex-col gap-0.5 font-semibold">Last day<input type="date" className={DATE} value={to} onChange={(e) => setTo(e.target.value)} data-testid="promo-usage-to" /></label>
          <button type="button" className={actionGhost} onClick={apply} data-testid="promo-usage-apply">Apply</button>
          {problem && <span role="alert" className="text-red-700 dark:text-red-300" data-testid="promo-usage-range-problem">{problem}</span>}
        </div>
      )}
      <span className={`text-[11.5px] ${MUTED}`}>Whole days in UTC, both included. Weeks start on Monday.</span>
    </div>
  );
}

/** A block's frame: its title, its sentence, and View as table when it draws a chart. */
function Block({ id, title, chart, state, onRetry, children, wide = false }) {
  const [table, setTable] = useState(false);
  return (
    <section className={`${box} min-w-0 ${wide ? 'lg:col-span-2' : ''}`} aria-labelledby={`promo-usage-h-${id}`} data-testid={`promo-usage-${id}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 id={`promo-usage-h-${id}`} className="m-0 text-[14px] font-bold">{title}</h3>
        {chart && state.kind === 'ok' && (
          <button type="button" className="text-[12px] font-semibold text-axal-violet underline dark:text-[#a78bfa]" onClick={() => setTable(!table)} data-testid={`promo-usage-${id}-toggle`}>
            {table ? 'View as chart' : 'View as table'}
          </button>
        )}
      </div>
      {state.kind === 'loading' && <div className="h-24 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />}
      {state.kind === 'unreadable' && <ReadFailed what={title} onRetry={onRetry} testId={`promo-usage-${id}-failed`} />}
      {state.kind === 'empty' && <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid={`promo-usage-${id}-empty`}>{state.text}</p>}
      {state.kind === 'ok' && (
        <>
          {chart?.summary && <p className="m-0 text-[12.5px]" data-testid={`promo-usage-${id}-summary`}>{chart.summary}</p>}
          {chart && (table
            ? <div className="overflow-x-auto" data-testid={`promo-usage-${id}-table`}><ChartTable chart={chart} caption={title} /></div>
            : <div role="img" aria-label={chart.alt} data-testid={`promo-usage-${id}-chart`}><Chart chart={chart} /></div>)}
          {children}
        </>
      )}
    </section>
  );
}

function UsageTile({ t, reading }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900" data-testid={`promo-usage-tile-${t.key}`}>
      <span className={`text-[11px] font-bold uppercase tracking-[.06em] ${MUTED}`}>{t.label}</span>
      <span className="text-[19px] font-bold tabular-nums">{reading ? '…' : (t.value ?? 'Not recorded')}</span>
      <span className={`text-[11.5px] ${MUTED}`}>{reading ? 'Reading…' : t.sub}</span>
    </div>
  );
}

/**
 * PRM7, PRM8 (dark) and PRM13 (the phone: one block per screen width). `now`
 * is for tests; the range comes from the address.
 */
export function PromoUsage({ now }) {
  const location = useLocation();
  const navigate = useNavigate();
  const at = now ?? Date.now();
  const range = usageRangeOf(location.search, at);
  const [st, reload] = useRead(() => promoUsageApi.usage({ from: range.from, to: range.to }), [range.from, range.to], 'PromoUsage');
  const [exporting, setExporting] = useState({ busy: false, error: null });
  const u = st.kind === 'ok' ? st.data : null;
  const failed = st.kind !== 'ok' && st.kind !== 'loading';
  const of = (name) => {
    if (st.kind === 'loading') return { kind: 'loading', text: null };
    if (st.kind !== 'ok') return { kind: 'unreadable', text: null };
    return blockState(name, u?.[name]);
  };
  const week = u ? weekChart(u.redemptions, at) : null;
  const top = u ? topCodesChart(u.top_codes) : null;
  const products = u ? productsChart(u.products) : null;
  const currencies = u ? currencyRows(u.discount) : [];
  const near = u ? nearEndRows(u.near_end) : null;
  const exportCsv = async () => {
    setExporting({ busy: true, error: null });
    try { await promoUsageApi.exportCsv({ from: range.from, to: range.to }); setExporting({ busy: false, error: null }); } catch (e) {
      reportError('PromoUsage:export', e);
      setExporting({ busy: false, error: e?.message || 'The export could not be made. Try again.' });
    }
  };
  return (
    <section className="flex flex-col gap-3" data-testid="promo-usage">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[15px] font-bold">Usage</h2>
          <span className={`text-[12.5px] ${MUTED}`} data-testid="promo-usage-period">{dayWord(range.from)} to {dayWord(range.to)} · every code</span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button type="button" className={actionGhost} disabled={exporting.busy} onClick={exportCsv} data-testid="promo-usage-export">{exporting.busy ? 'Exporting…' : 'Export CSV'}</button>
          {exporting.error && <span role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid="promo-usage-export-error">{exporting.error}</span>}
        </div>
      </div>
      <RangeBar key={`${range.key}-${range.from}-${range.to}`} range={range} onRange={(r) => navigate(usageHref(r))} />
      {failed && <ReadFailed what="Usage for this period" onRetry={reload} testId="promo-usage-failed" />}
      {!failed && (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="promo-usage-tiles">
            {usageTiles(u, range).map((t) => <UsageTile key={t.key} t={t} reading={st.kind === 'loading'} />)}
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Block id="weeks" title="Redemptions per week" chart={week} state={of('redemptions')} onRetry={reload} wide>
              <Legend items={SOURCES.map((s) => ({ label: s.label, tone: s.tone }))} />
              <span className={`text-[11.5px] ${MUTED}`} data-testid="promo-usage-weeks-recorded">{week?.recorded}</span>
            </Block>
            <Block id="discount" title="Discount given, per currency" state={of('discount')} onRetry={reload}>
              <p className={`m-0 text-[12.5px] ${MUTED}`}>Each currency is shown on its own and never added together.</p>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="promo-usage-currencies">
                {currencies.map((c) => (
                  <li key={c.currency} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-gray-100 pt-1.5 text-[12.5px] dark:border-gray-800" data-testid="promo-usage-currency">
                    <span className="font-semibold">{c.currency}</span>
                    <span className="font-mono tabular-nums">{c.total} · {c.redemptions} redemptions · {c.average} on average</span>
                  </li>
                ))}
              </ul>
              {u?.discount?.not_recorded > 0 && <span className={`text-[11.5px] ${MUTED}`} data-testid="promo-usage-discount-unrecorded">{u.discount.not_recorded.toLocaleString('en-US')} {u.discount.not_recorded === 1 ? 'redemption carries' : 'redemptions carry'} no amount and {u.discount.not_recorded === 1 ? 'is' : 'are'} not in these figures.</span>}
              <PromoWait id="discountWeeks" />
            </Block>
            <Block id="top" title="Top codes" chart={top} state={of('top_codes')} onRetry={reload}>
              <span className={`text-[11.5px] ${MUTED}`}>Counted from StudioOS’s records for {periodWord(range)}. A code’s drawer gives Stripe’s own count.</span>
            </Block>
            <Block id="products" title="By plan and product" chart={products} state={of('products')} onRetry={reload}>
              {products?.unrecorded && <span className={`text-[11.5px] ${MUTED}`} data-testid="promo-usage-products-unrecorded">{products.unrecorded}</span>}
            </Block>
            <Block id="near" title="Codes near their end" state={of('near_end')} onRetry={reload} wide>
              <p className="m-0 text-[12.5px]" data-testid="promo-usage-near-summary">{nearEndSentence(u?.near_end)}</p>
              {near?.length > 0 && (
                <ul className="m-0 flex list-none flex-col p-0" data-testid="promo-usage-near-list">
                  {near.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 py-1.5 text-[12.5px] dark:border-gray-800" data-testid="promo-usage-near-row">
                      <span className="font-mono font-semibold">{r.code}</span>
                      <span className="flex items-center gap-3">
                        <span className="tabular-nums">{r.used}</span>
                        <span className={r.atCap ? 'font-semibold text-sky-800 dark:text-sky-200' : 'text-amber-800 dark:text-amber-200'}>{r.why}</span>
                        <Link to={codeHref(r.id)} className="font-semibold text-axal-violet underline dark:text-[#a78bfa]" data-testid={`promo-usage-near-open-${r.id}`}>Open</Link>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <span className={`text-[11.5px] ${MUTED}`}>Every active code, whatever the range. Paused codes are left out.</span>
            </Block>
          </div>
        </>
      )}
    </section>
  );
}

const PILL = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  paused: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  ended: 'border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200',
  expired: 'border-gray-300 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300',
  at_cap: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200',
  off: 'border-gray-300 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300',
};
export function StatePill({ state, testId }) {
  return <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[11.5px] font-bold ${PILL[state] || PILL.off}`} data-testid={testId}>{STATE_WORD[state] || 'Not recorded'}</span>;
}

/** A read that failed: what is missing, never an empty list, and Try again. */
export function ReadFailed({ what, onRetry, testId }) {
  return (
    <div className="flex flex-col gap-1" role="alert" data-testid={testId}>
      <p className="m-0 text-[13px] font-semibold">{what} could not be read. This is not a sign that there are none.</p>
      <button type="button" className={`${actionGhost} w-fit`} onClick={onRetry} data-testid={`${testId}-retry`}>Try again</button>
    </div>
  );
}

function useRead(load, deps, who = 'PromoDrawer') {
  const [st, setSt] = useState({ kind: 'loading', data: null });
  const run = useCallback(async () => {
    setSt((s) => ({ kind: s.data ? 'ok' : 'loading', data: s.data }));
    try { setSt({ kind: 'ok', data: await load() }); } catch (e) {
      reportError(`${who}:read`, e);
      setSt({ kind: e?.status === 404 ? 'missing' : 'failed', data: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return [st, run];
}

function Overview({ p, names, choices, red }) {
  const applies = appliesWord(p, names);
  const pays = choices ? memberPays(draftFrom(p), choices) : [];
  const ends = p.expires_at ? (minuteWord(p.expires_at) ? `${minuteWord(p.expires_at)} UTC` : 'Not recorded') : 'No expiry';
  const facts = [
    ['Discount', discountWord(p)], ['Applies to', applies.text], ['Duration', durationWord(p)], ['Limit', limitWord(p)], ['Ends', ends],
  ];
  if (p.note) facts.push(['Note', p.note]);
  return (
    <div className="flex flex-col gap-3" data-testid="promo-drawer-overview">
      <dl className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
        {facts.map(([k, v]) => (<React.Fragment key={k}><dt className="font-semibold">{k}</dt><dd className={`m-0 ${k === 'Applies to' && applies.unreadable ? 'text-red-700 dark:text-red-300' : ''}`} data-testid={`promo-fact-${k.toLowerCase().replace(/\s+/g, '-')}`}>{v}</dd></React.Fragment>))}
      </dl>
      {pays.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-axal-hairline p-3 dark:border-gray-800" data-testid="promo-drawer-pays">
          <span className="text-[12px] font-bold">What a member pays</span>
          {pays.map((r, i) => <div key={i} className="flex justify-between gap-2 text-[12.5px]"><span>{r.label}</span><span className="font-mono">{r.from ?? 'Not recorded'} → {r.applies ? (r.to ?? 'Not recorded') : 'not discounted'}</span></div>)}
        </div>
      )}
      <div className="flex flex-col gap-1 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/60" data-testid="promo-drawer-redeemed">
        <span className="text-[12px] font-bold">Redeemed</span>
        {redeemedLines(p, red.kind === 'ok' ? red.data : null).map((l) => (
          <div key={l.key} className="flex justify-between gap-2 text-[12.5px]" data-testid={`promo-redeemed-${l.key}`}>
            <span>{l.label}{l.why ? <span className={`block text-[11.5px] ${MUTED}`}>{red.kind === 'loading' ? 'Reading…' : l.why}</span> : null}</span>
            <span className="font-mono">{red.kind === 'loading' && l.key === 'stripe' ? '…' : l.value}</span>
          </div>
        ))}
        <span className={`text-[11.5px] ${MUTED}`}>StudioOS records each redemption from checkout; Stripe counts subscriptions too, so its count can be higher.</span>
      </div>
      <p className={`m-0 text-[12px] ${MUTED}`}><b>What can change.</b> Stripe keeps a code’s discount, scope, limit and expiry fixed. You can pause it, end it, rename it or replace it with a new code.</p>
    </div>
  );
}

function Redemptions({ red, onRetry, names }) {
  if (red.kind === 'loading') return <p className={`m-0 ${MUTED}`}>Reading…</p>;
  if (red.kind !== 'ok') return <ReadFailed what="This code’s redemptions" onRetry={onRetry} testId="promo-redemptions-failed" />;
  const block = red.data.redemptions;
  if (!block?.available) return <ReadFailed what="This code’s redemptions" onRetry={onRetry} testId="promo-redemptions-failed" />;
  const rows = block.rows.map((r) => redemptionRow(r, names));
  return (
    <div className="flex flex-col gap-2" data-testid="promo-drawer-redemptions">
      {rows.length === 0 ? <p className={`m-0 ${MUTED}`} data-testid="promo-redemptions-none">StudioOS has recorded no redemption of this code.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead><tr className={`text-left ${MUTED}`}><th className="py-1 pr-2">When</th><th className="py-1 pr-2">Member</th><th className="py-1 pr-2">Bought</th><th className="py-1 pr-2">Paid</th><th className="py-1 pr-2">Saved</th><th className="py-1">Source</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i} className="border-t border-gray-100 dark:border-gray-800" data-testid="promo-redemption-row">
                <td className="whitespace-nowrap py-1 pr-2 font-mono">{r.when}</td><td className="py-1 pr-2">{r.member}</td><td className="py-1 pr-2">{r.bought}</td>
                <td className="py-1 pr-2 font-mono">{r.paid}</td><td className="py-1 pr-2 font-mono">{r.saved}</td><td className="py-1">{r.source}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      <p className={`m-0 text-[11.5px] ${MUTED}`}>The newest hundred StudioOS recorded. A subscription redeemed before its record was kept is in Stripe’s count only.</p>
    </div>
  );
}

function History({ his, onRetry }) {
  if (his.kind === 'loading') return <p className={`m-0 ${MUTED}`}>Reading…</p>;
  const block = his.data?.history;
  if (his.kind !== 'ok' || !block?.available) return <ReadFailed what="This code’s history" onRetry={onRetry} testId="promo-history-failed" />;
  const rows = [...block.events].reverse().map(historyRow);
  return (
    <div className="flex flex-col gap-2" data-testid="promo-drawer-history">
      {rows.length === 0 && <p className={`m-0 ${MUTED}`}>The audit log holds no change to this code.</p>}
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((r, i) => (
          <li key={i} className="flex flex-col border-l-2 border-violet-200 pl-3 dark:border-violet-800" data-testid="promo-history-row">
            <span className="text-[13px] font-semibold">{r.what}</span>
            <span className={`font-mono text-[11.5px] ${MUTED}`}>{r.when}</span>
            {r.detail && <span className={`text-[12px] ${MUTED}`}>{r.detail}</span>}
          </li>
        ))}
      </ol>
      <p className={`m-0 text-[11.5px] ${MUTED}`}>From the admin audit log. A reason is kept on the code itself, not in this history.</p>
    </div>
  );
}

/**
 * PRM2: one code's drawer at its address, over the list. `row` is the list's
 * copy when the code is on the page; the drawer reads the code itself either
 * way. `onAction(kind, promo)` opens a dialog.
 */
export function PromoDrawer({ id, row = null, names = {}, choices = null, onClose, onAction, version = 0 }) {
  const [tab, setTab] = useState('overview');
  const [one, reloadOne] = useRead(() => adminPromosApi.one(id).then((r) => r.promo), [id, version]);
  const [red, reloadRed] = useRead(() => promoUsageApi.redemptions(id), [id, version]);
  const [his, reloadHis] = useRead(() => (tab === 'history' ? promoUsageApi.history(id) : Promise.resolve(null)), [id, version, tab === 'history']);
  if (!id) return null;
  const p = one.data || row;
  const title = p?.code || id;
  const state = p?.state;
  const acts = p ? rowActions(state).filter((a) => a !== 'open' && a !== 'copy_code') : [];
  const primary = acts.find((a) => a === 'pause' || a === 'resume');
  const more = [...acts.filter((a) => a !== primary && a !== 'copy_new'), ...(state !== 'ended' ? ['edit'] : []), ...(acts.includes('copy_new') ? ['copy_new'] : [])];
  const count = red.kind === 'ok' && red.data?.stripe?.available ? red.data.stripe.times_redeemed
    : (red.kind === 'ok' && red.data?.redemptions?.available ? red.data.redemptions.rows.length : null);
  return (
    <Sheet label={`Promo code ${title}`} title={title} sub={p?.name || undefined} onClose={onClose} width={720} testId="promo-drawer"
      footer={p && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {more.map((a) => <button key={a} type="button" className={actionGhost} onClick={() => onAction(a, p)} data-testid={`promo-drawer-${a}`}>{ACTION_WORD[a]}</button>)}
          {primary && <button type="button" className={actionPrimary} onClick={() => onAction(primary, p)} data-testid={`promo-drawer-${primary}`}>{primary === 'pause' ? 'Pause…' : 'Resume…'}</button>}
        </div>
      )}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {state && <StatePill state={state} testId="promo-drawer-state" />}
          <span className={`font-mono text-[11.5px] ${MUTED}`}>Stripe {id}</span>
        </div>
        {state === 'ended' && (
          <p className="m-0 rounded-lg bg-gray-50 p-2.5 text-[12.5px] dark:bg-gray-800/60" data-testid="promo-drawer-ended">
            Ended on {dayWord(p.ended_at) ?? 'a day not recorded'}{p.reason ? `: “${p.reason}”` : ''}{p.replaced_by ? ` Replaced by ${p.replaced_by}.` : ''} It can never be resumed or reused.
          </p>
        )}
        {state === 'paused' && p.paused_at && (
          <p className="m-0 rounded-lg bg-amber-50 p-2.5 text-[12.5px] text-amber-900 dark:bg-amber-950 dark:text-amber-100" data-testid="promo-drawer-paused">
            Paused {minuteWord(p.paused_at) ?? ''}{p.reason ? `: “${p.reason}”` : ''}.
          </p>
        )}
        {one.kind === 'missing' && <p className="m-0" role="alert" data-testid="promo-drawer-missing">No promo code has this address.</p>}
        {one.kind === 'failed' && !row && <ReadFailed what="This code" onRetry={reloadOne} testId="promo-drawer-failed" />}
        {p && (
          <>
            <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800" role="tablist">
              {[['overview', 'Overview'], ['redemptions', `Redemptions${count != null ? ` ${count}` : ''}`], ['history', 'History']].map(([k, w]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`promo-drawer-tab-${k}`}
                  className={`-mb-px border-b-2 px-3 py-1.5 text-[13px] font-semibold ${tab === k ? 'border-violet-600 text-violet-800 dark:border-violet-400 dark:text-violet-200' : `border-transparent ${MUTED}`}`}>{w}</button>
              ))}
            </div>
            {tab === 'overview' && <Overview p={p} names={names} choices={choices} red={red} />}
            {tab === 'redemptions' && <Redemptions red={red} onRetry={reloadRed} names={names} />}
            {tab === 'history' && <History his={his} onRetry={reloadHis} />}
          </>
        )}
      </div>
    </Sheet>
  );
}
