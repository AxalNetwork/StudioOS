import { useMemo, useState } from 'react';
import { Lightbox, Unrecorded, Unreadable } from '../../../ui';
import { PairBars, QuarterLines, ChartTable } from '../../../ui/Charts';
import { FundActControl } from '../../../lib/fundActs';
import { BTN, INPUT, LoadingRows } from '../../account/AccountCenter';
import { reportError } from '../../../lib/log';
import { refusalText } from './fundAdminModel';
import { Note, NUM, Panel, Section, TH, Table, Tiles } from './parts';
import { useRead } from './useRead';
import {
  MARK_INFO, MOVE_INFO, NAV_LINE, NOT_RECORDED, PICK_FUND, SOURCE_MAX,
  checkMark, moveOptions, multiple, navTiles, positionRows, positionsChart, quarterCharts, shortMoney, sideBySide,
} from './performanceModel';

/**
 * D1164 (#3071, part 7 of #2388) — NAV & performance at
 * `/admin/fund-admin/performance` (FND10, dark FND11, dialogs FND12).
 *
 * FOR ONE FUND (`?fund=`): the NAV line, the seven tiles, the two quarterly
 * charts, the positions chart and the positions table with Record a mark and
 * Move to another fund. FOR ALL FUNDS: "Funds side by side". Each block reads
 * alone: one that failed says so with Retry, and the rest answer.
 *
 * Both acts are `fund.valuation` in `FUND_ACTS` (D1159), drawn through
 * `FundActControl`, so a viewer the act table refuses reads its sentence.
 * Each opens an in-page dialog; nothing writes without one.
 */

const today = () => new Date().toISOString().slice(0, 10);

/** A figure, or Not recorded with the Worker's reason on hover. */
function Fig({ f }) {
  return f.text == null ? <Unrecorded reason={f.reason} /> : f.text;
}

/** A chart with "View as table" (every chart has one), its alt sentence on a `role="img"` wrapper. */
function ChartPanel({ title, note, legend, foot, alt, table, testId, children }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Panel label={title} testId={testId}
      aside={<button type="button" className={BTN.link} onClick={() => setAsTable((v) => !v)} data-testid={`${testId}-toggle`}>{asTable ? 'View as chart' : 'View as table'}</button>}>
      <div className="flex flex-col gap-2 px-4 py-3 sm:px-5">
        {note && <p className="m-0 text-[12.5px] text-zinc-700 dark:text-gray-200">{note}</p>}
        {legend && !asTable && <div className="flex flex-wrap gap-3 text-[11px] text-axal-muted dark:text-gray-400">{legend}</div>}
        {asTable
          ? <div data-testid={`${testId}-table`}><ChartTable chart={{ table }} caption={title} /></div>
          : <div role="img" aria-label={alt}>{children}</div>}
        {foot && <p className="m-0 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid={`${testId}-foot`}>{foot}</p>}
      </div>
    </Panel>
  );
}

const SW = { violet: 'bg-axal-violet dark:bg-violet-400', sky: 'bg-[#0ea5e9]', amber: 'bg-[#f59e0b]' };
const Key = ({ tone, label }) => <span className="inline-flex items-center gap-1.5"><span className={`inline-block h-2 w-2 rounded-full ${SW[tone]}`} />{label}</span>;
const GapKey = () => <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 border-t-[1.5px] border-dashed border-axal-muted" />No complete NAV</span>;

export function PerformanceTab({ apis, access, funds, fundId, onChanged }) {
  const list = useRead(() => apis.performance.list(), [apis]);
  const one = fundId != null;
  const history = useRead(() => apis.performance.history(fundId), [apis, fundId], { enabled: one });
  const positions = useRead(() => apis.performance.positions(fundId), [apis, fundId], { enabled: one });
  const [dialog, setDialog] = useState(null);
  const fund = (funds || []).find((f) => String(f.id) === String(fundId)) || null;
  const perf = list.status === 'ready' ? (list.data?.items || []).find((f) => String(f.id) === String(fundId)) || null : null;
  const reloadAll = () => { list.reload(); if (one) { history.reload(); positions.reload(); } onChanged?.(); };

  return (
    <div data-testid="fund-admin-performance">
      <Section title={one && fund ? `NAV & performance · ${fund.name}` : 'NAV & performance'} sub={NAV_LINE} testId="fund-performance-head">
        {one && <FundBlocks list={list} perf={perf} history={history} positions={positions} access={access} onMark={(p) => setDialog({ kind: 'mark', position: p })} onMove={(p) => setDialog({ kind: 'move', position: p })} />}
        {!one && <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="fund-performance-pick">{PICK_FUND}</p>}
        <SideBySide list={list} />
      </Section>
      {dialog?.kind === 'mark' && <MarkDialog apis={apis} position={dialog.position} fund={fund} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reloadAll(); }} />}
      {dialog?.kind === 'move' && <MoveDialog apis={apis} position={dialog.position} funds={funds} fundId={fundId} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reloadAll(); }} />}
    </div>
  );
}

function FundBlocks({ list, perf, history, positions, access, onMark, onMove }) {
  const tiles = useMemo(() => navTiles(perf, {
    positions: positions.status === 'ready' ? positions.data : null,
    history: history.status === 'ready' ? history.data : null,
  }), [perf, positions, history]);
  const charts = useMemo(() => (history.status === 'ready' ? quarterCharts(history.data) : null), [history]);
  const posChart = useMemo(() => (positions.status === 'ready' ? positionsChart(positions.data) : null), [positions]);
  return (
    <>
      {list.status === 'loading' && <LoadingRows lines={2} />}
      {list.status === 'unreadable' && <Unreadable what="Fund performance" claim="This is not a claim that the fund has no NAV." onRetry={list.reload} />}
      {list.status === 'ready' && (
        <Tiles testId="fund-performance-tiles"
          items={tiles.map((t) => ({ k: t.label, testId: `fund-performance-tile-${t.key}`, v: t.text == null ? <Unrecorded reason={t.reason} /> : t.text, note: t.text == null ? t.reason : t.note }))} />
      )}

      {history.status === 'loading' && <LoadingRows lines={3} />}
      {history.status === 'unreadable' && <Unreadable what="The quarterly history" claim="This is not a claim that the fund has no quarters." onRetry={history.reload} />}
      {charts && charts.empty && <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="fund-performance-no-quarters">{charts.reason}</p>}
      {charts && !charts.empty && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartPanel title="Paid-in, distributed and NAV by quarter" testId="fund-chart-money" note={charts.money.note} foot={charts.money.foot}
            alt={charts.money.alt} table={charts.money.table}
            legend={<><Key tone="violet" label="Paid-in" /><Key tone="sky" label="Distributed" /><Key tone="amber" label="NAV" />{charts.gaps.length > 0 && <GapKey />}</>}>
            <QuarterLines series={charts.money.series} labels={charts.labels} format={shortMoney} />
          </ChartPanel>
          <ChartPanel title="TVPI and DPI by quarter" testId="fund-chart-multiples" note={charts.multiples.note} foot={charts.multiples.foot}
            alt={charts.multiples.alt} table={charts.multiples.table}
            legend={<><Key tone="violet" label="TVPI" /><Key tone="sky" label="DPI" />{charts.gaps.length > 0 && <GapKey />}</>}>
            <QuarterLines series={charts.multiples.series} labels={charts.labels} format={(v) => multiple(v)} />
          </ChartPanel>
        </div>
      )}
      {charts?.truncated && <p className="m-0 text-[11.5px] text-axal-muted dark:text-gray-400">Only the latest quarters are drawn.</p>}

      {positions.status === 'loading' && <LoadingRows lines={3} />}
      {positions.status === 'unreadable' && <Unreadable what="The positions" claim="This is not a claim that the fund holds none." onRetry={positions.reload} />}
      {posChart && posChart.empty && <Panel label="Positions" testId="fund-positions-empty"><Note>No position is attributed to this fund yet.</Note></Panel>}
      {posChart && !posChart.empty && (
        <>
          <ChartPanel title="Positions: cost and latest mark" testId="fund-chart-positions" note={posChart.note} alt={posChart.alt} table={posChart.table}
            legend={<><Key tone="sky" label="Cost" /><Key tone="violet" label="Latest mark" /><span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-3.5 rounded-[3px] border border-dashed border-axal-muted" />No mark</span></>}>
            <PairBars rows={posChart.rows} />
          </ChartPanel>
          <PositionsTable positions={positions.data} access={access} onMark={onMark} onMove={onMove} />
        </>
      )}
    </>
  );
}

function PositionsTable({ positions, access, onMark, onMove }) {
  const [q, setQ] = useState('');
  const rows = positionRows(positions, { q });
  const cols = [
    { key: 'company', label: 'Company', cell: (r) => r.company },
    { key: 'round', label: 'Round', cell: (r) => r.round },
    { key: 'cost', label: 'Cost', align: 'right', mono: true, cell: (r) => r.cost },
    { key: 'mark', label: 'Latest mark', align: 'right', mono: true, cell: (r) => (r.mark == null ? <Unrecorded reason={r.markReason}>No mark</Unrecorded> : r.mark) },
    { key: 'date', label: 'Mark date', mono: true, cell: (r) => r.date ?? '—' },
    { key: 'source', label: 'Source', cell: (r) => r.source ?? '—' },
    { key: 'by', label: 'Recorded by', cell: (r) => r.recordedBy ?? '—' },
    { key: 'acts', label: '', align: 'right', cell: (r) => (
      <FundActControl access={access} act="fund.valuation" testId={`fund-position-refused-${r.id}`} className="text-[11px] text-axal-muted dark:text-gray-400">
        <span className="inline-flex flex-wrap justify-end gap-2">
          <button type="button" className={BTN.link} onClick={() => onMark(r.raw)} data-testid={`fund-position-mark-${r.id}`}>Record a mark</button>
          <button type="button" className={BTN.link} onClick={() => onMove(r.raw)} data-testid={`fund-position-move-${r.id}`}>Move to another fund</button>
        </span>
      </FundActControl>
    ) },
  ];
  return (
    <Panel label="Positions" sub={`${rows.length} of ${positions?.items?.length ?? 0}`} testId="fund-positions"
      aside={<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies" aria-label="Search companies" className={`${INPUT} max-w-[220px]`} data-testid="fund-positions-search" />}>
      {rows.length === 0 ? <Note>No position matches. Clear the search.</Note>
        : <Table cols={cols} rows={rows} rowKey={(r) => r.id} template="1fr .8fr .9fr .95fr .85fr 1.5fr 1fr 1.3fr" wide rowTestId={(r) => `fund-position-${r.id}`} />}
      <Note>Cost is the amount invested. A position with no mark has only its cost, and cost is never shown as its value.</Note>
    </Panel>
  );
}

function SideBySide({ list }) {
  if (list.status !== 'ready') return null;
  const rows = sideBySide(list.data);
  if (!rows.length) return null;
  const head = ['NAV', 'Paid-in', 'Distributed', 'DPI', 'RVPI', 'TVPI', 'IRR'];
  const cols = [
    { key: 'fund', label: 'Fund', cell: (r) => r.name },
    ...head.map((h, i) => ({ key: h, label: h, align: 'right', mono: true, cell: (r) => <Fig f={r.cells[i][1]} /> })),
  ];
  return (
    <Panel label="All funds · side by side" testId="fund-side-by-side">
      <Table cols={cols} rows={rows} rowKey={(r) => r.id} template="1.3fr 1.1fr 1.1fr 1fr .7fr .7fr .7fr .7fr" wide rowTestId={(r) => `fund-side-${r.id}`} />
      <Note>Hover a Not recorded cell for its reason.</Note>
    </Panel>
  );
}

const LABEL = `block ${TH}`;

/** FND12: Record a mark — a dated value for one position, checked before the call. */
function MarkDialog({ apis, position, fund, onClose, onDone }) {
  const [form, setForm] = useState({ date: today(), value: '', source: '' });
  const [errors, setErrors] = useState({});
  const [failed, setFailed] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e?.preventDefault?.();
    const c = checkMark(form, today());
    setErrors(c.ok ? {} : c.errors);
    if (!c.ok) return;
    setBusy(true); setFailed(null);
    try { await apis.performance.recordValuation(position.id, c.body); onDone(); } catch (err) {
      reportError('fund-admin:record-mark', err);
      setFailed(refusalText(err, 'The mark could not be recorded. Nothing was saved.'));
    } finally { setBusy(false); }
  };
  const name = position.company_name || position.round_name || `Position ${position.id}`;
  return (
    <Lightbox label="Record a mark" title="Record a mark" sub="A dated value for one position." width={520} onClose={onClose} testId="fund-mark-dialog"
      footer={<div className="flex justify-end gap-2"><button type="button" className={BTN.ghost} onClick={onClose}>Cancel</button>
        <button type="button" className={BTN.primary} onClick={save} disabled={busy} data-testid="fund-mark-save">Record mark</button></div>}>
      <form onSubmit={save} className="flex flex-col gap-3 px-5 py-4" noValidate>
        <p className="m-0 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{name} · {position.round_name || NOT_RECORDED}{fund ? ` · ${fund.name}` : ''}</p>
        <label className="flex flex-col gap-1"><span className={LABEL}>Valuation date · not in the future</span>
          <input type="date" max={today()} className={`${INPUT} ${NUM}`} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="fund-mark-date" />
          {errors.date && <span role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid="fund-mark-error-date">{errors.date}</span>}
        </label>
        <label className="flex flex-col gap-1"><span className={LABEL}>Value ($)</span>
          <input inputMode="decimal" className={`${INPUT} ${NUM}`} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="150000.00" data-testid="fund-mark-value" />
          {errors.value && <span role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid="fund-mark-error-value">{errors.value}</span>}
        </label>
        <label className="flex flex-col gap-1"><span className={LABEL}>Source · required · up to {SOURCE_MAX} characters</span>
          <textarea rows={3} maxLength={SOURCE_MAX + 50} className={INPUT} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} data-testid="fund-mark-source" />
          {errors.source && <span role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid="fund-mark-error-source">{errors.source}</span>}
        </label>
        <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">{MARK_INFO}</p>
        {failed && <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="fund-mark-failed">{failed}</p>}
      </form>
    </Lightbox>
  );
}

/** FND12: Move to another fund — which fund's NAV the position counts in. */
function MoveDialog({ apis, position, funds, fundId, onClose, onDone }) {
  const options = moveOptions(funds, fundId);
  const [pick, setPick] = useState(options.find((o) => o.current)?.key || options[0]?.key);
  const [failed, setFailed] = useState(null);
  const [busy, setBusy] = useState(false);
  const chosen = options.find((o) => o.key === pick);
  const move = async () => {
    if (!chosen || chosen.current) return;
    setBusy(true); setFailed(null);
    try { await apis.performance.attribute(position.id, chosen.id); onDone(); } catch (err) {
      reportError('fund-admin:move-position', err);
      setFailed(refusalText(err, 'The position could not be moved. Nothing changed.'));
    } finally { setBusy(false); }
  };
  const name = position.company_name || position.round_name || `Position ${position.id}`;
  const now = options.find((o) => o.current);
  return (
    <Lightbox label="Move to another fund" title="Move to another fund" sub={`${name} · ${position.round_name || NOT_RECORDED} · now in ${now?.label || 'its fund'}`} width={480} onClose={onClose} testId="fund-move-dialog"
      footer={<div className="flex justify-end gap-2"><button type="button" className={BTN.ghost} onClick={onClose}>Cancel</button>
        <button type="button" className={BTN.primary} onClick={move} disabled={busy || !chosen || chosen.current} data-testid="fund-move-save">Move</button></div>}>
      <div className="flex flex-col gap-2 px-5 py-4">
        <div role="radiogroup" aria-label="Fund" className="flex flex-col gap-1.5" data-testid="fund-move-options">
          {options.map((o) => (
            <label key={o.key} className="flex min-h-[40px] items-center gap-2.5 rounded-axal-sm border border-axal-hairline px-3 text-[13px] text-axal-ink dark:border-gray-700 dark:text-gray-100">
              <input type="radio" name="fund-move" checked={pick === o.key} onChange={() => setPick(o.key)} data-testid={`fund-move-${o.key}`} />
              <span className="flex-1">{o.label}</span>
              {o.current && <span className="text-[11px] text-axal-muted dark:text-gray-400">Where it counts now</span>}
            </label>
          ))}
        </div>
        <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">{MOVE_INFO}</p>
        {failed && <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="fund-move-failed">{failed}</p>}
      </div>
    </Lightbox>
  );
}
