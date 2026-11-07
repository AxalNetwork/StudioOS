/**
 * #4707 — the HQ licence page's administrators. Moved out of `AdminLicences.jsx`
 * unchanged when the page was split by domain; the comments below are the
 * original ones.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, X, ShieldOff, UserPlus } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { useReasonDialog } from '../LicenceReasonDialog';
import { LICENCE_REASONS } from '../licenceReasonModel';
import { STATUS_TONE, Chip } from './licenceShared';

/* ------------------------------------------------------------------ *
 * Administrators — the door admin accounts are opened and closed by    *
 * ------------------------------------------------------------------ */

// D134 — `licence_admins` has existed since migration 190 and had no UI at all:
// its three api.js methods had zero callers, so naming a subsidiary's
// administrator meant SQL. This is the section, and it is deliberately the
// whole lifecycle rather than a list — appoint, demote, detach — because the
// three only make sense read together.
//
// THE TWO-STEP CLOSE IS ON SCREEN RATHER THAN IN A 409. Detach refuses while
// the account still holds the admin role, so the button says so and stays
// disabled until the demote has happened. A UI that offered both and let the
// server pick would teach the operator that one of its buttons is a lie.
//
// A FAILED READ IS NOT AN EMPTY LIST. `items === null` after a failure renders
// the server's own sentence; "no administrators" is a claim about the licence
// and must never be produced by a request that did not arrive.
export function AdminsEditor({ licence, onSaved, prefill = null }) {
  // D4707 — reasons are asked for in a labelled dialog, never window.prompt.
  const [reasonDialog, ask] = useReasonDialog();
  const [items, setItems] = useState(undefined);
  const [loadErr, setLoadErr] = useState(null);
  // D801 — "Grant admin" from a delegate request arrives with the email and the
  // role filled; HQ still reads the form and appoints, through the same POST.
  const [form, setForm] = useState(() => (prefill
    ? { email: prefill.email, admin_role: 'delegate', reason: `Delegate requested by the Administrator (${prefill.uid}).` }
    : { email: '', admin_role: 'principal', reason: '' }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    setLoadErr(null);
    api.licenceAdmins(licence.uid)
      .then((d) => setItems(Array.isArray(d?.items) ? d.items : []))
      .catch((e) => {
        reportError('AdminLicences:licenceAdmins', e);
        setItems(null);
        setLoadErr(e?.message || 'The administrator list could not be read.');
      });
  }, [licence.uid]);
  useEffect(load, [load]);

  const refresh = () => { load(); onSaved?.(); };

  async function run(fn) {
    setBusy(true); setErr(null);
    try { await fn(); refresh(); }
    catch (e) { reportError('AdminLicences:adminAction', e); setErr(e?.message || 'That did not go through.'); }
    finally { setBusy(false); }
  }

  const canAppoint = form.email.trim().length > 0 && form.reason.trim().length >= 10;

  return (
    <div data-testid="licence-admins">
      {reasonDialog}
      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Administrators</h3>
      <p className="mt-1 text-[11px] text-gray-500">
        Appointing someone here makes the account an admin and binds it to this licence in one
        step, so no administrator exists without a territory behind them. Closing one is two
        steps, in this order: demote, then detach.
      </p>

      {items === undefined && <p className="mt-3 text-sm text-gray-500">Loading…</p>}
      {items === null && (
        <p data-testid="licence-admins-unreadable" className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          {loadErr} This is not the same as having none — nothing was read.
        </p>
      )}
      {Array.isArray(items) && items.length === 0 && (
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
          Nobody administers this licence yet.
        </p>
      )}
      {Array.isArray(items) && items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {items.map((a) => {
            const isAdmin = String(a.role || '').toLowerCase() === 'admin';
            const active = Number(a.is_active ?? 0) === 1;
            return (
              <li key={a.user_id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {a.name || a.email}
                    </div>
                    <div className="text-xs text-gray-500">{a.email} · {a.admin_role}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {isAdmin
                      ? <Chip tone={active ? STATUS_TONE.active : STATUS_TONE.suspended}>
                          {active ? 'admin' : 'admin · deactivated'}
                        </Chip>
                      : <Chip tone={STATUS_TONE.draft}>no longer an admin — detach</Chip>}
                    <button
                      type="button" disabled={busy || !isAdmin}
                      onClick={async () => {
                        const reason = await ask(LICENCE_REASONS.demoteAdmin);
                        if (reason) run(() => api.adminDemoteAdmin(a.user_id, reason));
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-40"
                    >
                      <ShieldOff size={12} /> Demote
                    </button>
                    <button
                      type="button" disabled={busy || isAdmin}
                      onClick={() => run(() => api.licenceAdminRemove(licence.uid, a.user_id))}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
                    >
                      <X size={12} /> Detach
                    </button>
                  </div>
                </div>
                {isAdmin && (
                  <p className="mt-2 text-[11px] text-gray-500">
                    Detach is available once this account is no longer an admin — unbinding first
                    would leave an administrator with no licence behind them.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Appoint an administrator</div>
        <p className="mt-1 text-[11px] text-gray-500">
          The address must already have an account — appointing one nobody holds would create an
          administrator who cannot sign in.
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input
            type="email" placeholder="name@example.com" value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
          />
          <select
            value={form.admin_role}
            onChange={(e) => setForm((f) => ({ ...f, admin_role: e.target.value }))}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
          >
            <option value="principal">Principal</option>
            <option value="delegate">Delegate</option>
          </select>
        </div>
        <textarea
          rows={2} placeholder="Why this account, in at least 10 characters. It is recorded."
          value={form.reason}
          onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
        />
        <button
          type="button" disabled={busy || !canAppoint}
          onClick={() => run(async () => {
            await api.licenceAdminAdd(licence.uid, {
              email: form.email.trim(), admin_role: form.admin_role, reason: form.reason.trim(),
            });
            setForm({ email: '', admin_role: 'principal', reason: '' });
          })}
          className="mt-2 inline-flex items-center gap-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <><UserPlus size={14} /> Appoint</>}
        </button>
      </div>

      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <p className="mt-3 text-[11px] text-gray-500">
        Every act here needs a recent TOTP step-up as well as the Super Admin elevation, so a
        403 can mean "step up and try again" rather than "you may not".
      </p>
    </div>
  );
}
