import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card } from '../../ui';

/**
 * The holder console — who holds the Super Admin elevation.
 *
 * Backed by routes/admin_super_admins.ts. Reads need the elevation; grant and
 * revoke need a TOTP-minted session with a recent step-up, the bar
 * impersonation sets. `lib/api.js` already turns a 403 `step_up_required`
 * into the StepUpModal and retries, so a write here prompts for a fresh code
 * rather than failing. A session that was never minted with TOTP cannot be
 * stepped up; the worker says 'TOTP required' and this says what to do.
 *
 * The worker refuses a non-admin target, self-revoke and the last active
 * holder. Those refusals are shown verbatim: each is a sentence written for a
 * person, not a code to translate.
 */
const FRIENDLY = {
  'TOTP required': 'Changing holders needs a session signed in with your authenticator app. Sign out and back in with a code, then try again.',
  'Super admin required': 'Only a current holder can change who holds the elevation.',
};

function messageOf(e) {
  const msg = String(e?.message || e || 'Request failed');
  return FRIENDLY[msg] || msg;
}

export default function SuperAdminHolders() {
  const [holders, setHolders] = useState(null);   // null = not loaded yet
  const [admins, setAdmins] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [h, u] = await Promise.all([api.superAdmins(), api.adminListUsers()]);
      setHolders(Array.isArray(h?.holders) ? h.holders : []);
      const list = Array.isArray(u) ? u : (Array.isArray(u?.users) ? u.users : []);
      setAdmins(list.filter((x) => String(x?.role).toLowerCase() === 'admin'));
    } catch (e) {
      reportError('super-admin-holders', e);
      setError(messageOf(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };

  const holderIds = new Set((holders || []).map((h) => h.id));
  const candidates = admins.filter((a) => !holderIds.has(a.id));

  return (
    <Card className="p-5" data-testid="super-admin-holders">
      <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
        <ShieldCheck size={13} /> Super Admin holders
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-axal-ink-2">
        The account that licenses the platform to subsidiaries. One holder by decision; changes
        need your authenticator, are recorded in the admin audit log, and can never leave the
        set empty.
      </p>

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      <ul className="mt-3 divide-y divide-axal-line" data-testid="super-admin-holder-list">
        {holders === null && !error && (
          <li className="py-2 text-[12px] text-axal-ink-3"><Loader2 size={13} className="inline animate-spin" /> Loading holders…</li>
        )}
        {holders !== null && holders.length === 0 && (
          <li className="py-2 text-[12px] text-axal-ink-3">No holder is recorded. Migration 207 names one; until it has applied to this database, nobody can franchise.</li>
        )}
        {(holders || []).map((h) => (
          <li key={h.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-axal-ink">{h.name || h.email}</div>
              <div className="truncate text-[11.5px] text-axal-ink-3">{h.email}{Number(h.is_active) === 1 ? '' : ' · inactive'}</div>
            </div>
            <button
              type="button"
              disabled={busy || (holders || []).filter((x) => Number(x.is_active) === 1 && x.id !== h.id).length === 0}
              onClick={() => run(() => api.superAdminRevoke(h.id))}
              className="rounded-md border border-red-300 px-3 py-1.5 text-[12px] font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30"
              title="The last active holder cannot be revoked."
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>

      <form
        className="mt-4 flex flex-wrap items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); if (pick) run(() => api.superAdminGrant(Number(pick))).then(() => setPick('')); }}
      >
        <label htmlFor="super-admin-grant" className="text-[12px] font-semibold text-axal-ink-2">Elevate an admin</label>
        <select
          id="super-admin-grant"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          disabled={busy || candidates.length === 0}
          className="rounded-md border border-axal-line bg-white px-2 py-1.5 text-[12.5px] text-axal-ink dark:bg-gray-900"
        >
          <option value="">{candidates.length ? 'Choose an admin…' : 'Every admin already holds it'}</option>
          {candidates.map((a) => (
            <option key={a.id} value={a.id}>{a.name ? `${a.name} · ${a.email}` : a.email}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy || !pick}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
        >
          {busy ? <Loader2 size={13} className="inline animate-spin" /> : 'Grant'}
        </button>
        <span className="text-[11.5px] text-axal-ink-3">Only an existing admin can be elevated.</span>
      </form>
    </Card>
  );
}
