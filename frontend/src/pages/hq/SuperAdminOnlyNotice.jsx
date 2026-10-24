import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import { HQ_EYEBROW, HQ_LINKS, HQ_TITLE, hqLine } from './hqNoticeModel';

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
  // D940 (#2745, SHL7a): the canvas's card. It names what HQ manages here and links Studio and My licence, never the console.
  const { pathname } = useLocation();
  return (
    <section aria-labelledby="super-admin-only-title" className="mx-auto mt-14 w-full max-w-[600px] rounded-xl border-[1.5px] border-dashed border-gray-300 bg-white p-6 dark:border-gray-700 dark:bg-gray-900" data-testid="super-admin-only-notice">
      <div className="flex items-center gap-2 text-[10.5px] font-extrabold uppercase tracking-[.09em] text-axal-muted dark:text-gray-400">
        <Landmark size={13} aria-hidden="true" /> {HQ_EYEBROW}
      </div>
      <h1 id="super-admin-only-title" className="mt-2 text-[18px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100">{HQ_TITLE}</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-axal-muted dark:text-gray-400" data-testid="super-admin-only-line">{hqLine(pathname)}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {HQ_LINKS.map((l, i) => (
          <Link key={l.href} to={l.href}
            className={`inline-flex min-h-[40px] items-center rounded-[9px] px-3.5 text-[13px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet ${i === 0
              ? 'border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800'
              : 'text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200'}`}>
            {l.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
