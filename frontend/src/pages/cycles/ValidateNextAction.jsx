import { Link } from 'react-router-dom';
import { isPlainClick } from './cycleModel';
import CycleMeter from './CycleMeter';
import { cycleValidateApi } from '../../lib/api/cycleValidate';
import { phoneFocus, rootMeter } from './validatePhone';

/**
 * D4589 (#4589) — Validate's next action on the desktop overview: the same
 * Worker `focus` the phone root draws (`services/validateNextAction.ts`),
 * read through the same adapter (`phoneFocus`), so a venture state gives one
 * action on both. It sits in the overview's lead row, between the figures and
 * the cards. The header's Record a session stays as it was, so recording is
 * always in reach as a secondary action.
 *
 * Drawn in the lavender panel of Plan the build (VB2a, `BuildPlan.jsx`
 * `PlanFromVerdict`), the approved desktop pattern for one line and one
 * button; no canvas draws a desktop next-action panel of its own.
 *
 *   raw         the overview read as sent (its `focus`)
 *   search      the page's query, for the adapter's fallbacks
 *   openAction  opens Record a session over the page on a plain click
 *
 * A step that could not be worked out says so, with no primary button. With
 * no focus at all the panel draws nothing, as the phone does.
 */
const BTN = 'inline-flex min-h-[40px] items-center rounded-[9px] bg-axal-violet px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet';
const LINK = 'text-[12.5px] font-semibold text-axal-violet-deep hover:underline focus-visible:underline dark:text-violet-300';
const RECORD = '/validate/record';

export default function ValidateNextAction({ raw, search = '', openAction }) {
  const focus = phoneFocus(raw, search, 'validate');
  if (!focus) return null;
  const opens = (href) => (openAction && String(href).split(/[?#]/)[0] === RECORD
    ? (e) => { if (isPlainClick(e)) { e.preventDefault(); openAction(); } } : undefined);
  const tone = focus.unavailable
    ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30'
    : 'border-axal-lavender-edge bg-axal-lavender dark:border-violet-800 dark:bg-violet-900/30';
  return (
    <section aria-labelledby="validate-next-title" data-testid="validate-next-action" data-rule={focus.rule || ''}
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-[18px] py-3.5 ${tone}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-violet dark:text-violet-300">{focus.eyebrow}</span>
        <h2 id="validate-next-title" className="m-0 text-[15px] font-extrabold leading-[1.35] text-axal-ink dark:text-gray-100">{focus.headline}</h2>
        {focus.why && <p className={`m-0 text-[13px] leading-relaxed ${focus.unavailable ? 'text-red-700 dark:text-red-300' : 'text-axal-ink/80 dark:text-gray-300'}`} data-testid="validate-next-why">{focus.why}</p>}
        {focus.then && <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="validate-next-then">Then: {focus.then.replace(/^then\s*:?\s+/i, '')}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {(focus.secondary || []).map((s) => (
          <Link key={s.href} to={s.href} className={LINK} onClick={opens(s.href)} data-testid="validate-next-secondary">{s.label}</Link>
        ))}
        {focus.href && (
          <Link to={focus.href} className={BTN} onClick={opens(focus.href)} aria-haspopup={opens(focus.href) ? 'dialog' : undefined}
            data-testid="validate-next-cta">{focus.cta}</Link>
        )}
      </div>
    </section>
  );
}

/** The desktop meter's frame: the lead row's white card (Raise's lead cards, `RaiseOverviewLead.jsx`), the phone's meter inside it. */
const METER_CARD = 'rounded-xl border border-axal-hairline bg-white px-[18px] py-3.5 dark:border-gray-800 dark:bg-gray-900';

/**
 * #5999 — Validate's desktop lead row: the next action and, beside it, the
 * monthly interviews meter with "Set a target" (`CycleMeter.jsx`, the phone
 * root's own, lifted), from the same read through the same `rootMeter`, so
 * one read draws one meter on both widths. The owner chose to add it to
 * desktop (2026-11-14), though the Validate v2 desktop canvas (PR #5858)
 * draws the count alone. Laid out as Raise's lead row: the two at 3fr / 2fr
 * from 1280px, stacked below. With no meter the next action draws alone, as
 * before; with neither, nothing.
 *
 *   projectId  the venture a writer saves to, as the phone root takes it; the control
 *              is drawn only where the read says `can_write`, as on the phone
 *   onChanged  a saved target re-reads the overview
 */
export function ValidateLead({ raw, search = '', openAction, projectId = null, api = cycleValidateApi, onChanged }) {
  const meter = rootMeter(raw, phoneFocus(raw, search, 'validate'), 'validate');
  const next = <ValidateNextAction raw={raw} search={search} openAction={openAction} />;
  if (!meter) return next;
  return (
    <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" data-testid="validate-lead">
      {next}
      <CycleMeter meter={meter} cycle="validate" canWrite={raw?.can_write === true} projectId={projectId} api={api} onChanged={onChanged} ids="validate" className={METER_CARD} />
    </div>
  );
}
