/**
 * D1060 (#2930) — the Reporting desk's blocks over part 2's `GET /desk`
 * (RPT1, RPT2, RPT7, RPT8, RPT14, RPT15): Due next, Needs you, the
 * twelve-month calendar (arrow keys move between cells; View as table lists
 * the same periods), and Duties with its drawer. They read nothing
 * themselves: `ReportingDesk.jsx` hands each the desk and the writes.
 *
 * D1062 (#2932) — at phone width (RPT20a) the calendar is a vertical list of
 * periods with their state pills, each row a 44px button, and the page's
 * primary moves to a bar pinned above the tab bar (`PinnedBar`).
 */
import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Sheet from '../../../ui/Sheet.jsx';
import {
  CADENCE_WORDS, CALENDAR_LINE, DUTY_GROUPS, DUTY_STATES, NEEDS_YOU_LINE, calendarRows, calendarTable, cellWords, documentsLine,
  dueNext, dueRuleWords, dutyRows, moveCell, needsYou, recordLine, recordStrip, requiredFigures, requiredFiguresLine, selectedPanel,
  sourceWords, stateWord, toneOf,
} from './deskModel.js';

export const CARD = 'flex min-w-0 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900';
export const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100';
export const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const CHIP = 'inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-bold';
const BTN = 'inline-flex min-h-11 w-fit items-center lg:min-h-0 rounded-[9px] bg-axal-violet px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-60 dark:hover:bg-violet-500';
const GHOST = 'inline-flex min-h-11 w-fit items-center lg:min-h-0 rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-bold text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const LINK = 'inline-flex min-h-11 w-fit items-center bg-transparent p-0 lg:min-h-0 text-[12.5px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const SELECT = 'rounded-[9px] border border-axal-hairline bg-white px-2 py-1.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

/**
 * D1062: the phone's pinned bottom bar (the canvas's `pbar`): above the
 * phone tab bar while one is drawn (`--mobile-tabbar-h`), never under it.
 */
export function PinnedBar({ children, testId }) {
  return (
    <div className="sticky bottom-[var(--mobile-tabbar-h,0px)] z-10 flex gap-2 border-t border-axal-hairline bg-white px-[14px] py-[10px] dark:border-gray-800 dark:bg-gray-950" data-testid={testId}>
      {children}
    </div>
  );
}

/** D1062: a phone bar's buttons share its width, each at least 44px tall. */
export const BAR_PRIMARY = 'inline-flex min-h-11 flex-1 items-center justify-center rounded-[9px] bg-axal-violet px-3 text-[13px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-60 dark:hover:bg-violet-500';
export const BAR_GHOST = 'inline-flex min-h-11 flex-1 items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3 text-[13px] font-bold text-axal-ink hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

export const StateChip = ({ period, testId }) => <span className={`${CHIP} ${toneOf(period)}`} data-testid={testId}>{stateWord(period)}</span>;

/** RPT1 Due next: the next window, what it meets for whom, and readiness, which only the report's own read can give. */
export function DueNext({ desk, canWrite, onPrepare, busy, phone = false }) {
  const next = dueNext(desk);
  if (!next) {
    return (
      <section className={CARD} data-testid="reporting-due-next">
        <span className={EYE}>Due next</span>
        <p className={MUTED} data-testid="reporting-due-next-none">No period is open. Each one opens on its own when its duty comes round.</p>
      </section>
    );
  }
  return (
    <section className={CARD} data-testid="reporting-due-next">
      <span className={EYE}>Due next</span>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={H2}>{next.label} · due {next.due || 'not recorded'}</h2>
        <StateChip period={next.period} testId="reporting-due-next-state" />
      </div>
      <p className={MUTED}>{next.investors === 1 ? '1 investor' : `${next.investors} investors`}</p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {next.groups.map((g) => <li key={g.title} className="text-[13px] text-axal-ink dark:text-gray-100"><b>{g.title}</b> · {g.holders}</li>)}
      </ul>
      <p className={MUTED} data-testid="reporting-readiness">Readiness is read when the report is prepared: Prepare reads each figure from your Grow modules with its source, and says which required figures are not recorded. Nothing is sent until you press Send.</p>
      {canWrite && !phone && <button type="button" className={BTN} onClick={() => onPrepare(next.period)} disabled={busy} data-testid="reporting-due-next-prepare">{busy ? 'Preparing…' : `Prepare ${next.label} report`}</button>}
    </section>
  );
}

/** RPT1 Needs you: late and missing periods, then investors' asks. The founders only. */
export function NeedsYou({ desk, onPrepare, onExpect, busy }) {
  const rows = needsYou(desk);
  return (
    <section className={CARD} data-testid="reporting-needs-you">
      <div className="flex items-center gap-2"><h2 className={H2}>Needs you</h2><span className={`${CHIP} border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400`}>{rows.length}</span></div>
      {rows.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-col gap-1 rounded-lg border border-axal-hairline p-2.5 dark:border-gray-800" data-testid={`reporting-needs-${r.kind}`}>
              <span className={`${CHIP} ${r.kind === 'ask' ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-200' : toneOf(r.period)}`}>{r.word}</span>
              <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{r.line}</p>
              {r.expected && <p className={MUTED}>{r.expected}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={GHOST} onClick={() => onPrepare(r.period)} disabled={busy}>Prepare it</button>
                {r.kind === 'late' && <button type="button" className={GHOST} onClick={() => onExpect(r.period)} aria-haspopup="dialog" data-testid="reporting-needs-expect">Give an expected date</button>}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className={MUTED} data-testid="reporting-needs-none">Nothing is late and no investor has asked.</p>}
      <p className={MUTED}>{NEEDS_YOU_LINE}</p>
    </section>
  );
}

/**
 * RPT1, RPT7 the calendar: one row per duty, twelve months. The grid holds
 * one tab stop; arrow keys, Home and End move it, and Enter or a press
 * selects a period. View as table lists every period by due date.
 */
export function Calendar({ desk, canWrite, onPrepare, onExpect, busy, phone = false }) {
  const { months, rows } = useMemo(() => calendarRows(desk), [desk]);
  const [at, setAt] = useState([0, 5]);
  const [selected, setSelected] = useState(null);
  const [asTable, setAsTable] = useState(false);
  const cells = useRef(new Map());
  const focus = (next) => { setAt(next); cells.current.get(`${next[0]}:${next[1]}`)?.focus?.(); };
  const onKey = (e) => {
    const next = moveCell(at, e.key, rows.length, months.length);
    if (next) { e.preventDefault(); focus(next); }
  };
  const panel = selectedPanel(selected, canWrite);
  const panelBlock = panel && (
    <div className="flex flex-col gap-1.5 rounded-lg border border-axal-hairline p-3 dark:border-gray-800" data-testid="reporting-selected">
      <span className={EYE}>Selected period</span>
      <p className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">{panel.title}</p>
      <StateChip period={selected} />
      {panel.lines.map((l) => <p key={l} className={MUTED}>{l}</p>)}
      {(panel.prepare || panel.expect) && (
        <div className="flex flex-wrap gap-2">
          {panel.prepare && <button type="button" className={BTN} onClick={() => onPrepare(selected)} disabled={busy} data-testid="reporting-selected-prepare">Prepare it</button>}
          {panel.expect && <button type="button" className={GHOST} onClick={() => onExpect(selected)} aria-haspopup="dialog" data-testid="reporting-selected-expect">Give an expected date</button>}
        </div>
      )}
    </div>
  );
  // RPT20a: on a phone the twelve columns do not fit; the periods are a list, latest due first, each a button.
  if (phone) {
    const list = calendarTable(desk);
    return (
      <section className={CARD} data-testid="reporting-periods">
        <h2 className={H2}>Periods</h2>
        {list.length ? (
          <ul className="m-0 flex list-none flex-col p-0" aria-label="Periods">
            {list.map((r) => (
              <li key={r.key} className="border-t border-axal-hairline first:border-t-0 dark:border-gray-800">
                <button type="button" onClick={() => setSelected(r.period)} aria-pressed={selected?.uid === r.period.uid}
                  className="flex min-h-11 w-full items-center justify-between gap-3 bg-transparent py-2 text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-axal-violet dark:hover:bg-gray-800"
                  data-testid={`reporting-period-${r.key}`}>
                  <span className="flex min-w-0 flex-col">
                    <b className="text-[13px] text-axal-ink dark:text-gray-100">{r.label} · {r.title}</b>
                    <span className="text-[12px] text-axal-muted dark:text-gray-400">{r.holder} · due {r.due || 'not recorded'}</span>
                  </span>
                  <span className={`${CHIP} shrink-0 ${toneOf(r.period)}`}>{r.word}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className={MUTED}>No period has opened yet.</p>}
        {panelBlock}
      </section>
    );
  }
  return (
    <section className={CARD} data-testid="reporting-calendar">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={H2}>Calendar</h2>
        <button type="button" className={LINK} onClick={() => setAsTable((v) => !v)} aria-pressed={asTable} data-testid="reporting-calendar-toggle">{asTable ? 'View as calendar' : 'View as table'}</button>
      </div>
      {!rows.length ? <p className={MUTED}>No duty to draw.</p> : asTable ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[12.5px]" data-testid="reporting-calendar-table">
            <thead><tr className={EYE}><th className="py-1.5 pr-3">Investor</th><th className="pr-3">Duty</th><th className="pr-3">Period</th><th className="pr-3">Due</th><th>State</th></tr></thead>
            <tbody>
              {calendarTable(desk).map((r) => (
                <tr key={r.key} className="border-t border-axal-hairline dark:border-gray-800">
                  <td className="py-1.5 pr-3">{r.holder}</td><td className="pr-3">{r.title}</td><td className="pr-3">{r.label}</td><td className="pr-3">{r.due || 'Not recorded'}</td>
                  <td><button type="button" className={`${CHIP} ${toneOf(r.period)}`} onClick={() => setSelected(r.period)}>{r.word}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table role="grid" aria-label="Reporting calendar" className="w-full min-w-[960px] border-collapse text-[11.5px]" onKeyDown={onKey} data-testid="reporting-calendar-grid">
            <thead>
              <tr role="row">
                <th role="columnheader" className={`${EYE} w-[180px] py-1.5 text-left`}>Duty</th>
                {months.map((m) => <th role="columnheader" key={m.key} className={`${EYE} py-1.5 text-left ${m.today ? 'border-l-2 border-axal-violet text-axal-violet dark:border-violet-400 dark:text-violet-300' : ''}`}>{m.label}{m.today ? ' · Today' : ''}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr role="row" key={r.duty.uid} className="border-t border-axal-hairline align-top dark:border-gray-800">
                  <th role="rowheader" className="py-1.5 pr-2 text-left"><b className="block text-axal-ink dark:text-gray-100">{r.holder}</b><span className="text-axal-muted dark:text-gray-400">{r.title}</span></th>
                  {months.map((m, ci) => {
                    const ps = r.cells[m.key];
                    const here = at[0] === ri && at[1] === ci;
                    return (
                      <td role="gridcell" key={m.key} className={`py-1 pr-1 ${m.today ? 'border-l-2 border-axal-violet dark:border-violet-400' : ''}`}>
                        <button type="button" tabIndex={here ? 0 : -1} ref={(n) => { if (n) cells.current.set(`${ri}:${ci}`, n); }}
                          onFocus={() => setAt([ri, ci])} onClick={() => ps[0] && setSelected(ps[0])}
                          aria-label={ps.length ? ps.map((p) => `${cellWords(p).title}: ${cellWords(p).word}`).join('; ') : `${r.holder} ${r.title} · ${m.label} · nothing due`}
                          className={`flex min-h-[34px] w-full flex-col items-start gap-0.5 rounded-md border px-1.5 py-1 text-left ${ps.length ? toneOf(ps[0]) : 'border-transparent bg-transparent text-transparent'} focus:outline-none focus:ring-2 focus:ring-axal-violet`}
                          data-testid={`reporting-cell-${ri}-${ci}`}>
                          {ps.map((p) => {
                            const w = cellWords(p);
                            return <span key={p.uid} className="flex flex-col" title={w.title}><span className="font-bold">{w.word}</span>{w.expected && <span>{w.expected}</span>}</span>;
                          })}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={MUTED} data-testid="reporting-calendar-line">{CALENDAR_LINE(desk?.today)} Arrow keys move between months and duties.</p>
      {panelBlock}
    </section>
  );
}

/** RPT2 Duties: one row per duty, searched, filtered and grouped. A row opens the duty (RPT8). */
export function DutiesTable({ desk, onOpen }) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('holder');
  const [kind, setKind] = useState('');
  const [cadence, setCadence] = useState('');
  const [state, setState] = useState('');
  const groups = dutyRows(desk, { q, kind, cadence, state, group });
  const kinds = [...new Map((desk?.duties || []).map((d) => [d.kind, d.title])).entries()];
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <section className={CARD} data-testid="reporting-duties-table">
      <h2 className={H2}>Duties</h2>
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search duties" aria-label="Search duties" className={`${SELECT} min-w-[180px]`} data-testid="reporting-duties-search" />
        {DUTY_GROUPS.map((g) => (
          <button key={g.id} type="button" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}
            className={`rounded-full border px-2.5 py-1 text-[12px] font-bold ${group === g.id ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-200' : 'border-axal-hairline text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-100'}`}
            data-testid={`reporting-duties-group-${g.id}`}>{g.label}</button>
        ))}
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind" className={SELECT} data-testid="reporting-duties-kind">
          <option value="">Any kind</option>{kinds.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select>
        <select value={cadence} onChange={(e) => setCadence(e.target.value)} aria-label="Cadence" className={SELECT} data-testid="reporting-duties-cadence">
          <option value="">Any cadence</option>{Object.entries(CADENCE_WORDS).map(([k, w]) => <option key={k} value={k}>{w}</option>)}
        </select>
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label="State" className={SELECT} data-testid="reporting-duties-state">
          {DUTY_STATES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      {count ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left text-[12.5px]">
            <thead><tr className={EYE}><th className="py-1.5 pr-3">Investor</th><th className="pr-3">Kind</th><th className="pr-3">Cadence</th><th className="pr-3">Due rule</th><th className="pr-3">Required figures</th><th className="pr-3">Documents</th><th className="pr-3">Source</th><th>Record</th></tr></thead>
            {groups.map((g) => (
              <tbody key={g.label} data-testid="reporting-duties-group">
                <tr><th colSpan={8} className={`${EYE} pt-3 text-left`}>{g.label}</th></tr>
                {g.items.map((r) => {
                  const s = sourceWords(r.duty);
                  return (
                    <tr key={r.duty.uid} className="cursor-pointer border-t border-axal-hairline hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800" onClick={() => onOpen(r.duty)} data-testid="reporting-duty-row">
                      <td className="py-2 pr-3"><button type="button" className={LINK} onClick={(e) => { e.stopPropagation(); onOpen(r.duty); }} aria-haspopup="dialog">{r.holder}</button></td>
                      <td className="pr-3">{r.duty.title}</td>
                      <td className="pr-3">{CADENCE_WORDS[r.duty.cadence] || r.duty.cadence}</td>
                      <td className="pr-3">{dueRuleWords(r.duty)}</td>
                      <td className="pr-3">{requiredFiguresLine(r.duty)}</td>
                      <td className="pr-3">{documentsLine(r.duty)}</td>
                      <td className="pr-3">{s.word} · {s.clause}</td>
                      <td>{r.duty.record ? recordLine(r.duty.record) : 'Not recorded'}{r.next ? <span className="block text-axal-muted dark:text-gray-400">Next: {r.next.label} · {stateWord(r.next)}</span> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      ) : <p className={MUTED} data-testid="reporting-duties-nomatch">No duty matches. Clear the search or a filter.</p>}
      <p className={MUTED}>A row opens the duty.</p>
    </section>
  );
}

/** RPT8 the duty drawer (the shared Sheet, D1317): its clause, its terms and its record. Terms change only by amending the document in Raise. */
export function DutyDrawer({ desk, duty, onClose, raiseHref }) {
  const s = sourceWords(duty);
  const strip = recordStrip(desk, duty.uid);
  const req = requiredFigures(duty);
  return (
    <Sheet label="Duty" eyebrow="Duty" title={`${duty.title} to ${duty.holder?.name || 'a holder not named'}`} onClose={onClose} width={640} testId="reporting-duty-drawer"
      footer={<div className="flex justify-end"><button type="button" className={GHOST} onClick={onClose}>Close</button></div>}>
      <div className="flex flex-col gap-3 text-[13px]">
        <span className={`${CHIP} ${s.signed ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`} data-testid="reporting-duty-source">{s.word}</span>
        <div className="flex flex-col gap-1">
          <span className={EYE}>The clause</span>
          <blockquote className="m-0 border-l-2 border-axal-violet pl-3 text-axal-ink dark:border-violet-400 dark:text-gray-100" data-testid="reporting-duty-clause">{s.clause}</blockquote>
          <p className={MUTED}>The clause’s own words stay in the signed document; the duty keeps where they are{duty.source?.body_sha256 ? ' and the signed text’s fingerprint' : ''}. <Link className={LINK} to={raiseHref} data-testid="reporting-duty-raise">Open the documents in Raise</Link></p>
          {s.defaulted && <p className={MUTED} data-testid="reporting-duty-defaulted">{s.defaulted}</p>}
        </div>
        <dl className="m-0 grid grid-cols-[160px_1fr] gap-x-3 gap-y-1.5">
          <dt className={EYE}>Cadence</dt><dd className="m-0">{CADENCE_WORDS[duty.cadence] || duty.cadence}</dd>
          <dt className={EYE}>Due rule</dt><dd className="m-0">{dueRuleWords(duty)}</dd>
          <dt className={EYE}>Required figures</dt><dd className="m-0" data-testid="reporting-duty-figures">{req.labels.length ? req.labels.join(' · ') : 'None'}{req.from === 'kpi_rules' ? ' · the studio’s KPI rules, as the document names none' : ''}</dd>
          <dt className={EYE}>Required documents</dt><dd className="m-0">{documentsLine(duty)}</dd>
          <dt className={EYE}>Holder</dt><dd className="m-0">{duty.holder?.name || 'Not named'}</dd>
          <dt className={EYE}>Starts</dt><dd className="m-0">{duty.starts_on || 'Not recorded'}</dd>
        </dl>
        <div className="flex flex-col gap-1.5">
          <span className={EYE}>Record</span>
          {strip.length ? (
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" data-testid="reporting-duty-strip">
              {strip.map((p) => <li key={p.key} className={`${CHIP} ${toneOf(p)}`}>{p.label} · {p.word}</li>)}
            </ul>
          ) : <p className={MUTED}>No period has opened yet.</p>}
          <p className={MUTED} data-testid="reporting-duty-record">{duty.record ? recordLine(duty.record) : 'Not recorded'}</p>
        </div>
        <p className={MUTED}>Amend the document in Raise to change these terms.</p>
      </div>
    </Sheet>
  );
}
