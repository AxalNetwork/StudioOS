import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api as legacyApi } from '../../../lib/api';
import { useOfFundsApi } from '../../../lib/api/useOfFunds';
import { Lightbox } from '../../../ui';
import { NOT_RECORDED, SECTIONS, TABS, money, sourceText, tabHref } from './useOfFundsModel';
import {
  BTN, BTN_GHOST, BlockError, Card, CashLine, ChartToggle, Columns, EYEBROW, FIELD, H3, LINK, MONO, MUTED, NotRecorded, Pill, SECTION_BG,
  Skeleton, Source, useRead,
} from './UseOfFundsParts';
import {
  DRIVERS, MAX_COMPARE, cashPaths, cashSentence, changedDrivers, compareHref, compareIds, compareTable, driverError, driverRows, driversBody,
  forecastGap, forecastSeries, forecastTiles, fundedBySection, makeBaseView, movedNotice, movedTo, scenarioBody, scenarioCard, sensitivityRows,
} from './scenariosForecastModel';

/**
 * D1178 (#3105) — Use of funds part 5: Runway › Forecast (UF8), Scenarios
 * (UF9) and Scenarios compared (UF10, UF11), and the redirect that lands the
 * old financial model's addresses on Forecast.
 *
 * READS. Forecast: the financial model's store (`useOfFundsApi.forecast`).
 * Scenarios: D1176's `GET /scenarios`. Compare: `GET /compare?ids=`.
 * WRITES. Each in an in-page dialog that says what it changes: Edit drivers
 * (`PUT /api/financials/:id`), New scenario, Edit, Delete and Make this the
 * base (D1176's scenario routes). Eadwyn fills nothing here, and never a
 * driver (#2455 owner question 5). Every forecast figure is Modelled and is
 * never runway today.
 */

const CHART_FILL = ['bg-violet-600 dark:bg-violet-400', 'bg-sky-500 dark:bg-sky-400', 'bg-amber-500 dark:bg-amber-400', 'bg-emerald-500 dark:bg-emerald-400'];
const LINE_STROKE = ['stroke-violet-600 dark:stroke-violet-400', 'stroke-sky-500 dark:stroke-sky-400', 'stroke-amber-500 dark:stroke-amber-400', 'stroke-emerald-500 dark:stroke-emerald-400'];
const DOT_FILL = ['bg-violet-600 dark:bg-violet-400', 'bg-sky-500 dark:bg-sky-400', 'bg-amber-500 dark:bg-amber-400', 'bg-emerald-500 dark:bg-emerald-400'];

/** The old financial model's addresses: Runway › Forecast, with the venture and the moved notice. */
export function UseOfFundsMovedRedirect() {
  const loc = useLocation();
  return <Navigate replace to={{ ...movedTo(loc.search), hash: loc.hash }} />;
}

/** The notice an old address shows once it lands (UF8). */
export function ForecastMovedNotice({ search }) {
  const [gone, setGone] = useState(false);
  const words = movedNotice(search);
  if (!words || gone) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-axal-lavender px-3 py-2 text-[12.5px] font-semibold text-axal-ink dark:border-violet-900 dark:bg-violet-950/40 dark:text-gray-100" role="status" data-testid="uof-moved">
      <span className="flex-1">{words}</span>
      <button type="button" className={BTN_GHOST} onClick={() => setGone(true)} data-testid="uof-moved-dismiss">Dismiss</button>
    </div>
  );
}

function Dialog({ label, title, sub, onClose, children, busy, error, go, goLabel, disabled, testId }) {
  return (
    <Lightbox label={label} title={title} sub={sub} onClose={onClose} testId={testId} width={560} phone="sheet"
      footer={(
        <div className="flex flex-col gap-2">
          {error ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid={`${testId}-error`}>{error}</p> : null}
          <div className="flex justify-end gap-2 max-md:[&>*]:flex-1">
            <button type="button" className={BTN_GHOST} onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className={BTN} onClick={go} disabled={busy || disabled} data-testid={`${testId}-go`}>{busy ? 'Saving…' : goLabel}</button>
          </div>
        </div>
      )}>
      {children}
    </Lightbox>
  );
}

/** Run a write: close on success, keep the dialog open with the Worker's sentence on failure. */
function useWrite(onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn) => {
    setBusy(true); setError('');
    try { const out = await fn(); setBusy(false); onDone?.(out); } catch (e) { setBusy(false); setError(e?.message || 'It was not saved. Read the plan again before retrying.'); }
  };
  return { busy, error, run };
}

/* ------------------------------------------------------------------ *
 * Runway › Forecast (UF8)
 * ------------------------------------------------------------------ */

/** Edit drivers: the ten drivers; Save re-runs the forecast. The dialog names what changes. */
export function DriversDialog({ projectId, read, onClose, onSaved, api = useOfFundsApi }) {
  const a = read?.assumptions || {};
  const [values, setValues] = useState(Object.fromEntries(DRIVERS.map((d) => [d.key, a[d.key] == null ? '' : String(a[d.key])])));
  const w = useWrite(onSaved);
  const out = driversBody(values);
  const changed = changedDrivers(read, values);
  return (
    <Dialog label="Edit drivers" title="Edit the forecast’s drivers" testId="uof-drivers-dialog" onClose={onClose} busy={w.busy} error={w.error}
      sub={changed.length ? `Saving changes ${changed.join(', ').toLowerCase()} and re-runs the forecast. Each changed driver becomes Typed.` : 'Nothing has changed yet.'}
      goLabel="Save forecast" disabled={!!out.errors || !changed.length} go={() => w.run(() => api.saveForecast(projectId, out.assumptions))}>
      <div className="grid gap-3 sm:grid-cols-2">
        {DRIVERS.map((d) => {
          const e = driverError(d.kind, values[d.key]);
          return (
            <label key={d.key} className="flex flex-col gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200">
              {d.label}{d.kind === 'pct' ? ' (%)' : d.kind === 'money' ? ' (US dollars)' : ''}
              <input className={`${FIELD} ${MONO}`} inputMode="decimal" value={values[d.key]} onChange={(ev) => setValues((x) => ({ ...x, [d.key]: ev.target.value }))} data-testid={`uof-driver-${d.key}`} aria-invalid={!!e} />
              {e ? <span className="text-[11.5px] font-normal text-red-700 dark:text-red-300">{e}</span> : null}
            </label>
          );
        })}
      </div>
      <p className={`m-0 mt-3 text-[12px] ${MUTED}`}>The forecast is a model you set. It is never your runway today. Eadwyn never fills a driver.</p>
    </Dialog>
  );
}

function Tiles({ tiles }) {
  return (
    <div className="grid gap-3 max-md:grid-cols-2 md:grid-cols-4" data-testid="uof-forecast-tiles">
      {tiles.map((t) => (
        <div key={t.key} className="flex min-w-0 flex-col gap-1 rounded-xl border border-axal-hairline bg-white px-3 py-3 dark:border-gray-800 dark:bg-gray-900" data-testid={`uof-forecast-tile-${t.key}`}>
          <span className={EYEBROW}>{t.label}</span>
          {t.value ? <span className={`${MONO} text-[22px] font-extrabold text-axal-ink max-md:text-[18px] dark:text-gray-100`}>{t.value}</span> : <span className={`text-[15px] ${MUTED}`}>{NOT_RECORDED}</span>}
          <span className={`text-[11.5px] ${MUTED}`}>{t.sub}</span>
        </div>
      ))}
    </div>
  );
}

function SeriesTable({ rows, testId }) {
  return (
    <div className="max-h-64 overflow-auto">
      <table className="w-full border-collapse text-left text-[12px]" data-testid={testId}>
        <thead><tr>{rows.head.map((h) => <th key={h} className={`px-2 py-1 ${EYEBROW}`}>{h}</th>)}</tr></thead>
        <tbody>{rows.body.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i} className={`px-2 py-1 ${MONO}`}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function Forecast({ projectId, search = '', api = useOfFundsApi }) {
  const read = useRead(() => api.forecast(projectId), projectId ? `forecast:${projectId}` : null);
  const [dialog, setDialog] = useState(false);
  const [view, setView] = useState({ cash: 'chart', rev: 'chart' });
  const [exportError, setExportError] = useState('');
  const runway = TABS.find((t) => t.id === 'runway');
  const d = read.data;
  const gap = d ? forecastGap(d) : null;
  const series = d ? forecastSeries(d) : null;
  const sens = d ? sensitivityRows(d) : null;
  const exportIt = async () => {
    setExportError('');
    try { await legacyApi.downloadFinancialModelXlsx(projectId); } catch (e) { setExportError(e?.message || 'The export could not be made. Save the forecast first.'); }
  };
  return (
    <div className="flex flex-col gap-3" data-testid="uof-forecast">
      <ForecastMovedNotice search={search} />
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className={EYEBROW}>Runway › Forecast</span>
          <h2 className="m-0 text-[18px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Forecast</h2>
          <p className={`m-0 text-[12.5px] ${MUTED}`}>A model you set from ten drivers. It is not your runway today.</p>
        </div>
        <Link className={BTN_GHOST} to={tabHref(runway, search)} data-testid="uof-forecast-back">‹ Runway</Link>
      </div>
      {read.status === 'loading' && !d ? <Skeleton lines={4} testId="uof-forecast-loading" /> : null}
      {read.status === 'unreadable' ? <BlockError text="The forecast could not be read. This is not a zero." onRetry={read.reload} testId="uof-forecast-unreadable" /> : null}
      {d ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <Card title="Drivers" meta="Each driver names its source. An empty one stops the forecast." testId="uof-drivers">
            <ul className="m-0 flex list-none flex-col p-0">
              {driverRows(d).map((r) => (
                <li key={r.key} className="flex flex-wrap items-center justify-between gap-1.5 border-t border-axal-hairline py-2 first:border-0 dark:border-gray-800" data-testid={`uof-driver-row-${r.key}`}>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{r.label}</span>
                    {r.source ? <Source source={r.source} detail={r.detail} /> : <span className={`text-[11px] ${MUTED}`}>{r.detail}</span>}
                  </span>
                  {r.value ? <span className={`${MONO} text-[12.5px] font-bold text-axal-ink dark:text-gray-100`}>{r.value}</span> : <NotRecorded reason={r.key === 'starting_cash' ? 'Add starting cash to run the forecast.' : 'An empty driver stops the forecast.'} />}
                </li>
              ))}
            </ul>
            <button type="button" className={`${BTN} w-fit`} onClick={() => setDialog(true)} data-testid="uof-drivers-edit">Edit drivers</button>
          </Card>
          <div className="flex min-w-0 flex-col gap-3 lg:col-span-2">
            <Tiles tiles={forecastTiles(d)} />
            <Card title="Cash trajectory" testId="uof-forecast-cash" meta={<span className="flex items-center gap-2"><Source source="Modelled" />{series ? <ChartToggle id="uof-fc-cash" view={view.cash} onChange={(v) => setView((x) => ({ ...x, cash: v }))} /> : null}</span>}>
              {!series ? <NotRecorded reason={gap || 'The forecast has no months to draw.'} testId="uof-forecast-cash-none" />
                : view.cash === 'table' ? <SeriesTable testId="uof-forecast-cash-table" rows={{ head: ['Month', 'Cash'], body: series.cash.map((p) => [p.month, money(p.cents, 'usd')]) }} />
                  : <CashLine points={series.cash} marker={series.cashOut} testId="uof-forecast-cash-chart" label={`Cash over the forecast, from ${money(series.cash[0].cents, 'usd')}${series.cashOut >= 0 ? `, running out in ${series.cash[series.cashOut].month}` : ', lasting the whole forecast'}.`} />}
            </Card>
            <Card title="Revenue and net" testId="uof-forecast-revenue" meta={<span className="flex items-center gap-2"><Source source="Modelled" />{series ? <ChartToggle id="uof-fc-rev" view={view.rev} onChange={(v) => setView((x) => ({ ...x, rev: v }))} /> : null}</span>}>
              {!series ? <NotRecorded reason={gap || 'The forecast has no months to draw.'} />
                : view.rev === 'table' ? <SeriesTable testId="uof-forecast-revenue-table" rows={{ head: ['Month', 'Revenue', 'Net'], body: series.revenue.map((p, i) => [p.month, money(p.cents, 'usd'), money(series.net[i].cents, 'usd')]) }} />
                  : (
                    <>
                      <Columns testId="uof-forecast-revenue-chart" label={`Revenue and net by month for the first ${Math.min(12, series.revenue.length)} months.`} format={(v) => money(v, 'usd')}
                        groups={series.revenue.slice(0, 12).map((p, i) => ({ key: p.month, label: p.month, values: [
                          { key: 'rev', value: Math.max(0, p.cents), fill: CHART_FILL[0] },
                          { key: 'net', value: Math.max(0, series.net[i].cents), fill: CHART_FILL[1] }] }))} />
                      <p className={`m-0 text-[11.5px] ${MUTED}`}><span className={`mr-1 inline-block h-2 w-2 rounded-sm ${DOT_FILL[0]}`} />Revenue <span className={`ml-3 mr-1 inline-block h-2 w-2 rounded-sm ${DOT_FILL[1]}`} />Net, where it is positive; the table shows every month, a negative net included.</p>
                    </>
                  )}
            </Card>
            <Card title="Sensitivity · forecast runway in months" meta={<Source source="Modelled" />} testId="uof-sensitivity">
              {!sens ? <NotRecorded reason={gap || 'The forecast has no sensitivity saved. Save it to run one.'} /> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] border-collapse text-left text-[12.5px]">
                    <thead><tr><th className={`px-2 py-1 ${EYEBROW}`}>Driver</th>{sens[0].cells.map((c) => <th key={c.delta} className={`px-2 py-1 ${EYEBROW}`}>{c.base ? 'Base' : `${c.delta > 0 ? '+' : '−'}${Math.abs(c.delta)}%`}</th>)}</tr></thead>
                    <tbody>{sens.map((r) => (
                      <tr key={r.key} data-testid={`uof-sensitivity-${r.key}`}>
                        <td className="px-2 py-1.5 font-bold text-axal-ink dark:text-gray-100">{r.label}</td>
                        {r.cells.map((c) => <td key={c.delta} className={`px-2 py-1.5 ${MONO} ${c.base ? 'font-extrabold text-axal-ink outline outline-[1.5px] outline-offset-[-3px] outline-axal-violet dark:text-gray-100 dark:outline-violet-400' : 'text-axal-ink dark:text-gray-200'}`}>{c.text}</td>)}
                      </tr>
                    ))}</tbody>
                  </table>
                  <p className={`m-0 mt-1 text-[11.5px] ${MUTED}`}>The outlined column is the forecast as you set it.</p>
                </div>
              )}
            </Card>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {exportError ? <span role="alert" className="mr-auto text-[12.5px] text-red-700 dark:text-red-300">{exportError}</span> : null}
              <button type="button" className={BTN_GHOST} onClick={exportIt} disabled={d.exists === false} data-testid="uof-forecast-export">Export</button>
              <button type="button" className={BTN} onClick={() => setDialog(true)} data-testid="uof-forecast-save">Save forecast</button>
            </div>
            <p className={`m-0 text-[11.5px] ${MUTED}`}>The forecast is a model you set. It is not your runway today. No Capital score is drawn.</p>
          </div>
        </div>
      ) : null}
      {dialog && d ? <DriversDialog projectId={projectId} read={d} api={api} onClose={() => setDialog(false)} onSaved={() => { setDialog(false); read.reload(); }} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Scenarios (UF9)
 * ------------------------------------------------------------------ */

function SplitBar({ card }) {
  if (!card.splitKnown) return <NotRecorded reason="The split is not recorded for every section." />;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800" role="img" aria-label={`Split of ${card.name}: ${card.split.map((s) => `${s.short} ${s.share}%`).join(', ')}`}>
        {card.split.map((s) => <span key={s.key} className={SECTION_BG[s.key]} style={{ width: `${s.share}%` }} />)}
      </div>
      <span className={`text-[11px] ${MUTED}`}>{card.split.map((s) => `${s.short} ${s.share}%`).join(' · ')}</span>
    </div>
  );
}

function NewScenarioDialog({ projectId, base, onClose, onDone, api }) {
  const [name, setName] = useState('');
  const [from, setFrom] = useState(base ? 'base' : 'blank');
  const w = useWrite(onDone);
  return (
    <Dialog label="New scenario" title="New scenario" testId="uof-new-scenario" onClose={onClose} busy={w.busy} error={w.error} goLabel="Add scenario" disabled={!name.trim()}
      sub={name.trim() ? `${name.trim()} is added ${from === 'base' ? `as a copy of ${base.name}` : 'blank'}. The base does not change.` : 'Name it, and start from the base or blank.'}
      go={() => w.run(() => api.createScenario(projectId, { name: name.trim().slice(0, 120), ...(from === 'base' && base ? { from_id: base.id } : {}) }))}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200">Name<input className={FIELD} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-testid="uof-new-scenario-name" /></label>
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200">Start from</legend>
          {base ? <label className="flex items-center gap-2 text-[13px]"><input type="radio" name="uof-from" checked={from === 'base'} onChange={() => setFrom('base')} data-testid="uof-new-scenario-base" />The base, {base.name}</label> : null}
          <label className="flex items-center gap-2 text-[13px]"><input type="radio" name="uof-from" checked={from === 'blank'} onChange={() => setFrom('blank')} data-testid="uof-new-scenario-blank" />Blank: no raise and no split</label>
        </fieldset>
      </div>
    </Dialog>
  );
}

function EditScenarioDialog({ projectId, scenario, onClose, onDone, api }) {
  const [f, setF] = useState({
    name: scenario.name || '', raise: scenario.amount_to_raise_cents == null ? '' : String(scenario.amount_to_raise_cents / 100), target: String(scenario.target_runway_months ?? 18),
    shares: Object.fromEntries(SECTIONS.map((s) => [s.key, String(scenario.lines?.find((l) => l.category_key === s.key)?.share_pct ?? '')])),
  });
  const out = scenarioBody(f);
  const w = useWrite(onDone);
  return (
    <Dialog label="Edit scenario" title={`Edit ${scenario.name}`} testId="uof-edit-scenario" onClose={onClose} busy={w.busy} error={w.error || out.error || ''} goLabel="Save scenario" disabled={!!out.error}
      sub={scenario.is_base ? 'This is the base: the deck and readiness read it, and its split is projected to the plan.' : 'Only this scenario changes. The base does not.'}
      go={() => w.run(() => api.updateScenario(projectId, scenario.id, out.body))}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200">Name<input className={FIELD} value={f.name} maxLength={120} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} data-testid="uof-edit-scenario-name" /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200">Raise (US dollars)<input className={`${FIELD} ${MONO}`} inputMode="decimal" value={f.raise} onChange={(e) => setF((x) => ({ ...x, raise: e.target.value }))} data-testid="uof-edit-scenario-raise" /></label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200">Target runway (months)<input className={`${FIELD} ${MONO}`} inputMode="numeric" value={f.target} onChange={(e) => setF((x) => ({ ...x, target: e.target.value }))} /></label>
        </div>
        <fieldset className="m-0 grid grid-cols-2 gap-2 border-0 p-0 sm:grid-cols-5">
          <legend className="mb-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200">Split (%) · all five add to 100, or leave all empty</legend>
          {SECTIONS.map((s) => (
            <label key={s.key} className={`flex flex-col gap-1 text-[11.5px] ${MUTED}`}>{s.short}
              <input className={`${FIELD} ${MONO}`} inputMode="numeric" value={f.shares[s.key]} onChange={(e) => setF((x) => ({ ...x, shares: { ...x.shares, [s.key]: e.target.value } }))} data-testid={`uof-edit-scenario-share-${s.key}`} />
            </label>
          ))}
        </fieldset>
      </div>
    </Dialog>
  );
}

function MakeBaseDialog({ projectId, scenario, onClose, onDone, api }) {
  const v = makeBaseView(scenario);
  const w = useWrite(onDone);
  return (
    <Dialog label="Make this the base" title={`Make ${v.name} the base?`} sub="The pitch deck and readiness will read this scenario." testId="uof-make-base" onClose={onClose}
      busy={w.busy} error={w.error || v.blocked || ''} goLabel="Make this the base" disabled={!!v.blocked} go={() => w.run(() => api.makeBase(projectId, scenario.id))}>
      <div className="flex flex-col gap-2 text-[13px]">
        <div className="flex justify-between"><span>Raise</span><span className={MONO}>{v.raise || NOT_RECORDED}</span></div>
        <div className="flex justify-between gap-2"><span>Runway after the raise</span><span className="flex items-center gap-2"><span className={MONO}>{v.runway.value || NOT_RECORDED}</span><Source source="Modelled" /></span></div>
        <div className="flex justify-between"><span>Your target</span><span className={MONO}>{v.target ? `${v.target} months` : NOT_RECORDED}</span></div>
        {v.warning ? <p className="m-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="uof-make-base-warning">{v.warning}</p> : null}
      </div>
    </Dialog>
  );
}

function DeleteScenarioDialog({ projectId, scenario, onClose, onDone, api }) {
  const w = useWrite(onDone);
  return (
    <Dialog label="Delete scenario" title={`Delete ${scenario.name}?`} sub="The scenario, its split and its milestones are removed. The base and the plan do not change." testId="uof-delete-scenario"
      onClose={onClose} busy={w.busy} error={w.error} goLabel="Delete scenario" go={() => w.run(() => api.deleteScenario(projectId, scenario.id))}>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>The base cannot be deleted. Make another scenario the base first.</p>
    </Dialog>
  );
}

export function Scenarios({ projectId, search = '', api = useOfFundsApi }) {
  const read = useRead(() => api.scenarios(projectId), projectId ? `scenarios:${projectId}` : null);
  const navigate = useNavigate();
  const [picked, setPicked] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [open, setOpen] = useState(null);
  const items = read.data?.items || [];
  const base = items.find((s) => s.is_base) || null;
  const done = () => { setDialog(null); read.reload(); };
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < MAX_COMPARE ? [...p, id] : p));
  return (
    <div className="flex flex-col gap-3" data-testid="uof-scenarios">
      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-axal-hairline bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
        <span className="mr-auto text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="uof-scenarios-count">{read.data ? `${items.length} ${items.length === 1 ? 'scenario' : 'scenarios'}` : 'Scenarios'}</span>
        <button type="button" className={BTN_GHOST} onClick={() => setDialog({ kind: 'new' })} disabled={!read.data} data-testid="uof-scenarios-new">New scenario</button>
        <button type="button" className={BTN} disabled={!picked.length} onClick={() => navigate(compareHref(picked, search))} data-testid="uof-scenarios-compare">Compare selected{picked.length ? ` (${picked.length})` : ''}</button>
        <p className={`m-0 w-full text-[11.5px] ${MUTED}`}>A new scenario starts from the base or blank. Pick up to {MAX_COMPARE} to compare with today. Only the base reaches the deck.</p>
      </section>
      {read.status === 'loading' && !read.data ? <Skeleton lines={3} testId="uof-scenarios-loading" /> : null}
      {read.status === 'unreadable' ? <BlockError text="Your scenarios could not be read. This is not a claim that you have none." onRetry={read.reload} testId="uof-scenarios-unreadable" /> : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((s) => {
          const c = scenarioCard(s);
          const isOpen = open === s.id;
          return (
            <section key={s.id} className={`flex min-w-0 flex-col gap-2.5 rounded-xl border bg-white px-4 py-3 dark:bg-gray-900 ${c.base ? 'border-violet-300 ring-2 ring-violet-100 dark:border-violet-700 dark:ring-violet-950' : 'border-axal-hairline dark:border-gray-800'}`} data-testid="uof-scenario">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5"><span className={EYEBROW}>{c.base ? 'Base' : 'Scenario'}</span><h3 className={H3}>{c.name}</h3></div>
                <span className={`${MONO} text-[14px] font-extrabold text-axal-ink dark:text-gray-100`}>{c.raise || <span className={`text-[12px] font-semibold ${MUTED}`}>Raise not recorded</span>}</span>
              </div>
              <SplitBar card={c} />
              <div className="flex flex-wrap items-center justify-between gap-1 text-[12.5px]"><span>Runway after the raise</span><span className="flex items-center gap-2"><span className={MONO} data-testid="uof-scenario-runway">{c.runway.value || NOT_RECORDED}</span><Source source="Modelled" /></span></div>
              <div className="flex justify-between text-[12.5px]"><span>Milestones funded</span><span className={MONO}>{c.milestones}</span></div>
              <div className="flex justify-between gap-2 text-[12.5px]"><span>Cap table</span><span className={MUTED}>{c.capTable}</span></div>
              {isOpen ? (
                <div className="flex flex-col gap-1.5 border-t border-axal-hairline pt-2 dark:border-gray-800" data-testid="uof-scenario-detail">
                  <span className={EYEBROW}>Allocation</span>
                  {c.split.map((x) => <div key={x.key} className="flex justify-between text-[12px]"><span>{x.label}</span><span className={MONO}>{x.share == null ? NOT_RECORDED : `${x.share}%${s.amount_to_raise_cents != null ? ` · ${money(Math.round((s.amount_to_raise_cents * x.share) / 100), s.currency)}` : ''}`}</span></div>)}
                  <span className={`${EYEBROW} mt-1`}>Milestones</span>
                  {(s.milestones || []).length ? s.milestones.map((m) => <div key={m.id} className="flex justify-between gap-2 text-[12px]"><span>{m.label}</span><span className={MONO}>{m.cost_cents == null ? 'Not costed' : money(m.cost_cents, s.currency)}</span></div>)
                    : <span className={`text-[12px] ${MUTED}`}>No milestones in this scenario yet.</span>}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 border-t border-axal-hairline pt-2 dark:border-gray-800">
                <label className="mr-auto flex items-center gap-2 text-[12.5px] font-semibold"><input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} disabled={!picked.includes(s.id) && picked.length >= MAX_COMPARE} data-testid="uof-scenario-pick" />Compare</label>
                <button type="button" className={BTN_GHOST} onClick={() => setOpen(isOpen ? null : s.id)} data-testid="uof-scenario-open">{isOpen ? 'Close' : 'Open'}</button>
                <button type="button" className={BTN_GHOST} onClick={() => setDialog({ kind: 'edit', s })} data-testid="uof-scenario-edit">Edit</button>
                {!c.base ? <button type="button" className={BTN_GHOST} onClick={() => setDialog({ kind: 'base', s })} data-testid="uof-scenario-make-base">Make this the base</button> : null}
                {!c.base ? <button type="button" className={BTN_GHOST} onClick={() => setDialog({ kind: 'delete', s })} data-testid="uof-scenario-delete">Delete</button> : null}
              </div>
              {c.changed ? <span className={`text-[11px] ${MUTED}`}>Changed {c.changed}</span> : null}
            </section>
          );
        })}
      </div>
      {dialog?.kind === 'new' ? <NewScenarioDialog projectId={projectId} base={base} api={api} onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog?.kind === 'edit' ? <EditScenarioDialog projectId={projectId} scenario={dialog.s} api={api} onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog?.kind === 'base' ? <MakeBaseDialog projectId={projectId} scenario={dialog.s} api={api} onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog?.kind === 'delete' ? <DeleteScenarioDialog projectId={projectId} scenario={dialog.s} api={api} onClose={() => setDialog(null)} onDone={done} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Scenarios compared (UF10, UF11)
 * ------------------------------------------------------------------ */

function MultiLine({ paths, label, testId }) {
  const drawn = paths.filter((p) => p.points?.length);
  const n = Math.max(1, ...drawn.map((p) => p.points.length));
  const max = Math.max(1, ...drawn.flatMap((p) => p.points.map((x) => x.cents)));
  const w = 560; const h = 170; const pad = 6;
  const x = (i) => pad + (i * (w - pad * 2)) / Math.max(1, n - 1);
  const y = (v) => h - pad - (Math.max(0, v) / max) * (h - pad * 2);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-44 w-full" role="img" aria-label={label} data-testid={testId}>
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} className="stroke-gray-200 dark:stroke-gray-700" />
      {drawn.map((p) => (
        <path key={p.id} d={p.points.map((q, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(q.cents).toFixed(1)}`).join(' ')} fill="none" strokeWidth="2" className={LINE_STROKE[paths.indexOf(p) % LINE_STROKE.length]} />
      ))}
    </svg>
  );
}

export function Compare({ projectId, search = '', api = useOfFundsApi }) {
  const ids = compareIds(search);
  const read = useRead(() => api.compare(projectId, ids), projectId && ids.length ? `compare:${projectId}:${ids.join(',')}` : null);
  const [view, setView] = useState('chart');
  const scenariosTab = TABS.find((t) => t.id === 'scenarios');
  const back = <Link className={BTN_GHOST} to={tabHref(scenariosTab, search)} data-testid="uof-compare-back">‹ Scenarios</Link>;
  if (!ids.length) {
    return (
      <div className="flex flex-col gap-3" data-testid="uof-compare">
        <Card title="Scenarios compared" testId="uof-compare-none"><p className={`m-0 text-[12.5px] ${MUTED}`}>Pick one to {MAX_COMPARE} scenarios on Scenarios to compare them with today.</p>{back}</Card>
      </div>
    );
  }
  const d = read.data;
  const t = d ? compareTable(d) : null;
  const paths = d ? cashPaths(d) : [];
  const funded = d ? fundedBySection(d) : [];
  return (
    <div className="flex flex-col gap-3" data-testid="uof-compare">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><span className={EYEBROW}>Scenarios › Compare</span><h2 className="m-0 text-[18px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Scenarios compared</h2></div>
        {back}
      </div>
      {read.status === 'loading' && !d ? <Skeleton lines={4} testId="uof-compare-loading" /> : null}
      {read.status === 'unreadable' ? <BlockError text="The comparison could not be read. A scenario may have been deleted; pick them again on Scenarios." onRetry={read.reload} testId="uof-compare-unreadable" /> : null}
      {t ? (
        <Card title="Today and each scenario" meta={<Source source="Modelled" detail="the scenario columns" />} testId="uof-compare-table">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px]">
              <thead><tr className="border-b border-axal-hairline dark:border-gray-800"><th className={`px-2 py-2 ${EYEBROW}`} />
                <th className={`border-l-2 border-dotted border-gray-400 px-2 py-2 ${EYEBROW} dark:border-gray-500`}>Today · no raise</th>
                {t.cols.map((c) => <th key={c.id} className={`px-2 py-2 ${EYEBROW}`}>{c.name}</th>)}</tr></thead>
              <tbody>{t.rows.map((r) => (
                <tr key={r.key} className="border-b border-axal-hairline last:border-0 align-top dark:border-gray-800" data-testid={`uof-compare-row-${r.key}`}>
                  <td className="px-2 py-1.5 font-bold text-axal-ink dark:text-gray-100">{r.label}</td>
                  <td className={`border-l-2 border-dotted border-gray-400 px-2 py-1.5 ${MONO} ${MUTED} dark:border-gray-500`}>{r.today.text}</td>
                  {r.cells.map((c, i) => <td key={i} className={`px-2 py-1.5 ${MONO} ${c.missing ? MUTED : 'text-axal-ink dark:text-gray-100'}`}>{c.text}{c.missing && c.reason ? <span className="block font-sans text-[11px]">{c.reason}</span> : null}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className={`m-0 text-[11.5px] ${MUTED}`}>Today, edged dotted, is the record: {t.today.value ? `runway today from ${sourceText(t.today.source || 'Recorded')}` : 'runway today is not recorded'}, and no raise. The scenario columns are Modelled.</p>
        </Card>
      ) : null}
      {d ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card title="Cash paths" testId="uof-compare-cash" meta={<span className="flex items-center gap-2"><Source source="Modelled" /><ChartToggle id="uof-cmp-cash" view={view} onChange={setView} /></span>}>
            {view === 'table' ? (
              <div className="max-h-64 overflow-auto"><table className="w-full border-collapse text-left text-[12px]" data-testid="uof-compare-cash-table">
                <thead><tr><th className={`px-2 py-1 ${EYEBROW}`}>Month</th>{paths.map((p) => <th key={p.id} className={`px-2 py-1 ${EYEBROW}`}>{p.name}</th>)}</tr></thead>
                <tbody>{(paths.find((p) => p.points)?.points || []).map((q, i) => <tr key={q.month}><td className={`px-2 py-1 ${MONO}`}>{q.month}</td>{paths.map((p) => <td key={p.id} className={`px-2 py-1 ${MONO}`}>{p.points?.[i] ? money(p.points[i].cents, p.currency) : '—'}</td>)}</tr>)}</tbody>
              </table></div>
            ) : <MultiLine paths={paths} label={cashSentence(paths)} testId="uof-compare-cash-chart" />}
            <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[11.5px]">{paths.map((p, i) => <li key={p.id} className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${DOT_FILL[i % DOT_FILL.length]}`} />{p.name}{p.points ? '' : ` · ${NOT_RECORDED}`}</li>)}</ul>
            <p className={`m-0 text-[11.5px] ${MUTED}`}>{cashSentence(paths)} Today’s path with no raise is not modelled.</p>
          </Card>
          <Card title="Milestones funded, by section" testId="uof-compare-funded">
            <Columns testId="uof-compare-funded-chart" label={`Milestones funded by section, for ${paths.map((p) => p.name).join(', ')}.`}
              groups={funded.map((g) => ({ key: g.key, label: g.label, values: g.values.map((v, i) => ({ key: String(v.id), value: v.total ? v.funded : null, fill: CHART_FILL[i % CHART_FILL.length] })) }))} />
            <table className="w-full border-collapse text-left text-[12px]" data-testid="uof-compare-funded-table">
              <tbody>{funded.map((g) => <tr key={g.key}><td className="px-2 py-1">{g.label}</td>{g.values.map((v) => <td key={v.id} className={`px-2 py-1 ${MONO}`}>{v.total ? `${v.funded} of ${v.total}${v.notCosted ? ` · ${v.notCosted} not costed` : ''}` : '—'}</td>)}</tr>)}</tbody>
            </table>
          </Card>
        </div>
      ) : null}
      {d ? <Pill tone="neutral">Scenarios are models. Runway today is the record, never a scenario.</Pill> : null}
    </div>
  );
}
