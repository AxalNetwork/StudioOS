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
 */
export function PitchCrumb({ trail = null, query, ask = null }) {
  const [params] = useSearchParams();
  const q = query ?? ventureQuery(params.get('project_id') || params.get('project'));
  const raise = `${PITCH_RAISE_PATH}${q}`;
  const studio = `${STUDIO_PATH}${q}`;
  const link = 'text-axal-muted hover:text-axal-violet dark:text-gray-400 dark:hover:text-violet-300';
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="min-w-0">
        <nav aria-label="Breadcrumb" className="hidden min-w-0 flex-wrap items-center gap-1.5 font-mono text-[11px] uppercase tracking-[.07em] text-axal-muted dark:text-gray-400 sm:flex" data-testid="pitch-crumb">
          <Link to={raise} className={link}>Raise</Link><span aria-hidden="true">›</span>
          {trail ? <><Link to={studio} className={link}>Pitch deck</Link><span aria-hidden="true">›</span><span className="min-w-0 break-words" aria-current="page">{trail}</span></> : <span aria-current="page">Pitch deck</span>}
        </nav>
        <Link to={trail ? studio : raise} className="inline-flex min-h-[44px] items-center text-[13px] font-bold text-axal-violet dark:text-violet-300 sm:hidden" data-testid="pitch-back">‹ {trail ? 'Pitch deck' : 'Raise'}</Link>
      </div>
      {ask && !ask.readOnly && ask.projectId != null ? <div className="shrink-0" data-testid="pitch-header-ask"><DeckAsk {...ask} /></div> : null}
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
