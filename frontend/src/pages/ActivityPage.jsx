import React, { useEffect, useState } from 'react';
import { Clock, Activity, Filter } from 'lucide-react';
import { api } from '../lib/api';

export default function ActivityPage() {
  const [logs, setLogs] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.activityLog(),
      api.activitySummary(),
    ]).then(([l, s]) => {
      setLogs(l.logs || []);
      setSummary(s);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const actionColors = {
    ai_advisory_query: 'text-violet-600 bg-violet-100',
    financial_plan_generated: 'text-blue-400 bg-blue-500/10',
    diligence_check: 'text-emerald-400 bg-emerald-500/10',
    project_scored: 'text-yellow-400 bg-yellow-500/10',
    project_created: 'text-green-400 bg-green-500/10',
    deal_created: 'text-orange-400 bg-orange-500/10',
  };

  if (loading) return <div className="text-gray-600 text-center py-20">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Activity Log</h1>
      <p className="text-sm text-gray-600 mb-6">Audit trail of all system events</p>

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
          <div className="divide-y divide-gray-800/50">
            {logs.map((log) => (
              <div key={log.id} className="px-4 py-3 hover:bg-gray-50/30 transition-colors">
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
