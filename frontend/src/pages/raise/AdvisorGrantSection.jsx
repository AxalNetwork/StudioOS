import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';

/**
 * Who among your advisors can read this startup's record, and how much of it.
 *
 * WHY IT SITS BESIDE THE DATA-ROOM GRANT rather than on the advisor's own page:
 * this is the founder deciding who sees their company, and the page they
 * already come to for that decision is this one. The two grants are different
 * mechanisms — one opens a room of files to an investor, one opens a client
 * record to an advisor — but they answer the same question, and splitting them
 * across two screens is how a founder ends up believing they revoked something
 * they did not.
 *
 * THREE TICKS, NOT ONE. Opening the project record is not the same as opening
 * the data room, and neither is the same as showing an advisor which OTHER
 * advisors this founder is working with. A single "share" button would force
 * the most sensitive of the three in order to grant the least, so each is its
 * own choice and each is named in the words that describe what it actually
 * exposes — particularly the third, which is about people rather than files.
 *
 * NOTHING HERE SENDS AN INVITATION, exactly as the data-room grant does not.
 * The address must already belong to an Axal advisor account, and the copy says
 * so rather than leaving a founder waiting for an email that will not arrive.
 */

const SCOPES = [
  ['scope_project', 'Their record — name, sector, stage, and the metrics you have entered',
    'The half a client brief is missing today.'],
  ['scope_data_room', 'The data room files you marked open',
    'Files you marked NDA-only stay hidden until that advisor has a signed NDA on file — shown to them as a count, never as names.'],
  ['scope_sessions', 'Your sessions with other advisors',
    'This shows the advisor who else you have been working with, and on what. It is the widest of the three; leave it off unless you mean it.'],
];

export default function AdvisorGrantSection({ projectUid }) {
  const [state, setState] = useState({ loading: true, error: null, items: [] });
  const [email, setEmail] = useState('');
  const [scopes, setScopes] = useState({ scope_project: true, scope_data_room: false, scope_sessions: false });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    if (!projectUid) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await api.advisorGrants(projectUid);
      setState({ loading: false, error: null, items: res?.items || [] });
    } catch (e) {
      setState({ loading: false, error: e?.detail || e?.message || 'Advisor access did not load.', items: [] });
    }
  }, [projectUid]);
  useEffect(() => { load(); }, [load]);

  const share = async () => {
    const address = email.trim();
    if (!address || busy) return;
    setBusy(true); setNote(null);
    try {
      await api.advisorGrantCreate(projectUid, { email: address, ...scopes });
      setEmail(''); setNote('Shared.');
      await load();
    } catch (e) {
      setNote(e?.detail || e?.message || 'That did not save.');
    } finally { setBusy(false); }
  };

  const revoke = async (grantUid) => {
    setBusy(true); setNote(null);
    try { await api.advisorGrantRevoke(projectUid, grantUid); await load(); }
    catch (e) { setNote(e?.detail || e?.message || 'That did not save.'); }
    finally { setBusy(false); }
  };

  if (!projectUid) return null;

  return (
    <section className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
      <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Advisors</h3>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
        An advisor cannot read your record unless you open it. Choose what they see — each
        line is a separate decision, and you can revoke any of them at any time.
      </p>

      <div className="mt-3 flex gap-2">
        <input
          type="email" value={email} placeholder="advisor@example.com"
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
        <button
          type="button" disabled={busy || !email.trim()} onClick={share}
          className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          Share
        </button>
      </div>

      <ul className="mt-3 space-y-2">
        {SCOPES.map(([key, label, why]) => (
          <li key={key} className="flex gap-2">
            <input
              id={`adv-${key}`} type="checkbox" checked={scopes[key]} className="mt-0.5"
              onChange={(e) => setScopes({ ...scopes, [key]: e.target.checked })}
            />
            <label htmlFor={`adv-${key}`} className="text-xs leading-relaxed">
              <span className="font-semibold text-gray-800 dark:text-gray-200">{label}</span>
              <span className="block text-gray-600 dark:text-gray-400">{why}</span>
            </label>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        This links an <strong>existing</strong> Axal advisor account — it does not send an
        invitation. An address that is not an advisor is refused, because the grant would
        do nothing: every read re-checks the role, so an advisor who later stops being one
        loses access on their next attempt without you doing anything.
      </p>
      {note && <p className="mt-2 text-xs text-gray-700 dark:text-gray-300">{note}</p>}

      <div className="mt-3">
        {state.loading && <p className="text-xs text-gray-500">Loading…</p>}
        {state.error && <p className="text-xs text-gray-700 dark:text-gray-300">{state.error}</p>}
        {!state.loading && !state.error && !state.items.length && (
          <p className="text-xs text-gray-500 dark:text-gray-400">Not shared with any advisor yet.</p>
        )}
        {state.items.map((g) => (
          <div key={g.uid} className="flex items-start gap-3 border-t border-gray-100 py-2 dark:border-gray-800">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-gray-900 dark:text-gray-100">{g.advisor_email}</div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400">
                {g.status === 'active' ? 'Can see: ' : 'Access revoked · '}
                {g.status === 'active' && (
                  [g.scope_project && 'their record', g.scope_data_room && 'open data-room files',
                    g.scope_sessions && 'your other advisory sessions'].filter(Boolean).join(', ')
                  || 'nothing — every scope is off'
                )}
              </div>
              {g.status === 'active' && !g.advisor_is_advisor && (
                <div className="text-[11px] text-amber-700 dark:text-amber-500">
                  This account is no longer an advisor, so the grant reads nothing.
                </div>
              )}
            </div>
            {g.status === 'active' && (
              <button
                type="button" disabled={busy} onClick={() => revoke(g.uid)}
                className="text-xs font-semibold text-gray-600 underline disabled:opacity-50 dark:text-gray-300"
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
