import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Pill from '../../../ui/Pill.jsx';
import { productTestingApi } from '../../../lib/api/productTesting.js';
import { CARD_ACTIONS, UNREADABLE, applicationRow, isAdminAccount, programmeRow, refusalCode, testerCard } from './testerModel.js';
import { ApplicationSheet, BecomeSheet, PoolSheet, ProgrammeSheet, SECONDARY, PRIMARY, TONE } from './TesterSheets.jsx';

/**
 * D1337 (#3542, PT-M1 to PT-M3, PT-M5) — Product testing on Studio: the
 * "Become a Product tester" card in its six states, Open programmes for an
 * active tester, and My applications. Every detail opens in D1317's Sheet;
 * there is no page or menu entry of its own (D1335 §1).
 *
 * THREE READS, THREE BLOCKS. The pool (`GET /api/testing/tester`), the
 * programmes (`GET /api/testing/programmes`, active testers only) and the
 * applications (`GET /api/testing/applications/mine`). One failed read costs
 * its own block, which says "Could not be read" with Try again; the others
 * draw as they are.
 *
 * AN ADMIN SEES NO CARD. An Admin or Super Admin account is not read at all,
 * and a 403 `admin_account` from the Worker (an Admin viewing as a member)
 * draws nothing either.
 */
const CARD = 'flex flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-5 py-[18px] dark:border-gray-800 dark:bg-gray-900';
const EYEBROW = 'font-mono text-[10.5px] font-medium uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const H3 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const P = 'm-0 text-[13px] leading-relaxed text-gray-700 dark:text-gray-300';
const COUNT = 'font-mono text-[12px] text-axal-muted dark:text-gray-400';
const ROW = 'flex w-full min-h-14 items-center gap-3 border-t border-axal-hairline px-2.5 py-3 text-left hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/60';

function Reading() {
  return (
    <div className="flex flex-col gap-2" data-testid="pt-reading">
      {[0, 1, 2].map((i) => <div key={i} className="h-11 rounded-md bg-gray-100 dark:bg-gray-800" />)}
      <p className="m-0 text-[13px] text-axal-muted dark:text-gray-400">Reading…</p>
    </div>
  );
}

function Unreadable({ onRetry, testId }) {
  return (
    <div role="alert" data-testid={testId} className="flex flex-col items-start gap-2.5 rounded-lg border border-dashed border-gray-300 p-4 dark:border-gray-700">
      <p className={P}>{UNREADABLE}</p>
      <button type="button" className={SECONDARY} onClick={onRetry} data-testid={`${testId}-retry`}>Try again</button>
    </div>
  );
}

/** PT-M1: the card. */
export function TesterCard({ state, onOpen, onRetry }) {
  if (state.status === 'loading') return <section className={CARD} data-testid="pt-card"><span className={EYEBROW}>Product testing</span><Reading /></section>;
  if (state.status === 'error') return <section className={CARD} data-testid="pt-card"><span className={EYEBROW}>Product testing</span><Unreadable testId="pt-card-unreadable" onRetry={onRetry} /></section>;
  const c = testerCard(state.data);
  return (
    <section className={CARD} data-testid="pt-card" data-kind={c.kind}>
      <div className="flex items-center justify-between gap-2"><span className={EYEBROW}>Product testing</span><Pill tone={TONE[c.tone]} data-testid="pt-card-pill">{c.pill}</Pill></div>
      <h3 className="m-0 text-[16px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100" data-testid="pt-card-title">{c.title}</h3>
      <p className={P} data-testid="pt-card-text">{c.text}</p>
      {c.action && (
        <div>
          <button type="button" className={c.kind === 'none' ? PRIMARY : SECONDARY} onClick={() => onOpen(c.action.open)} data-testid="pt-card-action">{c.action.label}</button>
        </div>
      )}
    </section>
  );
}

/** PT-M2: Open programmes. */
export function ProgrammesBlock({ state, onOpen, onRetry, headingRef }) {
  const items = state.status === 'ok' ? state.data.items : [];
  return (
    <section className={CARD} data-testid="pt-programmes" aria-labelledby="pt-programmes-h">
      <div className="flex items-center justify-between gap-3">
        <h3 id="pt-programmes-h" ref={headingRef} tabIndex={-1} className={`${H3} outline-none`}>Open programmes</h3>
        {state.status === 'ok' && items.length > 0 && <span className={COUNT}>{items.length}</span>}
      </div>
      {state.status === 'loading' && <Reading />}
      {state.status === 'error' && <Unreadable testId="pt-programmes-unreadable" onRetry={onRetry} />}
      {state.status === 'ok' && !items.length && <p className={P} data-testid="pt-programmes-empty">No programmes are open right now. You’re told in Inbox when one opens.</p>}
      {state.status === 'ok' && items.length > 0 && (
        <>
          <ul className="m-0 list-none p-0" aria-label="Open programmes">
            {items.map((p) => {
              const r = programmeRow(p);
              return (
                <li key={r.uid}>
                  <button type="button" className={ROW} onClick={() => onOpen(p)} data-testid={`pt-programme-row-${r.uid}`}>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:grid sm:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_120px_104px] sm:items-center sm:gap-3.5">
                      <span className="flex min-w-0 flex-col gap-0.5"><span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{r.product}</span><span className="text-[12.5px] text-axal-muted dark:text-gray-400">{r.firm}</span></span>
                      <span className="hidden text-[13px] leading-snug text-gray-700 sm:block dark:text-gray-300">{r.asks}</span>
                      <span className="font-mono text-[12px] text-gray-700 sm:text-[12.5px] dark:text-gray-300">{r.dates}<span className="sm:hidden"> · {r.places}</span></span>
                      <span className="hidden font-mono text-[12.5px] text-gray-700 sm:block dark:text-gray-300">{r.applied ? <Pill tone="warn">Applied</Pill> : r.places}</span>
                    </span>
                    <span aria-hidden="true" className="text-axal-muted dark:text-gray-500">›</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">Only active testers see this list. Places update as firms pick testers. No other tester’s name or email is ever shown.</p>
        </>
      )}
    </section>
  );
}

/** PT-M3: My applications. */
export function ApplicationsBlock({ state, onOpen, onRetry }) {
  const items = state.status === 'ok' ? state.data.items : [];
  return (
    <section className={CARD} data-testid="pt-applications">
      <div className="flex items-center justify-between gap-3">
        <h3 className={H3}>My applications</h3>
        {state.status === 'ok' && items.length > 0 && <span className={COUNT}>{items.length}</span>}
      </div>
      {state.status === 'loading' && <Reading />}
      {state.status === 'error' && <Unreadable testId="pt-applications-unreadable" onRetry={onRetry} />}
      {state.status === 'ok' && !items.length && <p className={P} data-testid="pt-applications-empty">You haven’t applied to a programme yet. Open programmes are listed above.</p>}
      {state.status === 'ok' && items.length > 0 && (
        <ul className="m-0 list-none p-0" aria-label="My applications">
          {items.map((a) => {
            const r = applicationRow(a);
            return (
              <li key={r.uid} className="flex items-center">
                <button type="button" className={ROW} onClick={() => onOpen(a, false)} data-testid={`pt-application-row-${r.uid}`}>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{r.product}</span><span className="text-[12.5px] text-gray-700 dark:text-gray-300" data-testid={`pt-application-line-${r.uid}`}>{r.firm} · {r.line}</span></span>
                  <Pill tone={TONE[r.tone]} data-testid={`pt-application-pill-${r.uid}`}>{r.pill}</Pill>
                  <span aria-hidden="true" className="text-axal-muted dark:text-gray-500">›</span>
                </button>
                {r.canWithdraw && (
                  <button type="button" onClick={() => onOpen(a, true)} data-testid={`pt-application-withdraw-${r.uid}`}
                    className="ml-1 inline-flex min-h-11 shrink-0 items-center px-2 text-[13px] font-semibold text-red-700 hover:underline sm:min-h-10 dark:text-red-400">Withdraw</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const loading = { status: 'loading' };

/** Read one block: `{ status: 'ok', data }`, `{ status: 'error' }`, or `{ status: 'hidden' }` for an Admin. */
async function readBlock(fn) {
  try { return { status: 'ok', data: await fn() }; } catch (e) {
    if (refusalCode(e) === 'admin_account') return { status: 'hidden' };
    if (refusalCode(e) === 'not_active_tester') return { status: 'closed' };
    return { status: 'error' };
  }
}

/**
 * The Studio section. `user` is the signed-in account (an Admin draws
 * nothing); `api` defaults to `productTestingApi`, and tests pass their own.
 */
export default function ProductTestingStudio({ user, api = productTestingApi }) {
  const admin = isAdminAccount(user);
  const navigate = useNavigate();
  const [pool, setPool] = useState(loading);
  const [programmes, setProgrammes] = useState(loading);
  const [applications, setApplications] = useState(loading);
  const [sheet, setSheet] = useState(null);
  const headingRef = useRef(null);

  const readPool = useCallback(async () => { setPool(loading); setPool(await readBlock(() => api.tester())); }, [api]);
  const readProgrammes = useCallback(async () => { setProgrammes(loading); setProgrammes(await readBlock(() => api.programmes())); }, [api]);
  const readApplications = useCallback(async () => { setApplications(loading); setApplications(await readBlock(() => api.myApplications())); }, [api]);

  useEffect(() => { if (!admin) { readPool(); readApplications(); } }, [admin, readPool, readApplications]);
  const active = pool.status === 'ok' && pool.data?.tester?.status === 'active';
  useEffect(() => { if (active) readProgrammes(); }, [active, readProgrammes]);

  if (admin || pool.status === 'hidden') return null;

  const onCard = (open) => {
    if (open === CARD_ACTIONS.programmes) { headingRef.current?.scrollIntoView?.({ block: 'start' }); headingRef.current?.focus?.(); return; }
    if (open === CARD_ACTIONS.support) { navigate('/support'); return; }
    setSheet({ kind: open });
  };
  const close = () => setSheet(null);
  const apps = applications.status === 'ok' ? applications.data.items || [] : [];
  // The lists draw for an active tester; My applications also for anyone with one to look back on.
  const showProgrammes = active;
  const showApplications = active || applications.status === 'error' || apps.length > 0;
  const lists = showProgrammes || showApplications;

  return (
    <div data-testid="pt-studio" className={lists ? 'grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_380px]' : 'lg:max-w-[380px]'}>
      {lists && (
        <div className="order-2 flex min-w-0 flex-col gap-3.5 lg:order-1">
          {showProgrammes && <ProgrammesBlock state={programmes} onRetry={readProgrammes} headingRef={headingRef} onOpen={(p) => setSheet({ kind: 'programme', programme: p })} />}
          {showApplications && <ApplicationsBlock state={applications} onRetry={readApplications} onOpen={(a, ask) => setSheet({ kind: 'application', application: a, ask })} />}
        </div>
      )}
      <div className="order-1 lg:order-2"><TesterCard state={pool} onOpen={onCard} onRetry={readPool} /></div>

      {sheet?.kind === CARD_ACTIONS.become && pool.status === 'ok' && (
        <BecomeSheet read={pool.data} api={api} onClose={close} onJoined={(next) => { setPool({ status: 'ok', data: next }); setSheet({ kind: CARD_ACTIONS.pool }); }} />
      )}
      {sheet?.kind === CARD_ACTIONS.pool && pool.status === 'ok' && (
        <PoolSheet read={pool.data} api={api} onClose={close} onChanged={(next) => setPool({ status: 'ok', data: next })} />
      )}
      {sheet?.kind === 'programme' && (
        <ProgrammeSheet programme={sheet.programme} consent={programmes.status === 'ok' ? programmes.data.consent : null} api={api} onClose={close}
          onApplied={(application) => { readProgrammes(); readApplications(); setSheet(application ? { kind: 'application', application: { ...application, owner_name: sheet.programme.owner_name, questions: sheet.programme.questions } } : null); }} />
      )}
      {sheet?.kind === 'application' && (
        <ApplicationSheet key={`${sheet.application.uid}-${sheet.ask ? 'ask' : 'view'}`} application={sheet.application} ask={sheet.ask} api={api} onClose={close}
          onWithdrawn={() => { readApplications(); if (active) readProgrammes(); }} />
      )}
    </div>
  );
}
