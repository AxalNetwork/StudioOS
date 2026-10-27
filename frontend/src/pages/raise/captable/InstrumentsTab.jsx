import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { capTableRecordApi } from '../../../lib/api/capTableRecord';
import { capTableScenariosApi } from '../../../lib/api/capTableScenarios';
import { Unreadable, actionGhost, actionPrimary } from '../../../ui';
import { Tag } from './CapTableTag';
import { BASIS_CHECK, scenarioCard, tabSearch } from './capTableModel';
import {
  BASIS_OPTIONS, EMPTY_FILTERS, NOTES_ONLY, SORT_OPTIONS, STATUS_OPTIONS, TYPE_OPTIONS,
  convertBody, convertView, filterInstruments, instrumentHref, instrumentView, over100, recordInstruments,
} from './instrumentsModel';
import Sheet from '../../../ui/Sheet.jsx';

/**
 * D1023 (#2860, CT3, CT3b, CT4) — Instruments at `/raise/cap-table/instruments`:
 * the SAFEs and notes on record, with the toolbar and every column; "Convert
 * at" a next-round price or a scenario, which runs a round from Today (D1018)
 * and draws the modelled columns and the as-converted chart; the red notice
 * when post-money caps promise 100% or more; and the instrument drawer at
 * `/raise/cap-table/instrument/<uid>`.
 *
 * Each read answers alone: the record, Today and the scenarios. A failed one
 * says so where its block would be; the rest of the page still draws.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-200';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TH = 'px-3 py-2 text-left text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TD = 'px-3 py-2 align-top text-[12.5px] text-axal-ink dark:text-gray-200';
const MONO = 'font-mono tabular-nums';
const INPUT = 'rounded-[9px] border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200';
const PILL = 'inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold';
const NEUTRAL = 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200';
const AMBER = 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-300/55 dark:bg-amber-300/10 dark:text-amber-300';
const VIOLET = 'border-violet-200 bg-violet-50 text-axal-violet dark:border-[#4c3a8a] dark:bg-[#211f3d] dark:text-violet-400';
const RED = 'rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-700 dark:border-red-400/50 dark:bg-red-400/10 dark:text-red-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-400 dark:hover:text-violet-300';

/** One read, answering alone: loading, ready, refused (403 or 404) or error. */
function useRead(load, projectId, reload) {
  const [state, setState] = useState({ status: 'loading', data: null });
  useEffect(() => {
    if (!projectId) return undefined;
    let alive = true;
    setState({ status: 'loading', data: null });
    Promise.resolve().then(() => load(projectId))
      .then((data) => { if (alive) setState({ status: 'ready', data }); })
      .catch((e) => { if (alive) setState({ status: [403, 404].includes(e?.status) ? 'refused' : 'error', data: null, message: e?.message || '' }); });
    return () => { alive = false; };
  }, [load, projectId, reload]);
  return state;
}

const readRecord = (id) => capTableRecordApi.read(id);
const readToday = (id) => capTableScenariosApi.today(id);
const readCompare = (id) => api.getCapTableCompare(id);

function Block({ title, tag, aside, testId, children }) {
  return (
    <section className={CARD} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-700">
        <h2 className={`m-0 flex items-center gap-2 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>{title} {tag}</h2>
        {aside}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function State({ read, what, claim, onRetry, testId, children }) {
  if (read.status === 'loading') return <div className="h-20 w-full animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid={`${testId}-loading`} />;
  if (read.status === 'refused') return <p className={`m-0 text-[13px] ${INK}`} data-testid={`${testId}-refused`}>{read.message || 'You do not have access to this venture’s cap table.'}</p>;
  if (read.status === 'error') return <div data-testid={`${testId}-unreadable`}><Unreadable what={what} claim={claim} onRetry={onRetry} /></div>;
  return children;
}

function Toolbar({ value, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const select = (k, list, label) => (
    <select className={INPUT} value={value[k]} onChange={set(k)} aria-label={label} data-testid={`captable-inst-${k}`}>
      {list.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-axal-ground px-4 py-3 dark:border-gray-700" role="search" aria-label="Search instruments" data-testid="captable-inst-toolbar">
      <Tag kind="record" />
      <input className={`${INPUT} min-w-[160px] flex-1`} value={value.q} onChange={set('q')} placeholder="Search instruments" aria-label="Search instruments" maxLength={200} data-testid="captable-inst-q" />
      {select('type', TYPE_OPTIONS, 'Type')}
      {select('basis', BASIS_OPTIONS, 'Basis')}
      {select('status', STATUS_OPTIONS, 'Status')}
      {select('sort', SORT_OPTIONS, 'Sort')}
    </div>
  );
}

const COLS = ['Holder', 'Amount', 'Cap', 'Discount', 'Basis', 'MFN', 'Interest · maturity', 'Signed', 'Document', 'Status', 'Source'];

function RecordTable({ rows, all, search }) {
  if (all.length === 0) return <p className={`m-0 px-4 py-3 text-[12.5px] ${MUTED}`} data-testid="captable-inst-none">No SAFE or note is on record for this venture. Record one from Overview.</p>;
  if (rows.length === 0) return <p className={`m-0 px-4 py-3 text-[12.5px] ${MUTED}`} data-testid="captable-inst-filtered">No instrument matches these filters.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" data-testid="captable-inst-table">
        <thead><tr className="border-b border-axal-hairline dark:border-gray-700">{COLS.map((c) => <th key={c} className={TH}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.uid} className="border-b border-axal-ground last:border-b-0 dark:border-gray-700" data-testid="captable-inst-row">
              <td className={TD}>
                <Link className={`${LINK} text-[12.5px]`} to={instrumentHref(r.uid, tabSearch(search))} data-testid="captable-inst-open">{r.holder}</Link>
                <span className={`block text-[11.5px] ${MUTED}`}>{r.type}</span>
              </td>
              <td className={`${TD} ${MONO}`}>{r.amount}</td>
              <td className={`${TD} ${MONO}`}>{r.cap}</td>
              <td className={`${TD} ${MONO}`}>{r.discount}</td>
              <td className={TD}>
                <span className="flex flex-col gap-1">{r.basis}{r.check ? <><span className={`${PILL} ${AMBER}`} data-testid="captable-inst-check">! Check</span><span className={`text-[11px] ${MUTED}`}>{BASIS_CHECK}</span></> : null}</span>
              </td>
              <td className={TD}>{r.mfn}</td>
              <td className={`${TD} ${MONO}`}>{r.interest ?? <span className={MUTED} title={NOTES_ONLY} data-testid="captable-inst-notes-only">—</span>}</td>
              <td className={`${TD} ${MONO}`}>{r.signed}</td>
              <td className={TD}>{r.document ? <span className="text-[11.5px] text-axal-violet dark:text-violet-400">{r.document}</span> : <span className={`${PILL} ${AMBER}`} data-testid="captable-inst-nodoc">! No document</span>}</td>
              <td className={TD}><span className={`${PILL} ${r.status === 'converted' ? NEUTRAL : VIOLET}`}>{r.statusWord}</span></td>
              <td className={TD}><span className={`${PILL} ${NEUTRAL}`} data-testid="captable-inst-source">{r.source}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Convert at": a next-round price, or a scenario's first round. Modelled; nothing is saved. */
function ConvertAt({ projectId, today, compare, instruments, onResult }) {
  const scenarios = useMemo(() => {
    if (compare.status !== 'ready') return [];
    const out = [];
    if (compare.data?.canonical) out.push({ ...compare.data.canonical, name: scenarioCard(compare.data.canonical, { model: true }).name });
    for (const v of compare.data?.variants || []) out.push(v);
    return out.filter((s) => s?.inputs?.rounds?.length);
  }, [compare]);
  const [mode, setMode] = useState('price');
  const [form, setForm] = useState({ price: '', raise: '' });
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentence, setSentence] = useState('');
  const go = async () => {
    const scenario = scenarios.find((s) => String(s.uid || s.name) === pick) || scenarios[0] || null;
    const out = convertBody(mode, form, { today: today.status === 'ready' ? today.data : null, scenario });
    if (!out.body) { setSentence(out.sentence); return; }
    setBusy(true); setSentence('');
    try {
      const sim = await capTableScenariosApi.simulate(projectId, out.body);
      onResult(convertView(sim, instruments, out.label));
    } catch (e) {
      setSentence(e?.message || 'The round could not be run. Nothing was saved.');
    } finally { setBusy(false); }
  };
  const radio = (value, label) => (
    <label className={`flex items-center gap-2 text-[12.5px] ${INK}`}>
      <input type="radio" name="convert-at" value={value} checked={mode === value} onChange={() => { setMode(value); setSentence(''); }} data-testid={`captable-convert-mode-${value}`} />{label}
    </label>
  );
  return (
    <Block title="Convert at" tag={<Tag kind="modelled" />} testId="captable-convert-at">
      <div className="flex flex-col gap-2.5">
        {radio('price', 'Next round price')}
        {mode === 'price' ? (
          <div className="flex flex-wrap gap-2 pl-6">
            <label className={`flex flex-col text-[10.5px] font-bold uppercase ${MUTED}`}>Price per share<input className={`${INPUT} ${MONO}`} inputMode="decimal" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} placeholder="$1.03" aria-label="Price per share" data-testid="captable-convert-price" /></label>
            <label className={`flex flex-col text-[10.5px] font-bold uppercase ${MUTED}`}>Amount raised<input className={`${INPUT} ${MONO}`} inputMode="decimal" value={form.raise} onChange={(e) => setForm((f) => ({ ...f, raise: e.target.value }))} placeholder="$3,000,000" aria-label="Amount raised" data-testid="captable-convert-raise" /></label>
          </div>
        ) : null}
        {scenarios.length ? radio('scenario', 'From a scenario') : <span className={`text-[12px] ${MUTED}`} data-testid="captable-convert-no-scenario">{compare.status === 'error' ? 'Your scenarios could not be read, so none can be picked.' : 'No scenario plans a round yet.'}</span>}
        {mode === 'scenario' && scenarios.length ? (
          <select className={`${INPUT} ml-6 w-fit`} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Scenario" data-testid="captable-convert-scenario">
            {scenarios.map((s) => <option key={s.uid || s.name} value={String(s.uid || s.name)}>{s.name}</option>)}
          </select>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={actionPrimary} onClick={go} disabled={busy || today.status === 'loading'} data-testid="captable-convert-go">{busy ? 'Converting…' : 'Convert'}</button>
          <span className={`text-[11.5px] ${MUTED}`}>Runs a round from Today. Nothing is saved.</span>
        </div>
        {sentence ? <p role="alert" className="m-0 text-[12px] font-semibold text-red-700 dark:text-red-400" data-testid="captable-convert-refusal">{sentence}</p> : null}
      </div>
    </Block>
  );
}

function Converted({ view }) {
  return (
    <>
      <Block title={view.title} tag={<Tag kind="modelled" />} testId="captable-converted">
        <div className="flex flex-col gap-2">
          {view.notice ? <p role="alert" className={`m-0 ${RED}`} data-testid="captable-over-100">{view.notice}</p> : null}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" data-testid="captable-converted-table">
              <thead><tr className="border-b border-axal-hairline dark:border-gray-700">{['Holder', 'Conversion price', 'Shares', '% after the round'].map((c) => <th key={c} className={TH}>{c}</th>)}</tr></thead>
              <tbody>
                {view.rows.map((r) => (
                  <tr key={r.uid} className="border-b border-axal-ground last:border-b-0 dark:border-gray-700" data-testid="captable-converted-row">
                    <td className={`${TD} font-bold`}>{r.holder}</td>
                    {r.converted ? (
                      <>
                        <td className={TD}><span className={`${MONO} font-bold`}>{r.price}</span><span className={`block text-[11.5px] ${MUTED}`}>{r.binding}</span></td>
                        <td className={`${TD} ${MONO}`}>{r.sharesWord}</td>
                        <td className={`${TD} ${MONO}`}>{r.pctAfter}</td>
                      </>
                    ) : <td className={`${TD} ${MUTED}`} colSpan={3} data-testid="captable-converted-skip">{r.reason}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {view.warnings.map((w) => <p key={w} className={`m-0 text-[11.5px] ${MUTED}`}>{w}</p>)}
        </div>
      </Block>
      <Block title="As-converted shares, by instrument" tag={<Tag kind="modelled" />} testId="captable-converted-chart">
        <div className="flex flex-col gap-2">
          <p className={`m-0 text-[12.5px] ${INK}`}>{view.lead}</p>
          <div role="img" aria-label={view.summary ? `As-converted shares at ${view.roundPrice} a share: ${view.summary}.` : view.lead} className="flex flex-col gap-1.5">
            {view.bars.map((b) => (
              <div key={b.uid} className="grid grid-cols-[minmax(0,240px)_minmax(0,1fr)_120px] items-center gap-2.5 text-[12.5px]" title={b.tip || undefined} data-testid={b.hairline ? 'captable-bar-cannot' : 'captable-bar'}>
                <span className={`truncate ${INK}`}>{b.label}</span>
                <span className={`relative h-3 rounded ${b.hairline ? 'border-t border-dashed border-axal-muted dark:border-gray-500' : 'bg-axal-ground dark:bg-gray-800'}`}>
                  {b.hairline ? null : <span className="absolute inset-y-0 left-0 rounded bg-axal-violet dark:bg-violet-400" style={{ width: b.width }} />}
                </span>
                <span className={`${MONO} ${b.hairline ? `text-[11.5px] ${MUTED}` : INK}`}>{b.value}</span>
              </div>
            ))}
          </div>
          {view.cannotConvert ? <p className={`m-0 text-[11.5px] ${MUTED}`} data-testid="captable-cannot-line">{view.cannotConvert}</p> : null}
        </div>
      </Block>
    </>
  );
}

function InstrumentDrawer({ projectId, uid, record, today, onClose }) {
  const [sim, setSim] = useState({ status: 'idle', data: null });
  const inst = record.status === 'ready' ? recordInstruments(record.data).find((i) => i.uid === uid) || null : null;
  useEffect(() => {
    // How it converts reads the model's planned round, run from Today; without one, nothing converts here.
    if (!inst || inst.status !== 'outstanding' || today.status !== 'ready') return undefined;
    const round = today.data?.model?.inputs?.rounds?.[0];
    if (!round) { setSim({ status: 'none', data: null }); return undefined; }
    let alive = true;
    setSim({ status: 'loading', data: null });
    capTableScenariosApi.simulate(projectId, { rounds: [round] })
      .then((data) => { if (alive) setSim({ status: 'ready', data }); }, () => { if (alive) setSim({ status: 'error', data: null }); });
    return () => { alive = false; };
  }, [projectId, inst?.uid, inst?.status, today.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = inst ? instrumentView(inst, { today: today.status === 'ready' ? today.data : null, sim: sim.status === 'ready' ? sim.data : null }) : null;
  const section = (title, children, testId, tag = null) => (
    <section className="flex flex-col gap-1.5 border-t border-axal-hairline pt-3 dark:border-gray-700" data-testid={testId}>
      <h3 className={`m-0 flex items-center gap-2 ${EYEBROW}`}>{title} {tag}</h3>
      {children}
    </section>
  );
  const footer = <div className="flex justify-end"><button type="button" className={actionGhost} onClick={onClose} data-testid="captable-instrument-close">Close</button></div>;
  return (
    <Sheet label={v?.title || 'Instrument'} eyebrow="Instrument" title={v?.title || 'Instrument'} width={600} onClose={onClose} testId="captable-instrument" footer={footer} phone="sheet">
      {record.status === 'loading' ? <div className="h-24 animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid="captable-instrument-loading" />
        : record.status !== 'ready' ? <div data-testid="captable-instrument-unreadable"><Unreadable what="This instrument" claim="This is not a claim that it does not exist." /></div>
          : !v ? <p className={`m-0 text-[13px] ${INK}`} data-testid="captable-instrument-missing">No SAFE or note on this venture’s record has that id.</p>
            : (
              <div className="flex flex-col gap-3 text-[13px]">
                <div className="flex flex-wrap gap-1.5"><span className={`${PILL} ${NEUTRAL}`}>{v.source}</span><Tag kind="record" /></div>
                {section('Terms as recorded', (
                  <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-2" data-testid="captable-instrument-terms">
                    {v.facts.map((f) => (
                      <div key={f.k} className="flex flex-col">
                        <dt className={EYEBROW}>{f.k}</dt>
                        <dd className={`m-0 ${MONO} ${INK}`}>{f.v}</dd>
                        <dd className={`m-0 text-[11px] ${MUTED}`}>{f.sub}</dd>
                        {f.check ? <dd className={`m-0 mt-1 ${PILL} ${AMBER}`}>{f.check}</dd> : null}
                      </div>
                    ))}
                  </dl>
                ), 'captable-instrument-terms-block')}
                {section('How it converts', v.steps ? (
                  <div className="flex flex-col gap-1" data-testid="captable-instrument-steps">
                    {v.steps.lines.map((l) => <span key={l} className={`font-mono text-[12.5px] font-semibold leading-relaxed ${INK}`}>{l}</span>)}
                    {v.steps.interest ? <span className={`text-[12px] ${MUTED}`}>{v.steps.interest}</span> : null}
                  </div>
                ) : (
                  <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-instrument-no-steps">
                    {v.unconverted || (sim.status === 'error' ? 'The round could not be run, so how it converts is not shown.'
                      : sim.status === 'loading' || today.status === 'loading' ? 'Working it out…'
                        : today.status === 'error' ? 'Today could not be read, so how it converts is not shown.'
                          : 'No round is planned in your model, so nothing converts yet. Plan one in Scenarios.')}
                  </p>
                ), 'captable-instrument-converts', <Tag kind="modelled" />)}
                {section('MFN', (
                  <div className="flex flex-col gap-1" data-testid="captable-instrument-mfn">
                    <span className={`text-[12.5px] ${INK}`}>{v.mfn.note}</span>
                    {v.mfn.later == null ? <span className={`text-[12px] ${MUTED}`}>Later SAFEs could not be compared: Today could not be read.</span>
                      : v.mfn.later.map((l) => <span key={l.line} className="flex justify-between gap-2 text-[12px]"><span className={INK}>{l.line}</span><span className={`font-bold ${MUTED}`}>{l.verdict}</span></span>)}
                  </div>
                ), 'captable-instrument-mfn-block')}
                {section('At an exit before conversion', <p className={`m-0 text-[12.5px] ${INK}`} data-testid="captable-instrument-exit">{v.exit}</p>, 'captable-instrument-exit-block', <Tag kind="modelled" />)}
              </div>
            )}
    </Sheet>
  );
}

export default function InstrumentsTab({ projectId, reload, retry, search = '', openUid = null }) {
  const navigate = useNavigate();
  const record = useRead(readRecord, projectId, reload);
  const today = useRead(readToday, projectId, reload);
  const compare = useRead(readCompare, projectId, reload);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [view, setView] = useState(null);
  const all = record.status === 'ready' ? recordInstruments(record.data) : [];
  const rows = filterInstruments(all, filters);
  // Before any conversion, part 3's check on the record's own instruments (CT3b).
  const promised = today.status === 'ready' ? over100(today.data?.today?.result?.post_money_check) : null;
  return (
    <div className="flex flex-col gap-3.5">
      <section className={CARD} data-testid="captable-instruments">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-700">
          <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>Instruments</h2>
          {record.status === 'ready' ? <span className={`font-mono text-[11.5px] ${MUTED}`} data-testid="captable-inst-count">{rows.length} of {all.length}</span> : null}
        </div>
        <State read={record} what="Your instruments" claim="This is not a claim that none are recorded." onRetry={retry} testId="captable-inst">
          <Toolbar value={filters} onChange={setFilters} />
          {promised && !view ? <p role="alert" className={`m-4 ${RED}`} data-testid="captable-over-100">{promised}</p> : null}
          <RecordTable rows={rows} all={all} search={search} />
        </State>
      </section>
      {record.status === 'ready' && all.some((i) => i.status === 'outstanding') ? (
        <>
          <ConvertAt projectId={projectId} today={today} compare={compare} instruments={all} onResult={setView} />
          {today.status === 'error' ? <div data-testid="captable-today-unreadable"><Unreadable what="Today" claim="This is not a claim that nothing converts." onRetry={retry} /></div> : null}
          {view ? <Converted view={view} /> : null}
        </>
      ) : null}
      {openUid ? <InstrumentDrawer projectId={projectId} uid={openUid} record={record} today={today} onClose={() => navigate(`/raise/cap-table/instruments${tabSearch(search)}`)} /> : null}
    </div>
  );
}
