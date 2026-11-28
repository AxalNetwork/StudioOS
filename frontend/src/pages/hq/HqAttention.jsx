/**
 * D8727 (#8727) — HQ home's first section, "What needs my attention?": the
 * escalation card over its own read, and the other signals from the overview.
 *
 * TWO READS, TWO STATES. Until D8727 the escalation zone was drawn from the
 * overview with one branch for "not loaded yet" and "could not be read", so a
 * pending read said "Escalations could not be read" and then settled to
 * "Nothing is waiting on HQ". `useEscalationRead` reads the board on its own
 * (`GET /api/admin/escalations?status=open`, the route HQ Support's Queue
 * reads), and the card draws Reading, the rows, All clear or Unavailable from
 * that read alone; its Try again reads only this card again. Slow is shown at
 * 8 s, and a read with no answer at 20 s counts as failed. `api.escalations`
 * takes no abort signal, so a late answer is ignored rather than cancelled.
 *
 * Each row and "Answer on Support" open HQ Support's Queue, where Review opens
 * the existing decision sheet (D205, D5034). Nothing is answered from Home.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, ChevronRight, Clock, Loader2, RotateCw } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { StateChip } from '../../ui';
import {
  ANNOUNCE, ESCALATIONS_DEADLINE_MS, ESCALATIONS_SLOW_MS, READING, clockUtc, dueDistance, escalationCount,
  escalationOutcome, kindLabel, retrySucceeded, stampLabel,
} from './hqHomeModel.js';

const CHIP = 'inline-flex items-center gap-[5px] whitespace-nowrap rounded-full border py-px pl-1.5 pr-2 text-[11.5px] font-bold leading-[1.6]';
const BUTTON = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[9px] px-3.5 text-[13px] font-semibold sm:min-h-[38px]';
const PRIMARY = `${BUTTON} border border-violet-600 bg-violet-600 text-white hover:bg-violet-700 dark:border-violet-500 dark:bg-violet-600 dark:hover:bg-violet-500`;
const MUTED = 'text-[12px] text-axal-muted dark:text-gray-400';
const SKEL = 'block rounded-[5px] bg-gray-200 dark:bg-gray-700';

/** The SLA band in a word and a glyph, never colour alone. The band is the server's. */
export function SlaChip({ sla }) {
  if (sla === 'past') {
    return <span className={`${CHIP} border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300`}><AlertTriangle size={11} aria-hidden="true" />Past SLA</span>;
  }
  if (sla === 'due_soon') {
    return <span className={`${CHIP} border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300`}><Clock size={11} aria-hidden="true" />Due soon</span>;
  }
  return <span className={`${CHIP} border-gray-300 bg-gray-50 text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300`}><Check size={11} aria-hidden="true" />On time</span>;
}

/** Reading, with its spinner. */
export function ReadingChip({ children = 'Reading' }) {
  return (
    <span className={`${CHIP} border-axal-hairline bg-gray-50 text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400`} data-platform-state="loading">
      <Loader2 size={11} aria-hidden="true" className="motion-safe:animate-spin" />{children}
    </span>
  );
}

/**
 * The escalation board, read on its own. `announce(text)` writes the page's one
 * polite region; `overviewReady()` says whether the rest of the page has loaded,
 * so the slow line never claims it has when it has not. Under the view-as
 * overlay (`enabled` false) nothing is read.
 */
export function useEscalationRead({ enabled = true, announce = () => {}, overviewReady = () => true } = {}) {
  const [read, setRead] = useState(READING);
  const seq = useRef(0);
  const timers = useRef([]);
  const failAnnounced = useRef(false);
  // `announce` and `overviewReady` are read when called, not when `run` was made.
  const latest = useRef({ announce, overviewReady });
  latest.current = { announce, overviewReady };
  const say = (text) => latest.current.announce(text);
  const clear = () => { for (const t of timers.current) clearTimeout(t); timers.current = []; };

  const run = useCallback((retry) => {
    const id = ++seq.current;
    let settled = false;
    clear();
    setRead((r) => ({ ...r, phase: 'reading', retry, slow: false }));
    if (retry) say(ANNOUNCE.retrying);
    const finish = (res) => {
      if (settled || seq.current !== id) return;
      settled = true;
      clear();
      const out = escalationOutcome(res);
      const at = Date.now();
      setRead((r) => (out.phase === 'ok'
        ? { ...r, ...out, retry, slow: false, readAt: at, tries: [] }
        : { ...r, phase: 'failed', retry, slow: false, tries: [...r.tries, at].slice(-2) }));
      if (out.phase === 'ok' && retry) say(retrySucceeded(out.items));
      // A failure on first load is announced once per page view; a failed retry is the card's own alert.
      if (out.phase === 'failed' && !retry && !failAnnounced.current) { failAnnounced.current = true; say(ANNOUNCE.failed); }
    };
    timers.current.push(setTimeout(() => {
      if (settled || seq.current !== id) return;
      setRead((r) => ({ ...r, slow: true }));
      if (!retry) say(latest.current.overviewReady() ? ANNOUNCE.slow : ANNOUNCE.slowOverviewPending);
    }, ESCALATIONS_SLOW_MS));
    timers.current.push(setTimeout(() => finish(null), ESCALATIONS_DEADLINE_MS));
    Promise.resolve()
      .then(() => api.escalations({ status: 'open' }))
      .then(finish, (e) => { reportError('hq-home-escalations', e); finish(null); });
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    run(false);
    return () => { seq.current += 1; clear(); };
  }, [enabled, run]);

  const retry = useCallback(() => run(true), [run]);
  return { read, retry };
}

function RowsSkeleton() {
  return [0, 1].map((i) => (
    <div key={i} aria-hidden="true" className="flex flex-col gap-[7px] border-t border-axal-hairline pt-[11px] dark:border-gray-800">
      <span className={`${SKEL} h-3 w-4/5 max-w-[380px]`} />
      <span className={`${SKEL} h-2.5 w-3/5 max-w-[260px]`} />
    </div>
  ));
}

/**
 * One escalation, one link to Support's Queue. Reads: SLA word, subject,
 * subsidiary and code, kind, raised by, raised and due.
 */
function EscalationRow({ e, name, now }) {
  const distance = dueDistance(e.due_at, now);
  const raised = stampLabel(e.created_at);
  const due = stampLabel(e.due_at);
  return (
    <li className="border-t border-axal-hairline dark:border-gray-800" data-testid="hq-escalation-row">
      <Link
        to="/admin/hq-support"
        className="flex min-h-[44px] items-start gap-2.5 py-3 text-inherit no-underline hover:bg-axal-ground focus-visible:outline-2 focus-visible:outline-violet-600 sm:py-[11px] dark:hover:bg-gray-800/60"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <SlaChip sla={e.sla} />
            <span className="text-[14px] font-bold leading-snug text-axal-ink dark:text-gray-100">{e.subject || kindLabel(e.kind)}</span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-axal-muted dark:text-gray-300">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-axal-hairline px-2 text-[11.5px] dark:border-gray-700">
              {name
                ? <><b className="text-axal-ink dark:text-gray-100">{name}</b><span className="font-mono text-[11px]">{e.branch_code}</span></>
                : <><span>Branch</span><span className="font-mono font-semibold text-axal-ink dark:text-gray-100">{e.branch_code}</span></>}
            </span>
            <span>{kindLabel(e.kind)}</span>
            {e.raised_by_name ? <><span aria-hidden="true">·</span><span>raised by {e.raised_by_name}</span></> : null}
          </span>
          <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">
            {[raised && `raised ${raised}`, due && `due ${due}`].filter(Boolean).join(' · ')}
            {distance ? (
              <>
                {raised || due ? ' · ' : ''}
                <span className={`whitespace-nowrap font-semibold ${e.sla === 'past' ? 'text-red-700 dark:text-red-300' : e.sla === 'due_soon' ? 'text-amber-800 dark:text-amber-300' : ''}`}>{distance}</span>
              </>
            ) : null}
          </span>
        </span>
        <ChevronRight size={14} aria-hidden="true" className="mt-1 flex-none text-axal-muted" />
      </Link>
    </li>
  );
}

/**
 * The escalation card (SHQ01 to SHQ06D). `names` maps a branch code to its
 * subsidiary, from the overview; `overview` is 'reading' | 'ok' | 'failed'.
 */
export function EscalationsCard({ read, onRetry, names, overview, now }) {
  const heading = useRef(null);
  const wasRetrying = useRef(false);
  const reading = read.phase === 'reading';
  const failed = read.phase === 'failed';
  const ok = read.phase === 'ok';
  // After a retry that answered, the Try again button is gone: focus goes to the card's heading, not the body.
  useEffect(() => {
    if (reading && read.retry) wasRetrying.current = true;
    else if (ok && wasRetrying.current) { wasRetrying.current = false; heading.current?.focus?.(); }
    else if (!reading) wasRetrying.current = false;
  }, [reading, ok, read.retry]);

  let right = null;
  if (reading) right = <ReadingChip>{read.retry ? 'Reading again' : 'Reading'}</ReadingChip>;
  else if (ok) right = <span className="font-mono text-[12.5px] font-semibold text-axal-ink dark:text-gray-100" data-testid="hq-escalations-count">{escalationCount(read.items, read.complete)}</span>;
  else right = <StateChip kind="unavailable" />;

  const rest = overview === 'ok';
  return (
    <section
      aria-labelledby="hq-esc"
      aria-busy={reading ? 'true' : undefined}
      data-testid="hq-escalations-card"
      data-read={read.phase}
      className={`flex min-w-0 flex-col gap-2.5 rounded-xl bg-white p-3.5 sm:px-[18px] sm:py-4 dark:bg-gray-900 ${failed ? 'border-[1.5px] border-dashed border-gray-400 dark:border-gray-500' : 'border border-axal-hairline dark:border-gray-800'}`}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 id="hq-esc" ref={heading} tabIndex={-1} className="m-0 text-[15px] font-bold tracking-tight text-axal-ink focus:outline-none dark:text-gray-100">Escalations awaiting HQ</h3>
        <span className="ml-auto flex items-center gap-2">{right}</span>
      </div>
      {ok && read.items.length ? null : <span className="-mt-1.5 text-[12px] text-axal-muted dark:text-gray-400">Raised by subsidiaries, oldest first</span>}

      {reading ? (
        <>
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-200" data-testid="hq-escalations-reading">{read.retry ? 'Reading the escalations again…' : 'Reading the escalations…'}</p>
          <RowsSkeleton />
          {read.slow ? (
            <p className="m-0 rounded-[9px] border border-axal-hairline bg-axal-ground px-3 py-2 text-[12.5px] leading-normal text-axal-ink dark:border-gray-800 dark:bg-gray-800/60 dark:text-gray-200" data-testid="hq-escalations-slow">
              This is taking longer than usual.{rest ? ' The other cards on this page have loaded and can be used now.' : ''}
            </p>
          ) : null}
          {read.retry ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <button type="button" aria-disabled="true" className={`${BUTTON} cursor-default border border-gray-300 bg-white text-axal-ink opacity-75 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100`} onClick={() => {}}>
                <Loader2 size={14} aria-hidden="true" className="motion-safe:animate-spin" />Trying again…
              </button>
              <span className={MUTED}>Only this card is being read again.</span>
            </div>
          ) : null}
        </>
      ) : null}

      {ok && !read.items.length ? (
        <>
          <div className="flex items-start gap-3 pt-1" data-testid="hq-escalations-clear">
            <span aria-hidden="true" className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"><Check size={16} /></span>
            <div className="flex min-w-0 flex-col gap-1">
              <span className={`${CHIP} self-start border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300`} data-platform-state="none"><Check size={11} aria-hidden="true" />All clear</span>
              <b className="text-[15px] leading-snug text-axal-ink dark:text-gray-100">Nothing is waiting on HQ.</b>
              <span className="text-[12.5px] leading-normal text-axal-muted dark:text-gray-300">
                No escalation is open on HQ’s board. A branch raises one from its Approvals board (moderation, content for brand approval, a seat increase) and it appears here with its due time.
              </span>
              {read.readAt ? <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">Read {clockUtc(read.readAt)}</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Link to="/admin/hq-support" className="inline-flex min-h-[44px] items-center text-[13px] font-semibold text-violet-700 sm:min-h-0 dark:text-violet-300">Open Support</Link>
            <span className={MUTED}>Answered decisions and HQ tickets are there.</span>
          </div>
        </>
      ) : null}

      {ok && read.items.length ? (
        <>
          {read.retry && read.readAt ? (
            <p className="m-0 flex items-center gap-1.5 text-[12.5px] text-emerald-700 dark:text-emerald-300"><Check size={12} aria-hidden="true" />Read again at {clockUtc(read.readAt)}.</p>
          ) : null}
          <ul aria-label="Open escalations, oldest first" className="m-0 flex list-none flex-col p-0" data-testid="hq-escalations">
            {read.items.map((e) => <EscalationRow key={e.uid} e={e} name={names.get(e.branch_code) || null} now={now} />)}
          </ul>
          {overview === 'failed' ? (
            <span className={MUTED} data-testid="hq-escalations-codes-only">Subsidiary names come from the overview, which could not be read; each row shows its branch code.</span>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 border-t border-axal-hairline pt-3 dark:border-gray-800">
            <Link to="/admin/hq-support" className={`${PRIMARY} w-full no-underline sm:w-auto`} data-testid="hq-escalations-answer-link">Answer on Support</Link>
            <span className="hidden max-w-[340px] text-[12px] leading-snug text-axal-muted sm:inline dark:text-gray-400">
              Answering records HQ’s decision and sends it to the branch. Delivery is reported separately.
            </span>
          </div>
        </>
      ) : null}

      {failed ? (
        <>
          <div role={read.retry ? 'alert' : undefined} className="flex flex-col gap-1.5" data-testid="hq-escalations-unavailable">
            <b className="text-[15px] leading-snug text-axal-ink dark:text-gray-100">{read.retry ? ANNOUNCE.retryFailed : ANNOUNCE.failed}</b>
            <span className="text-[13px] leading-normal text-axal-ink dark:text-gray-300">
              This is not a claim that none are waiting.{rest ? <><span className="sm:hidden"> The rest of this page loaded.</span><span className="hidden sm:inline"> The rest of this page loaded and is current; only this card is affected.</span></> : null}
            </span>
            {read.tries.length ? (
              <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">Tried at {read.tries.map((t) => clockUtc(t).replace(' UTC', '')).join(' and ')} UTC</span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={PRIMARY} onClick={onRetry} data-testid="hq-escalations-retry">
              <RotateCw size={14} aria-hidden="true" />Try again
            </button>
            {read.retry ? (
              <span className={MUTED}>If it keeps failing, the same board is on <Link to="/admin/hq-support" className="font-semibold text-violet-700 dark:text-violet-300">Support</Link> and may answer from there.</span>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

/**
 * Other signals (SHQ01): renewals within the window, suspended licences and
 * HQ's ticket queue, from the overview read with that read's own state. A
 * figure the overview could not give is Unavailable, never 0.
 */
export function OtherSignals({ overview, data, readAt }) {
  const unavailable = <StateChip kind="unavailable" />;
  const rows = overview === 'ok' ? (() => {
    const renewals = data.renewals_soon || [];
    const suspended = data.suspended || [];
    const queue = data.queue;
    const first = renewals[0];
    return [
      {
        key: 'renewals',
        label: `Renewals within ${data.renewals_within_days ?? 60} days`,
        value: String(renewals.length),
        note: <>{first ? <>{first.brand_name} renews <span className="font-mono text-[11.5px]">{String(first.renews_on || '').slice(0, 10)}</span></> : 'None in the window'} · <Link to="/admin/licences" className="font-semibold text-violet-700 dark:text-violet-300">Licences →</Link></>,
      },
      {
        key: 'suspended',
        label: 'Suspended licences',
        value: String(suspended.length),
        note: suspended.length ? suspended[0].brand_name : 'None on the ledger',
      },
      {
        key: 'queue',
        label: 'HQ ticket queue',
        value: queue?.available && Number.isFinite(Number(queue.open)) ? Number(queue.open).toLocaleString() : null,
        note: queue?.available
          ? <>open or in progress, platform-wide · <Link to="/admin/hq-support" className="font-semibold text-violet-700 dark:text-violet-300">By queue on Support →</Link></>
          : 'The ticket queue could not be read.',
      },
    ];
  })() : null;
  return (
    <section aria-labelledby="hq-sig" className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-axal-hairline bg-white p-3.5 sm:px-[18px] sm:py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="hq-other-signals" data-read={overview}>
      <div className="flex items-center gap-2.5">
        <h3 id="hq-sig" className="m-0 text-[15px] font-bold tracking-tight text-axal-ink dark:text-gray-100">Other signals</h3>
        {overview === 'ok' && readAt ? <span className="ml-auto font-mono text-[11.5px] text-axal-muted dark:text-gray-400">Read {clockUtc(readAt)}</span> : null}
      </div>
      {overview === 'ok' ? (
        <dl className="m-0 flex flex-col">
          {rows.map((r, i) => (
            <div key={r.key} className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 pb-2.5 ${i ? 'border-t border-axal-hairline pt-2.5 dark:border-gray-800' : 'pt-0.5'}`}>
              <dt className="text-[12.5px] text-axal-muted dark:text-gray-400">{r.label}</dt>
              <dd className="row-span-2 m-0 self-center font-mono text-[20px] font-semibold text-axal-ink dark:text-gray-100">{r.value ?? unavailable}</dd>
              <dd className="m-0 text-[12.5px] text-axal-ink dark:text-gray-300">{r.note}</dd>
            </div>
          ))}
        </dl>
      ) : overview === 'reading' ? (
        <>
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-200">Reading the overview…</p>
          {['Renewals within 60 days', 'Suspended licences', 'HQ ticket queue'].map((k) => (
            <div key={k} aria-hidden="true" className="flex justify-between gap-2.5 border-t border-axal-hairline pt-2.5 dark:border-gray-800">
              <span className="text-[12.5px] text-axal-muted dark:text-gray-400">{k}</span>
              <span className={`${SKEL} h-4 w-7`} />
            </div>
          ))}
        </>
      ) : (
        <>
          <dl className="m-0 flex flex-col gap-2">
            {['Renewals within 60 days', 'Suspended licences', 'HQ ticket queue'].map((k) => (
              <div key={k} className="flex items-center justify-between gap-2.5">
                <dt className="text-[12.5px] text-axal-muted dark:text-gray-400">{k}</dt>
                <dd className="m-0">{unavailable}</dd>
              </div>
            ))}
          </dl>
          <span className={MUTED}>From the overview read; see Platform below to try it again.</span>
        </>
      )}
    </section>
  );
}
