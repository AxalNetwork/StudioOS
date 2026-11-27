import React from 'react';
import CompetitorAnalysis from '../components/CompetitorAnalysis';

// Standalone Competitor Analysis route (/build/competitors). Kept for saved-
// analysis deep links (?id=) and the custom-market mode; no longer surfaced in
// the sidebar (Task #3 folded the startup-scoped view into the startup detail
// page). The shared component below also renders embedded on ProjectDetail.
//
// IT FORWARDS ITS PROPS, AND IT USED TO SWALLOW THEM. This took no props at
// all, so `<CompetitorAnalysisPage embedded />` in `ResearchWorkspace` reached
// `CompetitorAnalysis` as its default `embedded = false` and the full
// standalone page — its own header, its own chrome — rendered inside a shell
// that had already drawn both. Same failure as `SignalsPage` on the sibling
// zone, arrived at independently, which is why a guard now covers the shape
// rather than the two instances.
export default function CompetitorAnalysisPage(props) {
  return <CompetitorAnalysis {...props} />;
}
