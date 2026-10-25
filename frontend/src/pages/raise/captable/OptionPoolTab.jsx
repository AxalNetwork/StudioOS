import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { capTableHolderApi } from '../../../lib/api/capTableHolder';
import { capTableRecordApi } from '../../../lib/api/capTableRecord';
import { Unreadable, actionGhost } from '../../../ui';
import CapTableDialog, { useWrite } from './CapTableDialog';
import { Tag } from './CapTableTag';
import { harbour, harbourTone, variantsHref } from './capTableModel';
import { isoDay } from './historyModel';
import {
  CARTA_URL, EVENT_KINDS, GRANT_SORTS, METHODS, TOP_UP_LINE,
  burnDown, eventBody, filterGrants, grantRows, harbourChecks, isCarta, poolTiles, valuationBody, vestedFoot,
} from './poolModel';

/**
 * D1023 (#2860, CT5, CT5c) — Option pool at `/raise/cap-table/option-pool`:
 * the five tiles, the burn-down by month with the model's target dotted, the
 * 409A with "Record a valuation" and "Record an event" in dialogs (they
 * replace the simulator's door), "Top up the pool", which opens a scenario,
 * and the grants from the venture's plan. With Carta connected the grants are
 * Carta's, read only, each with "Edit in Carta" (CT5c).
 *
 * Each read answers alone: the record, the plan, the 409A and the model.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TH = 'px-3 py-2 text-left text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TD = 'px-3 py-2 align-top text-[12.5px] text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';
const INPUT = 'rounded-[9px] border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const FIELD = `w-full ${INPUT}`;
const PILL = 'inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold';
const NEUTRAL = 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const AMBER = 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const TONE = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  warn: AMBER,
  bad: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  muted: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};

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
const readPlan = (id) => capTableHolderApi.equityPlan(id);
const read409a = (id) => api.get409a(id);
const readCompare = (id) => api.getCapTableCompare(id);

function Block({ title, tag, aside, testId, children }) {
  return (
    <section className={CARD} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
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

function Tiles({ view }) {
  return (
    <div className="flex flex-col gap-2" data-testid="captable-pool-tiles">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        {view.tiles.map((t) => (
          <div key={t.label} className={`flex flex-col gap-0.5 rounded-xl px-3.5 py-3 ${t.missing ? 'border border-dashed border-axal-muted dark:border-gray-600' : 'border border-axal-hairline dark:border-gray-800'} bg-white dark:bg-gray-900`} data-testid={t.missing ? 'captable-pool-tile-missing' : 'captable-pool-tile'}>
            <span className={EYEBROW}>{t.label}</span>
            <span className={`text-[18px] font-extrabold ${t.missing ? MUTED : `${MONO} ${INK}`}`}>{t.value}</span>
            {t.sub ? <span className={`text-[11px] ${MUTED}`}>{t.sub}</span> : null}
          </div>
        ))}
      </div>
      {view.sourceLine ? <p className={`m-0 text-[11.5px] ${MUTED}`} data-testid="captable-pool-source">{view.sourceLine}</p> : null}
    </div>
  );
}

/** The burn-down as lines: granted solid, available lighter, exercised dashed when recorded, the target dotted. */
function BurnDown({ data }) {
  const W = 760; const H = 240; const L = 56; const T = 14; const B = 28; const R = 16;
  const pts = data.points;
  const n = pts.length;
  const top = Math.max(1, data.authorized ?? 0, data.target?.shares ?? 0, ...pts.map((p) => Math.max(p.granted, p.available ?? 0, p.exercised ?? 0)));
  const x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (H - T - B) - (v / top) * (H - T - B);
  const path = (k) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ');
  const ticks = [0, 0.5, 1].map((f) => Math.round(top * f));
  const step = Math.max(1, Math.ceil(n / 8));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={data.summary} data-testid="captable-pool-chart">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-axal-hairline dark:stroke-gray-800" />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" className="fill-axal-muted dark:fill-gray-400">{v.toLocaleString('en-US')}</text>
        </g>
      ))}
      {pts.map((p, i) => (i % step === 0 || i === n - 1 ? <text key={p.month} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" className="fill-axal-muted dark:fill-gray-400">{p.label.slice(0, 3)}</text> : null))}
      {pts.every((p) => p.available != null) ? <path d={path('available')} fill="none" strokeWidth="2" className="stroke-violet-300 dark:stroke-violet-700" data-testid="captable-pool-available" /> : null}
      <path d={path('granted')} fill="none" strokeWidth="2.5" className="stroke-axal-violet dark:stroke-violet-400" data-testid="captable-pool-granted" />
      {data.exercisesRecorded ? <path d={path('exercised')} fill="none" strokeWidth="1.5" strokeDasharray="5 4" className="stroke-axal-muted dark:stroke-gray-400" data-testid="captable-pool-exercised" /> : null}
      {data.target ? <line x1={L} x2={W - R} y1={y(data.target.shares)} y2={y(data.target.shares)} strokeWidth="2" strokeDasharray="2 4" className="stroke-axal-ink dark:stroke-gray-100" data-testid="captable-pool-target" /> : null}
    </svg>
  );
}

function Legend({ data }) {
  const item = (sw, t) => <span className={`flex items-center gap-1.5 text-[11.5px] ${MUTED}`}><span className={sw} aria-hidden="true" />{t}</span>;
  return (
    <div className="flex flex-wrap gap-3">
      {item('h-2.5 w-3 rounded-sm bg-axal-violet dark:bg-violet-400', 'Granted')}
      {item(`w-4 border-t-[1.5px] border-dashed ${data.exercisesRecorded ? 'border-axal-muted' : 'border-axal-hairline'}`, data.exercisesRecorded ? 'Exercised' : 'Exercised · not recorded')}
      {data.points.every((p) => p.available != null) ? item('h-2.5 w-3 rounded-sm bg-violet-300 dark:bg-violet-700', 'Available') : null}
      {data.target ? item('w-4 border-t-2 border-dotted border-axal-ink dark:border-gray-100', data.target.label) : null}
    </div>
  );
}

function ValuationDialog({ projectId, onClose, onDone }) {
  const write = useWrite(onDone);
  const [f, setF] = useState({ date: isoDay(), fmv: '', provider: '', method: '', preferred: '', notes: '' });
  const set = (k) => (e) => setF((d) => ({ ...d, [k]: e.target.value }));
  const go = () => {
    const out = valuationBody(f);
    if (!out.body) { write.setRefusal(out.sentence); return; }
    write.run(() => api.record409a(projectId, out.body));
  };
  const field = (k, label, props = {}) => <label className={`flex flex-col gap-1 ${EYEBROW}`}>{label}<input className={FIELD} value={f[k]} onChange={set(k)} aria-label={label} data-testid={`captable-409a-${k}`} {...props} /></label>;
  return (
    <CapTableDialog title="Record a valuation" sub="A 409A appraisal on file. Co-founders see it at once." onClose={onClose} action="Record the valuation" onAction={go} write={write} testId="captable-409a-valuation">
      {field('date', 'Valuation date', { type: 'date' })}
      {field('fmv', 'FMV per common share', { inputMode: 'decimal', placeholder: '$0.42' })}
      {field('provider', 'Provider', { maxLength: 200 })}
      <label className={`flex flex-col gap-1 ${EYEBROW}`}>Method
        <select className={FIELD} value={f.method} onChange={set('method')} aria-label="Method" data-testid="captable-409a-method">{METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
      </label>
      {field('preferred', 'Preferred price per share (optional)', { inputMode: 'decimal' })}
      {field('notes', 'Notes (optional)', { maxLength: 2000 })}
    </CapTableDialog>
  );
}

function EventDialog({ projectId, onClose, onDone }) {
  const write = useWrite(onDone);
  const [f, setF] = useState({ kind: '', date: isoDay(), note: '' });
  const set = (k) => (e) => setF((d) => ({ ...d, [k]: e.target.value }));
  const go = () => {
    const out = eventBody(f);
    if (!out.body) { write.setRefusal(out.sentence); return; }
    write.run(() => api.record409aEvent(projectId, out.body));
  };
  return (
    <CapTableDialog title="Record an event" sub="A material event after the valuation can end the safe harbour early." onClose={onClose} action="Record the event" onAction={go} write={write} testId="captable-409a-event">
      <label className={`flex flex-col gap-1 ${EYEBROW}`}>What happened
        <select className={FIELD} value={f.kind} onChange={set('kind')} aria-label="What happened" data-testid="captable-409a-kind">
          <option value="">Choose one</option>
          {EVENT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </label>
      <label className={`flex flex-col gap-1 ${EYEBROW}`}>Date<input type="date" className={FIELD} value={f.date} onChange={set('date')} aria-label="Date" data-testid="captable-409a-date" /></label>
      <label className={`flex flex-col gap-1 ${EYEBROW}`}>Note (optional)<input className={FIELD} value={f.note} onChange={set('note')} aria-label="Note" maxLength={2000} data-testid="captable-409a-note" /></label>
    </CapTableDialog>
  );
}

function Harbour({ projectId, read, retry, onChanged }) {
  const [open, setOpen] = useState(null);
  const h = read.status === 'ready' ? harbour(read.data) : null;
  const checks = read.status === 'ready' ? harbourChecks(read.data) : [];
  const done = () => { setOpen(null); onChanged(); };
  return (
    <Block title="409A safe harbour" testId="captable-409a">
      <State read={read} what="The 409A" claim="This is not a claim that none is on file." onRetry={retry} testId="captable-409a">
        {h ? (
          <div className="flex flex-col gap-2">
            <span className={`${PILL} ${TONE[harbourTone(h.state)]}`} data-testid="captable-409a-status">{h.reason}</span>
            <span className={`text-[13px] font-semibold ${INK}`}>FMV {h.fmv} per common share</span>
            <span className={`text-[11.5px] ${MUTED}`}>Provider {h.provider} · valued {h.valued} · valid until {h.expires}</span>
            <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="captable-409a-checks">
              {checks.map((c) => (
                <li key={c.key} className={`flex gap-2 text-[12.5px] ${c.fired ? 'font-semibold text-amber-800 dark:text-amber-300' : MUTED}`} data-testid={c.fired ? 'captable-409a-fired' : 'captable-409a-clear'}>
                  <span aria-hidden="true">{c.fired ? '!' : '○'}</span>{c.line}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={actionGhost} onClick={() => setOpen('valuation')} data-testid="captable-409a-record-valuation">Record a valuation</button>
              <button type="button" className={actionGhost} onClick={() => setOpen('event')} data-testid="captable-409a-record-event">Record an event</button>
            </div>
          </div>
        ) : <div data-testid="captable-409a-unreadable"><Unreadable what="The 409A" claim="This is not a claim that none is on file." onRetry={retry} /></div>}
      </State>
      {open === 'valuation' ? <ValuationDialog projectId={projectId} onClose={() => setOpen(null)} onDone={done} /> : null}
      {open === 'event' ? <EventDialog projectId={projectId} onClose={() => setOpen(null)} onDone={done} /> : null}
    </Block>
  );
}

function Grants({ plan, record, retry }) {
  const [f, setF] = useState({ q: '', role: '', sort: 'date' });
  const all = plan.status === 'ready' ? grantRows(plan.data, record.status === 'ready' ? record.data : null) || [] : [];
  const rows = filterGrants(all, f);
  const carta = plan.status === 'ready' && isCarta(plan.data);
  if (carta) {
    return (
      <Block title="Grants · with Carta connected" tag={<span className={`${PILL} ${NEUTRAL}`}>Carta · read only</span>} testId="captable-grants-carta">
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {all.map((g) => (
            <li key={g.key} className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-ground pb-2 last:border-b-0 dark:border-gray-800" data-testid="captable-grant-carta">
              <span className="flex flex-col"><span className={`text-[13px] font-semibold ${INK}`}>{g.holder} · {g.shares} options · strike {g.strike}</span><span className={`text-[11.5px] ${MUTED}`}>From Carta · read only</span></span>
              <a className={`${LINK} text-[12px]`} href={CARTA_URL} target="_blank" rel="noopener noreferrer">Edit in Carta</a>
            </li>
          ))}
        </ul>
        <p className={`m-0 mt-2 text-[11.5px] ${MUTED}`}>Carta is your record while connected. StudioOS shows it read only.</p>
      </Block>
    );
  }
  const select = (k, list, label) => (
    <select className={INPUT} value={f[k]} onChange={(e) => setF((d) => ({ ...d, [k]: e.target.value }))} aria-label={label} data-testid={`captable-grants-${k}`}>
      {list.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  return (
    <section className={CARD} data-testid="captable-grants">
      <div className="flex flex-wrap items-center gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
        <h2 className={`m-0 mr-auto text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>Grants</h2>
        <input className={`${INPUT} min-w-[150px]`} value={f.q} onChange={(e) => setF((d) => ({ ...d, q: e.target.value }))} placeholder="Search grants" aria-label="Search grants" data-testid="captable-grants-q" />
        {select('role', [{ value: '', label: 'Any role' }, { value: 'employee', label: 'Employee' }, { value: 'advisor', label: 'Advisor' }, { value: 'founder', label: 'Founder' }], 'Role')}
        {select('sort', GRANT_SORTS, 'Sort')}
      </div>
      <div className="px-4 py-3">
        <State read={plan} what="Grants and vesting" claim="This is not a claim that none are recorded." onRetry={retry} testId="captable-grants">
          {all.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-grants-none">No grant with vesting is recorded for this venture.</p>
            : rows.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-grants-filtered">No grant matches these filters.</p>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse" data-testid="captable-grants-table">
                    <thead><tr className="border-b border-axal-hairline dark:border-gray-800">{['Holder', 'Role', 'Shares', 'Strike', 'Grant date', 'Vesting', 'Vested', '83(b) or exercise', 'Document'].map((c) => <th key={c} className={TH}>{c}</th>)}</tr></thead>
                    <tbody>
                      {rows.map((g) => (
                        <tr key={g.key} className="border-b border-axal-ground last:border-b-0 dark:border-gray-800" data-testid="captable-grant">
                          <td className={`${TD} font-bold`}>{g.holder}</td>
                          <td className={TD}>{g.role}</td>
                          <td className={`${TD} ${MONO}`}>{g.shares}</td>
                          <td className={`${TD} ${MONO}`}>{g.strike}</td>
                          <td className={`${TD} ${MONO}`}>{g.grantDate}</td>
                          <td className={`${TD} text-[11.5px]`}>{g.vesting}</td>
                          <td className={`${TD} ${MONO}`}>{g.vested}</td>
                          <td className={`${TD} ${MUTED}`}>{g.exercise}</td>
                          <td className={TD}>{g.document ? <span className="text-[11.5px] text-axal-violet dark:text-violet-300">{g.document}</span> : <span className={`${PILL} ${AMBER}`}>! No document</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {vestedFoot(plan.data) ? <p className={`m-0 mt-2 text-[11.5px] ${MUTED}`} data-testid="captable-grants-foot">{vestedFoot(plan.data)}</p> : null}
                </div>
              )}
        </State>
      </div>
    </section>
  );
}

export default function OptionPoolTab({ projectId, reload, retry, search = '' }) {
  const record = useRead(readRecord, projectId, reload);
  const plan = useRead(readPlan, projectId, reload);
  const valuation = useRead(read409a, projectId, reload);
  const compare = useRead(readCompare, projectId, reload);
  const tiles = record.status === 'ready' ? poolTiles(record.data, plan.status === 'ready' ? plan.data : plan.status === 'loading' ? undefined : null) : null;
  const chart = record.status === 'ready' ? burnDown(record.data, compare.status === 'ready' ? compare.data : null, isoDay()) : null;
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2"><Tag kind="record" />{record.status === 'ready' ? <span className={`font-mono text-[11.5px] ${MUTED}`}>As of {isoDay()}</span> : null}</div>
      <State read={record} what="Your option pool" claim="This is not a claim that none is recorded." onRetry={retry} testId="captable-pool-record">
        {tiles ? <Tiles view={tiles} /> : null}
      </State>
      <Block title="Pool by month" tag={<Tag kind="record" />} testId="captable-pool-burn">
        <State read={record} what="The pool by month" claim="This is not a claim that nothing was granted." onRetry={retry} testId="captable-pool-burn">
          {!chart ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-pool-burn-none">No option pool is on the record, so there is nothing to draw by month.</p>
            : chart.empty ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-pool-burn-empty">{chart.empty}</p>
              : (
                <div className="flex flex-col gap-2">
                  <Legend data={chart} />
                  <BurnDown data={chart} />
                  {chart.foot ? <p className={`m-0 text-[11.5px] ${MUTED}`}>{chart.foot}</p> : null}
                  {compare.status === 'error' ? <p className={`m-0 text-[11.5px] ${MUTED}`} data-testid="captable-pool-target-unreadable">Your model could not be read, so its target pool is not drawn.</p> : null}
                </div>
              )}
        </State>
      </Block>
      <Harbour projectId={projectId} read={valuation} retry={retry} onChanged={retry} />
      <section className={`${CARD} flex flex-wrap items-center gap-3 px-4 py-3`} data-testid="captable-pool-topup">
        <span className="flex flex-1 flex-col"><span className={`text-[13px] font-semibold ${INK}`}>Need more room in the pool?</span><span className={`text-[11.5px] ${MUTED}`}>{TOP_UP_LINE}</span></span>
        <Link className={actionGhost} to={variantsHref(search)} data-testid="captable-pool-topup-go">Top up the pool</Link>
      </section>
      <Grants plan={plan} record={record} retry={retry} />
    </div>
  );
}
