// D4574 (#4574, H5): one cycle step behind a lazy boundary.
//
// CycleRoute.jsx draws every cycle's overview, module pages, records and tool
// tabs, and it imported each step statically, so `/validate`, `/build`,
// `/raise` and `/grow` all fetched one chunk of about 1,100 KiB raw holding
// every step (#4573 §2, H5). `lazyStep(load, name)` returns a component that
// takes the step's own props and fetches its module the first time it draws,
// so a step page loads its own step.
//
//   const CapTableTabPage = lazyStep(() => import('../raise/captable/CapTableTool'), 'CapTableTabPage');
//
// The step keeps its local name in CycleRoute, so every render site, route and
// deep link reads as before. `fallback: null` is for a step drawn in a slot the
// page sizes itself (a tab bar, a door link); every other step holds its place
// with the repo's skeleton (`animate-pulse` on `bg-axal-ground`).
//
// Only components go through here. A hook, a model function or a constant a
// render reads synchronously stays a static import, since it cannot wait.
//
// A chunk that fails to load throws inside the route tree, where
// RouteErrorBoundary and main.jsx's `vite:preloadError` handler reload once
// onto the current shell (lib/chunkLoadError.js), as for every lazy route in
// App.jsx. A named export that is missing throws the same way, never a blank.
import React, { Suspense, lazy } from 'react';

export function StepLoading() {
  return <div data-testid="cycle-step-loading" aria-busy="true" className="h-40 animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" />;
}

export function lazyStep(load, name = 'default', { fallback = <StepLoading /> } = {}) {
  const Lazy = lazy(() => load().then((m) => {
    if (typeof m?.[name] !== 'function' && typeof m?.[name] !== 'object') throw new Error(`lazyStep: the module has no export ${name}`);
    return { default: m[name] };
  }));
  function Step(props) {
    return <Suspense fallback={fallback}><Lazy {...props} /></Suspense>;
  }
  Step.displayName = `lazyStep(${name})`;
  return Step;
}
