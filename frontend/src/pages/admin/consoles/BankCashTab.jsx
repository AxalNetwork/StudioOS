/**
 * D1186 (#3115) — Bank accounts › Cash (BNK3, BNK4, and BNK8–BNK10 for its
 * blocks): the four tiles, cash by entity over time, money in and out by
 * month, every balance with its time, and the door to Reconciliation.
 *
 * Each block reads alone and fails alone: a failed read is "could not be
 * read" with Try again (or, for a 503 audit refusal, "Nothing was read")
 * and the rest of the tab stays. Every read is a GET Mercury's store already
 * holds; nothing here moves money. The words and the shapes come from
 * `bankCashModel.js`; this file only draws them.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Unreadable } from '../../../ui';
import { formatCents } from '../../investor/fundCallsModel.js';
import { entityRows } from '../fundAdmin/mercuryEntityModel';
import { Accounts as EntityAccounts } from '../fundAdmin/BankingTabs';
import { Note, Panel, Tiles } from '../fundAdmin/parts';
import { useRead } from '../fundAdmin/useRead';
import { LoadingRows } from '../../account/AccountCenter';
import {
  CASH_WORDS, DEFAULT_RANGE, ENTITY_ORDER, ENTITY_SHORT, RANGES, axisMoney, cashTiles, dayText, entityCash, failedClaim,
  monthText, monthlyOf, runsOf, seriesOf, ticksOf,
} from './bankCashModel';

const RECONCILIATION = '/admin/fund-admin/banking/reconciliation';
const CHIP = 'inline-flex min-h-[28px] items-center rounded-full border px-2.5 text-[12px] font-semibold';
const CHIP_ON = `${CHIP} border-axal-violet bg-axal-lavender text-axal-violet-deep dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-200`;
const CHIP_OFF = `${CHIP} border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const MUTED = 'text-axal-muted dark:text-gray-400';
const LINK = 'text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300';
/** One colour per entity, each with its dark counterpart; drawn as `fill-current`/`stroke-current`. */
const ENTITY_TONE = {
  holdings: 'text-axal-violet dark:text-violet-400',
  management: 'text-teal-600 dark:text-teal-400',
  gp: 'text-amber-500 dark:text-amber-400',
  fund: 'text-sky-600 dark:text-sky-400',
};

function Failed({ read, what, claim }) {
  return <div className="px-4 py-3 sm:px-5"><Unreadable what={what} claim={failedClaim(read.error, claim)} onRetry={read.reload} /></div>;
}

function Chips({ options, value, onChange, label, testId }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5" data-testid={testId}>
      {options.map(([k, text]) => (
        <button key={k} type="button" aria-pressed={value === k} className={value === k ? CHIP_ON : CHIP_OFF} onClick={() => onChange(k)} data-testid={`${testId}-${k}`}>{text}</button>
      ))}
    </div>
  );
}

/** Every entity, with today's Current from the accounts read; one not in the chart has a hollow swatch. */
function Legend({ charted, figures }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[12px]" data-testid="bank-cash-legend">
      {ENTITY_ORDER.map((k) => (
        <li key={k} className="flex items-center gap-1.5" data-testid={`bank-cash-legend-${k}`} title={charted.includes(k) ? undefined : 'No stored daily balance in this range'}>
          <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-sm ${charted.includes(k) ? `bg-current ${ENTITY_TONE[k]}` : 'border border-dashed border-axal-muted dark:border-gray-500'}`} />
          <span className="font-semibold text-axal-ink dark:text-gray-100">{ENTITY_SHORT[k]}</span>
          {figures && <span className={`font-mono tabular-nums ${figures[k] == null ? MUTED : 'text-axal-ink dark:text-gray-100'}`}>{figures[k] == null ? 'Not recorded' : formatCents(figures[k])}</span>}
        </li>
      ))}
    </ul>
  );
}

const W = 960, H = 280, L = 64, R = 12, T = 16, B = 28;

/** Cash by entity: stacked areas; a gap is a hatched band marked "Not recorded", never a fall to 0. */
function SeriesChart({ s }) {
  const ticks = ticksOf(s.max);
  const top = ticks[ticks.length - 1] || 1;
  const n = s.days.length;
  const x = (i) => L + (n <= 1 ? 0 : (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const runs = runsOf(s.days);
  const every = Math.max(1, Math.ceil(n / 7));
  const label = `Cash by entity, ${dayText(s.days[0]?.date)} to ${dayText(s.days[n - 1]?.date)}. ${s.gaps ? `${s.gaps} day${s.gaps === 1 ? ' is' : 's are'} not recorded.` : 'Every day is recorded.'}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="block h-auto w-full" data-testid="bank-cash-series-svg">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="stroke-current text-axal-hairline dark:text-gray-800" />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" className={`fill-current ${MUTED}`}>{t ? axisMoney(t) : '0'}</text>
        </g>
      ))}
      {runs.filter((r) => !r.gap).map((r) => {
        const base = s.days.slice(r.start, r.end + 1).map(() => 0);
        return s.entities.map((k) => {
          const lower = base.slice();
          const upper = s.days.slice(r.start, r.end + 1).map((d, j) => { base[j] += d.byEntity[k]; return base[j]; });
          const idx = (j) => r.start + j;
          const pts = upper.map((v, j) => `${x(idx(j))},${y(v)}`);
          const back = lower.map((v, j) => `${x(idx(j))},${y(v)}`).reverse();
          const single = upper.length === 1;
          return single
            ? <line key={`${r.start}-${k}`} x1={x(r.start)} x2={x(r.start)} y1={y(lower[0])} y2={y(upper[0])} strokeWidth="3" className={`stroke-current ${ENTITY_TONE[k]}`} />
            : <path key={`${r.start}-${k}`} d={`M${pts.join(' L')} L${back.join(' L')} Z`} className={`fill-current ${ENTITY_TONE[k]}`} fillOpacity="0.55" data-testid="bank-cash-area" />;
        });
      })}
      {runs.filter((r) => r.gap).map((r) => {
        const x0 = r.start > 0 ? x(r.start - 1) : x(r.start), x1 = r.end < n - 1 ? x(r.end + 1) : x(r.end);
        return (
          <g key={`gap-${r.start}`} data-testid="bank-cash-gap">
            <title>Not recorded: {dayText(s.days[r.start].date)}{r.end > r.start ? ` to ${dayText(s.days[r.end].date)}` : ''}</title>
            <rect x={x0} y={T} width={Math.max(2, x1 - x0)} height={H - T - B} className={`fill-current ${MUTED}`} fillOpacity="0.08" />
            <line x1={x0} x2={x1} y1={T + 2} y2={T + 2} strokeDasharray="3 3" className={`stroke-current ${MUTED}`} />
            <text x={(x0 + x1) / 2} y={T + 14} textAnchor="middle" fontSize="10.5" className={`fill-current ${MUTED}`}>Not recorded</text>
          </g>
        );
      })}
      {s.days.map((d, i) => (i % every === 0 || i === n - 1) && (
        <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" className={`fill-current ${MUTED}`}>{dayText(d.date)}</text>
      ))}
    </svg>
  );
}

function SeriesTable({ s }) {
  return (
    <div className="max-h-[360px] overflow-auto" data-testid="bank-cash-series-table">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className={`text-left ${MUTED}`}>
            <th className="px-4 py-2 font-bold">Day</th>
            {s.entities.map((k) => <th key={k} className="px-3 py-2 text-right font-bold">{ENTITY_SHORT[k]}</th>)}
            <th className="px-4 py-2 text-right font-bold">Total</th>
          </tr>
        </thead>
        <tbody>
          {s.days.slice().reverse().map((d) => (
            <tr key={d.date} className="border-t border-axal-hairline dark:border-gray-800">
              <td className="px-4 py-1.5 font-mono">{dayText(d.date)}</td>
              {s.entities.map((k) => <td key={k} className={`px-3 py-1.5 text-right font-mono tabular-nums ${d.byEntity[k] == null ? MUTED : 'text-axal-ink dark:text-gray-100'}`}>{d.byEntity[k] == null ? 'Not recorded' : formatCents(d.byEntity[k])}</td>)}
              <td className={`px-4 py-1.5 text-right font-mono font-semibold tabular-nums ${d.total == null ? MUTED : 'text-axal-ink dark:text-gray-100'}`}>{d.total == null ? 'Not recorded' : formatCents(d.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const VIEWS = [['chart', 'Chart'], ['table', 'Table']];

function CashByEntity({ api, accounts }) {
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [view, setView] = useState('chart');
  const read = useRead(() => api.balances({ range }), [api, range]);
  const s = useMemo(() => (read.status === 'ready' ? seriesOf(read.data) : null), [read.status, read.data]);
  const figures = accounts.status === 'ready' ? Object.fromEntries(ENTITY_ORDER.map((k) => [k, entityCash(accounts.data?.items, k)])) : null;
  return (
    <Panel label="Cash by entity" testId="bank-cash-series"
      aside={<div className="flex flex-wrap gap-2"><Chips options={RANGES} value={range} onChange={setRange} label="Range" testId="bank-cash-range" /><Chips options={VIEWS} value={view} onChange={setView} label="Show as" testId="bank-cash-series-view" /></div>}>
      {read.status === 'loading' ? <div className="px-4 py-3 sm:px-5"><LoadingRows lines={4} /></div>
        : read.status === 'unreadable' ? <Failed read={read} what="The daily balances" claim="This is not a claim that the balances are zero." />
          : s.empty ? <Note testId="bank-cash-series-empty">{CASH_WORDS.seriesEmpty}</Note>
            : (
              <div className="flex flex-col gap-3 px-4 py-3 sm:px-5">
                <Legend charted={s.entities} figures={figures} />
                {view === 'chart' ? <SeriesChart s={s} /> : <SeriesTable s={s} />}
                <p className={`m-0 text-[11.5px] ${MUTED}`} data-testid="bank-cash-series-foot">
                  {CASH_WORDS.seriesFoot}
                  {s.gaps > 0 && ` ${s.gaps} day${s.gaps === 1 ? ' is' : 's are'} not recorded in this range.`}
                  {s.missing.length > 0 && ` No stored balance in this range: ${s.missing.map((k) => ENTITY_SHORT[k]).join(', ')}.`}
                  {' '}The figures beside each entity are today’s Current, from the Balances table below.
                </p>
              </div>
            )}
    </Panel>
  );
}

const MH = 260, MT = 18, MB = 30;

/** In above the axis, out below; this month hatched as to date; a month with no posted line says so. */
function MonthlyChart({ m }) {
  const ticks = ticksOf(m.max);
  const top = ticks[ticks.length - 1] || 1;
  const mid = MT + (MH - MT - MB) / 2;
  const half = (MH - MT - MB) / 2;
  const step = (W - L - R) / Math.max(1, m.months.length);
  const bw = step * 0.32;
  const sc = (v) => (v / top) * half;
  return (
    <svg viewBox={`0 0 ${W} ${MH}`} role="img" aria-label={`Money in and out by month, ${monthText(m.months[0]?.month, true)} to ${monthText(m.months[m.months.length - 1]?.month, true)}.`} className="block h-auto w-full" data-testid="bank-cash-monthly-svg">
      <defs>
        <pattern id="bank-month-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" strokeWidth="2.2" className="stroke-current text-white dark:text-gray-900" />
        </pattern>
      </defs>
      {[-top, -top / 2, 0, top / 2, top].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={mid - sc(v)} y2={mid - sc(v)} className={`stroke-current ${v ? 'text-axal-hairline dark:text-gray-800' : MUTED}`} />
          <text x={L - 8} y={mid - sc(v) + 4} textAnchor="end" fontSize="11" className={`fill-current ${MUTED}`}>{v ? axisMoney(v) : '0'}</text>
        </g>
      ))}
      <text x={L + 4} y={MT + 10} fontSize="10.5" className={`fill-current ${MUTED}`}>In</text>
      <text x={L + 4} y={MH - MB - 4} fontSize="10.5" className={`fill-current ${MUTED}`}>Out</text>
      {m.months.map((p, i) => {
        const cx = L + step * i + step / 2;
        if (p.in_cents == null) {
          return (
            <g key={p.month} data-testid="bank-cash-month-nr">
              <text x={cx} y={mid - 6} textAnchor="middle" fontSize="10.5" className={`fill-current ${MUTED}`}>Not recorded</text>
              <text x={cx} y={MH - 8} textAnchor="middle" fontSize="11" className="fill-current text-axal-ink dark:text-gray-100">{monthText(p.month)}</text>
            </g>
          );
        }
        return (
          <g key={p.month} data-testid="bank-cash-month">
            <rect x={cx - bw - 2} y={mid - sc(p.in_cents)} width={bw} height={Math.max(0.5, sc(p.in_cents))} rx="2" className="fill-current text-axal-positive dark:text-emerald-400" />
            <rect x={cx + 2} y={mid} width={bw} height={Math.max(0.5, sc(p.out_cents))} rx="2" className="fill-current text-axal-destructive dark:text-red-400" />
            {p.to_date && <rect x={cx - bw - 2} y={mid - sc(p.in_cents)} width={bw * 2 + 4} height={Math.max(0.5, sc(p.in_cents) + sc(p.out_cents))} fill="url(#bank-month-hatch)" fillOpacity="0.6" />}
            <title>{`${monthText(p.month, true)}${p.to_date ? ', to date' : ''}: in ${formatCents(p.in_cents)}, out ${formatCents(p.out_cents)}${p.without.length ? `. Not recorded for ${p.without.map((k) => ENTITY_SHORT[k]).join(', ')}` : ''}`}</title>
            <text x={cx} y={MH - 8} textAnchor="middle" fontSize="11" className="fill-current text-axal-ink dark:text-gray-100">{monthText(p.month)}{p.to_date ? ' · to date' : ''}</text>
          </g>
        );
      })}
    </svg>
  );
}

function MonthlyTable({ m }) {
  return (
    <table className="w-full border-collapse text-[12px]" data-testid="bank-cash-monthly-table">
      <thead><tr className={`text-left ${MUTED}`}><th className="px-4 py-2 font-bold">Month</th><th className="px-3 py-2 text-right font-bold">In</th><th className="px-3 py-2 text-right font-bold">Out</th><th className="px-4 py-2 font-bold">Note</th></tr></thead>
      <tbody>
        {m.months.slice().reverse().map((p) => (
          <tr key={p.month} className="border-t border-axal-hairline dark:border-gray-800">
            <td className="px-4 py-1.5 font-mono">{monthText(p.month, true)}{p.to_date ? ' · to date' : ''}</td>
            <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${p.in_cents == null ? MUTED : ''}`}>{p.in_cents == null ? 'Not recorded' : formatCents(p.in_cents)}</td>
            <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${p.out_cents == null ? MUTED : ''}`}>{p.out_cents == null ? 'Not recorded' : formatCents(p.out_cents)}</td>
            <td className={`px-4 py-1.5 ${MUTED}`}>{p.in_cents == null ? 'No posted line recorded' : p.without.length ? `Not recorded for ${p.without.map((k) => ENTITY_SHORT[k]).join(', ')}` : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const MONTH_ENTITIES = [['all', 'All'], ...ENTITY_ORDER.map((k) => [k, ENTITY_SHORT[k]])];

function MoneyInOut({ api }) {
  const [entity, setEntity] = useState('all');
  const [view, setView] = useState('chart');
  // One read of every entity; the chips filter it here, so changing them reads nothing again.
  const read = useRead(() => api.monthly(), [api]);
  const m = useMemo(() => (read.status === 'ready' ? monthlyOf(read.data, entity) : null), [read.status, read.data, entity]);
  return (
    <Panel label="Money in and out by month" testId="bank-cash-monthly"
      aside={<div className="flex flex-wrap gap-2"><Chips options={MONTH_ENTITIES} value={entity} onChange={setEntity} label="Entity" testId="bank-cash-monthly-entity" /><Chips options={VIEWS} value={view} onChange={setView} label="Show as" testId="bank-cash-monthly-view" /></div>}>
      {read.status === 'loading' ? <div className="px-4 py-3 sm:px-5"><LoadingRows lines={4} /></div>
        : read.status === 'unreadable' ? <Failed read={read} what="Money in and out" claim="This is not a claim that no money moved." />
          : (
            <div className="flex flex-col gap-3 px-4 py-3 sm:px-5">
              {m.empty ? <Note testId="bank-cash-monthly-empty">{CASH_WORDS.monthlyEmpty}</Note>
                : view === 'chart' ? <MonthlyChart m={m} /> : <MonthlyTable m={m} />}
              <p className={`m-0 text-[11.5px] ${MUTED}`}>{CASH_WORDS.monthlyFoot} This month is to date and hatched.</p>
            </div>
          )}
    </Panel>
  );
}

/** Unmatched receipts: the connections, then each connected entity's credit total. */
function useUnmatched(api) {
  const [state, setState] = useState({ status: 'loading', byEntity: {} });
  const load = useCallback(async () => {
    setState({ status: 'loading', byEntity: {} });
    let rows;
    try { rows = entityRows(await api.connections()); } catch { setState({ status: 'unreadable', byEntity: {} }); return; }
    const byEntity = Object.fromEntries(rows.map((r) => [r.key, { status: r.connected ? 'loading' : 'unconnected' }]));
    setState({ status: 'ready', byEntity });
    await Promise.all(rows.filter((r) => r.connected).map(async (r) => {
      let one;
      try { const page = await api.transactions({ entity: r.key, match: 'none', direction: 'credit' }); one = { status: 'ready', total: Number(page?.total) }; }
      catch { one = { status: 'unreadable' }; }
      setState((s) => ({ ...s, byEntity: { ...s.byEntity, [r.key]: one } }));
    }));
  }, [api]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

export default function BankCashTab({ api }) {
  const apis = useMemo(() => ({ mercury: api }), [api]);
  const accounts = useRead(() => api.accounts(), [api]);
  const unmatched = useUnmatched(api);
  const tiles = cashTiles(accounts, unmatched).map((t) => ({
    k: t.k, v: t.value, tone: t.missing ? 'warn' : null, testId: `bank-cash-tile-${t.k.toLowerCase().replace(/[^a-z]+/g, '-')}`,
    note: t.note || (t.loading ? 'Reading…' : null),
  }));
  const retryTiles = accounts.status === 'unreadable' || unmatched.status === 'unreadable';
  return (
    <div className="flex flex-col gap-4" data-testid="bank-cash">
      <Tiles items={tiles} testId="bank-cash-tiles" />
      {retryTiles && (
        <div className="flex flex-wrap gap-3 text-[12px]" data-testid="bank-cash-tiles-failed">
          {accounts.status === 'unreadable' && <Unreadable what="The entity accounts" claim={failedClaim(accounts.error, 'This is not a claim that there is none.')} onRetry={accounts.reload} />}
          {unmatched.status === 'unreadable' && <Unreadable what="The Mercury connections" claim="This is not a claim that none is connected." onRetry={unmatched.reload} />}
        </div>
      )}
      <CashByEntity api={api} accounts={accounts} />
      <MoneyInOut api={api} />
      <EntityAccounts apis={apis} read={accounts} label="Balances" />
      <p className={`-mt-2 m-0 text-[11.5px] ${MUTED}`}>{CASH_WORDS.balancesFoot}</p>
      <Panel label="Reconcile receipts" testId="bank-cash-reconcile">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <p className={`m-0 text-[12.5px] ${MUTED}`}>{CASH_WORDS.reconcile}</p>
          <Link className={LINK} to={RECONCILIATION}>Open Reconciliation →</Link>
        </div>
      </Panel>
      <p className={`m-0 text-[11.5px] ${MUTED}`} data-testid="bank-cash-foot">{CASH_WORDS.foot}</p>
    </div>
  );
}
