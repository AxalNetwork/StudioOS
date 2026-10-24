import React from 'react';
import { Link } from 'react-router-dom';

/**
 * What an admin without the elevation sees on an HQ-only route (canvas SHL7a,
 * D940).
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
 *
 * D940: SHL7a's card. Its title is the page's one h1, because `hqOnly` draws
 * it in place of the page and its header. There is no "Admin Console" link:
 * the canvas sends a studio admin to Studio. The canvas's line opens with what
 * HQ manages on its example page (bank accounts); this notice stands in for
 * every HQ-only page, so it keeps the part that is true of all of them.
 */
export const SUPER_ADMIN_ONLY = {
  eyebrow: 'HQ only',
  title: 'This page belongs to the Super Admin',
  line: 'You are signed in as a studio admin, so this page stays closed rather than opening and refusing each action.',
};

const BTN = 'inline-flex min-h-[40px] items-center justify-center rounded-[9px] px-4 text-[13px] font-bold no-underline';

export default function SuperAdminOnlyNotice() {
  return (
    <section
      aria-labelledby="super-admin-only-title"
      className="mx-auto mt-14 flex w-full max-w-[600px] flex-col gap-2.5 rounded-xl border-[1.5px] border-dashed border-[#d9d6e2] bg-white p-7 dark:border-gray-600 dark:bg-gray-900"
      data-testid="super-admin-only-notice"
    >
      <span className="font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">
        {SUPER_ADMIN_ONLY.eyebrow}
      </span>
      <h1 id="super-admin-only-title" className="m-0 text-[16px] font-extrabold leading-[1.35] tracking-[-.01em] text-axal-ink dark:text-gray-100">
        {SUPER_ADMIN_ONLY.title}
      </h1>
      <p className="m-0 text-[13px] leading-[1.55] text-axal-muted dark:text-gray-400">{SUPER_ADMIN_ONLY.line}</p>
      <div className="flex flex-wrap gap-2">
        <Link
          to="/studio"
          className={`${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`}
        >
          Go to Studio
        </Link>
        <Link
          to="/admin/my-licence"
          className={`${BTN} px-2 text-axal-violet-deep hover:underline dark:text-violet-300`}
        >
          My licence
        </Link>
      </div>
    </section>
  );
}
