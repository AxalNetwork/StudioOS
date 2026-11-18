/**
 * D7516 (#7516) — the Expertise Overview's lead, drawn above the board's
 * sections (`workspaces/boards/advisorExpertise.js`, `lead`): the Next step
 * card (`NextActionCard`, EX-01 and the phone's full-width step, EX-04b), the
 * four-dimension status strip (`ExpertiseStatus`, EX-01) and, for an
 * administrator previewing the Advisor role, the one intentional state that
 * takes the sections' place (`AdvisorPreviewState`, EX-03). What each says is
 * `./overviewModel.js`; the states are #5129's (`StateChip`, `DataState`).
 *
 * It reads nothing of its own: `BucketBoard` hands it the board's source
 * states, so a figure here is the same read as the section below it, and one
 * section's Retry is the same read again (D4697).
 */
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DataState, StateChip } from '../../../ui/Honesty';
import { useViewMode } from '../../../contexts/ViewModeContext';
import { LICENCE_SENTENCES } from './licenceRefusal';
import {
  CHOOSE_ADVISOR_PATH, DIMENSIONS, PREVIEW_COPY, isAdvisorPreview, nextSteps, statusStrip,
} from './overviewModel';

const CARD = 'rounded-[12px] border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
const PRIMARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-violet-700 px-4 text-[13px] font-semibold text-white hover:bg-violet-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 dark:bg-violet-600 dark:hover:bg-violet-500';
const SECONDARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[12.5px] font-semibold text-axal-ink hover:bg-axal-ground focus-visible:outline-2 focus-visible:outline-violet-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const SMALL_LINK = 'inline-flex items-center text-[12px] font-semibold text-violet-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-violet-600 max-sm:min-h-[44px] sm:min-h-[32px] dark:text-violet-300';
const RETRY = 'inline-flex min-h-[44px] items-center text-[12px] font-bold text-violet-700 hover:underline focus-visible:outline-2 focus-visible:outline-violet-600 dark:text-violet-300';
const EYEBROW = 'text-[10px] font-extrabold uppercase tracking-[.08em] text-gray-600 dark:text-gray-400';
const TONE = {
  ok: 'text-emerald-800 dark:text-emerald-300',
  warn: 'text-amber-800 dark:text-amber-300',
  neutral: 'text-gray-700 dark:text-gray-300',
};

/** An external-looking link (the public profile) still stays in the app; the arrow is the canvas's. */
function ActionLink({ action, className = SMALL_LINK, testid }) {
  if (!action?.to) return null;
  return <Link to={action.to} className={className} data-testid={testid}>{action.label}</Link>;
}

/**
 * NextActionCard (EX-01; EX-04b on a phone): one dominant step and at most two
 * more, each from a read that answered. Nothing is drawn when the record
 * supports no step; while a read is in flight, a skeleton in the card's shape.
 */
export function NextActionCard({ sources }) {
  const next = nextSteps(sources);
  if (next.state === 'loading') {
    return (
      <section className={CARD} role="status" aria-busy="true" data-testid="expertise-next-step" data-state="loading">
        <span className="sr-only">Working out your next step…</span>
        <DataState state="loading" size="tile" />
      </section>
    );
  }
  if (next.state === 'refused') return null;
  const [lead, ...more] = next.steps;
  const unread = next.unread.length ? (
    <p className="m-0 mt-2 text-[12px] leading-relaxed text-gray-600 dark:text-gray-400" data-testid="expertise-next-step-unread">
      <StateChip kind="partial" /> {`${joinNames(next.unread)} could not be read, so a step from ${next.unread.length === 1 ? 'it' : 'them'} may be missing here.`}
    </p>
  ) : null;
  if (!lead) {
    return unread ? <section className={CARD} aria-label="Next step" data-testid="expertise-next-step" data-state="unread">{unread}</section> : null;
  }
  return (
    <section
      className="rounded-[12px] border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-950/40"
      aria-labelledby="expertise-next-step-title"
      data-testid="expertise-next-step"
      data-state="ready"
    >
      {/* EX-04b: on a phone the step is a column and its button is full width, 48px tall. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <span className={EYEBROW}>Next step · {lead.area}</span>
          <h2 id="expertise-next-step-title" className="m-0 mt-1 text-[16px] font-extrabold tracking-tight text-axal-ink max-sm:text-[15px] dark:text-gray-100">{lead.title}</h2>
          <p className="m-0 mt-1 text-[13px] leading-relaxed text-gray-700 max-sm:hidden dark:text-gray-300">{lead.why}</p>
        </div>
        <Link to={lead.to} className={`${PRIMARY} max-sm:min-h-[48px] max-sm:w-full`} data-testid="expertise-next-step-action">{lead.action}</Link>
      </div>
      {more.length ? (
        <div className="mt-3 border-t border-violet-200 pt-3 dark:border-violet-800">
          <h3 className={`m-0 ${EYEBROW}`}>Also worth doing</h3>
          <ul className="m-0 mt-1 list-none p-0">
            {more.map((s) => (
              <li key={s.key} className="flex flex-wrap items-center justify-between gap-x-3 border-t border-violet-100 py-1 first:border-t-0 dark:border-violet-900" data-testid={`expertise-step-${s.key}`}>
                <span className="min-w-0 flex-1 text-[13px] font-semibold text-axal-ink dark:text-gray-100">
                  {s.title}
                  <small className="block text-[11.5px] font-normal text-gray-600 dark:text-gray-400">{s.area} · {s.why}</small>
                </span>
                <Link to={s.to} className={SMALL_LINK}>{s.action}</Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {unread}
    </section>
  );
}

const joinNames = (names) => {
  const cap = names.map((n, i) => (i === 0 ? n.charAt(0).toUpperCase() + n.slice(1) : n));
  return cap.length > 1 ? `${cap.slice(0, -1).join(', ')} and ${cap[cap.length - 1]}` : cap[0];
};

/** One dimension's cell: its label, its state or value, one sub-fact and one action. */
function StatusCell({ cell, sources }) {
  const retry = cell.retry.length ? (
    <button type="button" className={RETRY} onClick={() => cell.retry.forEach((k) => sources[k]?.retry?.())} data-testid={`expertise-status-retry-${cell.key}`}>
      Retry
    </button>
  ) : null;
  let body;
  if (cell.state === 'loading') {
    body = (
      <div role="status" aria-busy="true">
        <span className="sr-only">{`Loading ${cell.label}…`}</span>
        <DataState state="loading" size="tile" />
      </div>
    );
  } else if (cell.state === 'refused') {
    body = <p className="m-0 mt-1 text-[12px] leading-relaxed text-gray-600 dark:text-gray-400"><StateChip kind="refused" /> {LICENCE_SENTENCES.expertise}</p>;
  } else if (cell.state === 'unavailable') {
    body = (
      <>
        <p className="m-0 mt-1 text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
          <StateChip kind="unavailable" /> {`${joinNames(cell.missing)} could not be read. This is not a claim that none exist.`}
        </p>
        {retry}
      </>
    );
  } else {
    const v = cell.value;
    body = (
      <>
        <p className={`m-0 mt-1 text-[13px] font-extrabold ${TONE[v.tone] || TONE.neutral}`} data-testid={`expertise-status-word-${cell.key}`}>{v.word}</p>
        {v.fact ? <p className="m-0 text-[13px] font-semibold tabular-nums text-axal-ink dark:text-gray-100" data-testid={`expertise-status-fact-${cell.key}`}>{v.fact}</p> : null}
        {v.sub ? <p className="m-0 mt-0.5 text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">{v.sub}</p> : null}
        {cell.state === 'partial' ? (
          <p className="m-0 mt-1 text-[12px] leading-relaxed text-gray-600 dark:text-gray-400" data-testid={`expertise-status-partial-${cell.key}`}>
            <StateChip kind="partial" /> {`${joinNames(cell.missing)} could not be read, so this is not the whole answer.`}
          </p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 pt-1">
          <ActionLink action={v.action} testid={`expertise-status-action-${cell.key}`} />
          {retry}
        </div>
      </>
    );
  }
  return (
    <li className="flex min-w-0 flex-col bg-white p-3 dark:bg-gray-900" data-testid={`expertise-status-${cell.key}`} data-state={cell.state}>
      <h3 className={`m-0 ${EYEBROW}`}>{cell.label}</h3>
      {body}
    </li>
  );
}

/** ExpertiseStatus (EX-01): Completion, Publication, Verification and Availability, each from its own reads. */
export function ExpertiseStatus({ sources }) {
  const cells = statusStrip(sources);
  return (
    <section aria-labelledby="expertise-status-title" data-testid="expertise-status">
      <h2 id="expertise-status-title" className="m-0 mb-2 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">Your Expertise</h2>
      <ul className="m-0 grid list-none grid-cols-1 gap-px overflow-hidden rounded-[12px] border border-axal-hairline bg-axal-hairline p-0 sm:grid-cols-2 lg:grid-cols-4 dark:border-gray-700 dark:bg-gray-700">
        {cells.map((cell) => <StatusCell key={cell.key} cell={cell} sources={sources} />)}
      </ul>
    </section>
  );
}

/**
 * EX-03: an administrator previewing the Advisor role has selected a role, not
 * a person, so there is no advisor's record to show. One state says so and
 * how to open one, and a data-free outline of the page stands where the
 * sections would be: never five sections each explaining an absence.
 */
export function AdvisorPreviewState({ view }) {
  const navigate = useNavigate();
  const exit = typeof view?.exitPreview === 'function' ? view.exitPreview : null;
  // Leaving the preview first: All accounts is an administrator's page, which the Advisor view does not open.
  const impersonate = () => { exit?.(); navigate(CHOOSE_ADVISOR_PATH); };
  return (
    <div className="flex flex-col gap-3.5" data-testid="expertise-admin-preview">
      <section className={`${CARD} p-6 max-sm:p-4`} aria-labelledby="expertise-preview-title">
        <h2 id="expertise-preview-title" className="m-0 text-[20px] font-extrabold tracking-tight text-axal-ink max-sm:text-[17px] dark:text-gray-100">{PREVIEW_COPY.title}</h2>
        <p className="m-0 mt-1.5 max-w-[560px] text-[13.5px] leading-relaxed text-gray-700 dark:text-gray-300">{PREVIEW_COPY.body}</p>
        <div className="mt-3 flex flex-wrap gap-2 max-sm:flex-col">
          {exit ? (
            <>
              <button type="button" className={`${PRIMARY} max-sm:w-full`} onClick={impersonate} data-testid="expertise-preview-impersonate">{PREVIEW_COPY.impersonate}</button>
              <button type="button" className={`${SECONDARY} max-sm:w-full`} onClick={exit} data-testid="expertise-preview-exit">{PREVIEW_COPY.exit}</button>
            </>
          ) : null}
        </div>
        {exit ? <p className="m-0 mt-2 text-[12px] text-gray-600 dark:text-gray-400">{PREVIEW_COPY.impersonateHint}</p> : null}
      </section>
      <section className={`${CARD} opacity-80`} aria-labelledby="expertise-preview-layout" data-testid="expertise-preview-layout">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="expertise-preview-layout" className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">{PREVIEW_COPY.layout}</h2>
          <span className="text-[11.5px] text-gray-600 dark:text-gray-400">{PREVIEW_COPY.layoutNote}</span>
        </div>
        <ul className="m-0 mt-3 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {DIMENSIONS.map((d) => (
            <li key={d.key} className="flex flex-col gap-1.5">
              <span className={EYEBROW}>{d.label}</span>
              <span aria-hidden="true" className="h-3 w-[70%] rounded bg-gray-200 dark:bg-gray-700" />
              <span aria-hidden="true" className="h-2.5 w-[90%] rounded bg-gray-200 dark:bg-gray-700" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * The board's lead (`BucketBoard`'s `lead`): the preview state in place of the
 * sections for an administrator previewing the role; otherwise the Next step
 * and the strip above the sections (`fallback`).
 */
export default function ExpertiseOverview({ fallback = null, sources = {} }) {
  const view = useViewMode();
  if (isAdvisorPreview(view)) return <AdvisorPreviewState view={view} />;
  return (
    <div className="flex flex-col gap-3.5" data-testid="expertise-overview">
      <NextActionCard sources={sources} />
      <ExpertiseStatus sources={sources} />
      {fallback}
    </div>
  );
}
