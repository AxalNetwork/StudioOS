/**
 * Admin Studio — the admin profile's front door.
 *
 * Eadwyn (the chat, the ticket, Proposed / Pending / Completed) is
 * PersonalAdvisor, mounted through StudioInterview, which collapses it to one
 * row once the interview is complete (D324). Under it, in the canvas's order (D246): the operating
 * posture, what needs a decision, then one card per other Admin page in the
 * sidebar's order. The needs-a-decision tiles and the cards each read the
 * studio glance (D443, D512); the posture makes its own read because the bank
 * is the admin's, so it renders on and off a branch. Skills, values and archetype are a founder's fit block and do not
 * belong here.
 */
import React from 'react';
import StudioInterview from '../../components/advisor/StudioInterview';
import { AdminStudioOverview } from './AdminStudioOverview';
import StudioPosture from './StudioPosture';
import { StudioNeedsDecisionView } from './StudioNeedsDecision';

/**
 * D512 — NO READS OF ITS OWN. The four branch reads this page used to make
 * (`branchHome`, `myLicence`, `branchTemplates`, `branchInsights`) are gone:
 * the needs-a-decision strip and the overview each load the studio glance
 * (D443), which answers on and off a branch, and D447 made both render from
 * it alone. The page passes `user`, and `glance` only when a caller hands one
 * in (a render test); in production it is undefined and each component loads
 * the glance itself.
 */
export default function AdminStudioHome({ user, glance }) {
  return (
    <div data-testid="admin-studio-home">
      <header className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-tight text-axal-ink">Studio</h1>
      </header>
      <StudioInterview persona="admin" />
      <StudioPosture />
      <StudioNeedsDecisionView user={user} glance={glance} />
      <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-axal-muted">
        The other Admin pages, in the order the sidebar lists them.
      </p>
      <AdminStudioOverview user={user} glance={glance} />
    </div>
  );
}
