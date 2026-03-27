import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Zap, Users, DollarSign, FileText, Target, Ticket, TrendingUp } from 'lucide-react';
import { api } from '../lib/api';

function StatCard({ icon: Icon, label, value, color = 'violet' }) {
  const colors = {
    violet: 'bg-violet-500/10 text-violet-400',
    blue: 'bg-blue-500/10 text-blue-400',
    green: 'bg-emerald-500/10 text-emerald-400',
    amber: 'bg-amber-500/10 text-amber-400',
    red: 'bg-red-500/10 text-red-400',
  };
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colors[color]}`}>
          <Icon size={18} />
        </div>
        <span className="text-xs text-gray-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white">{value ?? '—'}</div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.stats(), api.listProjects()])
      .then(([s, p]) => { setStats(s); setProjects(p); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-400 text-center py-20">Loading dashboard...</div>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Studio Dashboard</h1>
        <p className="text-sm text-gray-400">The 30-Day Spin-Out Engine — Overview</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard icon={Zap} label="Total Projects" value={stats?.total_projects} color="violet" />
        <StatCard icon={Target} label="Pending Scoring" value={stats?.pending_scoring} color="amber" />
        <StatCard icon={TrendingUp} label="Active Pipeline" value={stats?.active_projects} color="green" />
        <StatCard icon={BarChart3} label="Avg Score" value={stats?.avg_score} color="blue" />
        <StatCard icon={Users} label="Partners" value={stats?.total_partners} color="violet" />
        <StatCard icon={DollarSign} label="LP Investors" value={stats?.total_investors} color="green" />
        <StatCard icon={FileText} label="Documents" value={stats?.total_documents} color="blue" />
        <StatCard icon={Ticket} label="Open Tickets" value={stats?.open_tickets} color="red" />
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="font-semibold text-white">Pipeline Projects</h2>
          <Link to="/projects" className="text-xs text-violet-400 hover:text-violet-300">View All</Link>
        </div>
        <div className="divide-y divide-gray-800">
          {projects.length === 0 && (
            <div className="p-8 text-center text-gray-500 text-sm">No projects yet</div>
          )}
          {projects.slice(0, 5).map(p => (
            <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-800/50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-white truncate">{p.name}</div>
                <div className="text-xs text-gray-400">{p.sector || 'Unclassified'}</div>
              </div>
              <StatusBadge status={p.status} />
              <WeekBadge week={p.playbook_week} />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const styles = {
    intake: 'bg-gray-700 text-gray-300',
    scoring: 'bg-amber-500/20 text-amber-400',
    tier_1: 'bg-emerald-500/20 text-emerald-400',
    tier_2: 'bg-blue-500/20 text-blue-400',
    rejected: 'bg-red-500/20 text-red-400',
    spinout: 'bg-violet-500/20 text-violet-400',
    active: 'bg-emerald-500/20 text-emerald-400',
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase font-medium ${styles[status] || styles.intake}`}>
      {status?.replace('_', ' ')}
    </span>
  );
}

function WeekBadge({ week }) {
  if (!week || week === 'complete') return week === 'complete' ? <span className="text-[10px] text-emerald-400">Complete</span> : null;
  const num = week.replace('week_', 'W');
  return <span className="text-[10px] text-gray-400 bg-gray-800 px-2 py-0.5 rounded">{num}</span>;
}

export { StatusBadge, WeekBadge };
