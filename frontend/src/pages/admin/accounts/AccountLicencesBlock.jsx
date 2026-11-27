import React, { useCallback, useEffect, useState } from 'react';
import { accountLicencesApi } from '../../../lib/api/accountLicences.js';
import { grantedLabel, sourceLabel } from '../../account/licencesModel.js';

/**
 * D4473 (#4473) — the account drawer's "Licences" block (`/admin/accounts/all/:id`, Profile tab).
 *
 * Lists the member's held licences through `GET /api/admin/accounts/:id/licences` (D4472) and grants or revokes an
 * additional one through its POST and DELETE. The primary licence is not revocable here (the Worker refuses with
 * `primary_licence`), so it has no Revoke. Every refusal is a fixed sentence keyed by its code, never the error text.
 */
export const REFUSAL_WORDS = Object.freeze({
  primary_licence: 'The primary licence cannot be revoked here.',
  invalid_licence: 'That is not a licence this account can hold.',
  not_found: 'This account could not be found.',
  licence_cannot_administer: 'This licence can no longer take an administrator.',
  forbidden: 'Your account cannot change this member’s licences.',
  unauthorized: 'Your session has ended. Sign in again.',
});
export const READ_FAILED = 'This member’s licences could not be read.';
export const WRITE_FAILED = 'That change could not be saved. Nothing was changed.';

/** The fixed words for a refused grant or revoke. */
export function refusalWords(error) {
  const code = error?.body?.code || error?.code || error?.data?.code;
  return REFUSAL_WORDS[code] || WRITE_FAILED;
}

export default function AccountLicencesBlock({ userId }) {
  const [state, setState] = useState({ status: 'loading', held: [], addable: [] });
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState(null);

  const load = useCallback(() => accountLicencesApi.forAccount(userId)
    .then((body) => setState({ status: 'ready', held: body?.held || [], addable: body?.addable || [] }))
    .catch(() => setState({ status: 'error', held: [], addable: [] })), [userId]);
  useEffect(() => { load(); }, [load]);

  const change = async (licence, kind) => {
    setBusy(licence); setNote(null);
    try {
      if (kind === 'grant') await accountLicencesApi.grant(userId, licence);
      else await accountLicencesApi.revoke(userId, licence);
      setNote({ ok: true, text: kind === 'grant' ? 'Licence granted.' : 'Licence revoked.' });
      await load();
    } catch (e) {
      setNote({ ok: false, text: refusalWords(e) });
    } finally { setBusy(''); }
  };

  return (
    <section className="col-span-2 mt-3 rounded-lg border border-gray-200 px-3 py-3 text-[12.5px] dark:border-gray-800" data-testid="drawer-licences">
      <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Licences</div>
      {state.status === 'loading' && <p className="mt-1 text-gray-500 dark:text-gray-400">Reading…</p>}
      {state.status === 'error' && <p role="alert" className="mt-1 text-red-600 dark:text-red-400">{READ_FAILED}</p>}
      {state.status === 'ready' && (
        <>
          <ul className="mt-2 space-y-1.5">
            {state.held.map((row) => (
              <li key={row.licence} className="flex flex-wrap items-center justify-between gap-2" data-testid={`drawer-licence-${row.licence}`}>
                <span>
                  <b className="font-semibold text-gray-900 dark:text-gray-100">{row.label || row.licence}</b>
                  {row.is_primary ? ' · Primary' : ` · ${sourceLabel(row.source)} · ${grantedLabel(row.granted_at)}`}
                </span>
                {!row.is_primary && (
                  <button type="button" disabled={!!busy} onClick={() => change(row.licence, 'revoke')}
                    className="font-semibold text-red-600 hover:underline disabled:opacity-50 dark:text-red-400" data-testid={`drawer-revoke-${row.licence}`}>
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
          {state.addable.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {state.addable.map((row) => (
                <button key={row.licence} type="button" disabled={!!busy} onClick={() => change(row.licence, 'grant')}
                  className="rounded border border-gray-300 px-2 py-1 font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50 dark:border-gray-700 dark:text-violet-300 dark:hover:bg-gray-800"
                  data-testid={`drawer-grant-${row.licence}`}>
                  Grant {row.label || row.licence}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {note && <p role={note.ok ? 'status' : 'alert'} className={`mt-2 ${note.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>{note.text}</p>}
    </section>
  );
}
