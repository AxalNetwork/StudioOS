import React, { useEffect, useState } from 'react';
import { Activity, Github, CheckCircle, AlertCircle, Loader2, Lock, Hash } from 'lucide-react';
import { api } from '../lib/api';

const ACTION_LABELS = {
  user_registered: 'Account created',
  email_verified: 'Email verified',
  user_login: 'Signed in',
  profile_captured: 'Onboarding profile captured',
  profile_reviewed_by_admin: 'Profile reviewed by admin',
  github_synced: 'Activity synced to GitHub',
  account_status_changed: 'Account status changed',
  your_role_changed: 'Role changed',
  ai_advisory_query: 'AI advisory query',
  financial_plan_generated: 'Financial plan generated',
  diligence_check: 'Diligence check',
  project_scored: 'Project scored',
  project_created: 'Project created',
  deal_created: 'Deal created',
  admin_impersonate: 'Admin impersonation',
  user_toggled: 'Admin toggled user',
  role_changed: 'Admin changed a role',
  email_verified_admin: 'Email verified',
  profile_verified: 'Profile verified',
};

const actionColors = {
  user_registered: 'text-emerald-700 bg-emerald-100',
  email_verified: 'text-teal-700 bg-teal-100',
  user_login: 'text-indigo-700 bg-indigo-100',
  profile_captured: 'text-amber-700 bg-amber-100',
  profile_reviewed_by_admin: 'text-violet-700 bg-violet-100',
  github_synced: 'text-gray-700 bg-gray-100',
  account_status_changed: 'text-orange-700 bg-orange-100',
  your_role_changed: 'text-amber-700 bg-amber-100',
};

export default function ActivityPage() {
  const [logs, setLogs] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const me = (() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}'); }
    catch { return {}; }
  })();

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [l, s] = await Promise.all([api.activityLog(), api.activitySummary()]);
      setLogs(l.logs || []);
      setSummary(s);
    } catch (e) {
      setLoadError(e?.message || 'Could not load activity log.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSyncGithub = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await api.activitySyncGithub();
      setSyncResult(result);
      // Refresh so the new github_synced event appears.
      load();
    } catch (e) {
      setSyncResult({ status: 'failed', message: e?.message || 'Sync request failed' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-900">Activity Log</h1>
        <button
          onClick={handleSyncGithub}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {syncing ? <Loader2 size={14} className="animate-spin" /> : <Github size={14} />}
          {syncing ? 'Syncing...' : 'Sync to GitHub'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
        <span className="flex items-center gap-1.5 text-gray-600">
          <Lock size={12} /> Private — only you can see this
        </span>
        {me?.id && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 text-xs font-medium">
            <Hash size={11} /> Member ID #{me.id}
          </span>
        )}
        {me?.email && (
          <span className="text-xs text-gray-500">{me.email}</span>
        )}
      </div>

      {loadError && (
        <div className="mb-4 p-3 rounded-lg border bg-red-50 border-red-200 text-red-800 text-sm flex items-center gap-2">
          <AlertCircle size={14} /> {loadError}
          <button onClick={load} className="ml-auto underline text-xs">Retry</button>
        </div>
      )}

      {syncResult && (
        <div className={`mb-4 p-3 rounded-lg border text-sm flex items-center gap-2 ${
          syncResult.status === 'synced'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {syncResult.status === 'synced' ? (
            <>
              <CheckCircle size={14} />
              <span>Synced {syncResult.entries} entries to GitHub.</span>
              {syncResult.github_url && (
                <a href={syncResult.github_url} target="_blank" rel="noopener noreferrer" className="underline ml-1">
                  View on GitHub
                </a>
              )}
            </>
          ) : (
            <>
              <AlertCircle size={14} />
              <span>{syncResult.message}</span>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-gray-600 text-center py-20">Loading...</div>
      ) : (
        <>
          {summary && (
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="text-[10px] text-gray-500 uppercase">Total Events</div>
                <div className="text-2xl font-bold text-gray-900 mt-1">{summary.total_events}</div>
              </div>
              {Object.entries(summary.action_breakdown || {}).slice(0, 3).map(([action, count]) => (
                <div key={action} className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="text-[10px] text-gray-500 uppercase truncate">
                    {ACTION_LABELS[action] || action.replace(/_/g, ' ')}
                  </div>
                  <div className="text-2xl font-bold text-gray-900 mt-1">{count}</div>
                </div>
              ))}
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
              <Activity size={16} className="text-violet-600" />
              <span className="text-sm font-semibold text-gray-900">Event Stream</span>
              <span className="text-xs text-gray-500 ml-auto">{logs.length} events</span>
            </div>

            {logs.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-600">
                <p className="text-gray-700 font-medium mb-1">No activity recorded yet.</p>
                <p className="text-xs text-gray-500 max-w-md mx-auto">
                  Account creation, email verification, profile capture, sign-in, and admin reviews are all logged here automatically. If you just registered, your events will appear after your next sign-in.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {logs.map((log) => (
                  <div key={log.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-violet-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            actionColors[log.action] || 'text-gray-700 bg-gray-100'
                          }`}>
                            {ACTION_LABELS[log.action] || log.action?.replace(/_/g, ' ')}
                          </span>
                        </div>
                        {log.details && <p className="text-xs text-gray-600 mt-0.5">{log.details}</p>}
                      </div>
                      <div className="text-[10px] text-gray-600 whitespace-nowrap">
                        {log.created_at ? new Date(log.created_at).toLocaleString() : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
