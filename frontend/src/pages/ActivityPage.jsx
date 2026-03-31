import React, { useEffect, useState } from 'react';
import { Clock, Activity, Github, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

export default function ActivityPage() {
  const [logs, setLogs] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  useEffect(() => {
    Promise.all([
      api.activityLog(),
      api.activitySummary(),
    ]).then(([l, s]) => {
      setLogs(l.logs || []);
      setSummary(s);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSyncGithub = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await api.activitySyncGithub();
      setSyncResult(result);
    } catch {
      setSyncResult({ status: 'failed', message: 'Sync request failed' });
    } finally {
      setSyncing(false);
    }
  };

  const actionColors = {
    ai_advisory_query: 'text-violet-600 bg-violet-100',
    financial_plan_generated: 'text-blue-400 bg-blue-500/10',
    diligence_check: 'text-emerald-400 bg-emerald-500/10',
    project_scored: 'text-yellow-400 bg-yellow-500/10',
    project_created: 'text-green-400 bg-green-500/10',
    deal_created: 'text-orange-400 bg-orange-500/10',
    user_login: 'text-indigo-600 bg-indigo-100',
    user_registered: 'text-green-600 bg-green-100',
    admin_impersonate: 'text-red-500 bg-red-100',
    email_verified: 'text-teal-600 bg-teal-100',
    user_toggled: 'text-amber-600 bg-amber-100',
  };

  if (loading) return <div className="text-gray-600 text-center py-20">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-900">Activity Log</h1>
        <button
          onClick={handleSyncGithub}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {syncing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Github size={14} />
          )}
          {syncing ? 'Syncing...' : 'Sync to GitHub'}
        </button>
      </div>
      <p className="text-sm text-gray-600 mb-4">Your activity trail</p>

      {syncResult && (
        <div className={`mb-4 p-3 rounded-lg border text-sm flex items-center gap-2 ${
          syncResult.status === 'synced'
            ? 'bg-green-50 border-green-200 text-green-800'
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

      {summary && (
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-[10px] text-gray-500 uppercase">Total Events</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{summary.total_events}</div>
          </div>
          {Object.entries(summary.action_breakdown || {}).slice(0, 3).map(([action, count]) => (
            <div key={action} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="text-[10px] text-gray-500 uppercase truncate">{action.replace(/_/g, ' ')}</div>
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
          <div className="p-8 text-center text-gray-500 text-sm">
            No activity yet. Events are logged as you use the system.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {logs.map((log) => (
              <div key={log.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-violet-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        actionColors[log.action] || 'text-gray-600 bg-gray-50'
                      }`}>{log.action?.replace(/_/g, ' ')}</span>
                      {log.actor && <span className="text-[10px] text-gray-500">by {log.actor}</span>}
                    </div>
                    {log.details && <p className="text-xs text-gray-600 mt-0.5 truncate">{log.details}</p>}
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
    </div>
  );
}
