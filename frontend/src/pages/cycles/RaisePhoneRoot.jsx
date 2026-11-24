/**
 * D6047 (#6047, Raise V2 build 3/5) — Raise's phone root, drawn to board RA-11 (RA11a) of
 * `design/incoming/Raise v2 Page.dc.html` (D4863): the Raise branch of `PhoneCycleRoot.jsx`.
 *
 * In this order, so that at 390px the primary action is in the first screen and the next steps
 * come before any score: the eyebrow with the page's Eadwyn button, the Worker's one primary action
 * (RA-03, `primary_action`, the same one desktop draws), the four-stage journey in its phone form,
 * the next steps (RA-04), the score (readiness coverage and the round's meter), the connected-sources
 * line (RA-06) and the module status list (`PhoneRows`, built by `PhoneCycleRoot`). Nothing scrolls
 * sideways: every block is one column, and text wraps.
 *
 * Every value is one of #5129's states (RA-08). What the read does not serve yet is Not recorded,
 * never invented (`raisePhoneModel.js`: #8256, #8257, #8258). A staff read (`read_only`) draws the
 * Read only line and no link that writes. The module phones (RA-26) are #5075's; the rail is #5130's.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { DataState, EadwynButton, PhoneRows, StateChip } from '../../ui';
import CycleMeter from './CycleMeter';
import { linkSearch, raisePrimaryAction } from './cycleModel';
import { coverageWords, journeyView, lastRead, nextActionsView, readinessView, sourcesView, unassessedWords } from './raiseOverviewModel';
import { sourcesLine } from './raisePhoneModel';
import { phoneMeter } from './validatePhone';

const EYEBROW = 'm-0 text-[10px] font-extrabold uppercase tracking-[.12em]';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.01em] text-gray-900 dark:text-gray-100';
const SUB = 'm-0 text-[12.5px] leading-[1.5] text-gray-600 dark:text-gray-400';
const CARD = 'flex min-w-0 flex-col gap-2 rounded-[12px] border border-[#ecebf1] bg-white px-3.5 py-3 dark:border-gray-800 dark:bg-gray-900';
const BTN = 'inline-flex min-h-[44px] w-full items-center justify-center rounded-[11px] border border-gray-300 bg-white px-3 text-[13.5px] font-bold text-violet-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-violet-300 dark:hover:bg-gray-800';
const BTN_P = 'inline-flex min-h-[44px] w-full items-center justify-center rounded-[11px] bg-violet-700 px-3 text-[13.5px] font-bold text-white hover:bg-violet-800 dark:bg-violet-600 dark:hover:bg-violet-500';
const LINK = 'inline-flex min-h-[44px] items-center text-[13px] font-semibold text-violet-700 underline dark:text-violet-300';

/** A plain tap, as `PhoneCycleRoot` reads one. */
const plainTap = (e) => !e.defaultPrevented && (e.button ?? 0) === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/** RA-03 on a phone: one full-width action, or why there is none. */
function PrimaryAction({ raw, readOnly, openAction, actionHref }) {
  if (readOnly) return null;
  if (raw?.primary_action?.state === 'unreadable') {
    return <p className={`${SUB} mt-3`} data-testid="raise-phone-action-unavailable">No primary action is offered: {raw.primary_action.reason || 'the stage could not be worked out.'}</p>;
  }
  const a = raisePrimaryAction(raw);
  if (!a) return null;
  const opens = !!(openAction && actionHref && a.href.split(/[?#]/)[0] === actionHref);
  return (
    <Link to={a.href} onClick={opens ? (e) => { if (plainTap(e)) { e.preventDefault(); openAction(); } } : undefined}
      className="mt-4 flex min-h-[52px] w-full items-center justify-center rounded-[14px] bg-violet-700 px-4 text-[15px] font-bold text-white hover:bg-violet-800 dark:bg-violet-600 dark:hover:bg-violet-500"
      data-testid="raise-phone-action" data-action-key={a.key || undefined}>{a.label}</Link>
  );
}

/** RA-11's journey: the four stages in one row of four, the current one marked; the rule under it. */
export function RaisePhoneJourney({ view }) {
  return (
    <section aria-label="Fundraising journey" data-testid="raise-phone-journey" className="mt-5 flex flex-col gap-1.5">
      <ol className="m-0 grid list-none grid-cols-4 gap-1 p-0">
        {view.stages.map((s, i) => (
          <li key={s.key} aria-current={s.status === 'current' ? 'step' : undefined} data-testid={`raise-phone-stage-${s.key}`} data-stage-status={s.status || 'unknown'}
            className={`flex min-w-0 flex-col gap-0.5 rounded-[9px] border px-1.5 py-1.5 ${s.status === 'current' ? 'border-violet-300 bg-violet-50 dark:border-violet-800 dark:bg-violet-900/20' : 'border-[#ecebf1] dark:border-gray-800'}`}>
            <span className="font-mono text-[9.5px] font-bold text-gray-600 dark:text-gray-400">{i + 1}</span>
            <span className={`break-words text-[11.5px] font-bold leading-[1.25] ${s.status === 'current' ? 'text-violet-800 dark:text-violet-200' : 'text-gray-900 dark:text-gray-100'}`}>{s.label}</span>
            {s.status === 'current' ? <span className="text-[9.5px] font-extrabold uppercase tracking-[.06em] text-violet-700 dark:text-violet-300">You are here</span>
              : s.word ? <span className="sr-only">{s.word}</span> : null}
          </li>
        ))}
      </ol>
      {view.rule ? <p className={SUB} data-testid="raise-phone-journey-rule">Stage chosen from your records: {view.rule}.</p> : null}
      {view.unavailable ? <p className={SUB} data-testid="raise-phone-journey-unavailable">The stage is Unavailable. {view.unavailable}</p> : null}
    </section>
  );
}

/** RA-04 on a phone: at most three, each with its reason, its impact or Not recorded, and one 44px action. */
export function RaisePhoneNextSteps({ view, readOnly = false, onRetry }) {
  const n = view?.state === 'ready' ? view.items.length : 0;
  return (
    <section aria-labelledby="raise-phone-next-title" data-testid="raise-phone-next" data-state={view ? view.state : 'not_recorded'} className="mt-6 flex flex-col gap-2.5">
      <h2 id="raise-phone-next-title" className={H2}>Next actions</h2>
      {!view ? <DataState state="not_recorded" size="block" what="Next actions" reason="This read carries no next steps." data-testid="raise-phone-next-not-recorded" />
        : view.state === 'unavailable' ? <DataState state="unavailable" size="block" what="Next actions" onRetry={onRetry} data-testid="raise-phone-next-unavailable" />
          : !n ? <p className={SUB} data-testid="raise-phone-next-none">No readiness step is open right now.</p>
            : (
              <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
                {view.items.map((it, i) => (
                  <li key={it.key} className={`${CARD} ${i === 0 ? 'border-violet-200 dark:border-violet-800' : ''}`} data-testid={`raise-phone-next-${it.key}`}>
                    <span className="font-mono text-[10.5px] font-bold uppercase tracking-[.07em] text-gray-600 dark:text-gray-400">{i + 1} of {n}</span>
                    <h3 className="m-0 text-[14px] font-extrabold text-gray-900 dark:text-gray-100">{it.title}</h3>
                    <p className="m-0 text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300"><span className="sr-only">Why: </span>{it.reason}</p>
                    {it.impact
                      ? <span className="self-start rounded-full border border-gray-300 px-2 py-0.5 text-[11.5px] font-semibold text-gray-900 dark:border-gray-700 dark:text-gray-200" data-testid="raise-phone-next-impact">{it.impact}</span>
                      : <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-gray-600 dark:text-gray-400" data-testid="raise-phone-next-impact-unrecorded">Readiness impact <StateChip kind="not_recorded" /></span>}
                    {!readOnly && it.href ? <Link to={it.href} className={i === 0 ? BTN_P : BTN} aria-label={it.label}>{it.cta}</Link> : null}
                  </li>
                ))}
              </ol>
            )}
      {/* #8256: follow-ups due and unanswered objections are not in this read yet. */}
      <p className="m-0 flex flex-wrap items-center gap-1.5 text-[12px] text-gray-600 dark:text-gray-400" data-testid="raise-phone-next-followups">
        Follow-ups due and investor objections <StateChip kind="not_recorded" />
      </p>
      {readOnly && n ? <p className={SUB}>Read only. The founder takes these steps.</p> : null}
    </section>
  );
}

/** The score, after the next steps: readiness coverage (never a 0 for an unassessed area) and the round's meter. */
export function RaisePhoneScore({ view, meter, search = '', onRetry }) {
  return (
    <section aria-labelledby="raise-phone-score-title" data-testid="raise-phone-score" data-state={view.state} className={`${CARD} mt-6`}>
      <h2 id="raise-phone-score-title" className={H2}>Fundraising readiness</h2>
      {view.state === 'unavailable' ? <DataState state="unavailable" size="block" what="Fundraising readiness" reason={view.reason} onRetry={onRetry} data-testid="raise-phone-score-unavailable" />
        : view.state === 'none' || view.state === 'loading' ? <p className={SUB} data-testid="raise-phone-score-none">No area is assessed yet, so readiness has no coverage to show.</p>
          : (
            <>
              <p className="m-0 text-[20px] font-extrabold tracking-[-.02em] text-gray-900 dark:text-gray-100" data-testid="raise-phone-coverage">{coverageWords(view)}</p>
              <p className={SUB}>{unassessedWords(view)}</p>
              {/* #8257: which areas need attention is not in this read yet. */}
              <p className="m-0 flex flex-wrap items-center gap-1.5 text-[12px] text-gray-600 dark:text-gray-400" data-testid="raise-phone-attention">Areas needing attention <StateChip kind="not_recorded" /></p>
            </>
          )}
      <CycleMeter meter={meter} cycle="raise" />
      <Link to={`/raise/fundraising-readiness${search}`} className={`${BTN} mt-2`} aria-label="Review fundraising readiness">Review readiness</Link>
    </section>
  );
}

/** RA-06 on a phone: one line of sources, or one message with nothing connected. */
export function RaisePhoneSources({ view, readOnly = false, onRetry }) {
  if (!view) return null;
  const connect = '/account/connectors';
  const line = sourcesLine(view);
  return (
    <section aria-labelledby="raise-phone-sources-title" data-testid="raise-phone-sources" data-state={view.state} className="mt-6 flex flex-col gap-1.5">
      <h2 id="raise-phone-sources-title" className={EYEBROW + ' text-gray-700 dark:text-gray-300'}>Connected sources</h2>
      {view.state === 'unavailable' ? <DataState state="unavailable" size="block" what="Your connected sources" onRetry={onRetry} data-testid="raise-phone-sources-unavailable" />
        : view.state === 'none' ? (
          <>
            <p className={SUB} data-testid="raise-phone-sources-none">Nothing is connected, so evidence is only what you add by hand.</p>
            {!readOnly ? <Link to={connect} className={`${LINK} self-start`} aria-label="Connect sources for fundraising evidence">Connect sources</Link> : null}
          </>
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Connected sources">
              {line.connected.map((r) => (
                <li key={r.key} className="text-[12.5px] text-gray-900 dark:text-gray-100" data-testid={`raise-phone-source-${r.key}`} data-state="connected">
                  <b>{r.label}</b> <span className="text-gray-600 dark:text-gray-400">· {lastRead(r.asOf)}</span>
                </li>
              ))}
              {line.unreadable.map((r) => (
                <li key={r.key} className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-gray-900 dark:text-gray-100" data-testid={`raise-phone-source-${r.key}`} data-state="unreadable">
                  <b>{r.label}</b> <StateChip kind="unavailable" />
                  {onRetry ? <button type="button" onClick={onRetry} className={LINK} aria-label={`Try reading ${r.label} again`}>Try again</button> : null}
                </li>
              ))}
            </ul>
            {line.notConnected ? <p className={SUB}>{line.notConnected} more not connected.</p> : null}
            {/* #8258: whether a source is fresh or stale is not in this read yet. */}
            {line.connected.length ? <p className="m-0 flex flex-wrap items-center gap-1.5 text-[12px] text-gray-600 dark:text-gray-400" data-testid="raise-phone-freshness">Fresh or stale <StateChip kind="not_recorded" /></p> : null}
            {!readOnly ? <Link to={connect} className={`${LINK} self-start`} aria-label="Manage connected sources">Manage sources</Link> : null}
          </>
        )}
    </section>
  );
}

/** The Raise branch of `PhoneCycleRoot`: the RA-11 root for a read that answered. `groups` is the module status list. */
export default function RaisePhoneRoot({ raw, search = '', groups, nav = null, openAction, actionHref = null, onRetry }) {
  const s = linkSearch(search);
  const readOnly = raw?.read_only === true;
  const overview = 'Raise · Overview';
  return (
    <div data-testid="phone-root" data-cycle="raise" data-raise-phone="ra-11">
      {nav}
      <div className="flex min-h-[40px] items-center justify-between gap-2">
        <p className={`${EYEBROW} text-violet-700 dark:text-violet-300`}>{overview}</p>
        <EadwynButton label={overview} />
      </div>
      {readOnly ? (
        <p role="status" className="m-0 mt-2 rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] font-bold text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200" data-testid="raise-phone-read-only">
          Read only · {raw?.mode === 'summary' ? 'HQ summary. Counts only; the founder’s records stay with the founder.' : 'You can read this cycle but not change it.'}
        </p>
      ) : null}
      <PrimaryAction raw={raw} readOnly={readOnly} openAction={openAction} actionHref={actionHref} />
      <RaisePhoneJourney view={journeyView(raw, s)} />
      <RaisePhoneNextSteps view={nextActionsView(raw, s)} readOnly={readOnly} onRetry={onRetry} />
      <RaisePhoneScore view={readinessView(raw)} meter={phoneMeter(raw, 'raise')} search={s} onRetry={onRetry} />
      <RaisePhoneSources view={sourcesView(raw)} readOnly={readOnly} onRetry={onRetry} />
      {/* PhoneRows draws its own 22px gutter; the body already has one. */}
      <div className="-mx-[22px] mt-[26px]" data-testid="raise-phone-modules">
        <PhoneRows groups={groups} />
      </div>
    </div>
  );
}
