/**
 * Admin Studio — the admin profile's front door.
 *
 * D8728 (#8728) — THE ORDER IS Needs a decision, At a glance, Setup, Admin
 * pages (canvas SAD01). What needs a decision comes first, before optional
 * setup: the overdue card and any other time-sensitive exception; then the
 * totals; then Setup, the unfinished interview as one resumable row; then one
 * card per other Admin page in the sidebar's order.
 *
 * Eadwyn (the chat, the ticket, Proposed / Pending / Completed) is
 * PersonalAdvisor, mounted through StudioInterview, which collapses it to one
 * row once the interview is complete (D324). The page mounts it once and hands
 * it to Setup, which keeps it closed to one row while the bank is incomplete
 * (⚑3 A) and opens it in place on Resume setup. The needs-a-decision tiles and the cards each read the
 * studio glance (D443, D512); the posture makes its own read because the bank
 * is the admin's, so it renders on and off a branch. Skills, values and archetype are a founder's fit block and do not
 * belong here.
 */
import React from 'react';
import StudioInterview from '../../components/advisor/StudioInterview';
import { AdminStudioOverview } from './AdminStudioOverview';
import { StudioNeedsDecisionView } from './StudioNeedsDecision';
import StudioSetup from './StudioSetup';

/**
 * D512 — NO READS OF ITS OWN. The four branch reads this page used to make
 * (`branchHome`, `myLicence`, `branchTemplates`, `branchInsights`) are gone:
 * the needs-a-decision strip and the overview each load the studio glance
 * (D443), which answers on and off a branch, and D447 made both render from
 * it alone. The page passes `user`, and `glance` only when a caller hands one
 * in (a render test); in production it is undefined and each component loads
 * the glance itself. D8728 ⚑1 A: the overdue card inside the needs-a-decision
 * section makes the Approvals Inbox's own `age=past` read; the page still
 * makes none.
 */
/**
 * D598 — NO WORKER AI RAIL HERE. D556 gave this page the "Studio" rail. The
 * owner removed it on 2026-10-06: the admin's front door never shows a Worker
 * AI sidebar. Eadwyn above (StudioInterview) is the one assistant on the
 * page. Every other Admin page keeps its rail.
 */
export default function AdminStudioHome({ user, glance }) {
  return (
    <div data-testid="admin-studio-home">
      <header className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-tight text-axal-ink">Studio</h1>
      </header>
      <StudioNeedsDecisionView user={user} glance={glance} />
      <StudioSetup chat={<StudioInterview persona="admin" />} />
      <section className="mt-6" aria-labelledby="studio-pages-heading" data-testid="studio-admin-pages">
        <h2 id="studio-pages-heading" className="text-[15px] font-extrabold tracking-tight text-axal-ink">Admin pages</h2>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-axal-muted">
          The other Admin pages, in the order the sidebar lists them.
        </p>
        <AdminStudioOverview user={user} glance={glance} />
      </section>
    </div>
  );
}
