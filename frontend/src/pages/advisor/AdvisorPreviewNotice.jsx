import React from 'react';
import { Link } from 'react-router-dom';
import { UserCog } from 'lucide-react';
import { Card } from '../../ui';

/**
 * What an admin previewing the Advisor role sees instead of a practice.
 *
 * WHAT THIS REPLACES. `advisorPrivateWorkspace` used to return
 * `<Navigate to="/studio" replace />`. The access boundary was right — these
 * surfaces render one advisor's clients, bookings and engagements, and an admin
 * in View-as-Advisor has selected a ROLE, not a person, so there is no practice
 * to scope them to. The silent redirect was not: clicking Practice and landing
 * on Studio with no explanation is indistinguishable from a broken link, and
 * that is exactly how it was reported.
 *
 * THE BOUNDARY IS NOW STATED, AND CONSISTENT. It used to guard
 * `/advisor/advisory/*` and `/office-hours` while `/practice/*` and
 * `/expertise/*` rendered the same two components ungated — the same private
 * data reachable at one path and blocked at another.
 *
 * Impersonating a specific advisor is the way in, and it is a different act
 * from previewing a role: it names whose practice is being opened, and the
 * audit trail records it.
 */
export default function AdvisorPreviewNotice() {
  return (
    <Card className="border-dashed bg-axal-surface-2 p-6" data-testid="advisor-preview-notice">
      <div className="max-w-2xl">
        <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
          <UserCog size={13} /> Advisor preview
        </div>
        <h2 className="mt-2 text-lg font-extrabold tracking-tight">
          This workspace belongs to one advisor
        </h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-axal-ink-2">
          You are previewing the Advisor role, not a person. Practice and Expertise render a
          single advisor’s clients, bookings, engagements and profile — there is no practice to
          show until the workspace is scoped to someone.
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-axal-ink-2">
          Impersonate a specific advisor to open theirs. That is a deliberate act with an audit
          trail behind it, which is the difference between reading a role and reading a person’s
          book.
        </p>
        <p className="mt-3 flex flex-wrap gap-3 text-[12px]">
          <Link to="/admin" className="text-emerald-700 underline">Find an advisor to impersonate →</Link>
          <Link to="/studio" className="text-emerald-700 underline">Back to Studio →</Link>
        </p>
      </div>
    </Card>
  );
}
