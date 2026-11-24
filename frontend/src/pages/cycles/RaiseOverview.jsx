/**
 * D6046 (#6046, Raise V2 build 2/5) — Raise › Overview V2 on desktop, drawn to
 * `design/incoming/Raise v2 Page.dc.html` boards RA-01 (early raise), RA-02
 * (active raise), RA-03 to RA-09 and RA-13 (dark), D4863. It is Raise's
 * `Overview` in `defs/raise.jsx`, as Build's and Grow's are theirs, so the
 * frozen `CycleRoute.jsx` gains nothing.
 *
 * In RA-B's order: the header (Ask and the Worker's one primary action, RA-03),
 * the four-stage journey strip, the readiness summary, the next actions (before
 * any score breakdown, RA-04), the materials (one status table for those with
 * nothing in them, cards for the rest, the Pitch card in its states, RA-05),
 * investor activity, connected evidence (RA-06), detailed readiness (RA-07)
 * and Related company setup. Every value is one of #5129's states (RA-08); the
 * page-level states are RA-09's.
 *
 * Below 1024px the page is the phone root (`PhoneCycleRoot.jsx`, D703), whose
 * Raise branch is RA-11 (`RaisePhoneRoot.jsx`, D6047). RA-10 (the Eadwyn rail) is #5130's and
 * RA-12 (navigation) is #5081's, already in `CycleHeader`.
 *
 * A staff read (`read_only`, D1191) draws the amber Read only bar, no primary
 * action, no Ask, no Share and no link that writes; the Worker sends it counts
 * only and no investor names.
 */
import { CycleHeader } from './CycleOverview';
import PhoneCycleRoot from './PhoneCycleRoot';
import AlsoIn from '../../workspaces/AlsoIn';
import { Link } from 'react-router-dom';
import { Unreadable } from '../../ui';
import { useAuth } from '../../hooks/useAuthSync';
import { ShareStatusButton } from './evidence/ShareStatus';
import { linkSearch, raisePrimaryAction } from './cycleModel';
import { addHref as capRelAddHref } from '../raise/caprel/capRelModel';
import {
  MARKS, RAISE_SUB, RELATED_SETUP, activityView, detailedOpenByDefault, journeyView, materialsSplit,
  moduleHref, nextActionsView, readinessView, sourcesView, statusRow,
} from './raiseOverviewModel';
import {
  CARD, SUB, RaiseAsk, RaiseConnectedEvidence, RaiseDetailedReadiness, RaiseInvestorActivity, RaiseMaterials,
  RaiseNextActions, RaiseReadinessSummary,
} from './RaiseOverviewLead';

const SECTION = 'text-[10px] font-extrabold uppercase tracking-[.09em]';

/** RA-01, RA-02: the four stages, the current one marked as the step the viewer is on, each tool linked by name. */
export function RaiseJourney({ view }) {
  return (
    <section aria-label="Fundraising journey" data-testid="raise-journey" className="flex flex-col gap-1.5">
      <ol className="m-0 grid list-none grid-cols-1 gap-0 overflow-hidden rounded-xl border border-axal-hairline bg-white p-0 sm:grid-cols-2 xl:grid-cols-4 dark:border-gray-800 dark:bg-gray-900">
        {view.stages.map((s) => (
          <li key={s.key} aria-current={s.status === 'current' ? 'step' : undefined} data-testid={`raise-journey-${s.key}`} data-stage-status={s.status || 'unknown'}
            className={`flex min-w-0 flex-col gap-2 border-b border-axal-hairline px-4 py-3 last:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0 dark:border-gray-800 ${s.status === 'current' ? 'bg-axal-lavender shadow-[inset_0_3px_0_#7c3aed] dark:bg-violet-900/20 dark:shadow-[inset_0_3px_0_#a78bfa]' : ''}`}>
            <div className="flex items-baseline justify-between gap-2">
              <b className={`text-[13px] ${s.status === 'current' ? 'text-axal-violet-deep dark:text-violet-300' : 'text-axal-ink dark:text-gray-100'}`}>{s.label}</b>
              {s.word ? <span className={`${SECTION} ${s.status === 'current' ? 'text-axal-violet-deep dark:text-violet-300' : 'text-axal-muted dark:text-gray-400'}`}>{s.word}</span> : null}
            </div>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {s.items.map((it) => (
                <li key={it.key} className="flex items-center gap-2 text-[12.5px]">
                  <span aria-hidden="true" className={`grid h-4 w-4 flex-none place-items-center rounded-full border text-[9px] font-bold ${it.mark === 'recorded' ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:border-emerald-400 dark:bg-emerald-900/30 dark:text-emerald-300' : it.mark === 'started' ? 'border-axal-violet text-axal-violet dark:border-violet-400 dark:text-violet-300' : it.mark === 'unavailable' ? 'border-dashed border-gray-500 text-gray-700 dark:border-gray-400 dark:text-gray-300' : it.mark === 'empty' ? 'border-dotted border-gray-400 dark:border-gray-500' : 'border-transparent'}`}>{it.mark ? MARKS[it.mark].glyph : ''}</span>
                  <Link to={it.href} className="text-axal-ink hover:text-axal-violet-deep hover:underline dark:text-gray-200 dark:hover:text-violet-300" data-mark={it.mark || 'none'}>
                    {it.name}{it.mark ? <span className="sr-only">{`, ${MARKS[it.mark].words}`}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {view.rule ? <p className={`m-0 ${SUB}`} data-testid="raise-journey-rule">Stage chosen from your records: {view.rule}.</p> : null}
      {view.unavailable ? <p className={`m-0 ${SUB}`} data-testid="raise-journey-unavailable">The stage is Unavailable. {view.unavailable}</p> : null}
    </section>
  );
}

/** RA-01: Incorporate and the Co-Founder Agreement are not Raise modules; they live in Build. */
export function RaiseRelatedSetup() {
  return (
    <section className={`${CARD} border-dashed bg-transparent sm:flex-row sm:items-center dark:bg-transparent`} aria-label="Related company setup" data-testid="raise-related-setup">
      <span className={`${SECTION} flex-none text-axal-muted dark:text-gray-400`}>Related company setup</span>
      <span className={`${SUB} flex-1`}>Not Raise modules · they live in Build</span>
      <span className="flex flex-wrap gap-3">{RELATED_SETUP.map((l) => <Link key={l.href} to={l.href} className="text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">{l.label} ›</Link>)}</span>
    </section>
  );
}

/** RA-09 Loading: placeholders the size of the page's sections, announced once. */
function Loading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" data-testid="raise-overview-loading">
      <span role="status" className="sr-only">Loading Raise overview</span>
      {[88, 96, 150, 220].map((h, i) => <div key={i} className="rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" style={{ height: h }} />)}
    </div>
  );
}

/** The V2 page body for a read that answered; exported so a test draws it without the route. */
export function RaiseOverviewBody({ raw, search = '', readOnly = false, onRetry, onRetryCard }) {
  const s = linkSearch(search);
  const journey = journeyView(raw, s);
  const readiness = readinessView(raw);
  const split = materialsSplit(raw);
  const activity = activityView(raw);
  return (
    <>
      <RaiseJourney view={journey} />
      <RaiseReadinessSummary view={readiness} search={s} readOnly={readOnly} onRetry={onRetryCard ? () => onRetryCard('fundraising-readiness') : onRetry} />
      <RaiseNextActions view={nextActionsView(raw, s)} readOnly={readOnly} onRetry={onRetry} />
      <RaiseMaterials split={split} rows={split.table.map((c) => statusRow(c, s))} activity={raw?.investor_activity} search={s} readOnly={readOnly} onRetryCard={onRetryCard} />
      <RaiseInvestorActivity view={activity} openHref={moduleHref('capital-relationships', s)} addHref={capRelAddHref(s)} readOnly={readOnly} />
      <RaiseConnectedEvidence view={sourcesView(raw)} readOnly={readOnly} onRetry={onRetry} />
      <RaiseDetailedReadiness key={detailedOpenByDefault(raw) ? 'open' : 'shut'} view={readiness} defaultOpen={detailedOpenByDefault(raw)} search={s} />
      <RaiseRelatedSetup />
    </>
  );
}

export function RaiseOverviewView({ raw, status, search = '', message = '', readOnly: readOnlyIn = false, onRetry, onRetryCard, projectId = null, role = null }) {
  const ready = status === 'ready' && raw;
  const readOnly = Boolean(readOnlyIn) || raw?.read_only === true;
  const cards = Array.isArray(raw?.cards) ? raw.cards : [];
  // RA-03: the Worker's action, chosen from recorded state; none for a staff read or while the read is not here.
  const action = ready && !readOnly ? raisePrimaryAction(raw) : null;
  const more = readOnly || !projectId ? null : <>{role === 'founder' ? <ShareStatusButton projectId={projectId} /> : null}<RaiseAsk /></>;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="cycle-overview" data-cycle="raise" data-raise-overview="v2">
      <CycleHeader cycle="raise" cards={cards} action={action} search={search} sub={RAISE_SUB} more={more} />
      {readOnly && ready ? (
        <div role="status" className="flex items-center gap-2 rounded-[10px] border border-amber-300 bg-amber-50 px-3.5 py-2 text-[12.5px] font-bold text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200" data-testid="cycle-overview-read-only">
          Read only · {raw?.mode === 'summary' ? 'HQ summary. Counts only; the founder’s records stay with the founder.' : 'You can read this cycle but not change it.'}
        </div>
      ) : null}
      {ready && !readOnly && raw?.primary_action?.state === 'unreadable'
        ? <p className={`m-0 ${SUB}`} data-testid="raise-action-unavailable">No primary action is offered: {raw.primary_action.reason || 'the stage could not be worked out.'}</p> : null}
      {status === 'refused' ? (
        <div role="status" className="max-w-[620px] rounded-xl border border-axal-hairline bg-white px-5 py-4 text-[14px] font-semibold text-axal-ink dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100" data-testid="cycle-overview-refused">
          {message || 'You cannot open this venture’s Raise.'}
        </div>
      ) : status === 'unreadable' ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30" data-testid="cycle-overview-unreadable">
          <Unreadable what="The Raise overview" claim={message || 'This is not a claim that nothing is recorded.'} onRetry={onRetry} />
        </div>
      ) : !ready ? <Loading /> : (
        <RaiseOverviewBody raw={raw} search={search} readOnly={readOnly} onRetry={onRetry} onRetryCard={onRetryCard} />
      )}
    </div>
  );
}

/** Raise's `Overview` (CycleRoute's `def.Overview` props): the phone root below 1024px, V2 above it. */
export default function RaiseOverview(props) {
  const { user } = useAuth() || {};
  if (props.phone) {
    return <PhoneCycleRoot cycle="raise" raw={props.raw} status={props.status} search={props.search} projectId={props.projectId} message={props.message}
      openAction={props.openAction} onChanged={props.onChanged} onRetry={props.onRetry} />;
  }
  // `data` is the read as adapted (Raise's is unchanged) and takes a card's Retry (`onRetryCard`); `raw` is the first answer.
  // "Also in" follows the overview, as the shared branch of CycleRoute draws it after `CycleOverview` (D563).
  return <>
    <RaiseOverviewView {...props} raw={props.data ?? props.raw} role={user?.role ?? null} />
    <AlsoIn role="founder" row="Raise" />
  </>;
}
