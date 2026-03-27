import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Zap, Users, DollarSign, FileText, Target, Ticket, TrendingUp, Handshake } from 'lucide-react';
import { api } from '../lib/api';

function StatCard({ icon: Icon, label, value, color = 'violet' }) {
  const colors = {
    violet: 'bg-violet-100 text-violet-600',
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
    red: 'bg-red-100 text-red-600',
  };
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colors[color]}`}>
          <Icon size={18} />
        </div>
        <span className="text-xs text-gray-600 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value ?? '—'}</div>
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

  if (loading) return <div className="text-gray-500 text-center py-20">Loading dashboard...</div>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Studio Dashboard</h1>
        <p className="text-sm text-gray-600">The 30-Day Spin-Out Engine — Overview</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard icon={Zap} label="Total Projects" value={stats?.total_projects} color="violet" />
        <StatCard icon={Target} label="Pending Scoring" value={stats?.pending_scoring} color="amber" />
        <StatCard icon={TrendingUp} label="Active Pipeline" value={stats?.active_projects} color="green" />
        <StatCard icon={BarChart3} label="Avg Score" value={stats?.avg_score} color="blue" />
        <StatCard icon={Handshake} label="Active Deals" value={stats?.active_deals} color="violet" />
        <StatCard icon={Users} label="Partners" value={stats?.total_partners} color="green" />
        <StatCard icon={DollarSign} label="LP Investors" value={stats?.total_investors} color="blue" />
        <StatCard icon={Ticket} label="Open Tickets" value={stats?.open_tickets} color="red" />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Pipeline Projects</h2>
          <Link to="/projects" className="text-xs text-violet-600 hover:text-violet-700">View All</Link>
        </div>
        <div className="divide-y divide-gray-200">
          {projects.length === 0 && (
            <div className="p-8 text-center text-gray-500 text-sm">No projects yet</div>
          )}
          {projects.slice(0, 5).map(p => (
            <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-gray-900 truncate">{p.name}</div>
                <div className="text-xs text-gray-600">{p.sector || 'Unclassified'}</div>
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
    intake: 'bg-gray-100 text-gray-700',
    scoring: 'bg-amber-100 text-amber-700',
    tier_1: 'bg-emerald-100 text-emerald-700',
    tier_2: 'bg-blue-100 text-blue-700',
    rejected: 'bg-red-100 text-red-700',
    spinout: 'bg-violet-100 text-violet-700',
    active: 'bg-emerald-100 text-emerald-700',
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
