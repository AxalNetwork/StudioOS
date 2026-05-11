import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, FileText, Target, Building, Rocket, Pencil, Trash2, X, Database, Search, ExternalLink, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { useToast } from '../components/useToast';
import { useEscapeClose } from '../components/useEscapeClose';
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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { toast, showToast } = useToast();
  const [project, setProject] = useState(null);
  const [scores, setScores] = useState([]);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [cbOpen, setCbOpen] = useState(false);

  const load = () => {
    setLoadError('');
    Promise.all([
      api.getProject(id),
      api.getScores(id).catch(() => []),
      api.listDocuments(id).catch(() => []),
    ]).then(([p, s, d]) => {
      setProject(p); setScores(s); setDocs(d);
    }).catch((e) => {
      setLoadError(e?.message || 'Failed to load project');
    }).finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  useEffect(() => {
    if (searchParams.get('cb') === '1' && project && !cbOpen && !cbTierLocked) {
      setCbOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('cb');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const advanceWeek = async () => {
    try {
      const updated = await api.advanceWeek(id);
      setProject(p => ({ ...p, ...updated }));
    } catch (e) { showToast({ kind: 'error', msg: e.message }); }
  };

  const incorporate = async () => {
    try {
      const res = await api.incorporateProject(id);
      showToast({ kind: 'success', msg: res.message || 'Incorporation requested' });
      load();
    } catch (e) { showToast({ kind: 'error', msg: e.message }); }
  };

  const spinout = async () => {
    try {
      const res = await api.spinoutProject(id);
      showToast({ kind: 'success', msg: res.message || 'Spin-out triggered' });
      load();
    } catch (e) { showToast({ kind: 'error', msg: e.message }); }
  };

  const handleDelete = async () => {
    if (!project) return;
    if (!window.confirm(`Delete "${project.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteProject(project.id);
      navigate('/projects');
    } catch (e) { showToast({ kind: 'error', msg: e.message }); }
  };

  const isAdmin = user?.role === 'admin';
  const isOwner = !!user?.founder_id && project && project.founder_id === user.founder_id;
  const canEdit = isAdmin || isOwner;
  const canDelete = isAdmin || isOwner;
  const tier = (user?.tier || user?.subscription_plan || 'free').toLowerCase();
  const isElevated = ['admin','partner','investor','mentor'].includes((user?.role || '').toLowerCase());
  const cbTierLocked = !isElevated && tier !== 'growth' && tier !== 'studio';
  const handleCbClick = () => {
    if (cbTierLocked) {
      try {
        window.dispatchEvent(new CustomEvent('studioos:tier_required', {
          detail: { required: 'growth', message: 'Crunchbase enrichment is a growth-tier feature.' },
        }));
      } catch {}
      return;
    }
    setCbOpen(true);
  };

  if (loading) return <div className="text-gray-600 text-center py-20">Loading...</div>;
  if (loadError) {
    return (
      <div className="text-center py-20">
        <div className="text-red-600 text-sm mb-3">{loadError}</div>
        <Link to="/projects" className="text-violet-600 hover:underline text-sm">Back to Projects</Link>
      </div>
    );
  }
  if (!project) return <div className="text-red-600 text-center py-20">Project not found</div>;

  const week = weekLabels[project.playbook_week] || weekLabels.week_1;
  const latestScore = scores[0];

  return (
    <div data-testid="project-detail">
      <Link to="/projects" className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4">
        <ArrowLeft size={14} /> Back to Projects
      </Link>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
          <p className="text-sm text-gray-600">{project.description || project.sector}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={project.status} />
          <div className="flex gap-2 flex-wrap">
            {canEdit && (
              <button onClick={() => setEditing(true)} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg text-xs text-gray-700">
                <Pencil size={12} /> Edit
              </button>
            )}
            {canEdit && (
              <button
                onClick={handleCbClick}
                className={`flex items-center gap-1 px-3 py-1.5 border rounded-lg text-xs ${
                  cbTierLocked
                    ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
                title={cbTierLocked ? 'Upgrade to growth — Crunchbase enrichment' : 'Look up on Crunchbase'}
              >
                <Database size={12} /> Crunchbase {cbTierLocked && <span className="text-[10px] font-semibold ml-1">UPGRADE</span>}
              </button>
            )}
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
            {canDelete && (
              <button data-testid="project-delete-btn" onClick={handleDelete} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-red-200 hover:bg-red-50 rounded-lg text-xs text-red-600">
                <Trash2 size={12} /> Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {cbOpen && (
        <CrunchbaseLookupSlideOver
          project={project}
          onClose={() => setCbOpen(false)}
          onApplied={(snap) => {
            setProject((p) => ({
              ...p,
              crunchbase_uuid: snap.uuid,
              crunchbase_data_json: JSON.stringify(snap),
              crunchbase_synced_at: snap.fetched_at,
            }));
            showToast({ kind: 'success', msg: `Applied "${snap.name}" from Crunchbase` });
          }}
          onError={(msg) => showToast({ kind: 'error', msg })}
        />
      )}

      {project.crunchbase_uuid && (() => {
        let snap = null;
        try { snap = project.crunchbase_data_json ? JSON.parse(project.crunchbase_data_json) : null; } catch {}
        if (!snap) return null;
        return (
          <CrunchbaseProfileCard project={project} snap={snap} canEdit={canEdit} />
        );
      })()}

      {editing && (
        <EditProjectModal
          project={project}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setProject((p) => ({ ...p, ...updated }));
            setEditing(false);
            showToast({ kind: 'success', msg: 'Project updated' });
          }}
          onError={(msg) => showToast({ kind: 'error', msg })}
        />
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-2 rounded-lg shadow-lg text-sm text-white z-50 ${
          toast.kind === 'error' ? 'bg-red-600' : 'bg-violet-600'
        }`} role="status">
          {toast.msg || (typeof toast === 'string' ? toast : '')}
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <InfoCard label="Sector" value={project.sector} />
        <InfoCard label="Stage" value={project.stage} />
        <InfoCard label="TAM" value={project.tam ? `$${(project.tam / 1e6).toFixed(0)}M` : '—'} />
        <InfoCard label="Cost to MVP" value={project.cost_to_mvp ? `$${project.cost_to_mvp.toLocaleString()}` : '—'} />
        <InfoCard label="Funding Needed" value={project.funding_needed ? `$${(project.funding_needed / 1e3).toFixed(0)}K` : '—'} />
        <InfoCard label="Revenue" value={project.revenue ? `$${project.revenue.toLocaleString()}` : '—'} />
      </div>

      {project.founder && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Founder</h3>
          <div className="text-sm text-gray-900">{project.founder.name}</div>
          <div className="text-xs text-gray-600">{project.founder.email} | {project.founder.domain_expertise} | {project.founder.experience_years}yr exp</div>
          {project.founder.bio && <div className="text-xs text-gray-700 mt-1">{project.founder.bio}</div>}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">4-Week Playbook</h3>
          <div className="text-sm font-medium text-violet-600 mb-2">{week.name}</div>
          <ul className="space-y-1">
            {week.tasks.map((t, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-gray-700">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full" />{t}
              </li>
            ))}
          </ul>

          <div className="flex gap-1 mt-4">
            {['week_1', 'week_2', 'week_3', 'week_4'].map(w => (
              <div key={w} className={`flex-1 h-2 rounded-full ${
                project.playbook_week === 'complete' || ['week_2','week_3','week_4'].indexOf(project.playbook_week) >= ['week_2','week_3','week_4'].indexOf(w)
                  ? 'bg-violet-500' : 'bg-gray-300'
              }`} />
            ))}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Target size={14} className="text-violet-600" /> Latest Score
          </h3>
          {latestScore ? (
            <div>
              <div className={`text-4xl font-bold ${
                latestScore.tier === 'TIER_1' ? 'text-emerald-600' :
                latestScore.tier === 'TIER_2' ? 'text-blue-600' : 'text-red-600'
              }`}>{latestScore.total_score}</div>
              <div className="text-xs text-gray-600 mt-1">{latestScore.tier.replace('_', ' ')}</div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                <div className="text-gray-600">Market: <span className="text-gray-900">{latestScore.market_total}</span>/25</div>
                <div className="text-gray-600">Team: <span className="text-gray-900">{latestScore.team_total}</span>/20</div>
                <div className="text-gray-600">Product: <span className="text-gray-900">{latestScore.product_total}</span>/15</div>
                <div className="text-gray-600">Capital: <span className="text-gray-900">{latestScore.capital_total}</span>/15</div>
                <div className="text-gray-600">Fit: <span className="text-gray-900">{latestScore.fit_total}</span>/15</div>
                <div className="text-gray-600">Distrib: <span className="text-gray-900">{latestScore.distribution_total}</span>/10</div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-600">No score yet. <Link to="/scoring" className="text-violet-600 hover:underline">Run scoring</Link></div>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <FileText size={14} className="text-violet-600" /> Documents
        </h3>
        {docs.length === 0 ? (
          <p className="text-sm text-gray-600">No documents generated yet</p>
        ) : (
          <div className="space-y-2">
            {docs.map(d => (
              <div key={d.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm">
                <div>
                  <span className="text-gray-900">{d.title}</span>
                  <span className="text-xs text-gray-600 ml-2">{d.doc_type}</span>
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

function CrunchbaseProfileCard({ project, snap, canEdit }) {
  const [comps, setComps] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(false);

  const loadCompetitors = async () => {
    setLoading(true); setErr(null);
    try {
      const res = await api.crunchbaseCompetitors(project.id, 10);
      setComps(res?.competitors || []);
      setOpen(true);
    } catch (e) {
      const code = e?.data?.error || '';
      if (code === 'crunchbase_not_connected') setErr('Crunchbase isn\'t connected. Connect it from Settings → Integrations.');
      else if (code === 'crunchbase_unauthorized') setErr('Crunchbase rejected the stored API key — reconnect from Settings → Integrations.');
      else if (e?.status === 429) setErr('Crunchbase Basic daily limit reached (200 calls/day). Try again tomorrow.');
      else setErr(e?.message || 'Failed to load competitors');
      setOpen(true);
    } finally { setLoading(false); }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Database size={14} className="text-violet-600" /> Crunchbase profile
            {snap.cb_url && (
              <a href={snap.cb_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-violet-600 hover:underline inline-flex items-center gap-1">
                open <ExternalLink size={10} />
              </a>
            )}
          </h3>
          <div className="text-sm text-gray-900 mt-1 font-medium">{snap.name}</div>
          {snap.short_description && <div className="text-xs text-gray-700 mt-1">{snap.short_description}</div>}
        </div>
        <div className="flex flex-col items-end gap-1">
          {snap.fetched_at && (
            <div className="text-[10px] text-gray-500 whitespace-nowrap">synced {new Date(snap.fetched_at).toLocaleDateString()}</div>
          )}
          {canEdit && (
            <button
              onClick={loadCompetitors}
              disabled={loading}
              className="text-[11px] px-2 py-1 rounded border border-violet-300 text-violet-700 hover:bg-violet-50 disabled:opacity-60"
            >
              {loading ? 'Loading…' : 'Find competitors'}
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
        <CbStat label="Headcount" value={snap.employee_range} />
        <CbStat label="Total funding" value={snap.funding_total_usd ? `$${(snap.funding_total_usd / 1e6).toFixed(2)}M` : '—'} />
        <CbStat label="Last round" value={snap.last_funding_type ? `${snap.last_funding_type}${snap.last_funding_at ? ` (${snap.last_funding_at})` : ''}` : '—'} />
        <CbStat label="Status" value={snap.operating_status || '—'} />
      </div>
      {(snap.category_groups?.length || snap.categories?.length) ? (
        <div className="flex flex-wrap gap-1 mt-3">
          {(snap.category_groups || []).slice(0, 6).map(c => (
            <span key={`g-${c}`} className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">{c}</span>
          ))}
          {(snap.categories || []).slice(0, 6).map(c => (
            <span key={`c-${c}`} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{c}</span>
          ))}
        </div>
      ) : null}
      {open && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-gray-700">Possible competitors (sector heuristic)</div>
            <button onClick={() => setOpen(false)} className="text-[11px] text-gray-500 hover:text-gray-700">hide</button>
          </div>
          {err && <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">{err}</div>}
          {!err && comps && comps.length === 0 && (
            <div className="text-xs text-gray-500">No competitor matches found in Crunchbase Basic.</div>
          )}
          {!err && comps && comps.length > 0 && (
            <ul className="space-y-1.5">
              {comps.map(c => (
                <li key={c.uuid} className="flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">{c.name}</div>
                    {c.short_description && <div className="text-gray-600 truncate">{c.short_description}</div>}
                  </div>
                  {c.cb_url && (
                    <a href={c.cb_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-violet-600 hover:underline inline-flex items-center gap-1 whitespace-nowrap">
                      open <ExternalLink size={10} />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CbStat({ label, value }) {
  return (
    <div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-xs text-gray-900 font-medium mt-0.5 truncate">{value || '—'}</div>
    </div>
  );
}

function CrunchbaseLookupSlideOver({ project, onClose, onApplied, onError }) {
  useEscapeClose(onClose);
  const [q, setQ] = useState(project?.name || '');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [notConnected, setNotConnected] = useState(false);
  const [rateLimitedUntil, setRateLimitedUntil] = useState(0);
  const [applyingUuid, setApplyingUuid] = useState('');
  const isRateLimited = rateLimitedUntil > Date.now();

  useEffect(() => {
    if (isRateLimited) { setResults([]); return; }
    if (!q || q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true); setErr(''); setNotConnected(false);
      try {
        const res = await api.crunchbaseSearch(q.trim(), 15);
        setResults(res?.results || []);
      } catch (e) {
        const msg = e?.message || '';
        const code = e?.data?.error || '';
        if (code === 'crunchbase_not_connected' || /not_connected/i.test(msg)) setNotConnected(true);
        else if (code === 'crunchbase_rate_limited' || e?.status === 429) {
          setRateLimitedUntil(Number(e?.data?.reset_epoch) || (Date.now() + 60 * 60 * 1000));
        } else setErr(msg || 'Search failed');
        setResults([]);
      } finally { setLoading(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [q, isRateLimited]);

  const apply = async (snap) => {
    setApplyingUuid(snap.uuid); setErr('');
    try {
      const res = await api.crunchbaseApply(project.id, { uuid: snap.uuid });
      onApplied?.(res?.snapshot || snap);
      onClose();
    } catch (e) {
      const msg = e?.message || 'Apply failed';
      const code = e?.data?.error || '';
      if (code === 'crunchbase_rate_limited' || e?.status === 429) {
        setRateLimitedUntil(Number(e?.data?.reset_epoch) || (Date.now() + 60 * 60 * 1000));
      } else onError?.(msg);
    } finally { setApplyingUuid(''); }
  };

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-label="Look up on Crunchbase">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-xl bg-white shadow-xl flex flex-col h-full">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Database size={16} className="text-violet-600" /> Look up on Crunchbase
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Search and attach a Crunchbase company snapshot to this project.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="px-5 py-3 border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus type="text" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Company name…"
              disabled={isRateLimited}
              className="w-full bg-gray-50 border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
            />
          </div>
          {notConnected && (
            <div className="mt-3 text-xs px-3 py-2 rounded border border-amber-300 bg-amber-50 text-amber-800 flex items-start gap-1.5">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <span>
                Crunchbase isn't connected.{' '}
                <Link to="/settings/integrations" className="underline font-medium">Connect from Settings → Integrations</Link>{' '}
                to enable enrichment.
              </span>
            </div>
          )}
          {isRateLimited && (
            <div className="mt-3 text-xs px-3 py-2 rounded border border-amber-300 bg-amber-50 text-amber-800 flex items-start gap-1.5">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <span>
                Crunchbase daily limit reached — try again tomorrow.
                <span className="block mt-0.5 text-[11px] text-amber-700">
                  Resumes at {new Date(rateLimitedUntil).toLocaleString()}.
                </span>
              </span>
            </div>
          )}
          {err && !notConnected && !isRateLimited && (
            <div className="mt-3 text-xs text-red-600 flex items-center gap-1.5"><AlertCircle size={12} /> {err}</div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-sm text-gray-500 text-center">Searching…</div>
          ) : results.length === 0 ? (
            !notConnected && !isRateLimited && (
              <div className="p-6 text-sm text-gray-500 text-center">
                {q.trim().length < 2 ? 'Type at least 2 characters to search.' : 'No matches.'}
              </div>
            )
          ) : (
            <ul className="divide-y divide-gray-100">
              {results.map((r) => (
                <li key={r.uuid} className="px-5 py-3 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {r.image_url ? (
                        <img src={r.image_url} alt="" className="w-10 h-10 rounded object-cover bg-gray-100 shrink-0" loading="lazy" />
                      ) : (
                        <div className="w-10 h-10 rounded bg-gradient-to-br from-violet-100 to-indigo-100 flex items-center justify-center text-[10px] font-semibold text-violet-700 shrink-0">
                          {(r.name || '?').slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium text-gray-900 truncate">{r.name}</div>
                          {r.cb_url && (
                            <a href={r.cb_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-violet-600 hover:underline inline-flex items-center gap-0.5">
                              <ExternalLink size={10} />
                            </a>
                          )}
                        </div>
                        {r.website && (
                          <a href={r.website} target="_blank" rel="noopener noreferrer" className="text-[11px] text-violet-600 hover:underline truncate block">
                            {r.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                          </a>
                        )}
                        {r.short_description && (
                          <div className="text-xs text-gray-600 mt-0.5 line-clamp-2">{r.short_description}</div>
                        )}
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-gray-500">
                          {r.hq_location && <span>{r.hq_location}</span>}
                          {r.employee_range && <span>{r.employee_range}</span>}
                          {r.funding_total_usd ? <span>${(r.funding_total_usd / 1e6).toFixed(1)}M raised</span> : null}
                          {r.operating_status && <span>{r.operating_status}</span>}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => apply(r)}
                      disabled={!!applyingUuid}
                      className="shrink-0 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg text-xs text-white font-medium"
                    >
                      {applyingUuid === r.uuid ? 'Applying…' : 'Apply'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
      <div className="text-[10px] text-gray-600 uppercase tracking-wider">{label}</div>
      <div className="text-sm text-gray-900 font-medium mt-0.5 capitalize">{value || '—'}</div>
    </div>
  );
}

const EDITABLE_FIELDS = [
  { key: 'name', label: 'Project Name', required: true },
  { key: 'description', label: 'Description' },
  { key: 'sector', label: 'Sector' },
  { key: 'problem_statement', label: 'Problem Statement', textarea: true },
  { key: 'solution', label: 'Solution', textarea: true },
];

function EditProjectModal({ project, onClose, onSaved, onError }) {
  const [form, setForm] = useState(() => ({
    name: project.name || '',
    description: project.description || '',
    sector: project.sector || '',
    problem_statement: project.problem_statement || '',
    solution: project.solution || '',
  }));
  const [saving, setSaving] = useState(false);

  const handleClose = useCallback(() => {
    if (!saving) onClose();
  }, [onClose, saving]);
  useEscapeClose(handleClose);

  const submit = async () => {
    if (!form.name.trim()) {
      onError('Project name is required');
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateProject(project.id, { ...form, name: form.name.trim() });
      onSaved(updated);
    } catch (e) {
      onError(e?.message || 'Failed to update project');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Edit project"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Edit Project</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {EDITABLE_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="block text-xs text-gray-600 mb-1">
                {f.label}{f.required && <span className="text-red-500"> *</span>}
              </label>
              {f.textarea ? (
                <textarea
                  value={form[f.key]}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  rows={3}
                  className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none"
                />
              ) : (
                <input
                  type="text"
                  value={form[f.key]}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none"
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <button
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm text-white font-medium"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button
            onClick={handleClose}
            disabled={saving}
            className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg text-sm text-gray-900 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
