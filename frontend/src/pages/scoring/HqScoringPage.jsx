/**
 * D1253 (#2428) — SC13 "Platform › Scoring" at `/admin/platform/scoring`, HQ
 * only: model versions, the country indices and the fairness check. None is
 * stored yet, so each block says what waits and on which part.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { ScorecardWait } from '../../components/scoring/scorecard/Scorecard';
import { METHOD } from '../../components/scoring/scorecard/scorecardModel';

const box = 'flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';

export default function HqScoringPage() {
  return (
    <div className="flex flex-col gap-4" data-testid="hq-scoring">
      <div>
        <p className="m-0 font-mono text-[11px] uppercase tracking-[.07em] text-axal-muted">Platform › Scoring</p>
        <div className="flex items-center gap-2">
          <h1 className="m-0 text-2xl font-extrabold tracking-tight">Scoring</h1>
          <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300">HQ only</span>
        </div>
        <p className="m-0 text-sm text-axal-muted">The model behind every venture scorecard: its versions, the country indices it reads, and the fairness check. <Link to={METHOD} className="font-semibold text-violet-700 underline dark:text-violet-300">How scoring works</Link></p>
      </div>
      <section className={box} data-testid="hq-scoring-models"><h2 className="m-0 text-[15px] font-bold">Model versions</h2><ScorecardWait id="models" /></section>
      <section className={box} data-testid="hq-scoring-indices"><h2 className="m-0 text-[15px] font-bold">Country indices</h2><ScorecardWait id="indices" /></section>
      <section className={box} data-testid="hq-scoring-fairness"><h2 className="m-0 text-[15px] font-bold">Fairness check</h2><ScorecardWait id="fairness" /></section>
    </div>
  );
}
