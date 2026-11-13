import React, { lazy } from 'react';
import { Route } from 'react-router-dom';
import { influencerActiveOf } from '../sidebarConfig';
import { shellRoleFor } from '../lib/shellRole';

const InfluencerSectionPage = lazy(() => import('../pages/influencer/section/InfluencerSectionPage'));

/**
 * `/influencer` and its five tabs — D4289 P7 (#4296), IN0–IN6. Guarded on the
 * membership, not on a role: any signed-in member may open the address
 * (`authOnly`), and the page draws the section only while `/api/auth/me`'s
 * `influencer_active` is 1 (`member`), re-reading the membership itself.
 * `role` (the shell role) picks the viewer's accent and rail, and nothing else.
 */
export default function influencerRoutes({ authOnly, user, effectiveRole }) {
  const member = influencerActiveOf(user);
  const role = shellRoleFor(effectiveRole, user);
  return (
    <>
      <Route path="/influencer" element={authOnly(<InfluencerSectionPage member={member} role={role} />)} />
      <Route path="/influencer/links" element={authOnly(<InfluencerSectionPage member={member} role={role} />)} />
      <Route path="/influencer/offers" element={authOnly(<InfluencerSectionPage member={member} role={role} />)} />
      <Route path="/influencer/earnings" element={authOnly(<InfluencerSectionPage member={member} role={role} />)} />
      <Route path="/influencer/audience" element={authOnly(<InfluencerSectionPage member={member} role={role} />)} />
      <Route path="/influencer/resources" element={authOnly(<InfluencerSectionPage member={member} role={role} />)} />
    </>
  );
}
