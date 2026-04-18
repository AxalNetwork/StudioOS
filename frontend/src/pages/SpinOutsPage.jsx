import React, { useEffect, useState } from 'react';
import { Rocket, Loader2, ExternalLink, CheckCircle2, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

const SPINOUT_STATUSES = ['spinout', 'spinout_ready', 'incorporated', 'active'];

export default function SpinOutsPage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const all = await api.listProjects();
        setProjects((all || []).filter(p => SPINOUT_STATUSES.includes((p.status || '').toLowerCase())));
      } catch (e) {
        setErr(e.message || 'Failed to load projects');
      } finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <Rocket className="text-violet-600" size={22} />
        <h1 className="text-2xl font-bold text-gray-900">Spin-Outs</h1>
      </div>
      <p className="text-sm text-gray-600 mb-6">
        Projects that have passed the Decision Gate and entered spin-out, incorporation, or independent scaling.
      </p>

      <div className="mb-4 text-xs text-gray-500">
        Need to move a project to spin-out? Open it in the{' '}
        <Link to="/pipeline" className="text-violet-600 hover:underline inline-flex items-center gap-1">
          Pipeline Board <ExternalLink size={11} />
        </Link>{' '}
        and trigger the spin-out wizard from the Decision Gate.
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-500"><Loader2 className="animate-spin mr-2" size={16} /> Loading…</div>
      ) : err ? (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{err}</div>
      ) : projects.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <Rocket className="mx-auto text-gray-300 mb-3" size={32} />
          <div className="text-sm font-medium text-gray-900 mb-1">No spin-outs yet</div>
          <div className="text-xs text-gray-500">Projects that reach the Decision Gate with a "spin-out ready" recommendation will appear here.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {projects.map(p => (
            <Link key={p.id} to={`/projects/${p.id}`}
              className="bg-white border border-gray-200 rounded-xl p-4 hover:border-violet-300 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between mb-2">
                <div className="font-semibold text-gray-900 text-sm">{p.name}</div>
                <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold bg-violet-100 text-violet-700">
                  {p.status}
                </span>
              </div>
              {p.description && <div className="text-xs text-gray-600 mb-2 line-clamp-2">{p.description}</div>}
              <div className="flex items-center gap-3 text-[11px] text-gray-500">
                {p.score != null && <span className="inline-flex items-center gap-1"><CheckCircle2 size={11} className="text-emerald-500" /> Score {p.score}</span>}
                {p.created_at && <span className="inline-flex items-center gap-1"><Clock size={11} /> {new Date(p.created_at).toLocaleDateString()}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
