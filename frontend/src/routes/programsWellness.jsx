import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const WellnessPresentationPage = lazy(() => import('../pages/wellbeing/WellnessPresentationPage'));

/**
 * `/programs/wellness` — the public Wellness presentation (D7121, #7121; D7121
 * part 1). Signed out, no guard: it reads nothing and shows no one's data. The
 * private workspace stays at `/wellbeing`, guarded in `App.jsx`. A literal
 * path, so the kit's `/programs/:key` (#6966) never shadows it.
 */
export default function programsWellnessRoutes() {
  return (
    <>
      <Route path="/programs/wellness" element={<WellnessPresentationPage />} />
    </>
  );
}
