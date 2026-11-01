import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import RailFrame from '../../../ui/RailFrame';
import { CYCLE_GUTTER } from '../../cycles/cyclePaths';
import './PitchPage.css';
import { STUDIO_PATH, ventureQuery } from './pitchStudioModel';
import DeckAsk from './DeckAsk';

// #3717: Raise is the overview; the studio remains the Pitch deck destination.
export const PITCH_RAISE_PATH = '/raise';

/**
 * D1604 (#3716): the header's right side is the deck's Ask (`DeckAsk.jsx`) on
 * every width, in place of D698's phone-only `EadwynButton`, which opened the
 * rail. Without that button the rail keeps its own floating button on a
 * phone, so the rail stays one tap away. `ask` is `{ projectId, readOnly,
 * onPlace?, onChanged? }`; a reader (read-only HQ) gets no Ask.
 *
 * D1604 (pd0, pd3): the editor passes `heading` (the h1 "[Venture] · vN",
 * under the crumb) and `tools` (`DeckToolbar.jsx`: the save state, ⋯,
 * Present and Share ▾), drawn left of the Ask. Nothing else sits there.
 */
export function PitchCrumb({ trail = null, query, ask = null, heading = null, tools = null }) {
  const [params] = useSearchParams();
  const q = query ?? ventureQuery(params.get('project_id') || params.get('project'));
  const raise = `${PITCH_RAISE_PATH}${q}`;
  const studio = `${STUDIO_PATH}${q}`;
  const link = 'text-axal-muted hover:text-axal-violet dark:text-gray-400 dark:hover:text-violet-300';
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <nav aria-label="Breadcrumb" className="hidden min-w-0 flex-wrap items-center gap-1.5 font-mono text-[11px] uppercase tracking-[.07em] text-axal-muted dark:text-gray-400 sm:flex" data-testid="pitch-crumb">
          <Link to={raise} className={link}>Raise</Link><span aria-hidden="true">›</span>
          {trail ? <><Link to={studio} className={link}>Pitch deck</Link><span aria-hidden="true">›</span><span className="min-w-0 break-words" aria-current="page">{trail}</span></> : <span aria-current="page">Pitch deck</span>}
        </nav>
        <Link to={trail ? studio : raise} className="inline-flex min-h-[44px] items-center text-[13px] font-bold text-axal-violet dark:text-violet-300 sm:hidden" data-testid="pitch-back">‹ {trail ? 'Pitch deck' : 'Raise'}</Link>
        {heading ? <h1 className="m-0 truncate text-[20px] font-extrabold leading-tight text-axal-ink dark:text-gray-100" data-testid="pitch-heading">{heading}</h1> : null}
      </div>
      {tools || (ask && !ask.readOnly && ask.projectId != null) ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2" data-testid="pitch-header-tools">
          {tools}
          {ask && !ask.readOnly && ask.projectId != null ? <div className="shrink-0" data-testid="pitch-header-ask"><DeckAsk {...ask} /></div> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The cycle frame, with its rail at the page edge and one breadcrumb. */
export default function PitchPage({ rail, crumb, ask = null, testId, children }) {
  return (
    <RailFrame rail={rail} className="pitch-page-frame" data-testid={testId}>
      <div className="@container/cycle min-w-0">
        <div className={`${CYCLE_GUTTER} flex flex-col gap-3`}>
          <PitchCrumb {...crumb} ask={ask} />
          {children}
        </div>
      </div>
    </RailFrame>
  );
}
