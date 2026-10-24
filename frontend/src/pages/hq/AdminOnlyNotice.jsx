import React from 'react';
import { Link } from 'react-router-dom';
import { ADMIN_HOME_LABEL, ADMIN_LINE, ADMIN_TITLE } from './hqNoticeModel';

/**
 * D940 (#2745, SHL7b): what a member who is not an admin sees on an
 * `/admin/*` page, in their own shell, instead of RoleGuard's silent redirect
 * home. `home` is their role's home (ROLE_DEFAULT_PATH).
 */
export default function AdminOnlyNotice({ home = '/studio' }) {
  return (
    <div className="mx-auto mt-14 w-full max-w-[520px] rounded-xl border border-axal-hairline bg-white p-6 text-center dark:border-gray-800 dark:bg-gray-900" data-testid="admin-only-notice">
      <div aria-hidden="true" className="text-[22px] leading-none text-axal-muted dark:text-gray-400">⊘</div>
      <h1 className="mt-3 text-[18px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100">{ADMIN_TITLE}</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-axal-muted dark:text-gray-400">{ADMIN_LINE}</p>
      <div className="mt-4 flex justify-center">
        <Link to={home} className="inline-flex min-h-[40px] items-center rounded-[9px] bg-axal-violet px-4 text-[13px] font-bold text-white hover:bg-axal-violet-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet" data-testid="admin-only-home">
          {ADMIN_HOME_LABEL}
        </Link>
      </div>
    </div>
  );
}
