// D377 — who hosts Spin-Out Lab office hours. The "Office-hours hosts" tab of
// Admin · Spin-Out Lab: the application queue with counts per status, and the
// three decisions — approve and reject a pending application, revoke an
// approved one. /spinout-lab/office-hours lists approved hosts only, so the
// approve button is what puts a person in front of Lab founders.
//
// Worker: routes/lab_hosts.ts (adminLabHosts). Each decision is recorded with
// its reviewer and time and logged through logAdminAction; a refusal (the
// application moved on under you) is printed as the Worker wrote it.
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';

export const HOST_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn', 'revoked'];
const CAPACITY = { investor: 'Investor', advisor: 'Advisor', partner: 'Partner' };

/** Which decisions an application in this status can take. */
export function decisionsFor(status) {
  if (status === 'pending') return ['approve', 'reject'];
  if (status === 'approved') return ['revoke'];
  return [];
}

const DECISION_LABEL = { approve: 'Approve', reject: 'Reject', revoke: 'Revoke' };

export function LabHostsView({ status, setStatus, data, loadState, error, notes, setNote, busyUid, onDecide }) {
  const counts = data?.counts || {};
  const items = data?.items || [];
  return (
    <div data-testid="admin-lab-hosts">
      <p className="text-sm text-gray-600 mb-3 dark:text-gray-400">
        Only approved hosts appear to Lab founders on Office Hours. Partners apply as an Investor, Advisor or
        Partner from Partner office hours; advisors apply as an Advisor from Practice · Sessions.
      </p>
      <div className="flex flex-wrap gap-1.5 mb-4" role="tablist">
        {[...HOST_STATUSES, 'all'].map((s) => (
          <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
            data-testid={`lab-hosts-filter-${s}`}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${status === s ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
            {s === 'all' ? 'All' : `${s[0].toUpperCase()}${s.slice(1)}`}
            {s !== 'all' && loadState === 'ok' && <span className="ml-1 opacity-70">{counts[s] ?? 0}</span>}
          </button>
        ))}
      </div>
      {loadState === 'loading' && <div className="text-sm text-gray-500">Loading…</div>}
      {loadState === 'failed' && (
        <div className="text-sm text-amber-900 dark:text-amber-200" data-testid="lab-hosts-unreadable">
          Couldn't read the host applications{error ? `: ${error}` : '.'}
        </div>
      )}
      {loadState === 'ok' && error && (
        <div className="text-sm text-red-700 mb-3 dark:text-red-300" data-testid="lab-hosts-error">{error}</div>
      )}
      {loadState === 'ok' && items.length === 0 && (
        <div className="text-sm text-gray-500" data-testid="lab-hosts-empty">
          {status === 'all' ? 'No one has applied to host yet.' : `No ${status} applications.`}
        </div>
      )}
      {loadState === 'ok' && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((a) => (
            <li key={a.uid} data-testid="lab-host-row"
              className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{a.profile_name || a.applicant_name}</span>
                  {a.profile_company && <span className="text-gray-600 dark:text-gray-400"> · {a.profile_company}</span>}
                  <span className="text-gray-600 dark:text-gray-400">
                    {' '}· as {CAPACITY[a.capacity] || a.capacity} · {a.host_kind} profile
                  </span>
                </div>
                <span className="text-xs text-gray-500">{a.status}</span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {a.applicant_name} ({a.applicant_email}) · applied {a.created_at}
                {a.reviewed_by_name && ` · ${a.status} by ${a.reviewed_by_name} ${a.reviewed_at || ''}`}
              </div>
              {a.statement && <p className="mt-1.5 text-gray-700 dark:text-gray-300">{a.statement}</p>}
              {a.review_note && <p className="mt-1 text-gray-600 dark:text-gray-400">Note: {a.review_note}</p>}
              {decisionsFor(a.status).length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input value={notes[a.uid] || ''} onChange={(e) => setNote(a.uid, e.target.value)}
                    placeholder="Note (optional, the applicant sees it)" maxLength={1000}
                    className="flex-1 min-w-[12rem] border rounded px-2 py-1 text-xs dark:bg-gray-900 dark:border-gray-700" />
                  {decisionsFor(a.status).map((d) => (
                    <button key={d} type="button" disabled={busyUid === a.uid}
                      onClick={() => onDecide(a.uid, d)} data-testid={`lab-host-${d}`}
                      className="px-2.5 py-1 rounded text-xs font-semibold border border-gray-300 disabled:opacity-50 dark:border-gray-600">
                      {DECISION_LABEL[d]}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AdminLabHosts() {
  const [status, setStatus] = useState('pending');
  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState('loading');
  const [error, setError] = useState(null);
  const [notes, setNotes] = useState({});
  const [busyUid, setBusyUid] = useState(null);

  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      setData(await api.adminLabHosts(status));
      setLoadState('ok');
    } catch (e) {
      setError(e?.message || null);
      setLoadState('failed');
    }
  }, [status]);
  useEffect(() => { setError(null); load(); }, [load]);

  const onDecide = async (uid, decision) => {
    setBusyUid(uid); setError(null);
    try {
      await api.adminDecideLabHost(uid, decision, (notes[uid] || '').trim() || undefined);
      setNotes((n) => ({ ...n, [uid]: '' }));
      await load();
    } catch (e) {
      setError(e?.message || 'The decision was not recorded.');
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <LabHostsView
      status={status} setStatus={setStatus} data={data} loadState={loadState} error={error}
      notes={notes} setNote={(uid, v) => setNotes((n) => ({ ...n, [uid]: v }))}
      busyUid={busyUid} onDecide={onDecide}
    />
  );
}
