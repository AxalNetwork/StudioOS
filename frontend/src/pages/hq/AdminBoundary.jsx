import React from 'react';
import { Link } from 'react-router-dom';
import { ADMIN_BOUNDARY } from './adminBoundaryModel';

/**
 * What a member who is not an admin sees on an `/admin` page (canvas SHL7b,
 * D940), drawn by `RoleGuard` in place of its redirect.
 *
 * Before this, `RoleGuard` sent them to their home with no word, which is the
 * kind of silent bounce `App.jsx` itself calls a broken link: a member who
 * followed a link to `/admin/kyc` landed on Studio and could not tell why.
 * The card says whose page it is and what to do, inside the member's own
 * shell, and reads nothing: no admin data is fetched behind it.
 *
 * Only `/admin` routes draw it, and only for the roles in
 * `ADMIN_BOUNDARY_ROLES` (`adminBoundaryModel.js`). Every other guarded route
 * keeps its redirect, and `pending` keeps its pin to onboarding.
 */
export default function AdminBoundary({ home = '/studio' }) {
  return (
    <section
      aria-labelledby="admin-boundary-title"
      className="mx-auto mt-14 flex w-full max-w-[520px] flex-col items-center gap-2.5 rounded-xl border border-axal-hairline bg-white p-7 text-center dark:border-gray-800 dark:bg-gray-900"
      data-testid="admin-boundary"
    >
      <span
        aria-hidden="true"
        className="grid h-11 w-11 place-items-center rounded-full border border-[#ddd0fb] bg-[#f4f0fe] text-[18px] font-bold text-axal-violet-deep dark:border-[#4c3a8a] dark:bg-[#211f3d] dark:text-violet-300"
      >
        ⊘
      </span>
      <h1 id="admin-boundary-title" className="m-0 text-[16px] font-extrabold leading-[1.35] tracking-[-.01em] text-axal-ink dark:text-gray-100">
        {ADMIN_BOUNDARY.title}
      </h1>
      <p className="m-0 text-[13px] leading-[1.55] text-axal-muted dark:text-gray-400">{ADMIN_BOUNDARY.line}</p>
      <div className="flex justify-center gap-2">
        <Link
          to={home}
          className="inline-flex min-h-[40px] items-center justify-center rounded-[9px] border border-axal-violet bg-axal-violet px-4 text-[13px] font-bold text-white no-underline hover:bg-axal-violet-deep"
        >
          {ADMIN_BOUNDARY.action}
        </Link>
      </div>
    </section>
  );
}
