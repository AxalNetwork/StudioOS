import React from 'react';
import { Link } from 'react-router-dom';
import { actionPrimary } from '../../../ui';
import { REFUSALS } from './fundAdminModel';

/**
 * D1160 (#3067, FND20): the canvas's centred refusals, in its words — a
 * branch admin (FND20a), a support session (FND20b) and anyone who is not an
 * admin (FND20c). Each makes no read.
 */
export function Refusal({ kind, home = null, testId }) {
  const r = REFUSALS[kind];
  const to = r.action?.to || home || '/studio';
  return (
    <section className="mx-auto mt-[70px] flex w-full max-w-[600px] flex-col items-center gap-2 rounded-xl border border-axal-hairline bg-white p-6 text-center dark:border-gray-800 dark:bg-gray-900" data-testid={testId}>
      <span aria-hidden="true" className="text-[22px] leading-none text-axal-muted dark:text-gray-400">⊘</span>
      <h1 className="m-0 text-[18px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100">{r.title}</h1>
      <p className="m-0 text-[13px] leading-relaxed text-axal-muted dark:text-gray-400">{r.line}</p>
      {r.action ? <Link to={to} className={`${actionPrimary} mt-2`} data-testid={`${testId}-action`}>{r.action.label}</Link> : null}
    </section>
  );
}

/**
 * The route guard's panel for `/admin/fund-admin` (App.jsx ROUTE_BOUNDARIES):
 * a support session is told the session cannot read it; anyone else who is
 * not an admin, that the page is for studio admins.
 */
export default function FundAdminBoundary({ home = '/studio', impersonating = false }) {
  return (
    <main className="mx-auto max-w-[1440px] px-4 pb-16 sm:px-6" data-testid="fund-admin-boundary">
      {impersonating
        ? <Refusal kind="support" testId="fund-admin-support" />
        : <Refusal kind="member" home={home} testId="fund-admin-member" />}
    </main>
  );
}
