import React from 'react';
import CompetitorAnalysis from '../components/CompetitorAnalysis';

// Standalone Competitor Analysis route (/build/competitors). Kept for saved-
// analysis deep links (?id=) and the custom-market mode; no longer surfaced in
// the sidebar (Task #3 folded the startup-scoped view into the startup detail
// page). The shared component below also renders embedded on ProjectDetail.
export default function CompetitorAnalysisPage() {
  return <CompetitorAnalysis />;
}
