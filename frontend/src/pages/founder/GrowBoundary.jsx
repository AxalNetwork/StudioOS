import React from 'react';
import { Link } from 'react-router-dom';

/**
 * #4579 (D4579) — what a signed-in account that cannot use Grow reads on a Grow address, instead of being sent home
 * without a word. Drawn by App.jsx's RoleGuard (D914's route boundaries) exactly where it would have redirected; the
 * route's guard and the Worker's checks are unchanged.
 *
 * The next step is the true one: Grow is the founder workspace, and an account adds the Founder licence from
 * Licences (D4472). A support session (impersonation) is not offered a licence on someone else's behalf.
 */
export const GROW_BOUNDARY = Object.freeze({
  title: 'Grow is the founder workspace',
  line: 'This account does not hold the Founder licence, so Grow is not open to it. Add the Founder licence to use Grow, or go back to your home.',
  support: 'The account you are supporting does not hold the Founder licence, so Grow is not open to it.',
  add: 'Add the Founder licence',
  home: 'Go to your home',
});

export const GROW_BOUNDARY_ROLES = new Set(['investor', 'advisor', 'partner', 'exploring']);

export default function GrowBoundary({ home = '/studio', impersonating = false }) {
  return (
    <main className="mx-auto max-w-xl px-4 pb-16 pt-10 sm:px-6" data-testid="grow-boundary">
      <section className="rounded-xl border border-axal-hairline bg-white p-5 dark:border-gray-800 dark:bg-gray-900" role="status">
        <h1 className="m-0 text-[18px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{GROW_BOUNDARY.title}</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-axal-muted dark:text-gray-400">
          {impersonating ? GROW_BOUNDARY.support : GROW_BOUNDARY.line}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {!impersonating && (
            <Link
              to="/account/licences#add-licence"
              className="inline-flex min-h-[44px] items-center rounded-[9px] bg-axal-violet px-3.5 py-2 text-[13px] font-bold text-white hover:bg-axal-violet-deep"
            >
              {GROW_BOUNDARY.add}
            </Link>
          )}
          <Link
            to={home}
            className="inline-flex min-h-[44px] items-center rounded-[9px] border border-axal-hairline bg-white px-3.5 py-2 text-[13px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            {GROW_BOUNDARY.home}
          </Link>
        </div>
      </section>
    </main>
  );
}
