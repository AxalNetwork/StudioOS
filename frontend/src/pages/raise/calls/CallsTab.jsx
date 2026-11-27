/**
 * D1221 (#2458), D1223 (#3222) — the Calls tab of Capital relationships, to
 * the owner's canvas: switched off (CLS1), the list (CLS2), empty (CLS3),
 * loading and errors (CLS12) and the phone at 390 (CLS15).
 *
 * Two reads, each failing alone: the calls (`parts.calls`, the module read
 * CapRelTool makes) and readiness (`GET /api/round-calls/readiness`, D1222,
 * answered whether calls are on or off). One failed read never blanks the
 * page. Each sent call opens at `/raise/capital-relationships/calls/:uid`
 * (CLS8). A call's amounts are Indicated, never committed.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Unreadable } from '../../../ui';
import { roundCallsApi } from '../../../lib/api/roundCalls';
import { callDate, moneyCents } from '../../founder/roundCallParts';
import {
  HOW, INDICATED_NOTE, MEANWHILE, OFF_LINE, OFF_TITLE, READINESS_NOTE, WHAT_A_CALL_IS, WHY_OFF,
  callsState, newCallState, notDeliveredLine, openStrip, readinessView,
} from './callsModel';

const CARD = 'flex min-w-0 flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const MUTED = 'text-axal-muted dark:text-gray-400';
const H3 = 'm-0 text-[15px] font-bold text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';
const NOT_SENT = <span className={`text-[12px] ${MUTED}`} title="Not sent">—</span>;

/** A count, or the dash a call that has not been sent shows; never a 0 the read did not return. */
const num = (v, sent) => (v == null ? (sent ? <span className={`text-[12px] ${MUTED}`}>Not recorded</span> : NOT_SENT) : <span className={MONO}>{v}</span>);

const PILL = {
  Open: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  'Awaiting counsel': 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  Expired: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
};
function StatePill({ state }) {
  return <span className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${PILL[state] || 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}>{state}</span>;
}

/** The readiness read: given (a test), or read for the venture, with Try again. */
function useReadiness(projectId, given, load) {
  const [read, setRead] = useState(given ? { status: 'ready', data: given } : { status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (given || !projectId) return undefined;
    let alive = true;
    setRead({ status: 'loading', data: null });
    Promise.resolve().then(() => load(projectId))
      .then((data) => { if (alive) setRead({ status: 'ready', data }); })
      .catch(() => { if (alive) setRead({ status: 'unreadable', data: null }); });
    return () => { alive = false; };
  }, [projectId, given, load, tick]);
  return { ...read, retry: () => setTick((n) => n + 1) };
}

function NewCall({ state }) {
  if (state.enabled) return <Link to="/raise/call" className="inline-flex min-h-[44px] w-fit items-center rounded-lg bg-violet-600 px-3 text-[13px] font-bold text-white sm:min-h-[36px]" data-testid="calls-new">New call</Link>;
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      <span id="calls-new-reason" className={`text-[12.5px] ${MUTED}`} data-testid="calls-new-reason">{state.reason}</span>
      <button type="button" disabled aria-describedby="calls-new-reason" className="min-h-[44px] w-fit rounded-lg bg-gray-200 px-3 text-[13px] font-bold text-gray-500 sm:min-h-[36px] dark:bg-gray-800 dark:text-gray-400" data-testid="calls-new">New call</button>
    </span>
  );
}

/** CLS1's "Get ready" and CLS2's "Readiness for the next call": each item, ready or missing, opening its tool. */
function Readiness({ view, retry, title, compact = false }) {
  return (
    <section className={CARD} data-testid="calls-readiness" aria-busy={view.status === 'loading'}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className={H3}>{title}</h3>
        {view.summary && <span className={`${MONO} text-[12px] ${MUTED}`} data-testid="calls-readiness-count">{view.summary}</span>}
      </div>
      {view.status === 'loading' && <div className="flex flex-col gap-2" data-testid="calls-readiness-loading">{[0, 1, 2].map((i) => <div key={i} className="h-5 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />)}</div>}
      {view.status === 'unreadable' && <div data-testid="calls-readiness-unreadable"><Unreadable what="Whether each item is ready" claim="This is not a claim that any is missing." onRetry={retry} /></div>}
      {view.status === 'ready' && (
        <ul className="m-0 flex list-none flex-col p-0">
          {view.items.map((i) => (
            <li key={i.key} className="grid min-h-[44px] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-t border-axal-hairline py-2 dark:border-gray-800" data-testid={`calls-ready-${i.key}`}>
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{i.label}</span>
                {!compact && i.reason && <span className={`hidden text-[12px] sm:block ${MUTED}`}>{i.reason}</span>}
              </span>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${i.state === 'ready'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                : i.state === 'missing' ? 'border-dashed border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-200'
                  : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`} data-testid={`calls-ready-state-${i.key}`}>{i.word}</span>
              {i.href ? <Link to={i.href} aria-label={`Open ${i.tool}`} className="text-[12.5px] font-semibold text-violet-700 dark:text-violet-300" data-testid={`calls-ready-open-${i.key}`}>Open</Link> : <span />}
            </li>
          ))}
        </ul>
      )}
      <p className={`m-0 text-[12px] ${MUTED}`}>{READINESS_NOTE}</p>
    </section>
  );
}

function HowSteps({ row }) {
  if (row) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="calls-how">
        {HOW.map((h, i) => (
          <div key={h} className={CARD}>
            <span className={`${MONO} text-[11.5px] ${MUTED}`}>Step {i + 1}</span>
            <span className="text-[13.5px] font-bold text-axal-ink dark:text-gray-100">{h}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <section className={CARD} data-testid="calls-how">
      <h3 className={H3}>How a call works</h3>
      <ol className="m-0 flex list-none flex-col p-0">{HOW.map((h, i) => <li key={h} className="border-t border-axal-hairline py-2 text-[12.5px] font-semibold dark:border-gray-800">{i + 1}. {h}</li>)}</ol>
    </section>
  );
}

function Tile({ label, value, sub, pct, testId }) {
  return (
    <div className={CARD} data-testid={testId}>
      <span className={`text-[10.5px] font-extrabold uppercase tracking-wider ${MUTED}`}>{label}</span>
      <span className={`${MONO} text-[20px] font-bold text-axal-ink dark:text-gray-100`}>{value}</span>
      {sub && <span className={`text-[12px] ${MUTED}`}>{sub}</span>}
      {pct != null && <div role="img" aria-label={`${pct} percent of the target indicated`} className="h-1.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-800"><span className="block h-full rounded bg-violet-600" style={{ width: `${pct}%` }} /></div>}
    </div>
  );
}

/** CLS2's strip for the open call. A figure the read did not return reads "Not recorded". */
function Strip({ s }) {
  const nr = 'Not recorded';
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="calls-strip">
      <Tile testId="calls-strip-call" label="Open call" value={<span className="font-sans text-[17px]">{s.name}</span>} sub={s.sent ? `sent ${callDate(s.sent)}` : null} />
      <Tile testId="calls-strip-indicated" label="Indicated" value={s.indicatedCents == null ? nr : moneyCents(s.indicatedCents)} sub={s.targetCents == null ? 'target not recorded' : `of ${moneyCents(s.targetCents)} · indicative`} pct={s.pct} />
      <Tile testId="calls-strip-responses" label="Responses" value={s.responses ?? nr} sub="recipients went past opening" />
      <Tile testId="calls-strip-questions" label="Questions waiting" value={s.unanswered ?? nr} />
      <Tile testId="calls-strip-closes" label="Closes in" value={s.closesIn ?? nr} sub={s.close ? callDate(s.close) : null} />
    </div>
  );
}

/** CLS2's table on a wide screen; cards on a phone (CLS15). */
function CallsList({ rows }) {
  const line = notDeliveredLine(rows);
  return (
    <section className={`${CARD} p-0`} data-testid="calls-list">
      <div className="flex flex-wrap items-baseline gap-2 px-4 pt-4">
        <h3 className={H3}>Calls</h3>
        <span className={`${MONO} text-[12px] ${MUTED}`}>{rows.length}</span>
        <span className="flex-1" />
        <span className={`text-[12px] ${MUTED}`}>Newest first. A draft opens in the new-call sheet.</span>
      </div>
      {line && <p className="m-0 px-4 text-[12.5px] text-amber-800 dark:text-amber-200" data-testid="calls-not-delivered">{line}</p>}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className={`text-[11px] uppercase ${MUTED}`}>
              {['Call', 'State', 'Sent', 'Closes', 'Recipients', 'Opened', 'Data room', 'Indicated', 'Questions waiting'].map((h) => <th key={h} className="px-3 py-2 font-semibold first:pl-4">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.uid} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`calls-row-${r.uid}`}>
                <td className="px-3 py-2 pl-4">
                  <Link to={r.href} className="font-bold text-axal-ink underline dark:text-gray-100">{r.name}</Link>
                  <span className={`block text-[11.5px] ${MUTED}`}>target {r.targetCents == null ? 'not recorded' : moneyCents(r.targetCents)}</span>
                </td>
                <td className="px-3 py-2"><StatePill state={r.state} /></td>
                <td className={`px-3 py-2 ${MONO} text-[12px]`}>{r.sent ? callDate(r.sent) : <span className={MUTED}>Not sent</span>}</td>
                <td className={`px-3 py-2 ${MONO} text-[12px]`}>{r.close ? callDate(r.close) : <span className={MUTED}>Not recorded</span>}</td>
                <td className="px-3 py-2">
                  {num(r.recipients, r.sent)}
                  {r.notDelivered > 0 && <span className="block text-[11.5px] font-semibold text-amber-800 dark:text-amber-200" data-testid={`calls-row-not-delivered-${r.uid}`}>{r.notDelivered} not delivered</span>}
                </td>
                <td className="px-3 py-2">{num(r.opened, r.sent)}</td>
                <td className="px-3 py-2">{num(r.dataRoom, r.sent)}</td>
                <td className="px-3 py-2">{r.indicatedCents == null ? num(null, r.sent) : <span className={MONO}>{moneyCents(r.indicatedCents)}</span>}</td>
                <td className="px-3 py-2">{num(r.unanswered, r.sent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-4 pt-0 md:hidden" data-testid="calls-cards">
        {rows.map((r) => (
          <li key={r.uid} className="rounded-xl border border-axal-hairline p-3 dark:border-gray-800" data-testid={`calls-card-${r.uid}`}>
            <div className="flex min-h-[44px] items-center gap-2">
              <Link to={r.href} className="flex-1 text-[14px] font-bold text-axal-ink dark:text-gray-100">{r.name}</Link>
              <StatePill state={r.state} />
            </div>
            <p className={`m-0 text-[12px] ${MUTED}`}>
              {r.sent
                ? `${r.indicatedCents == null ? 'Indicated not recorded' : `${moneyCents(r.indicatedCents)} indicated`} of ${r.targetCents == null ? 'a target not recorded' : moneyCents(r.targetCents)} · ${r.responded != null && r.recipients != null ? `${r.responded} of ${r.recipients} went past opening` : 'responses not recorded'}${r.notDelivered > 0 ? ` · ${r.notDelivered} not delivered` : ''}`
                : `Target ${r.targetCents == null ? 'not recorded' : moneyCents(r.targetCents)} · not sent`}
            </p>
          </li>
        ))}
      </ul>
      <p className={`m-0 px-4 pb-4 text-[12px] ${MUTED}`}>{INDICATED_NOTE}</p>
    </section>
  );
}

/** CLS12: the calls being read. */
function Loading() {
  return (
    <section className={CARD} data-testid="calls-loading" aria-busy="true">
      <div className="flex items-center gap-2"><h3 className={H3}>Calls</h3><span className={`text-[12px] ${MUTED}`}>Reading…</span></div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_80px_60px] items-center gap-3 border-t border-axal-hairline py-3 dark:border-gray-800">
          <span className="h-3 w-[70%] animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
          <span className="h-5 animate-pulse rounded-full bg-gray-100 dark:bg-gray-800" />
          <span className="h-3 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
        </div>
      ))}
    </section>
  );
}

/** CLS12: the calls could not be read. New call stays off; readiness still draws. */
function ReadFailed({ onRetry }) {
  return (
    <section className={CARD} data-testid="calls-unreadable">
      <Unreadable what="The calls" claim="This is not a claim that there are none." onRetry={onRetry} />
      <p className={`m-0 text-[12px] ${MUTED}`}>New call stays off until the calls can be read.</p>
    </section>
  );
}

export default function CallsTab({ calls, status = 'ready', onRetry, projectId = null, readiness = null, loadReadiness = roundCallsApi.readiness, today }) {
  const st = status === 'ready' ? callsState(calls) : { kind: status === 'loading' ? 'loading' : 'unreadable', rows: [] };
  const newCall = newCallState(st, status);
  const ready = useReadiness(projectId, readiness, loadReadiness);
  const view = readinessView(ready, projectId);
  const strip = st.kind === 'list' ? openStrip(st.rows, today) : null;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="calls-page">
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-[20px] font-extrabold text-axal-ink sm:text-[24px] dark:text-gray-100">Calls for Capital</h2>
          <NewCall state={newCall} />
        </div>
        <p className={`m-0 text-[13px] ${MUTED}`}>{WHAT_A_CALL_IS}</p>
      </section>

      {st.kind === 'loading' && <Loading />}
      {st.kind === 'unreadable' && <ReadFailed onRetry={onRetry} />}

      {st.kind === 'off' && (
        <>
          <section className="flex flex-col gap-1.5 rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-900 dark:bg-violet-950/40" data-testid="calls-off">
            <h3 className="m-0 text-[16px] font-extrabold text-axal-ink dark:text-gray-100">{OFF_TITLE}</h3>
            <p className="m-0 text-[13px] text-axal-ink dark:text-gray-200">{OFF_LINE}</p>
            <p className={`m-0 text-[12px] ${MUTED}`}>{WHY_OFF}</p>
          </section>
          <div className="flex flex-col gap-2">
            <span className={`text-[10.5px] font-extrabold uppercase tracking-wider ${MUTED}`}>What a call does</span>
            <HowSteps row />
          </div>
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Readiness view={view} retry={ready.retry} title="Get ready" />
            <section className={CARD} data-testid="calls-meanwhile">
              <h3 className={H3}>Meanwhile</h3>
              <p className="m-0 text-[13px]">{MEANWHILE}</p>
              <Link to="/raise/capital-relationships/pipeline" className="text-[13px] font-semibold text-violet-700 dark:text-violet-300">Open Pipeline ›</Link>
            </section>
          </div>
        </>
      )}

      {st.kind === 'empty' && (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className={`${CARD} gap-3 p-6`} data-testid="calls-empty">
            <h3 className="m-0 text-[17px] font-extrabold text-axal-ink dark:text-gray-100">No call for capital yet.</h3>
            <p className="m-0 text-[13px]">A call invites verified investors to read your round and respond.</p>
            {newCall.enabled && <Link to="/raise/call" className="w-fit rounded-lg border border-axal-hairline px-3 py-1.5 text-[13px] font-semibold dark:border-gray-700" data-testid="calls-empty-new">New call</Link>}
          </section>
          <Readiness view={view} retry={ready.retry} title="Get ready" />
        </div>
      )}

      {st.kind === 'list' && (
        <>
          {strip && <Strip s={strip} />}
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <CallsList rows={st.rows} />
            <div className="flex flex-col gap-4">
              <Readiness view={view} retry={ready.retry} title="Readiness for the next call" compact />
              <HowSteps />
            </div>
          </div>
        </>
      )}

      {st.kind === 'unreadable' && <Readiness view={view} retry={ready.retry} title="Get ready" />}
    </div>
  );
}
