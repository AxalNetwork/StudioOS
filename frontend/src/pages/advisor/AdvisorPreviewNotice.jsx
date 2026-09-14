import React from 'react';
import { Link } from 'react-router-dom';
import { UserCog } from 'lucide-react';

/**
 * What an admin previewing the Advisor role is told, ABOVE the workspace.
 *
 * WHAT THIS REPLACED FIRST. `advisorPrivateWorkspace` returned
 * `<Navigate to="/studio" replace />`. The access boundary was right — these
 * surfaces render one advisor's clients, bookings and engagements, and an admin
 * in View-as-Advisor has selected a ROLE, not a person, so there is no practice
 * to scope them to. The silent redirect was not: clicking Practice and landing
 * on Studio with no explanation is indistinguishable from a broken link, and
 * that is exactly how it was reported.
 *
 * WHAT IT REPLACES NOW, AND WHY THE SHAPE CHANGED. It became a full card that
 * stood INSTEAD of the body, on every one of twenty routes. The reader clicked
 * eighteen Practice, Cohorts and Expertise zones plus two advisory routes and
 * got the same card each time — reported, in these words, as "unnecessary". The
 * boundary was being stated twenty times and the product never once.
 *
 * So it is a LINE now, and the zone renders under it. That keeps the thing the
 * card was defending, which `advisor_shell.test.mjs` argued for when Cohorts
 * joined the gate: without a stated boundary an admin sees "no batch assigned"
 * and reads a boundary as an absence. The boundary is still stated — in words,
 * on the page, above the zone — and the zone is visible beneath it, so the two
 * are no longer in competition. A one-line strip can sit above eighteen
 * different pages; a card cannot, because it IS the page.
 *
 * Nothing about access changed. Every `/api/advisors/me/*` read goes through
 * `requireMyAdvisor`, which throws "No advisor profile attached to your
 * account" for a caller with no advisor row — so an admin's zone renders its
 * own frame over no rows, and no endpoint hands back a practice that is not
 * theirs. Impersonating a specific advisor remains the way in, and it is a
 * different act from previewing a role: it names whose practice is being
 * opened, and the audit trail records it.
 */
export default function AdvisorPreviewNotice() {
  return (
    <div
      className="mb-3.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[8px] border border-dashed border-axal-hairline bg-axal-ground px-3 py-2 text-[11.5px] leading-relaxed text-axal-muted"
      data-testid="advisor-preview-notice"
    >
      <span className="inline-flex items-center gap-1.5 font-extrabold uppercase tracking-[.08em] text-[10px] text-axal-faint">
        <UserCog size={12} /> Advisor preview
      </span>
      <span>
        You are previewing the Advisor role, not a person — this workspace belongs to one
        advisor, so it is showing you nobody’s.
      </span>
      <Link to="/admin" className="font-bold text-emerald-700 underline">
        Impersonate an advisor to open theirs →
      </Link>
    </div>
  );
}
