/**
 * D1253 (#2428) — SC8 "Investor scorecard" at `/raise/scorecard`: the founder's
 * own scorecard. The panel is SC1's; every scope waits for the read (part 3),
 * and so does "What investors see" (part 5). Until sharing is stored, no
 * investor sees a score of this venture.
 */
import React from 'react';
import VentureScorecard from '../../components/scoring/scorecard/Scorecard';

export default function FounderScorecardPage() {
  return (
    <main className="flex flex-col gap-4 p-5 text-axal-ink dark:text-gray-100" data-testid="founder-scorecard">
      <div>
        <p className="m-0 font-mono text-[11px] uppercase tracking-[.07em] text-axal-muted">Raise › Investor scorecard</p>
        <h1 className="m-0 text-2xl font-extrabold tracking-tight">Investor scorecard</h1>
        <p className="m-0 text-sm text-axal-muted">How your venture reads to investors in your deal flow, scope by scope, with the evidence behind each.</p>
      </div>
      <VentureScorecard audience="founder" />
    </main>
  );
}
