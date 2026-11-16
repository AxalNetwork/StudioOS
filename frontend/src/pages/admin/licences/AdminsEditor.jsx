/**
 * #4707 — the HQ licence page's administrators. Moved out of `AdminLicences.jsx`
 * when the page was split by domain.
 *
 * D4819 part 11 (#5922) — redrawn to Licences v2 board L11: the Access
 * section's Administrators card, each administrator with their account state,
 * Add administrator in the card's header, and Remove… then Detach on each row.
 * Each action says what it will do before it is taken (`licenceAccessModel.js`),
 * in the labelled reason dialog until the consequence sheet lands, and an
 * action the licence's state cannot take is not offered: the card says why.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, X, UserMinus, UserPlus } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { Unreadable } from '../../../ui/Honesty';
import { useReasonDialog } from '../LicenceReasonDialog';
import {
  accountState, addAdminAsk, addAdminOffer, adminRoleWord, adminsState, detachLine, removeAdminAsk,
} from '../licenceAccessModel';

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
// the account still holds the admin role, so it is offered only once the
// demote (Remove…) has happened, and the row says so. A UI that offered both
// and let the server pick would teach the operator that one of its buttons is
// a lie.
//
// A FAILED READ IS NOT AN EMPTY LIST. `items === null` after a failure renders
// Unreadable; None is a claim about the licence and must never be produced by
// a request that did not arrive.

/**
 * D4819 part 5 (#5931) — the licence's administrators, read once for this editor and for New licence step 4
 * (`NewLicenceSteps.jsx`). `items` is undefined while reading, an array when read (empty is None), and null when
 * the read failed or answered without a list, with `loadErr` the server's sentence: a failed read is never an empty list.
 */
export function useLicenceAdmins(uid) {
  const [items, setItems] = useState(undefined);
  const [loadErr, setLoadErr] = useState(null);
  const load = useCallback(() => {
    setItems(undefined);
    setLoadErr(null);
    api.licenceAdmins(uid)
      .then((d) => setItems(Array.isArray(d?.items) ? d.items : null))
      .catch((e) => {
        reportError('AdminLicences:licenceAdmins', e);
        setItems(null);
        setLoadErr(e?.message || 'The administrator list could not be read.');
      });
  }, [uid]);
  useEffect(load, [load]);
  return { items, loadErr, load };
}

const ACCOUNT_TONE = {
  active: 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300',
  deactivated: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  demoted: 'border-gray-300 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300',
  not_recorded: 'border-dashed border-gray-300 bg-white text-gray-500 italic dark:border-gray-700 dark:bg-gray-950 dark:text-gray-400',
};

function AccountChip({ state }) {
  return (
    <span data-testid="licence-admin-account" data-state={state.key}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${ACCOUNT_TONE[state.key]}`}>
      {state.word}
    </span>
  );
}

export function AdminsEditor({ licence, onSaved, prefill = null }) {
  // D4707 — reasons are asked for in a labelled dialog, never window.prompt.
  const [reasonDialog, ask] = useReasonDialog();
  const { items, load } = useLicenceAdmins(licence.uid);
  // D801 — "Grant admin" from a delegate request arrives with the email and the
  // role filled, and the form already open; HQ still reads it and appoints,
  // through the same POST.
  const [form, setForm] = useState(() => (prefill
    ? { email: prefill.email, admin_role: 'delegate', reason: `Delegate requested by the Administrator (${prefill.uid}).` }
    : { email: '', admin_role: 'principal', reason: '' }));
  const [adding, setAdding] = useState(Boolean(prefill));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const refresh = () => { load(); onSaved?.(); };

  async function run(fn) {
    setBusy(true); setErr(null);
    try { await fn(); refresh(); return true; }
    catch (e) { reportError('AdminLicences:adminAction', e); setErr(e?.message || 'That did not go through. Nothing was changed.'); return false; }
    finally { setBusy(false); }
  }

  const offer = addAdminOffer(licence);
  const listState = adminsState(items);
  const canContinue = form.email.trim().length > 0;

  async function appoint() {
    // The reason is asked for in the dialog, after the consequence is said, at
    // the Worker's own ten characters (`reason_too_short`).
    const reason = await ask(addAdminAsk(licence, { email: form.email, adminRole: form.admin_role }, form.reason));
    if (!reason) return;
    const ok = await run(() => api.licenceAdminAdd(licence.uid, {
      email: form.email.trim(), admin_role: form.admin_role, reason: reason.trim(),
    }));
    if (ok) { setForm({ email: '', admin_role: 'principal', reason: '' }); setAdding(false); }
  }

  return (
    <section data-testid="licence-admins"
      className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      {reasonDialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
          Administrators
          {listState.state === 'listed' && (
            <span className="text-xs font-normal text-gray-500 dark:text-gray-400" data-testid="licence-admins-count">{listState.word}</span>
          )}
        </h2>
        {offer.offered && !adding && (
          <button type="button" data-testid="licence-admin-add" disabled={busy} onClick={() => setAdding(true)}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-md bg-indigo-600 px-3 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 sm:min-h-0 sm:py-1.5">
            <UserPlus size={13} /> Add administrator
          </button>
        )}
      </div>
      {!offer.offered && (
        <p className="mt-2 text-[12px] text-gray-600 dark:text-gray-400" data-testid="licence-admin-add-why">{offer.why}</p>
      )}

      {offer.offered && adding && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950" data-testid="licence-admin-form">
          <p className="text-[12px] text-gray-600 dark:text-gray-400">
            The address must already have an account: appointing one nobody holds would create an
            administrator who cannot sign in.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <label className="block text-xs text-gray-700 dark:text-gray-300">
              Account email
              <input
                type="email" placeholder="name@example.com" value={form.email} data-testid="licence-admin-email"
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
              />
            </label>
            <label className="block text-xs text-gray-700 dark:text-gray-300">
              Role
              <select
                value={form.admin_role} data-testid="licence-admin-role"
                onChange={(e) => setForm((f) => ({ ...f, admin_role: e.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
              >
                <option value="principal">Principal</option>
                <option value="delegate">Delegate</option>
              </select>
            </label>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" data-testid="licence-admin-continue" disabled={busy || !canContinue} onClick={appoint}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-md bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 sm:min-h-0 sm:py-1.5">
              {busy ? <Loader2 size={14} className="animate-spin" /> : 'Continue…'}
            </button>
            <button type="button" onClick={() => setAdding(false)} disabled={busy}
              className="min-h-[44px] rounded-md border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 sm:min-h-0 sm:py-1.5">
              Cancel
            </button>
          </div>
        </div>
      )}

      {listState.state === 'reading' && (
        <div className="mt-3 space-y-2" aria-busy="true" data-testid="licence-admins-reading">
          {[0, 1].map((i) => <div key={i} className="h-10 animate-pulse rounded-md bg-gray-100 dark:bg-gray-800" />)}
        </div>
      )}
      {listState.state === 'unreadable' && (
        <div className="mt-3" data-testid="licence-admins-unreadable" data-absence="unreadable">
          <Unreadable what="The administrators" claim="This is not the same as having none: nothing was read." onRetry={load} />
        </div>
      )}
      {listState.state === 'none' && (
        <p className="mt-3 text-sm text-gray-700 dark:text-gray-300" data-testid="licence-admins-none" data-absence="none">
          <span className="font-medium">None.</span> No administrator is named on this licence.
        </p>
      )}
      {listState.state === 'listed' && (
        <div className="mt-3">
          <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] gap-3 border-b border-gray-200 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400 sm:grid" aria-hidden="true">
            <span>Name</span><span>Role</span><span>Account</span><span className="sr-only">Actions</span>
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {items.map((a) => {
              const st = accountState(a);
              const isAdmin = st.isAdmin;
              return (
                <li key={a.user_id} data-testid={`licence-admin-${a.user_id}`}
                  className="grid gap-2 py-2.5 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{a.name || a.email}</div>
                    {a.name && <div className="truncate text-xs text-gray-500 dark:text-gray-400">{a.email}</div>}
                  </div>
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    <span className="mr-1 text-[11px] text-gray-500 dark:text-gray-400 sm:hidden">Role</span>{adminRoleWord(a.admin_role)}
                  </div>
                  <div className="min-w-0">
                    <AccountChip state={st} />
                    {st.note && <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{st.note}</div>}
                  </div>
                  <div className="sm:text-right">
                    {isAdmin && (
                      <button
                        type="button" disabled={busy} data-testid="licence-admin-remove"
                        onClick={async () => {
                          const reason = await ask(removeAdminAsk(licence, a));
                          if (reason) run(() => api.adminDemoteAdmin(a.user_id, reason));
                        }}
                        className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-gray-300 px-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 sm:min-h-0 sm:py-1"
                      >
                        <UserMinus size={12} /> Remove…
                      </button>
                    )}
                    {!isAdmin && st.key === 'demoted' && (
                      <button
                        type="button" disabled={busy} data-testid="licence-admin-detach"
                        onClick={() => run(() => api.licenceAdminRemove(licence.uid, a.user_id))}
                        className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-gray-300 px-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 sm:min-h-0 sm:py-1"
                      >
                        <X size={12} /> Detach
                      </button>
                    )}
                  </div>
                  {isAdmin && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 sm:col-span-4">
                      Detach is offered once this account is no longer an admin: unbinding first would
                      leave an administrator with no licence behind them.
                    </p>
                  )}
                  {st.key === 'demoted' && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 sm:col-span-4" data-testid="licence-admin-detach-line">
                      {detachLine(licence)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {err && <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert" data-testid="licence-admin-error">{err}</p>}
      <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
        Adding and removing need a recent TOTP step-up as well as the Super Admin elevation, so a
        403 can mean &ldquo;step up and try again&rdquo; rather than &ldquo;you may not&rdquo;.
      </p>
    </section>
  );
}
