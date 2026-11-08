// D4574 (#4574, H6): the skills radar behind a lazy boundary. `SkillRadar`
// draws with recharts (its CategoricalChart chunk is about 250 KiB raw), and
// ProfileFitSection is on every member's Studio home, so a static import put
// recharts in the Dashboard chunk's closure for every role (#4573 §2). This
// wrapper takes the same props, fetches the chart only when a radar draws, and
// holds its box at the radar's own height meanwhile, so nothing shifts.
//
// A chunk that fails to load throws inside the route tree; RouteErrorBoundary
// and main.jsx's `vite:preloadError` handler recover it as they do any lazy
// route (lib/chunkLoadError.js). Code that needs `AreaTick` or the chart
// itself still imports `./SkillRadar.jsx`.
import React, { Suspense, lazy } from 'react';

const SkillRadar = lazy(() => import('./SkillRadar.jsx'));

export default function SkillRadarLazy(props) {
  const height = props.height ?? 300;
  return (
    <Suspense
      fallback={(
        <div
          data-testid="skill-radar-loading"
          aria-hidden="true"
          style={{ width: '100%', height }}
          className="animate-pulse rounded-[10px] bg-axal-ground dark:bg-gray-800"
        />
      )}
    >
      <SkillRadar {...props} />
    </Suspense>
  );
}
