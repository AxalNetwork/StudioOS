import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { accountLicencesApi } from '../../lib/api/accountLicences.js';
import { CONTACT_TO_ADD, READ_FAILED, grantedLabel, licencesView, planLabel, sourceLabel } from './licencesModel.js';

/**
 * D4473 (#4473) — Account › Licences, `/account/licences`.
 *
 * Every licence this account holds, with its label, "Primary" for the primary one, when it was granted and how, and
 * the plan it stands on; then the licences it could add, each a contact to Axal VC (no purchase in this build).
 * THERE IS NO SWITCH HERE: the sidebar already shows every held licence at once (D4473), so nothing on this page
 * chooses between them.
 */
export default function AccountLicences() {
  const [state, setState] = useState({ status: 'loading', held: [], addable: [] });
  useEffect(() => {
    let alive = true;
    accountLicencesApi.mine()
      .then((body) => { if (alive) setState({ status: 'ready', ...licencesView(body) }); })
      .catch(() => { if (alive) setState({ status: 'error', held: [], addable: [] }); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6" data-testid="account-licences">
      <header>
        <h1 className="text-xl font-bold text-axal-ink dark:text-gray-100">Licences</h1>
        <p className="mt-1 text-sm text-axal-muted dark:text-gray-400">
          The licences this account holds. Every one of them is in your sidebar at once.
        </p>
      </header>

      {state.status === 'loading' && <p className="text-sm text-axal-muted dark:text-gray-400">Reading your licences…</p>}
      {state.status === 'error' && <p role="alert" className="text-sm text-red-600 dark:text-red-400" data-testid="licences-error">{READ_FAILED}</p>}

      {state.status === 'ready' && (
        <>
          <section aria-labelledby="held-licences" className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h2 id="held-licences" className="text-sm font-bold text-axal-ink dark:text-gray-100">Held</h2>
            <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
              {state.held.map((row) => (
                <li key={row.licence} className="py-3 text-[13px]" data-testid={`held-${row.licence}`}>
                  <div className="flex items-center gap-2 font-semibold text-axal-ink dark:text-gray-100">
                    {row.label || row.licence}
                    {row.is_primary && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">Primary</span>}
                  </div>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-axal-muted dark:text-gray-400">
                    <dt>Granted</dt><dd>{row.is_primary ? 'When the account was created' : grantedLabel(row.granted_at)}</dd>
                    <dt>How</dt><dd>{sourceLabel(row.source)}</dd>
                    <dt>Plan</dt><dd>{planLabel(row.plan)}</dd>
                  </dl>
                </li>
              ))}
            </ul>
          </section>

          {state.addable.length > 0 && (
            <section aria-labelledby="add-licence" className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <h2 id="add-licence" className="text-sm font-bold text-axal-ink dark:text-gray-100">Add a licence</h2>
              <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
                {state.addable.map((row) => (
                  <li key={row.licence} className="flex flex-wrap items-center justify-between gap-2 py-3 text-[13px]" data-testid={`addable-${row.licence}`}>
                    <span className="font-semibold text-axal-ink dark:text-gray-100">{row.label || row.licence}</span>
                    <Link to="/help" className="text-violet-700 hover:underline dark:text-violet-300">{CONTACT_TO_ADD}</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
