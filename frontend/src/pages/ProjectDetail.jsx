import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ChevronRight, FileText, Target, Building, Rocket } from 'lucide-react';
import { api } from '../lib/api';
import { StatusBadge } from './Dashboard';

const weekLabels = {
  week_1: { name: 'Week 1 — Validation Sprint', tasks: ['Define problem + ICP', 'Run user interviews', 'Validate willingness to pay', 'Draft 1-page concept'] },
  week_2: { name: 'Week 2 — Build + Structure', tasks: ['Build MVP', 'Define pricing model', 'Prepare pitch', 'Set up legal entity'] },
  week_3: { name: 'Week 3 — Distribution + Dealflow', tasks: ['Activate early users', 'Collect traction signals', 'Refine narrative', 'Partner matchmaking'] },
  week_4: { name: 'Week 4 — Capital + Launch', tasks: ['Pitch investors', 'Close commitments', 'Launch publicly', 'Portfolio onboarding'] },
  complete: { name: 'Playbook Complete', tasks: [] },
};

export default function ProjectDetail() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [scores, setScores] = useState([]);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    Promise.all([
      api.getProject(id),
      api.getScores(id),
      api.listDocuments(id),
    ]).then(([p, s, d]) => {
      setProject(p); setScores(s); setDocs(d);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  const advanceWeek = async () => {
    try {
      const updated = await api.advanceWeek(id);
      setProject(p => ({ ...p, ...updated }));
    } catch (e) { alert(e.message); }
  };

  const incorporate = async () => {
    try {
      const res = await api.incorporateProject(id);
      alert(res.message);
      load();
    } catch (e) { alert(e.message); }
  };

  const spinout = async () => {
    try {
      const res = await api.spinoutProject(id);
      alert(res.message);
      load();
    } catch (e) { alert(e.message); }
  };

  if (loading) return <div className="text-gray-400 text-center py-20">Loading...</div>;
  if (!project) return <div className="text-red-400 text-center py-20">Project not found</div>;

  const week = weekLabels[project.playbook_week] || weekLabels.week_1;
  const latestScore = scores[0];

  return (
    <div>
      <Link to="/projects" className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 mb-4">
        <ArrowLeft size={14} /> Back to Projects
      </Link>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{project.name}</h1>
          <p className="text-sm text-gray-400">{project.description || project.sector}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={project.status} />
          <div className="flex gap-2">
            {project.playbook_week !== 'complete' && (
              <button onClick={advanceWeek} className="flex items-center gap-1 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs text-white">
                <ChevronRight size={12} /> Advance Week
              </button>
            )}
            {!project.entity_id && (
              <button onClick={incorporate} className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white">
                <Building size={12} /> Incorporate
              </button>
            )}
            {project.entity_id && project.status !== 'spinout' && ['tier_1', 'tier_2'].includes(project.status) && (
              <button onClick={spinout} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs text-white">
                <Rocket size={12} /> Spin Out
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <InfoCard label="Sector" value={project.sector} />
        <InfoCard label="Stage" value={project.stage} />
        <InfoCard label="TAM" value={project.tam ? `$${(project.tam / 1e6).toFixed(0)}M` : '—'} />
        <InfoCard label="Cost to MVP" value={project.cost_to_mvp ? `$${project.cost_to_mvp.toLocaleString()}` : '—'} />
        <InfoCard label="Funding Needed" value={project.funding_needed ? `$${(project.funding_needed / 1e3).toFixed(0)}K` : '—'} />
        <InfoCard label="Revenue" value={project.revenue ? `$${project.revenue.toLocaleString()}` : '—'} />
      </div>

      {project.founder && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
          <h3 className="text-sm font-semibold text-white mb-2">Founder</h3>
          <div className="text-sm text-gray-300">{project.founder.name}</div>
          <div className="text-xs text-gray-500">{project.founder.email} | {project.founder.domain_expertise} | {project.founder.experience_years}yr exp</div>
          {project.founder.bio && <div className="text-xs text-gray-400 mt-1">{project.founder.bio}</div>}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">4-Week Playbook</h3>
          <div className="text-sm font-medium text-violet-400 mb-2">{week.name}</div>
          <ul className="space-y-1">
            {week.tasks.map((t, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-gray-400">
                <span className="w-1.5 h-1.5 bg-gray-600 rounded-full" />{t}
              </li>
            ))}
          </ul>

          <div className="flex gap-1 mt-4">
            {['week_1', 'week_2', 'week_3', 'week_4'].map(w => (
              <div key={w} className={`flex-1 h-2 rounded-full ${
                project.playbook_week === 'complete' || ['week_2','week_3','week_4'].indexOf(project.playbook_week) >= ['week_2','week_3','week_4'].indexOf(w)
                  ? 'bg-violet-500' : 'bg-gray-200'
              }`} />
            ))}
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Target size={14} className="text-violet-400" /> Latest Score
          </h3>
          {latestScore ? (
            <div>
              <div className={`text-4xl font-bold ${
                latestScore.tier === 'TIER_1' ? 'text-emerald-400' :
                latestScore.tier === 'TIER_2' ? 'text-blue-400' : 'text-red-400'
              }`}>{latestScore.total_score}</div>
              <div className="text-xs text-gray-400 mt-1">{latestScore.tier.replace('_', ' ')}</div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                <div className="text-gray-400">Market: <span className="text-white">{latestScore.market_total}</span>/25</div>
                <div className="text-gray-400">Team: <span className="text-white">{latestScore.team_total}</span>/20</div>
                <div className="text-gray-400">Product: <span className="text-white">{latestScore.product_total}</span>/15</div>
                <div className="text-gray-400">Capital: <span className="text-white">{latestScore.capital_total}</span>/15</div>
                <div className="text-gray-400">Fit: <span className="text-white">{latestScore.fit_total}</span>/15</div>
                <div className="text-gray-400">Distrib: <span className="text-white">{latestScore.distribution_total}</span>/10</div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">No score yet. <Link to="/scoring" className="text-violet-400 hover:underline">Run scoring</Link></div>
          )}
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <FileText size={14} className="text-violet-400" /> Documents
        </h3>
        {docs.length === 0 ? (
          <p className="text-sm text-gray-500">No documents generated yet</p>
        ) : (
          <div className="space-y-2">
            {docs.map(d => (
              <div key={d.id} className="flex items-center justify-between px-3 py-2 bg-gray-800 rounded-lg text-sm">
                <div>
                  <span className="text-white">{d.title}</span>
                  <span className="text-xs text-gray-500 ml-2">{d.doc_type}</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                  d.status === 'signed' ? 'bg-emerald-100 text-emerald-700' :
                  d.status === 'sent' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-700'
                }`}>{d.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoCard({ label, value }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-sm text-white font-medium mt-0.5 capitalize">{value || '—'}</div>
    </div>
  );
}
