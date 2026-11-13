/* D377 — apply to host Spin-Out Lab office hours.
 *
 * /spinout-lab/office-hours lists only hosts an admin approved. A partner (from
 * Partner office hours) or an advisor (from Practice · Sessions) applies here,
 * from their own bookable profile: a partner profile as an Investor, Advisor or
 * Partner; an advisor profile as an Advisor. The Worker resolves the profile
 * from the caller's account (routes/lab_hosts.ts), so this card only says which
 * kind — never an id.
 *
 * Every refusal the Worker returns is printed as it came, and a failed read is
 * drawn as unreadable, never as "not applied".
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';

export const CAPACITY_LABEL = { investor: 'Investor', advisor: 'Advisor', partner: 'Partner' };

export const STATUS_COPY = {
  pending: 'Waiting for an admin to review.',
  approved: 'Approved — founders in the Spin-Out Lab see you on Office Hours and can book your published slots.',
  rejected: 'Not approved. You can apply again.',
  withdrawn: 'You withdrew this application. You can apply again.',
  revoked: 'An admin removed you from the Office Hours list. You can apply again.',
};

/** The caller's latest application from the profile of this kind, and whether a new one may be made. */
export function hostStanding(applications, kind) {
  const mine = (Array.isArray(applications) ? applications : []).filter((a) => a && a.host_kind === kind);
  const latest = mine[0] || null;
  const live = latest && (latest.status === 'pending' || latest.status === 'approved');
  return { latest, canApply: !live };
}

export function LabHostApplyView({
  kind, profile, applications, loadState, error, draft, setDraft, busy, onApply, onWithdraw,
}) {
  const { latest, canApply } = hostStanding(applications, kind);
  const capacities = profile?.capacities || [];
  const capacity = capacities.includes(draft.capacity) ? draft.capacity : capacities[0] || '';
  return (
    <section id="lab-host" data-testid="lab-host-card"
      className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <h2 className="text-lg font-semibold text-gray-900 mb-1 dark:text-gray-100">Spin-Out Lab office hours</h2>
      <p className="text-sm text-gray-600 mb-3 dark:text-gray-400">
        Founders in the Spin-Out Lab see only the hosts an admin has approved. Apply to be listed; once approved,
        they book the slots you publish here.
      </p>
      {loadState === 'loading' && <div className="text-sm text-gray-500" data-testid="lab-host-loading">Loading…</div>}
      {loadState === 'failed' && (
        <div className="text-sm text-amber-900 dark:text-amber-200" data-testid="lab-host-unreadable">
          Couldn't read your Spin-Out Lab host status{error ? `: ${error}` : '.'}
        </div>
      )}
      {loadState === 'ok' && !profile && (
        <div className="text-sm text-gray-600 dark:text-gray-400" data-testid="lab-host-no-profile">
          {kind === 'partner'
            ? 'Your account has no partner profile, so there is no calendar founders could book.'
            : 'Your account has no advisor profile, so there is no calendar founders could book.'}
        </div>
      )}
      {loadState === 'ok' && profile && (
        <div className="space-y-3">
          {latest && (
            <div className="text-sm" data-testid="lab-host-status">
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {CAPACITY_LABEL[latest.capacity] || latest.capacity} · {latest.status}
              </span>{' '}
              <span className="text-gray-600 dark:text-gray-400">{STATUS_COPY[latest.status] || ''}</span>
              {latest.review_note && (
                <div className="text-gray-600 mt-1 dark:text-gray-400">Admin note: {latest.review_note}</div>
              )}
              {latest.status === 'pending' && (
                <button type="button" disabled={busy} onClick={() => onWithdraw(latest.uid)}
                  className="ml-2 text-sm text-gray-700 underline disabled:opacity-50 dark:text-gray-300">
                  Withdraw
                </button>
              )}
            </div>
          )}
          {canApply && (
            <div className="space-y-2" data-testid="lab-host-apply">
              <label className="block text-sm text-gray-700 dark:text-gray-300">
                Apply as
                <select value={capacity} disabled={busy || capacities.length < 2}
                  onChange={(e) => setDraft({ ...draft, capacity: e.target.value })}
                  className="ml-2 border rounded px-2 py-1 text-sm dark:bg-gray-900 dark:border-gray-700">
                  {capacities.map((c) => <option key={c} value={c}>{CAPACITY_LABEL[c] || c}</option>)}
                </select>
              </label>
              <textarea value={draft.statement} maxLength={1000} rows={3} disabled={busy}
                onChange={(e) => setDraft({ ...draft, statement: e.target.value })}
                placeholder="What founders can bring you (optional)"
                className="w-full border rounded px-2 py-1 text-sm dark:bg-gray-900 dark:border-gray-700" />
              <button type="button" disabled={busy || !capacity} onClick={() => onApply({ host_kind: kind, capacity, statement: draft.statement })}
                className="px-3 py-1.5 rounded bg-gray-900 text-white text-sm disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900">
                {busy ? 'Sending…' : 'Apply to host'}
              </button>
            </div>
          )}
          {error && <div className="text-sm text-red-700 dark:text-red-300" data-testid="lab-host-error">{error}</div>}
        </div>
      )}
    </section>
  );
}

export default function LabHostApplyCard({ kind }) {
  const [state, setState] = useState({ loadState: 'loading', profiles: [], applications: [] });
  const [draft, setDraft] = useState({ capacity: '', statement: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await api.labHostsMe();
      setState({ loadState: 'ok', profiles: r?.profiles || [], applications: r?.applications || [] });
    } catch (e) {
      setState({ loadState: 'failed', profiles: [], applications: [] });
      setError(e?.message || null);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (fn) => {
    setBusy(true); setError(null);
    try { await fn(); await load(); } catch (e) { setError(e?.message || 'The request failed.'); } finally { setBusy(false); }
  };

  return (
    <LabHostApplyView
      kind={kind}
      profile={state.profiles.find((p) => p.kind === kind) || null}
      applications={state.applications}
      loadState={state.loadState}
      error={error}
      draft={draft} setDraft={setDraft} busy={busy}
      onApply={(data) => act(async () => { await api.labHostApply(data); setDraft({ capacity: '', statement: '' }); })}
      onWithdraw={(uid) => act(() => api.labHostWithdraw(uid))}
    />
  );
}
