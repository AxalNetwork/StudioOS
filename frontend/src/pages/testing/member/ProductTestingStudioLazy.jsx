// D4574 (#4574, H6): the Product testing section behind a lazy boundary.
// `ProductTestingStudio` with its sheets and API module is about 230 KiB raw,
// and Dashboard.jsx imported it statically, so every Studio home, the Admin's
// included (which never draws it), fetched it before anything rendered
// (#4573 §2). Dashboard now imports this wrapper: same props, the section's
// chunk is fetched once a member home mounts it, and a skeleton in the
// section's own card shape holds its place meanwhile.
//
// A chunk that fails to load throws inside the route tree; RouteErrorBoundary
// and main.jsx's `vite:preloadError` handler recover it as they do any lazy
// route (lib/chunkLoadError.js). ExploringDashboard and the tests still import
// `./ProductTestingStudio.jsx` itself.
import React, { Suspense, lazy } from 'react';

const ProductTestingStudio = lazy(() => import('./ProductTestingStudio.jsx'));

export default function ProductTestingStudioLazy(props) {
  return (
    <Suspense
      fallback={(
        <div
          data-testid="pt-studio-loading"
          aria-hidden="true"
          className="h-[150px] animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800 lg:max-w-[380px]"
        />
      )}
    >
      <ProductTestingStudio {...props} />
    </Suspense>
  );
}
