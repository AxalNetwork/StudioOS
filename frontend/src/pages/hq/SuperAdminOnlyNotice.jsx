import React from 'react';
import { Link } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import { Card } from '../../ui';

/**
 * What an admin without the elevation sees on an HQ-only route.
 *
 * The routes behind this — the licence ledger, the holder console, the HQ
 * framings of Contracts and Accounts — are super-admin-only server-side, so
 * before this notice an ordinary admin could reach the page shell and watch
 * every call on it 403. A page that opens and then refuses each action is
 * indistinguishable from a broken one. This states the boundary instead, the
 * way `AdvisorPreviewNotice` does for a role preview.
 *
 * D303 — CORRECTED: this is NOT what View-as shows. `App.jsx`'s `hqOnly`
 * gates on `isSuperAdminUser(user)` — the real signed-in identity — not on
 * `effectiveRole`, the browsed identity View-as sets. So a Super Admin who
 * chooses "Admin" in View-as still passes this check and sees the actual
 * page, never this notice; View-as changes what a preview shows on the
 * PARTNER/founder/advisor/investor surfaces (`AdvisorPreviewNotice` and its
 * siblings), which key off `effectiveRole` on purpose, but it has no effect
 * here. What this notice states is simpler than the deleted sentence claimed:
 * it is what an admin account that has never held the super-admin elevation
 * sees, full stop.
 */
export default function SuperAdminOnlyNotice() {
  return (
    <Card className="border-dashed bg-axal-ground p-6" data-testid="super-admin-only-notice">
      <div className="max-w-2xl">
        <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
          <Landmark size={13} /> HQ only
        </div>
        <h2 className="mt-2 text-lg font-extrabold tracking-tight">
          This console belongs to the Super Admin
        </h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-axal-muted">
          The Super Admin is the single account that licenses the platform to subsidiaries:
          it issues, re-terms, suspends and terminates territory licences, and names who holds
          that power. You are signed in as an admin without that elevation, so this page stays
          closed here rather than opening and refusing every action.
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-axal-muted">
          If you administer a licence, your own read of it is under My Licence. Everything
          else in the admin product is unchanged.
        </p>
        <p className="mt-3 flex flex-wrap gap-3 text-[12px]">
          <Link to="/admin" className="text-rose-800 underline dark:text-rose-300">Admin Console →</Link>
          <Link to="/admin/my-licence" className="text-rose-800 underline dark:text-rose-300">My Licence →</Link>
        </p>
      </div>
    </Card>
  );
}
